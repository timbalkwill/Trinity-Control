"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_SHOT_DEFINITIONS,
  SUGGESTED_SHOT_CATEGORIES,
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

test("Production Look Shot resolution is pure and precedes explicit assignment fields", () => {
  const current = state();
  current.shots.push(normalizeShot({ id: "shot", name: "Pastor Tight", cameraDeviceId: "main", cameraPresetId: "pastor-tight", trackingPreferred: true }));
  current.productionLooks.push(normalizeProductionLook({
    id: "look",
    name: "Look",
    cameraAssignments: [{ role: "program", shotId: "shot", cameraId: "left", presetId: "left-wide" }]
  }));
  const before = JSON.stringify(current);
  const plan = buildCueExecutionPlan(current, { id: "cue", productionLookId: "look" });
  assert.equal(plan.cameraAssignments[0].shotId, "shot");
  assert.equal(plan.cameraAssignments[0].shotName, "Pastor Tight");
  assert.equal(plan.cameraAssignments[0].cameraDeviceId, "main");
  assert.equal(plan.cameraAssignments[0].presetId, "pastor-tight");
  assert.equal(plan.cameraAssignments[0].tracking.preferred, true);
  assert.equal(plan.cameraAssignments[0].source, "production-look-shot");
  assert.equal(JSON.stringify(current), before);
});

test("missing Shot falls back to explicit assignment and records a warning", () => {
  const current = state();
  current.productionLooks.push(normalizeProductionLook({
    id: "look", name: "Look",
    cameraAssignments: [{ role: "program", shotId: "missing", cameraId: "main", presetId: "pastor-tight" }]
  }));
  const plan = buildCueExecutionPlan(current, { id: "cue", productionLookId: "look" });
  assert.equal(plan.video.programCameraId, "main");
  assert.equal(plan.cameraAssignments[0].shotId, "missing");
  assert.ok(plan.warnings.some(warning => warning.includes("Missing Shot")));
});

test("explicit preset fills an otherwise valid Shot target without overriding its camera", () => {
  const current = state();
  current.shots.push(normalizeShot({ id: "shot", name: "Pastor", cameraDeviceId: "main" }));
  current.productionLooks.push(normalizeProductionLook({
    id: "look", name: "Look",
    cameraAssignments: [{ role: "program", shotId: "shot", cameraId: "left", presetId: "pastor-tight" }]
  }));
  const assignment = buildCueExecutionPlan(current, { id: "cue", productionLookId: "look" }).cameraAssignments[0];
  assert.equal(assignment.cameraDeviceId, "main");
  assert.equal(assignment.presetId, "pastor-tight");
  assert.equal(assignment.source, "production-look-shot");
});

test("executed Shot snapshot is frozen until cue re-execution", () => {
  const current = state();
  current.shots.push(normalizeShot({ id: "shot", name: "Pastor Tight", cameraDeviceId: "main", cameraPresetId: "pastor-tight", trackingPreferred: true, motionEnabled: true }));
  current.productionLooks.push(normalizeProductionLook({ id: "look", name: "Look", cameraAssignments: [{ role: "program", shotId: "shot" }] }));
  current.runOfService.push({ id: "cue", name: "Cue", productionLookId: "look" });
  executeCue(current, 0, { now: () => 1 });
  assert.equal(current.live.executionSnapshot.cameraAssignments[0].shotName, "Pastor Tight");
  current.shots[0].name = "Pastor Medium";
  assert.equal(current.live.executionSnapshot.cameraAssignments[0].shotName, "Pastor Tight");
  executeCue(current, 0, { now: () => 2 });
  assert.equal(current.live.executionSnapshot.cameraAssignments[0].shotName, "Pastor Medium");
});

test("Browser projection includes safe executed Shot summary but excludes Shot records and notes", () => {
  const current = state();
  current.shots.push(normalizeShot({ id: "shot", name: "Pastor Tight", cameraDeviceId: "main", cameraPresetId: "pastor-tight", operatorNotes: "private operator", framingNotes: "private framing", trackingNotes: "private tracking" }));
  current.productionLooks.push(normalizeProductionLook({ id: "look", name: "Look", cameraAssignments: [{ role: "program", shotId: "shot" }] }));
  current.runOfService.push({ id: "cue", name: "Cue", productionLookId: "look" });
  executeCue(current, 0, { now: () => 1 });
  const projected = projectBrowserState(current);
  const serialized = JSON.stringify(projected);
  assert.equal("shots" in projected, false);
  assert.equal(projected.live.executionSnapshot.cameraAssignments[0].shotName, "Pastor Tight");
  assert.doesNotMatch(serialized, /private operator|private framing|private tracking/);
});
