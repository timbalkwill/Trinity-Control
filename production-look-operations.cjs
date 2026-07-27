"use strict";

const { resolveShotTarget } = require("./shot-operations.cjs");

const PRODUCTION_LOOK_SCHEMA_VERSION = 3;
const LOOK_ROLES = ["main", "left", "right"];
const nullableString = value => typeof value === "string" && value.trim() ? value.trim() : null;
const clone = value => JSON.parse(JSON.stringify(value));

function uniqueId(prefix = "look") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function findResource(items, id) {
  return nullableString(id) ? (Array.isArray(items) ? items.find(item => item?.id === id) : undefined) : undefined;
}

function cameraDevices(state) {
  const devices = (state?.devices || []).filter(item => item?.type === "camera");
  const known = new Set(devices.map(item => item.id));
  return [...devices, ...(state?.cameras || []).filter(item => item?.id && !known.has(item.id)).map(item => ({
    ...item,
    type: "camera",
    logicalRole: item.logicalRole || item.role || (LOOK_ROLES.includes(item.id) ? item.id : null),
    enabled: item.enabled !== false
  }))];
}

function cameraForRole(state, role) {
  return cameraDevices(state).find(item => item.logicalRole === role) ||
    (role === "main" ? cameraDevices(state).find(item => item.id === "main" || item.logicalRole === "center") : undefined);
}

function roleForCamera(state, cameraId) {
  const camera = findResource(cameraDevices(state), cameraId);
  const role = camera?.logicalRole === "center" ? "main" : camera?.logicalRole;
  return LOOK_ROLES.includes(role) ? role : null;
}

function emptyPresetAssignment(input = {}) {
  return {
    cameraId: nullableString(input.cameraId || input.cameraDeviceId),
    presetId: nullableString(input.presetId || input.cameraPresetId)
  };
}

function legacyAssignment(input, role) {
  const aliases = role === "main" ? ["main", "program"] : role === "left" ? ["left", "preview"] : ["right"];
  return (Array.isArray(input.cameraAssignments) ? input.cameraAssignments : []).find(item => {
    const value = String(item?.role || "").toLowerCase();
    return aliases.includes(value);
  });
}

function migratePresetAssignment(input, role, state) {
  const current = input.cameraPresets?.[role];
  if (current && typeof current === "object") {
    const assignment = emptyPresetAssignment(current);
    const preset = findResource(state?.cameraPresets, assignment.presetId);
    if (preset && roleForCamera(state, preset.cameraDeviceId) === role) {
      assignment.cameraId = preset.cameraDeviceId;
    }
    return assignment;
  }

  const roleCamera = cameraForRole(state, role);
  const assignments = Array.isArray(input.cameraAssignments) ? input.cameraAssignments : [];
  const assignment = assignments.find(item => roleForCamera(state, item?.cameraId || item?.cameraDeviceId) === role) || legacyAssignment(input, role);
  let cameraId = nullableString(assignment?.cameraId || assignment?.cameraDeviceId);
  let presetId = nullableString(assignment?.presetId || assignment?.cameraPresetId);
  const legacyLayout = findResource(state?.cameraLayouts, input.cameraLayoutId);
  const layoutCandidates = [
    { cameraId: legacyLayout?.programCamera, presetName: legacyLayout?.programPreset },
    { cameraId: legacyLayout?.previewCamera, presetName: legacyLayout?.previewPreset }
  ];
  const layoutMatch = layoutCandidates.find(item => roleForCamera(state, item.cameraId) === role);
  const layoutCameraId = layoutMatch?.cameraId;
  const layoutPresetName = layoutMatch?.presetName;

  if (!cameraId && roleForCamera(state, input.programCameraId) === role) cameraId = nullableString(input.programCameraId);
  if (!cameraId && roleForCamera(state, input.previewCameraId) === role) cameraId = nullableString(input.previewCameraId);
  if (!cameraId) cameraId = nullableString(layoutCameraId);
  if (!cameraId && roleCamera) cameraId = roleCamera.id;

  const shotId = nullableString(assignment?.shotId || (role === "main" ? input.selectedShotId : null));
  if (shotId && state) {
    const resolved = resolveShotTarget(state, shotId);
    if (!cameraId && resolved.cameraDeviceId) cameraId = resolved.cameraDeviceId;
    if (!presetId && resolved.preset?.id && resolved.preset.cameraDeviceId === (cameraId || resolved.cameraDeviceId)) presetId = resolved.preset.id;
  }

  if (!presetId && assignment?.presetName && cameraId) {
    presetId = (state?.cameraPresets || []).find(item => item.cameraDeviceId === cameraId && item.name === assignment.presetName)?.id || null;
  }
  if (!presetId && layoutPresetName && cameraId) {
    presetId = (state?.cameraPresets || []).find(item => item.cameraDeviceId === cameraId && item.name === layoutPresetName)?.id || null;
  }
  return { cameraId, presetId };
}

