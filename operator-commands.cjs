"use strict";

const { executeCue } = require("./cue-execution.cjs");
const service = require("./service-operations.cjs");
const looks = require("./production-look-operations.cjs");
const devices = require("./device-operations.cjs");
const presets = require("./camera-preset-operations.cjs");

function createOperatorCommands({ loadState, saveState, normalizeState = state => state, cueExecutor = executeCue }) {
  const subscribers = new Set();
  let queue = Promise.resolve();

  function publish(state) {
    for (const subscriber of subscribers) {
      try { subscriber(state); }
      catch { /* One disconnected client must not fail a persisted command. */ }
    }
    return state;
  }

  function enqueue(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  }

  function mutate(operation) {
    return enqueue(() => {
      const state = loadState();
      operation(state);
      return publish(saveState(state));
    });
  }

  return {
    getState: () => loadState(),
    replaceState: state => enqueue(() => publish(saveState(normalizeState(state)))),
    updateState: operation => mutate(operation),
    goCue: (index, { confirmJump = false } = {}) => mutate(state => {
      const current = Number(state.live?.cueIndex) || 0;
      if (Math.abs(index - current) > 2 && !confirmJump) {
        const error = new Error("Jumping more than two cues requires confirmation");
        error.code = "CONFIRM_CUE_JUMP";
        error.statusCode = 409;
        throw error;
      }
      cueExecutor(state, index);
    }),
    nextCue: () => mutate(state => cueExecutor(state, Number(state.live?.cueIndex || 0) + 1)),
    previousCue: () => mutate(state => cueExecutor(state, Number(state.live?.cueIndex || 0) - 1)),
    toggleHold: () => mutate(state => {
      state.live = state.live && typeof state.live === "object" ? state.live : {};
      state.live.hold = !state.live.hold;
    }),
    setLightingOverride: sceneId => mutate(state => {
      if (typeof sceneId !== "string" || !sceneId) throw new TypeError("sceneId is required");
      const scene = (state.lightingScenes || []).find(item => item.id === sceneId);
      if (!scene) throw new RangeError(`Unknown lighting scene: ${sceneId}`);
      state.live = state.live && typeof state.live === "object" ? state.live : {};
      state.live.lightingOverrideId = sceneId;
      state.live.activityLog = [
        { at: Date.now(), message: `Lighting scene: ${scene.name || sceneId}` },
        ...(Array.isArray(state.live.activityLog) ? state.live.activityLog : [])
      ].slice(0, 8);
    }),
    returnToCueLighting: () => mutate(state => {
      state.live = state.live && typeof state.live === "object" ? state.live : {};
      state.live.lightingOverrideId = null;
      state.live.activityLog = [
        { at: Date.now(), message: "Returned to cue lighting" },
        ...(Array.isArray(state.live.activityLog) ? state.live.activityLog : [])
      ].slice(0, 8);
    }),
    reorderCue: (from, to) => mutate(state => service.reorderCue(state, from, to)),
    duplicateCue: index => mutate(state => service.duplicateCue(state, index)),
    insertCue: (index, position) => mutate(state => service.insertCue(state, index, position)),
    deleteCue: (index, options) => mutate(state => service.deleteCue(state, index, options)),
    updateCue: (index, patch) => mutate(state => service.updateCue(state, index, patch)),
    createProductionLook: input => mutate(state => looks.createProductionLook(state, input)),
    updateProductionLook: (lookId, patch) => mutate(state => looks.updateProductionLook(state, lookId, patch)),
    duplicateProductionLook: lookId => mutate(state => looks.duplicateProductionLook(state, lookId)),
    deleteProductionLook: (lookId, options) => mutate(state => looks.deleteProductionLook(state, lookId, options)),
    createDevice: input => mutate(state => devices.createDevice(state, input)),
    updateDevice: (deviceId, patch) => mutate(state => devices.updateDevice(state, deviceId, patch)),
    duplicateDevice: deviceId => mutate(state => devices.duplicateDevice(state, deviceId)),
    deleteDevice: (deviceId, options) => mutate(state => devices.deleteDevice(state, deviceId, options)),
    reorderDevice: (from, to) => mutate(state => devices.reorderDevice(state, from, to)),
    testDevice: deviceId => mutate(state => devices.runDeviceDiagnostic(state, deviceId)),
    testAllDevices: () => mutate(state => {
      for (const device of state.devices || []) devices.runDeviceDiagnostic(state, device.id);
    }),
    clearDeviceDiagnostic: deviceId => mutate(state => devices.clearDeviceDiagnostic(state, deviceId)),
    createCameraPreset: input => mutate(state => presets.createCameraPreset(state, input)),
    updateCameraPreset: (presetId, patch) => mutate(state => presets.updateCameraPreset(state, presetId, patch)),
    duplicateCameraPreset: presetId => mutate(state => presets.duplicateCameraPreset(state, presetId)),
    deleteCameraPreset: (presetId, options) => mutate(state => presets.deleteCameraPreset(state, presetId, options)),
    reorderCameraPreset: (cameraDeviceId, from, to) => mutate(state => presets.reorderCameraPreset(state, cameraDeviceId, from, to)),
    subscribe: subscriber => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    }
  };
}

module.exports = { createOperatorCommands };
