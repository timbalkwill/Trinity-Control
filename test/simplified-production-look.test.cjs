const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { executeCue } = require("../cue-execution.cjs");
const { makeCameraLive, prepareCamera, setCameraTracking } = require("../camera-preparation-operations.cjs");
const { projectBrowserState } = require("../device-operations.cjs");

const clone = value => JSON.parse(JSON.stringify(value));
function state() {
  return {
    devices: [
      { id: "main", type: "camera", name: "Main Camera", logicalRole: "main", enabled: true, trackingEnabled: true },
      { id: "left", type: "camera", name: "Left Camera", logicalRole: "left", enabled: true },
      { id: "right", type: "camera", name: "Right Camera", logicalRole: "right", enabled: true }
    ],
    cameras: [],
    cameraPresets: [
      { id: "main-wide", name: "Main Wide", cameraDeviceId: "main", enabled: true },
      { id: "left-tight", name: "Left Tight", cameraDeviceId: "left", enabled: true },
      { id: "right-wide", name: "Right Wide", cameraDeviceId: "right", enabled: true }
    ],
    shots: [],
    lightingScenes: [{ id: "warm", name: "Warm" }, { id: "blue", name: "Blue" }],
    cameraLayouts: [],
    productionLooks: [{
      schemaVersion: 3, id: "look", name: "Welcome", enabled: true, lightingSceneId: "warm",
      cameraPresets: {
        main: { cameraId: "main", presetId: "main-wide" },
        left: { cameraId: "left", presetId: "left-tight" },
        right: { cameraId: "right", presetId: "right-wide" }
      },
      priorityCameraId: "left", startMainTracking: true,
      createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z"
    }],
    runOfService: [{ id: "cue", name: "Cue", productionLookId: "look" }],
    live: { cueIndex: 0, programCamera: "main", previewCamera: "right", activityLog: [] }
  };
}

test("simplified Look cue start prepares three static presets, makes priority live, and tracks Main off-air", () => {
  const current = state();
  executeCue(current, 0, { now: () => 100 });
  assert.equal(current.live.lastLightingSceneId, "warm");
  assert.equal(current.live.programCamera, "left");
  assert.deepEqual(current.live.cameraPreparations.map(item => [item.cameraId, item.selectedMode, item.selectedPresetId, item.selectedMotionId]), [
    ["main", "static", "main-wide", null],
    ["left", "static", "left-tight", null],
    ["right", "static", "right-wide", null]
  ]);
  assert.equal(current.live.cameraPreparations.find(item => item.cameraId === "main").tracking.active, true);
  assert.equal(current.live.activeCameraAssignment.presetName, "Left Tight");
  assert.equal(current.live.executionSnapshot.simplifiedLook.priorityCameraId, "left");
  assert.equal(current.live.executionSnapshot.simplifiedLook.appliedMainTracking, true);
  assert.equal(current.live.executionSnapshot.cameraAssignments.find(item => item.role === "main").presetName, "Main Wide");
});

test("tracking false deterministically stops Main and invalid priority preserves PROGRAM with warnings", () => {
  const current = state();
  current.productionLooks[0].startMainTracking = false;
  current.productionLooks[0].priorityCameraId = "missing";
  current.live.cameraPreparations = [{
    cameraId: "main", selectedMode: "static", selectedPresetId: null, selectedMotionId: null,
    preparationStatus: "idle", tracking: { supported: true, active: true }
  }];
  executeCue(current, 0);
  assert.equal(current.live.programCamera, "main");
  assert.equal(current.live.cameraPreparations.find(item => item.cameraId === "main").tracking.active, false);
  assert.match(current.live.executionSnapshot.warnings.join("; "), /priority camera/i);
});

test("disabled Look warns and preserves safe live resources", () => {
  const current = state();
  current.productionLooks[0].enabled = false;
  current.live.lastLightingSceneId = "blue";
  executeCue(current, 0);
  assert.equal(current.live.programCamera, "main");
  assert.equal(current.live.lastLightingSceneId, null);
  assert.match(current.live.executionSnapshot.warnings.join("; "), /disabled/i);
});

test("invalid preset warns without changing that camera preparation or starting motion", () => {
  const current = state();
  current.productionLooks[0].cameraPresets.right.presetId = "missing";
  executeCue(current, 0);
  const right = current.live.cameraPreparations.find(item => item.cameraId === "right");
  assert.equal(right.selectedPresetId, null);
  assert.equal(right.motionRunCount, 0);
  assert.match(current.live.executionSnapshot.warnings.join("; "), /Right preset/i);
});

test("manual actions after cue start preserve the frozen execution snapshot", () => {
  const current = state();
  executeCue(current, 0, { now: () => 1 });
  const frozen = clone(current.live.executionSnapshot);
  makeCameraLive(current, "right", { now: () => 2 });
  setCameraTracking(current, "main", false);
  prepareCamera(current, "main", "main-wide", { now: () => 3 });
  assert.deepEqual(current.live.executionSnapshot, frozen);
});

test("Browser projection exposes frozen safe Look start summaries but not mutable Looks", () => {
  const current = state();
  current.devices[0].configuration = { password: "secret" };
  executeCue(current, 0);
  const projected = projectBrowserState(current);
  assert.deepEqual(projected.productionLooks[0], { id: "look", name: "Welcome", enabled: true });
  assert.equal(projected.live.executionSnapshot.simplifiedLook.priorityCameraName, "Left Camera");
  assert.equal(projected.live.executionSnapshot.simplifiedLook.appliedMainTracking, true);
  assert.doesNotMatch(JSON.stringify(projected), /secret/);
});

