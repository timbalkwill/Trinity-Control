"use strict";

const CAMERA_PRESET_SCHEMA_VERSION = 1;
const SUGGESTED_PRESET_CATEGORIES = ["Pastor", "Platform", "Piano", "Choir", "Baptistry", "Congregation", "Wide", "Utility"];
const EPOCH = "1970-01-01T00:00:00.000Z";
const nullable = value => typeof value === "string" && value.trim() ? value.trim() : null;
const text = (value, fallback = "") => typeof value === "string" ? value.trim() : fallback;
const clone = value => JSON.parse(JSON.stringify(value));
const uniqueId = () => `camera-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const categoryKey = value => (nullable(value) || "Utility").toLocaleLowerCase();
const stableIdPart = value => String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";

function duplicateCameraPresetIds(state) {
  const counts = new Map();
  for (const preset of state?.cameraPresets || []) {
    const id = nullable(preset?.id);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
}

function hasDuplicateCameraPresetIds(state) {
  return duplicateCameraPresetIds(state).size > 0;
}

function migrationError(message, path = null) {
  const error = new Error(path ? `${message} at ${path}` : message);
  error.code = "CAMERA_PRESET_MIGRATION_AMBIGUOUS";
  error.path = path;
  return error;
}

function cameraResolver(state) {
  const devices = (state?.devices || []).filter(item => item?.type === "camera");
  return value => {
    const identity = nullable(value);
    if (!identity) return null;
    const direct = devices.find(item => item.id === identity);
    if (direct) return direct.id;
    const legacy = devices.filter(item => item.metadata?.legacyCameraId === identity);
    if (legacy.length === 1) return legacy[0].id;
    const role = devices.filter(item => item.logicalRole === identity || (identity === "main" && item.logicalRole === "center"));
    return role.length === 1 ? role[0].id : null;
  };
}

function migrateDuplicateCameraPresetIds(state) {
  const duplicates = duplicateCameraPresetIds(state);
  if (!duplicates.size) return state;
  const migrated = clone(state);
  const resolveCamera = cameraResolver(migrated);
  const occupied = new Set((migrated.cameraPresets || []).filter(item => !duplicates.has(item.id)).map(item => item.id));
  const scoped = new Map();
  const colliding = (migrated.cameraPresets || []).filter(item => duplicates.has(item.id))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)) || String(a.cameraDeviceId).localeCompare(String(b.cameraDeviceId)));
  for (const preset of colliding) {
    const cameraId = resolveCamera(preset.cameraDeviceId);
    if (!cameraId) throw migrationError(`Duplicate preset ${preset.id} has no stable camera identity`, "cameraPresets");
    const key = `${cameraId}\u0000${preset.id}`;
    if (scoped.has(key)) throw migrationError(`Duplicate preset ${preset.id} occurs more than once for camera ${cameraId}`, "cameraPresets");
    const base = `preset-${stableIdPart(cameraId)}-${stableIdPart(preset.id)}`;
    let replacement = base;
    for (let suffix = 2; occupied.has(replacement); suffix += 1) replacement = `${base}-${suffix}`;
    occupied.add(replacement);
    scoped.set(key, replacement);
  }

  const replacementFor = (legacyId, cameraIdentity, path) => {
    if (!duplicates.has(legacyId)) return legacyId;
    const cameraId = resolveCamera(cameraIdentity);
    if (!cameraId) throw migrationError(`Cannot resolve camera context for duplicate preset ${legacyId}`, path);
    const replacement = scoped.get(`${cameraId}\u0000${legacyId}`);
    if (!replacement) throw migrationError(`Camera ${cameraId} has no preset matching duplicate ID ${legacyId}`, path);
    return replacement;
  };
  const rewrite = (object, fields, cameraIdentity, path) => {
    if (!object || typeof object !== "object") return;
    for (const field of fields) {
      if (typeof object[field] === "string" && duplicates.has(object[field])) {
        object[field] = replacementFor(object[field], cameraIdentity, `${path}.${field}`);
      }
    }
  };
  const cameraFrom = object => object?.cameraDeviceId || object?.cameraId || object?.camera || object?.logicalCameraRole || object?.role || null;
  const presetFields = ["presetId", "cameraPresetId", "motionPresetId", "startPresetId", "startingPresetId", "endPresetId", "motionEndPresetId"];

  for (const preset of migrated.cameraPresets || []) {
    if (duplicates.has(preset.id)) preset.id = replacementFor(preset.id, preset.cameraDeviceId, `cameraPresets.${preset.id}`);
  }
  for (const camera of migrated.cameras || []) {
    const cameraId = resolveCamera(camera.id || camera.role);
    for (const [index, preset] of (camera.savedPositions || []).entries()) rewrite(preset, ["id"], cameraId, `cameras.${camera.id}.savedPositions[${index}]`);
  }
  for (const [index, shot] of (migrated.shots || []).entries()) rewrite(shot, presetFields, cameraFrom(shot), `shots[${index}]`);
  for (const [index, look] of (migrated.productionLooks || []).entries()) {
    for (const [role, assignment] of Object.entries(look.cameraPresets || {})) rewrite(assignment, presetFields, cameraFrom(assignment) || role, `productionLooks[${index}].cameraPresets.${role}`);
    for (const [assignmentIndex, assignment] of (look.cameraAssignments || []).entries()) rewrite(assignment, presetFields, cameraFrom(assignment), `productionLooks[${index}].cameraAssignments[${assignmentIndex}]`);
    rewrite(look, presetFields, cameraFrom(look), `productionLooks[${index}]`);
  }
  for (const collectionName of ["runOfService", "cueTemplates"]) {
    for (const [index, item] of (migrated[collectionName] || []).entries()) rewrite(item, presetFields, cameraFrom(item), `${collectionName}[${index}]`);
  }
  for (const [index, layout] of (migrated.cameraLayouts || []).entries()) {
    rewrite(layout, ["programPresetId"], layout.programCameraId || layout.programCamera, `cameraLayouts[${index}]`);
    rewrite(layout, ["previewPresetId"], layout.previewCameraId || layout.previewCamera, `cameraLayouts[${index}]`);
    rewrite(layout, presetFields, cameraFrom(layout), `cameraLayouts[${index}]`);
    for (const [role, assignment] of Object.entries(layout.cameraPresets || {})) rewrite(assignment, presetFields, cameraFrom(assignment) || role, `cameraLayouts[${index}].cameraPresets.${role}`);
  }
  for (const [index, preparation] of (migrated.live?.cameraPreparations || []).entries()) {
    rewrite(preparation, presetFields.concat("selectedPresetId"), preparation.cameraId, `live.cameraPreparations[${index}]`);
    rewrite(preparation.preparedAssignment, presetFields, preparation.cameraId, `live.cameraPreparations[${index}].preparedAssignment`);
  }
  rewrite(migrated.live?.activeCameraAssignment, presetFields, migrated.live?.activeCameraAssignment?.cameraId, "live.activeCameraAssignment");
  for (const [cameraId, command] of Object.entries(migrated.live?.manualMotionCommands || {})) rewrite(command, presetFields, command?.cameraId || cameraId, `live.manualMotionCommands.${cameraId}`);

  if (duplicateCameraPresetIds(migrated).size) throw migrationError("Camera preset IDs remain duplicated after migration");
  return migrated;
}

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
  const presetNumber = input.presetNumber ?? input.hardwarePresetNumber ?? input.number;
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
  const value = preset?.presetNumber ?? preset?.hardwarePresetNumber ?? preset?.number ?? index + 1;
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
    for (const [role, assignment] of Object.entries(look.cameraPresets || {})) {
      if (assignment?.presetId === presetId) references.push({ type: `Production Look ${role} preset`, id: look.id, name: look.name });
    }
    if (look.selectedShotId === presetId) references.push({ type: "Production Look selected shot", id: look.id, name: look.name });
    for (const assignment of look.cameraAssignments || []) if (assignment.presetId === presetId) references.push({ type: `Production Look ${assignment.role} preset`, id: look.id, name: look.name });
  }
  for (const cue of state?.runOfService || []) {
    if ([cue.cameraPresetId, cue.presetId, cue.selectedShotId, cue.motionPresetId].includes(presetId)) references.push({ type: "Cue", id: cue.id, name: cue.name });
  }
  for (const layout of state?.cameraLayouts || []) {
    if ([layout.programPresetId, layout.previewPresetId, layout.selectedShotId, layout.motionPresetId].includes(presetId)) references.push({ type: "Camera layout", id: layout.id, name: layout.name });
  }
  for (const shot of state?.shots || []) {
    if (shot.cameraPresetId === presetId) references.push({ type: "Shot", id: shot.id, name: shot.name });
    if (shot.motionEndPresetId === presetId) references.push({ type: "Motion Shot end preset", id: shot.id, name: shot.name });
    if (shot.startPresetId === presetId) references.push({ type: "Shot start preset", id: shot.id, name: shot.name });
    if (shot.endPresetId === presetId) references.push({ type: "Shot end preset", id: shot.id, name: shot.name });
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
const findPresetNumberConflict = (state, cameraDeviceId, presetNumber) => listPresetsByCamera(state, cameraDeviceId)
  .find(preset => preset.presetNumber === presetNumber) || null;

function nextAvailablePresetNumber(state, cameraDeviceId, { minimum = 1, maximum = 254 } = {}) {
  const used = new Set(listPresetsByCamera(state, cameraDeviceId).map(preset => preset.presetNumber).filter(Number.isInteger));
  for (let number = minimum; number <= maximum; number += 1) if (!used.has(number)) return number;
  return null;
}

module.exports = {
  CAMERA_PRESET_SCHEMA_VERSION,
  SUGGESTED_PRESET_CATEGORIES,
  countCameraPresetReferences,
  createCameraPreset,
  deleteCameraPreset,
  duplicateCameraPreset,
  findPresetNumberConflict,
  listPresetsByCamera,
  listPresetsByCategory,
  listCameraPresetCategories,
  migrateLegacyPresets,
  migrateDuplicateCameraPresetIds,
  duplicateCameraPresetIds,
  hasDuplicateCameraPresetIds,
  normalizeCameraPreset,
  nextAvailablePresetNumber,
  reorderCameraPreset,
  updateCameraPreset,
  validateCameraPreset
};
