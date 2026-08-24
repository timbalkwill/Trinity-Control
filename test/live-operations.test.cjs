"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { migrateLiveState, takeLive } = require("../live-operations.cjs");

const clone = value => JSON.parse(JSON.stringify(value));

function stateWith(program = "main", preview = "left") {
  return {
    devices: [
      { id: "main", type: "camera", name: "Main Camera" },
      { id: "left", type: "camera", name: "Left Camera" }
    ],
    live: {
      programCamera: program,
      previewCamera: preview,
      programPreset: program ? "Main Wide" : null,
      previewPreset: preview ? "Left Tight" : null,
      cameraPreparations: [{
        cameraId: "left", selectedMode: "static", preparationStatus: "ready",
        selectedMotionId: null, tracking: { active: false },
        preparedAssignment: { presetId: "left-tight", presetName: "Left Tight" }
      }],
      activityLog: [],
      executionSnapshot: { cueId: "cue", lighting: { sceneId: "warm" }, futureField: true }
    }
  };
}

test("legacy Live state drops obsolete lighting overrides without altering other data", () => {
  const legacy = {
    cueIndex: 4, lightingOverrideId: "legacy-scene", lightingOverrideExecutionResult: { ok: true },
    executionSnapshot: { cueId: "cue", futureField: true },
    activityLog: [
      { at: 1, message: "Lighting scene: Welcome" },
      { at: 2, message: "Returned to cue lighting" },
      { at: 3, message: "Cue started: Welcome" }
    ], futureField: { retained: true }
  };
  const migrated = migrateLiveState(legacy);
  assert.equal("lightingOverrideId" in migrated, false);
  assert.equal("lightingOverrideExecutionResult" in migrated, false);
  assert.equal(migrated.cueIndex, 4);
  assert.deepEqual(migrated.executionSnapshot, legacy.executionSnapshot);
  assert.deepEqual(migrated.activityLog, [{ at: 3, message: "Cue started: Welcome" }]);
  assert.deepEqual(migrated.futureField, { retained: true });
});

test("manual TAKE LIVE swaps independent PROGRAM/PREVIEW state without changing the cue snapshot", () => {
  const current = stateWith();
  const frozen = clone(current.live.executionSnapshot);
  takeLive(current, { now: () => 123 });
  assert.equal(current.live.programCamera, "left");
  assert.equal(current.live.previewCamera, "main");
  assert.equal(current.live.programPreset, "Left Tight");
  assert.equal(current.live.previewPreset, "Main Wide");
  assert.equal(current.live.activeCameraAssignment.cameraId, "left");
  assert.equal(current.live.activeCameraAssignment.presetId, "left-tight");
  assert.deepEqual(current.live.executionSnapshot, frozen);
  assert.equal(current.live.activityLog[0].at, 123);
});

test("manual TAKE LIVE works before any service cue has executed", () => {
  const current = stateWith(null, "left");
  delete current.live.executionSnapshot;
  takeLive(current);
  assert.equal(current.live.programCamera, "left");
  assert.equal(current.live.previewCamera, null);
});

test("TAKE LIVE leaves state unchanged when PREVIEW is unassigned", () => {
  const current = stateWith("main", null);
  const before = clone(current);
  assert.throws(() => takeLive(current), error => error.code === "TAKE_LIVE_PREVIEW_UNASSIGNED");
  assert.deepEqual(current, before);
});

test("TAKE LIVE handles the same PROGRAM and PREVIEW camera deterministically", () => {
  const current = stateWith("main", "main");
  const before = clone(current);
  assert.throws(() => takeLive(current), error => error.code === "TAKE_LIVE_SAME_CAMERA");
  assert.deepEqual(current, before);
});

test("malformed legacy snapshots cannot influence manual TAKE LIVE", () => {
  const current = stateWith();
  current.live.executionSnapshot = { video: { programCameraId: "legacy" }, cameraAssignments: "bad" };
  takeLive(current);
  assert.equal(current.live.programCamera, "left");
  assert.equal(current.live.executionSnapshot.video.programCameraId, "legacy");
});

test("Electron TAKE LIVE uses preload IPC rather than renderer state replacement", () => {
  const root = path.join(__dirname, "..");
  const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
  const main = fs.readFileSync(path.join(root, "electron-main.cjs"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  assert.match(preload, /takeLive: \(\) => ipcRenderer\.invoke\("live:take"\)/);
  assert.match(main, /ipcMain\.handle\("live:take", \(\) => commands\.takeLive\(\)\)/);
  assert.match(renderer, /window\.trinity\.takeLive\(\)/);
});
