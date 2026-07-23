"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildManagedCameraProjection,
  normalizeManagedCamera,
  resolveCameraCapabilities,
  resolveCameraDevice,
  resolveLegacyCamera,
  summarizeCameraCapabilities,
  summarizeManagedCamera,
  validateCameraCapabilities
} = require("../camera-manager-operations.cjs");
const {
  SUGGESTED_PRESET_CATEGORIES,
  countCameraPresetReferences,
  createCameraPreset,
  deleteCameraPreset,
  duplicateCameraPreset,
  listPresetsByCamera,
  listPresetsByCategory,
  listCameraPresetCategories,
  migrateLegacyPresets,
  normalizeCameraPreset,
  reorderCameraPreset,
  updateCameraPreset,
  validateCameraPreset
} = require("../camera-preset-operations.cjs");
const { normalizeDevice, projectBrowserState } = require("../device-operations.cjs");
const { buildCueExecutionPlan } = require("../cue-execution-plan.cjs");

function state() {
  return {
    devices: [
      normalizeDevice({ id: "extra", type: "camera", name: "Balcony", logicalRole: "audience", enabled: true }),
      normalizeDevice({ id: "right", type: "camera", name: "Right Camera", logicalRole: "right", enabled: true, presetSupport: true }),
      normalizeDevice({ id: "main", type: "camera", name: "Main Camera", logicalRole: "main", enabled: true, presetSupport: true, trackingEnabled: true }),
      normalizeDevice({ id: "left", type: "camera", name: "Left Camera", logicalRole: "left", enabled: false })
    ],
    cameras: [
      { id: "main", name: "Legacy Main", role: "main", savedPositions: [{ id: "pastor-tight", name: "Pastor Tight", number: 3 }, "Main Wide"] },
      { id: "left", name: "Legacy Left", role: "left", savedPositions: [{ id: "left-wide", name: "Left Wide", presetNumber: 8 }] }
    ],
    cameraPresets: null,
    productionLooks: [],
    cameraLayouts: [],
    runOfService: [],
    lightingScenes: [],
    live: { programCamera: "main", previewCamera: "left" }
  };
}

test("Camera Manager prioritizes main, left, and right while supporting additional cameras", () => {
  const current = state();
  current.cameraPresets = migrateLegacyPresets(current);
  assert.deepEqual(buildManagedCameraProjection(current).map(camera => camera.cameraDeviceId), ["main", "left", "right", "extra"]);
});

test("legacy center role and stable main ID retain Main camera priority", () => {
  const current = state();
  current.devices.find(device => device.id === "main").logicalRole = "center";
  current.devices.push(normalizeDevice({ id: "duplicate-center", type: "camera", name: "New Camera", logicalRole: "center", enabled: false }));
  current.cameraPresets = migrateLegacyPresets(current);
  assert.deepEqual(buildManagedCameraProjection(current).slice(0, 3).map(camera => camera.cameraDeviceId), ["main", "left", "right"]);
});

test("managed cameras resolve device, legacy record, and nullable operational state", () => {
  const current = state();
  current.cameraPresets = migrateLegacyPresets(current);
  assert.equal(resolveCameraDevice(current, "main").id, "main");
  assert.equal(resolveLegacyCamera(current, resolveCameraDevice(current, "main")).name, "Legacy Main");
  assert.equal(resolveCameraDevice(current, "missing"), null);
  const camera = normalizeManagedCamera(resolveCameraDevice(current, "main"), current);
  assert.equal(camera.programState, true);
  assert.equal(camera.currentPresetId, null);
  assert.equal(camera.firmwareVersion, null);
});

test("capabilities normalize supported, unsupported, unknown, and adapter-required states", () => {
  const device = normalizeDevice({
    id: "camera", type: "camera", name: "Camera", logicalRole: "main", enabled: true,
    protocol: "visca-over-ip", presetSupport: true, trackingEnabled: true,
    metadata: { cameraManager: { capabilities: { focus: false, tally: "unknown" } } }
  });
  const capabilities = resolveCameraCapabilities(device);
  assert.equal(capabilities.panTilt, "adapterRequired");
  assert.equal(capabilities.presetRecall, "supported");
  assert.equal(capabilities.tracking, "supported");
  assert.equal(capabilities.focus, "notSupported");
  assert.equal(capabilities.tally, "unknown");
  assert.equal(validateCameraCapabilities(capabilities).valid, true);
  assert.match(summarizeCameraCapabilities(capabilities).label, /Preset recall/);
});

