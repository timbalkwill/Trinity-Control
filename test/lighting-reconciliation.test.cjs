"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  dependencyIndex,
  missingLightingDependencies,
  reconcileLightingScenes,
  replaceLightingReferences,
  semanticDiscoveryEqual
} = require("../lighting-reconciliation.cjs");
const { migrateLightingScenes, resolveLightingExecution } = require("../lighting-scene-operations.cjs");
const { buildCueExecutionPlan } = require("../cue-execution-plan.cjs");
const { createOperatorCommands } = require("../operator-commands.cjs");
const { extractPortableState } = require("../backup-operations.cjs");
const fs = require("node:fs");
const path = require("node:path");

const button = (widgetId, name, extra = {}) => ({
  widgetId: String(widgetId), name, widgetType: "Button", canActivateScene: true,
  status: "0", pageName: "Sunday Morning", containerPath: [], ...extra
});
const baseState = () => ({
  lightingScenes: [], productionLooks: [], runOfService: [], cueTemplates: [],
  devices: [{ id: "qlc", type: "lighting", enabled: true, adapterType: "qlcplus-websocket", metadata: { qlcplusWidgets: [] } }]
});

test("new QLC+ functions appear automatically with widget identity", () => {
  const state = baseState();
  const outcome = reconcileLightingScenes(state, [button(1, "Welcome")], { now: 0 });
  assert.equal(outcome.summary.added.length, 1);
  assert.equal(state.lightingScenes[0].qlcMirror.widgetId, "1");
  assert.equal(state.lightingScenes[0].authoritativeSource, "qlcplus");
});

test("rename on the same widget ID updates display and preserves Look and Cue references", () => {
  const state = baseState();
  reconcileLightingScenes(state, [button(3, "Sermon")], { now: 0 });
  const sceneId = state.lightingScenes[0].id;
  state.productionLooks.push({ id: "look", name: "Sermon", lightingSceneId: sceneId });
  state.runOfService.push({ id: "cue", name: "Sermon", lightingSceneId: sceneId });
  const outcome = reconcileLightingScenes(state, [button(3, "Sermon Neutral")], { now: 1 });
  assert.equal(outcome.summary.renamed.length, 1);
  assert.equal(state.lightingScenes[0].name, "Sermon Neutral");
  assert.equal(state.productionLooks[0].lightingSceneId, sceneId);
  assert.equal(state.runOfService[0].lightingSceneId, sceneId);
});

test("deleted function becomes a non-executable tombstone while references remain", () => {
  const state = baseState();
  reconcileLightingScenes(state, [button(4, "Invitation")], { now: 0 });
  const scene = state.lightingScenes[0];
  state.productionLooks.push({ id: "look", name: "Invitation", lightingSceneId: scene.id });
  state.runOfService.push({ id: "cue", name: "Invitation", lightingSceneId: scene.id });
  const outcome = reconcileLightingScenes(state, [], { now: 2 });
  assert.equal(outcome.summary.removed.length, 1);
  assert.equal(scene.available, false);
  assert.equal(state.productionLooks[0].lightingSceneId, scene.id);
  assert.equal(state.runOfService[0].lightingSceneId, scene.id);
  assert.equal(resolveLightingExecution(state, scene.id).validation.state, "qlc-function-missing");
});

test("dependency index includes direct and inherited actual relationships", () => {
  const state = baseState();
  state.lightingScenes = [{ id: "scene", available: false }];
  state.productionLooks = [{ id: "look", name: "Sermon", lightingSceneId: "scene" }];
  state.runOfService = [
    { id: "direct", name: "Direct", lightingSceneId: "scene" },
    { id: "inherited", name: "Inherited", productionLookId: "look" }
  ];
  state.cueTemplates = [{ id: "template", name: "Template", productionLookId: "look" }];
  const index = dependencyIndex(state, "scene");
  assert.equal(index.productionLooks.length, 1);
  assert.deepEqual(index.serviceCues.map(item => item.source), ["direct", "production-look"]);
  assert.equal(index.cueTemplates[0].source, "production-look");
  assert.equal(missingLightingDependencies(state).length, 1);
});

test("explicit replacement changes selected direct references only", () => {
  const state = baseState();
  state.lightingScenes = [{ id: "missing", available: false }, { id: "replacement", available: true }];
  state.productionLooks = [{ id: "one", lightingSceneId: "missing" }, { id: "two", lightingSceneId: "missing" }];
  state.runOfService = [{ id: "cue", lightingSceneId: "missing" }];
  replaceLightingReferences(state, "missing", "replacement", { productionLookIds: ["one"] });
  assert.equal(state.productionLooks[0].lightingSceneId, "replacement");
  assert.equal(state.productionLooks[1].lightingSceneId, "missing");
  assert.equal(state.runOfService[0].lightingSceneId, "missing");
});