function migratePriorityCamera(input, state) {
  if ("priorityCameraId" in input) return nullableString(input.priorityCameraId);
  const program = nullableString(input.programCameraId) ||
    nullableString(legacyAssignment(input, "main")?.cameraId) ||
    nullableString(findResource(state?.cameraLayouts, input.cameraLayoutId)?.programCamera);
  if (program) return program;
  const shotId = nullableString(legacyAssignment(input, "main")?.shotId || input.selectedShotId);
  return shotId && state ? resolveShotTarget(state, shotId).cameraDeviceId || null : null;
}

function normalizeProductionLook(input = {}, { now = Date.now(), state } = {}) {
  const timestamp = "1970-01-01T00:00:00.000Z";
  const createdAt = nullableString(input.createdAt) || timestamp;
  const normalized = {
    schemaVersion: PRODUCTION_LOOK_SCHEMA_VERSION,
    id: nullableString(input.id) || uniqueId(),
    name: typeof input.name === "string" ? input.name.trim() : "Untitled Look",
    enabled: input.enabled !== false,
    lightingSceneId: nullableString(input.lightingSceneId),
    cameraPresets: Object.fromEntries(LOOK_ROLES.map(role => [role, migratePresetAssignment(input, role, state)])),
    priorityCameraId: migratePriorityCamera(input, state),
    startMainTracking: "startMainTracking" in input ? input.startMainTracking === true : input.tracking === true,
    createdAt,
    updatedAt: nullableString(input.updatedAt) || createdAt
  };
  return normalized;
}

function normalizeProductionLooks(looks, options = {}) {
  return Array.isArray(looks) ? looks.map(look => normalizeProductionLook(look, options)) : [];
}

function readinessWarnings(state, lookOrId) {
  const look = typeof lookOrId === "string" ? findResource(state?.productionLooks, lookOrId) : lookOrId;
  if (!look) return ["Missing Production Look"];
  const warnings = [];
  if (look.enabled === false) warnings.push("Production Look is disabled");
  if (look.lightingSceneId && !findResource(state?.lightingScenes, look.lightingSceneId)) warnings.push("Missing lighting scene reference");
  for (const role of LOOK_ROLES) {
    const label = role[0].toUpperCase() + role.slice(1);
    const assignment = look.cameraPresets?.[role] || {};
    const configured = cameraForRole(state, role);
    const camera = findResource(cameraDevices(state), assignment.cameraId);
    if (!configured) warnings.push(`No ${label} camera configured`);
    if (assignment.cameraId && !camera) warnings.push(`Missing ${label} camera reference`);
    if (camera?.enabled === false) warnings.push(`${label} camera is disabled`);
    const preset = findResource(state?.cameraPresets, assignment.presetId);
    if (assignment.presetId && !preset) warnings.push(`Missing ${label} preset reference`);
    if (preset?.enabled === false) warnings.push(`${label} preset is disabled`);
    if (preset && assignment.cameraId && preset.cameraDeviceId !== assignment.cameraId) warnings.push(`${label} preset belongs to another camera`);
  }
  const priority = findResource(cameraDevices(state), look.priorityCameraId);
  if (look.priorityCameraId && !priority) warnings.push("Missing priority camera reference");
  if (priority?.enabled === false) warnings.push("Priority camera is disabled");
  if (look.startMainTracking) {
    const main = cameraForRole(state, "main");
    if (!main) warnings.push("Tracking requested but no Main camera is configured");
    else if (main.trackingEnabled === false || main.metadata?.cameraManager?.capabilities?.tracking === "unsupported") warnings.push("Main camera tracking is not supported");
  }
  return [...new Set(warnings)];
}

