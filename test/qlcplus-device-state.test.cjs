"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createQlcServiceManager, normalizeQlcServiceSettings } = require("../qlcplus-service-manager.cjs");
const { createLightingAdapterRegistry } = require("../lighting-adapter-registry.cjs");
const { createLightingExecutor, executeLightingSnapshot } = require("../lighting-execution.cjs");
const { createLightingActiveState } = require("../lighting-active-state.cjs");

function serviceContext(enabled = true) {
  return {
    settings: normalizeQlcServiceSettings({
      manageAutomatically: true,
      applicationPath: "/Applications/QLC+.app",
      workspacePath: "/Shows/Sunday.qxw"
    }),
    device: {
      id: "qlc",
      type: "lighting",
      enabled,
      adapterType: "qlcplus-websocket",
      ipAddress: "127.0.0.1",
      metadata: { qlcplusWidgets: [] }
    },
    lightingScenes: []
  };
}

test("disabled initialization performs no discovery, launch, or health scheduling", async () => {
  const current = serviceContext(false);
  let discoveries = 0;
  let launches = 0;
  let timers = 0;
  const manager = createQlcServiceManager({
    getContext: () => current,
    discover: async () => { discoveries += 1; return { ok: true }; },
    launch: async () => { launches += 1; return {}; },
    setTimer: () => { timers += 1; return timers; },
    clearTimer() {}
  });
  await manager.initialize();
  manager.scheduleMonitor();
  assert.deepEqual({ discoveries, launches, timers }, { discoveries: 0, launches: 0, timers: 0 });
  assert.equal(manager.getStatus().state, "disabled");
  assert.equal(manager.getStatus().executionAvailability, "unavailable");
});

test("enable reuses an existing process and starts exactly one monitor", async () => {
  const current = serviceContext(false);
  let discoveries = 0;
  let launches = 0;
  let timers = 0;
  const manager = createQlcServiceManager({
    getContext: () => current,
    discover: async () => { discoveries += 1; return { ok: true, widgetCount: 13 }; },
    launch: async () => { launches += 1; return {}; },
    setTimer: () => { timers += 1; return timers; },
    clearTimer() {}
  });
  await manager.initialize();
  current.device.enabled = true;
  await manager.enable();
  assert.equal(discoveries, 1);
  assert.equal(launches, 0);
  assert.equal(timers, 1);
  assert.equal(manager.getStatus().state, "connected");
  assert.equal(manager.getStatus().connectionState, "connected");
  assert.equal(manager.getStatus().executionAvailability, "available");
});

test("disable clears monitoring and leaves an owned process running", async () => {
  const current = serviceContext(true);
  let discoveries = 0;
  let launches = 0;
  let kills = 0;
  const cleared = [];
  const child = { exitCode: null, signalCode: null, killed: false, unref() {}, once() {}, kill() { kills += 1; } };
  const manager = createQlcServiceManager({
    getContext: () => current,
    discover: async () => ({ ok: ++discoveries > 1, widgetCount: 13 }),
    launch: async () => { launches += 1; return { child }; },
    setTimer: () => 41,
    clearTimer: timer => cleared.push(timer)
  });
  await manager.initialize();
  manager.scheduleMonitor();
  current.device.enabled = false;
  manager.disable();
  assert.equal(launches, 1);
  assert.equal(kills, 0);
  assert.ok(cleared.includes(41));
  assert.equal(manager.getStatus().processState, "running-managed");
  assert.equal(manager.getStatus().connectionState, "disconnected");
  assert.match(manager.getStatus().message, /process still running/);
});

test("disabled discovery and connection tests never open a transport", async () => {
  let transportCalls = 0;
  const registry = createLightingAdapterRegistry({
    transports: {
      "qlcplus-websocket": {
        testConnection: async () => { transportCalls += 1; return { ok: true }; },
        discoverControls: async () => { transportCalls += 1; return { ok: true }; },
        activateControl: async () => { transportCalls += 1; return { ok: true }; }
      }
    }
  });
  const device = serviceContext(false).device;
  assert.equal((await registry.testConnection(device)).code, "lightingDisabled");
  assert.equal((await registry.discoverControls(device)).code, "lightingDisabled");
  assert.equal(transportCalls, 0);
});

test("disabled lighting skips safely, clears active state, and sends no widget command", async () => {
  const current = serviceContext(false);
  current.devices = [current.device];
  let sends = 0;
  const activeState = createLightingActiveState();
  activeState.markActive({ adapterType: "qlcplus-websocket", widgetId: "10" });
  const registry = {
    execute: async () => { sends += 1; return { ok: true }; },
    testConnection: async () => { sends += 1; return { ok: true }; }
  };
  const executor = createLightingExecutor(current, { registry, activeState });
  const results = await executeLightingSnapshot({
    cueId: "cue",
    lightingExecutions: [{ executionType: "qlc-button", adapterType: "qlcplus-websocket", widgetId: "10" }]
  }, { lightingExecutor: executor, now: () => 1 });
  assert.equal(sends, 0);
  assert.equal(results[0].status, "skipped");
  assert.equal(results[0].reason, "lighting-disabled");
  assert.equal(activeState.get(), null);
});

test("Settings and IPC expose separate saved, process, connection, and execution semantics", () => {
  const root = path.join(__dirname, "..");
  const renderer = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
  const main = fs.readFileSync(path.join(root, "electron-main.cjs"), "utf8");
  for (const label of ["Enabled in Trinity", "Disabled in Trinity", "Process:", "Connection:", "Lighting execution:", "Controls discovered:"]) {
    assert.match(renderer, new RegExp(label));
  }
  assert.match(renderer, /Ready with Lighting Disabled/);
  assert.match(renderer, /Attention Required/);
  assert.match(preload, /setQlcDeviceEnabled/);
  assert.match(main, /qlc-service:set-enabled/);
  const handler = main.slice(main.indexOf('ipcMain.handle("qlc-service:set-enabled"'), main.indexOf('ipcMain.handle("live:go"'));
  assert.doesNotMatch(handler, /activateControl|recallPreset|executeCue|goCue|nextCue/);
});
