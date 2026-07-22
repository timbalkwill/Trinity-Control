"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 4310;

function localAddresses(port) {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const address of interfaces || []) {
      if (address.family === "IPv4" && !address.internal) {
        addresses.push(`http://${address.address}:${port}`);
      }
    }
  }
  return addresses;
}

function contentType(filePath) {
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png"
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function createLocalNetworkServer({
  getSnapshot,
  getDevices = () => [],
  publicDirectory,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  logger = console
}) {
  if (typeof getSnapshot !== "function") {
    throw new TypeError("Local network server requires getSnapshot");
  }

  const publicRoot = path.resolve(publicDirectory);
  const clients = new Map();
  let nextClientId = 1;

  function writeEvent(response, eventName, payload) {
    response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify(payload));
  }

  function serveStatic(requestPath, response) {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(requestPath);
    } catch {
      sendJson(response, 400, { error: "Invalid request path" });
      return;
    }

    const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
    const filePath = path.resolve(publicRoot, relativePath);
    if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
      sendJson(response, 403, { error: "Forbidden" });
      return;
    }

    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      response.writeHead(200, {
        "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=300",
        "Content-Type": contentType(filePath)
      });
      fs.createReadStream(filePath).pipe(response);
    });
  }

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, "http://localhost");

    if (request.method === "GET" && requestUrl.pathname === "/api/state") {
      const snapshot = getSnapshot();
      logger.info(`[Trinity Remote] Initial state requested (revision ${snapshot.revision || 0})`);
      sendJson(response, 200, snapshot);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/devices") {
      sendJson(response, 200, getDevices());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/events") {
      const clientId = nextClientId++;
      response.writeHead(200, {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no"
      });
      response.write("retry: 2000\n\n");
      clients.set(clientId, response);
      logger.info(`[Trinity Remote] Client connected (${clientId}); ${clients.size} connected`);
      const initialSnapshot = getSnapshot();
      writeEvent(response, "state-changed", {
        type: "state-changed",
        commandType: "InitialSnapshot",
        revision: initialSnapshot.revision || 0,
        state: initialSnapshot
      });
      writeEvent(response, "devices-changed", {
        type: "devices-changed",
        eventType: "device:initial-snapshot",
        devices: getDevices()
      });
      logger.info(`[Trinity Remote] Initial SSE snapshots sent (${clientId}, revision ${initialSnapshot.revision || 0})`);

      request.on("close", () => {
        if (!clients.delete(clientId)) return;
        logger.info(`[Trinity Remote] Client disconnected (${clientId}); ${clients.size} connected`);
      });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    serveStatic(requestUrl.pathname, response);
  });

  const keepAlive = setInterval(() => {
    for (const response of clients.values()) response.write(": keep-alive\n\n");
  }, 20000);
  keepAlive.unref();

  function broadcastStateChanged(event) {
    for (const [clientId, response] of clients) {
      try {
        writeEvent(response, "state-changed", event);
      } catch (error) {
        clients.delete(clientId);
        response.destroy();
        logger.warn(`[Trinity Remote] Client ${clientId} removed after broadcast error: ${error.message}`);
      }
    }
  }

  function broadcastDevicesChanged(event) {
    for (const [clientId, response] of clients) {
      try {
        writeEvent(response, "devices-changed", event);
      } catch (error) {
        clients.delete(clientId);
        response.destroy();
        logger.warn(`[Trinity Remote] Client ${clientId} removed after device broadcast error: ${error.message}`);
      }
    }
  }

  function start() {
    return new Promise((resolve, reject) => {
      const onError = error => reject(error);
      server.once("error", onError);
      server.listen(port, host, () => {
        server.off("error", onError);
        const actualPort = server.address().port;
        const addresses = localAddresses(actualPort);
        logger.info(`[Trinity Remote] Server listening on ${host}:${actualPort}`);
        if (addresses.length) {
          for (const address of addresses) logger.info(`[Trinity Remote] Open ${address}`);
        } else {
          logger.info(`[Trinity Remote] Open http://localhost:${actualPort}`);
        }
        resolve({ host, port: actualPort, addresses });
      });
    });
  }

  function close() {
    clearInterval(keepAlive);
    for (const response of clients.values()) response.end();
    clients.clear();
    if (!server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  return { broadcastDevicesChanged, broadcastStateChanged, close, start };
}

module.exports = { DEFAULT_HOST, DEFAULT_PORT, createLocalNetworkServer, localAddresses };
