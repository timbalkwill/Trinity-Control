"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { executeCue } = require("../cue-execution.cjs");
const { createLightingExecutor, executeLightingSnapshot } = require("../lighting-execution.cjs");
const { createLightingActiveState } = require("../lighting-active-state.cjs");
const { createOperatorCommands } = require("../operator-commands.cjs");
const { normalizeShot } = require("../shot-operations.cjs");

const clone = value => JSON.parse(JSON.stringify(value));

function frozenExecution(patch = {}) {
  return Object.freeze({
    lightingSceneId: "welcome",
    adapterType: "qlcplus-websocket",
    widgetId: "101",
    widgetName: "Welcome",
    pageName: "Sunday Morning",
    executionType: "qlc-button",
    resolvedAt: 10,
    ...patch
  });
}

function executionState() {
  return {
    lightingScenes: [{
      id: "welcome", name: "Welcome", enabled: true,
      externalControl: { adapterType: "qlcplus-websocket", widgetId: "101", widgetName: "Welcome", widgetType: "Button" }
    }],
    devices: [{
      id: "qlc", type: "lighting", name: "QLC+", adapterType: "qlcplus-websocket", enabled: true,
      connection: { host: "127.0.0.1", port: 9999 },
      metadata: {
        qlcplusProductionPage: "Sunday Morning",
        qlcplusWidgets: [{ widgetId: "101", name: "Welcome", widgetType: "Button", pageName: "Sunday Morning", canActivateScene: true }]
      }
    }],
    productionLooks: [{ id: "look", name: "Welcome Look", enabled: true, lightingSceneId: "welcome" }],
    cameraLayouts: [], cameras: [], cameraPresets: [], shots: [],
    runOfService: [{ id: "cue", name: "Welcome Cue", productionLookId: "look" }],
    live: { cueIndex: 0, activityLog: [] }
  };
}

test("frozen lighting actions execute in snapshot order and preserve immutable command identity", async () => {
  const executions = [
    frozenExecution(),
    frozenExecution({ lightingSceneId: "sermon", widgetId: "202", widgetName: "Sermon", pageName: "Other" })
  ];
  const snapshot = { cueId: "cue", executedAt: 10, lightingExecutions: Object.freeze(executions) };
  const before = JSON.stringify(snapshot.lightingExecutions);
  const calls = [];
  const results = await executeLightingSnapshot(snapshot, {
    now: (() => { let value = 10; return () => value++; })(),
    lightingExecutor: {
      async execute(execution) {
        calls.push({ widgetId: execution.widgetId });
        return { ok: true, message: "activated", elapsedMs: 1 };
      }
    }
  });
  assert.deepEqual(calls, [{ widgetId: "101" }, { widgetId: "202" }]);
  assert.deepEqual(results.map(item => item.status), ["success", "success"]);
  assert.equal(JSON.stringify(snapshot.lightingExecutions), before);
  assert.equal(Object.isFrozen(snapshot.lightingExecutions[0]), true);
});

test("executeCue activates the frozen widget and never rereads edited planning records", async () => {
  const current = executionState();
  const calls = [];
  const pending = executeCue(current, 0, {
    now: () => 100,
    lightingExecutor: {
      async execute(execution) {
        current.productionLooks[0].lightingSceneId = "edited-look";
        current.lightingScenes[0].externalControl.widgetId = "edited-widget";
        current.devices[0].metadata.qlcplusWidgets = [];
        calls.push(clone(execution));
        return { ok: true, message: "QLC+ button activation sent" };
      }
    }
  });
  await pending;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].widgetId, "101");
  assert.equal(calls[0].widgetName, "Welcome");
  assert.equal(current.live.executionSnapshot.lightingExecutionResults[0].status, "success");
});

test("live snapshot exposes pending lighting feedback while activation is in flight", async () => {
  const current = executionState();
  let complete;
  const pending = executeCue(current, 0, {
    now: () => 100,
    lightingExecutor: {
      execute() {
        return new Promise(resolve => { complete = resolve; });
      }
    }
  });
  assert.equal(current.live.executionSnapshot.lightingExecutionResults[0].status, "pending");
  assert.equal(current.live.executionSnapshot.lightingExecutionResults[0].widgetName, "Welcome");
  complete({ ok: true, message: "activated" });
  await pending;
  assert.equal(current.live.executionSnapshot.lightingExecutionResults[0].status, "success");
});

test("lighting failures are structured, sanitized, and do not block successful camera execution", async () => {
  const current = executionState();
  current.shots = [normalizeShot({
    id: "shot", name: "Static", shotType: "static", enabled: true,
    cameraDeviceId: "camera", cameraPresetId: "preset"
  })];
  current.devices.push({ id: "camera", type: "camera", name: "Camera", enabled: true });
  current.cameraPresets = [{ id: "preset", cameraDeviceId: "camera", name: "Wide", enabled: true }];
  current.productionLooks[0].cameraAssignments = [{ role: "main", shotId: "shot" }];
  let recalls = 0;
  await executeCue(current, 0, {
    now: () => 200,
    cameraExecutor: { recallPreset() { recalls += 1; return { ok: true }; } },
    lightingExecutor: { async execute() { throw new Error("ws://user:secret@example.test"); } }
  });
  assert.equal(recalls, 1);
  const result = current.live.executionSnapshot.lightingExecutionResults[0];
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "unexpectedAdapterError");
  assert.doesNotMatch(JSON.stringify(result), /user|secret|example/);
});

