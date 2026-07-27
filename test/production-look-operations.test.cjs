const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PRODUCTION_LOOK_SCHEMA_VERSION,
  createProductionLook,
  deleteProductionLook,
  duplicateProductionLook,
  normalizeProductionLook,
  normalizeProductionLooks,
  readinessWarnings,
  searchProductionLooks,
  updateProductionLook,
  validateProductionLook
} = require("../production-look-operations.cjs");

const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  return {
    devices: [
      { id: "main", type: "camera", name: "Main Camera", logicalRole: "main", enabled: true, trackingEnabled: true },
      { id: "left", type: "camera", name: "Left Camera", logicalRole: "left", enabled: true },
      { id: "right", type: "camera", name: "Right Camera", logicalRole: "right", enabled: true }
    ],
    cameraPresets: [
      { id: "main-wide", name: "Wide", cameraDeviceId: "main", enabled: true },
      { id: "left-tight", name: "Tight", cameraDeviceId: "left", enabled: true },
      { id: "right-wide", name: "Wide", cameraDeviceId: "right", enabled: true }
    ],
    lightingScenes: [{ id: "warm", name: "Warm" }],
    cameraLayouts: [{ id: "legacy-layout", programCamera: "left", programPreset: "Tight", previewCamera: "main", previewPreset: "Wide" }],
    shots: [{ id: "legacy-shot", name: "Legacy", enabled: true, cameraDeviceId: "main", cameraPresetId: "main-wide" }],
    productionLooks: [],
    runOfService: [],
    live: { executionSnapshot: { cueId: "frozen" } }
  };
}

test("v3 migration preserves stable identity, name, enabled state, lighting, and metadata", () => {
  const state = fixture();
  const migrated = normalizeProductionLook({
    id: "legacy", name: "  Legacy  ", enabled: false, lightingSceneId: "warm",
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2021-01-01T00:00:00.000Z"
  }, { state });
  assert.equal(migrated.schemaVersion, PRODUCTION_LOOK_SCHEMA_VERSION);
  assert.equal(migrated.id, "legacy");
  assert.equal(migrated.name, "Legacy");
  assert.equal(migrated.enabled, false);
  assert.equal(migrated.lightingSceneId, "warm");
  assert.equal(migrated.createdAt, "2020-01-01T00:00:00.000Z");
});

test("legacy layout maps priority and role presets without inventing references", () => {
  const state = fixture();
  const migrated = normalizeProductionLook({ id: "look", name: "Look", cameraLayoutId: "legacy-layout" }, { state });
  assert.equal(migrated.priorityCameraId, "left");
  assert.deepEqual(migrated.cameraPresets.main, { cameraId: "main", presetId: "main-wide" });
  assert.deepEqual(migrated.cameraPresets.left, { cameraId: "left", presetId: "left-tight" });
  assert.deepEqual(migrated.cameraPresets.right, { cameraId: "right", presetId: null });
});

test("valid linked legacy Shot preset migrates while invalid Shot does not invent a preset", () => {
  const state = fixture();
  const valid = normalizeProductionLook({ name: "Valid", selectedShotId: "legacy-shot" }, { state });
  const invalid = normalizeProductionLook({ name: "Invalid", selectedShotId: "missing-shot" }, { state });
  assert.equal(valid.cameraPresets.main.presetId, "main-wide");
  assert.equal(valid.priorityCameraId, "main");
  assert.equal(invalid.cameraPresets.main.presetId, null);
});


test("v3 normalization repairs stale role camera IDs from valid role-scoped presets", () => {
  const state = fixture();
  const normalized = normalizeProductionLook({
    id: "stale",
    name: "Stale assignments",
    cameraPresets: {
      main: { cameraId: "main", presetId: "main-wide" },
      left: { cameraId: "main", presetId: "left-tight" },
      right: { cameraId: "left", presetId: "right-wide" }
    }
  }, { state });

  assert.deepEqual(normalized.cameraPresets.main, { cameraId: "main", presetId: "main-wide" });
  assert.deepEqual(normalized.cameraPresets.left, { cameraId: "left", presetId: "left-tight" });
  assert.deepEqual(normalized.cameraPresets.right, { cameraId: "right", presetId: "right-wide" });
  assert.equal(validateProductionLook(normalized, state).valid, true);
});

