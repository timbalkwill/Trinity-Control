"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { migrateVideoSources, normalizeVideoSource, updateVideoSwitchingSettings } = require("../video-source-operations.cjs");
const { createSwitcherAdapterRegistry } = require("../switcher-adapter-registry.cjs");
const { createVideoRouter } = require("../video-router.cjs");
const { createVideoTakeLive } = require("../video-take-live.cjs");
const { extractPortableState } = require("../backup-operations.cjs");

const source = filename => fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
function stateFixture() {
  const state = {
    settings: {}, devices: [
      { id: "main", type: "camera", name: "Main", logicalRole: "main" },
      { id: "left", type: "camera", name: "Left", logicalRole: "left" },
      { id: "right", type: "camera", name: "Right", logicalRole: "right" },
      { id: "atem", type: "switcher", adapterType: "atem", metadata: { atemCameraInputs: { main: 1, left: 2, right: 3 } } }
    ]
  };
  migrateVideoSources(state);
  return state;
}

function adapterHarness(initialInput = 1) {
  let programInput = initialInput;
  const calls = [];
  const transitions = [];
  const subscribers = new Set();
  const adapter = {
    getStatus: () => ({ name: "ATEM", enabled: true, configured: true, connectionState: "connected", programInput }),
    takeSource: async (mapping, options) => { calls.push(mapping.input); transitions.push(options.transition); programInput = mapping.input; for (const fn of subscribers) fn(); },
    subscribe: fn => { subscribers.add(fn); return () => subscribers.delete(fn); }
  };
  return { adapter, calls, transitions, physical(input) { programInput = input; for (const fn of subscribers) fn(); } };
}

test("migration creates stable logical camera and Presentation sources with preserved ATEM inputs", () => {
  const state = stateFixture();
  assert.deepEqual(state.videoSources.map(item => item.id), ["source-main-camera", "source-left-camera", "source-right-camera", "source-presentation"]);
  assert.deepEqual(state.videoSources.slice(0, 3).map(item => item.cameraDeviceId), ["main", "left", "right"]);
  assert.equal(state.videoSources.find(item => item.id === "source-presentation").sourceType, "video");
  assert.deepEqual(state.videoSources.map(item => item.switcherMappings.atem.input), [1, 2, 3, 4]);
  assert.equal(state.settings.activeSwitcherBackend, "atem");
  assert.equal(state.settings.videoSwitching.defaultTransition, "mix");
  const again = JSON.stringify(state.videoSources);
  migrateVideoSources(state);
  assert.equal(JSON.stringify(state.videoSources), again);
});

test("migration does not silently claim ATEM input 4 when an existing camera uses it", () => {
  const state = stateFixture();
  delete state.videoSources;
  state.devices.at(-1).metadata.atemCameraInputs.main = 4;
  migrateVideoSources(state);
  const presentation = state.videoSources.find(item => item.id === "source-presentation");
  assert.equal(presentation.switcherMappings.atem.input, null);
  assert.equal(presentation.needsReview, true);
});

test("router resolves source mapping and reverse-maps authoritative PROGRAM identity", async () => {
  const state = stateFixture();
  const harness = adapterHarness(1);
  const registry = createSwitcherAdapterRegistry({ atem: harness.adapter });
  const router = createVideoRouter({ getState: () => state, adapters: registry });
  assert.equal(router.getStatus().liveSourceId, "source-main-camera");
  await router.takeSource("source-presentation");
  assert.deepEqual(harness.calls, [4]);
  assert.deepEqual(harness.transitions, ["mix"]);
  assert.equal(router.getStatus().liveSourceId, "source-presentation");
  assert.equal(router.getStatus().liveSourceName, "Presentation");
  assert.notEqual(router.getStatus().liveSourceId, "source-main-camera");
});

test("generic router defaults to Mix, preserves explicit Cut, and passes intent to a future adapter", async () => {
  const state = stateFixture();
  const future = adapterHarness(9);
  state.settings.activeSwitcherBackend = "vmix";
  state.videoSources[0].switcherMappings.vmix = { input: 10 };
  const router = createVideoRouter({ getState: () => state, adapters: createSwitcherAdapterRegistry({ vmix: future.adapter }) });
  await router.takeSource("source-main-camera");
  assert.deepEqual(future.transitions, ["mix"]);
  future.physical(9);
  await router.takeSource("source-main-camera", { transition: "cut" });
  assert.deepEqual(future.transitions, ["mix", "cut"]);
});

test("Default Transition setting persists only supported generic modes", () => {
  const state = stateFixture();
  updateVideoSwitchingSettings(state, { defaultTransition: "cut" });
  assert.equal(state.settings.videoSwitching.defaultTransition, "cut");
  assert.throws(() => updateVideoSwitchingSettings(state, { defaultTransition: "wipe" }), /Mix or Cut/);
  const renderer = source("public/app.js");
  assert.match(renderer, /Default Transition/);
  assert.match(renderer, /updateVideoSwitchingSettings/);
  assert.match(source("preload.cjs"), /video-switcher:update-settings/);
  assert.match(source("electron-main.cjs"), /video-switcher:update-settings/);
});

