"use strict";

const { buildCueExecutionPlan } = require("./cue-execution-plan.cjs");
const { resolveProductionLookCameraAssignments } = require("./production-look-operations.cjs");

function byId(items, id) {
  return Array.isArray(items) ? items.find(item => item?.id === id) : undefined;
}

function existingId(items, preferredId, fallbackId) {
  if (preferredId && byId(items, preferredId)) return preferredId;
  if (fallbackId && byId(items, fallbackId)) return fallbackId;
  return null;
}

function lookResources(state, look) {
  return {
    lightingSceneId: existingId(state?.lightingScenes, look?.lightingSceneId),
    cameraLayoutId: existingId(state?.cameraLayouts, look?.cameraLayoutId)
  };
}

function effectiveCueResources(state, cue) {
  const plan = buildCueExecutionPlan(state, cue);
  return {
    lightingSceneId: plan.lighting.sceneId,
    cameraLayoutId: plan.video.cameraLayoutId
  };
}

function sourceLabel(source, requested) {
  if (source === "cue") return "Cue Override";
  if (source === "production-look") return "From Production Look";
  return requested ? "Missing reference" : "Not assigned";
}

function normalizeExecutionSnapshot(input) {
  if (!input || typeof input !== "object") return null;
  return {
    cueId: input.cueId || null,
    cueName: input.cueName || null,
    productionLookId: input.productionLookId || null,
    productionLookName: input.productionLookName || null,
    executedAt: Number(input.executedAt) || 0,
    lighting: {
      sceneId: input.lighting?.sceneId || null,
      sceneName: input.lighting?.sceneName || null,
      fadeMs: Number(input.lighting?.fadeMs) || 0,
      stageWashMode: input.lighting?.stageWashMode || null,
      wallWashMode: input.lighting?.wallWashMode || null,
      source: input.lighting?.source || "Not assigned"
    },
    video: {
      cameraLayoutId: input.video?.cameraLayoutId || null,
      cameraLayoutName: input.video?.cameraLayoutName || null,
      programCameraId: input.video?.programCameraId || null,
      programCameraName: input.video?.programCameraName || null,
      previewCameraId: input.video?.previewCameraId || null,
      previewCameraName: input.video?.previewCameraName || null,
      auxiliaryCameraIds: Array.isArray(input.video?.auxiliaryCameraIds) ? [...input.video.auxiliaryCameraIds] : [],
      programShotId: input.video?.programShotId || null,
      programShotName: input.video?.programShotName || null,
      previewShotId: input.video?.previewShotId || null,
      previewShotName: input.video?.previewShotName || null,
      programPreset: input.video?.programPreset || null,
      previewPreset: input.video?.previewPreset || null,
      transitionStyle: input.video?.transitionStyle || "cut",
      transitionDurationMs: Number(input.video?.transitionDurationMs) || 0,
      source: input.video?.source || "Not assigned"
    },
    cameraAssignments: Array.isArray(input.cameraAssignments) ? input.cameraAssignments.map(item => ({ ...item })) : [],
    cameras: Array.isArray(input.cameras) ? input.cameras.map(item => ({ ...item })) : [],
    motion: {
      enabled: input.motion?.enabled === true,
      profileId: input.motion?.profileId || null,
      durationMs: Number(input.motion?.durationMs) || 0,
      speed: Number(input.motion?.speed) || 1
    },
    warnings: Array.isArray(input.warnings) ? input.warnings.map(String) : []
  };
}

function createExecutionSnapshot(state, cue, plan, executedAt) {
  const look = byId(state?.productionLooks, cue?.productionLookId);
  return normalizeExecutionSnapshot({
    ...plan,
    executedAt,
    lighting: {
      ...plan.lighting,
      source: sourceLabel(plan.lighting.source, cue?.lightingSceneId || look?.lightingSceneId)
    },
    video: {
      ...plan.video,
      source: sourceLabel(plan.video.source, cue?.cameraLayoutId || look?.cameraLayoutId || look?.programCameraId || look?.previewCameraId || look?.cameraAssignments?.some(item => item?.cameraId))
    }
  });
}

function applyResources(state, resources) {
  const live = state.live && typeof state.live === "object" ? state.live : {};
  state.live = live;
  live.lastLightingSceneId = resources.lightingSceneId;
  live.lightingOverrideId = null;

  const layout = byId(state.cameraLayouts, resources.cameraLayoutId);
  if (layout) {
    live.programCamera = layout.programCamera;
    live.previewCamera = layout.previewCamera;
    live.programPreset = layout.programPreset;
    live.previewPreset = layout.previewPreset;
    if ("tracking" in layout) live.tracking = Boolean(layout.tracking);
  }
  if ("programCameraId" in resources) live.programCamera = resources.programCameraId;
  if ("previewCameraId" in resources) live.previewCamera = resources.previewCameraId;
  if ("auxiliaryCameraIds" in resources) live.auxiliaryCameras = [...resources.auxiliaryCameraIds];
  if ("programPreset" in resources) live.programPreset = resources.programPreset;
  if ("previewPreset" in resources) live.previewPreset = resources.previewPreset;
  return state;
}

function applyLook(state, lookId) {
  const look = byId(state?.productionLooks, lookId);
  if (!look) return state;
  const cameras = resolveProductionLookCameraAssignments(state, look);
  return applyResources(state, {
    ...lookResources(state, look),
    programCameraId: cameras.programCameraId,
    previewCameraId: cameras.previewCameraId,
    auxiliaryCameraIds: cameras.auxiliaryCameraIds,
    programPreset: cameras.program.presetName,
    previewPreset: cameras.preview.presetName
  });
}

function executeCue(state, requestedIndex, { now = Date.now } = {}) {
  const cues = Array.isArray(state?.runOfService) ? state.runOfService : [];
  if (!cues.length) return state;

  const index = Math.max(0, Math.min(Number(requestedIndex) || 0, cues.length - 1));
  const cue = cues[index];
  if (!cue) return state;

  const plan = buildCueExecutionPlan(state, cue);
  applyResources(state, {
    lightingSceneId: plan.lighting.sceneId,
    cameraLayoutId: plan.video.cameraLayoutId,
    programCameraId: plan.video.programCameraId,
    previewCameraId: plan.video.previewCameraId,
    auxiliaryCameraIds: plan.video.auxiliaryCameraIds,
    programPreset: plan.video.programPreset,
    previewPreset: plan.video.previewPreset
  });
  const live = state.live;
  const executedAt = now();
  live.cueIndex = index;
  live.activeCueId = cue.id || null;
  live.activeProductionLookId = plan.productionLookId;
  live.executionSnapshot = createExecutionSnapshot(state, cue, plan, executedAt);
  live.cueStartedAt = executedAt;
  live.activityLog = [
    { at: executedAt, message: `Cue started: ${cue.name || "Cue"}` },
    ...(Array.isArray(live.activityLog) ? live.activityLog : [])
  ].slice(0, 8);
  return state;
}

module.exports = { applyLook, createExecutionSnapshot, effectiveCueResources, executeCue, normalizeExecutionSnapshot };