test("legacy preset migration preserves IDs and numbers and is idempotent", () => {
  const current = state();
  const first = migrateLegacyPresets(current);
  assert.deepEqual(first.map(preset => preset.id), ["pastor-tight", "main-preset-2", "left-wide"]);
  assert.deepEqual(first.map(preset => preset.presetNumber), [3, 2, 8]);
  current.cameraPresets = first;
  assert.deepEqual(migrateLegacyPresets(current), first);
});

test("preset migration preserves missing-camera records with stable identity", () => {
  const current = state();
  current.cameras.push({ id: "missing-camera", role: "remote", savedPositions: [{ id: "remote-wide", name: "Remote Wide", number: 5 }] });
  const preset = migrateLegacyPresets(current).find(item => item.id === "remote-wide");
  assert.equal(preset.cameraDeviceId, "missing-camera");
  assert.equal(preset.logicalRole, "remote");
});

test("preset CRUD, favorite, custom category, reorder, and duplicate isolation", () => {
  const current = state();
  current.cameraPresets = [];
  const first = createCameraPreset(current, { cameraDeviceId: "main", name: "Pastor Tight", presetNumber: 1, category: "Pastor", favorite: true }, { id: "one", now: 1000 });
  const second = createCameraPreset(current, { cameraDeviceId: "main", name: "Piano", category: "Custom" }, { id: "two", now: 2000 });
  updateCameraPreset(current, first.id, { notes: "Updated", enabled: false }, { now: 3000 });
  const duplicate = duplicateCameraPreset(current, second.id, { id: "copy", now: 4000 });
  duplicate.notes = "isolated";
  assert.equal(current.cameraPresets.find(preset => preset.id === "two").notes, "");
  assert.equal(listPresetsByCamera(current, "main").length, 3);
  assert.equal(listPresetsByCategory(current, "Custom").length, 2);
  reorderCameraPreset(current, "main", 0, 2);
  assert.equal(listPresetsByCamera(current, "main").at(-1).id, "one");
  deleteCameraPreset(current, "copy");
  assert.equal(current.cameraPresets.some(preset => preset.id === "copy"), false);
});

test("all suggested and used custom preset categories are available", () => {
  const current = state();
  current.cameraPresets = [
    normalizeCameraPreset({ id: "custom", name: "Organ", cameraDeviceId: "main", category: "Organ Loft" }),
    normalizeCameraPreset({ id: "case", name: "Pastor", cameraDeviceId: "main", category: "pastor" })
  ];
  assert.deepEqual(SUGGESTED_PRESET_CATEGORIES, ["Pastor", "Platform", "Piano", "Choir", "Baptistry", "Congregation", "Wide", "Utility"]);
  assert.deepEqual(listCameraPresetCategories(current), [...SUGGESTED_PRESET_CATEGORIES, "Organ Loft"]);
  assert.equal(listPresetsByCategory(current, "PASTOR").length, 1);
});

test("custom category saves through serialized data and survives normalization", () => {
  const current = state();
  current.cameraPresets = [];
  createCameraPreset(current, { id: "preset", cameraDeviceId: "main", name: "Organ", category: "Organ Loft" });
  updateCameraPreset(current, "preset", { category: "Balcony Custom" });
  const restarted = migrateLegacyPresets(JSON.parse(JSON.stringify(current)));
  assert.equal(restarted[0].category, "Balcony Custom");
});

test("legacy categories and capitalization survive repeated migration", () => {
  const current = state();
  current.cameras[0].savedPositions = [{ id: "legacy-category", name: "Legacy", number: 7, category: "Special Music" }];
  const first = migrateLegacyPresets(current);
  current.cameraPresets = first;
  const second = migrateLegacyPresets(current);
  assert.equal(first.find(preset => preset.id === "legacy-category").category, "Special Music");
  assert.deepEqual(second, first);
});