test("missing mappings fail safely and another adapter can register without router or UI changes", async () => {
  const state = stateFixture();
  state.videoSources[3].switcherMappings.atem.input = null;
  const registry = createSwitcherAdapterRegistry({ atem: adapterHarness().adapter });
  const router = createVideoRouter({ getState: () => state, adapters: registry });
  await assert.rejects(router.takeSource("source-presentation"), error => error.code === "SOURCE_MAPPING_MISSING");
  const future = adapterHarness(9).adapter;
  registry.register("vmix", future);
  assert.equal(registry.resolve("vmix"), future);
});

test("Presentation Take Live executes no PTZ, Motion, or lighting and preserves camera preparation", async () => {
  const state = stateFixture();
  const harness = adapterHarness(1);
  const router = createVideoRouter({ getState: () => state, adapters: createSwitcherAdapterRegistry({ atem: harness.adapter }) });
  let motionCalls = 0;
  const prepared = { left: { shotId: "left-motion" } };
  const commands = {
    getPreparedMotion: cameraId => prepared[cameraId] || null,
    setPreparedMotionStatus: async () => {},
    runCameraMotion: async () => { motionCalls += 1; }
  };
  const transaction = createVideoTakeLive({ commands, videoRouter: router });
  const result = await transaction.takeSource("source-presentation");
  assert.equal(result.motion, null);
  assert.equal(motionCalls, 0);
  assert.ok(prepared.left);
  assert.deepEqual(harness.calls, [4]);
});

test("later camera Take consumes only its prepared Motion after authoritative confirmation", async () => {
  const state = stateFixture();
  const harness = adapterHarness(4);
  const router = createVideoRouter({ getState: () => state, adapters: createSwitcherAdapterRegistry({ atem: harness.adapter }) });
  let prepared = { shotId: "left-motion" };
  let motionCalls = 0;
  const commands = {
    getPreparedMotion: cameraId => cameraId === "left" ? prepared : null,
    setPreparedMotionStatus: async () => {},
    runCameraMotion: async cameraId => { assert.equal(router.getStatus().liveSourceId, "source-left-camera"); assert.equal(cameraId, "left"); motionCalls += 1; prepared = null; return {}; }
  };
  const transaction = createVideoTakeLive({ commands, videoRouter: router });
  await transaction.takeSource("source-left-camera");
  assert.deepEqual(harness.calls, [2]);
  assert.equal(motionCalls, 1);
});

test("physical Presentation changes publish LIVE identity but cannot trigger prepared Motion", () => {
  const state = stateFixture();
  const harness = adapterHarness(1);
  const router = createVideoRouter({ getState: () => state, adapters: createSwitcherAdapterRegistry({ atem: harness.adapter }) });
  let updates = 0;
  router.subscribe(() => { updates += 1; });
  router.bindAdapter("atem");
  harness.physical(4);
  assert.equal(router.getStatus().liveSourceId, "source-presentation");
  assert.equal(updates, 1);
});

test("portable backup preserves source configuration and excludes runtime PROGRAM", () => {
  const state = stateFixture();
  state.live = { programInput: 4, liveSourceId: "source-presentation" };
  const portable = extractPortableState(state);
  assert.deepEqual(portable.videoSources, state.videoSources);
  assert.equal(portable.settings.activeSwitcherBackend, "atem");
  assert.equal(portable.live, undefined);
});

test("desktop and iPad operate by Video Source ID and give Presentation no PTZ controls", () => {
  const desktop = source("public/app.js");
  const ipad = source("public/operator/operator.js");
  const server = source("operator-server.cjs");
  assert.match(desktop, /data-take-video-source/);
  assert.match(desktop, /window\.trinity\.takeVideoSource/);
  assert.match(ipad, /sourceType === "video"/);
  assert.match(ipad, /\/api\/video-sources\/take-live/);
  assert.match(server, /takeVideoSource\(body\.videoSourceId\)/);
  const presentationBlock = ipad.slice(ipad.indexOf('class="presentation-source'), ipad.indexOf('<div class="camera-grid'));
  assert.doesNotMatch(presentationBlock, /PRESETS|MOTION|camera status/i);
  for (const role of ["main", "left", "right"]) assert.match(ipad, new RegExp(`"${role}"`));
});

test("GO, BACK, and Production Looks remain isolated from Video Router", () => {
  for (const file of ["cue-execution.cjs", "cue-execution-plan.cjs", "production-look-operations.cjs"]) {
    assert.doesNotMatch(source(file), /videoRouter|takeVideoSource|takeSource\(/);
  }
});

test("Video source normalization never links VIDEO sources to cameras", () => {
  const source = normalizeVideoSource({ id: "source-presentation", sourceType: "video", cameraDeviceId: "main" });
  assert.equal(source.cameraDeviceId, null);
});