function validateProductionLook(look, state) {
  const errors = [];
  if (!nullableString(look?.name)) errors.push("Production Look name is required");
  if (!look?.cameraPresets || typeof look.cameraPresets !== "object") errors.push("Camera presets are required");
  if (state) {
    for (const role of LOOK_ROLES) {
      const assignment = look.cameraPresets?.[role] || {};
      const preset = findResource(state.cameraPresets, assignment.presetId);
      if (preset && assignment.cameraId && preset.cameraDeviceId !== assignment.cameraId) {
        errors.push(`${role[0].toUpperCase() + role.slice(1)} preset belongs to another camera`);
      }
    }
    const priority = findResource(cameraDevices(state), look.priorityCameraId);
    if (priority && !LOOK_ROLES.includes(roleForCamera(state, priority.id))) errors.push("Priority camera must use the Main, Left, or Right role");
  }
  return { valid: errors.length === 0, errors, warnings: state ? readinessWarnings(state, look) : [] };
}

function requireLook(state, lookId) {
  const look = findResource(state?.productionLooks, lookId);
  if (!look) throw new RangeError(`Unknown Production Look: ${lookId}`);
  return look;
}

function createProductionLook(state, input = {}, options = {}) {
  if (!Array.isArray(state.productionLooks)) state.productionLooks = [];
  const createdAt = input.createdAt || new Date(options.now || Date.now()).toISOString();
  const look = normalizeProductionLook({ ...input, id: input.id || options.id || uniqueId(), createdAt, updatedAt: input.updatedAt || createdAt }, { ...options, state });
  const validation = validateProductionLook(look, state);
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  if (state.productionLooks.some(item => item.id === look.id)) throw new RangeError(`Production Look ID already exists: ${look.id}`);
  state.productionLooks.push(look);
  return look;
}

function updateProductionLook(state, lookId, patch = {}, { now = Date.now() } = {}) {
  const index = (state.productionLooks || []).findIndex(item => item?.id === lookId);
  if (index < 0) throw new RangeError(`Unknown Production Look: ${lookId}`);
  const current = state.productionLooks[index];
  const candidate = normalizeProductionLook({ ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: new Date(now).toISOString() }, { now, state });
  const validation = validateProductionLook(candidate, state);
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  state.productionLooks[index] = candidate;
  return candidate;
}

