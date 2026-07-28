"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createOperatorCommands } = require("../operator-commands.cjs");
const {
  duplicateLightingScene,
  filterLightingControls,
  lightingDiscoveryView,
  lightingMappingView,
  migrateLightingScenes,
  normalizeLightingScene,
  suggestLightingControl,
  updateLightingScene
} = require("../lighting-scene-operations.cjs");

const widgets = [
  { widgetId: "11", name: "Sermon", widgetType: "Button", status: "0", canActivateScene: true },
  { widgetId: "12", name: "Sunday", widgetType: "Button", status: "255", canActivateScene: true },
  { widgetId: "29", name: "Sunday", widgetType: "Button", status: "0", canActivateScene: true },
  { widgetId: "44", name: "House", widgetType: "Slider", status: "100", canActivateScene: false }
];

function device(patch = {}) {
  return {
    type: "lighting",
    adapterType: "qlcplus-websocket",
    metadata: { lightingDiagnostic: { ok: true }, qlcplusWidgets: widgets },
    ...patch
  };
}

test("legacy Lighting Scenes normalize deterministically with no mapping", () => {
  const source = { id: "sermon", name: "Sermon", customLegacy: "preserved" };
  const once = normalizeLightingScene(source);
  const twice = normalizeLightingScene(once);
  assert.equal(once.externalControl, null);
  assert.equal(once.customLegacy, "preserved");
  assert.deepEqual(twice, once);
  assert.deepEqual(migrateLightingScenes([source]), [once]);
});

test("valid mapping persists with widget ID authoritative and safe metadata only", () => {
  const state = { lightingScenes: [{ id: "sermon", name: "Sermon" }] };
  updateLightingScene(state, "sermon", {
    externalControl: {
      adapterType: "qlcplus-websocket", widgetId: "11", widgetName: "Old display name",
      widgetType: "Button", password: "excluded", authorization: "excluded"
    }
  });
  assert.deepEqual(state.lightingScenes[0].externalControl, {
    adapterType: "qlcplus-websocket", widgetId: "11", widgetName: "Old display name", widgetType: "Button"
  });
  updateLightingScene(state, "sermon", { externalControl: { ...state.lightingScenes[0].externalControl, widgetName: "Changed metadata" } });
  assert.equal(state.lightingScenes[0].externalControl.widgetId, "11");
});

test("duplicate widget names remain distinct by ID", () => {
  const view = lightingMappingView({ id: "scene", name: "Sunday" }, device());
  assert.deepEqual(view.controls.filter(item => item.name === "Sunday").map(item => item.widgetId), ["12", "29"]);
});

test("default discovery list contains buttons while show-all includes diagnostics", () => {
  const compatible = lightingMappingView({ id: "scene" }, device());
  const all = lightingMappingView({ id: "scene" }, device(), { showAll: true });
  assert.equal(compatible.totalCount, 4);
  assert.equal(compatible.compatibleCount, 3);
  assert.equal(compatible.controls.some(item => item.widgetType === "Slider"), false);
  assert.equal(all.controls.some(item => item.widgetType === "Slider"), true);
});

test("configured Production Page filters buttons without affecting diagnostic show-all", () => {
  const paged = widgets.map((widget, index) => ({ ...widget, pageName: index < 2 ? "Sunday Morning" : "Maintenance" }));
  assert.deepEqual(filterLightingControls(paged, { productionPage: "Sunday Morning" }).map(item => item.widgetId), ["11", "12"]);
  assert.equal(filterLightingControls(paged, { productionPage: "Sunday Morning", showAll: true }).length, 4);
  const view = lightingMappingView({}, device({
    metadata: { lightingDiagnostic: { ok: true }, qlcplusWidgets: paged, qlcplusProductionPage: "Sunday Morning" }
  }));
  assert.deepEqual(view.controls.map(item => item.widgetId), ["11", "12"]);
});

