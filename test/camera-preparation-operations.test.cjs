"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  makeCameraLive,
  migrateCameraPreparations,
  prepareCamera,
  preparationFor,
  setCameraMode,
  setCameraTracking
} = require("../camera-preparation-operations.cjs");

const clone = value => JSON.parse(JSON.stringify(value));

function initialState() {
  return {
    devices: [
      { id: "main", type: "camera", name: "Main Camera", logicalRole: "main", enabled: true, trackingEnabled: true },
      { id: "left", type: "camera", name: "Left Camera", logicalRole: "left", enabled: true },
      { id: "right", type: "camera", name: "Right Camera", logicalRole: "right", enabled: true }
    ],
    cameraPresets: [
      { id: "main-wide", name: "Main Wide", cameraDeviceId: "main", enabled: true },
      { id: "left-tight", name: "Left Tight", cameraDeviceId: "left", enabled: true },
      { id: "right-wide", name: "Right Wide", cameraDeviceId: "right", enabled: true }
    ],
    shots: [
      { id: "main-move", name: "Main Move", cameraDeviceId: "main", cameraPresetId: "main-wide", enabled: true },
      { id: "left-move", name: "Left Move", logicalCameraRole: "left", cameraPresetId: "left-tight", enabled: true }
    ],
    live: {
      programCamera: "main",
      previewCamera: "left",
      executionSnapshot: {
        cueId: "cue",
        video: { programCameraId: "main", previewCameraId: "left" },
        cameraAssignments: [
          { role: "program", cameraDeviceId: "main", shotId: "frozen-main" },
          { role: "preview", cameraDeviceId: "left", shotId: "frozen-left" }
        ]
      },
      activityLog: []
    }
  };
}

test("migration creates independent persistent preparation state for every camera", () => {
  const current = initialState();
  migrateCameraPreparations(current);
  assert.deepEqual(current.live.cameraPreparations.map(item => item.cameraId), ["main", "left", "right"]);
  assert.equal(preparationFor(current, "main").tracking.supported, true);
  assert.equal(preparationFor(current, "left").tracking.supported, false);

  preparationFor(current, "left").selectedPresetId = "left-tight";
  migrateCameraPreparations(current);
  assert.equal(preparationFor(current, "left").selectedPresetId, "left-tight");
  assert.equal(preparationFor(current, "right").selectedPresetId, null);
});

test("Static and Motion selections are mutually exclusive", () => {
  const current = initialState();
  setCameraMode(current, "left", "motion");
  prepareCamera(current, "left", "left-move");
  assert.equal(preparationFor(current, "left").selectedPresetId, null);
  assert.equal(preparationFor(current, "left").selectedMotionId, "left-move");

  setCameraMode(current, "left", "static");
  prepareCamera(current, "left", "left-tight");
  assert.equal(preparationFor(current, "left").selectedPresetId, "left-tight");
  assert.equal(preparationFor(current, "left").selectedMotionId, null);
});

test("preparing cameras is independent and never changes PROGRAM", () => {
  const current = initialState();
  setCameraMode(current, "left", "static");
  prepareCamera(current, "left", "left-tight");
  setCameraMode(current, "right", "static");
  prepareCamera(current, "right", "right-wide");
  assert.equal(current.live.programCamera, "main");
  assert.equal(preparationFor(current, "left").selectedPresetId, "left-tight");
  assert.equal(preparationFor(current, "right").selectedPresetId, "right-wide");
  assert.equal(preparationFor(current, "main").selectedPresetId, null);
});

test("Make Live switches cameras without altering the frozen cue snapshot", () => {
  const current = initialState();
  const frozen = clone(current.live.executionSnapshot);
  prepareCamera(current, "left", "left-tight");
  makeCameraLive(current, "left", { now: () => 100 });
  assert.equal(current.live.programCamera, "left");
  assert.equal(current.live.previewCamera, "main");
  assert.equal(current.live.activeCameraAssignment.presetId, "left-tight");
  assert.deepEqual(current.live.executionSnapshot, frozen);
  assert.equal(preparationFor(current, "right").preparationStatus, "idle");
});

test("static preparation never starts motion", () => {
  const current = initialState();
  prepareCamera(current, "left", "left-tight");
  makeCameraLive(current, "left");
  assert.equal(preparationFor(current, "left").motionRunCount, 0);
  assert.equal(preparationFor(current, "left").preparationStatus, "ready");
});

