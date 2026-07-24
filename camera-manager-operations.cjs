"use strict";

const CAMERA_MANAGER_SCHEMA_VERSION = 1;
const CAPABILITY_STATES = new Set(["supported", "notSupported", "unknown", "adapterRequired"]);
const CAPABILITY_KEYS = ["panTilt", "zoom", "focus", "presetRecall", "presetSave", "tracking", "motion", "tally", "preview"];
const ROLE_PRIORITY = new Map([["main", 0], ["left", 1], ["right", 2]]);

const nullable = value => typeof value === "string" && value.trim() ? value.trim() : null;

function capabilityState(value, fallback = "unknown") {
  if (CAPABILITY_STATES.has(value)) return value;
  if (value === true) return "supported";
  if (value === false) return "notSupported";
  return fallback;
}

function resolveLegacyCamera(state, cameraDevice) {
  const legacyId = cameraDevice?.metadata?.legacyCameraId || cameraDevice?.id;
  return (state?.cameras || []).find(camera => camera?.id === legacyId || camera?.id === cameraDevice?.id) || null;
}

function resolveCameraDevice(state, cameraId) {
  const direct = (state?.devices || []).find(device => device?.type === "camera" && device.id === cameraId);
  if (direct) return direct;
  const legacy = (state?.cameras || []).find(camera => camera?.id === cameraId);
  if (!legacy) return null;
  return (state?.devices || []).find(device => device?.type === "camera" && (device.id === legacy.id || device.metadata?.legacyCameraId === legacy.id)) || null;
}

function resolveCameraCapabilities(device = {}) {
  const configured = device.metadata?.cameraManager?.capabilities || {};
  const inferredPreset = device.presetSupport === true ? "supported" : "unknown";
  return {
    panTilt: capabilityState(configured.panTilt, nullable(device.protocol) ? "adapterRequired" : "unknown"),
    zoom: capabilityState(configured.zoom, nullable(device.protocol) ? "adapterRequired" : "unknown"),
    focus: capabilityState(configured.focus),
    presetRecall: capabilityState(configured.presetRecall, inferredPreset),
    presetSave: capabilityState(configured.presetSave, inferredPreset),
    tracking: capabilityState(configured.tracking, device.trackingEnabled === true ? "supported" : "unknown"),
    motion: capabilityState(configured.motion, device.motionEnabled === true ? "supported" : "unknown"),
    tally: capabilityState(configured.tally),
    preview: capabilityState(configured.preview),
    maxPresetNumber: Number.isInteger(configured.maxPresetNumber) ? configured.maxPresetNumber : null,
    presetRange: nullable(configured.presetRange),
    notes: nullable(configured.notes)
  };
}

function validateCameraCapabilities(capabilities = {}) {
  const errors = CAPABILITY_KEYS.filter(key => !CAPABILITY_STATES.has(capabilities[key])).map(key => `Invalid ${key} capability`);
  if (capabilities.maxPresetNumber !== null && (!Number.isInteger(capabilities.maxPresetNumber) || capabilities.maxPresetNumber < 1)) {
    errors.push("maxPresetNumber must be a positive integer or null");
  }
  return { valid: errors.length === 0, errors };
}

function summarizeCameraCapabilities(capabilities) {
  const supported = CAPABILITY_KEYS.filter(key => capabilities[key] === "supported");
  const adapterRequired = CAPABILITY_KEYS.filter(key => capabilities[key] === "adapterRequired");
  return {
    supported,
    adapterRequired,
    label: supported.length ? supported.map(key => ({ panTilt: "PTZ", presetRecall: "Preset recall", presetSave: "Preset save" })[key] || key[0].toUpperCase() + key.slice(1)).join(", ") : "Capabilities unknown"
  };
}

