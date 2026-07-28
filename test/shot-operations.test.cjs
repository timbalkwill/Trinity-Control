"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_SHOT_DEFINITIONS,
  SUGGESTED_SHOT_CATEGORIES,
  SHOT_TYPES,
  countShotReferences,
  createShot,
  deleteShot,
  duplicateShot,
  filterShots,
  listFavoriteShots,
  listShotCategories,
  listShotsByCamera,
  listShotsByCategory,
  listShotsByRole,
  migrateShots,
  normalizeShot,
  reorderShot,
  resolveShotTarget,
  summarizeShot,
  updateShot,
  validateShot
} = require("../shot-operations.cjs");
const { normalizeDevice, projectBrowserState } = require("../device-operations.cjs");
const { normalizeCameraPreset } = require("../camera-preset-operations.cjs");
const { normalizeProductionLook } = require("../production-look-operations.cjs");
const { buildCueExecutionPlan } = require("../cue-execution-plan.cjs");
const { executeCue } = require("../cue-execution.cjs");

function state() {
  return {
    shots: [],
    devices: [
      normalizeDevice({ id: "main", type: "camera", name: "Main Camera", logicalRole: "main", enabled: true }),
      normalizeDevice({ id: "left", type: "camera", name: "Left Camera", logicalRole: "left", enabled: false })
    ],
    cameras: [],
    cameraPresets: [
      normalizeCameraPreset({ id: "pastor-tight", name: "Pastor Tight", cameraDeviceId: "main", enabled: true }),
      normalizeCameraPreset({ id: "left-wide", name: "Left Wide", cameraDeviceId: "left", enabled: true }),
      normalizeCameraPreset({ id: "disabled", name: "Disabled", cameraDeviceId: "main", enabled: false })
    ],
    productionLooks: [],
    cameraLayouts: [],
    lightingScenes: [],
    runOfService: [],
    cueTemplates: [],
    live: { cueIndex: 0, activityLog: [] }
  };
}

test("initial Shot migration creates deterministic starter resources", () => {
  const first = migrateShots(undefined);
  const second = migrateShots(undefined);
  assert.deepEqual(first.map(shot => shot.id), DEFAULT_SHOT_DEFINITIONS.map(item => item[0]));
  assert.deepEqual(second, first);
  assert.equal(first.length, 10);
});

test("Shot migration is idempotent and a saved empty collection is authoritative", () => {
  const migrated = migrateShots([{ id: "custom", name: "Custom", category: "My Category", future: { value: true } }]);
  assert.deepEqual(migrateShots(migrated), migrated);
  assert.deepEqual(migrateShots([]), []);
  const deletedDefaults = migrateShots(undefined).filter(shot => shot.id !== "shot-pastor-tight");
  assert.equal(migrateShots(deletedDefaults).some(shot => shot.id === "shot-pastor-tight"), false);
});

test("malformed partial Shots normalize safely and preserve unknown fields", () => {
  const migrated = migrateShots([null, "bad", { id: "partial", name: 5, tags: null, customFutureField: "preserved" }]);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].name, "Untitled Shot");
  assert.deepEqual(migrated[0].tags, []);
  assert.equal(migrated[0].customFutureField, "preserved");
  assert.equal(validateShot(migrated[0]).valid, true);
});

test("Shot types migrate, default, and persist through CRUD", () => {
  assert.deepEqual(SHOT_TYPES, ["static", "motion", "tracking"]);
  assert.equal(migrateShots([{ id: "legacy", name: "Legacy Shot" }])[0].shotType, "static");
  assert.equal(normalizeShot({ name: "Unknown Type", shotType: "other" }).shotType, "static");

  const current = state();
  const created = createShot(current, { name: "New Shot" }, { id: "shot", now: 1000 });
  assert.equal(created.shotType, "static");

  updateShot(current, "shot", { shotType: "motion" }, { now: 2000 });
  assert.equal(current.shots[0].shotType, "motion");

  const copy = duplicateShot(current, "shot", { id: "copy", now: 3000 });
  assert.equal(copy.shotType, "motion");

  updateShot(current, "shot", { shotType: "tracking" }, { now: 4000 });
  assert.equal(current.shots[0].shotType, "tracking");
});

test("Shot reference summary renders without undefined camera variables", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const source = renderer.match(/function shotReferenceSummary\(shotId\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, "Shot reference summary function is present");
  const summarize = new Function("state", `${source}; return shotReferenceSummary("shot");`);
  const summary = summarize({
    productionLooks: [{ selectedShotId: "shot", cameraAssignments: [{ shotId: "shot" }] }],
    runOfService: [],
    cueTemplates: [],
    motionStudioReferences: []
  });
  assert.deepEqual(summary, {
    counts: { "Production Looks": 2, Cues: 0, Templates: 0, "Motion Studio": 0 },
    total: 2
  });
});

test("renderer wires Shot Type persistence and Lighting card interactions", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const shotsPage = renderer.slice(renderer.indexOf("function shotsPage()"), renderer.indexOf("function deviceConfigured"));
  assert.match(shotsPage, /select data-shot-field="shotType"/);
  assert.match(shotsPage, /window\.trinity\.updateShot\(selected\.id, patch\)/);

  const lightingPage = renderer.slice(renderer.indexOf("function lightingPage()"), renderer.indexOf("function camerasPage()"));
  assert.match(lightingPage, /data-select-lighting="\$\{scene\.id\}"/);
  assert.match(lightingPage, /data-favorite-lighting="\$\{scene\.id\}"/);
  assert.match(lightingPage, /window\.trinity\.lightingOverride\(card\.dataset\.selectLighting\)/);
  assert.match(lightingPage, /favorite: !scene\.favorite/);
});