test("camera execution continues when the same lighting widget is skipped as already active", async () => {
  const current = executionState();
  current.shots = [normalizeShot({
    id: "shot", name: "Static", shotType: "static", enabled: true,
    cameraDeviceId: "camera", cameraPresetId: "preset"
  })];
  current.devices.push({ id: "camera", type: "camera", name: "Camera", enabled: true });
  current.cameraPresets = [{ id: "preset", cameraDeviceId: "camera", name: "Wide", enabled: true }];
  current.productionLooks[0].cameraAssignments = [{ role: "main", shotId: "shot" }];
  const activeState = createLightingActiveState();
  const registry = {
    async testConnection() { return { ok: true }; },
    async execute() { return { ok: true, activationMessageCount: 1, commandValue: 255, message: "sent" }; }
  };
  let recalls = 0;
  const runCue = () => executeCue(current, 0, {
    cameraExecutor: { recallPreset() { recalls += 1; return { ok: true }; } },
    lightingExecutor: createLightingExecutor(current, { registry, activeState })
  });
  await runCue();
  await runCue();
  assert.equal(recalls, 2);
  assert.equal(current.live.executionSnapshot.lightingExecutionResults[0].reason, "already-active");
});

test("invalid frozen lighting actions are skipped without transport activity", async () => {
  let calls = 0;
  const lightingExecutor = { execute() { calls += 1; return { ok: true }; } };
  const results = await executeLightingSnapshot({
    lightingExecutions: [
      frozenExecution({ executionType: "unknown" }),
      frozenExecution({ widgetId: "" })
    ]
  }, { lightingExecutor });
  assert.deepEqual(results.map(item => item.errorCode), ["unsupportedExecutionType", "widgetIdMissing"]);
  assert.equal(calls, 0);
});

test("operator GO serialization prevents concurrent requests from toggling the same active widget", async () => {
  let persisted = executionState();
  const activations = [];
  const lightingAdapters = {
    async testConnection() {
      return { ok: true };
    },
    async execute(_device, execution) {
      activations.push(execution.widgetId);
      await Promise.resolve();
      return { ok: true, message: "activated" };
    },
    discoverControls() { throw new Error("not used"); }
  };
  const commands = createOperatorCommands({
    loadState: () => clone(persisted),
    saveState: state => { persisted = clone(state); return clone(persisted); },
    lightingAdapters
  });
  const results = await Promise.all([commands.goCue(0), commands.goCue(0)]);
  assert.deepEqual(activations, ["101"]);
  assert.equal(results[0].live.executionSnapshot.lightingExecutionResults[0].status, "success");
  assert.equal(results[1].live.executionSnapshot.lightingExecutionResults[0].reason, "already-active");
  const later = await commands.goCue(0);
  assert.deepEqual(activations, ["101"]);
  assert.equal(later.live.executionSnapshot.lightingExecutionResults[0].reason, "already-active");
});

test("planning validation is not repaired and GO performs no discovery, launch, or remapping", () => {
  const current = executionState();
  current.devices[0].metadata.qlcplusWidgets = [];
  let calls = 0;
  executeCue(current, 0, { lightingExecutor: { execute() { calls += 1; } } });
  assert.equal(current.live.executionSnapshot.lightingExecutions.length, 0);
  assert.equal(current.live.executionSnapshot.lightingValidationErrors[0].state, "widget-not-discovered");
  assert.equal(calls, 0);
  assert.equal(current.lightingScenes[0].externalControl.widgetId, "101");
});

test("activation remains isolated from renderer, settings, service, and Browser Operator code", () => {
  const root = path.join(__dirname, "..");
  const renderer = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const browser = fs.readFileSync(path.join(root, "public", "operator", "operator.js"), "utf8");
  const service = fs.readFileSync(path.join(root, "qlcplus-service-manager.cjs"), "utf8");
  assert.doesNotMatch(renderer, /activateControl|sendWidgetValue/);
  assert.doesNotMatch(browser, /activateControl|sendWidgetValue|qlcplusWS/);
  assert.doesNotMatch(service, /activateControl|sendWidgetValue/);
});

test("toggle execution source has no zero release or obsolete release-failure path", () => {
  const transport = fs.readFileSync(path.join(__dirname, "..", "qlcplus-websocket-transport.cjs"), "utf8");
  const activation = transport.slice(transport.indexOf("activateControl:"), transport.indexOf("\n  };", transport.indexOf("activateControl:")));
  assert.doesNotMatch(activation, /sendWidgetValue\([^,]+,\s*0\)/);
  assert.doesNotMatch(transport, /releaseFailure|release failed/i);
});
