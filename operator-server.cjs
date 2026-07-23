"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { projectBrowserState } = require("./device-operations.cjs");

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 4310;
const MAX_BODY_BYTES = 64 * 1024;

function networkUrls(port) {
  const urls = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254.")) {
        urls.push(`http://${address.address}:${port}`);
      }
    }
  }
  return [...new Set(urls)];
}

function createOperatorServer({
  commands,
  assetsDirectory,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  logger = console
}) {
  const clients = new Map();
  let nextClientId = 1;
  const assets = new Map([
    ["/operator/", ["operator/index.html", "text/html; charset=utf-8"]],
    ["/operator/index.html", ["operator/index.html", "text/html; charset=utf-8"]],
    ["/operator/operator.js", ["operator/operator.js", "text/javascript; charset=utf-8"]],
    ["/operator/production-look-view.js", ["production-look-view.js", "text/javascript; charset=utf-8"]],
    ["/operator/operator.css", ["operator/operator.css", "text/css; charset=utf-8"]],
    ["/operator/compact.css", ["operator/compact.css", "text/css; charset=utf-8"]],
    ["/operator/trinity-logo.png", ["assets/trinity-logo.png", "image/png"]]
  ]);

  function json(response, status, payload) {
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify(payload));
  }

  function writeEvent(response, state) {
    response.write(`event: state\ndata: ${JSON.stringify(projectBrowserState(state))}\n\n`);
  }

  async function readJson(request) {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
      const error = new Error("Content-Type must be application/json");
      error.statusCode = 415;
      throw error;
    }
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        const error = new Error("Request body is too large");
        error.statusCode = 413;
        throw error;
      }
    }
    try {
      return body ? JSON.parse(body) : {};
    } catch {
      const error = new Error("Request body must contain valid JSON");
      error.statusCode = 400;
      throw error;
    }
  }

  const commandRoutes = new Map([
    ["/api/live/go", async body => {
      if (!Number.isInteger(body.index)) throw new TypeError("index must be an integer");
      return commands.goCue(body.index, { confirmJump: body.confirmJump === true });
    }],
    ["/api/live/next", () => commands.nextCue()],
    ["/api/live/back", () => commands.previousCue()],
    ["/api/live/hold", () => commands.toggleHold()],
    ["/api/lighting/override", body => {
      if (typeof body.sceneId !== "string" || !body.sceneId) throw new TypeError("sceneId is required");
      return commands.setLightingOverride(body.sceneId);
    }],
    ["/api/lighting/return-to-cue", () => commands.returnToCueLighting()],
    ["/api/cues/reorder", body => commands.reorderCue(body.from, body.to)],
    ["/api/cues/duplicate", body => commands.duplicateCue(body.index)],
    ["/api/cues/insert", body => commands.insertCue(body.index, body.position)],
    ["/api/cues/delete", body => commands.deleteCue(body.index, { confirmActive: body.confirmActive === true })],
    ["/api/cues/update", body => commands.updateCue(body.index, body.patch || {})],
    ["/api/looks/create", body => commands.createProductionLook(body.look || {})],
    ["/api/looks/update", body => commands.updateProductionLook(body.lookId, body.patch || {})],
    ["/api/looks/duplicate", body => commands.duplicateProductionLook(body.lookId)],
    ["/api/looks/delete", body => commands.deleteProductionLook(body.lookId, { confirmReferences: body.confirmReferences === true })]
  ]);

  const server = http.createServer(async (request, response) => {
    const rawPath = (request.url || "/").split("?")[0];
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch {
      return json(response, 400, { error: "Invalid request path" });
    }
    if (decodedPath.split("/").includes("..")) {
      return json(response, 403, { error: "Forbidden" });
    }
    const pathname = new URL(request.url, "http://localhost").pathname;

    if (request.method === "GET" && pathname === "/api/health") {
      return json(response, 200, { status: "ok", port: server.address()?.port || port });
    }
    if (request.method === "GET" && pathname === "/api/state") {
      return json(response, 200, projectBrowserState(commands.getState()));
    }
    if (request.method === "GET" && pathname === "/api/events") {
      const clientId = nextClientId++;
      response.writeHead(200, {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no"
      });
      response.write("retry: 2000\n\n");
      clients.set(clientId, response);
      writeEvent(response, commands.getState());
      logger.info(`[Trinity Operator] Client connected (${clientId}); ${clients.size} connected`);
      request.on("close", () => {
        if (clients.delete(clientId)) logger.info(`[Trinity Operator] Client disconnected (${clientId}); ${clients.size} connected`);
      });
      return;
    }
    if (pathname === "/") {
      if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "Method not allowed" });
      response.writeHead(302, { Location: "/operator/" });
      return response.end();
    }
    if (assets.has(pathname)) {
      if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "Method not allowed" });
      const [filename, contentType] = assets.get(pathname);
      const filePath = path.resolve(assetsDirectory, filename);
      const root = path.resolve(assetsDirectory);
      if (!filePath.startsWith(`${root}${path.sep}`)) return json(response, 403, { error: "Forbidden" });
      try {
        const content = await fs.promises.readFile(filePath);
        response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": contentType });
        return response.end(request.method === "HEAD" ? undefined : content);
      } catch {
        return json(response, 404, { error: "Not found" });
      }
    }
    if (commandRoutes.has(pathname)) {
      if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
      try {
        const body = await readJson(request);
        const state = await commandRoutes.get(pathname)(body);
        return json(response, 200, projectBrowserState(state));
      } catch (error) {
        const status = error.statusCode || (error instanceof TypeError ? 400 : error instanceof RangeError ? 404 : 500);
        return json(response, status, { error: error.message, code: error.code, references: error.references });
      }
    }
    return json(response, 404, { error: "Not found" });
  });

  const unsubscribe = commands.subscribe(state => {
    for (const [clientId, response] of clients) {
      try {
        writeEvent(response, state);
      } catch (error) {
        clients.delete(clientId);
        response.destroy();
      }
    }
  });

  return {
    start: () => new Promise((resolve, reject) => {
      const onError = error => reject(error);
      server.once("error", onError);
      server.listen(port, host, () => {
        server.off("error", onError);
        const actualPort = server.address().port;
        const status = {
          running: true,
          host,
          port: actualPort,
          localUrl: `http://localhost:${actualPort}`,
          networkUrls: networkUrls(actualPort)
        };
        logger.info(`[Trinity Operator] Server listening on ${host}:${actualPort}`);
        for (const url of status.networkUrls) logger.info(`[Trinity Operator] Open ${url}/operator/`);
        resolve(status);
      });
    }),
    close: () => new Promise((resolve, reject) => {
      unsubscribe();
      for (const response of clients.values()) response.end();
      clients.clear();
      if (!server.listening) return resolve();
      server.close(error => error ? reject(error) : resolve());
    })
  };
}

module.exports = { DEFAULT_HOST, DEFAULT_PORT, MAX_BODY_BYTES, createOperatorServer, networkUrls };
