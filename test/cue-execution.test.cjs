const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyLook,
  effectiveCueResources,
  executeCue
} = require("../cue-execution.cjs");

function state() {
  return {
    lightingScenes: [
      { id: "light-default", name: "Warm" },
      { id: "light-override", name: "Blue" }
    ],
    productionLooks: [{
      id: "look-default",
      name: "Sunday Look",
      lightingSceneId: "light-default",
      cameraLayoutId: "camera-default",
      lightingFadeMs: 750,
      stageWashMode: "Warm",
      wallWashMode: "Blue",
      motionEnabled: true,
      motionSpeed: 0.5
    }],
    cameraLayouts: [
      {
        id: "camera-default",
        name: "Default Layout",
        programCamera: "main",
        programPreset: "Wide",
        previewCamera: "left",
        previewPreset: "Left",
        tracking: false
      },
      {
        id: "camera-override",
        name: "Override Layout",
        programCamera: "right",
        programPreset: "Tight",
        previewCamera: "main",
        previewPreset: "Wide",
        tracking: true
      }
    ],
    cameras: [
      { id: "main", name: "Main Camera" },
      { id: "left", name: "Left Camera" },
      { id: "right", name: "Right Camera" }
    ],
    runOfService: [
      { id: "legacy", name: "Legacy cue", productionLookId: "look-default" },
      {
        id: "custom",
        name: "Custom cue",
        productionLookId: "look-default",
        lightingSceneId: "light-override",
        cameraLayoutId: "camera-override"
      }
    ],
    live: {
      cueIndex: 0,
      hold: true,
      lightingOverrideId: "manual-light",
      activityLog: []
    }
  };
}

test("valid cue resources override the Production Look", () => {
  const result = executeCue(state(), 1, { now: () => 1234 });

  assert.equal(result.live.cueIndex, 1);
  assert.equal(result.live.cueStartedAt, 1234);
  assert.equal(result.live.lastLightingSceneId, "light-override");
  assert.equal(result.live.lightingOverrideId, null);
  assert.equal(result.live.programCamera, "right");
  assert.equal(result.live.programPreset, "Tight");
  assert.equal(result.live.previewCamera, "main");
  assert.equal(result.live.previewPreset, "Wide");
  assert.equal(result.live.tracking, true);
  assert.equal(result.live.hold, true);
  assert.equal(result.live.activeCueId, "custom");
  assert.equal(result.live.activeProductionLookId, "look-default");
  assert.equal(result.live.executionSnapshot.productionLookName, "Sunday Look");
  assert.equal(result.live.executionSnapshot.lighting.sceneName, "Blue");
  assert.equal(result.live.executionSnapshot.lighting.source, "Cue Override");
  assert.equal(result.live.executionSnapshot.video.programCameraName, "Right Camera");
  assert.equal(result.live.executionSnapshot.video.source, "Cue Override");
});

test("executed Production Look snapshot includes inherited live display fields", () => {
  const current = state();
  const result = executeCue(current, 0, { now: () => 5000 });
  const snapshot = result.live.executionSnapshot;
  assert.equal(snapshot.cueName, "Legacy cue");
  assert.equal(snapshot.productionLookName, "Sunday Look");
  assert.deepEqual(snapshot.lighting, {
    sceneId: "light-default",
    sceneName: "Warm",
    fadeMs: 750,
    stageWashMode: "Warm",
    wallWashMode: "Blue",
    source: "From Production Look"
  });
  assert.equal(snapshot.video.programCameraName, "Main Camera");
  assert.equal(snapshot.video.previewCameraName, "Left Camera");
  assert.equal(snapshot.video.cameraLayoutName, "Default Layout");
  assert.equal(snapshot.motion.enabled, true);
  assert.equal(snapshot.executedAt, 5000);
});

