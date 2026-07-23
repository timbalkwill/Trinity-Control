const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { createOperatorCommands } = require("../operator-commands.cjs");
const { createOperatorServer } = require("../operator-server.cjs");

const clone = value => JSON.parse(JSON.stringify(value));

function initialState() {
  return {
    lightingScenes: [{ id: "light-cue", name: "Cue" }, { id: "light-manual", name: "Manual" }],
    productionLooks: [{ id: "look", lightingSceneId: "light-cue", cameraLayoutId: "layout" }],
    cameraLayouts: [{ id: "layout", programCamera: "main", programPreset: "Wide", previewCamera: "left", previewPreset: "Left" }],
    runOfService: [
      { id: "one", name: "One", productionLookId: "look" },
      { id: "two", name: "Two", productionLookId: "look" },
      { id: "three", name: "Three", productionLookId: "look" }
    ],
    live: { cueIndex: 0, hold: false, lightingOverrideId: null, activityLog: [] }
  };
}

function createHarness(port = 0) {
  let persisted = initialState();
  const commands = createOperatorCommands({
    loadState: () => clone(persisted),
    saveState: state => { persisted = clone(state); return clone(persisted); }
  });
  const server = createOperatorServer({
    commands,
    assetsDirectory: path.join(__dirname, "..", "public"),
    host: "127.0.0.1",
    port,
    logger: { info() {} }
  });
  return { commands, server };
}

async function post(baseUrl, route, body = {}, headers = { "Content-Type": "application/json" }) {
  return fetch(`${baseUrl}${route}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

function rawRequest(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: requestPath }, response => {
      response.resume();
      response.on("end", () => resolve(response));
    });
    request.on("error", reject);
    request.end();
  });
}

function connectEvents(url) {
  const controller = new AbortController();
  const events = [];
  const waiters = [];
  const connected = fetch(url, { signal: controller.signal }).then(async response => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (!data) continue;
        const state = JSON.parse(data);
        const waiter = waiters.shift();
        if (waiter) waiter(state); else events.push(state);
      }
    }
  }).catch(error => { if (error.name !== "AbortError") throw error; });
  return {
    next: () => events.length ? Promise.resolve(events.shift()) : new Promise(resolve => waiters.push(resolve)),
    close: async () => { controller.abort(); await connected; }
  };
}

test("Browser Operator HTTP API and synchronization", async t => {
  const { server } = createHarness();
  const status = await server.start();
  const baseUrl = `http://127.0.0.1:${status.port}`;

  try {
    await t.test("health endpoint", async () => {
      const response = await fetch(`${baseUrl}/api/health`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, "ok");
    });
    await t.test("state endpoint", async () => {
      const response = await fetch(`${baseUrl}/api/state`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).live.cueIndex, 0);
      assert.equal(response.headers.get("cache-control"), "no-store");
    });
    await t.test("GO command", async () => {
      const response = await post(baseUrl, "/api/live/go", { index: 2 });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).live.cueIndex, 2);
    });
    await t.test("BACK command", async () => {
      const response = await post(baseUrl, "/api/live/back");
      assert.equal((await response.json()).live.cueIndex, 1);
    });
    await t.test("NEXT command", async () => {
      const response = await post(baseUrl, "/api/live/next");
      assert.equal((await response.json()).live.cueIndex, 2);
    });
    await t.test("HOLD command", async () => {
      const response = await post(baseUrl, "/api/live/hold");
      assert.equal((await response.json()).live.hold, true);
    });
    await t.test("lighting override", async () => {
      const response = await post(baseUrl, "/api/lighting/override", { sceneId: "light-manual" });
      assert.equal((await response.json()).live.lightingOverrideId, "light-manual");
    });
    await t.test("return to cue lighting", async () => {
      const response = await post(baseUrl, "/api/lighting/return-to-cue");
      assert.equal((await response.json()).live.lightingOverrideId, null);
    });
    await t.test("narrow cue mutation endpoints persist authoritative state", async () => {
      let response = await post(baseUrl, "/api/cues/reorder", { from: 0, to: 1 });
      assert.equal(response.status, 200);
      response = await post(baseUrl, "/api/cues/duplicate", { index: 1 });
      assert.equal((await response.json()).runOfService.length, 4);
      response = await post(baseUrl, "/api/cues/update", { index: 2, patch: { notes: "Browser edit" } });
      assert.equal((await response.json()).runOfService[2].notes, "Browser edit");
    });
    await t.test("narrow Production Look endpoints use shared operations", async () => {
      let response = await post(baseUrl, "/api/looks/create", { look: { name: "Browser Look", lightingSceneId: "light-cue" } });
      let payload = await response.json();
      const look = payload.productionLooks.at(-1);
      response = await post(baseUrl, "/api/looks/update", { lookId: look.id, patch: { operatorNotes: "Narrow update" } });
      payload = await response.json();
      assert.equal(payload.productionLooks.at(-1).operatorNotes, "Narrow update");
      response = await post(baseUrl, "/api/looks/duplicate", { lookId: look.id });
      assert.equal((await response.json()).productionLooks.at(-1).name, "Browser Look Copy");
    });
    await t.test("invalid JSON", async () => {
      const response = await post(baseUrl, "/api/live/go", "{broken");
      assert.equal(response.status, 400);
    });
    await t.test("missing required request fields", async () => {
      const response = await post(baseUrl, "/api/live/go", {});
      assert.equal(response.status, 400);
    });
    await t.test("non-JSON command body", async () => {
      const response = await post(baseUrl, "/api/live/next", "{}", { "Content-Type": "text/plain" });
      assert.equal(response.status, 415);
    });
    await t.test("excessively large command body", async () => {
      const response = await post(baseUrl, "/api/live/next", JSON.stringify({ padding: "x".repeat(70 * 1024) }));
      assert.equal(response.status, 413);
    });
    await t.test("unsupported routes and methods", async () => {
      assert.equal((await fetch(`${baseUrl}/api/unknown`)).status, 404);
      assert.equal((await fetch(`${baseUrl}/api/live/next`)).status, 405);
    });
    await t.test("static path traversal is rejected", async () => {
      assert.equal((await rawRequest(status.port, "/operator/%2e%2e/package.json")).statusCode, 403);
    });
    await t.test("operator page and root redirect", async () => {
      const root = await fetch(`${baseUrl}/`, { redirect: "manual" });
      assert.equal(root.status, 302);
      assert.equal(root.headers.get("location"), "/operator/");
      const page = await fetch(`${baseUrl}/operator/`);
      assert.match(await page.text(), /Trinity Browser Operator/);
    });
    await t.test("SSE receives shared command updates", async () => {
      const events = connectEvents(`${baseUrl}/api/events`);
      await events.next();
      await post(baseUrl, "/api/live/go", { index: 0 });
      const update = await events.next();
      assert.equal(update.live.cueIndex, 0);
      await events.close();
    });
  } finally {
    await server.close();
  }
});

test("server shutdown releases its port", async () => {
  const first = createHarness();
  const status = await first.server.start();
  await first.server.close();
  const second = createHarness(status.port);
  await second.server.start();
  await second.server.close();
});

test("port-in-use errors reject startup without terminating the process", async () => {
  const first = createHarness();
  const status = await first.server.start();
  const second = createHarness(status.port);
  try {
    await assert.rejects(second.server.start(), error => error.code === "EADDRINUSE");
  } finally {
    await second.server.close();
    await first.server.close();
  }
});
