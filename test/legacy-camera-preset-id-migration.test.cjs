"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  duplicateCameraPresetIds,
  hasDuplicateCameraPresetIds,
  migrateDuplicateCameraPresetIds
} = require("../camera-preset-operations.cjs");
const { createBackupEnvelope, validateBackupEnvelope } = require("../backup-operations.cjs");

const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const cameras = ["main", "left", "right"];
  return {
    schemaVersion: 7,
    devices: cameras.map(id => ({ id, type: "camera", name: `${id} display name`, logicalRole: id })),
    cameras: cameras.map(id => ({ id, name: `${id} legacy`, role: id, savedPositions: [{ id: "position-1", name: "Wide" }, { id: "position-2", name: "Tight" }] })),
    cameraPresets: cameras.flatMap(cameraDeviceId => [
      { id: "position-1", name: "Wide", cameraDeviceId },
      { id: "position-2", name: "Tight", cameraDeviceId }
    ]).concat({ id: "already-unique", name: "Unique", cameraDeviceId: "main" }),
    shots: [
      { id: "static-shot", name: "Static", shotType: "static", cameraDeviceId: "main", cameraPresetId: "position-1" },
      { id: "motion-shot", name: "Motion", shotType: "motion", cameraDeviceId: "left", cameraPresetId: "position-1", motionEndPresetId: "position-2" },
      { id: "tracking-shot", name: "Tracking", shotType: "tracking", cameraDeviceId: "right", cameraPresetId: "position-2" }
    ],
    lightingScenes: [{ id: "light", name: "Light" }],
    productionLooks: [{
      id: "look", name: "Look", lightingSceneId: "light",
      cameraPresets: Object.fromEntries(cameras.map(cameraId => [cameraId, { cameraId, presetId: "position-1" }])),
      cameraAssignments: [{ role: "left", cameraDeviceId: "left", presetId: "position-2", shotId: "motion-shot" }]
    }],
    cueTemplates: [{ id: "template", name: "Template", cameraDeviceId: "right", cameraPresetId: "position-1" }],
    runOfService: [{ id: "cue", name: "Cue", productionLookId: "look", cameraDeviceId: "main", presetId: "position-2" }],
    cameraLayouts: [{ id: "layout", name: "Layout", programCamera: "main", programPresetId: "position-1", previewCamera: "right", previewPresetId: "position-2" }],
    live: {
      cameraPreparations: cameras.map(cameraId => ({
        cameraId, selectedPresetId: "position-1", preparedAssignment: { cameraId, presetId: "position-1", startingPresetId: "position-2" }
      })),
      activeCameraAssignment: { cameraId: "left", presetId: "position-2" },
      manualMotionCommands: { right: { startPresetId: "position-1", endPresetId: "position-2" } }
    }
  };
}

test("detects every duplicate legacy camera preset ID", () => {
  const state = fixture();
  assert.equal(hasDuplicateCameraPresetIds(state), true);
  assert.deepEqual([...duplicateCameraPresetIds(state)].sort(), ["position-1", "position-2"]);
});

