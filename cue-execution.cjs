"use strict";

function byId(items, id) {
  return (items || []).find(item => item.id === id);
}

function effectiveCueResources(state, cue) {
  const look = byId(state.productionLooks, cue?.productionLookId);
  return {
    lightingSceneId: cue?.lightingSceneId || look?.lightingSceneId || null,
    cameraLayoutId: cue?.cameraLayoutId || look?.cameraLayoutId || null
  };
}

function executeCue(state, requestedIndex, { now = Date.now } = {}) {
  const cues = state.runOfService || [];
  if (!cues.length) return state;

  const index = Math.max(0, Math.min(Number(requestedIndex) || 0, cues.length - 1));
  const cue = cues[index];
  const resources = effectiveCueResources(state, cue);
  const layout = byId(state.cameraLayouts, resources.cameraLayoutId);

  state.live.cueIndex = index;
  state.live.cueStartedAt = now();
  state.live.lastLightingSceneId = resources.lightingSceneId;
  state.live.lightingOverrideId = cue.lightingSceneId || null;

  if (layout) {
    state.live.programCamera = layout.programCamera;
    state.live.previewCamera = layout.previewCamera;
    state.live.programPreset = layout.programPreset;
    state.live.previewPreset = layout.previewPreset;
    if ("tracking" in layout) state.live.tracking = Boolean(layout.tracking);
  }

  state.live.activityLog = [
    { at: now(), message: `Cue started: ${cue.name || "Cue"}` },
    ...(state.live.activityLog || [])
  ].slice(0, 8);
  return state;
}

module.exports = { effectiveCueResources, executeCue };
