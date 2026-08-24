"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createLightingActiveState } = require("../lighting-active-state.cjs");
const { createLightingExecutor, executeLightingSnapshot } = require("../lighting-execution.cjs");

function state(patch = {}) {
  return {
    settings: { qlcplusService: { workspacePath: "/Shows/Sunday.qxw" } },
    devices: [{
      id: "qlc", type: "lighting", enabled: true, adapterType: "qlcplus-websocket",
      connection: { host: "127.0.0.1", port: 9999, protocol: "ws" }
    }],
    ...patch
  };
}

function execution(widgetId, patch = {}) {
  return Object.freeze({
    lightingSceneId: `scene-${widgetId}`,
    adapterType: "qlcplus-websocket",
    widgetId: String(widgetId),
    widgetName: `Widget ${widgetId}`,
    pageName: "Sunday Morning",
    executionType: "qlc-button",
    ...patch
  });
}

function harness(current = state()) {
  const calls = [];
  const registry = {
    readiness: { ok: true },
    outcomes: [],
    async testConnection() {
      return this.readiness;
    },
    async execute(_device, item) {
      calls.push(item.widgetId);
      return this.outcomes.shift() || {
        ok: true, code: "qlcConnected", activationMessageCount: 1,
        commandValue: 255, message: "QLC+ button activation sent"
      };
    }
  };
  const activeState = createLightingActiveState({ now: () => 100 });
  const executor = () => createLightingExecutor(current, { registry, activeState });
  return { activeState, calls, current, executor, registry };
}

async function run(executor, executions) {
  return executeLightingSnapshot({
    cueId: "cue",
    executedAt: 1,
    lightingExecutions: executions
  }, { lightingExecutor: executor });
}

test("same successful widget is skipped while different widgets replace active state", async () => {
  const testHarness = harness();
  assert.equal((await run(testHarness.executor(), [execution(42)]))[0].status, "success");
  assert.equal(testHarness.activeState.get().widgetId, "42");

  const second = await run(testHarness.executor(), [execution(42, { widgetName: "Renamed", pageName: "Other", lightingSceneId: "different-scene" })]);
  assert.equal(second[0].status, "skipped");
  assert.equal(second[0].reason, "already-active");
  assert.deepEqual(testHarness.calls, ["42"]);

  assert.equal((await run(testHarness.executor(), [execution(57)]))[0].status, "success");
  assert.equal(testHarness.activeState.get().widgetId, "57");
  assert.equal((await run(testHarness.executor(), [execution(42)]))[0].status, "success");
  assert.deepEqual(testHarness.calls, ["42", "57", "42"]);
});

test("failed activation preserves the previous successful active widget", async () => {
  const testHarness = harness();
  await run(testHarness.executor(), [execution(42)]);
  testHarness.registry.outcomes.push({ ok: false, code: "commandSendFailure", message: "QLC+ command could not be sent" });
  assert.equal((await run(testHarness.executor(), [execution(57)]))[0].status, "failed");
  assert.equal(testHarness.activeState.get().widgetId, "42");
  const original = await run(testHarness.executor(), [execution(42)]);
  assert.equal(original[0].reason, "already-active");
  assert.deepEqual(testHarness.calls, ["42", "57"]);
});

test("disconnect clears remembered state and permits activation after reconnect", async () => {
  const testHarness = harness();
  await run(testHarness.executor(), [execution(42)]);
  testHarness.registry.readiness = { ok: false, code: "unexpectedDisconnect", message: "QLC+ disconnected unexpectedly" };
  const failed = await run(testHarness.executor(), [execution(42)]);
  assert.equal(failed[0].status, "failed");
  assert.equal(testHarness.activeState.get(), null);
  testHarness.registry.readiness = { ok: true };
  assert.equal((await run(testHarness.executor(), [execution(42)]))[0].status, "success");
  assert.deepEqual(testHarness.calls, ["42", "42"]);
});

test("workspace, endpoint, adapter identity, and disabled state invalidate assumptions", async () => {
  const testHarness = harness();
  await run(testHarness.executor(), [execution(42)]);

  testHarness.current.settings.qlcplusService.workspacePath = "/Shows/Other.qxw";
  testHarness.activeState.synchronize(testHarness.current);
  assert.equal(testHarness.activeState.get(), null);

  await run(testHarness.executor(), [execution(42)]);
  testHarness.current.devices[0].connection.host = "other-host";
  testHarness.activeState.synchronize(testHarness.current);
  assert.equal(testHarness.activeState.get(), null);

  await run(testHarness.executor(), [execution(42)]);
  testHarness.current.devices[0].enabled = false;
  testHarness.activeState.synchronize(testHarness.current);
  assert.equal(testHarness.activeState.get(), null);
});

test("same-workspace discovery data changes do not clear active state", async () => {
  const testHarness = harness();
  await run(testHarness.executor(), [execution(42)]);
  testHarness.current.devices[0].metadata = { qlcplusWidgets: [{ widgetId: "57" }] };
  testHarness.activeState.synchronize(testHarness.current);
  assert.equal(testHarness.activeState.get().widgetId, "42");
});

test("adapter type participates in equality while names, pages, and scene IDs do not", () => {
  const activeState = createLightingActiveState({ now: () => 100 });
  activeState.markActive(execution(42));
  assert.equal(activeState.matches(execution(42, { widgetName: "Other", pageName: "Other", lightingSceneId: "other" })), true);
  assert.equal(activeState.matches(execution(42, { adapterType: "other-adapter" })), false);
});

test("multiple frozen executions return send, skip, send, skip in original order", async () => {
  const testHarness = harness();
  const frozen = Object.freeze([execution(42), execution(42), execution(57), execution(57)]);
  const before = JSON.stringify(frozen);
  const results = await run(testHarness.executor(), frozen);
  assert.deepEqual(results.map(item => [item.widgetId, item.status, item.reason || null]), [
    ["42", "success", null],
    ["42", "skipped", "already-active"],
    ["57", "success", null],
    ["57", "skipped", "already-active"]
  ]);
  assert.deepEqual(testHarness.calls, ["42", "57"]);
  assert.equal(JSON.stringify(frozen), before);
});

test("invalid executions do not send or alter active state", async () => {
  const testHarness = harness();
  testHarness.activeState.markActive(execution(42));
  const results = await run(testHarness.executor(), [
    execution("", { widgetId: "" }),
    execution(57, { executionType: "unsupported" })
  ]);
  assert.deepEqual(results.map(item => item.status), ["skipped", "skipped"]);
  assert.deepEqual(testHarness.calls, []);
  assert.equal(testHarness.activeState.get().widgetId, "42");
});

test("new tracker begins without persisted active lighting state", () => {
  assert.equal(createLightingActiveState().get(), null);
});

test("service restart or loss reset permits the same widget to send again", async () => {
  const testHarness = harness();
  await run(testHarness.executor(), [execution(42)]);
  testHarness.activeState.reset("service-restarting");
  await run(testHarness.executor(), [execution(42)]);
  testHarness.activeState.reset("service-stopped");
  await run(testHarness.executor(), [execution(42)]);
  assert.deepEqual(testHarness.calls, ["42", "42", "42"]);
});
