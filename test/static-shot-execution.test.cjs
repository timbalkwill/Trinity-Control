"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { executeCue } = require("../cue-execution.cjs");
const { SHOT_EXECUTION_STATUS } = require("../camera-shot-execution.cjs");
const { normalizeShot } = require("../shot-operations.cjs");

function fixture(references = [{ role: "main-shot", shotId: "static-main" }]) {
  return {
    devices: [
      { id: "main", type: "camera", name: "Main Camera", logicalRole: "main", enabled: true },
      { id: "left", type: "camera", name: "Left Camera", logicalRole: "left", enabled: true }
    ],
    cameras: [],
    cameraPresets: [
      { id: "position-1", name: "Main Position 1", cameraDeviceId: "main", enabled: true },
      { id: "position-1", name: "Left Position 1", cameraDeviceId: "left", enabled: true },
      { id: "position-2", name: "Main Position 2", cameraDeviceId: "main", enabled: true },
      { id: "position-2", name: "Left Position 2", cameraDeviceId: "left", enabled: true }
    ],
    shots: [
      normalizeShot({ id: "static-main", name: "Static Main", shotType: "static", cameraDeviceId: "main", cameraPresetId: "position-1" }),
      normalizeShot({ id: "static-left", name: "Static Left", shotType: "static", cameraDeviceId: "left", cameraPresetId: "position-1" }),
      normalizeShot({
        id: "motion-main", name: "Motion Main", shotType: "motion", cameraDeviceId: "main",
        cameraPresetId: "position-1", motionEndPresetId: "position-2", motionSpeedSetting: "slow"
      }),
      normalizeShot({
        id: "tracking-main", name: "Tracking Main", shotType: "tracking", cameraDeviceId: "main",
        cameraPresetId: "position-1", trackingPreferred: true
      })
    ],
    lightingScenes: [{ id: "warm", name: "Warm" }],
    cameraLayouts: [],
    productionLooks: [{
      schemaVersion: 3,
      id: "look",
      name: "Shot Look",
      enabled: true,
      lightingSceneId: "warm",
      selectedShotId: null,
      cameraAssignments: references,
      cameraPresets: {},
      priorityCameraId: "main",
      startMainTracking: false
    }],
    runOfService: [{ id: "cue", name: "Cue", productionLookId: "look" }],
    cueTemplates: [],
    live: { cueIndex: 0, activityLog: [] }
  };
}

function recordingExecutor(handler = () => ({ ok: true })) {
  const calls = [];
  return {
    calls,
    recallPreset(command) {
      calls.push({ ...command });
      return handler(command, calls.length);
    }
  };
}

function execute(current, cameraExecutor) {
  return executeCue(current, 0, { now: () => 1000, cameraExecutor }).live.executionSnapshot;
}

test("valid Static Shot recalls exactly one camera-scoped preset", () => {
  const current = fixture();
  const executor = recordingExecutor();
  const snapshot = execute(current, executor);
  assert.deepEqual(executor.calls, [{ cameraDeviceId: "main", presetId: "position-1", shotId: "static-main" }]);
  assert.equal(snapshot.shotExecutionResults[0].status, SHOT_EXECUTION_STATUS.STATIC_SUCCEEDED);
});

test("multiple Static Shots recall the correct preset on each camera", () => {
  const current = fixture([
    { role: "main-shot", shotId: "static-main" },
    { role: "left-shot", shotId: "static-left" }
  ]);
  const executor = recordingExecutor();
  execute(current, executor);
  assert.deepEqual(executor.calls, [
    { cameraDeviceId: "main", presetId: "position-1", shotId: "static-main" },
    { cameraDeviceId: "left", presetId: "position-1", shotId: "static-left" }
  ]);
});

test("Static execution preserves camera-scoped preset identity", () => {
  const current = fixture([
    { role: "main-shot", shotId: "static-main" },
    { role: "left-shot", shotId: "static-left" }
  ]);
  const executor = recordingExecutor();
  execute(current, executor);
  assert.deepEqual(executor.calls.map(item => [item.cameraDeviceId, item.presetId]), [
    ["main", "position-1"],
    ["left", "position-1"]
  ]);
});

test("Shot validation errors prevent preset recall", () => {
  const current = fixture([{ role: "bad", shotId: "missing-shot" }]);
  const executor = recordingExecutor();
  const snapshot = execute(current, executor);
  assert.equal(executor.calls.length, 0);
  assert.equal(snapshot.shotExecutionResults[0].status, SHOT_EXECUTION_STATUS.VALIDATION_SKIPPED);
  assert.match(snapshot.shotExecutionResults[0].message, /Invalid Shot reference/);
});

