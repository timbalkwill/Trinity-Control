"use strict";

function createPreparedMotionState({ now = Date.now } = {}) {
  const prepared = new Map();
  const clone = value => value ? JSON.parse(JSON.stringify(value)) : null;
  return Object.freeze({
    get(cameraDeviceId) { return clone(prepared.get(cameraDeviceId)); },
    snapshot() { return Object.fromEntries([...prepared].map(([id, value]) => [id, clone(value)])); },
    prepare(cameraDeviceId, execution) {
      const record = {
        cameraDeviceId,
        shotId: execution.shotId,
        shotName: execution.shotName,
        startPresetId: execution.motion.startPreset.id,
        startPresetName: execution.motion.startPreset.name || null,
        endPresetId: execution.motion.endPreset.id,
        endPresetName: execution.motion.endPreset.name || null,
        motionStyle: execution.motion.style || null,
        speed: execution.motion.speed || null,
        targetDurationMs: Number(execution.motion.targetDurationMs) || 0,
        status: "ready",
        statusLabel: "READY / START COMMANDED",
        preparedAt: now(),
        errorMessage: null
      };
      prepared.set(cameraDeviceId, record);
      return clone(record);
    },
    setStatus(cameraDeviceId, status, statusLabel, errorMessage = null) {
      const current = prepared.get(cameraDeviceId);
      if (!current) return null;
      const next = { ...current, status, statusLabel, errorMessage };
      prepared.set(cameraDeviceId, next);
      return clone(next);
    },
    clear(cameraDeviceId) { return prepared.delete(cameraDeviceId); },
    clearAll() { prepared.clear(); }
  });
}

module.exports = { createPreparedMotionState };
