"use strict";

const PRODUCTION_LOOK_SCHEMA_VERSION = 2;

function nullableString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value, fallback = 0, minimum = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, number) : fallback;
}

function uniqueId(prefix = "look") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCameraAssignmentRole(role) {
  const value = nullableString(role)?.toLowerCase() || "camera";
  if (value === "aux") return "auxiliary";
  if (["program", "preview", "auxiliary"].includes(value)) return value;
  return value;
}

function cloneAssignments(assignments) {
  if (!Array.isArray(assignments)) return [];
  return assignments.map(item => ({
    role: normalizeCameraAssignmentRole(item?.role),
    cameraId: nullableString(item?.cameraId),
    presetId: nullableString(item?.presetId)
  }));
}

function normalizeCameraAssignments(input) {
  const assignments = cloneAssignments(input.cameraAssignments);
  for (const [role, cameraId] of [["program", nullableString(input.programCameraId)], ["preview", nullableString(input.previewCameraId)]]) {
    if (!cameraId) continue;
    const existing = assignments.find(item => item.role === role);
    if (existing) {
      if (!existing.cameraId) existing.cameraId = cameraId;
    } else {
      assignments.push({ role, cameraId, presetId: null });
    }
  }
  return assignments;
}

function normalizeProductionLook(input = {}, { now = Date.now() } = {}) {
  const timestamp = "1970-01-01T00:00:00.000Z";
  const createdAt = nullableString(input.createdAt) || timestamp;
  return {
    ...input,
    schemaVersion: PRODUCTION_LOOK_SCHEMA_VERSION,
    id: nullableString(input.id) || uniqueId(),
    name: typeof input.name === "string" ? input.name : "Untitled Look",
    description: typeof input.description === "string" ? input.description : "",
    color: nullableString(input.color) || "#4da9ff",
    enabled: input.enabled !== false,
    createdAt,
    updatedAt: nullableString(input.updatedAt) || createdAt,
    lightingSceneId: nullableString(input.lightingSceneId),
    lightingFadeMs: finiteNumber(input.lightingFadeMs, 0),
    stageWashMode: nullableString(input.stageWashMode),
    wallWashMode: nullableString(input.wallWashMode),
    cameraLayoutId: nullableString(input.cameraLayoutId),
    programCameraId: nullableString(input.programCameraId),
    previewCameraId: nullableString(input.previewCameraId),
    transitionStyle: nullableString(input.transitionStyle) || "cut",
    transitionDurationMs: finiteNumber(input.transitionDurationMs, 0),
    cameraAssignments: normalizeCameraAssignments(input),
    selectedShotId: nullableString(input.selectedShotId),
    motionProfileId: nullableString(input.motionProfileId),
    motionDurationMs: finiteNumber(input.motionDurationMs, 0),
    motionSpeed: finiteNumber(input.motionSpeed, 1),
    motionEnabled: input.motionEnabled === true,
    audioSceneId: nullableString(input.audioSceneId),
    presentationCueId: nullableString(input.presentationCueId),
    tags: Array.isArray(input.tags) ? input.tags.map(String).map(tag => tag.trim()).filter(Boolean) : [],
    operatorNotes: typeof input.operatorNotes === "string" ? input.operatorNotes : ""
  };
}

function normalizeProductionLooks(looks, options) {
  return Array.isArray(looks) ? looks.map(look => normalizeProductionLook(look, options)) : [];
}

function validateProductionLook(look) {
  const errors = [];
  if (!nullableString(look?.name)) errors.push("Production Look name is required");
  if (look?.lightingFadeMs < 0) errors.push("Lighting fade cannot be negative");
  if (look?.transitionDurationMs < 0) errors.push("Transition duration cannot be negative");
  if (look?.motionSpeed < 0) errors.push("Motion speed cannot be negative");
  return { valid: errors.length === 0, errors };
}

function requireLook(state, lookId) {
  const look = (state.productionLooks || []).find(item => item?.id === lookId);
  if (!look) throw new RangeError(`Unknown Production Look: ${lookId}`);
  return look;
}

function createProductionLook(state, input = {}, options = {}) {
  if (!Array.isArray(state.productionLooks)) state.productionLooks = [];
  const createdAt = input.createdAt || new Date(options.now || Date.now()).toISOString();
  const look = normalizeProductionLook({ ...input, id: input.id || options.id || uniqueId(), createdAt, updatedAt: input.updatedAt || createdAt }, options);
  const validation = validateProductionLook(look);
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  if (state.productionLooks.some(item => item.id === look.id)) throw new RangeError(`Production Look ID already exists: ${look.id}`);
  state.productionLooks.push(look);
  return look;
}