test("uncategorized presets use Utility only as a category fallback", () => {
  const current = state();
  current.cameraPresets = [normalizeCameraPreset({ id: "uncategorized", name: "Wide", cameraDeviceId: "main", category: null })];
  assert.equal(current.cameraPresets[0].category, null);
  assert.equal(listPresetsByCategory(current, "Utility").length, 1);
  assert.equal(listCameraPresetCategories(current).includes("Utility"), true);
});

test("preset validation permits nullable numbers and rejects missing camera identity", () => {
  assert.equal(validateCameraPreset(normalizeCameraPreset({ id: "x", name: "Wide", cameraDeviceId: "main", presetNumber: null })).valid, true);
  assert.equal(validateCameraPreset(normalizeCameraPreset({ id: "x", name: "Wide" })).valid, false);
});

test("preset deletion is reference-aware and preserves visible missing references", () => {
  const current = state();
  current.cameraPresets = [normalizeCameraPreset({ id: "preset", name: "Pastor", cameraDeviceId: "main" })];
  current.productionLooks.push({ id: "look", name: "Look", cameraAssignments: [{ role: "program", cameraId: "main", presetId: "preset" }] });
  current.runOfService.push({ id: "cue", name: "Cue", cameraPresetId: "preset" });
  current.cameraLayouts.push({ id: "layout", name: "Layout", programPresetId: "preset" });
  assert.equal(countCameraPresetReferences(current, "preset").length, 3);
  assert.throws(() => deleteCameraPreset(current, "preset"), error => error.code === "CONFIRM_CAMERA_PRESET_DELETE");
  deleteCameraPreset(current, "preset", { confirmReferences: true });
  assert.equal(current.productionLooks[0].cameraAssignments[0].presetId, "preset");
});

test("missing and disabled cameras produce honest warnings and readiness", () => {
  const current = state();
  current.cameraPresets = migrateLegacyPresets(current);
  const left = buildManagedCameraProjection(current).find(camera => camera.cameraDeviceId === "left");
  assert.equal(left.readiness, "Disabled");
  current.cameraPresets.push(normalizeCameraPreset({ id: "orphan", name: "Orphan", cameraDeviceId: "missing" }));
  assert.equal(resolveCameraDevice(current, "missing"), null);
});

test("Browser Operator projection contains safe operational summaries only", () => {
  const current = state();
  current.cameraPresets = migrateLegacyPresets(current).map(preset => ({ ...preset, notes: "preset-private-note" }));
  current.devices[2] = normalizeDevice({ ...current.devices[2], username: "admin", password: "secret", credentialReference: "vault:key", notes: "private", ipAddress: "10.0.0.9" });
  const projected = projectBrowserState(current);
  const serialized = JSON.stringify(projected);
  assert.equal(projected.managedCameras[0].displayName, "Main Camera");
  assert.equal("capabilities" in projected.managedCameras[0], false);
  assert.equal("cameraPresets" in projected, false);
  assert.equal(projected.cameraPresetSummaries[0].name, "Pastor Tight");
  for (const privateValue of ["admin", "secret", "vault:key", "private", "10.0.0.9", "preset-private-note"]) assert.equal(serialized.includes(privateValue), false);
});

test("Production Look and cue execution references remain stable and pure", () => {
  const current = state();
  current.cameraPresets = migrateLegacyPresets(current);
  current.productionLooks.push({ id: "look", name: "Look", programCameraId: "main", previewCameraId: "left", cameraAssignments: [{ role: "program", cameraId: "main", presetId: "pastor-tight" }] });
  current.runOfService.push({ id: "cue", name: "Cue", productionLookId: "look", cameraLayoutId: "" });
  const before = JSON.stringify(current);
  const plan = buildCueExecutionPlan(current, current.runOfService[0]);
  assert.equal(plan.video.programCameraId, "main");
  assert.equal(plan.cameras[0].presetId, "pastor-tight");
  assert.equal(JSON.stringify(current), before);
  assert.equal(summarizeManagedCamera(buildManagedCameraProjection(current)[0]).cameraDeviceId, "main");
});