test("Shot CRUD, favorite, enable, reorder, and duplicate isolation", () => {
  const current = state();
  const created = createShot(current, {
    name: "Pastor Tight",
    category: "Pastor",
    tags: ["sermon"],
    aiFramingMetadata: { model: { name: "future" } }
  }, { id: "shot", now: 1000 });
  assert.equal(created.id, "shot");
  updateShot(current, "shot", { name: "Pastor Medium", favorite: true, enabled: false }, { now: 2000 });
  assert.equal(current.shots[0].favorite, true);
  assert.equal(current.shots[0].enabled, false);
  const copy = duplicateShot(current, "shot", { id: "copy", now: 3000 });
  copy.tags.push("copy");
  copy.aiFramingMetadata.model.name = "changed";
  assert.deepEqual(current.shots[0].tags, ["sermon"]);
  assert.equal(current.shots[0].aiFramingMetadata.model.name, "future");
  reorderShot(current, 1, 0);
  assert.deepEqual(current.shots.map(shot => shot.order), [0, 1]);
  deleteShot(current, "copy");
  assert.deepEqual(current.shots.map(shot => shot.id), ["shot"]);
});

test("categories and filters include suggestions, custom values, and Utility fallback", () => {
  const current = state();
  current.shots = [
    normalizeShot({ id: "one", name: "One", category: null, cameraDeviceId: "main", logicalCameraRole: "main", favorite: true, enabled: true }),
    normalizeShot({ id: "two", name: "Two", category: "Custom Category", logicalCameraRole: "left", enabled: false })
  ];
  const categories = listShotCategories(current);
  assert.deepEqual(categories.slice(0, SUGGESTED_SHOT_CATEGORIES.length), SUGGESTED_SHOT_CATEGORIES);
  assert.ok(categories.includes("Custom Category"));
  assert.equal(summarizeShot(current, "one").category, "Utility");
  assert.deepEqual(listShotsByCamera(current, "main").map(shot => shot.id), ["one"]);
  assert.deepEqual(listShotsByRole(current, "left").map(shot => shot.id), ["two"]);
  assert.deepEqual(listShotsByCategory(current, "utility").map(shot => shot.id), ["one"]);
  assert.deepEqual(listFavoriteShots(current).map(shot => shot.id), ["one"]);
  assert.deepEqual(filterShots(current, { favorite: true, enabled: true, search: "one" }).map(shot => shot.id), ["one"]);
});

test("Shot resolution uses a valid camera ID and matching preset", () => {
  const current = state();
  const shot = normalizeShot({
    id: "shot", name: "Pastor Tight", cameraDeviceId: "main", logicalCameraRole: "left",
    cameraPresetId: "pastor-tight", trackingPreferred: true, trackingSubject: "Pastor",
    motionEnabled: true, motionProfileId: "push", motionDurationMs: 1200, motionSpeed: 0.5
  });
  const resolved = resolveShotTarget(current, shot);
  assert.equal(resolved.cameraDeviceId, "main");
  assert.equal(resolved.presetId, "pastor-tight");
  assert.equal(resolved.source, "shot-camera");
  assert.equal(resolved.tracking.preferred, true);
  assert.equal(resolved.motion.enabled, true);
  assert.notEqual(resolved.capabilityReadiness, "connected");
});

test("Shot resolution falls back by role and reports missing or disabled resources", () => {
  const current = state();
  assert.equal(resolveShotTarget(current, normalizeShot({ name: "Role", cameraDeviceId: "missing", logicalCameraRole: "main" })).cameraDeviceId, "main");
  assert.equal(resolveShotTarget(current, normalizeShot({ name: "Missing", cameraDeviceId: "missing" })).readinessState, "missingCamera");
  assert.equal(resolveShotTarget(current, normalizeShot({ name: "Disabled", cameraDeviceId: "left" })).readinessState, "cameraDisabled");
  assert.equal(resolveShotTarget(current, normalizeShot({ name: "Missing preset", cameraDeviceId: "main", cameraPresetId: "missing" })).readinessState, "missingPreset");
  assert.equal(resolveShotTarget(current, normalizeShot({ name: "Disabled preset", cameraDeviceId: "main", cameraPresetId: "disabled" })).readinessState, "presetDisabled");
  assert.equal(resolveShotTarget(current, normalizeShot({ name: "Mismatch", cameraDeviceId: "main", cameraPresetId: "left-wide" })).readinessState, "presetCameraMismatch");
  assert.equal(resolveShotTarget(current, normalizeShot({ name: "Disabled Shot", cameraDeviceId: "main", enabled: false })).readinessState, "shotDisabled");
});

test("Shot deletion is reference-aware and preserves missing references", () => {
  const current = state();
  current.shots.push(normalizeShot({ id: "shot", name: "Shot" }));
  current.productionLooks.push({ id: "look", name: "Look", selectedShotId: "shot", cameraAssignments: [{ role: "program", shotId: "shot" }] });
  current.runOfService.push({ id: "cue", name: "Cue", shotId: "shot" });
  current.cueTemplates.push({ id: "template", name: "Template", selectedShotId: "shot" });
  assert.equal(countShotReferences(current, "shot").length, 4);
  assert.throws(() => deleteShot(current, "shot"), error => error.code === "CONFIRM_SHOT_DELETE" && error.references.length === 4);
  deleteShot(current, "shot", { confirmReferences: true });
  assert.equal(current.productionLooks[0].selectedShotId, "shot");
  assert.equal(current.runOfService[0].shotId, "shot");
});
