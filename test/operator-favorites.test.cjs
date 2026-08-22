"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeCameraPreset, updateCameraPreset } = require("../camera-preset-operations.cjs");
const { normalizeShot, updateShot } = require("../shot-operations.cjs");
const { projectBrowserState } = require("../device-operations.cjs");
const { createBackupEnvelope, mergePortableState } = require("../backup-operations.cjs");

const root = path.join(__dirname, "..");
const source = filename => fs.readFileSync(path.join(root, filename), "utf8");

function state() {
  return {
    settings: {},
    devices: [{ id: "main", type: "camera", name: "Main", logicalRole: "main", enabled: true, connection: {}, capabilities: {} }],
    cameras: [], productionLooks: [], runOfService: [], lightingScenes: [], cameraLayouts: [], cueTemplates: [], motionStudioReferences: [], videoSources: [],
    cameraPresets: [
      normalizeCameraPreset({ id: "wide", name: "Wide", cameraDeviceId: "main", favorite: false }),
      normalizeCameraPreset({ id: "tight", name: "Tight", cameraDeviceId: "main", favorite: true })
    ],
    shots: [
      normalizeShot({ id: "motion-one", name: "Slow Push", shotType: "motion", cameraDeviceId: "main", favorite: true, order: 3 }),
      normalizeShot({ id: "static-doc", name: "Static Shot", shotType: "static", cameraDeviceId: "main", favorite: true, order: 4 })
    ],
    live: { cueIndex: 0, activityLog: [] }
  };
}

test("preset and Motion favorite flags persist without changing stable identity", () => {
  const current = state();
  updateCameraPreset(current, "wide", { favorite: true, name: "Renamed Wide" }, { now: 1000 });
  updateShot(current, "motion-one", { favorite: true, name: "Renamed Push" }, { now: 1000 });
  assert.deepEqual(current.cameraPresets.map(item => [item.id, item.favorite]), [["wide", true], ["tight", true]]);
  assert.equal(current.shots.find(item => item.id === "motion-one").favorite, true);
  assert.equal(current.shots.find(item => item.id === "motion-one").id, "motion-one");
});

test("camera rename cannot break camera-scoped favorites", () => {
  const current = state();
  current.devices[0].name = "Sanctuary Center Camera";
  assert.equal(current.cameraPresets.find(item => item.favorite).cameraDeviceId, "main");
  assert.equal(current.shots.find(item => item.shotType === "motion").cameraDeviceId, "main");
});

test("Browser safe projection exposes separate favorite metadata and deterministic order", () => {
  const projected = projectBrowserState(state());
  assert.deepEqual(projected.cameraPresetSummaries.map(item => [item.id, item.favorite, item.favoriteOrder]), [["wide", false, 0], ["tight", true, 1]]);
  assert.deepEqual(projected.shotSummaries.map(item => [item.id, item.shotType, item.favorite, item.favoriteOrder]), [
    ["motion-one", "motion", true, 3], ["static-doc", "static", true, 4]
  ]);
  assert.equal("cameraPresets" in projected, false);
  assert.equal("shots" in projected, false);
});

test("portable backup round-trip preserves preset and Motion favorites", () => {
  const current = state();
  const envelope = createBackupEnvelope(current, { trinityVersion: "test", now: () => 1000 });
  const restored = mergePortableState({ ...current, cameraPresets: [], shots: [] }, envelope.data);
  assert.equal(restored.cameraPresets.find(item => item.id === "tight").favorite, true);
  assert.equal(restored.shots.find(item => item.id === "motion-one").favorite, true);
});

test("iPad selector separates Static and Motion while sorting favorites first without duplicate libraries", () => {
  const client = source("public/operator/operator.js");
  assert.match(client, /const favoritesFirst = items =>/);
  assert.match(client, /<h3>STATIC<\/h3>[\s\S]*<h3>MOTION<\/h3>/);
  assert.match(client, /const presets = favoritesFirst\(/);
  assert.match(client, /const motions = favoritesFirst\(/);
  assert.doesNotMatch(client, /FAVORITE STATIC|FAVORITE MOTION|ALL STATIC|ALL MOTION/);
  assert.doesNotMatch(client, /favoritePresets|favoriteMotions/);
});

test("favorite buttons retain the existing Static recall and prepared-Motion command paths", () => {
  const client = source("public/operator/operator.js");
  assert.match(client, /data-action="preset"[\s\S]*data-preset-id/);
  assert.match(client, /data-action="prepare-motion"[\s\S]*data-shot-id/);
  assert.match(client, /\/api\/live\/recall-camera-preset/);
  assert.match(client, /\/api\/live\/prepare-motion/);
  assert.match(client, /\/api\/video-sources\/take-live/);
  assert.doesNotMatch(client, /favorite[^\n]*(?:atem|lighting)/i);
});

test("desktop authoring uses the existing Favorite fields without adding iPad editing", () => {
  const desktop = source("public/app.js");
  const client = source("public/operator/operator.js");
  assert.match(desktop, /data-preset-field="favorite"/);
  assert.match(desktop, /data-shot-field="favorite"/);
  assert.match(desktop, /shown first on the iPad/g);
  assert.doesNotMatch(client, /updateCameraPreset|updateShot|data-action="favorite"/);
});
