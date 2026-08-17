"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BACKUP_FORMAT_VERSION = 1;
const BACKUP_EXTENSION = "trinitybackup";
const PORTABLE_ARRAY_KEYS = Object.freeze([
  "cameras", "devices", "cameraPresets", "shots", "lightingScenes", "cameraLayouts",
  "productionLooks", "cueTemplates", "runOfService", "motionStudioReferences", "videoSources"
]);
const PORTABLE_SCALAR_KEYS = Object.freeze([
  "schemaVersion", "deviceSchemaVersion", "cameraManagerSchemaVersion", "cameraPresetSchemaVersion",
  "shotSchemaVersion", "lightingSceneSchemaVersion"
]);
const RUNTIME_METADATA_KEYS = new Set([
  "diagnostic", "lightingDiagnostic", "lastDiagnostic", "qlcplusWidgets", "qlcplusPages", "lightingReconciliation",
  "connection", "connectionStatus", "lastCheckedAt", "lastError", "health", "runtime"
]);
const SECRET_KEYS = new Set(["password", "credentialReference", "token", "apiToken", "accessToken"]);

const clone = value => JSON.parse(JSON.stringify(value));
const record = value => value && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" ? value.trim() : "";

function sanitizePortableValue(value, { metadata = false } = {}) {
  if (Array.isArray(value)) return value.map(item => sanitizePortableValue(item));
  if (!record(value)) return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue;
    if (metadata && RUNTIME_METADATA_KEYS.has(key)) continue;
    output[key] = sanitizePortableValue(child, { metadata: key === "metadata" });
  }
  return output;
}

function portableSettings(settings) {
  const output = sanitizePortableValue(record(settings) ? settings : {});
  if (record(output.qlcplusService)) {
    delete output.qlcplusService.applicationPath;
    delete output.qlcplusService.workspacePath;
    output.qlcplusService.manageAutomatically = false;
  }
  return output;
}

function extractPortableState(state) {
  if (!record(state)) throw Object.assign(new TypeError("Trinity state is unavailable"), { code: "BACKUP_STATE_INVALID" });
  const output = { settings: portableSettings(state.settings) };
  for (const key of PORTABLE_SCALAR_KEYS) {
    if (state[key] !== undefined) output[key] = clone(state[key]);
  }
  for (const key of PORTABLE_ARRAY_KEYS) {
    if (Array.isArray(state[key])) output[key] = sanitizePortableValue(state[key]);
  }
  return output;
}

function backupCounts(data) {
  const count = key => Array.isArray(data?.[key]) ? data[key].length : 0;
  return {
    servicePlans: 0,
    serviceCues: count("runOfService"),
    quickAddTemplates: count("cueTemplates"),
    productionLooks: count("productionLooks"),
    lightingScenes: count("lightingScenes"),
    cameras: (data?.devices || []).filter(item => item?.type === "camera").length,
    cameraPresets: count("cameraPresets"),
    shots: count("shots"),
    devices: count("devices")
  };
}

function createBackupEnvelope(state, { trinityVersion, now = Date.now } = {}) {
  const data = extractPortableState(state);
  return {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    trinityVersion: text(trinityVersion) || text(state.version) || "unknown",
    createdAt: new Date(typeof now === "function" ? now() : now).toISOString(),
    dataSchemaVersion: Number.isInteger(data.schemaVersion) ? data.schemaVersion : null,
    security: {
      credentialsIncluded: false,
      note: "Passwords, tokens, credential references, runtime diagnostics, and machine-local paths are excluded."
    },
    counts: backupCounts(data),
    data
  };
}

