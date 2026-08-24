"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { executeCue, normalizeExecutionSnapshot, applyLook } = require("../cue-execution.cjs");
const { buildCueExecutionPlan } = require("../cue-execution-plan.cjs");

function fixture() {
  return {
    lightingScenes: [{ id: "warm", name: "Warm" }],
    productionLooks: [{
      id: "look", name: "Legacy camera Look", lightingSceneId: "warm",
      cameraLayoutId: "layout", programCameraId: "right", previewCameraId: "left",
      selectedShotId: "shot", cameraAssignments: [{ role: "program", cameraId: "right", shotId: "shot", presetId: "preset" }],
      cameraPresets: { right: "preset" }, startMainTracking: true, motionEnabled: true
    }],
    runOfService: [
      { id: "one", name: "One", productionLookId: "look", cameraLayoutId: "layout", selectedShotId: "shot" },
      { id: "two", name: "Two", productionLookId: "look" }
    ],
    devices: [{ id: "right", type: "camera", name: "Right" }],
    cameras: [{ id: "right", name: "Right" }],
    cameraLayouts: [{ id: "layout", programCamera: "right" }],
    cameraPresets: [{ id: "preset", cameraDeviceId: "right", name: "Tight" }],
    shots: [{ id: "shot", cameraDeviceId: "right", cameraPresetId: "preset", type: "static" }],
    live: {
      cueIndex: 0, programCamera: "main", previewCamera: "left", programPreset: "Manual Wide",
      activeCameraAssignment: { cameraId: "main", presetId: "manual" },
      cameraPreparations: [{ cameraId: "right", selectedMode: "motion", selectedMotionId: "manual-motion", preparationStatus: "ready", tracking: { supported: true, active: true } }]
    }
  };
}

function cameraState(state) {
  return JSON.parse(JSON.stringify({
    programCamera: state.live.programCamera,
    previewCamera: state.live.previewCamera,
    programPreset: state.live.programPreset,
    activeCameraAssignment: state.live.activeCameraAssignment,
    cameraPreparations: state.live.cameraPreparations
  }));
}

test("service plans and frozen snapshots contain no camera execution instructions", () => {
  const state = fixture();
  const plan = buildCueExecutionPlan(state, state.runOfService[0], { resolvedAt: 10 });
  for (const key of ["video", "cameraAssignments", "cameras", "shotExecutions", "shotValidationErrors", "simplifiedLook", "motion"]) {
    assert.equal(Object.hasOwn(plan, key), false, key);
  }
  executeCue(state, 0, { now: () => 10, cameraExecutor: () => { throw new Error("camera executor must not be called"); } });
  for (const key of ["video", "cameraAssignments", "cameras", "shotExecutions", "shotValidationErrors", "shotExecutionResults", "simplifiedLook", "motion"]) {
    assert.equal(Object.hasOwn(state.live.executionSnapshot, key), false, key);
  }
  assert.equal(state.live.executionSnapshot.lighting.sceneId, "warm");
});

test("GO, BACK, and applying a Look preserve all manual camera state", () => {
  const state = fixture();
  const before = cameraState(state);
  executeCue(state, 1, { now: () => 20 });
  assert.deepEqual(cameraState(state), before);
  executeCue(state, 0, { now: () => 30 });
  assert.deepEqual(cameraState(state), before);
  applyLook(state, "look");
  assert.deepEqual(cameraState(state), before);
});

test("legacy snapshots load safely while obsolete camera instructions are discarded", () => {
  const normalized = normalizeExecutionSnapshot({
    cueId: "old", video: { programCameraId: "right" }, cameraAssignments: [{ cameraDeviceId: "right" }],
    cameras: [{}], shotExecutions: [{}], shotValidationErrors: ["old"], shotExecutionResults: [{}],
    simplifiedLook: { priorityCameraId: "right" }, motion: { enabled: true }, futureField: { retained: true }
  });
  assert.deepEqual(normalized.futureField, { retained: true });
  for (const key of ["video", "cameraAssignments", "cameras", "shotExecutions", "shotValidationErrors", "shotExecutionResults", "simplifiedLook", "motion"]) {
    assert.equal(Object.hasOwn(normalized, key), false, key);
  }
});