test("prepared motion starts exactly once and completes at its ending state", () => {
  const current = initialState();
  setCameraMode(current, "left", "motion");
  prepareCamera(current, "left", "left-move");
  makeCameraLive(current, "left", { now: () => 200 });
  const preparation = preparationFor(current, "left");
  assert.equal(preparation.motionRunCount, 1);
  assert.equal(preparation.lastMotionStartedAt, 200);
  assert.equal(preparation.lastMotionCompletedAt, 200);
  assert.equal(preparation.preparationStatus, "complete");
  assert.equal(current.live.programCamera, "left");

  makeCameraLive(current, "left", { now: () => 300 });
  assert.equal(preparationFor(current, "left").motionRunCount, 1);
  assert.equal(current.live.programCamera, "left");
});

test("tracking persists live and off-air while movement controls remain protected", () => {
  const current = initialState();
  setCameraMode(current, "main", "motion");
  prepareCamera(current, "main", "main-move");
  setCameraTracking(current, "main", true);
  assert.equal(preparationFor(current, "main").tracking.active, true);
  assert.throws(() => prepareCamera(current, "main", "main-move"), error => error.code === "CAMERA_TRACKING_ACTIVE");

  makeCameraLive(current, "left");
  assert.equal(current.live.programCamera, "left");
  assert.equal(preparationFor(current, "main").tracking.active, true);
  makeCameraLive(current, "main");
  assert.equal(preparationFor(current, "main").tracking.active, true);
  assert.equal(preparationFor(current, "main").motionRunCount, 0);

  setCameraTracking(current, "main", false);
  prepareCamera(current, "main", "main-move");
  assert.equal(preparationFor(current, "main").preparationStatus, "ready");
  makeCameraLive(current, "main");
  assert.equal(preparationFor(current, "main").motionRunCount, 1);
});

test("unsupported cameras cannot activate tracking but Make Live remains available", () => {
  const current = initialState();
  assert.throws(() => setCameraTracking(current, "left", true), /not supported/);
  makeCameraLive(current, "left");
  assert.equal(current.live.programCamera, "left");
});

test("older saved state migrates deterministically and restart retains preparation", () => {
  const old = initialState();
  delete old.live.cameraPreparations;
  migrateCameraPreparations(old);
  prepareCamera(old, "right", "right-wide");
  makeCameraLive(old, "right");
  const reloaded = clone(old);
  migrateCameraPreparations(reloaded);
  assert.equal(reloaded.live.programCamera, "right");
  assert.equal(preparationFor(reloaded, "right").selectedPresetId, "right-wide");
  assert.equal(preparationFor(reloaded, "right").preparationStatus, "ready");
});

test("desktop controls use narrow preload commands and disable movement while tracking", () => {
  const root = path.join(__dirname, "..");
  const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  assert.match(preload, /makeCameraLive: cameraId => ipcRenderer\.invoke\("live:makeCameraLive", cameraId\)/);
  assert.match(renderer, /window\.trinity\.makeCameraLive/);
  assert.match(renderer, /preparation\.tracking\?\.active \? 'disabled'/);
  assert.match(renderer, /data-make-camera-live/);
});

test("desktop Live layout uses a contained 2x2 source grid with PC Media preview", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(styles, /\.bottom-nav\{grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.simple-live-layout\{width:100%;min-width:0;grid-template-columns:clamp\([^}]+minmax\(0,1fr\);overflow:hidden\}/);
  assert.match(styles, /\.simple-camera-grid\{width:100%;min-width:0;display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);grid-template-rows:repeat\(2,auto\)/);
  assert.match(styles, /\.simple-camera-card\{width:100%;min-height:0;overflow:hidden/);
  assert.match(styles, /\.simple-camera-preview\{width:100%;height:auto;min-width:0;min-height:0;overflow:hidden;aspect-ratio:16 \/ 9\}/);
  assert.match(styles, /\.camera-live-actions\{width:100%;min-width:0;grid-template-columns:minmax\(0,1fr\) minmax\(/);
  assert.match(styles, /\.camera-live-actions button\{width:100%;min-width:0/);
  assert.match(app, /function PcMediaLiveCard\(\)/);
  assert.match(app, /PC MEDIA PREVIEW/);
  assert.match(app, /PREVIEW ONLY/);
  assert.match(app, /<select disabled><option>PC Media<\/option><\/select>/);
});


test("simplified Looks UI preserves preset-camera pairing and list containment", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(app, /cameraId: camera\?\.id \|\| selected\.cameraPresets/);
  assert.match(app, /item\.id === presetId && item\.cameraDeviceId === camera\?\.id/);
  assert.match(app, /previousIds = new Set/);
  assert.match(styles, /\.look-list\{[^}]*overflow-x:hidden[^}]*padding:8px 8px 8px 10px/);
  assert.match(styles, /\.look-list-item\{width:100%;min-width:0;box-sizing:border-box\}/);
  assert.match(styles, /\.look-list-item\{border:1px solid var\(--line\)/);
  assert.match(styles, /\.look-list-item\.selected\{[^}]*border-color:var\(--blue\)[^}]*box-shadow:inset/);
});
