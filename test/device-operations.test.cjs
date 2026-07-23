const test = require("node:test");
const assert = require("node:assert/strict");
const {
  browserSafeDeviceSummary,
  clearDeviceDiagnostic,
  countDeviceReferences,
  createDevice,
  deleteDevice,
  diagnosticResult,
  duplicateDevice,
  getDeviceById,
  getDeviceByLogicalRole,
  listDevicesByType,
  normalizeDevice,
  normalizeDeviceCollection,
  projectBrowserState,
  reorderDevice,
  runDeviceDiagnostic,
  summarizeDevice,
  updateDevice,
  validateDevice
} = require("../device-operations.cjs");
const { buildCueExecutionPlan } = require("../cue-execution-plan.cjs");

function state() {
  return {
    devices: normalizeDeviceCollection(null, {
      legacyCameras: [
        { id: "main", name: "Main Camera", role: "main", enabled: true },
        { id: "left", name: "Left Camera", role: "left", enabled: true },
        { id: "right", name: "Right Camera", role: "right", enabled: true }
      ]
    }),
    cameras: [
      { id: "main", name: "Legacy Main", savedPositions: [{ id: "wide" }] },
      { id: "left", name: "Legacy Left" },
      { id: "right", name: "Legacy Right" }
    ],
    productionLooks: [],
    cameraLayouts: [],
    runOfService: [],
    configuration: { secret: true }
  };
}

test("initial migration creates exactly one Main, Left, and Right camera plus placeholders", () => {
  const migrated = state();
  const cameras = listDevicesByType(migrated, "camera");
  assert.deepEqual(cameras.map(camera => camera.id), ["main", "left", "right"]);
  assert.deepEqual(cameras.map(camera => camera.logicalRole), ["main", "left", "right"]);
  assert.equal(migrated.devices.filter(device => device.id === "device-qlc").length, 1);
  assert.equal(migrated.devices.filter(device => device.id === "device-atem").length, 1);
  assert.equal(migrated.devices.filter(device => device.id === "device-x32").length, 1);
});

test("device migration is idempotent and never duplicates defaults", () => {
  const first = state().devices;
  const second = normalizeDeviceCollection(first, { legacyCameras: [] });
  assert.deepEqual(second, first);
  assert.equal(second.filter(device => device.id === "main").length, 1);
});

test("an explicitly empty device collection remains empty", () => {
  assert.deepEqual(normalizeDeviceCollection([], { legacyCameras: [{ id: "legacy", name: "Legacy Camera" }] }), []);
});

test("partial malformed legacy collections are tolerated without replacement", () => {
  const devices = normalizeDeviceCollection([{ id: "custom", type: "camera", name: "Custom", logicalRole: "balcony", enabled: true }, null, "bad"]);
  assert.deepEqual(devices.map(device => device.id), ["custom"]);
  assert.equal(devices[0].logicalRole, "balcony");
});

test("add, edit, duplicate, reorder, enable, and delete cameras", () => {
  const current = state();
  const camera = createDevice(current, { type: "camera", name: "Fourth", logicalRole: "audience", enabled: false }, { id: "fourth", now: 1000 });
  assert.equal(camera.id, "fourth");
  assert.equal(getDeviceByLogicalRole(current, "audience").id, "fourth");
  updateDevice(current, "fourth", { name: "Audience Camera", enabled: true, logicalRole: "custom-role" }, { now: 2000 });
  assert.equal(getDeviceById(current, "fourth").name, "Audience Camera");
  assert.equal(getDeviceById(current, "fourth").logicalRole, "custom-role");
  const copy = duplicateDevice(current, "fourth", { id: "copy", now: 3000 });
  assert.equal(copy.id, "copy");
  assert.equal(copy.logicalRole, "custom-role-copy");
  const before = current.devices.map(device => device.id);
  reorderDevice(current, 0, 2);
  assert.notDeepEqual(current.devices.map(device => device.id), before);
  deleteDevice(current, "copy");
  assert.equal(getDeviceById(current, "copy"), null);
});

