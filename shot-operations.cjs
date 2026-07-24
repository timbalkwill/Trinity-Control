"use strict";

const SHOT_SCHEMA_VERSION = 1;
const SUGGESTED_SHOT_CATEGORIES = ["Pastor", "Platform", "Music", "Piano", "Choir", "Baptistry", "Congregation", "Wide", "Utility"];
const EPOCH = "1970-01-01T00:00:00.000Z";
const nullable = value => typeof value === "string" && value.trim() ? value.trim() : null;
const text = (value, fallback = "") => typeof value === "string" ? value.trim() : fallback;
const clone = value => JSON.parse(JSON.stringify(value));
const finite = (value, fallback = 0, minimum = 0) => Number.isFinite(Number(value)) ? Math.max(minimum, Number(value)) : fallback;
const uniqueId = () => `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const categoryKey = value => (nullable(value) || "Utility").toLocaleLowerCase();

const DEFAULT_SHOT_DEFINITIONS = [
  ["shot-pastor-tight", "Pastor Tight", "Pastor", "main", "Pastor", "Tight"],
  ["shot-pastor-medium", "Pastor Medium", "Pastor", "main", "Pastor", "Medium"],
  ["shot-pastor-wide", "Pastor Wide", "Pastor", "main", "Pastor", "Wide"],
  ["shot-platform-wide", "Platform Wide", "Platform", "main", "Platform", "Wide"],
  ["shot-piano", "Piano", "Piano", "left", "Piano", "Medium"],
  ["shot-choir-wide", "Choir Wide", "Choir", "main", "Choir", "Wide"],
  ["shot-baptistry", "Baptistry", "Baptistry", "main", "Baptistry", "Medium"],
  ["shot-congregation-left", "Congregation Left", "Congregation", "left", "Congregation", "Wide"],
  ["shot-congregation-right", "Congregation Right", "Congregation", "right", "Congregation", "Wide"],
  ["shot-stage-wide", "Stage Wide", "Wide", "main", "Stage", "Wide"]
];

function normalizeShot(input = {}, { id, now, order = 0 } = {}) {
  const createdAt = nullable(input.createdAt) || (now ? new Date(now).toISOString() : EPOCH);
  return {
    ...input,
    schemaVersion: SHOT_SCHEMA_VERSION,
    id: nullable(input.id) || id || uniqueId(),
    name: text(input.name, "Untitled Shot") || "Untitled Shot",
    description: text(input.description),
    enabled: input.enabled !== false,
    createdAt,
    updatedAt: nullable(input.updatedAt) || createdAt,
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : order,
    category: nullable(input.category),
    tags: Array.isArray(input.tags) ? input.tags.map(String).map(tag => tag.trim()).filter(Boolean) : [],
    favorite: input.favorite === true,
    color: nullable(input.color) || "#4da9ff",
    icon: nullable(input.icon),
    cameraDeviceId: nullable(input.cameraDeviceId),
    logicalCameraRole: nullable(input.logicalCameraRole),
    cameraPresetId: nullable(input.cameraPresetId),
    subject: nullable(input.subject),
    framingType: nullable(input.framingType),
    composition: nullable(input.composition),
    orientation: nullable(input.orientation),
    safeArea: nullable(input.safeArea),
    framingNotes: text(input.framingNotes),
    trackingMode: nullable(input.trackingMode),
    trackingPreferred: input.trackingPreferred === true,
    trackingSubject: nullable(input.trackingSubject),
    trackingNotes: text(input.trackingNotes),
    motionEnabled: input.motionEnabled === true,
    motionProfileId: nullable(input.motionProfileId),
    motionDurationMs: finite(input.motionDurationMs, 0),
    motionSpeed: finite(input.motionSpeed, 1),
    motionNotes: text(input.motionNotes),
    operatorNotes: text(input.operatorNotes),
    thumbnailReference: nullable(input.thumbnailReference),
    confidence: input.confidence === null || input.confidence === undefined || input.confidence === "" ? null : finite(input.confidence, 0, 0),
    readinessState: nullable(input.readinessState),
    calibrationProfileId: nullable(input.calibrationProfileId),
    previewReference: nullable(input.previewReference),
    compositionGuideId: nullable(input.compositionGuideId),
    motionRecorderClipId: nullable(input.motionRecorderClipId),
    aiFramingMetadata: input.aiFramingMetadata && typeof input.aiFramingMetadata === "object" ? clone(input.aiFramingMetadata) : null
  };
}

function defaultShots() {
  return DEFAULT_SHOT_DEFINITIONS.map(([id, name, category, logicalCameraRole, subject, framingType], order) =>
    normalizeShot({ id, name, category, logicalCameraRole, subject, framingType, order })
  );
}

function migrateShots(shots) {
  if (Array.isArray(shots)) return shots.filter(item => item && typeof item === "object").map((shot, order) => normalizeShot(shot, { order }));
  return defaultShots();
}

function collection(state) {
  if (!Array.isArray(state.shots)) state.shots = [];
  return state.shots;
}

function validateShot(shot) {
  const errors = [];
  if (!text(shot?.name)) errors.push("Shot name is required");
  if (shot?.motionDurationMs < 0) errors.push("Motion duration cannot be negative");
  if (shot?.motionSpeed < 0) errors.push("Motion speed cannot be negative");
  return { valid: errors.length === 0, errors };
}

function createShot(state, input = {}, { id, now = Date.now() } = {}) {
  const shot = normalizeShot(input, { id: input.id || id || uniqueId(), now, order: collection(state).length });
  const validation = validateShot(shot);
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  if (state.shots.some(item => item.id === shot.id)) throw new RangeError(`Shot ID already exists: ${shot.id}`);
  state.shots.push(shot);
  return shot;
}

function updateShot(state, shotId, patch = {}, { now = Date.now() } = {}) {
  const index = collection(state).findIndex(item => item.id === shotId);
  if (index < 0) throw new RangeError(`Unknown Shot: ${shotId}`);
  const current = state.shots[index];
  const updated = normalizeShot({ ...current, ...clone(patch), id: current.id, createdAt: current.createdAt, updatedAt: new Date(now).toISOString() }, { order: current.order });
  const validation = validateShot(updated);
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  state.shots[index] = updated;
  return updated;
}

function duplicateShot(state, shotId, { id = uniqueId(), now = Date.now() } = {}) {
  const source = collection(state).find(item => item.id === shotId);
  if (!source) throw new RangeError(`Unknown Shot: ${shotId}`);
  return createShot(state, { ...clone(source), id, name: `${source.name} Copy`, createdAt: null, updatedAt: null, order: state.shots.length }, { now });
}

function reorderShot(state, from, to) {
  const shots = collection(state);
  if (![from, to].every(Number.isInteger) || from < 0 || to < 0 || from >= shots.length || to >= shots.length || from === to) return state;
  const [shot] = shots.splice(from, 1);
  shots.splice(to, 0, shot);
  shots.forEach((item, order) => { item.order = order; });
  return state;
}

function countShotReferences(state, shotId) {
  const references = [];
  for (const look of state?.productionLooks || []) {
    if (look.selectedShotId === shotId) references.push({ type: "Production Look selected shot", id: look.id, name: look.name });
    for (const assignment of look.cameraAssignments || []) {
      if (assignment.shotId === shotId) references.push({ type: `Production Look ${assignment.role} shot`, id: look.id, name: look.name });
    }
  }
  for (const cue of state?.runOfService || []) {
    if ([cue.shotId, cue.selectedShotId].includes(shotId)) references.push({ type: "Cue", id: cue.id, name: cue.name });
  }
  for (const template of state?.cueTemplates || []) {
    if ([template.shotId, template.selectedShotId].includes(shotId)) references.push({ type: "Execution template", id: template.id, name: template.name });
  }
  for (const reference of state?.motionStudioReferences || []) {
    if (reference.shotId === shotId) references.push({ type: "Motion Studio reference", id: reference.id, name: reference.name });
  }
  return references;
}

function deleteShot(state, shotId, { confirmReferences = false } = {}) {
  const index = collection(state).findIndex(item => item.id === shotId);
  if (index < 0) throw new RangeError(`Unknown Shot: ${shotId}`);
  const references = countShotReferences(state, shotId);
  if (references.length && !confirmReferences) {
    const error = new Error(`This Shot is referenced ${references.length} time${references.length === 1 ? "" : "s"}`);
    error.code = "CONFIRM_SHOT_DELETE";
    error.statusCode = 409;
    error.references = references;
    throw error;
  }
  state.shots.splice(index, 1);
  state.shots.forEach((shot, order) => { shot.order = order; });
  return { deletedId: shotId, references: references.length };
}

function resolveShotTarget(state, shotOrId) {
  const shot = typeof shotOrId === "string" ? (state?.shots || []).find(item => item.id === shotOrId) : shotOrId;
  if (!shot) return { shot: null, camera: null, preset: null, warnings: ["Missing Shot"], readinessState: "missingShot", source: "missing-shot" };
  const cameras = (state?.devices || []).filter(item => item?.type === "camera");
  const requestedCamera = shot.cameraDeviceId ? cameras.find(item => item.id === shot.cameraDeviceId) : null;
  const roleCamera = shot.logicalCameraRole ? cameras.find(item => item.logicalRole === shot.logicalCameraRole && item.enabled !== false) : null;
  const camera = requestedCamera && requestedCamera.enabled !== false ? requestedCamera : roleCamera || requestedCamera || null;
  const warnings = [];
  if (shot.enabled === false) warnings.push(`Shot disabled: ${shot.name}`);
  let source = "unassigned";
  if (requestedCamera && requestedCamera.enabled !== false) source = "shot-camera";
  else if (roleCamera) source = "shot-logical-role";
  if (shot.cameraDeviceId && !requestedCamera) warnings.push(`Missing camera: ${shot.cameraDeviceId}`);
  if (requestedCamera?.enabled === false && roleCamera?.id !== requestedCamera.id) warnings.push(`Camera disabled: ${requestedCamera.name || requestedCamera.id}`);
  if (!camera && (shot.cameraDeviceId || shot.logicalCameraRole)) warnings.push(`No camera available for Shot: ${shot.name}`);
  if (camera?.enabled === false) warnings.push(`Camera disabled: ${camera.name || camera.id}`);

  const requestedPreset = shot.cameraPresetId ? (state?.cameraPresets || []).find(item => item.id === shot.cameraPresetId) : null;
  let preset = null;
  if (shot.cameraPresetId && !requestedPreset) warnings.push(`Missing preset: ${shot.cameraPresetId}`);
  else if (requestedPreset && camera && requestedPreset.cameraDeviceId !== camera.id) warnings.push(`Preset camera mismatch: ${requestedPreset.name || requestedPreset.id}`);
  else if (requestedPreset) {
    preset = requestedPreset;
    if (preset.enabled === false) warnings.push(`Preset disabled: ${preset.name || preset.id}`);
  }

  let readinessState = "ready";
  if (shot.enabled === false) readinessState = "shotDisabled";
  else if (!camera) readinessState = "missingCamera";
  else if (camera.enabled === false) readinessState = "cameraDisabled";
  else if (shot.cameraPresetId && !requestedPreset) readinessState = "missingPreset";
  else if (requestedPreset && camera && requestedPreset.cameraDeviceId !== camera.id) readinessState = "presetCameraMismatch";
  else if (preset?.enabled === false) readinessState = "presetDisabled";
  else if (!camera.ipAddress || !camera.protocol) readinessState = "configurationIncomplete";

  return {
    shot,
    shotId: shot.id,
    shotName: shot.name,
    camera,
    cameraDeviceId: camera?.id || null,
    cameraName: camera?.name || null,
    logicalCameraRole: shot.logicalCameraRole || camera?.logicalRole || null,
    preset,
    presetId: preset?.id || shot.cameraPresetId || null,
    presetName: preset?.name || null,
    tracking: {
      mode: shot.trackingMode,
      preferred: shot.trackingPreferred === true,
      subject: shot.trackingSubject,
      notes: shot.trackingNotes
    },
    motion: {
      enabled: shot.motionEnabled === true,
      profileId: shot.motionProfileId,
      durationMs: shot.motionDurationMs,
      speed: shot.motionSpeed,
      notes: shot.motionNotes
    },
    capabilityReadiness: camera ? "adapterRequired" : "unavailable",
    readinessState,
    source,
    warnings
  };
}

function summarizeShotReadiness(resolved) {
  const labels = {
    ready: "Ready",
    missingShot: "Missing Shot",
    shotDisabled: "Shot disabled",
    missingCamera: "Missing camera",
    cameraDisabled: "Camera disabled",
    missingPreset: "Missing preset",
    presetDisabled: "Preset disabled",
    presetCameraMismatch: "Preset/camera mismatch",
    configurationIncomplete: "Configuration incomplete"
  };
  return labels[resolved?.readinessState] || "Adapter required";
}

function summarizeShot(state, shotOrId) {
  const resolved = resolveShotTarget(state, shotOrId);
  const shot = resolved.shot;
  return {
    id: shot?.id || (typeof shotOrId === "string" ? shotOrId : null),
    name: shot?.name || "Missing Shot",
    category: shot?.category || "Utility",
    framing: [shot?.subject, shot?.framingType].filter(Boolean).join(" · ") || "Framing not assigned",
    cameraName: resolved.cameraName || "Not assigned",
    presetName: resolved.presetName || (shot?.cameraPresetId ? "Missing preset" : "Not assigned"),
    tracking: shot?.trackingPreferred ? "Preferred" : shot?.trackingMode || "Off",
    motion: shot?.motionEnabled ? "On" : "Off",
    enabled: shot?.enabled !== false,
    readiness: summarizeShotReadiness(resolved),
    warnings: resolved.warnings || []
  };
}

function listShotCategories(state) {
  const categories = new Map(SUGGESTED_SHOT_CATEGORIES.map(category => [categoryKey(category), category]));
  for (const shot of state?.shots || []) {
    const category = nullable(shot?.category) || "Utility";
    if (!categories.has(categoryKey(category))) categories.set(categoryKey(category), category);
  }
  return [...categories.values()];
}

const listShotsByCamera = (state, cameraDeviceId) => (state?.shots || []).filter(shot => shot.cameraDeviceId === cameraDeviceId);
const listShotsByRole = (state, role) => (state?.shots || []).filter(shot => shot.logicalCameraRole === role);
const listShotsByCategory = (state, category) => (state?.shots || []).filter(shot => categoryKey(shot.category) === categoryKey(category));
const listFavoriteShots = state => (state?.shots || []).filter(shot => shot.favorite === true);

function filterShots(state, filters = {}) {
  const search = text(filters.search).toLocaleLowerCase();
  return (state?.shots || []).filter(shot =>
    (!search || `${shot.name} ${shot.description} ${shot.subject} ${shot.framingType} ${(shot.tags || []).join(" ")}`.toLocaleLowerCase().includes(search)) &&
    (!filters.category || categoryKey(shot.category) === categoryKey(filters.category)) &&
    (!filters.cameraDeviceId || shot.cameraDeviceId === filters.cameraDeviceId) &&
    (!filters.logicalCameraRole || shot.logicalCameraRole === filters.logicalCameraRole) &&
    (filters.favorite === undefined || shot.favorite === filters.favorite) &&
    (filters.enabled === undefined || shot.enabled === filters.enabled)
  );
}

module.exports = {
  DEFAULT_SHOT_DEFINITIONS,
  SHOT_SCHEMA_VERSION,
  SUGGESTED_SHOT_CATEGORIES,
  countShotReferences,
  createShot,
  defaultShots,
  deleteShot,
  duplicateShot,
  filterShots,
  listFavoriteShots,
  listShotCategories,
  listShotsByCamera,
  listShotsByCategory,
  listShotsByRole,
  migrateShots,
  normalizeShot,
  reorderShot,
  resolveShotTarget,
  summarizeShot,
  summarizeShotReadiness,
  updateShot,
  validateShot
};