test("missing camera sends no command and records a useful result", () => {
  const current = fixture();
  current.shots[0] = normalizeShot({ id: "static-main", name: "Missing Camera", shotType: "static", cameraDeviceId: "gone", cameraPresetId: "position-1" });
  const executor = recordingExecutor();
  const snapshot = execute(current, executor);
  assert.equal(executor.calls.length, 0);
  assert.equal(snapshot.shotExecutionResults[0].status, SHOT_EXECUTION_STATUS.VALIDATION_SKIPPED);
  assert.match(snapshot.shotExecutionResults[0].message, /Missing camera/);
});

test("missing preset sends no command and records a useful result", () => {
  const current = fixture();
  current.shots[0] = normalizeShot({ id: "static-main", name: "Missing Preset", shotType: "static", cameraDeviceId: "main", cameraPresetId: "gone" });
  const executor = recordingExecutor();
  const snapshot = execute(current, executor);
  assert.equal(executor.calls.length, 0);
  assert.equal(snapshot.shotExecutionResults[0].status, SHOT_EXECUTION_STATUS.VALIDATION_SKIPPED);
  assert.match(snapshot.shotExecutionResults[0].message, /Missing preset/);
});

test("one camera failure does not block another valid Static Shot", () => {
  const current = fixture([
    { role: "main-shot", shotId: "static-main" },
    { role: "left-shot", shotId: "static-left" }
  ]);
  const executor = recordingExecutor(command => {
    if (command.cameraDeviceId === "main") throw new Error("Main camera offline");
    return { ok: true };
  });
  const snapshot = execute(current, executor);
  assert.equal(executor.calls.length, 2);
  assert.deepEqual(snapshot.shotExecutionResults.map(item => item.status), [
    SHOT_EXECUTION_STATUS.STATIC_FAILED,
    SHOT_EXECUTION_STATUS.STATIC_SUCCEEDED
  ]);
  assert.match(snapshot.warnings.join("; "), /Main camera offline/);
});

test("Motion Shot execution is skipped without PTZ commands", () => {
  const current = fixture([{ role: "motion", shotId: "motion-main" }]);
  const executor = recordingExecutor();
  const snapshot = execute(current, executor);
  assert.equal(executor.calls.length, 0);
  assert.equal(snapshot.shotExecutionResults[0].status, SHOT_EXECUTION_STATUS.MOTION_UNSUPPORTED);
});

test("Tracking Shot execution is skipped without PTZ commands", () => {
  const current = fixture([{ role: "tracking", shotId: "tracking-main" }]);
  const executor = recordingExecutor();
  const snapshot = execute(current, executor);
  assert.equal(executor.calls.length, 0);
  assert.equal(snapshot.shotExecutionResults[0].status, SHOT_EXECUTION_STATUS.TRACKING_UNSUPPORTED);
});

test("execution uses the frozen snapshot when mutable libraries change during recall", () => {
  const current = fixture([
    { role: "main-shot", shotId: "static-main" },
    { role: "left-shot", shotId: "static-left" }
  ]);
  const executor = recordingExecutor((_command, callNumber) => {
    if (callNumber === 1) {
      current.shots.find(item => item.id === "static-left").cameraDeviceId = "main";
      current.shots.find(item => item.id === "static-left").cameraPresetId = "position-2";
      current.cameraPresets.find(item => item.cameraDeviceId === "left" && item.id === "position-1").id = "edited";
    }
    return { ok: true };
  });
  execute(current, executor);
  assert.deepEqual(executor.calls[1], { cameraDeviceId: "left", presetId: "position-1", shotId: "static-left" });
});

test("Static execution preserves existing cue and lighting behavior", () => {
  const current = fixture();
  const executor = recordingExecutor();
  const snapshot = execute(current, executor);
  assert.equal(current.live.cueIndex, 0);
  assert.equal(current.live.activeCueId, "cue");
  assert.equal(current.live.lastLightingSceneId, "warm");
  assert.equal(snapshot.lighting.sceneId, "warm");
  assert.equal(snapshot.cueId, "cue");
});

test("repeated traversal of one Shot assignment issues no duplicate recall", () => {
  const current = fixture([
    { role: "main-shot", shotId: "static-main" },
    { role: "main-shot", shotId: "static-main" }
  ]);
  const executor = recordingExecutor();
  const snapshot = execute(current, executor);
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(snapshot.shotExecutionResults.map(item => item.status), [
    SHOT_EXECUTION_STATUS.STATIC_SUCCEEDED,
    SHOT_EXECUTION_STATUS.DUPLICATE_SKIPPED
  ]);
});