test("desktop Looks editor exposes only simplified fields and uses narrow save", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const looksPage = renderer.slice(renderer.indexOf("function looksPage()"), renderer.indexOf("function lightingPage()"));
  assert.match(looksPage, /Lighting Scene/);
  assert.match(looksPage, /\$\{label\} Camera Preset/);
  assert.match(looksPage, /\['main', 'left', 'right'\]\.map\(presetEditor\)/);
  assert.match(looksPage, /Priority Camera/);
  assert.match(looksPage, /Start Main Camera Tracking/);
  assert.match(looksPage, /window\.trinity\.updateProductionLook/);
  assert.doesNotMatch(looksPage, />Shot</);
  assert.doesNotMatch(looksPage, /PROGRAM|PREVIEW|AUXILIARY|Motion profile|Audio scene|Presentation cue/);
});


test("cue execution repairs stale camera IDs from valid role-scoped preset IDs", () => {
  const current = state();
  current.productionLooks[0].priorityCameraId = "right";
  current.productionLooks[0].cameraPresets = {
    main: { cameraId: "right", presetId: "main-wide" },
    left: { cameraId: "main", presetId: "left-tight" },
    right: { cameraId: "left", presetId: "right-wide" }
  };
  current.live.cameraPreparations = [
    { cameraId: "main", selectedMode: "static", selectedPresetId: null, selectedMotionId: null, preparationStatus: "idle", preparedAssignment: null, tracking: { supported: true, active: false } },
    { cameraId: "left", selectedMode: "static", selectedPresetId: null, selectedMotionId: null, preparationStatus: "idle", preparedAssignment: null, tracking: { supported: false, active: false } },
    { cameraId: "right", selectedMode: "static", selectedPresetId: null, selectedMotionId: null, preparationStatus: "idle", preparedAssignment: null, tracking: { supported: false, active: false } }
  ];

  executeCue(current, 0, { now: () => 300 });

  assert.deepEqual(current.live.cameraPreparations.map(item => [item.cameraId, item.selectedPresetId, item.preparedAssignment?.presetName]), [
    ["main", "main-wide", "Main Wide"],
    ["left", "left-tight", "Left Tight"],
    ["right", "right-wide", "Right Wide"]
  ]);
  assert.deepEqual(current.live.executionSnapshot.simplifiedLook.cameraPresets, {
    main: { cameraId: "main", cameraName: "Main Camera", presetId: "main-wide", presetName: "Main Wide", source: "production-look", missing: false },
    left: { cameraId: "left", cameraName: "Left Camera", presetId: "left-tight", presetName: "Left Tight", source: "production-look", missing: false },
    right: { cameraId: "right", cameraName: "Right Camera", presetId: "right-wide", presetName: "Right Wide", source: "production-look", missing: false }
  });
  assert.equal(current.live.programCamera, "right");
  assert.equal(current.live.activeCameraAssignment.presetName, "Right Wide");
});
test("simplified role presets override stale preparation and legacy cue layout presets", () => {
  const current = state();
  current.cameraPresets.push(
    { id: "main-old", name: "Stage Left", cameraDeviceId: "main", enabled: true },
    { id: "left-old", name: "Pulpit Tight", cameraDeviceId: "left", enabled: true },
    { id: "right-old", name: "Pulpit Tight", cameraDeviceId: "right", enabled: true }
  );
  current.cameraLayouts = [{
    id: "legacy-layout",
    name: "Legacy Welcome",
    programCamera: "right",
    programPreset: "Pulpit Tight",
    previewCamera: "left",
    previewPreset: "Pulpit Tight"
  }];
  current.runOfService[0].cameraLayoutId = "legacy-layout";
  current.live.cameraPreparations = [
    { cameraId: "main", selectedMode: "static", selectedPresetId: "main-old", selectedMotionId: null, preparationStatus: "ready", preparedAssignment: { presetId: "main-old", presetName: "Stage Left" }, tracking: { supported: true, active: false } },
    { cameraId: "left", selectedMode: "static", selectedPresetId: "left-old", selectedMotionId: null, preparationStatus: "ready", preparedAssignment: { presetId: "left-old", presetName: "Pulpit Tight" }, tracking: { supported: false, active: false } },
    { cameraId: "right", selectedMode: "static", selectedPresetId: "right-old", selectedMotionId: null, preparationStatus: "ready", preparedAssignment: { presetId: "right-old", presetName: "Pulpit Tight" }, tracking: { supported: false, active: false } }
  ];

  executeCue(current, 0, { now: () => 200 });

  assert.deepEqual(current.live.cameraPreparations.map(item => [item.cameraId, item.selectedPresetId, item.preparedAssignment?.presetName]), [
    ["main", "main-wide", "Main Wide"],
    ["left", "left-tight", "Left Tight"],
    ["right", "right-wide", "Right Wide"]
  ]);
  assert.equal(current.live.programCamera, "right");
  assert.equal(current.live.activeCameraAssignment.presetId, "right-wide");
  assert.equal(current.live.activeCameraAssignment.presetName, "Right Wide");
});
