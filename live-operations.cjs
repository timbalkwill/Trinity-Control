"use strict";

function commandError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

function cloneAssignment(assignment, role) {
  return {
    ...assignment,
    role,
    tracking: assignment?.tracking && typeof assignment.tracking === "object" ? { ...assignment.tracking } : assignment?.tracking ?? null,
    motion: assignment?.motion && typeof assignment.motion === "object" ? { ...assignment.motion } : assignment?.motion ?? null,
    warnings: Array.isArray(assignment?.warnings) ? [...assignment.warnings] : []
  };
}

function assignmentForRole(assignments, role) {
  return assignments.find(assignment => String(assignment?.role || "").toLowerCase() === role);
}

function swapAssignmentRoles(assignments) {
  if (!Array.isArray(assignments)) return [];
  return assignments.map(assignment => {
    const role = String(assignment?.role || "").toLowerCase();
    if (role === "program") return cloneAssignment(assignment, "preview");
    if (role === "preview") return cloneAssignment(assignment, "program");
    return cloneAssignment(assignment, assignment?.role || null);
  });
}

function swapVideo(video) {
  const current = video && typeof video === "object" ? video : {};
  return {
    ...current,
    programCameraId: current.previewCameraId || null,
    programCameraName: current.previewCameraName || null,
    previewCameraId: current.programCameraId || null,
    previewCameraName: current.programCameraName || null,
    programShotId: current.previewShotId || null,
    programShotName: current.previewShotName || null,
    previewShotId: current.programShotId || null,
    previewShotName: current.programShotName || null,
    programPreset: current.previewPreset || null,
    previewPreset: current.programPreset || null
  };
}

function migrateLiveState(live) {
  const migrated = live && typeof live === "object" ? { ...live } : {};
  delete migrated.lightingOverrideId;
  delete migrated.lightingOverrideExecutionResult;
  if (Array.isArray(migrated.activityLog)) {
    migrated.activityLog = migrated.activityLog.filter(entry =>
      !/^Lighting scene:/.test(String(entry?.message || "")) &&
      entry?.message !== "Returned to cue lighting"
    );
  }
  return migrated;
}

function takeLive(state, { now = Date.now } = {}) {
  const live = state?.live;
  if (!live || typeof live !== "object") {
    throw commandError("TAKE LIVE is unavailable until Live has been initialized.", "TAKE_LIVE_UNAVAILABLE");
  }
  const previewCameraId = live.previewCamera || null;
  const programCameraId = live.programCamera || null;
  if (!previewCameraId) {
    throw commandError("TAKE LIVE could not run because PREVIEW is unassigned.", "TAKE_LIVE_PREVIEW_UNASSIGNED");
  }
  if (programCameraId && programCameraId === previewCameraId) {
    throw commandError("TAKE LIVE was not needed because PROGRAM and PREVIEW use the same camera.", "TAKE_LIVE_SAME_CAMERA");
  }
  const camera = (state.devices || []).find(item => item?.type === "camera" && item.id === previewCameraId) ||
    (state.cameras || []).find(item => item?.id === previewCameraId);
  const previewPreset = live.previewPreset || null;
  const programPreset = live.programPreset || null;
  const preparation = (live.cameraPreparations || []).find(item => item?.cameraId === previewCameraId);
  live.programCamera = previewCameraId;
  live.previewCamera = programCameraId;
  live.programPreset = previewPreset;
  live.previewPreset = programPreset;
  live.activeCameraAssignment = {
    cameraId: previewCameraId,
    cameraName: camera?.name || previewCameraId,
    mode: preparation?.selectedMode || "static",
    presetId: preparation?.preparedAssignment?.presetId || preparation?.preparedAssignment?.startingPresetId || null,
    presetName: preparation?.preparedAssignment?.presetName || preparation?.preparedAssignment?.startingPresetName || previewPreset,
    motionId: preparation?.selectedMotionId || null,
    motionName: preparation?.preparedAssignment?.motionName || null,
    trackingActive: preparation?.tracking?.active === true,
    preparationStatus: preparation?.preparationStatus || "idle"
  };
  live.activityLog = [
    { at: now(), message: `TAKE LIVE: ${camera?.name || previewCameraId}` },
    ...(Array.isArray(live.activityLog) ? live.activityLog : [])
  ].slice(0, 8);
  return state;
}

module.exports = { migrateLiveState, takeLive };