test("duplicate enabled logical roles produce warnings without corrupting state", () => {
  const current = state();
  const duplicate = normalizeDevice({ id: "other-main", type: "camera", name: "Other Main", logicalRole: "main", enabled: true });
  current.devices.push(duplicate);
  const validation = validateDevice(duplicate, current);
  assert.equal(validation.valid, true);
  assert.match(validation.warnings[0], /main/i);
  assert.equal(current.devices.length, 9);
});

test("nullable incomplete configuration is honest in summaries", () => {
  const current = state();
  const camera = getDeviceById(current, "main");
  const summary = summarizeDevice(camera, current);
  assert.equal(summary.configured, false);
  assert.equal(summary.presetCount, 1);
  assert.equal(summary.connectionStatus, "notTested");
});

test("reference-aware deletion counts Looks, layouts, assignments, and cues", () => {
  const current = state();
  current.productionLooks.push({ id: "look", name: "Look", programCameraId: "main", cameraAssignments: [{ role: "pastor", cameraId: "main" }] });
  current.cameraLayouts.push({ id: "layout", name: "Layout", previewCamera: "main" });
  current.runOfService.push({ id: "cue", name: "Cue", cameraId: "main" });
  assert.equal(countDeviceReferences(current, "main").length, 4);
  assert.throws(() => deleteDevice(current, "main"), error => error.code === "CONFIRM_DEVICE_DELETE" && error.references.length === 4);
  deleteDevice(current, "main", { confirmReferences: true });
  assert.equal(current.productionLooks[0].programCameraId, "main");
  assert.equal(current.runOfService[0].cameraId, "main");
});

test("browser projection excludes credentials, usernames, notes, and configuration", () => {
  const current = state();
  updateDevice(current, "main", { username: "admin", password: "secret", credentialReference: "vault:item", notes: "private", ipAddress: "10.0.0.5" });
  const projected = projectBrowserState(current);
  const serialized = JSON.stringify(projected);
  assert.equal("devices" in projected, false);
  assert.equal("configuration" in projected, false);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("vault:item"), false);
  assert.equal(serialized.includes("admin"), false);
  assert.equal(serialized.includes("private"), false);
  assert.deepEqual(browserSafeDeviceSummary(getDeviceById(current, "main"), current), {
    id: "main", type: "camera", name: "Main Camera", logicalRole: "main", enabled: true, connectionStatus: "notTested"
  });
});

test("diagnostic stubs never report a fake connection", () => {
  const current = state();
  assert.equal(diagnosticResult(getDeviceById(current, "main"), 1000).message, "Not configured");
  assert.equal(diagnosticResult(getDeviceById(current, "device-qlc"), 1000).message, "Disabled");
  updateDevice(current, "main", { ipAddress: "10.0.0.5", protocol: "visca-over-ip" });
  assert.equal(runDeviceDiagnostic(current, "main", { now: 2000 }).message, "Adapter not implemented");
  assert.equal(getDeviceById(current, "main").metadata.diagnostic.status, "stub");
  clearDeviceDiagnostic(current, "main");
  assert.equal(getDeviceById(current, "main").metadata.diagnostic, undefined);
});

test("Production Look references and pure execution plans continue to resolve device IDs", () => {
  const current = state();
  current.lightingScenes = [];
  current.productionLooks.push({ id: "look", name: "Look", programCameraId: "main", previewCameraId: "left", cameraAssignments: [], transitionStyle: "cut" });
  const snapshot = JSON.stringify(current);
  const plan = buildCueExecutionPlan(current, { id: "cue", productionLookId: "look" });
  assert.equal(plan.video.programCameraId, "main");
  assert.equal(plan.video.previewCameraId, "left");
  assert.equal(plan.warnings.length, 0);
  assert.equal(JSON.stringify(current), snapshot);
});