function duplicateProductionLook(state, lookId, { id = uniqueId(), now = Date.now() } = {}) {
  const source = requireLook(state, lookId);
  return createProductionLook(state, { ...clone(source), id, name: `${source.name} Copy`, createdAt: null, updatedAt: null }, { now });
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

function searchProductionLooks(looks, query = "") {
  const needle = String(query).trim().toLowerCase();
  return (Array.isArray(looks) ? looks : []).filter(look => !needle || String(look?.name || "").toLowerCase().includes(needle));
}

function resolveRoleAssignment(state, look, role) {
  const requested = look?.cameraPresets?.[role] || {};
  const configured = cameraForRole(state, role);
  const preset = findResource(state?.cameraPresets, requested.presetId);
  // Older saved schema-v3 records can contain a correct role-scoped preset ID
  // paired with a stale camera ID. The preset is the authoritative resource:
  // when it belongs to this logical role, use its stable cameraDeviceId. This
  // repairs the pair at resolution time without weakening wrong-role validation.
  const presetRole = preset ? roleForCamera(state, preset.cameraDeviceId) : null;
  const cameraId = preset && presetRole === role
    ? preset.cameraDeviceId
    : requested.cameraId || configured?.id || null;
  const camera = findResource(cameraDevices(state), cameraId);
  const validPreset = preset && presetRole === role && camera && preset.cameraDeviceId === camera.id && preset.enabled !== false;
  return {
    role,
    cameraDeviceId: camera?.id || cameraId,
    cameraName: camera?.name || null,
    presetId: validPreset ? preset.id : requested.presetId || null,
    presetName: validPreset ? preset.name : null,
    shotId: null,
    shotName: null,
    tracking: null,
    motion: null,
    source: "production-look",
    missing: Boolean((requested.cameraId && !camera) || (requested.presetId && !validPreset)),
    warnings: readinessWarnings(state, look).filter(warning => warning.toLowerCase().includes(role))
  };
}

function resolveProductionLookCameraAssignments(state, lookOrId, cue = {}) {
  const rawLook = typeof lookOrId === "string" ? findResource(state?.productionLooks, lookOrId) : lookOrId;
  const look = rawLook?.schemaVersion === PRODUCTION_LOOK_SCHEMA_VERSION && rawLook.cameraPresets
    ? rawLook
    : normalizeProductionLook(rawLook || {}, { state });
  const roleAssignments = LOOK_ROLES.map(role => resolveRoleAssignment(state, look, role));
  const priority = findResource(cameraDevices(state), look.priorityCameraId);
  const cueLayout = findResource(state?.cameraLayouts, cue?.cameraLayoutId);
  const legacyLayout = rawLook?.schemaVersion !== PRODUCTION_LOOK_SCHEMA_VERSION ? findResource(state?.cameraLayouts, rawLook?.cameraLayoutId) : null;
  const activeLayout = cueLayout || legacyLayout;
  const programCameraId = activeLayout?.programCamera || (priority?.enabled !== false ? priority?.id : null);
  const previewCameraId = activeLayout?.previewCamera ||
    nullableString(rawLook?.previewCameraId) ||
    nullableString(legacyAssignment(rawLook || {}, "left")?.cameraId) ||
    (state?.live?.previewCamera && state.live.previewCamera !== programCameraId ? state.live.previewCamera : null) ||
    (state?.live?.programCamera && state.live.programCamera !== programCameraId ? state.live.programCamera : null);
  const assignmentFor = (cameraId, role, presetName) => {
    const existing = roleAssignments.find(item => item.cameraDeviceId === cameraId);
    const preset = presetName && cameraId
      ? (state?.cameraPresets || []).find(item => item.cameraDeviceId === cameraId && item.name === presetName)
      : null;
    return existing ? {
      ...existing,
      role,
      presetId: preset?.id || existing.presetId,
      presetName: preset?.name || existing.presetName || presetName || null,
      source: activeLayout ? (cueLayout ? "cue" : "legacy-layout") : existing.source
    } : {
      role, cameraDeviceId: cameraId, cameraName: findResource(cameraDevices(state), cameraId)?.name || null,
      presetId: preset?.id || null, presetName: preset?.name || presetName || null, shotId: null, shotName: null,
      tracking: null, motion: null, source: activeLayout ? (cueLayout ? "cue" : "legacy-layout") : "production-look",
      missing: Boolean(cameraId && !findResource(cameraDevices(state), cameraId)), warnings: []
    };
  };
  const program = assignmentFor(programCameraId, "program", activeLayout?.programPreset) || {
    role: "program", cameraDeviceId: programCameraId, cameraName: priority?.name || null, presetId: null, presetName: null,
    shotId: null, shotName: null, tracking: null, motion: null, source: cueLayout ? "cue" : "production-look", missing: !priority, warnings: []
  };
  const preview = assignmentFor(previewCameraId, "preview", activeLayout?.previewPreset);
  return {
    program,
    preview,
    auxiliary: [],
    programCameraId,
    previewCameraId,
    auxiliaryCameraIds: [],
    cameraAssignments: [program, preview, ...roleAssignments],
    source: cueLayout ? "cue" : rawLook ? "production-look" : "fallback",
    warnings: readinessWarnings(state, look)
  };
}

function resolveProductionLookResources(state, lookOrId) {
  const look = typeof lookOrId === "string" ? findResource(state?.productionLooks, lookOrId) : lookOrId;
  return {
    look: look || null,
    lightingScene: findResource(state?.lightingScenes, look?.lightingSceneId) || null,
    priorityCamera: findResource(cameraDevices(state), look?.priorityCameraId) || null,
    cameraAssignments: LOOK_ROLES.map(role => ({ ...resolveRoleAssignment(state, look, role), camera: findResource(cameraDevices(state), look?.cameraPresets?.[role]?.cameraId) || null }))
  };
}

function summarizeProductionLook(state, lookOrId) {
  const resources = resolveProductionLookResources(state, lookOrId);
  const look = resources.look;
  if (!look) return { name: "Not assigned", enabled: false, warnings: ["Missing Production Look"] };
  return {
    name: look.name,
    enabled: look.enabled !== false,
    lighting: resources.lightingScene?.name || (look.lightingSceneId ? "Missing reference" : "Not assigned"),
    priorityCamera: resources.priorityCamera?.name || (look.priorityCameraId ? "Missing reference" : "Not assigned"),
    presets: Object.fromEntries(resources.cameraAssignments.map(item => [item.role, item.presetName || (item.presetId ? "Missing reference" : "Not assigned")])),
    startMainTracking: look.startMainTracking === true,
    warnings: readinessWarnings(state, look)
  };
}

module.exports = {
  LOOK_ROLES,
  PRODUCTION_LOOK_SCHEMA_VERSION,
  cameraForRole,
  createProductionLook,
  deleteProductionLook,
  duplicateProductionLook,
  normalizeProductionLook,
  normalizeProductionLooks,
  readinessWarnings,
  resolveProductionLookCameraAssignments,
  resolveProductionLookResources,
  searchProductionLooks,
  summarizeProductionLook,
  updateProductionLook,
  validateProductionLook
};
