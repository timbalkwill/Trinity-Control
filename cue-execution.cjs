"use strict";

const { buildCueExecutionPlan } = require("./cue-execution-plan.cjs");
const { executeLightingSnapshot } = require("./lighting-execution.cjs");

function byId(items, id) {
  return Array.isArray(items) ? items.find(item => item?.id === id) : undefined;
}

function sourceLabel(source, requested) {
  if (source === "cue") return "Cue Override";
  if (source === "production-look") return "From Production Look";
  return requested ? "Missing reference" : "Not assigned";
}

function normalizeExecutionSnapshot(input) {
  if (!input || typeof input !== "object") return null;
  // Explicitly discard legacy camera-bearing snapshot fields. This keeps old
  // state loadable without allowing it back into current service execution.
  const {
    video: _video,
    cameraAssignments: _cameraAssignments,
    cameras: _cameras,
    shotExecutions: _shotExecutions,
    shotValidationErrors: _shotValidationErrors,
    shotExecutionResults: _shotExecutionResults,
    simplifiedLook: _simplifiedLook,
    motion: _motion,
    ...serviceInput
  } = input;
  const lightingExecutions = Array.isArray(input.lightingExecutions)
    ? input.lightingExecutions.filter(item => item && typeof item === "object").map(item => Object.freeze({ ...item }))
    : [];
  const lightingValidationErrors = Array.isArray(input.lightingValidationErrors)
    ? input.lightingValidationErrors.filter(item => item && typeof item === "object").map(item => Object.freeze({ ...item }))
    : [];
  return {
    ...serviceInput,
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
    lightingExecutions: Object.freeze(lightingExecutions),
    lightingValidationErrors: Object.freeze(lightingValidationErrors),
    lightingExecutionResults: Array.isArray(input.lightingExecutionResults) ? JSON.parse(JSON.stringify(input.lightingExecutionResults)) : [],
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
    }
  });
}

function applyResources(state, resources) {
  const live = state.live && typeof state.live === "object" ? state.live : {};
  state.live = live;
  live.lastLightingSceneId = resources.lightingSceneId;
  return state;
}

function applyLook(state, lookId) {
  const look = byId(state?.productionLooks, lookId);
  if (!look) return state;
  return applyResources(state, { lightingSceneId: byId(state?.lightingScenes, look.lightingSceneId)?.id || null });
}

function effectiveCueResources(state, cue) {
  const plan = buildCueExecutionPlan(state, cue);
  return { lightingSceneId: plan.lighting.sceneId };
}

function executeCue(state, requestedIndex, { now = Date.now, lightingExecutor = null } = {}) {
  const cues = Array.isArray(state?.runOfService) ? state.runOfService : [];
  if (!cues.length) return state;
  const index = Math.max(0, Math.min(Number(requestedIndex) || 0, cues.length - 1));
  const cue = cues[index];
  if (!cue) return state;

  const executedAt = now();
  const plan = buildCueExecutionPlan(state, cue, { resolvedAt: executedAt });
  applyResources(state, { lightingSceneId: plan.lighting.sceneId });
  const live = state.live;
  live.cueIndex = index;
  live.activeCueId = cue.id || null;
  live.activeProductionLookId = plan.productionLookId;
  const snapshot = createExecutionSnapshot(state, cue, plan, executedAt);
  snapshot.lightingExecutionResults = snapshot.lightingExecutions.map(execution => ({
    lightingSceneId: execution.lightingSceneId || null,
    adapterType: execution.adapterType || null,
    widgetId: execution.widgetId || null,
    widgetName: execution.widgetName || null,
    pageName: execution.pageName || null,
    status: "pending",
    message: "Lighting action pending"
  }));
  live.executionSnapshot = snapshot;

  const finish = lightingExecutionResults => {
    snapshot.lightingExecutionResults = lightingExecutionResults;
    const executionWarnings = lightingExecutionResults
      .filter(item => item.status === "failed")
      .map(item => `Lighting failed: ${item.widgetName || item.lightingSceneId || "Unknown scene"} — ${item.message}`);
    snapshot.warnings = [...new Set([...snapshot.warnings, ...executionWarnings])];
    live.executionSnapshot = snapshot;
    live.cueStartedAt = executedAt;
    live.activityLog = [
      { at: executedAt, message: `Cue started: ${cue.name || "Cue"}` },
      ...(Array.isArray(live.activityLog) ? live.activityLog : [])
    ].slice(0, 8);
    return state;
  };
  const lightingExecutionResults = executeLightingSnapshot(snapshot, { lightingExecutor, now });
  return lightingExecutionResults && typeof lightingExecutionResults.then === "function"
    ? lightingExecutionResults.then(finish)
    : finish(lightingExecutionResults);
}

module.exports = { applyLook, createExecutionSnapshot, effectiveCueResources, executeCue, normalizeExecutionSnapshot };