test("round trip gives every collision a deterministic camera-ID-based replacement and rewrites all references", () => {
  const original = fixture();
  const migrated = migrateDuplicateCameraPresetIds(original);
  assert.equal(new Set(migrated.cameraPresets.map(item => item.id)).size, 7);
  assert.deepEqual(migrated.cameraPresets.slice(0, 6).map(item => item.id), [
    "preset-main-position-1", "preset-main-position-2",
    "preset-left-position-1", "preset-left-position-2",
    "preset-right-position-1", "preset-right-position-2"
  ]);
  assert.equal(migrated.cameraPresets.at(-1).id, "already-unique");
  assert.deepEqual(migrated.devices.map(item => item.id), ["main", "left", "right"]);
  assert.deepEqual(migrated.shots.map(item => item.id), ["static-shot", "motion-shot", "tracking-shot"]);
  assert.equal(migrated.shots[0].cameraPresetId, "preset-main-position-1");
  assert.equal(migrated.shots[1].cameraPresetId, "preset-left-position-1");
  assert.equal(migrated.shots[1].motionEndPresetId, "preset-left-position-2");
  assert.equal(migrated.shots[2].cameraPresetId, "preset-right-position-2");
  assert.equal(migrated.productionLooks[0].cameraPresets.main.presetId, "preset-main-position-1");
  assert.equal(migrated.productionLooks[0].cameraPresets.left.presetId, "preset-left-position-1");
  assert.equal(migrated.productionLooks[0].cameraAssignments[0].presetId, "preset-left-position-2");
  assert.equal(migrated.runOfService[0].presetId, "preset-main-position-2");
  assert.equal(migrated.cueTemplates[0].cameraPresetId, "preset-right-position-1");
  assert.equal(migrated.cameraLayouts[0].programPresetId, "preset-main-position-1");
  assert.equal(migrated.cameraLayouts[0].previewPresetId, "preset-right-position-2");
  assert.equal(migrated.live.cameraPreparations[0].selectedPresetId, "preset-main-position-1");
  assert.equal(migrated.live.cameraPreparations[1].preparedAssignment.startingPresetId, "preset-left-position-2");
  assert.equal(migrated.live.activeCameraAssignment.presetId, "preset-left-position-2");
  assert.equal(migrated.live.manualMotionCommands.right.startPresetId, "preset-right-position-1");
  assert.equal(migrated.live.manualMotionCommands.right.endPresetId, "preset-right-position-2");
  assert.equal(migrated.productionLooks[0].id, "look");
  assert.equal(migrated.runOfService[0].id, "cue");
  assert.equal(migrated.lightingScenes[0].id, "light");
  assert.notDeepEqual(migrated, original);
  assert.deepEqual(original, fixture(), "migration must not partially mutate its input");
});

test("replacement uses stable camera IDs rather than mutable display names", () => {
  const state = fixture();
  state.devices.forEach(device => { device.name = `Renamed ${Math.random()}`; });
  const migrated = migrateDuplicateCameraPresetIds(state);
  assert.ok(migrated.cameraPresets.some(item => item.id === "preset-left-position-1"));
  assert.ok(migrated.cameraPresets.every(item => !item.id.includes("renamed")));
});

test("migration is idempotent and resulting backup passes strict global-ID validation", () => {
  const once = migrateDuplicateCameraPresetIds(fixture());
  const twice = migrateDuplicateCameraPresetIds(once);
  assert.deepEqual(twice, once);
  const envelope = createBackupEnvelope(once, { trinityVersion: "1.0.2", now: 0 });
  assert.doesNotThrow(() => validateBackupEnvelope(envelope));
  envelope.data.cameraPresets[1].id = envelope.data.cameraPresets[0].id;
  assert.throws(() => validateBackupEnvelope(envelope), /duplicate ID/);
});

test("ambiguous reference fails without guessing or mutating source state", () => {
  const state = fixture();
  state.runOfService[0] = { id: "cue", name: "Ambiguous", presetId: "position-1", productionLookId: "look" };
  const before = clone(state);
  assert.throws(() => migrateDuplicateCameraPresetIds(state), error => error.code === "CAMERA_PRESET_MIGRATION_AMBIGUOUS" && /runOfService/.test(error.message));
  assert.deepEqual(state, before);
});

test("duplicate records within one camera fail because references cannot distinguish them", () => {
  const state = fixture();
  state.cameraPresets.push({ id: "position-1", name: "Another Main", cameraDeviceId: "main" });
  assert.throws(() => migrateDuplicateCameraPresetIds(state), /more than once for camera main/);
});

test("startup integration migrates before backup and preserves a raw recovery file", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "electron-main.cjs"), "utf8");
  assert.match(main, /hasDuplicateCameraPresetIds\(parsed\)/);
  assert.match(main, /migrateDuplicateCameraPresetIds\(merged\)/);
  assert.match(main, /trinity-data-before-preset-id-migration-/);
  assert.match(main, /atomicWrite\(path\.join\(recoveryDirectory/);
  assert.match(main, /if \(error\?\.code === "CAMERA_PRESET_MIGRATION_AMBIGUOUS"\) throw error/);
});