test("explicit replace-all updates every direct relationship without deleting records", () => {
  const state = baseState();
  state.lightingScenes = [{ id: "missing", available: false }, { id: "replacement", available: true }];
  state.productionLooks = [{ id: "look", lightingSceneId: "missing" }];
  state.runOfService = [{ id: "cue", lightingSceneId: "missing" }];
  state.cueTemplates = [{ id: "template", lightingSceneId: "missing" }];
  const result = replaceLightingReferences(state, "missing", "replacement", { all: true });
  assert.equal(result.updated, 3);
  assert.equal(state.lightingScenes.length, 2);
  assert.ok([state.productionLooks[0], state.runOfService[0], state.cueTemplates[0]].every(item => item.lightingSceneId === "replacement"));
});

test("same-name replacement is never guessed after deletion", () => {
  const state = baseState();
  reconcileLightingScenes(state, [button(1, "Sermon")], { now: 0 });
  const oldId = state.lightingScenes[0].id;
  reconcileLightingScenes(state, [button(2, "Sermon")], { now: 1 });
  assert.equal(state.lightingScenes.find(scene => scene.id === oldId).available, false);
  assert.equal(state.lightingScenes.length, 2);
  assert.notEqual(state.lightingScenes.find(scene => scene.available).id, oldId);
});

test("non-button type change removes the former executable identity", () => {
  const state = baseState();
  reconcileLightingScenes(state, [button(1, "Scene")], { now: 0 });
  reconcileLightingScenes(state, [button(1, "Scene", { widgetType: "Slider", canActivateScene: false })], { now: 1 });
  assert.equal(state.lightingScenes[0].available, false);
});

test("ambiguous legacy mappings are not guessed", () => {
  const state = baseState();
  state.lightingScenes = [
    { id: "a", name: "A", externalControl: { widgetId: "1" } },
    { id: "b", name: "B", externalControl: { widgetId: "1" } }
  ];
  const outcome = reconcileLightingScenes(state, [button(1, "Current")], { now: 0 });
  assert.equal(outcome.summary.ambiguous.length, 1);
  assert.deepEqual(state.lightingScenes.map(scene => scene.name), ["A", "B"]);
});

test("unchanged discovery is semantic no-op", () => {
  const state = baseState();
  reconcileLightingScenes(state, [button(1, "Welcome")], { now: 0 });
  const outcome = reconcileLightingScenes(state, [button(1, "Welcome")], { now: 10_000 });
  assert.equal(outcome.changed, false);
  assert.equal(outcome.summary.unchanged, 1);
  assert.equal(state.lightingScenes[0].qlcMirror.lastDiscoveredAt, "1970-01-01T00:00:00.000Z");
});

test("discovery comparison ignores elapsed time and diagnostic timestamps", () => {
  const widget = button(1, "Welcome");
  const device = { metadata: { qlcplusWidgets: [widget], qlcplusPages: [{ pageName: "Sunday Morning" }], lightingDiagnostic: { elapsedMs: 1 } } };
  assert.equal(semanticDiscoveryEqual(device, [{ ...widget }], [{ pageName: "Sunday Morning" }]), true);
});

test("legacy scenes default available and preserve unknown fields", () => {
  const scenes = migrateLightingScenes([{ id: "legacy", externalControl: { widgetId: "9" }, custom: { retained: true } }]);
  assert.equal(scenes[0].available, true);
  assert.deepEqual(scenes[0].custom, { retained: true });
});

test("successful discovery marks identity-less legacy records for reconciliation without guessing", () => {
  const state = baseState();
  state.lightingScenes = [{ id: "legacy", name: "Welcome", available: true, externalControl: null }];
  reconcileLightingScenes(state, [button(1, "Welcome")], { now: 0 });
  assert.equal(state.lightingScenes.find(scene => scene.id === "legacy").available, false);
  assert.equal(state.lightingScenes.find(scene => scene.id === "legacy").reconciliationStatus, "needs-reconciliation");
  assert.equal(state.lightingScenes.find(scene => scene.qlcMirror?.widgetId === "1").available, true);
});

