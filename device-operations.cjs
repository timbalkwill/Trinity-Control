"use strict";

const { buildManagedCameraProjection, summarizeManagedCamera } = require("./camera-manager-operations.cjs");
const DEVICE_SCHEMA_VERSION = 1;
const DEVICE_TYPES = new Set(["camera", "lighting", "switcher", "audio", "presentation", "browserOperator"]);
const EPOCH = "1970-01-01T00:00:00.000Z";

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function nullable(value) {
  const result = text(value);
  return result || null;
}

function uniqueId(type = "device") {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function portValue(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;
}

function normalizeDevice(input = {}, { now } = {}) {
  const type = DEVICE_TYPES.has(input.type) ? input.type : "camera";
  const createdAt = nullable(input.createdAt) || (now ? new Date(now).toISOString() : EPOCH);
  const connection = input.connection && typeof input.connection === "object" ? { ...input.connection } : {};
  const capabilities = input.capabilities && typeof input.capabilities === "object" ? { ...input.capabilities } : {};
  const metadata = input.metadata && typeof input.metadata === "object" ? JSON.parse(JSON.stringify(input.metadata)) : {};
  const camera = type === "camera";
  return {
    ...input,
    schemaVersion: DEVICE_SCHEMA_VERSION,
    id: nullable(input.id) || uniqueId(type),
    type,
    name: text(input.name, type === "camera" ? "Camera" : "Device") || "Device",
    enabled: input.enabled === true,
    status: nullable(input.status) || "notConfigured",
    createdAt,
    updatedAt: nullable(input.updatedAt) || createdAt,
    notes: text(input.notes),
    connection: {
      host: nullable(connection.host ?? input.ipAddress),
      port: portValue(connection.port ?? input.port),
      protocol: nullable(connection.protocol ?? input.protocol),
      username: nullable(connection.username ?? input.username),
      credentialReference: nullable(connection.credentialReference ?? input.credentialReference),
      password: nullable(connection.password ?? input.password)
    },
    capabilities: {
      tracking: capabilities.tracking === true || input.trackingEnabled === true,
      motion: capabilities.motion === true || input.motionEnabled === true,
      presets: capabilities.presets === true || input.presetSupport === true,
      ...capabilities
    },
    metadata,
    logicalRole: camera ? (nullable(input.logicalRole ?? input.role) || "camera") : null,
    manufacturer: camera ? text(input.manufacturer) : text(input.manufacturer),
    model: camera ? text(input.model) : text(input.model),
    ipAddress: camera ? nullable(input.ipAddress ?? connection.host) : nullable(input.ipAddress ?? connection.host),
    port: portValue(input.port ?? connection.port),
    protocol: nullable(input.protocol ?? connection.protocol),
    username: nullable(input.username ?? connection.username),
    credentialReference: nullable(input.credentialReference ?? connection.credentialReference),
    password: nullable(input.password ?? connection.password),
    trackingEnabled: camera ? (input.trackingEnabled === true || capabilities.tracking === true) : false,
    motionEnabled: camera ? (input.motionEnabled === true || capabilities.motion === true) : false,
    presetSupport: camera ? (input.presetSupport === true || capabilities.presets === true) : false,
    connectionStatus: nullable(input.connectionStatus) || "notTested",
    lastCheckedAt: nullable(input.lastCheckedAt),
    lastError: nullable(input.lastError)
  };
}

function cameraFromLegacy(camera, index) {
  const suggested = ["main", "left", "right"][index] || camera?.role || "camera";
  return normalizeDevice({
    id: camera?.id,
    type: "camera",
    name: camera?.name || `${suggested[0].toUpperCase()}${suggested.slice(1)} Camera`,
    logicalRole: camera?.logicalRole || camera?.role || suggested,
    manufacturer: camera?.manufacturer,
    model: camera?.model,
    ipAddress: camera?.host,
    port: camera?.port,
    protocol: camera?.protocol,
    enabled: camera?.enabled !== false,
    trackingEnabled: camera?.tracking === true,
    motionEnabled: camera?.motionEnabled === true,
    presetSupport: Array.isArray(camera?.savedPositions) ? camera.savedPositions.length > 0 : true,
    metadata: { legacyCameraId: camera?.id }
  });
}

function defaultPlaceholders() {
  return [
    { id: "device-qlc", type: "lighting", name: "QLC+", metadata: { adapter: "qlc-plus" } },
    { id: "device-atem", type: "switcher", name: "ATEM", metadata: { adapter: "atem" } },
    { id: "device-x32", type: "audio", name: "X32", metadata: { adapter: "x32" } },
    { id: "device-presentation", type: "presentation", name: "Presentation System" },
    { id: "device-browser-operator", type: "browserOperator", name: "Browser Operator" }
  ].map(device => normalizeDevice({ ...device, enabled: false }));
}

function defaultCameras() {
  return [
    { id: "main", name: "Main Camera", logicalRole: "main" },
    { id: "left", name: "Left Camera", logicalRole: "left" },
    { id: "right", name: "Right Camera", logicalRole: "right" }
  ].map(device => normalizeDevice({ ...device, type: "camera", enabled: true, presetSupport: true }));
}

function normalizeDeviceCollection(devices, { legacyCameras = [] } = {}) {
  if (Array.isArray(devices)) return devices.filter(item => item && typeof item === "object").map(normalizeDevice);
  const cameras = Array.isArray(legacyCameras) && legacyCameras.length
    ? legacyCameras.map(cameraFromLegacy)
    : defaultCameras();
  return [...cameras, ...defaultPlaceholders()];
}

function collection(state) {
  if (!Array.isArray(state.devices)) state.devices = [];
  return state.devices;
}

function validateDevice(device, state) {
  const errors = [];
  const warnings = [];
  if (!text(device?.name)) errors.push("Device name is required");
  if (!DEVICE_TYPES.has(device?.type)) errors.push("Unsupported device type");
  if (device?.type === "camera" && !text(device.logicalRole)) errors.push("Camera logical role is required");
  if (device?.port !== null && (!Number.isInteger(device.port) || device.port < 0 || device.port > 65535)) errors.push("Port must be between 0 and 65535");
  if (device?.type === "camera" && device.enabled) {
    const duplicates = (state?.devices || []).filter(item => item.id !== device.id && item.type === "camera" && item.enabled && item.logicalRole === device.logicalRole);
    if (duplicates.length) warnings.push(`Logical role "${device.logicalRole}" is also used by ${duplicates.map(item => item.name).join(", ")}`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

function createDevice(state, input = {}, { id, now = Date.now() } = {}) {
  const device = normalizeDevice({ ...input, id: input.id || id || uniqueId(input.type), createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }, { now });
  const validation = validateDevice(device, state);
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  if (collection(state).some(item => item.id === device.id)) throw new RangeError(`Device ID already exists: ${device.id}`);
  state.devices.push(device);
  return device;
}

function getDeviceById(state, deviceId) {
  return (state?.devices || []).find(device => device?.id === deviceId) || null;
}

function getDeviceByLogicalRole(state, role) {
  return (state?.devices || []).find(device => device?.type === "camera" && device.logicalRole === role) || null;
}

function listDevicesByType(state, type) {
  return (state?.devices || []).filter(device => !type || device?.type === type);
}

function updateDevice(state, deviceId, patch = {}, { now = Date.now() } = {}) {
  const index = collection(state).findIndex(device => device?.id === deviceId);
  if (index < 0) throw new RangeError(`Unknown device: ${deviceId}`);
  const current = state.devices[index];
  const updated = normalizeDevice({ ...current, ...patch, id: current.id, type: current.type, createdAt: current.createdAt, updatedAt: new Date(now).toISOString() }, { now });
  const validation = validateDevice(updated, state);
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  state.devices[index] = updated;
  return { device: updated, warnings: validation.warnings };
}

function duplicateDevice(state, deviceId, { id = uniqueId(), now = Date.now() } = {}) {
  const source = getDeviceById(state, deviceId);
  if (!source) throw new RangeError(`Unknown device: ${deviceId}`);
  const clone = JSON.parse(JSON.stringify(source));
  return createDevice(state, { ...clone, id, name: `${source.name} Copy`, logicalRole: source.type === "camera" ? `${source.logicalRole}-copy` : source.logicalRole }, { now });
}

function reorderDevice(state, from, to) {
  const devices = collection(state);
  if (![from, to].every(Number.isInteger) || from < 0 || to < 0 || from >= devices.length || to >= devices.length || from === to) return state;
  const [device] = devices.splice(from, 1);
  devices.splice(to, 0, device);
  return state;
}

function countDeviceReferences(state, deviceId) {
  const references = [];
  for (const look of state?.productionLooks || []) {
    if (look.programCameraId === deviceId) references.push({ type: "Production Look program camera", id: look.id, name: look.name });
    if (look.previewCameraId === deviceId) references.push({ type: "Production Look preview camera", id: look.id, name: look.name });
    for (const assignment of look.cameraAssignments || []) if (assignment.cameraId === deviceId) references.push({ type: `Production Look ${assignment.role}`, id: look.id, name: look.name });
  }
  for (const layout of state?.cameraLayouts || []) {
    if (layout.programCamera === deviceId || layout.previewCamera === deviceId) references.push({ type: "Camera layout", id: layout.id, name: layout.name });
  }
  for (const cue of state?.runOfService || []) {
    if (cue.cameraId === deviceId || cue.programCameraId === deviceId || cue.previewCameraId === deviceId) references.push({ type: "Cue", id: cue.id, name: cue.name });
  }
  for (const preset of state?.cameraPresets || []) {
    if (preset.cameraDeviceId === deviceId) references.push({ type: "Camera preset", id: preset.id, name: preset.name });
  }
  for (const shot of state?.shots || []) {
    if (shot.cameraDeviceId === deviceId) references.push({ type: "Shot", id: shot.id, name: shot.name });
  }
  return references;
}

function deleteDevice(state, deviceId, { confirmReferences = false } = {}) {
  const index = collection(state).findIndex(device => device?.id === deviceId);
  if (index < 0) throw new RangeError(`Unknown device: ${deviceId}`);
  const references = countDeviceReferences(state, deviceId);
  if (references.length && !confirmReferences) {
    const error = new Error(`This device is referenced ${references.length} time${references.length === 1 ? "" : "s"}`);
    error.code = "CONFIRM_DEVICE_DELETE";
    error.statusCode = 409;
    error.references = references;
    throw error;
  }
  state.devices.splice(index, 1);
  return { deletedId: deviceId, references: references.length };
}

function configured(device) {
  if (device?.type === "browserOperator") return true;
  if (device?.type === "camera") return Boolean(device.ipAddress && device.protocol);
  return Boolean(device?.connection?.host || device?.metadata?.configured);
}

function summarizeDevice(device, state) {
  const validation = validateDevice(device, state);
  return {
    id: device.id,
    type: device.type,
    name: device.name,
    logicalRole: device.logicalRole,
    enabled: device.enabled === true,
    configured: configured(device),
    connectionStatus: device.connectionStatus || "notTested",
    manufacturerModel: [device.manufacturer, device.model].filter(Boolean).join(" ") || null,
    host: device.ipAddress || device.connection?.host || null,
    lastCheckedAt: device.lastCheckedAt || null,
    lastError: device.lastError || null,
    warnings: validation.warnings,
    presetSupport: device.presetSupport === true,
    presetCount: Array.isArray((state?.cameras || []).find(camera => camera.id === device.id)?.savedPositions)
      ? (state.cameras.find(camera => camera.id === device.id).savedPositions.length)
      : 0
  };
}

function diagnosticResult(device, now = Date.now()) {
  let message = "Adapter not implemented";
  if (!device.enabled) message = "Disabled";
  else if (!configured(device)) message = "Not configured";
  else if (device.type === "browserOperator") message = "Ready for future test";
  return { status: "stub", message, testedAt: new Date(now).toISOString(), error: null };
}

function runDeviceDiagnostic(state, deviceId, options) {
  const device = getDeviceById(state, deviceId);
  if (!device) throw new RangeError(`Unknown device: ${deviceId}`);
  const result = diagnosticResult(device, options?.now);
  device.metadata = { ...device.metadata, diagnostic: result };
  device.lastCheckedAt = result.testedAt;
  device.lastError = result.error;
  return result;
}

function clearDeviceDiagnostic(state, deviceId) {
  const device = getDeviceById(state, deviceId);
  if (!device) throw new RangeError(`Unknown device: ${deviceId}`);
  device.metadata = { ...device.metadata };
  delete device.metadata.diagnostic;
  device.lastCheckedAt = null;
  device.lastError = null;
  return device;
}

function browserSafeDeviceSummary(device, state) {
  const summary = summarizeDevice(device, state);
  return {
    id: summary.id,
    type: summary.type,
    name: summary.name,
    logicalRole: summary.logicalRole,
    enabled: summary.enabled,
    connectionStatus: summary.connectionStatus
  };
}

function projectBrowserState(state) {
  const managedCameras = buildManagedCameraProjection(state).map(summarizeManagedCamera);
  const safeAssignment = item => ({
    role: item?.role || null,
    shotId: item?.shotId || null,
    shotName: item?.shotName || null,
    cameraDeviceId: item?.cameraDeviceId || item?.cameraId || null,
    cameraName: item?.cameraName || null,
    presetId: item?.presetId || null,
    presetName: item?.presetName || null,
    tracking: item?.tracking ? {
      mode: item.tracking.mode || null,
      preferred: item.tracking.preferred === true,
      subject: item.tracking.subject || null
    } : null,
    motion: item?.motion ? {
      enabled: item.motion.enabled === true,
      profileId: item.motion.profileId || null,
      durationMs: Number(item.motion.durationMs) || 0,
      speed: Number(item.motion.speed) || 1
    } : null,
    source: item?.source || null,
    missing: item?.missing === true,
    warnings: Array.isArray(item?.warnings) ? item.warnings.map(String) : []
  });
  const executionSnapshot = state?.live?.executionSnapshot;
  const projected = {
    ...state,
    live: {
      ...(state?.live || {}),
      executionSnapshot: executionSnapshot ? {
        ...executionSnapshot,
        cameraAssignments: (executionSnapshot.cameraAssignments || []).map(safeAssignment),
        cameras: (executionSnapshot.cameras || []).map(safeAssignment)
      } : null
    },
    cameras: (state?.cameras || []).map(camera => ({
      id: camera.id,
      name: camera.name,
      role: camera.role,
      online: camera.online,
      enabled: camera.enabled
    })),
    deviceSummaries: (state?.devices || []).filter(device => device.enabled || device.type === "camera").map(device => browserSafeDeviceSummary(device, state)),
    managedCameras,
    shotSummaries: (state?.shots || []).map(shot => ({
      id: shot.id,
      name: shot.name,
      enabled: shot.enabled !== false,
      category: shot.category || null,
      cameraDeviceId: shot.cameraDeviceId || null,
      logicalCameraRole: shot.logicalCameraRole || null,
      cameraPresetId: shot.cameraPresetId || null
    })),
    cameraPresetSummaries: (state?.cameraPresets || []).map(preset => ({
      id: preset.id,
      name: preset.name,
      cameraDeviceId: preset.cameraDeviceId,
      logicalRole: preset.logicalRole,
      enabled: preset.enabled !== false,
      favorite: preset.favorite === true,
      category: preset.category || null
    }))
  };
  delete projected.devices;
  delete projected.cameraPresets;
  delete projected.shots;
  delete projected.configuration;
  return projected;
}

module.exports = {
  DEVICE_SCHEMA_VERSION,
  browserSafeDeviceSummary,
  clearDeviceDiagnostic,
  countDeviceReferences,
  createDevice,
  defaultCameras,
  defaultPlaceholders,
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
};