function updateProductionLook(state, lookId, patch = {}, { now = Date.now() } = {}) {
  const index = (state.productionLooks || []).findIndex(item => item?.id === lookId);
  if (index < 0) throw new RangeError(`Unknown Production Look: ${lookId}`);
  const current = state.productionLooks[index];
  const candidate = normalizeProductionLook({ ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: new Date(now).toISOString() }, { now });
  const validation = validateProductionLook(candidate);
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  state.productionLooks[index] = candidate;
  return candidate;
}

function duplicateProductionLook(state, lookId, { id = uniqueId(), now = Date.now() } = {}) {
  const source = requireLook(state, lookId);
  const copy = JSON.parse(JSON.stringify(source));
  return createProductionLook(state, { ...copy, id, name: `${source.name} Copy`, createdAt: null, updatedAt: null }, { now });
}

function deleteProductionLook(state, lookId, { confirmReferences = false } = {}) {
  const index = (state.productionLooks || []).findIndex(item => item?.id === lookId);
  if (index < 0) throw new RangeError(`Unknown Production Look: ${lookId}`);
  const references = (state.runOfService || []).filter(cue => cue?.productionLookId === lookId);
  if (references.length && !confirmReferences) {
    const error = new Error(`This Production Look is referenced by ${references.length} cue${references.length === 1 ? "" : "s"}`);
    error.code = "CONFIRM_LOOK_DELETE";
    error.statusCode = 409;
    error.references = references.map(cue => ({ id: cue.id, name: cue.name }));
    throw error;
  }
  state.productionLooks.splice(index, 1);
  return { deletedId: lookId, references: references.length };
}

function findResource(items, id) {
  return nullableString(id) ? (Array.isArray(items) ? items.find(item => item?.id === id) : undefined) : undefined;
}

function resolveProductionLookCameraAssignments(state, lookOrId, cue = {}) {
  const look = typeof lookOrId === "string" ? findResource(state?.productionLooks, lookOrId) : lookOrId;
  const camera = id => findResource(state?.devices, id) || findResource(state?.cameras, id);
  const preset = id => findResource(state?.cameraPresets, id);
  const assignments = cloneAssignments(look?.cameraAssignments);
  const warnings = [];
  const cueLayout = findResource(state?.cameraLayouts, cue?.cameraLayoutId);
  const legacyLayout = findResource(state?.cameraLayouts, look?.cameraLayoutId);

  if (cue?.cameraLayoutId && !cueLayout) warnings.push(`Missing cue camera layout: ${cue.cameraLayoutId}`);
  if (look?.cameraLayoutId && !legacyLayout) warnings.push(`Missing Production Look camera layout: ${look.cameraLayoutId}`);

  function modern(role) {
    return assignments.find(item => item.role === role && item.cameraId) || null;
  }

  function resolveRole(role) {
    const modernAssignment = modern(role);
    const candidates = [
      cueLayout ? { cameraId: role === "program" ? cueLayout.programCamera : cueLayout.previewCamera, presetName: role === "program" ? cueLayout.programPreset : cueLayout.previewPreset, source: "cue" } : null,
      modernAssignment ? { ...modernAssignment, source: "production-look-assignment" } : null,
      look?.[`${role}CameraId`] ? { cameraId: look[`${role}CameraId`], source: "legacy-video" } : null,
      legacyLayout ? { cameraId: role === "program" ? legacyLayout.programCamera : legacyLayout.previewCamera, presetName: role === "program" ? legacyLayout.programPreset : legacyLayout.previewPreset, source: "legacy-layout" } : null
    ].filter(candidate => candidate?.cameraId);

    for (const candidate of candidates) {
      const resolvedCamera = camera(candidate.cameraId);
      if (!resolvedCamera) {
        warnings.push(`Missing ${role} camera (${candidate.source}): ${candidate.cameraId}`);
        continue;
      }
      const presetId = candidate.presetId || null;
      const resolvedPreset = preset(presetId);
      if (presetId && !resolvedPreset) warnings.push(`Missing ${role} preset: ${presetId}`);
      return {
        role,
        cameraDeviceId: candidate.cameraId,
        cameraName: resolvedCamera.name || null,
        presetId,
        presetName: resolvedPreset?.name || candidate.presetName || null,
        source: candidate.source,
        missing: Boolean(presetId && !resolvedPreset)
      };
    }

    const missingCandidate = candidates[0];
    return {
      role,
      cameraDeviceId: missingCandidate?.cameraId || null,
      cameraName: null,
      presetId: missingCandidate?.presetId || null,
      presetName: null,
      source: missingCandidate?.source || "unassigned",
      missing: Boolean(missingCandidate)
    };
  }

  const program = resolveRole("program");
  const preview = resolveRole("preview");
  const auxiliary = assignments
    .filter(item => item.role === "auxiliary" && (item.cameraId || item.presetId))
    .map(item => {
      const resolvedCamera = camera(item.cameraId);
      const resolvedPreset = preset(item.presetId);
      if (item.cameraId && !resolvedCamera) warnings.push(`Missing auxiliary camera: ${item.cameraId}`);
      if (item.presetId && !resolvedPreset) warnings.push(`Missing auxiliary preset: ${item.presetId}`);
      return {
        role: "auxiliary",
        cameraDeviceId: item.cameraId,
        cameraName: resolvedCamera?.name || null,
        presetId: item.presetId,
        presetName: resolvedPreset?.name || null,
        source: "production-look-assignment",
        missing: Boolean((item.cameraId && !resolvedCamera) || (item.presetId && !resolvedPreset))
      };
    });

  const resolvedAssignments = [program, preview, ...auxiliary];
  const sources = [program.source, preview.source].filter(source => source !== "unassigned");
  return {
    program,
    preview,
    auxiliary,
    programCameraId: program.cameraName ? program.cameraDeviceId : null,
    previewCameraId: preview.cameraName ? preview.cameraDeviceId : null,
    auxiliaryCameraIds: auxiliary.filter(item => item.cameraName && item.cameraDeviceId).map(item => item.cameraDeviceId),
    cameraAssignments: resolvedAssignments,
    source: sources.includes("cue") ? "cue" : sources.length ? "production-look" : "fallback",
    warnings
  };
}

