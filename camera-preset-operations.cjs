"use strict";

const CAMERA_PRESET_SCHEMA_VERSION = 1;
const SUGGESTED_PRESET_CATEGORIES = ["Pastor", "Platform", "Piano", "Choir", "Baptistry", "Congregation", "Wide", "Utility"];
const EPOCH = "1970-01-01T00:00:00.000Z";
const nullable = value => typeof value === "string" && value.trim() ? value.trim() : null;
const text = (value, fallback = "") => typeof value === "string" ? value.trim() : fallback;
const clone = value => JSON.parse(JSON.stringify(value));
const uniqueId = () => `camera-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const categoryKey = value => (nullable(value) || "Utility").toLocaleLowerCase();

function listCameraPresetCategories(state) {
  const categories = new Map(SUGGESTED_PRESET_CATEGORIES.map(category => [categoryKey(category), category]));
  for (const preset of state?.cameraPresets || []) {
    const category = nullable(preset?.category) || "Utility";
    if (!categories.has(categoryKey(category))) categories.set(categoryKey(category), category);
  }
  return [...categories.values()];
}

function normalizeCameraPreset(input = {}, { cameraDeviceId, logicalRole, id, now } = {}) {
  const createdAt = nullable(input.createdAt) || (now ? new Date(now).toISOString() : EPOCH);
  const presetNumber = input.presetNumber ?? input.number;
  return {
    ...input,
    schemaVersion: CAMERA_PRESET_SCHEMA_VERSION,
    id: nullable(input.id) || id || uniqueId(),
    name: text(input.name, `Preset ${presetNumber ?? ""}`) || "Camera Preset",
    presetNumber: presetNumber !== null && presetNumber !== undefined && presetNumber !== "" && Number.isInteger(Number(presetNumber)) ? Number(presetNumber) : null,
    cameraDeviceId: nullable(input.cameraDeviceId) || nullable(cameraDeviceId),
    logicalRole: nullable(input.logicalRole) || nullable(logicalRole),
    enabled: input.enabled !== false,
    favorite: input.favorite === true,
    category: nullable(input.category || input.group),
    group: nullable(input.group || input.category),
    notes: text(input.notes),
    createdAt,
    updatedAt: nullable(input.updatedAt) || createdAt
  };
}

function deterministicLegacyId(cameraId, preset, index) {
  if (nullable(preset?.id)) return preset.id;
  const value = preset?.presetNumber ?? preset?.number ?? index + 1;
  return `${cameraId}-preset-${String(value).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function migrateLegacyPresets(state) {
  if (Array.isArray(state?.cameraPresets)) return state.cameraPresets.filter(item => item && typeof item === "object").map(normalizeCameraPreset);
  const presets = [];
  for (const camera of state?.cameras || []) {
    const device = (state?.devices || []).find(item => item.type === "camera" && (item.id === camera.id || item.metadata?.legacyCameraId === camera.id));
    for (const [index, raw] of (Array.isArray(camera.savedPositions) ? camera.savedPositions : []).entries()) {
      const preset = typeof raw === "string" ? { name: raw, presetNumber: index + 1 } : raw;
      presets.push(normalizeCameraPreset(preset, {
        id: deterministicLegacyId(camera.id, preset, index),
        cameraDeviceId: device?.id || camera.id,
        logicalRole: device?.logicalRole || camera.role
      }));
    }
  }
  return presets;
}

function collection(state) {
  if (!Array.isArray(state.cameraPresets)) state.cameraPresets = [];
  return state.cameraPresets;
}

function validateCameraPreset(preset) {
  const errors = [];
  if (!text(preset?.name)) errors.push("Preset name is required");
  if (!nullable(preset?.cameraDeviceId)) errors.push("Camera device is required");
  if (preset?.presetNumber !== null && (!Number.isInteger(preset.presetNumber) || preset.presetNumber < 0)) errors.push("Preset number must be a non-negative integer or null");
  return { valid: errors.length === 0, errors };
}

function createCameraPreset(state, input = {}, { id, now = Date.now() } = {}) {
  const device = (state.devices || []).find(item => item.id === input.cameraDeviceId && item.type === "camera");
  const preset = normalizeCameraPreset(input, { id: input.id || id || uniqueId(), now, logicalRole: input.logicalRole || device?.logicalRole });
  const validation = validateCameraPreset(preset);
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  if (collection(state).some(item => item.id === preset.id)) throw new RangeError(`Preset ID already exists: ${preset.id}`);
  state.cameraPresets.push(preset);
  return preset;
}

function updateCameraPreset(state, presetId, patch = {}, { now = Date.now() } = {}) {
  const index = collection(state).findIndex(item => item.id === presetId);
  if (index < 0) throw new RangeError(`Unknown camera preset: ${presetId}`);
  const current = state.cameraPresets[index];
  const updated = normalizeCameraPreset({ ...current, ...clone(patch), id: current.id, createdAt: current.createdAt, updatedAt: new Date(now).toISOString() });
  const validation = validateCameraPreset(updated);
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  state.cameraPresets[index] = updated;
  return updated;
}

function duplicateCameraPreset(state, presetId, { id = uniqueId(), now = Date.now() } = {}) {
  const source = collection(state).find(item => item.id === presetId);
  if (!source) throw new RangeError(`Unknown camera preset: ${presetId}`);
  return createCameraPreset(state, { ...clone(source), id, name: `${source.name} Copy` }, { now });
}

function countCameraPresetReferences(state, presetId) {
  const references = [];
  for (const look of state?.productionLooks || []) {
    if (look.selectedShotId === presetId) references.push({ type: "Production Look selected shot", id: look.id, name: look.name });
    for (const assignment of look.cameraAssignments || []) if (assignment.presetId === presetId) references.push({ type: `Production Look ${assignment.role} preset`, id: look.id, name: look.name });
  }
  for (const cue of state?.runOfService || []) {
    if ([cue.cameraPresetId, cue.presetId, cue.selectedShotId, cue.motionPresetId].includes(presetId)) references.push({ type: "Cue", id: cue.id, name: cue.name });
  }
  for (const layout of state?.cameraLayouts || []) {
    if ([layout.programPresetId, layout.previewPresetId, layout.selectedShotId, layout.motionPresetId].includes(presetId)) references.push({ type: "Camera layout", id: layout.id, name: layout.name });
  }
  return references;
}

function deleteCameraPreset(state, presetId, { confirmReferences = false } = {}) {
  const index = collection(state).findIndex(item => item.id === presetId);
  if (index < 0) throw new RangeError(`Unknown camera preset: ${presetId}`);
  const references = countCameraPresetReferences(state, presetId);
  if (references.length && !confirmReferences) {
    const error = new Error(`This preset is referenced ${references.length} time${references.length === 1 ? "" : "s"}`);
    error.code = "CONFIRM_CAMERA_PRESET_DELETE";
    error.statusCode = 409;
    error.references = references;
    throw error;
  }
  state.cameraPresets.splice(index, 1);
  return { deletedId: presetId, references: references.length };
}

function reorderCameraPreset(state, cameraDeviceId, from, to) {
  const all = collection(state);
  const positions = all.map((preset, index) => preset.cameraDeviceId === cameraDeviceId ? index : -1).filter(index => index >= 0);
  if (![from, to].every(Number.isInteger) || from < 0 || to < 0 || from >= positions.length || to >= positions.length || from === to) return state;
  const ordered = positions.map(index => all[index]);
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  positions.forEach((position, index) => { all[position] = ordered[index]; });
  return state;
}

const listPresetsByCamera = (state, cameraDeviceId) => (state?.cameraPresets || []).filter(preset => preset.cameraDeviceId === cameraDeviceId);
const listPresetsByCategory = (state, category) => (state?.cameraPresets || []).filter(preset => categoryKey(preset.category) === categoryKey(category));

module.exports = {
  CAMERA_PRESET_SCHEMA_VERSION,
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
};