test("modern camera assignments populate authoritative execution snapshot and Live state", () => {
  const current = state();
  current.cameraPresets = [{ id: "wide-id", name: "Wide preset" }, { id: "tight-id", name: "Tight preset" }];
  current.productionLooks[0] = {
    ...current.productionLooks[0],
    cameraLayoutId: null,
    programCameraId: null,
    previewCameraId: null,
    cameraAssignments: [
      { role: "PROGRAM", cameraId: "right", presetId: "tight-id" },
      { role: "PREVIEW", cameraId: "left", presetId: "wide-id" },
      { role: "AUX", cameraId: "main", presetId: null }
    ]
  };
  executeCue(current, 0, { now: () => 6000 });
  assert.equal(current.live.programCamera, "right");
  assert.equal(current.live.previewCamera, "left");
  assert.deepEqual(current.live.auxiliaryCameras, ["main"]);
  assert.equal(current.live.executionSnapshot.video.programCameraName, "Right Camera");
  assert.equal(current.live.executionSnapshot.video.previewCameraName, "Left Camera");
  assert.equal(current.live.executionSnapshot.cameraAssignments[0].presetName, "Tight preset");
  assert.equal(current.live.executionSnapshot.video.source, "From Production Look");
});

test("Live camera roles are based on stable snapshot IDs and survive library reordering", () => {
  const current = state();
  executeCue(current, 1, { now: () => 7000 });
  require("../public/production-look-view.js");
  current.cameras.reverse();
  assert.equal(globalThis.TrinityLookView.cameraRole(current, "right"), "program");
  assert.equal(globalThis.TrinityLookView.cameraRole(current, "main"), "preview");
  assert.equal(globalThis.TrinityLookView.cameraRole(current, "left"), "idle");
});

test("editing camera assignments does not change Live roles until re-execution", () => {
  const current = state();
  current.productionLooks[0].cameraAssignments = [
    { role: "program", cameraId: "main" },
    { role: "preview", cameraId: "left" }
  ];
  executeCue(current, 0, { now: () => 1 });
  require("../public/production-look-view.js");
  current.productionLooks[0].cameraAssignments = [
    { role: "program", cameraId: "right" },
    { role: "preview", cameraId: "main" }
  ];
  assert.equal(globalThis.TrinityLookView.cameraRole(current, "main"), "program");
  assert.equal(globalThis.TrinityLookView.cameraRole(current, "right"), "idle");
  executeCue(current, 0, { now: () => 2 });
  assert.equal(globalThis.TrinityLookView.cameraRole(current, "right"), "program");
  assert.equal(globalThis.TrinityLookView.cameraRole(current, "main"), "preview");
});

test("editing inactive or active Looks does not alter executed state until re-execution", () => {
  const current = state();
  current.productionLooks.push({ id: "inactive", name: "Inactive", lightingSceneId: "light-override" });
  executeCue(current, 0, { now: () => 1 });
  const executed = JSON.stringify(current.live.executionSnapshot);
  current.productionLooks.find(look => look.id === "inactive").name = "Inactive Edited";
  assert.equal(JSON.stringify(current.live.executionSnapshot), executed);
  current.productionLooks[0].name = "Sunday Look Edited";
  current.productionLooks[0].lightingSceneId = "light-override";
  assert.equal(JSON.stringify(current.live.executionSnapshot), executed);
  executeCue(current, 0, { now: () => 2 });
  assert.equal(current.live.executionSnapshot.productionLookName, "Sunday Look Edited");
  assert.equal(current.live.executionSnapshot.lighting.sceneName, "Blue");
});

test("missing Look, lighting, and camera references are snapshotted as warnings", () => {
  const current = state();
  current.runOfService.push({ id: "missing", name: "Missing", productionLookId: "gone", lightingSceneId: "gone-light", cameraLayoutId: "gone-layout" });
  executeCue(current, 2, { now: () => 10 });
  assert.equal(current.live.executionSnapshot.productionLookId, "gone");
  assert.equal(current.live.executionSnapshot.lighting.source, "Missing reference");
  assert.equal(current.live.executionSnapshot.video.source, "Missing reference");
  assert.ok(current.live.executionSnapshot.warnings.some(warning => warning.includes("Missing Production Look")));
  assert.ok(current.live.executionSnapshot.warnings.some(warning => warning.includes("lighting")));
  assert.ok(current.live.executionSnapshot.warnings.some(warning => warning.includes("camera layout")));
});

