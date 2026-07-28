"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveLightingExecution } = require("../lighting-scene-operations.cjs");
const { executeCue, normalizeExecutionSnapshot } = require("../cue-execution.cjs");

function state() {
  return {
    lightingScenes: [{
      id: "welcome",
      name: "Welcome",
      enabled: true,
      externalControl: {
        adapterType: "qlcplus-websocket",
        widgetId: "101",
        widgetName: "Previously discovered name",
        widgetType: "Button"
      }
    }],
    devices: [{
      id: "qlc",
      name: "QLC+",
      type: "lighting",
      adapterType: "qlcplus-websocket",
      enabled: true,
      metadata: {
        qlcplusProductionPage: "Sunday Morning",
        qlcplusWidgets: [{
          widgetId: "101",
          name: "Welcome",
          widgetType: "Button",
          pageName: "Sunday Morning",
          canActivateScene: true
        }]
      }
    }],
    productionLooks: [{ id: "look", name: "Welcome Look", enabled: true, lightingSceneId: "welcome" }],
    cameraLayouts: [],
    cameras: [],
    cameraPresets: [],
    shots: [],
    runOfService: [{ id: "cue", name: "Welcome Cue", productionLookId: "look" }],
    live: { cueIndex: 0, activityLog: [] }
  };
}

function validationState(current, sceneId = "welcome") {
  return resolveLightingExecution(current, sceneId, { resolvedAt: 123 }).validation.state;
}

test("valid Lighting Scene resolves authoritative frozen QLC+ metadata", () => {
  const resolved = resolveLightingExecution(state(), "welcome", { resolvedAt: 123 });
  assert.deepEqual(resolved.execution, {
    lightingSceneId: "welcome",
    adapterType: "qlcplus-websocket",
    widgetId: "101",
    widgetName: "Welcome",
    pageName: "Sunday Morning",
    executionType: "qlc-button",
    resolvedAt: 123
  });
  assert.equal(resolved.validation.state, "valid");
  assert.equal(Object.isFrozen(resolved.execution), true);
});

test("lighting resolution reports every non-throwing blocking validation state", () => {
  const missingMapping = state();
  missingMapping.lightingScenes[0].externalControl = null;
  assert.equal(validationState(missingMapping), "mapping-missing");

  const missingWidgetId = state();
  missingWidgetId.lightingScenes[0].externalControl.widgetId = "";
  assert.equal(validationState(missingWidgetId), "widget-missing");

  const undiscovered = state();
  undiscovered.devices[0].metadata.qlcplusWidgets = [];
  assert.equal(validationState(undiscovered), "widget-not-discovered");

  const nonButton = state();
  nonButton.devices[0].metadata.qlcplusWidgets[0].widgetType = "Frame";
  nonButton.devices[0].metadata.qlcplusWidgets[0].canActivateScene = false;
  assert.equal(validationState(nonButton), "widget-not-button");

  const noAdapter = state();
  noAdapter.devices = [];
  assert.equal(validationState(noAdapter), "adapter-not-configured");

  const disabledAdapter = state();
  disabledAdapter.devices[0].enabled = false;
  assert.equal(validationState(disabledAdapter), "adapter-disabled");

  const unknownAdapter = state();
  unknownAdapter.lightingScenes[0].externalControl.adapterType = "future-adapter";
  assert.equal(validationState(unknownAdapter), "unknown-adapter");

  const disabledScene = state();
  disabledScene.lightingScenes[0].enabled = false;
  assert.equal(validationState(disabledScene), "lighting-scene-disabled");

  assert.equal(validationState(state(), "missing-scene"), "lighting-scene-missing");
});

test("page mismatch is warning-only and preserves the discovered page", () => {
  const current = state();
  current.devices[0].metadata.qlcplusWidgets[0].pageName = "Emergency";
  const resolved = resolveLightingExecution(current, "welcome", { resolvedAt: 123 });
  assert.equal(resolved.validation.state, "page-mismatch");
  assert.equal(resolved.validation.severity, "warning");
  assert.equal(resolved.execution.widgetId, "101");
  assert.equal(resolved.execution.pageName, "Emergency");
});

