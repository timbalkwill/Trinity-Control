"use strict";

const SHOT_EXECUTION_STATUS = Object.freeze({
  STATIC_SUCCEEDED: "static-succeeded",
  STATIC_FAILED: "static-failed",
  MOTION_COMMANDED: "motion-commanded",
  MOTION_FAILED: "motion-failed",
  VALIDATION_SKIPPED: "validation-skipped",
  MOTION_UNSUPPORTED: "motion-unsupported",
  TRACKING_UNSUPPORTED: "tracking-unsupported",
  DUPLICATE_SKIPPED: "duplicate-skipped"
});

const unavailableCameraExecutor = Object.freeze({
  recallPreset() {
    return {
      ok: false,
      code: "adapterUnavailable",
      message: "Camera preset-recall adapter is not configured"
    };
  }
});

function resultFor(execution, status, details = {}) {
  return {
    shotId: execution?.shotId || null,
    shotName: execution?.shotName || null,
    referenceRole: execution?.referenceRole || null,
    referenceSource: execution?.referenceSource || null,
    type: execution?.type || null,
    status,
    ...details
  };
}

function executeOne(execution, cameraExecutor) {
    if (execution?.valid !== true || (Array.isArray(execution?.errors) && execution.errors.length)) {
      return resultFor(execution, SHOT_EXECUTION_STATUS.VALIDATION_SKIPPED, {
        message: execution?.errors?.join("; ") || "Shot execution validation failed",
        errors: Array.isArray(execution?.errors) ? [...execution.errors] : []
      });
    }
    if (execution.type === "motion") {
      return resultFor(execution, SHOT_EXECUTION_STATUS.MOTION_UNSUPPORTED, {
        message: "Motion Shot execution is not implemented"
      });
    }
    if (execution.type === "tracking") {
      return resultFor(execution, SHOT_EXECUTION_STATUS.TRACKING_UNSUPPORTED, {
        message: "Tracking Shot execution is not implemented"
      });
    }
    if (execution.type !== "static") {
      return resultFor(execution, SHOT_EXECUTION_STATUS.VALIDATION_SKIPPED, {
        message: `Unsupported Shot type: ${execution.type || "missing"}`
      });
    }

    const cameraDeviceId = execution.camera?.id || null;
    const presetId = execution.static?.preset?.id || null;
    if (!cameraDeviceId || !presetId) {
      return resultFor(execution, SHOT_EXECUTION_STATUS.VALIDATION_SKIPPED, {
        cameraDeviceId,
        presetId,
        message: !cameraDeviceId ? "Static Shot camera is missing" : "Static Shot preset is missing"
      });
    }

    const command = { cameraDeviceId, presetId, shotId: execution.shotId };
    const finish = outcome => resultFor(execution,
      outcome?.ok === true ? SHOT_EXECUTION_STATUS.STATIC_SUCCEEDED : SHOT_EXECUTION_STATUS.STATIC_FAILED, {
        cameraDeviceId,
        presetId,
        adapterType: outcome?.adapterType || null,
        safeHost: outcome?.safeHost || null,
        presetNumber: outcome?.presetNumber ?? null,
        elapsedMs: Number(outcome?.elapsedMs) || 0,
        ...(outcome?.ok === true ? {} : { code: outcome?.code || "presetRecallFailed" }),
        message: outcome?.message || (outcome?.ok === true ? "Static Shot preset recall issued" : "Camera preset recall failed")
      });
    try {
      const outcome = cameraExecutor?.recallPreset?.(command);
      return outcome && typeof outcome.then === "function"
        ? outcome.then(finish, error => finish({ ok: false, code: error?.code, message: error?.message }))
        : finish(outcome);
    } catch (error) {
      return finish({ ok: false, code: error?.code, message: error?.message || String(error) });
    }
}

function executeShotSnapshot(snapshot, { cameraExecutor = unavailableCameraExecutor } = {}) {
  const executions = Array.isArray(snapshot?.shotExecutions) ? snapshot.shotExecutions : [];
  const traversedAssignments = new Set();
  const results = executions.map(execution => {
    const assignmentKey = [
      execution?.referenceSource || "",
      execution?.referenceRole || "",
      execution?.shotId || ""
    ].join("\u0000");
    if (traversedAssignments.has(assignmentKey)) {
      return resultFor(execution, SHOT_EXECUTION_STATUS.DUPLICATE_SKIPPED, {
        message: "Duplicate Shot assignment skipped"
      });
    }
    traversedAssignments.add(assignmentKey);
    return executeOne(execution, cameraExecutor);
  });
  if (results.some(item => item && typeof item.then === "function")) {
    return Promise.all(results);
  }
  return results;
}

function executeManualMotion(execution, { cameraExecutor = unavailableCameraExecutor } = {}) {
  if (execution?.valid !== true || execution?.type !== "motion") {
    return resultFor(execution, SHOT_EXECUTION_STATUS.VALIDATION_SKIPPED, {
      message: execution?.errors?.join("; ") || "A valid Motion Shot is required",
      errors: Array.isArray(execution?.errors) ? [...execution.errors] : []
    });
  }
  const cameraDeviceId = execution.camera?.id || null;
  const presetId = execution.motion?.endPreset?.id || null;
  if (!cameraDeviceId || !presetId) {
    return resultFor(execution, SHOT_EXECUTION_STATUS.VALIDATION_SKIPPED, {
      cameraDeviceId,
      presetId,
      message: !cameraDeviceId ? "Motion Shot camera is missing" : "Motion Shot end preset is missing"
    });
  }
  const finish = outcome => resultFor(execution,
    outcome?.ok === true ? SHOT_EXECUTION_STATUS.MOTION_COMMANDED : SHOT_EXECUTION_STATUS.MOTION_FAILED, {
      cameraDeviceId,
      presetId,
      startPresetId: execution.motion.startPreset?.id || null,
      speed: execution.motion.speed || null,
      ...(outcome?.ok === true ? {} : { code: outcome?.code || "motionCommandFailed" }),
      message: outcome?.message || (outcome?.ok === true ? "Motion end preset commanded" : "Motion command failed")
    });
  try {
    const outcome = cameraExecutor?.recallPreset?.({ cameraDeviceId, presetId, shotId: execution.shotId });
    return outcome && typeof outcome.then === "function"
      ? outcome.then(finish, error => finish({ ok: false, code: error?.code, message: error?.message }))
      : finish(outcome);
  } catch (error) {
    return finish({ ok: false, code: error?.code, message: error?.message || String(error) });
  }
}

module.exports = {
  SHOT_EXECUTION_STATUS,
  executeManualMotion,
  executeShotSnapshot,
  unavailableCameraExecutor
};