test("Live summary reads the executed snapshot instead of subsequently edited Look data", () => {
  const current = state();
  executeCue(current, 0, { now: () => 1 });
  require("../public/production-look-view.js");
  current.productionLooks[0].name = "Edited without execution";
  current.productionLooks[0].lightingSceneId = "light-override";
  const summary = globalThis.TrinityLookView.summarize(current, current.runOfService[0]);
  assert.equal(summary.name, "Sunday Look");
  assert.equal(summary.lighting, "Warm");
  assert.equal(summary.programCamera, "Main Camera");
  assert.equal(summary.lightingSource, "From Production Look");
  assert.equal(summary.executed, true);
});

test("legacy cues with missing override fields inherit Production Look resources", () => {
  const legacyState = state();
  const resources = effectiveCueResources(legacyState, legacyState.runOfService[0]);

  assert.deepEqual(resources, {
    lightingSceneId: "light-default",
    cameraLayoutId: "camera-default"
  });
});

test("empty-string overrides inherit Production Look resources", () => {
  const current = state();
  const cue = {
    productionLookId: "look-default",
    lightingSceneId: "",
    cameraLayoutId: ""
  };

  assert.deepEqual(effectiveCueResources(current, cue), {
    lightingSceneId: "light-default",
    cameraLayoutId: "camera-default"
  });
});

test("invalid cue lighting falls back to Production Look lighting", () => {
  const current = state();
  const cue = { productionLookId: "look-default", lightingSceneId: "missing-light" };
  assert.equal(effectiveCueResources(current, cue).lightingSceneId, "light-default");
});

test("invalid cue camera layout falls back to Production Look camera layout", () => {
  const current = state();
  const cue = { productionLookId: "look-default", cameraLayoutId: "missing-camera" };
  assert.equal(effectiveCueResources(current, cue).cameraLayoutId, "camera-default");
});

test("invalid cue and Production Look resource IDs resolve to null", () => {
  const current = state();
  current.productionLooks[0].lightingSceneId = "missing-look-light";
  current.productionLooks[0].cameraLayoutId = "missing-look-camera";
  const cue = {
    productionLookId: "look-default",
    lightingSceneId: "missing-cue-light",
    cameraLayoutId: "missing-cue-camera"
  };

  assert.deepEqual(effectiveCueResources(current, cue), {
    lightingSceneId: null,
    cameraLayoutId: null
  });
  assert.deepEqual(effectiveCueResources(current, {
    productionLookId: "missing-look",
    lightingSceneId: "missing-cue-light",
    cameraLayoutId: "missing-cue-camera"
  }), {
    lightingSceneId: null,
    cameraLayoutId: null
  });
});

for (const [command, targetIndex] of [
  ["GO", () => 1],
  ["NEXT", current => current.live.cueIndex + 1],
  ["BACK", current => current.live.cueIndex - 1]
]) {
  test(`${command} clears an existing manual lighting override`, () => {
    const current = state();
    if (command === "BACK") current.live.cueIndex = 1;
    const result = executeCue(current, targetIndex(current), { now: () => 1 });
    assert.equal(result.live.lightingOverrideId, null);
  });
}

test("an empty run of service does not throw or replace state", () => {
  const current = state();
  current.runOfService = [];
  const result = executeCue(current, 0);
  assert.equal(result, current);
  assert.equal(result.live.lightingOverrideId, "manual-light");
});

test("a missing cue and missing resource arrays are handled safely", () => {
  const current = { runOfService: new Array(1), live: { hold: true } };
  const result = executeCue(current, 0);
  assert.equal(result, current);
  assert.deepEqual(result.live, { hold: true });
});

test("cue execution initializes missing live state without replacing the state object", () => {
  const current = state();
  delete current.live;
  const result = executeCue(current, 0, { now: () => 2 });
  assert.equal(result, current);
  assert.equal(result.live.lastLightingSceneId, "light-default");
  assert.equal(result.live.lightingOverrideId, null);
});

test("Production Look compatibility execution applies resources and clears manual lighting", () => {
  const current = state();
  const result = applyLook(current, "look-default");
  assert.equal(result, current);
  assert.equal(result.live.lastLightingSceneId, "light-default");
  assert.equal(result.live.lightingOverrideId, null);
  assert.equal(result.live.programCamera, "main");
  assert.equal(result.live.programPreset, "Wide");
});

test("Production Look compatibility execution safely ignores a missing look", () => {
  const current = state();
  const live = { ...current.live };
  const result = applyLook(current, "missing-look");
  assert.equal(result, current);
  assert.deepEqual(result.live, live);
});
