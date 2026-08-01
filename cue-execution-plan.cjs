"use strict";

const { resolveLightingExecution, utilitySceneReferenceWarning } = require("./lighting-scene-operations.cjs");

function byId(items, id) {
  return id && Array.isArray(items) ? items.find(item => item?.id === id) : undefined;
}

function resolveId(items, cueId, lookId) {
  if (cueId && byId(items, cueId)) return { id: cueId, source: "cue" };
  if (lookId && byId(items, lookId)) return { id: lookId, source: "production-look" };
  return { id: null, source: "fallback" };
}

// Service execution deliberately resolves only service-owned state. Camera and
// Shot references may remain in saved cues/Looks for compatibility, but they
// never enter this plan and therefore cannot reach a frozen GO/BACK snapshot.
function buildCueExecutionPlan(state, cue, { resolvedAt = Date.now() } = {}) {
  const warnings = [];
  const look = byId(state?.productionLooks, cue?.productionLookId);
  const effectiveLook = look?.enabled === false ? null : look;
  if (cue?.productionLookId && !look) warnings.push(`Missing Production Look: ${cue.productionLookId}`);
  if (look?.enabled === false) warnings.push("Production Look is disabled");

  const lighting = resolveId(state?.lightingScenes, cue?.lightingSceneId, effectiveLook?.lightingSceneId);
  if (cue?.lightingSceneId && !byId(state?.lightingScenes, cue.lightingSceneId)) warnings.push(`Missing cue lighting scene: ${cue.lightingSceneId}`);
  if (!lighting.id && effectiveLook?.lightingSceneId) warnings.push(`Missing Production Look lighting scene: ${effectiveLook.lightingSceneId}`);

  const requestedLightingSceneId = lighting.id || cue?.lightingSceneId || effectiveLook?.lightingSceneId || null;
  const lightingResolution = requestedLightingSceneId
    ? resolveLightingExecution(state, requestedLightingSceneId, { resolvedAt })
    : null;
  const lightingExecutions = lightingResolution?.execution ? [lightingResolution.execution] : [];
  const lightingValidationErrors = lightingResolution && lightingResolution.validation?.state !== "valid"
    ? [lightingResolution.validation]
    : [];
  warnings.push(...lightingValidationErrors.map(item => item.message));
  const utilityWarning = utilitySceneReferenceWarning(state, requestedLightingSceneId);
  if (utilityWarning) warnings.push(utilityWarning);

  return {
    cueId: cue?.id || null,
    cueName: cue?.name || null,
    productionLookId: look?.id || cue?.productionLookId || null,
    productionLookName: look?.name || null,
    lighting: {
      sceneId: lighting.id,
      sceneName: byId(state?.lightingScenes, lighting.id)?.name || null,
      fadeMs: Number(effectiveLook?.lightingFadeMs) || 0,
      stageWashMode: effectiveLook?.stageWashMode || null,
      wallWashMode: effectiveLook?.wallWashMode || null,
      source: lighting.source
    },
    lightingExecutions,
    lightingValidationErrors,
    future: { audioSceneId: effectiveLook?.audioSceneId || null, presentationCueId: effectiveLook?.presentationCueId || null },
    warnings: [...new Set(warnings)]
  };
}

module.exports = { buildCueExecutionPlan };
