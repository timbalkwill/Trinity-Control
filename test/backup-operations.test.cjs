"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  BACKUP_FORMAT_VERSION,
  createBackupEnvelope,
  createBackupManager,
  extractPortableState,
  parseBackup,
  validateBackupEnvelope
} = require("../backup-operations.cjs");

const clone = value => JSON.parse(JSON.stringify(value));

function fixture(label = "A") {
  return {
    version: "1.0.2",
    schemaVersion: 7,
    settings: { qlcplusService: { manageAutomatically: true, applicationPath: `/Applications/${label}.app`, workspacePath: `/Users/test/${label}.qxw`, startupTimeoutMs: 9000 } },
    devices: [
      { id: "main", type: "camera", name: `Main ${label}`, ipAddress: "camera.local", password: "camera-secret", credentialReference: "camera-password", metadata: { diagnostic: { message: "online" }, cameraManager: { capabilities: { motion: "supported" } } } },
      { id: "lights", type: "lighting", name: "QLC+", ipAddress: "lighting.local", metadata: { qlcplusWidgets: [{ id: "runtime" }], qlcplusProductionPage: "TRINITY" } },
      { id: "atem", type: "switcher", name: "ATEM", ipAddress: "atem.local", metadata: { adapter: "atem", atemCameraInputs: { main: 2 } } }
    ],
    cameraPresets: [{ id: "main-wide", name: "Wide", cameraDeviceId: "main", presetNumber: 4 }],
    shots: [{ id: "main-motion", name: "Push", shotType: "motion", cameraDeviceId: "main", cameraPresetId: "main-wide", motionEndPresetId: "main-wide" }],
    lightingScenes: [{ id: "warm", name: "Warm", externalControlMapping: { widgetId: "44" } }],
    productionLooks: [{ id: "sermon-look", name: "Sermon", lightingSceneId: "warm", cameraAssignments: [{ role: "main", shotId: "main-motion" }] }],
    cueTemplates: [{ id: "sermon-template", name: "Sermon", productionLookId: "sermon-look" }],
    runOfService: [{ id: "sermon-cue", name: `Sermon ${label}`, productionLookId: "sermon-look" }],
    live: {
      cueIndex: 8, programCamera: "main", previewCamera: "left", executionSnapshot: { id: "runtime" },
      manualMotionCommands: { main: { shotId: "main-motion", status: "commanded" } },
      cameraPreparations: [{ cameraId: "main", preparationStatus: "running" }], activityLog: [{ message: "runtime" }]
    },
    processInfo: { pid: 123 },
    temporaryDiagnostics: { cpu: 99 }
  };
}

test("portable export is versioned, counted, relationship-preserving, and secret-free", () => {
  const state = fixture();
  const before = clone(state);
  const envelope = createBackupEnvelope(state, { trinityVersion: "1.0.3", now: Date.UTC(2026, 7, 3, 12) });
  assert.equal(envelope.backupFormatVersion, BACKUP_FORMAT_VERSION);
  assert.equal(envelope.trinityVersion, "1.0.3");
  assert.equal(envelope.createdAt, "2026-08-03T12:00:00.000Z");
  assert.equal(envelope.counts.serviceCues, 1);
  assert.equal(envelope.counts.cameras, 1);
  assert.equal(envelope.data.cameraPresets[0].cameraDeviceId, "main");
  assert.equal(envelope.data.shots[0].cameraPresetId, "main-wide");
  assert.equal(envelope.data.runOfService[0].productionLookId, "sermon-look");
  assert.equal(envelope.data.productionLooks[0].lightingSceneId, "warm");
  assert.deepEqual(envelope.data.devices.find(item => item.id === "atem").metadata.atemCameraInputs, { main: 2 });
  assert.equal(envelope.data.devices[0].password, undefined);
  assert.equal(envelope.data.devices[0].credentialReference, undefined);
  assert.equal(envelope.data.devices[0].metadata.diagnostic, undefined);
  assert.equal(envelope.data.devices[1].metadata.qlcplusWidgets, undefined);
  assert.equal(envelope.data.settings.qlcplusService.applicationPath, undefined);
  assert.equal(envelope.data.settings.qlcplusService.workspacePath, undefined);
  assert.equal(envelope.data.live, undefined);
  assert.equal(envelope.data.processInfo, undefined);
  assert.deepEqual(state, before, "export must be read-only");
  assert.doesNotMatch(JSON.stringify(envelope), /camera-secret|camera-password|preparationStatus|programCamera/);
});

