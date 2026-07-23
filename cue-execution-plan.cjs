"use strict";

const { resolveProductionLookResources } = require("./production-look-operations.cjs");

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
  const lookResources = resolveProductionLookResources(state, look);
  const lighting = resolveId(state?.lightingScenes, cue?.lightingSceneId, look?.lightingSceneId);
  const layout = resolveId(state?.cameraLayouts, cue?.cameraLayoutId, look?.cameraLayoutId);
  if (cue?.lightingSceneId && !byId(state?.lightingScenes, cue.lightingSceneId)) warnings.push(`Missing cue lighting scene: ${cue.lightingSceneId}`);
  if (!lighting.id && look?.lightingSceneId) warnings.push(`Missing Production Look lighting scene: ${look.lightingSceneId}`);
  if (cue?.cameraLayoutId && !byId(state?.cameraLayouts, cue.cameraLayoutId)) warnings.push(`Missing cue camera layout: ${cue.cameraLayoutId}`);
  if (!layout.id && look?.cameraLayoutId) warnings.push(`Missing Production Look camera layout: ${look.cameraLayoutId}`);

  const effectiveLayout = byId(state?.cameraLayouts, layout.id);
  const useCueLayout = layout.source === "cue";
  const programCameraId = effectiveLayout?.programCamera || (!useCueLayout ? look?.programCameraId : null) || null;
  const previewCameraId = effectiveLayout?.previewCamera || (!useCueLayout ? look?.previewCameraId : null) || null;
  const knownCamera = id => byId(state?.devices, id) || byId(state?.cameras, id);
  if (programCameraId && !knownCamera(programCameraId)) warnings.push(`Missing program camera: ${programCameraId}`);
  if (previewCameraId && !knownCamera(previewCameraId)) warnings.push(`Missing preview camera: ${previewCameraId}`);
  for (const assignment of lookResources.cameraAssignments) {
    if (assignment.cameraId && !assignment.camera) warnings.push(`Missing assigned camera for ${assignment.role}: ${assignment.cameraId}`);
  }

  return {
    cueId: cue?.id || null,
    productionLookId: look?.id || cue?.productionLookId || null,
    lighting: { sceneId: lighting.id, fadeMs: Number(look?.lightingFadeMs) || 0, source: lighting.source },
    video: {
      cameraLayoutId: layout.id,
      programCameraId,
      previewCameraId,
      transitionStyle: look?.transitionStyle || "cut",
      transitionDurationMs: Number(look?.transitionDurationMs) || 0,
      source: layout.source
    },
    cameras: lookResources.cameraAssignments.map(item => ({ role: item.role, cameraId: item.cameraId, presetId: item.presetId })),
    motion: {
      enabled: look?.motionEnabled === true,
      profileId: look?.motionProfileId || null,
      durationMs: Number(look?.motionDurationMs) || 0,
      speed: Number(look?.motionSpeed) || 1
    },
    future: { audioSceneId: look?.audioSceneId || null, presentationCueId: look?.presentationCueId || null },
    warnings
  };
}

module.exports = { buildCueExecutionPlan };
