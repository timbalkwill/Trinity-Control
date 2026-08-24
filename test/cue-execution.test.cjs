"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyLook, effectiveCueResources, executeCue, normalizeExecutionSnapshot } = require("../cue-execution.cjs");

function state() {
  return {
    lightingScenes: [{ id: "warm", name: "Warm" }, { id: "blue", name: "Blue" }],
    productionLooks: [{
      id: "look", name: "Sunday", enabled: true, lightingSceneId: "warm", lightingFadeMs: 750,
      cameraLayoutId: "layout", programCameraId: "right", previewCameraId: "left",
      selectedShotId: "shot", cameraAssignments: [{ role: "program", cameraId: "right", presetId: "tight", shotId: "shot" }],
      cameraPresets: { right: "tight" }, startMainTracking: true, motionEnabled: true
    }],
    runOfService: [
      { id: "one", name: "One", productionLookId: "look" },
      { id: "two", name: "Two", productionLookId: "look", lightingSceneId: "blue", cameraLayoutId: "layout" }
    ],
    live: {
      cueIndex: 0, programCamera: "main", previewCamera: "left", programPreset: "Manual",
      activeCameraAssignment: { cameraId: "main", presetId: "manual" },
      cameraPreparations: [{ cameraId: "right", selectedMode: "motion", tracking: { active: true } }],
      activityLog: []
    }
  };
}

const cameraState = current => JSON.parse(JSON.stringify({
  programCamera: current.live.programCamera,
  previewCamera: current.live.previewCamera,
  programPreset: current.live.programPreset,
  activeCameraAssignment: current.live.activeCameraAssignment,
  cameraPreparations: current.live.cameraPreparations
}));

test("GO advances service and applies cue lighting while preserving manual cameras", () => {
  const current = state();
  const before = cameraState(current);
  executeCue(current, 1, { now: () => 1234, cameraExecutor: () => { throw new Error("must not run"); } });
  assert.equal(current.live.cueIndex, 1);
  assert.equal(current.live.activeCueId, "two");
  assert.equal(current.live.lastLightingSceneId, "blue");
  assert.equal(current.live.executionSnapshot.lighting.sceneId, "blue");
  assert.deepEqual(cameraState(current), before);
});

test("BACK navigates service and applies inherited lighting with zero camera effects", () => {
  const current = state();
  current.live.cueIndex = 1;
  const before = cameraState(current);
  executeCue(current, 0, { now: () => 2000, cameraExecutor: () => { throw new Error("must not run"); } });
  assert.equal(current.live.cueIndex, 0);
  assert.equal(current.live.lastLightingSceneId, "warm");
  assert.deepEqual(cameraState(current), before);
});

test("frozen service snapshot contains no executable camera fields", () => {
  const current = state();
  executeCue(current, 0, { now: () => 5000 });
  const snapshot = current.live.executionSnapshot;
  assert.equal(snapshot.cueName, "One");
  assert.equal(snapshot.productionLookName, "Sunday");
  assert.equal(snapshot.executedAt, 5000);
  for (const key of ["video", "cameraAssignments", "cameras", "shotExecutions", "shotExecutionResults", "simplifiedLook", "motion"]) {
    assert.equal(Object.hasOwn(snapshot, key), false, key);
  }
});

test("lighting execution identity remains frozen across later Look edits", () => {
  const current = state();
  executeCue(current, 0, { now: () => 5000 });
  const frozen = JSON.stringify(current.live.executionSnapshot);
  current.productionLooks[0].lightingSceneId = "blue";
  current.productionLooks[0].cameraAssignments[0].cameraId = "main";
  assert.equal(JSON.stringify(current.live.executionSnapshot), frozen);
});

test("legacy camera references load safely and never produce execution warnings or instructions", () => {
  const current = state();
  current.productionLooks[0].cameraLayoutId = "missing-layout";
  current.productionLooks[0].selectedShotId = "missing-shot";
  executeCue(current, 0);
  assert.equal(current.live.executionSnapshot.warnings.some(item => /camera|shot|preset/i.test(item)), false);
  assert.equal(Object.hasOwn(current.live.executionSnapshot, "video"), false);
});

test("effective resources expose service-owned lighting only", () => {
  const current = state();
  assert.deepEqual(effectiveCueResources(current, current.runOfService[0]), { lightingSceneId: "warm" });
  assert.deepEqual(effectiveCueResources(current, current.runOfService[1]), { lightingSceneId: "blue" });
});

test("empty and malformed service state remains safe", () => {
  const empty = { runOfService: [], live: { marker: true } };
  assert.equal(executeCue(empty, 0), empty);
  const malformed = { runOfService: [{ id: "cue" }] };
  assert.doesNotThrow(() => executeCue(malformed, 0));
  assert.equal(malformed.live.activeCueId, "cue");
});

test("applying a Production Look changes lighting only", () => {
  const current = state();
  const before = cameraState(current);
  applyLook(current, "look");
  assert.equal(current.live.lastLightingSceneId, "warm");
  assert.deepEqual(cameraState(current), before);
  assert.equal(applyLook(current, "missing"), current);
});

test("legacy snapshots normalize camera instructions away while preserving unknown non-camera data", () => {
  const normalized = normalizeExecutionSnapshot({
    cueId: "old", video: { programCameraId: "right" }, cameraAssignments: [{}], shotExecutions: [{}],
    motion: { enabled: true }, futureField: { retained: true }
  });
  assert.equal(normalized.cueId, "old");
  assert.deepEqual(normalized.futureField, { retained: true });
  assert.equal(Object.hasOwn(normalized, "video"), false);
  assert.equal(Object.hasOwn(normalized, "shotExecutions"), false);
});