test("preview validates without modifying current state", () => {
  const current = fixture("current");
  const before = clone(current);
  const serialized = JSON.stringify(createBackupEnvelope(fixture("backup"), { trinityVersion: "1.0.2" }));
  const parsed = parseBackup(serialized);
  assert.equal(parsed.preview.counts.devices, 3);
  assert.deepEqual(current, before);
});

test("invalid, truncated, malformed-ID, and future backups are rejected", () => {
  assert.throws(() => parseBackup("{truncated"), /not valid JSON|truncated/);
  assert.throws(() => validateBackupEnvelope({}), /format/i);
  const future = createBackupEnvelope(fixture(), { trinityVersion: "1" });
  future.backupFormatVersion = BACKUP_FORMAT_VERSION + 1;
  assert.throws(() => validateBackupEnvelope(future), /newer version/);
  const malformed = createBackupEnvelope(fixture(), { trinityVersion: "1" });
  malformed.data.devices[0].id = "";
  assert.throws(() => validateBackupEnvelope(malformed), /valid ID/);
});

test("confirmed import creates recovery backup and atomically round-trips portable state", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "trinity-backup-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let persisted = fixture("A");
  let replaceCalls = 0;
  const manager = createBackupManager({
    getState: () => clone(persisted),
    replaceState: async next => { replaceCalls += 1; persisted = clone(next); return clone(persisted); },
    normalizeState: state => state,
    trinityVersion: "1.0.3",
    userDataPath: directory,
    now: () => Date.UTC(2026, 7, 3, 12, 34, 56)
  });
  const backupPath = path.join(directory, "A.trinitybackup");
  const portableA = extractPortableState(persisted);
  manager.exportTo(backupPath);
  persisted = fixture("B");
  const transientB = clone(persisted.live);
  assert.equal(manager.previewFile(backupPath).counts.serviceCues, 1);
  assert.equal(replaceCalls, 0, "preview cannot import");
  const result = await manager.importFile(backupPath);
  assert.equal(replaceCalls, 1);
  assert.deepEqual(extractPortableState(persisted), portableA);
  assert.equal(persisted.live, undefined, "runtime state from neither computer is restored");
  assert.notDeepEqual(persisted.live, transientB);
  assert.equal(result.restartRequired, true);
  assert.ok(fs.existsSync(result.recoveryPath));
  const recovery = parseBackup(fs.readFileSync(result.recoveryPath, "utf8")).envelope;
  assert.equal(recovery.data.runOfService[0].name, "Sermon B");
  assert.equal(persisted.devices[0].id, "main");
  assert.equal(persisted.cameraPresets[0].id, "main-wide");
  assert.equal(persisted.shots[0].id, "main-motion");
});

test("validation failure before import leaves state untouched and creates no recovery", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "trinity-invalid-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let persisted = fixture();
  const before = clone(persisted);
  let replaceCalls = 0;
  const manager = createBackupManager({
    getState: () => clone(persisted), replaceState: async next => { replaceCalls += 1; persisted = clone(next); return persisted; },
    userDataPath: directory, trinityVersion: "1"
  });
  const invalidPath = path.join(directory, "bad.trinitybackup");
  fs.writeFileSync(invalidPath, JSON.stringify({ backupFormatVersion: 999, data: {} }));
  await assert.rejects(manager.importFile(invalidPath), /newer version/);
  assert.equal(replaceCalls, 0);
  assert.deepEqual(persisted, before);
  assert.equal(fs.existsSync(path.join(directory, "Trinity Recovery Backups")), false);
});

test("desktop integration requires preview and explicit import confirmation", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "electron-main.cjs"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.cjs"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(main, /dialog\.showSaveDialog/);
  assert.match(main, /dialog\.showOpenDialog/);
  assert.match(main, /backupManager\.previewFile/);
  assert.match(main, /backupManager\.importFile/);
  assert.match(preload, /selectTrinityBackup/);
  assert.match(preload, /importTrinityBackup/);
  assert.match(renderer, /SELECT BACKUP FILE/);
  assert.match(renderer, /IMPORT BACKUP/);
  assert.match(renderer, /This is a replace operation/);
  assert.ok(renderer.indexOf("selectTrinityBackup") < renderer.indexOf("importTrinityBackup"));
});

test("backup implementation contains no hardware execution dependency or command", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "backup-operations.cjs"), "utf8");
  assert.doesNotMatch(source, /recallPreset|runCameraMotion|takeLive|executeLighting|goCue|nextCue|previousCue|atemService|cameraExecutor/i);
});
