"use strict";

const LIGHTING_EXECUTION_STATUS = Object.freeze({
  SUCCEEDED: "success",
  FAILED: "failed",
  SKIPPED: "skipped"
});

function resultFor(execution, status, details = {}) {
  return {
    lightingSceneId: execution?.lightingSceneId || null,
    adapterType: execution?.adapterType || null,
    widgetId: execution?.widgetId || null,
    widgetName: execution?.widgetName || null,
    pageName: execution?.pageName || null,
    status,
    ...details
  };
}

function unavailableResult(execution) {
  return resultFor(execution, LIGHTING_EXECUTION_STATUS.FAILED, {
    errorCode: "adapterUnavailable",
    message: "Lighting adapter is not configured"
  });
}

function createLightingExecutor(state, { registry, activeState = null, logger = null } = {}) {
  activeState?.synchronize?.(state);
  return {
    async execute(execution, context = {}) {
      const device = (state?.devices || []).find(item =>
        item?.type === "lighting" && item?.adapterType === execution?.adapterType
      );
      if (!registry?.execute) return unavailableResult(execution);
      if (device?.enabled === false) {
        activeState?.reset?.("adapter-disabled");
        return { ok: false, code: "adapterDisabled", message: "Lighting adapter is disabled" };
      }
      logger?.info?.(`[Lighting Execution] ${context.cueExecutionId || "unknown"} index=${context.lightingExecutionIndex ?? "unknown"} scene=${execution?.lightingSceneId || "unknown"} adapter=${execution?.adapterType || "unknown"} widget=${execution?.widgetId || "unknown"} started`);
      if (typeof registry.testConnection === "function") {
        let readiness;
        try {
          readiness = await registry.testConnection(device);
        } catch {
          readiness = { ok: false, code: "unexpectedAdapterError", message: "Lighting adapter availability check failed" };
        }
        if (readiness?.ok !== true) {
          activeState?.reset?.(readiness?.code || "adapter-unavailable");
          return readiness;
        }
      }
      const previouslyActive = activeState?.get?.();
      if (activeState?.matches?.(execution)) {
        logger?.info?.(`[Lighting Execution] ${context.cueExecutionId || "unknown"} index=${context.lightingExecutionIndex ?? "unknown"} widget=${execution.widgetId} previous=${previouslyActive?.widgetId || "none"} decision=skipped`);
        return {
          ok: true,
          skipped: true,
          reason: "already-active",
          activationMessageCount: 0,
          message: "QLC+ lighting look already active"
        };
      }
      logger?.info?.(`[Lighting Execution] ${context.cueExecutionId || "unknown"} index=${context.lightingExecutionIndex ?? "unknown"} widget=${execution?.widgetId || "unknown"} previous=${previouslyActive?.widgetId || "none"} decision=sent`);
      const result = await registry.execute(device, execution);
      if (result?.ok === true) activeState?.markActive?.(execution, context);
      else if (["unexpectedDisconnect", "connectionFailure"].includes(result?.code)) activeState?.reset?.(result.code);
      logger?.info?.(`[Lighting Execution] ${context.cueExecutionId || "unknown"} index=${context.lightingExecutionIndex ?? "unknown"} widget=${execution?.widgetId || "unknown"} messages=${Number(result?.activationMessageCount) || 0} value=${result?.commandValue ?? "none"} ${result?.ok ? "succeeded" : "failed"} ${Number(result?.elapsedMs) || 0}ms`);
      return result;
    }
  };
}

function executeOne(execution, lightingExecutor, context) {
  const startedAt = context.now();
  if (execution?.executionType !== "qlc-button") {
    return resultFor(execution, LIGHTING_EXECUTION_STATUS.SKIPPED, {
      errorCode: "unsupportedExecutionType",
      message: "Unsupported lighting execution type",
      startedAt,
      completedAt: context.now(),
      elapsedMs: 0
    });
  }
  if (execution.widgetId === null || execution.widgetId === undefined || String(execution.widgetId).trim() === "") {
    return resultFor(execution, LIGHTING_EXECUTION_STATUS.SKIPPED, {
      errorCode: "widgetIdMissing",
      message: "QLC+ widget ID is missing",
      startedAt,
      completedAt: context.now(),
      elapsedMs: 0
    });
  }
  const finish = outcome => {
    const completedAt = context.now();
    const status = outcome?.skipped === true
      ? LIGHTING_EXECUTION_STATUS.SKIPPED
      : outcome?.ok === true ? LIGHTING_EXECUTION_STATUS.SUCCEEDED : LIGHTING_EXECUTION_STATUS.FAILED;
    return resultFor(execution, status, {
      ...(outcome?.ok === true ? {} : { errorCode: outcome?.code || "activationFailed" }),
      ...(outcome?.reason ? { reason: outcome.reason } : {}),
      message: outcome?.message || (outcome?.ok === true ? "QLC+ lighting activated" : "Lighting activation failed"),
      startedAt,
      completedAt,
      elapsedMs: Number(outcome?.elapsedMs) || Math.max(0, completedAt - startedAt)
    });
  };
  try {
    const outcome = lightingExecutor.execute(execution, context);
    return outcome && typeof outcome.then === "function"
      ? outcome.then(finish, () => finish({ ok: false, code: "unexpectedAdapterError", message: "Lighting activation failed" }))
      : finish(outcome);
  } catch (error) {
    const completedAt = context.now();
    return resultFor(execution, LIGHTING_EXECUTION_STATUS.FAILED, {
      errorCode: error?.code || "unexpectedAdapterError",
      message: "Lighting activation failed",
      startedAt,
      completedAt,
      elapsedMs: Math.max(0, completedAt - startedAt)
    });
  }
}

function executeLightingSnapshot(snapshot, { lightingExecutor, now = Date.now } = {}) {
  const executions = Array.isArray(snapshot?.lightingExecutions) ? snapshot.lightingExecutions : [];
  if (!executions.length) return [];
  const executor = lightingExecutor || { execute: unavailableResult };
  const results = [];
  const baseContext = { cueExecutionId: `${snapshot?.cueId || "cue"}:${snapshot?.executedAt || 0}`, now };
  let pending = null;
  for (const [lightingExecutionIndex, execution] of executions.entries()) {
    const context = { ...baseContext, lightingExecutionIndex };
    if (pending) {
      pending = pending.then(() => executeOne(execution, executor, context)).then(result => { results.push(result); });
      continue;
    }
    const result = executeOne(execution, executor, context);
    if (result && typeof result.then === "function") {
      pending = result.then(value => { results.push(value); });
    } else {
      results.push(result);
    }
  }
  return pending ? pending.then(() => results) : results;
}

module.exports = {
  LIGHTING_EXECUTION_STATUS,
  createLightingExecutor,
  executeLightingSnapshot
};