function normalizeManagedCamera(device, state, order = 0) {
  if (!device || device.type !== "camera") return null;
  const legacy = resolveLegacyCamera(state, device);
  const metadata = device.metadata?.cameraManager || {};
  const capabilities = resolveCameraCapabilities(device);
  const diagnostic = device.metadata?.diagnostic || null;
  const presets = (state?.cameraPresets || []).filter(preset => preset.cameraDeviceId === device.id);
  const currentPresetId = nullable(metadata.currentPresetId);
  const currentPreset = presets.find(preset => preset.id === currentPresetId) || null;
  const program = state?.live?.programCamera === device.id;
  const preview = state?.live?.previewCamera === device.id;
  return {
    schemaVersion: CAMERA_MANAGER_SCHEMA_VERSION,
    cameraDeviceId: device.id,
    displayName: device.name,
    logicalRole: device.logicalRole,
    enabled: device.enabled === true,
    order,
    manufacturer: nullable(device.manufacturer),
    model: nullable(device.model),
    protocol: nullable(device.protocol),
    hostSummary: nullable(device.ipAddress || device.connection?.host),
    configured: Boolean(device.ipAddress && device.protocol),
    capabilities,
    capabilitySummary: summarizeCameraCapabilities(capabilities),
    connectionStatus: device.connectionStatus || "notTested",
    readiness: !device.enabled ? "Disabled" : !(device.ipAddress && device.protocol) ? "Not configured" : diagnostic?.message || "Adapter not implemented",
    lastCheckedAt: device.lastCheckedAt || null,
    lastError: device.lastError || null,
    currentPresetId,
    currentPresetNumber: currentPreset?.presetNumber ?? null,
    currentPresetName: currentPreset?.name || nullable(legacy?.lastPreset),
    trackingState: nullable(metadata.trackingState) || "unknown",
    motionState: nullable(metadata.motionState) || "unknown",
    programState: program,
    previewState: preview,
    color: nullable(metadata.color),
    operatorNotes: nullable(metadata.operatorNotes),
    favoritePresetIds: Array.isArray(metadata.favoritePresetIds) ? [...new Set(metadata.favoritePresetIds.filter(Boolean))] : [],
    presetGroupOrder: Array.isArray(metadata.presetGroupOrder) ? [...metadata.presetGroupOrder] : [],
    thumbnailReference: nullable(metadata.thumbnailReference),
    firmwareVersion: nullable(metadata.firmwareVersion),
    adapterId: nullable(metadata.adapterId || device.metadata?.adapter),
    calibrationProfileId: nullable(metadata.calibrationProfileId),
    presetCount: presets.length,
    warning: legacy || presets.length === 0 ? null : "Missing legacy camera record"
  };
}

function buildManagedCameraProjection(state) {
  const priority = camera => camera.cameraDeviceId === "main" || camera.logicalRole === "main" || (camera.logicalRole === "center" && /\bmain\b/i.test(camera.displayName))
    ? 0
    : ROLE_PRIORITY.has(camera.logicalRole) ? ROLE_PRIORITY.get(camera.logicalRole) : 3;
  return (state?.devices || [])
    .filter(device => device?.type === "camera")
    .map((device, index) => normalizeManagedCamera(device, state, index))
    .sort((a, b) => {
      const aPriority = priority(a);
      const bPriority = priority(b);
      return aPriority - bPriority || a.order - b.order || a.displayName.localeCompare(b.displayName);
    });
}

function summarizeManagedCamera(camera) {
  return {
    cameraDeviceId: camera.cameraDeviceId,
    displayName: camera.displayName,
    logicalRole: camera.logicalRole,
    enabled: camera.enabled,
    readiness: camera.readiness,
    connectionStatus: camera.connectionStatus,
    currentPresetId: camera.currentPresetId,
    currentPresetName: camera.currentPresetName,
    trackingState: camera.trackingState,
    motionState: camera.motionState,
    programState: camera.programState,
    previewState: camera.previewState,
    warning: camera.warning
  };
}

module.exports = {
  CAMERA_MANAGER_SCHEMA_VERSION,
  buildManagedCameraProjection,
  normalizeManagedCamera,
  resolveCameraCapabilities,
  resolveCameraDevice,
  resolveLegacyCamera,
  summarizeCameraCapabilities,
  summarizeManagedCamera,
  validateCameraCapabilities
};