test("settings discovery view counts a page frame but renders only its scene-capable buttons", () => {
  const paged = [
    { widgetId: "1", name: "Sunday Morning", widgetType: "Frame", pageName: "Sunday Morning", canActivateScene: false },
    { widgetId: "2", name: "Sermon", widgetType: "Button", pageName: "Sunday Morning", canActivateScene: true },
    { widgetId: "3", name: "Worklights", widgetType: "Button", pageName: "Maintenance", canActivateScene: true }
  ];
  const view = lightingDiscoveryView(paged, { productionPage: "Sunday Morning", elapsedMs: 44 });
  assert.deepEqual(view.visibleWidgets.map(item => item.widgetId), ["2"]);
  assert.equal(view.pageButtonCount, 1);
  assert.equal(view.pageWidgetCount, 2);
  assert.equal(view.compatibleButtonCount, 2);
  assert.equal(view.totalWidgetCount, 3);
  assert.equal(view.elapsedMs, 44);
});

test("settings discovery show-all and no-page modes preserve every discovered widget", () => {
  const paged = [
    { widgetId: "1", widgetType: "Frame", pageName: "Sunday Morning", canActivateScene: false },
    { widgetId: "2", widgetType: "Button", pageName: "Sunday Morning", canActivateScene: true },
    { widgetId: "3", widgetType: "Button", pageName: "Maintenance", canActivateScene: true }
  ];
  const showAll = lightingDiscoveryView(paged, { productionPage: "Sunday Morning", showAll: true });
  const noPage = lightingDiscoveryView(paged);
  assert.deepEqual(showAll.visibleWidgets.map(item => item.widgetId), ["1", "2", "3"]);
  assert.deepEqual(noPage.visibleWidgets.map(item => item.widgetId), ["2", "3"]);
  assert.equal(noPage.compatibleButtonCount, 2);
});

test("settings discovery filtering is display-only and does not mutate source data or settings", () => {
  const source = [
    { widgetId: "1", widgetType: "Frame", pageName: "Sunday Morning", canActivateScene: false },
    { widgetId: "2", widgetType: "Button", pageName: "Sunday Morning", canActivateScene: true }
  ];
  const before = structuredClone(source);
  const settings = { qlcplusProductionPage: "Sunday Morning", mapping: { widgetId: "outside-page" } };
  const settingsBefore = structuredClone(settings);
  lightingDiscoveryView(source, { productionPage: settings.qlcplusProductionPage });
  lightingDiscoveryView(source, { productionPage: settings.qlcplusProductionPage, showAll: true });
  assert.deepEqual(source, before);
  assert.deepEqual(settings, settingsBefore);
});

test("clearing a mapping persists", () => {
  const state = { lightingScenes: [normalizeLightingScene({ id: "sermon", externalControl: { widgetId: "11" } })] };
  updateLightingScene(state, "sermon", { externalControl: null });
  assert.equal(state.lightingScenes[0].externalControl, null);
});

test("stale mapping remains stored and is not remapped by name", () => {
  const scene = normalizeLightingScene({
    id: "sermon", name: "Sermon",
    externalControl: { adapterType: "qlcplus-websocket", widgetId: "missing", widgetName: "Sermon", widgetType: "Button" }
  });
  const view = lightingMappingView(scene, device());
  assert.equal(view.status, "mapped-control-missing");
  assert.equal(view.mapping.widgetId, "missing");
  assert.equal(view.suggestion, null);
});

test("mapping readiness reports non-button, adapter, and reachability states", () => {
  const nonButton = normalizeLightingScene({ externalControl: { widgetId: "44" } });
  assert.equal(lightingMappingView(nonButton, device()).status, "mapped-control-not-button");
  assert.equal(lightingMappingView({}, device({ adapterType: null })).status, "adapter-not-configured");
  assert.equal(lightingMappingView({}, device({ metadata: { lightingDiagnostic: { ok: false }, qlcplusWidgets: widgets } })).status, "qlc-unreachable");
  assert.equal(lightingMappingView({ externalControl: { widgetId: "11" } }, device()).status, "mapped-valid");
});

test("exact and optional TRINITY prefix produce conservative suggestions", () => {
  assert.equal(suggestLightingControl({ name: "Sermon" }, [{ widgetId: "1", name: "TRINITY - Sermon", widgetType: "Button" }]).widgetId, "1");
  assert.equal(suggestLightingControl({ name: "Pre-Service" }, [{ widgetId: "2", name: "pre service", widgetType: "Button" }]).widgetId, "2");
});

