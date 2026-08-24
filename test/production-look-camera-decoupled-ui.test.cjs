"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { applyLook } = require("../cue-execution.cjs");
const { updateProductionLook } = require("../production-look-operations.cjs");

const root = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const looksPage = renderer.slice(renderer.indexOf("function looksPage()"), renderer.indexOf("function lightingPage()"));

test("Production Looks editor exposes only name, lighting, enabled, summary, duplicate, and delete", () => {
  for (const required of ["look-name", "look-lighting", "look-enabled", "look-duplicate", "look-delete", "LOOK SUMMARY"]) {
    assert.match(looksPage, new RegExp(required));
  }
  assert.match(looksPage, /Configure the production settings used by this look/);
  assert.doesNotMatch(looksPage, /HOW SHOULD THIS CUE BEGIN|CAMERA STARTING PRESETS|STARTING LIVE CAMERA|data-look-preset|look-priority|look-main-tracking|Priority Camera|Start Main Camera Tracking/);
});

test("Look Summary contains no obsolete camera fields", () => {
  const summary = looksPage.slice(looksPage.indexOf("production-look-summary"), looksPage.indexOf("look-form-actions"));
  assert.match(summary, /Name/);
  assert.match(summary, /Lighting Scene/);
  assert.match(summary, /Status/);
  assert.doesNotMatch(summary, /camera|preset|tracking|program|preview/i);
});

test("saving meaningful fields preserves normalized legacy camera data", () => {
  const state = {
    devices: [{ id: "main", type: "camera", logicalRole: "main" }],
    cameraPresets: [{ id: "preset", cameraDeviceId: "main", name: "Wide" }],
    productionLooks: [{
      id: "look", name: "Legacy", enabled: true, lightingSceneId: "old-light",
      cameraPresets: { main: { cameraId: "main", presetId: "preset" } },
      cameraAssignments: [{ role: "main", cameraId: "main", presetId: "preset", shotId: "shot" }],
      priorityCameraId: "main", startMainTracking: true, createdAt: "2026-01-01T00:00:00.000Z"
    }]
  };
  updateProductionLook(state, "look", { name: "Updated", enabled: false, lightingSceneId: "new-light" }, { now: 10 });
  const look = state.productionLooks[0];
  assert.equal(look.name, "Updated");
  assert.equal(look.enabled, false);
  assert.equal(look.lightingSceneId, "new-light");
  assert.deepEqual(look.cameraPresets.main, { cameraId: "main", presetId: "preset" });
  assert.equal(look.cameraAssignments[0].shotId, "shot");
  assert.equal(look.priorityCameraId, "main");
  assert.equal(look.startMainTracking, true);
});

test("applying a legacy camera-bearing Look changes lighting and preserves manual camera state", () => {
  const state = {
    lightingScenes: [{ id: "warm", name: "Warm" }],
    productionLooks: [{
      id: "look", lightingSceneId: "warm", cameraPresets: { main: { cameraId: "main", presetId: "preset" } },
      cameraAssignments: [{ role: "main", cameraId: "main", presetId: "preset", shotId: "shot" }],
      priorityCameraId: "main", startMainTracking: true
    }],
    live: { programCamera: "right", previewCamera: "left", activeCameraAssignment: { cameraId: "right" }, cameraPreparations: [{ cameraId: "main", selectedPresetId: "manual" }] }
  };
  const before = JSON.parse(JSON.stringify({
    programCamera: state.live.programCamera, previewCamera: state.live.previewCamera,
    activeCameraAssignment: state.live.activeCameraAssignment, cameraPreparations: state.live.cameraPreparations
  }));
  applyLook(state, "look");
  assert.equal(state.live.lastLightingSceneId, "warm");
  assert.deepEqual({
    programCamera: state.live.programCamera, previewCamera: state.live.previewCamera,
    activeCameraAssignment: state.live.activeCameraAssignment, cameraPreparations: state.live.cameraPreparations
  }, before);
});

test("Look list cards reserve separate readable title and status rows", () => {
  assert.match(styles, /\.look-list-item\{[^}]*min-height:64px[^}]*grid-template-rows:auto auto[^}]*gap:7px[^}]*padding:11px 14px/);
  assert.match(styles, /\.look-list-item strong\{[^}]*line-height:1\.25[^}]*overflow-wrap:anywhere/);
  assert.match(styles, /\.look-list-item span\{[^}]*line-height:1\.3/);
  assert.doesNotMatch(styles.match(/\.look-list-item\{[^}]*\}/)?.[0] || "", /overflow:hidden/);
});
