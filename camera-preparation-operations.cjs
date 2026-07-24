"use strict";

const CAMERA_PREPARATION_SCHEMA_VERSION = 1;
const MODES = new Set(["static", "motion"]);
const STATUSES = new Set(["idle", "preparing", "ready", "running", "complete", "error"]);

const nullable = value => typeof value === "string" && value.trim() ? value.trim() : null;
const clone = value => value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;

function cameraDevices(state) {
  return (state?.devices || []).filter(device => device?.type === "camera");
}

function trackingSupported(device) {
  return device?.trackingEnabled === true ||
    device?.capabilities?.tracking === true ||
    device?.metadata?.cameraManager?.capabilities?.tracking === "supported";
}

function normalizePreparation(input = {}, device) {
  const selectedMode = MODES.has(input.selectedMode) ? input.selectedMode : "static";
  const selectedPresetId = selectedMode === "static" ? nullable(input.selectedPresetId) : null;
  const selectedMotionId = selectedMode === "motion" ? nullable(input.selectedMotionId) : null;
  const supported = trackingSupported(device);
  return {
    ...input,
    cameraId: device.id,
    selectedMode,
    selectedPresetId,
    selectedMotionId,
    preparationStatus: STATUSES.has(input.preparationStatus) ? input.preparationStatus : "idle",
    errorMessage: nullable(input.errorMessage),
    tracking: {
      supported,
      active: supported && input.tracking?.active === true
    },
    preparedAssignment: input.preparedAssignment && typeof input.preparedAssignment === "object"
      ? clone(input.preparedAssignment)
      : null,
    motionRunCount: Math.max(0, Number(input.motionRunCount) || 0),
    lastMotionStartedAt: Number(input.lastMotionStartedAt) || null,
    lastMotionCompletedAt: Number(input.lastMotionCompletedAt) || null
  };
}

function migrateCameraPreparations(state) {
  state.live = state.live && typeof state.live === "object" ? state.live : {};
  const existing = new Map((Array.isArray(state.live.cameraPreparations) ? state.live.cameraPreparations : [])
    .filter(item => item?.cameraId)
    .map(item => [item.cameraId, item]));
  state.live.cameraPreparations = cameraDevices(state).map(device => normalizePreparation(existing.get(device.id), device));
  state.cameraPreparationSchemaVersion = CAMERA_PREPARATION_SCHEMA_VERSION;
  return state.live.cameraPreparations;
}

function preparationFor(state, cameraId) {
  migrateCameraPreparations(state);
  return state.live.cameraPreparations.find(item => item.cameraId === cameraId) || null;
}

function cameraFor(state, cameraId) {
  const camera = cameraDevices(state).find(device => device.id === cameraId);
  if (!camera) throw new RangeError(`Unknown camera: ${cameraId}`);
  return camera;
}

function presetForCamera(state, cameraId, presetId) {
  const preset = (state?.cameraPresets || []).find(item => item?.id === presetId && item.cameraDeviceId === cameraId && item.enabled !== false);
  if (!preset) throw new RangeError(`Unknown preset for camera ${cameraId}: ${presetId}`);
  return preset;
}

function motionForCamera(state, camera, motionId) {
  const motion = (state?.shots || []).find(item => item?.id === motionId && item.enabled !== false);
  const assigned = motion && (motion.cameraDeviceId === camera.id || (!motion.cameraDeviceId && motion.logicalCameraRole === camera.logicalRole));
  if (!assigned) throw new RangeError(`Unknown motion for camera ${camera.id}: ${motionId}`);
  return motion;
}

function setCameraMode(state, cameraId, mode) {
  cameraFor(state, cameraId);
  if (!MODES.has(mode)) throw new TypeError(`Unsupported camera mode: ${mode}`);
  const preparation = preparationFor(state, cameraId);
  preparation.selectedMode = mode;
  preparation.selectedPresetId = mode === "static" ? preparation.selectedPresetId : null;
  preparation.selectedMotionId = mode === "motion" ? preparation.selectedMotionId : null;
  preparation.preparationStatus = "idle";
  preparation.errorMessage = null;
  preparation.preparedAssignment = null;
  return preparation;
}

function prepareCamera(state, cameraId, selectionId, { now = Date.now } = {}) {
  const camera = cameraFor(state, cameraId);
  const preparation = preparationFor(state, cameraId);
  if (preparation.tracking.active) {
    const error = new Error("Stop tracking before changing camera preparation.");
    error.code = "CAMERA_TRACKING_ACTIVE";
    error.statusCode = 409;
    throw error;
  }
  preparation.preparationStatus = "preparing";
  preparation.errorMessage = null;

  if (preparation.selectedMode === "motion") {
    const motion = motionForCamera(state, camera, selectionId);
    const startingPreset = motion.cameraPresetId
      ? (state.cameraPresets || []).find(item => item.id === motion.cameraPresetId && item.cameraDeviceId === cameraId) || null
      : null;
    preparation.selectedPresetId = null;
    preparation.selectedMotionId = motion.id;
    preparation.preparedAssignment = {
      cameraId,
      cameraName: camera.name,
      mode: "motion",
      motionId: motion.id,
      motionName: motion.name,
      startingPresetId: startingPreset?.id || null,
      startingPresetName: startingPreset?.name || null
    };
  } else {
    const preset = presetForCamera(state, cameraId, selectionId);
    preparation.selectedMode = "static";
    preparation.selectedPresetId = preset.id;
    preparation.selectedMotionId = null;
    preparation.preparedAssignment = {
      cameraId,
      cameraName: camera.name,
      mode: "static",
      presetId: preset.id,
      presetName: preset.name
    };
  }

  preparation.preparationStatus = "ready";
  preparation.preparedAt = now();
  return preparation;
}