test("ambiguous matches and existing mappings produce no suggestion", () => {
  assert.equal(suggestLightingControl({ name: "Sunday" }, widgets), null);
  assert.equal(suggestLightingControl({ name: "Sermon", externalControl: { widgetId: "stale" } }, widgets), null);
});

test("duplication clears external mapping while preserving unrelated scene values", () => {
  const state = { lightingScenes: [normalizeLightingScene({ id: "sermon", name: "Sermon", favorite: true, externalControl: { widgetId: "11" } })] };
  const copy = duplicateLightingScene(state, "sermon", { id: "copy" });
  assert.equal(copy.externalControl, null);
  assert.equal(copy.favorite, true);
  assert.equal(copy.name, "Sermon Copy");
});

test("mapping UI selects and saves without any activation command", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(renderer, /data-edit-lighting/);
  assert.match(renderer, /Previously mapped control not found — Widget ID/);
  assert.match(renderer, /updateLightingScene\(selectedScene\.id, \{ externalControl \}\)/);
  assert.doesNotMatch(renderer.slice(renderer.indexOf("function lightingPage"), renderer.indexOf("function camerasPage")), /activateControl/);
});

test("Lighting Settings refresh and diagnostic filtering remain read-only", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const settings = renderer.slice(renderer.indexOf("function settingsPage"), renderer.indexOf("function render()"));
  assert.match(settings, /id="qlc-discover-controls">REFRESH CONTROLS/);
  assert.doesNotMatch(settings, /id="qlc-discover-controls">DISCOVER CONTROLS/);
  assert.match(settings, /discoverLightingControls\(lightingDevice\.id\)/);
  assert.match(settings, /id="qlc-show-all-controls"/);
  assert.match(settings, /showAllDiscoveredLightingControls = event\.target\.checked;\s*render\(\)/);
  assert.match(settings, /widgets\.filter\(widget => widget\.pageName === productionPage\)/);
  assert.match(settings, /visibleWidgets = showAllDiscoveredLightingControls \? widgets : pageButtons/);
  assert.match(settings, /pageButtons\.length\} production buttons · \$\{pageWidgets\.length\} page widgets · \$\{widgets\.length\} total widgets · \$\{elapsedMs\} ms/);
  assert.match(settings, /'All QLC\+ Controls'.*`\$\{productionPage\} Controls` : 'Compatible QLC\+ Controls'/s);
  assert.doesNotMatch(settings, /<strong>\$\{visibleWidgets\.length\}<\/strong>/);
  assert.match(settings, /widget\.canActivateScene \? 'Scene-capable' : 'Read only'/);
  assert.match(settings, /widget\.pageName \|\| 'Page unavailable'/);
  assert.doesNotMatch(settings, /activateControl/);
});

test("cue execution remains independent of QLC+ mapping", () => {
  const execution = fs.readFileSync(path.join(__dirname, "..", "cue-execution.cjs"), "utf8");
  assert.doesNotMatch(execution, /externalControl|qlcplus|lighting-adapter/);
});

test("saving and duplicating mappings persist without calling a lighting adapter", async () => {
  let current = {
    lightingScenes: [{ id: "sermon", name: "Sermon" }],
    devices: [], cameraPresets: [], shots: [], productionLooks: [], runOfService: [], live: {}
  };
  const forbidden = async () => { throw new Error("mapping must not call adapter"); };
  const commands = createOperatorCommands({
    loadState: () => current,
    saveState: next => (current = next),
    lightingAdapters: { testConnection: forbidden, discoverControls: forbidden, activateControl: forbidden }
  });
  await commands.updateLightingScene("sermon", { externalControl: { widgetId: "11", widgetName: "Sermon", widgetType: "Button" } });
  assert.equal(current.lightingScenes[0].externalControl.widgetId, "11");
  await commands.duplicateLightingScene("sermon");
  assert.equal(current.lightingScenes[1].externalControl, null);
});