test("missing-function GO plan is safe and truthful", () => {
  const state = baseState();
  state.lightingScenes = [{ id: "missing", name: "Missing", available: false, qlcMirror: { widgetId: "4", name: "Invitation", available: false } }];
  const plan = buildCueExecutionPlan(state, { id: "cue", name: "Invitation", lightingSceneId: "missing" }, { resolvedAt: 1 });
  assert.equal(plan.lightingExecutions.length, 0);
  assert.equal(plan.lightingValidationErrors[0].state, "qlc-function-missing");
  assert.match(plan.warnings[0], /missing/i);
});

test("simulated A-to-B reconciliation preserves, adds, renames, and tombstones correctly", () => {
  const state = baseState();
  reconcileLightingScenes(state, [button(1, "Welcome"), button(2, "Worship"), button(3, "Sermon"), button(4, "Invitation")], { now: 0 });
  const scene = id => state.lightingScenes.find(item => item.qlcMirror.widgetId === String(id));
  state.productionLooks = [{ id: "sermon-look", name: "Sermon", lightingSceneId: scene(3).id }];
  state.runOfService = [{ id: "invitation-cue", name: "Invitation", lightingSceneId: scene(4).id }];
  const outcome = reconcileLightingScenes(state, [button(1, "Welcome"), button(2, "Worship Warm"), button(3, "Sermon Neutral"), button(5, "Communion")], { now: 1 });
  assert.deepEqual(outcome.summary.renamed.map(item => item.widgetId), ["2", "3"]);
  assert.deepEqual(outcome.summary.removed.map(item => item.widgetId), ["4"]);
  assert.deepEqual(outcome.summary.added.map(item => item.widgetId), ["5"]);
  assert.equal(state.productionLooks[0].lightingSceneId, scene(3).id);
  assert.equal(state.runOfService[0].lightingSceneId, scene(4).id);
  assert.equal(scene(4).available, false);
});

test("operator discovery saves and broadcasts only semantic successful changes", async () => {
  const widget = button(1, "Welcome");
  let current = baseState();
  reconcileLightingScenes(current, [widget], { now: 0 });
  current.devices[0].metadata.qlcplusWidgets = [widget];
  current.devices[0].metadata.qlcplusPages = [];
  let saveCount = 0;
  let publishCount = 0;
  let discovery = { ok: true, code: "qlcConnected", widgets: [{ ...widget }], pages: [], elapsedMs: 99 };
  const commands = createOperatorCommands({
    loadState: () => current,
    saveState: next => { saveCount += 1; current = next; return next; },
    lightingAdapters: { discoverControls: async () => discovery }
  });
  commands.subscribe(() => { publishCount += 1; });
  let outcome = await commands.discoverLightingControlsDetailed("qlc");
  assert.equal(outcome.changed, false);
  assert.equal(saveCount, 0);
  assert.equal(publishCount, 0);

  discovery = { ok: false, code: "connectionFailure", message: "offline" };
  outcome = await commands.discoverLightingControlsDetailed("qlc");
  assert.equal(outcome.changed, false);
  assert.equal(current.lightingScenes[0].available, true);
  assert.equal(saveCount, 0);

  discovery = { ok: true, code: "qlcConnected", widgets: [widget, button(2, "Worship")], pages: [] };
  outcome = await commands.discoverLightingControlsDetailed("qlc");
  assert.equal(outcome.changed, true);
  assert.equal(saveCount, 1);
  assert.equal(publishCount, 1);
});

test("portable backup preserves stable authoritative identity and tombstone metadata but not discovery cache", () => {
  const state = baseState();
  state.lightingScenes = [{
    id: "missing", name: "Invitation", available: false, authoritativeSource: "qlcplus",
    qlcMirror: { identityType: "widget-id", widgetId: "4", name: "Invitation", type: "Button", available: false, missingSince: "2026-01-01T00:00:00.000Z" },
    externalControl: { adapterType: "qlcplus-websocket", widgetId: "4" }
  }];
  state.devices[0].metadata.qlcplusWidgets = [button(1, "Welcome")];
  const portable = extractPortableState(state);
  assert.equal(portable.lightingScenes[0].qlcMirror.widgetId, "4");
  assert.equal(portable.lightingScenes[0].available, false);
  assert.equal(portable.devices[0].metadata.qlcplusWidgets, undefined);
});

test("desktop UI flags missing Looks and Cues, disables tombstone execution, and exposes explicit replacement", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(source, /Missing QLC\+ lighting function/);
  assert.match(source, /lighting\?\.available === false/);
  assert.match(source, /scene\.available === false \? '' : `data-select-lighting/);
  assert.match(source, /data-lighting-reference/);
  assert.match(source, /replaceLightingReferences\(selectedScene\.id, replacementSceneId, selection\)/);
  assert.match(source, /Lighting configuration changed/);
});