function requireIds(items, label) {
  const ids = new Set();
  for (const item of items || []) {
    if (!record(item) || !text(item.id)) throw new TypeError(`${label} contains an item without a valid ID`);
    if (ids.has(item.id)) throw new TypeError(`${label} contains duplicate ID: ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}

function validateRelationships(data) {
  const deviceIds = requireIds(data.devices || [], "Devices");
  const cameraIds = new Set((data.devices || []).filter(item => item.type === "camera").map(item => item.id));
  const presetIds = requireIds(data.cameraPresets || [], "Camera presets");
  const shotIds = requireIds(data.shots || [], "Shots");
  const lookIds = requireIds(data.productionLooks || [], "Production Looks");
  const lightingIds = requireIds(data.lightingScenes || [], "Lighting Scenes");
  requireIds(data.videoSources || [], "Video Sources");
  requireIds(data.runOfService || [], "Service cues");
  requireIds(data.cueTemplates || [], "Quick Add templates");
  for (const preset of data.cameraPresets || []) {
    if (!cameraIds.has(preset.cameraDeviceId)) throw new TypeError(`Camera preset ${preset.id} references missing camera ${preset.cameraDeviceId || "(none)"}`);
  }
  for (const shot of data.shots || []) {
    if (shot.cameraDeviceId && !cameraIds.has(shot.cameraDeviceId)) throw new TypeError(`Shot ${shot.id} references missing camera ${shot.cameraDeviceId}`);
    for (const presetId of [shot.cameraPresetId, shot.motionEndPresetId].filter(Boolean)) {
      if (!presetIds.has(presetId)) throw new TypeError(`Shot ${shot.id} references missing preset ${presetId}`);
    }
  }
  for (const cue of data.runOfService || []) {
    if (cue.productionLookId && !lookIds.has(cue.productionLookId)) throw new TypeError(`Service cue ${cue.id} references missing Production Look ${cue.productionLookId}`);
  }
  for (const look of data.productionLooks || []) {
    if (look.lightingSceneId && !lightingIds.has(look.lightingSceneId)) throw new TypeError(`Production Look ${look.id} references missing Lighting Scene ${look.lightingSceneId}`);
    for (const assignment of look.cameraAssignments || []) {
      if (assignment.shotId && !shotIds.has(assignment.shotId)) throw new TypeError(`Production Look ${look.id} references missing Shot ${assignment.shotId}`);
    }
  }
  for (const device of data.devices || []) {
    if (device.type !== "switcher") continue;
    for (const cameraId of Object.keys(device.metadata?.atemCameraInputs || {})) {
      if (!deviceIds.has(cameraId) || !cameraIds.has(cameraId)) throw new TypeError(`ATEM mapping references missing camera ${cameraId}`);
    }
  }
  for (const source of data.videoSources || []) {
    if (source.sourceType === "camera" && source.cameraDeviceId && !cameraIds.has(source.cameraDeviceId)) throw new TypeError(`Video Source ${source.id} references missing camera ${source.cameraDeviceId}`);
  }
  return true;
}

function validateBackupEnvelope(envelope) {
  if (!record(envelope)) throw Object.assign(new TypeError("This file is not a Trinity backup"), { code: "BACKUP_INVALID" });
  if (!Number.isInteger(envelope.backupFormatVersion)) throw Object.assign(new TypeError("Backup format information is missing"), { code: "BACKUP_FORMAT_MISSING" });
  if (envelope.backupFormatVersion > BACKUP_FORMAT_VERSION) throw Object.assign(new RangeError(`This backup requires a newer version of Trinity (backup format ${envelope.backupFormatVersion})`), { code: "BACKUP_FORMAT_FUTURE" });
  if (envelope.backupFormatVersion < 1) throw Object.assign(new RangeError(`Unsupported Trinity backup format: ${envelope.backupFormatVersion}`), { code: "BACKUP_FORMAT_UNSUPPORTED" });
  if (!text(envelope.trinityVersion) || !text(envelope.createdAt) || !Number.isFinite(Date.parse(envelope.createdAt))) throw Object.assign(new TypeError("Backup metadata is incomplete"), { code: "BACKUP_METADATA_INVALID" });
  if (!record(envelope.data) || !Array.isArray(envelope.data.devices) || !Array.isArray(envelope.data.runOfService)) throw Object.assign(new TypeError("Backup data is missing or incomplete"), { code: "BACKUP_DATA_INVALID" });
  validateRelationships(envelope.data);
  return {
    backupFormatVersion: envelope.backupFormatVersion,
    trinityVersion: envelope.trinityVersion,
    createdAt: envelope.createdAt,
    dataSchemaVersion: envelope.dataSchemaVersion ?? null,
    counts: backupCounts(envelope.data),
    credentialsIncluded: envelope.security?.credentialsIncluded === true
  };
}

function parseBackup(serialized) {
  let envelope;
  try { envelope = JSON.parse(serialized); }
  catch { throw Object.assign(new SyntaxError("The selected backup is not valid JSON or is truncated"), { code: "BACKUP_JSON_INVALID" }); }
  const preview = validateBackupEnvelope(envelope);
  return { envelope, preview };
}

function mergePortableState(currentState, importedData) {
  const next = clone(currentState || {});
  for (const key of [...PORTABLE_SCALAR_KEYS, ...PORTABLE_ARRAY_KEYS]) {
    if (importedData[key] !== undefined) next[key] = sanitizePortableValue(importedData[key]);
  }
  const currentDevices = new Map((currentState?.devices || []).map(device => [device?.id, device]));
  next.devices = (next.devices || []).map(device => {
    const current = currentDevices.get(device.id);
    if (!current) return device;
    const credentials = Object.fromEntries(["password", "credentialReference"].filter(key => current[key]).map(key => [key, current[key]]));
    const connectionCredentials = Object.fromEntries(["password", "credentialReference"].filter(key => current.connection?.[key]).map(key => [key, current.connection[key]]));
    return {
      ...device,
      ...credentials,
      ...(Object.keys(connectionCredentials).length ? { connection: { ...(device.connection || {}), ...connectionCredentials } } : {})
    };
  });
  next.settings = {
    ...(record(currentState?.settings) ? clone(currentState.settings) : {}),
    ...portableSettings(importedData.settings),
    qlcplusService: {
      ...(record(importedData.settings?.qlcplusService) ? portableSettings(importedData.settings).qlcplusService : {}),
      applicationPath: currentState?.settings?.qlcplusService?.applicationPath || "",
      workspacePath: currentState?.settings?.qlcplusService?.workspacePath || "",
      manageAutomatically: false
    }
  };
  delete next.live;
  delete next.cameraPreparationSchemaVersion;
  return next;
}

function timestampForFilename(now = Date.now()) {
  return new Date(now).toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
}

function defaultBackupFilename(now = Date.now()) {
  return `Trinity-Backup-${timestampForFilename(now)}.${BACKUP_EXTENSION}`;
}

function atomicWrite(filePath, serialized, fsImpl = fs) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fsImpl.writeFileSync(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
    fsImpl.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fsImpl.unlinkSync(temporaryPath); } catch { /* Nothing to clean up. */ }
    throw error;
  }
}

function createBackupManager({ getState, replaceState, normalizeState = value => value, trinityVersion, userDataPath, fsImpl = fs, now = Date.now } = {}) {
  if (typeof getState !== "function" || typeof replaceState !== "function") throw new TypeError("Backup manager requires state access");
  const recoveryDirectory = path.join(userDataPath, "Trinity Recovery Backups");
  return {
    exportTo(filePath) {
      const envelope = createBackupEnvelope(getState(), { trinityVersion, now: now() });
      atomicWrite(filePath, `${JSON.stringify(envelope, null, 2)}\n`, fsImpl);
      return { filePath, preview: validateBackupEnvelope(envelope) };
    },
    previewFile(filePath) {
      return parseBackup(fsImpl.readFileSync(filePath, "utf8")).preview;
    },
    async importFile(filePath) {
      const { envelope, preview } = parseBackup(fsImpl.readFileSync(filePath, "utf8"));
      const previous = clone(getState());
      const recoveryEnvelope = createBackupEnvelope(previous, { trinityVersion, now: now() });
      const recoveryPath = path.join(recoveryDirectory, `Trinity-Recovery-Before-Import-${timestampForFilename(now())}.${BACKUP_EXTENSION}`);
      atomicWrite(recoveryPath, `${JSON.stringify(recoveryEnvelope, null, 2)}\n`, fsImpl);
      try {
        const imported = normalizeState(mergePortableState(previous, envelope.data));
        const saved = await replaceState(imported);
        return { state: saved, preview, recoveryPath, restartRequired: true };
      } catch (error) {
        try { await replaceState(previous); } catch { /* Recovery backup remains available. */ }
        throw error;
      }
    }
  };
}

module.exports = {
  BACKUP_EXTENSION,
  BACKUP_FORMAT_VERSION,
  PORTABLE_ARRAY_KEYS,
  atomicWrite,
  backupCounts,
  createBackupEnvelope,
  createBackupManager,
  defaultBackupFilename,
  extractPortableState,
  mergePortableState,
  parseBackup,
  validateBackupEnvelope,
  validateRelationships
};