function setCameraTracking(state, cameraId, active) {
  cameraFor(state, cameraId);
  const preparation = preparationFor(state, cameraId);
  if (!preparation.tracking.supported) throw new RangeError(`Tracking is not supported for camera: ${cameraId}`);
  preparation.tracking.active = active === true;
  return preparation;
}

function applyCueStartPreparations(state, plan, { now = Date.now } = {}) {
  migrateCameraPreparations(state);
  for (const assignment of plan?.cameraAssignments || []) {
    if (!["main", "left", "right"].includes(assignment?.role) || !assignment.cameraDeviceId || !assignment.presetId || assignment.missing) continue;
    const camera = cameraDevices(state).find(item => item.id === assignment.cameraDeviceId);
    const preset = (state.cameraPresets || []).find(item => item.id === assignment.presetId && item.cameraDeviceId === assignment.cameraDeviceId && item.enabled !== false);
    const preparation = state.live.cameraPreparations.find(item => item.cameraId === assignment.cameraDeviceId);
    if (!camera || !preset || !preparation) continue;
    preparation.selectedMode = "static";
    preparation.selectedPresetId = preset.id;
    preparation.selectedMotionId = null;
    preparation.preparationStatus = "ready";
    preparation.errorMessage = null;
    preparation.preparedAssignment = {
      cameraId: camera.id,
      cameraName: camera.name,
      mode: "static",
      presetId: preset.id,
      presetName: preset.name
    };
    preparation.preparedAt = now();
  }

  const main = cameraDevices(state).find(item => item.logicalRole === "main" || item.id === "main" || item.logicalRole === "center");
  const mainPreparation = main && state.live.cameraPreparations.find(item => item.cameraId === main.id);
  const requested = plan?.simplifiedLook?.startMainTracking === true;
  const applied = Boolean(mainPreparation?.tracking.supported && requested);
  if (mainPreparation) mainPreparation.tracking.active = applied;
  if (plan?.simplifiedLook) plan.simplifiedLook.appliedMainTracking = applied;
  return state.live.cameraPreparations;
}

function makeCameraLive(state, cameraId, { now = Date.now } = {}) {
  const camera = cameraFor(state, cameraId);
  const preparation = preparationFor(state, cameraId);
  const previousProgram = nullable(state.live.programCamera);
  const alreadyLive = previousProgram === cameraId;

  state.live.programCamera = cameraId;
  if (!alreadyLive) state.live.previewCamera = previousProgram;

  if (!preparation.tracking.active && preparation.selectedMode === "motion" && preparation.selectedMotionId && preparation.preparationStatus === "ready") {
    const timestamp = now();
    preparation.preparationStatus = "running";
    preparation.motionRunCount += 1;
    preparation.lastMotionStartedAt = timestamp;
    // Simulation completes deterministically in the same serialized command.
    preparation.preparationStatus = "complete";
    preparation.lastMotionCompletedAt = timestamp;
  }

  state.live.activeCameraAssignment = {
    cameraId,
    cameraName: camera.name,
    mode: preparation.selectedMode,
    presetId: preparation.preparedAssignment?.presetId || preparation.preparedAssignment?.startingPresetId || null,
    presetName: preparation.preparedAssignment?.presetName || preparation.preparedAssignment?.startingPresetName || null,
    motionId: preparation.selectedMotionId,
    motionName: preparation.preparedAssignment?.motionName || null,
    trackingActive: preparation.tracking.active,
    preparationStatus: preparation.preparationStatus
  };
  state.live.activityLog = [
    { at: now(), message: `Camera live: ${camera.name}` },
    ...(Array.isArray(state.live.activityLog) ? state.live.activityLog : [])
  ].slice(0, 8);
  return preparation;
}

function synchronizeLiveCameraFromSnapshot(state) {
  const snapshot = state?.live?.executionSnapshot;
  const programId = snapshot?.video?.programCameraId || state?.live?.programCamera || null;
  if (!state?.live || !programId) return state;
  const assignment = (snapshot.cameraAssignments || []).find(item =>
    String(item?.role || "").toLowerCase() === "program" || item?.cameraDeviceId === programId);
  state.live.activeCameraAssignment = {
    cameraId: programId,
    cameraName: assignment?.cameraName || snapshot.video?.programCameraName || null,
    mode: assignment?.motion?.enabled ? "motion" : "static",
    presetId: assignment?.presetId || null,
    presetName: assignment?.presetName || snapshot.video?.programPreset || null,
    motionId: assignment?.shotId || null,
    motionName: assignment?.shotName || snapshot.video?.programShotName || null,
    trackingActive: assignment?.tracking?.active === true,
    preparationStatus: "ready"
  };
  return state;
}

function cameraPreparationSummaries(state) {
  const projectedState = {
    ...state,
    live: {
      ...(state?.live || {}),
      cameraPreparations: clone(state?.live?.cameraPreparations || [])
    }
  };
  migrateCameraPreparations(projectedState);
  return projectedState.live.cameraPreparations.map(item => ({
    cameraId: item.cameraId,
    selectedMode: item.selectedMode,
    preparationStatus: item.preparationStatus,
    trackingSupported: item.tracking.supported,
    trackingActive: item.tracking.active,
    presetName: item.preparedAssignment?.presetName || item.preparedAssignment?.startingPresetName || null,
    motionName: item.preparedAssignment?.motionName || null
  }));
}

module.exports = {
  CAMERA_PREPARATION_SCHEMA_VERSION,
  applyCueStartPreparations,
  cameraPreparationSummaries,
  makeCameraLive,
  migrateCameraPreparations,
  prepareCamera,
  preparationFor,
  setCameraMode,
  setCameraTracking,
  synchronizeLiveCameraFromSnapshot
};
