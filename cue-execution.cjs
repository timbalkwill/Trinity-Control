"use strict";

const { buildCueExecutionPlan } = require("./cue-execution-plan.cjs");

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
  return state;
}

function applyLook(state, lookId) {
  const look = byId(state?.productionLooks, lookId);
  if (!look) return state;
  return applyResources(state, lookResources(state, look));
}

function executeCue(state, requestedIndex, { now = Date.now } = {}) {
  const cues = Array.isArray(state?.runOfService) ? state.runOfService : [];
  if (!cues.length) return state;

  const index = Math.max(0, Math.min(Number(requestedIndex) || 0, cues.length - 1));
  const cue = cues[index];
  if (!cue) return state;

  applyResources(state, effectiveCueResources(state, cue));
  const live = state.live;
  live.cueIndex = index;
  live.cueStartedAt = now();
  live.activityLog = [
    { at: now(), message: `Cue started: ${cue.name || "Cue"}` },
    ...(Array.isArray(live.activityLog) ? live.activityLog : [])
  ].slice(0, 8);
  return state;
}

module.exports = { applyLook, effectiveCueResources, executeCue };
