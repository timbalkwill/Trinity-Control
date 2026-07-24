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

function takeLive(state, { now = Date.now } = {}) {
  const live = state?.live;
  const snapshot = live?.executionSnapshot;
  if (!live || typeof live !== "object" || !snapshot || typeof snapshot !== "object") {
    throw commandError("TAKE LIVE is unavailable until a cue has been executed.", "TAKE_LIVE_NO_SNAPSHOT");
  }

  const assignments = Array.isArray(snapshot.cameraAssignments) ? snapshot.cameraAssignments : [];
  const program = assignmentForRole(assignments, "program");
  const preview = assignmentForRole(assignments, "preview");
  if (!preview?.cameraDeviceId) {
    throw commandError("TAKE LIVE could not run because PREVIEW is unassigned.", "TAKE_LIVE_PREVIEW_UNASSIGNED");
  }
  if (program?.cameraDeviceId && program.cameraDeviceId === preview.cameraDeviceId) {
    throw commandError("TAKE LIVE was not needed because PROGRAM and PREVIEW use the same camera.", "TAKE_LIVE_SAME_CAMERA");
  }

  snapshot.cameraAssignments = swapAssignmentRoles(assignments);
  snapshot.cameras = swapAssignmentRoles(snapshot.cameras);
  snapshot.video = swapVideo(snapshot.video);

  live.programCamera = preview.cameraDeviceId;
  live.programPreset = preview.presetName || null;
  live.previewCamera = program?.cameraDeviceId || null;
  live.previewPreset = program?.presetName || null;
  live.activityLog = [
    { at: now(), message: `TAKE LIVE: ${preview.shotName || preview.cameraName || preview.cameraDeviceId}` },
    ...(Array.isArray(live.activityLog) ? live.activityLog : [])
  ].slice(0, 8);
  return state;
}

module.exports = { takeLive };
