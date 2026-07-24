"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { takeLive } = require("../live-operations.cjs");

const clone = value => JSON.parse(JSON.stringify(value));

function assignment(role, overrides = {}) {
  return {
    role,
    shotId: `${role}-shot`,
    shotName: `${role} Shot`,
    cameraDeviceId: `${role}-camera`,
    cameraName: `${role} Camera`,
    presetId: `${role}-preset`,
    presetName: `${role} Preset`,
    tracking: { mode: "subject", preferred: role === "preview", subject: "speaker" },
    motion: { enabled: role === "preview", profileId: `${role}-motion`, durationMs: 1200, speed: 0.8 },
    source: `${role}-frozen-source`,
    warnings: [`${role} frozen warning`],
    missing: false,
    frozenExtra: `${role}-extra`,
    ...overrides
  };
}

function stateWith(program = assignment("program"), preview = assignment("preview")) {
  const cameraAssignments = [program, preview].filter(Boolean);
  return {
    shots: [{ id: "edited-shot", name: "Edited after execution" }],
    productionLooks: [{ id: "edited-look", cameraAssignments: [] }],
    live: {
      programCamera: program?.cameraDeviceId || null,
      programPreset: program?.presetName || null,
      previewCamera: preview?.cameraDeviceId || null,
      previewPreset: preview?.presetName || null,
      activityLog: [],
      executionSnapshot: {
        video: {
          programCameraId: program?.cameraDeviceId || null,
          programCameraName: program?.cameraName || null,
          previewCameraId: preview?.cameraDeviceId || null,
          previewCameraName: preview?.cameraName || null,
          programShotId: program?.shotId || null,
          programShotName: program?.shotName || null,
          previewShotId: preview?.shotId || null,
          previewShotName: preview?.shotName || null,
          programPreset: program?.presetName || null,
          previewPreset: preview?.presetName || null,
          source: "executed"
        },
        cameraAssignments,
        cameras: cameraAssignments.map(item => ({
          role: item.role,
          cameraId: item.cameraDeviceId,
          cameraName: item.cameraName,
          presetId: item.presetId,
          presetName: item.presetName,
          shotId: item.shotId,
          shotName: item.shotName,
          tracking: clone(item.tracking),
          motion: clone(item.motion),
          source: item.source,
          warnings: [...item.warnings]
        }))
      }
    }
  };
}

test("TAKE LIVE swaps complete frozen PROGRAM and PREVIEW assignments", () => {
  const current = stateWith();
  const oldProgram = clone(current.live.executionSnapshot.cameraAssignments[0]);
  const oldPreview = clone(current.live.executionSnapshot.cameraAssignments[1]);
  takeLive(current, { now: () => 123 });

  const program = current.live.executionSnapshot.cameraAssignments.find(item => item.role === "program");
  const preview = current.live.executionSnapshot.cameraAssignments.find(item => item.role === "preview");
  assert.deepEqual(program, { ...oldPreview, role: "program" });
  assert.deepEqual(preview, { ...oldProgram, role: "preview" });
  assert.equal(current.live.executionSnapshot.video.programShotId, oldPreview.shotId);
  assert.equal(current.live.executionSnapshot.video.programShotName, oldPreview.shotName);
  assert.equal(current.live.executionSnapshot.video.programPreset, oldPreview.presetName);
  assert.equal(current.live.executionSnapshot.video.previewShotId, oldProgram.shotId);
  assert.equal(current.live.programCamera, oldPreview.cameraDeviceId);
  assert.equal(current.live.previewCamera, oldProgram.cameraDeviceId);
  assert.equal(current.live.activityLog[0].at, 123);
});

test("TAKE LIVE promotes PREVIEW when PROGRAM is unassigned", () => {
  const current = stateWith(null, assignment("preview"));
  takeLive(current);
  assert.equal(current.live.executionSnapshot.cameraAssignments[0].role, "program");
  assert.equal(current.live.executionSnapshot.video.programCameraId, "preview-camera");
  assert.equal(current.live.executionSnapshot.video.previewCameraId, null);
  assert.equal(current.live.previewCamera, null);
});

test("TAKE LIVE leaves state unchanged when PREVIEW is unassigned", () => {
  const current = stateWith(assignment("program"), null);
  const before = clone(current);
  assert.throws(() => takeLive(current), error => error.code === "TAKE_LIVE_PREVIEW_UNASSIGNED");
  assert.deepEqual(current, before);
});

test("TAKE LIVE handles the same PROGRAM and PREVIEW camera deterministically", () => {
  const current = stateWith(assignment("program", { cameraDeviceId: "same" }), assignment("preview", { cameraDeviceId: "same" }));
  const before = clone(current);
  assert.throws(() => takeLive(current), error => error.code === "TAKE_LIVE_SAME_CAMERA");
  assert.deepEqual(current, before);
});

test("TAKE LIVE preserves frozen missing Shot and camera references without library resolution", () => {
  const current = stateWith(
    assignment("program", { shotId: "deleted-shot", cameraDeviceId: "deleted-camera", missing: true }),
    assignment("preview", { shotId: "missing-shot", shotName: "Frozen Missing Shot", cameraDeviceId: "missing-camera", cameraName: null, missing: true })
  );
  Object.defineProperty(current, "shots", { get: () => { throw new Error("Shot library must not be read"); } });
  Object.defineProperty(current, "productionLooks", { get: () => { throw new Error("Look library must not be read"); } });
  Object.defineProperty(current, "hardware", { get: () => { throw new Error("Hardware must not be contacted"); } });

  takeLive(current);
  const program = current.live.executionSnapshot.cameraAssignments.find(item => item.role === "program");
  assert.equal(program.shotId, "missing-shot");
  assert.equal(program.shotName, "Frozen Missing Shot");
  assert.equal(program.cameraDeviceId, "missing-camera");
  assert.equal(program.cameraName, null);
  assert.equal(program.missing, true);
});

test("TAKE LIVE rejects malformed snapshots without crashing or mutation", () => {
  for (const current of [{}, { live: {} }, { live: { executionSnapshot: { cameraAssignments: "bad" } } }]) {
    const before = clone(current);
    assert.throws(() => takeLive(current), error => ["TAKE_LIVE_NO_SNAPSHOT", "TAKE_LIVE_PREVIEW_UNASSIGNED"].includes(error.code));
    assert.deepEqual(current, before);
  }
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
