"use strict";

const { resolveProductionLookCameraAssignments } = require("./production-look-operations.cjs");

function byId(items, id) {
  return id && Array.isArray(items) ? items.find(item => item?.id === id) : undefined;
}

function resolveId(items, cueId, lookId) {
  if (cueId && byId(items, cueId)) return { id: cueId, source: "cue" };
  if (lookId && byId(items, lookId)) return { id: lookId, source: "production-look" };
  return { id: null, source: "fallback" };
}

function buildCueExecutionPlan(state, cue) {
  const warnings = [];
  const look = byId(state?.productionLooks, cue?.productionLookId);
  if (cue?.productionLookId && !look) warnings.push(`Missing Production Look: ${cue.productionLookId}`);
  const resolvedCameras = resolveProductionLookCameraAssignments(state, look, cue);
  warnings.push(...resolvedCameras.warnings);
  const lighting = resolveId(state?.lightingScenes, cue?.lightingSceneId, look?.lightingSceneId);
  const layout = resolveId(state?.cameraLayouts, cue?.cameraLayoutId, look?.cameraLayoutId);
  if (cue?.lightingSceneId && !byId(state?.lightingScenes, cue.lightingSceneId)) warnings.push(`Missing cue lighting scene: ${cue.lightingSceneId}`);
  if (!lighting.id && look?.lightingSceneId) warnings.push(`Missing Production Look lighting scene: ${look.lightingSceneId}`);
  if (cue?.cameraLayoutId && !byId(state?.cameraLayouts, cue.cameraLayoutId)) warnings.push(`Missing cue camera layout: ${cue.cameraLayoutId}`);
  if (!layout.id && look?.cameraLayoutId) warnings.push(`Missing Production Look camera layout: ${look.cameraLayoutId}`);

  const effectiveLayout = byId(state?.cameraLayouts, layout.id);
  const videoSource = resolvedCameras.source;
  const programCameraId = resolvedCameras.programCameraId;
  const previewCameraId = resolvedCameras.previewCameraId;
  const knownCamera = id => byId(state?.devices, id) || byId(state?.cameras, id);
  if (programCameraId && !knownCamera(programCameraId)) warnings.push(`Missing program camera: ${programCameraId}`);
  if (previewCameraId && !knownCamera(previewCameraId)) warnings.push(`Missing preview camera: ${previewCameraId}`);
  const cameraAssignments = resolvedCameras.cameraAssignments.map(item => ({ ...item }));

  return {
    cueId: cue?.id || null,
    cueName: cue?.name || null,
    productionLookId: look?.id || cue?.productionLookId || null,
    productionLookName: look?.name || null,
    lighting: {
      sceneId: lighting.id,
      sceneName: byId(state?.lightingScenes, lighting.id)?.name || null,
      fadeMs: Number(look?.lightingFadeMs) || 0,
      stageWashMode: look?.stageWashMode || null,
      wallWashMode: look?.wallWashMode || null,
      source: lighting.source
    },
    video: {
      cameraLayoutId: layout.id,
      cameraLayoutName: effectiveLayout?.name || null,
      programCameraId,
      programCameraName: knownCamera(programCameraId)?.name || null,
      previewCameraId,
      previewCameraName: knownCamera(previewCameraId)?.name || null,
      auxiliaryCameraIds: [...resolvedCameras.auxiliaryCameraIds],
      programShotId: resolvedCameras.program.shotId || null,
      programShotName: resolvedCameras.program.shotName || null,
      previewShotId: resolvedCameras.preview.shotId || null,
      previewShotName: resolvedCameras.preview.shotName || null,
      programPreset: resolvedCameras.program.presetName || null,
      previewPreset: resolvedCameras.preview.presetName || null,
      transitionStyle: look?.transitionStyle || "cut",
      transitionDurationMs: Number(look?.transitionDurationMs) || 0,
      source: videoSource
    },
    cameraAssignments,
    cameras: cameraAssignments.map(item => ({
      role: item.role,
      cameraId: item.cameraDeviceId,
      cameraName: item.cameraName,
      presetId: item.presetId,
      presetName: item.presetName,
      shotId: item.shotId || null,
      shotName: item.shotName || null,
      tracking: item.tracking ? { ...item.tracking } : null,
      motion: item.motion ? { ...item.motion } : null,
      warnings: Array.isArray(item.warnings) ? [...item.warnings] : [],
      source: item.source,
      missing: item.missing
    })),
    motion: {
      enabled: look?.motionEnabled === true,
      profileId: look?.motionProfileId || null,
      durationMs: Number(look?.motionDurationMs) || 0,
      speed: Number(look?.motionSpeed) || 1
    },
    future: { audioSceneId: look?.audioSceneId || null, presentationCueId: look?.presentationCueId || null },
    warnings: [...new Set(warnings)]
  };
}

module.exports = { buildCueExecutionPlan };