test("duplicate repairs stale role camera IDs and copies all simplified fields", () => {
  const state = fixture();
  state.productionLooks.push({
    schemaVersion: PRODUCTION_LOOK_SCHEMA_VERSION,
    id: "source",
    name: "Source",
    enabled: false,
    lightingSceneId: "warm",
    cameraPresets: {
      main: { cameraId: "main", presetId: "main-wide" },
      left: { cameraId: "main", presetId: "left-tight" },
      right: { cameraId: "left", presetId: "right-wide" }
    },
    priorityCameraId: "left",
    startMainTracking: true,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z"
  });

  const copy = duplicateProductionLook(state, "source", { id: "copy-fixed", now: 4 });
  assert.equal(copy.id, "copy-fixed");
  assert.equal(copy.name, "Source Copy");
  assert.equal(copy.enabled, false);
  assert.equal(copy.lightingSceneId, "warm");
  assert.deepEqual(copy.cameraPresets.left, { cameraId: "left", presetId: "left-tight" });
  assert.deepEqual(copy.cameraPresets.right, { cameraId: "right", presetId: "right-wide" });
  assert.equal(copy.priorityCameraId, "left");
  assert.equal(copy.startMainTracking, true);
});
test("migration is deterministic, idempotent, malformed-safe, and preserves empty collections", () => {
  const state = fixture();
  const once = normalizeProductionLook({ id: "one", name: null, cameraPresets: { main: null } }, { state });
  assert.deepEqual(normalizeProductionLook(once, { state }), once);
  assert.deepEqual(normalizeProductionLooks([], { state }), []);
});

test("CRUD, duplicate, search, enable/disable, and reference-aware deletion use stable narrow records", () => {
  const state = fixture();
  const created = createProductionLook(state, {
    id: "look", name: "Welcome", lightingSceneId: "warm",
    cameraPresets: { main: { cameraId: "main", presetId: "main-wide" } },
    priorityCameraId: "main", startMainTracking: true
  }, { now: 1 });
  const frozen = clone(state.live.executionSnapshot);
  updateProductionLook(state, created.id, { name: "Welcome Updated", enabled: false }, { now: 2 });
  assert.deepEqual(state.live.executionSnapshot, frozen);
  assert.equal(searchProductionLooks(state.productionLooks, "updated").length, 1);
  const copy = duplicateProductionLook(state, created.id, { id: "copy", now: 3 });
  assert.equal(copy.id, "copy");
  assert.equal(copy.cameraPresets.main.presetId, "main-wide");
  state.runOfService.push({ id: "cue", productionLookId: "look" });
  assert.throws(() => deleteProductionLook(state, "look"), error => error.code === "CONFIRM_LOOK_DELETE");
  deleteProductionLook(state, "look", { confirmReferences: true });
  assert.equal(state.runOfService[0].productionLookId, "look");
  assert.deepEqual(state.live.executionSnapshot, frozen);
});

test("validation rejects empty names and cross-camera presets", () => {
  const state = fixture();
  assert.equal(validateProductionLook(normalizeProductionLook({ name: "" }, { state }), state).valid, false);
  assert.throws(() => createProductionLook(state, {
    name: "Wrong",
    cameraPresets: { main: { cameraId: "main", presetId: "left-tight" } }
  }), /another camera/i);
});

test("repairable missing references and unsupported tracking produce warnings", () => {
  const state = fixture();
  state.devices[0].trackingEnabled = false;
  const look = normalizeProductionLook({
    name: "Repairable", lightingSceneId: "missing-light",
    cameraPresets: { right: { cameraId: "missing-camera", presetId: "missing-preset" } },
    priorityCameraId: "missing-priority", startMainTracking: true
  }, { state });
  const warnings = readinessWarnings(state, look).join("; ");
  assert.match(warnings, /Missing lighting scene/);
  assert.match(warnings, /Missing Right camera/);
  assert.match(warnings, /Missing Right preset/);
  assert.match(warnings, /Missing priority camera/);
  assert.match(warnings, /tracking is not supported/);
});

test("duplicate preset IDs are resolved by camera role, not globally", () => {
  const state = fixture();
  state.cameraPresets = [
    { id: "position-1", name: "Main Position 1", cameraDeviceId: "main", enabled: true },
    { id: "position-2", name: "Main Position 2", cameraDeviceId: "main", enabled: true },
    { id: "position-3", name: "Main Position 3", cameraDeviceId: "main", enabled: true },
    { id: "position-1", name: "Left Position 1", cameraDeviceId: "left", enabled: true },
    { id: "position-2", name: "Left Position 2", cameraDeviceId: "left", enabled: true },
    { id: "position-3", name: "Left Position 3", cameraDeviceId: "left", enabled: true },
    { id: "position-1", name: "Right Position 1", cameraDeviceId: "right", enabled: true },
    { id: "position-2", name: "Right Position 2", cameraDeviceId: "right", enabled: true },
    { id: "position-3", name: "Right Position 3", cameraDeviceId: "right", enabled: true }
  ];

  const normalized = normalizeProductionLook({
    id: "duplicate-ids",
    name: "Duplicate IDs",
    cameraPresets: {
      main: { cameraId: "main", presetId: "position-1" },
      left: { cameraId: "main", presetId: "position-2" },
      right: { cameraId: "main", presetId: "position-3" }
    }
  }, { state });

  assert.deepEqual(normalized.cameraPresets, {
    main: { cameraId: "main", presetId: "position-1" },
    left: { cameraId: "left", presetId: "position-2" },
    right: { cameraId: "right", presetId: "position-3" }
  });
  assert.equal(validateProductionLook(normalized, state).valid, true);
  assert.deepEqual(readinessWarnings(state, normalized), []);
});
