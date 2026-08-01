"use strict";

const { executeCue } = require("./cue-execution.cjs");
const service = require("./service-operations.cjs");
const looks = require("./production-look-operations.cjs");
const devices = require("./device-operations.cjs");
const presets = require("./camera-preset-operations.cjs");
const shots = require("./shot-operations.cjs");
const liveOperations = require("./live-operations.cjs");
const cameraPreparation = require("./camera-preparation-operations.cjs");
const { createCameraExecutor } = require("./camera-adapter-registry.cjs");
const { createLightingAdapterRegistry } = require("./lighting-adapter-registry.cjs");
const lightingScenes = require("./lighting-scene-operations.cjs");
const { createLightingExecutor } = require("./lighting-execution.cjs");
const { createLightingActiveState } = require("./lighting-active-state.cjs");

function createOperatorCommands({
  loadState,
  saveState,
  normalizeState = state => state,
  cueExecutor = executeCue,
  lightingAdapters = createLightingAdapterRegistry(),
  lightingActiveState = createLightingActiveState(),
  lightingExecutionResolver = lightingScenes.resolveLightingExecution,
  lightingExecutorFactory = createLightingExecutor,
  cameraExecutorFactory = createCameraExecutor
}) {
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
    return enqueue(async () => {
      const state = loadState();
      await operation(state);
      lightingActiveState.synchronize(state);
      return publish(saveState(state));
    });
  }

  function executeRequestedCue(state, index) {
    return cueExecutor(state, index, {
      lightingExecutor: lightingExecutorFactory(state, { registry: lightingAdapters, activeState: lightingActiveState })
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
      return executeRequestedCue(state, index);
    }),
    nextCue: () => mutate(state => executeRequestedCue(state, Number(state.live?.cueIndex || 0) + 1)),
    previousCue: () => mutate(state => executeRequestedCue(state, Number(state.live?.cueIndex || 0) - 1)),
    takeLive: () => mutate(state => liveOperations.takeLive(state)),
    setCameraMode: (cameraId, mode) => mutate(state => cameraPreparation.setCameraMode(state, cameraId, mode)),
    prepareCamera: (cameraId, selectionId) => mutate(state => cameraPreparation.prepareCamera(state, cameraId, selectionId)),
    recallCameraPreset: (cameraId, presetId) => mutate(async state => {
      const camera = (state.devices || []).find(item => item?.type === "camera" && item.id === cameraId && item.enabled !== false);
      if (!camera) throw new RangeError(`Camera is unavailable: ${cameraId}`);
      const preset = (state.cameraPresets || []).find(item => item?.id === presetId && item.cameraDeviceId === cameraId && item.enabled !== false);
      if (!preset) throw new RangeError(`Unknown preset for camera ${cameraId}: ${presetId}`);
      const outcome = await cameraExecutorFactory(state).recallPreset({ cameraDeviceId: cameraId, presetId });
      if (outcome?.ok !== true) {
        const error = new Error(outcome?.message || "Camera preset recall failed");
        error.code = outcome?.code || "CAMERA_PRESET_RECALL_FAILED";
        error.statusCode = 409;
        throw error;
      }
      cameraPreparation.setCameraMode(state, cameraId, "static");
      cameraPreparation.prepareCamera(state, cameraId, presetId);
      state.live.activityLog = [
        { at: Date.now(), message: `Camera preset commanded: ${camera.name} — ${preset.name}` },
        ...(Array.isArray(state.live.activityLog) ? state.live.activityLog : [])
      ].slice(0, 8);
    }),
    setCameraTracking: (cameraId, active) => mutate(state => cameraPreparation.setCameraTracking(state, cameraId, active)),
    makeCameraLive: cameraId => mutate(state => cameraPreparation.makeCameraLive(state, cameraId)),
    toggleHold: () => mutate(state => {
      state.live = state.live && typeof state.live === "object" ? state.live : {};
      state.live.hold = !state.live.hold;
    }),
    executeLightingScene: sceneId => enqueue(async () => {
      const state = loadState();
      if (typeof sceneId !== "string" || !sceneId) throw new TypeError("sceneId is required");
      const scene = (state.lightingScenes || []).find(item => item.id === sceneId);
      if (!scene) throw new RangeError(`Unknown lighting scene: ${sceneId}`);
      const resolutionState = {
        ...state,
        devices: (state.devices || []).map(device =>
          device?.type === "lighting" && device.enabled === false ? { ...device, enabled: true } : device
        )
      };
      const { execution, validation } = lightingExecutionResolver(resolutionState, sceneId);
      return execution
        ? await lightingExecutorFactory(state, {
          registry: lightingAdapters,
          activeState: lightingActiveState
        }).execute(execution, { source: "lighting-library" })
        : {
          ok: false,
          code: validation?.state || "lightingResolutionFailed",
          message: validation?.message || "Lighting Scene could not be resolved"
        };
    }),
    updateLightingScene: (sceneId, patch) => mutate(state => lightingScenes.updateLightingScene(state, sceneId, patch)),
    duplicateLightingScene: sceneId => mutate(state => lightingScenes.duplicateLightingScene(state, sceneId)),
    reorderCue: (from, to) => mutate(state => service.reorderCue(state, from, to)),
    reorderCueById: (cueId, targetCueId, placement) => mutate(state => service.reorderCueById(state, cueId, targetCueId, placement)),
    moveCueById: (cueId, direction) => mutate(state => service.moveCueById(state, cueId, direction)),
    duplicateCue: index => mutate(state => service.duplicateCue(state, index)),
    insertCue: (index, position) => mutate(state => service.insertCue(state, index, position)),
    deleteCue: (index, options) => mutate(state => service.deleteCue(state, index, options)),
    deleteCueById: (cueId, options) => mutate(state => service.deleteCueById(state, cueId, options)),
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
    testLightingConnection: deviceId => mutate(async state => {
      const device = devices.getDeviceById(state, deviceId);
      if (!device || device.type !== "lighting") throw new RangeError(`Unknown lighting device: ${deviceId}`);
      const result = await lightingAdapters.testConnection(device);
      device.metadata = { ...device.metadata, lightingDiagnostic: result };
      device.lastCheckedAt = new Date().toISOString();
      device.lastError = result.ok ? null : result.message;
    }),
    discoverLightingControls: deviceId => mutate(async state => {
      const device = devices.getDeviceById(state, deviceId);
      if (!device || device.type !== "lighting") throw new RangeError(`Unknown lighting device: ${deviceId}`);
      const result = await lightingAdapters.discoverControls(device);
      device.metadata = {
        ...device.metadata,
        lightingDiagnostic: result,
        qlcplusWidgets: result.ok ? result.widgets : device.metadata?.qlcplusWidgets || [],
        qlcplusPages: result.ok ? result.pages || [] : device.metadata?.qlcplusPages || []
      };
      device.lastCheckedAt = new Date().toISOString();
      device.lastError = result.ok ? null : result.message;
    }),
    clearDeviceDiagnostic: deviceId => mutate(state => devices.clearDeviceDiagnostic(state, deviceId)),
    createCameraPreset: input => mutate(state => presets.createCameraPreset(state, input)),
    updateCameraPreset: (presetId, patch) => mutate(state => presets.updateCameraPreset(state, presetId, patch)),
    duplicateCameraPreset: presetId => mutate(state => presets.duplicateCameraPreset(state, presetId)),
    deleteCameraPreset: (presetId, options) => mutate(state => presets.deleteCameraPreset(state, presetId, options)),
    reorderCameraPreset: (cameraDeviceId, from, to) => mutate(state => presets.reorderCameraPreset(state, cameraDeviceId, from, to)),
    createShot: input => mutate(state => shots.createShot(state, input)),
    updateShot: (shotId, patch) => mutate(state => shots.updateShot(state, shotId, patch)),
    duplicateShot: shotId => mutate(state => shots.duplicateShot(state, shotId)),
    deleteShot: (shotId, options) => mutate(state => shots.deleteShot(state, shotId, options)),
    reorderShot: (from, to) => mutate(state => shots.reorderShot(state, from, to)),
    resetLightingActiveState: reason => lightingActiveState.reset(reason),
    getLightingActiveState: () => lightingActiveState.get(),
    subscribe: subscriber => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    }
  };
}

module.exports = { createOperatorCommands };