function resolveProductionLookResources(state, lookOrId) {
  const look = typeof lookOrId === "string" ? findResource(state?.productionLooks, lookOrId) : lookOrId;
  const layout = findResource(state?.cameraLayouts, look?.cameraLayoutId);
  const camera = id => findResource(state?.devices, id) || findResource(state?.cameras, id);
  const resolvedCameras = resolveProductionLookCameraAssignments(state, look);
  return {
    look: look || null,
    lightingScene: findResource(state?.lightingScenes, look?.lightingSceneId) || null,
    cameraLayout: layout || null,
    programCamera: camera(resolvedCameras.programCameraId) || null,
    previewCamera: camera(resolvedCameras.previewCameraId) || null,
    cameraAssignments: cloneAssignments(look?.cameraAssignments).map(assignment => ({
      ...assignment,
      camera: camera(assignment.cameraId) || null
    }))
  };
}

function summarizeProductionLook(state, lookOrId) {
  const resources = resolveProductionLookResources(state, lookOrId);
  const look = resources.look;
  if (!look) return { name: "Not assigned", lighting: "Not assigned", programCamera: "Not assigned", previewCamera: "Not assigned", presets: "No presets", motion: "Off", enabled: false };
  const presets = resources.cameraAssignments.filter(item => item.presetId).map(item => {
    const preset = findResource(state?.cameraPresets, item.presetId);
    return `${item.role}: ${preset?.name || `Missing: ${item.presetId}`}`;
  }).join(", ");
  return {
    name: look.name || "Untitled Look",
    lighting: resources.lightingScene?.name || (look.lightingSceneId ? `Missing: ${look.lightingSceneId}` : "Not assigned"),
    programCamera: resources.programCamera?.name || (look.programCameraId ? `Missing: ${look.programCameraId}` : "Not assigned"),
    previewCamera: resources.previewCamera?.name || (look.previewCameraId ? `Missing: ${look.previewCameraId}` : "Not assigned"),
    presets: presets || "No presets",
    motion: look.motionEnabled ? `On · ${look.motionSpeed}x` : "Off",
    enabled: look.enabled !== false
  };
}

module.exports = {
  PRODUCTION_LOOK_SCHEMA_VERSION,
  createProductionLook,
  deleteProductionLook,
  duplicateProductionLook,
  normalizeProductionLook,
  normalizeProductionLooks,
  normalizeCameraAssignmentRole,
  resolveProductionLookCameraAssignments,
  resolveProductionLookResources,
  summarizeProductionLook,
  updateProductionLook,
  validateProductionLook
};