test("a referenced Utility scene still resolves and adds a planning warning", () => {
  const current = state();
  current.lightingScenes[0].productionScene = false;
  executeCue(current, 0, { now: () => 123 });
  assert.equal(current.live.executionSnapshot.lightingExecutions[0].widgetId, "101");
  assert.ok(current.live.executionSnapshot.warnings.includes("Scene is marked Utility but is still referenced."));
});

test("GO stores lighting after Shot resolution without activating lighting", () => {
  const current = state();
  executeCue(current, 0, { now: () => 500 });
  const snapshot = current.live.executionSnapshot;
  assert.equal(snapshot.lightingExecutions.length, 1);
  assert.equal(snapshot.lightingExecutions[0].widgetId, "101");
  assert.equal(snapshot.lightingExecutions[0].resolvedAt, 500);
  assert.deepEqual(snapshot.lightingValidationErrors, []);
  assert.ok(Object.keys(snapshot).indexOf("shotExecutions") < Object.keys(snapshot).indexOf("lightingExecutions"));
  const executionSource = fs.readFileSync(path.join(__dirname, "..", "cue-execution.cjs"), "utf8");
  assert.doesNotMatch(executionSource, /activateControl|setWidget|qlcplus/i);
});

test("invalid lighting records structured validation while camera and Shot planning continue", () => {
  const current = state();
  current.lightingScenes[0].externalControl = null;
  executeCue(current, 0, { now: () => 500 });
  assert.deepEqual(current.live.executionSnapshot.lightingExecutions, []);
  assert.equal(current.live.executionSnapshot.lightingValidationErrors[0].state, "mapping-missing");
  assert.ok(Array.isArray(current.live.executionSnapshot.shotExecutions));
  assert.ok(current.live.executionSnapshot.warnings.some(item => item.includes("no QLC+ mapping")));
});

test("snapshot freezes mapped identity and repeated GO creates a new independent snapshot", () => {
  const current = state();
  executeCue(current, 0, { now: () => 100 });
  const first = current.live.executionSnapshot;
  current.lightingScenes[0].externalControl.widgetId = "edited";
  current.devices[0].metadata.qlcplusWidgets[0].name = "Edited Welcome";
  assert.equal(first.lightingExecutions[0].widgetId, "101");
  assert.equal(first.lightingExecutions[0].widgetName, "Welcome");

  current.lightingScenes[0].externalControl.widgetId = "101";
  executeCue(current, 0, { now: () => 200 });
  const second = current.live.executionSnapshot;
  assert.notEqual(second, first);
  assert.equal(second.lightingExecutions[0].widgetName, "Edited Welcome");
  assert.equal(second.lightingExecutions[0].resolvedAt, 200);
  assert.equal(first.lightingExecutions[0].resolvedAt, 100);
});

test("legacy snapshots normalize lighting arrays safely and preserve unknown fields", () => {
  const normalized = normalizeExecutionSnapshot({ cueId: "legacy", futureField: { retained: true } });
  assert.deepEqual(normalized.lightingExecutions, []);
  assert.deepEqual(normalized.lightingValidationErrors, []);
  assert.deepEqual(normalized.futureField, { retained: true });
});

test("executed renderer reads frozen lighting execution instead of mutable scene data", () => {
  const current = state();
  executeCue(current, 0, { now: () => 100 });
  require("../public/production-look-view.js");
  current.lightingScenes[0].name = "Mutable edit";
  current.devices[0].metadata.qlcplusWidgets[0].name = "Mutable widget edit";
  const summary = globalThis.TrinityLookView.summarize(current, current.runOfService[0]);
  assert.equal(summary.lighting, "Welcome");
});
