"use strict";

const SHOT_EXECUTION_STATUS = Object.freeze({
  STATIC_SUCCEEDED: "static-succeeded",
  STATIC_FAILED: "static-failed",
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

function executeShotSnapshot(snapshot, { cameraExecutor = unavailableCameraExecutor } = {}) {
  const executions = Array.isArray(snapshot?.shotExecutions) ? snapshot.shotExecutions : [];
  const results = [];
  const traversedAssignments = new Set();

  for (const execution of executions) {
    const assignmentKey = [
      execution?.referenceSource || "",
      execution?.referenceRole || "",
      execution?.shotId || ""
    ].join("\u0000");
    if (traversedAssignments.has(assignmentKey)) {
      results.push(resultFor(execution, SHOT_EXECUTION_STATUS.DUPLICATE_SKIPPED, {
        message: "Duplicate Shot assignment skipped"
      }));
      continue;
    }
    traversedAssignments.add(assignmentKey);

    if (execution?.valid !== true || (Array.isArray(execution?.errors) && execution.errors.length)) {
      results.push(resultFor(execution, SHOT_EXECUTION_STATUS.VALIDATION_SKIPPED, {
        message: execution?.errors?.join("; ") || "Shot execution validation failed",
        errors: Array.isArray(execution?.errors) ? [...execution.errors] : []
      }));
      continue;
    }
    if (execution.type === "motion") {
      results.push(resultFor(execution, SHOT_EXECUTION_STATUS.MOTION_UNSUPPORTED, {
        message: "Motion Shot execution is not implemented"
      }));
      continue;
    }
    if (execution.type === "tracking") {
      results.push(resultFor(execution, SHOT_EXECUTION_STATUS.TRACKING_UNSUPPORTED, {
        message: "Tracking Shot execution is not implemented"
      }));
      continue;
    }
    if (execution.type !== "static") {
      results.push(resultFor(execution, SHOT_EXECUTION_STATUS.VALIDATION_SKIPPED, {
        message: `Unsupported Shot type: ${execution.type || "missing"}`
      }));
      continue;
    }

    const cameraDeviceId = execution.camera?.id || null;
    const presetId = execution.static?.preset?.id || null;
    if (!cameraDeviceId || !presetId) {
      results.push(resultFor(execution, SHOT_EXECUTION_STATUS.VALIDATION_SKIPPED, {
        cameraDeviceId,
        presetId,
        message: !cameraDeviceId ? "Static Shot camera is missing" : "Static Shot preset is missing"
      }));
      continue;
    }

    const command = { cameraDeviceId, presetId, shotId: execution.shotId };
    try {
      const outcome = cameraExecutor?.recallPreset?.(command);
      if (outcome?.ok !== true) {
        results.push(resultFor(execution, SHOT_EXECUTION_STATUS.STATIC_FAILED, {
          cameraDeviceId,
          presetId,
          code: outcome?.code || "presetRecallFailed",
          message: outcome?.message || "Camera preset recall failed"
        }));
        continue;
      }
      results.push(resultFor(execution, SHOT_EXECUTION_STATUS.STATIC_SUCCEEDED, {
        cameraDeviceId,
        presetId,
        message: outcome.message || "Static Shot preset recall issued"
      }));
    } catch (error) {
      results.push(resultFor(execution, SHOT_EXECUTION_STATUS.STATIC_FAILED, {
        cameraDeviceId,
        presetId,
        code: error?.code || "presetRecallFailed",
        message: error?.message || String(error)
      }));
    }
  }
  return results;
}

module.exports = {
  SHOT_EXECUTION_STATUS,
  executeShotSnapshot,
  unavailableCameraExecutor
};
