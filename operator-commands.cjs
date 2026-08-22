"use strict";

const { executeCue } = require("./cue-execution.cjs");
const service = require("./service-operations.cjs");
const looks = require("./production-look-operations.cjs");
const devices = require("./device-operations.cjs");
const presets = require("./camera-preset-operations.cjs");
const shots = require("./shot-operations.cjs");
const liveOperations = require("./live-operations.cjs");
const cameraPreparation = require("./camera-preparation-operations.cjs");
const { cameraExecutionCapabilities, createCameraExecutor } = require("./camera-adapter-registry.cjs");
const { executeManualMotion, SHOT_EXECUTION_STATUS } = require("./camera-shot-execution.cjs");
const { createLightingAdapterRegistry } = require("./lighting-adapter-registry.cjs");
const lightingScenes = require("./lighting-scene-operations.cjs");
const { createLightingExecutor } = require("./lighting-execution.cjs");
const { createLightingActiveState } = require("./lighting-active-state.cjs");
const { createPreparedMotionState } = require("./prepared-motion-state.cjs");
const { updateVideoSource, updateVideoSwitchingSettings } = require("./video-source-operations.cjs");
const {
  reconcileLightingScenes,
  replaceLightingReferences,
  semanticDiscoveryEqual
} = require("./lighting-reconciliation.cjs");

function createOperatorCommands({
  loadState,
  saveState,
  normalizeState = state => state,
  cueExecutor = executeCue,
  lightingAdapters = createLightingAdapterRegistry(),
  lightingActiveState = createLightingActiveState(),
  lightingExecutionResolver = lightingScenes.resolveLightingExecution,
  lightingExecutorFactory = createLightingExecutor,
  cameraExecutorFactory = createCameraExecutor,
  preparedMotionState = createPreparedMotionState()
}) {
  const subscribers = new Set();
  let queue = Promise.resolve();

  function publish(state) {
    const projected = {
      ...state,
      live: { ...(state?.live || {}), preparedMotions: preparedMotionState.snapshot() }
    };
    for (const subscriber of subscribers) {
      try { subscriber(projected); }
      catch { /* One disconnected client must not fail a persisted command. */ }
    }
    return projected;
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

  function discoverLightingControlsDetailed(deviceId) {
    return enqueue(async () => {
      const state = loadState();
      const device = devices.getDeviceById(state, deviceId);
      if (!device || device.type !== "lighting") throw new RangeError(`Unknown lighting device: ${deviceId}`);
      const result = await lightingAdapters.discoverControls(device);
      if (!result?.ok) return { state, result, changed: false, reconciliation: null };
      const discoveryChanged = !semanticDiscoveryEqual(device, result.widgets, result.pages);
      const reconciliation = reconcileLightingScenes(state, result.widgets, { now: Date.now() });
      if (!discoveryChanged && !reconciliation.changed) {
        return { state, result, changed: false, reconciliation: reconciliation.summary };
      }
      device.metadata = {
        ...device.metadata,
        lightingDiagnostic: { ok: true, code: result.code, message: result.message, widgetCount: result.widgetCount },
        qlcplusWidgets: result.widgets,
        qlcplusPages: result.pages || [],
        lightingReconciliation: reconciliation.summary
      };
      device.lastCheckedAt = new Date().toISOString();
      device.lastError = null;
      lightingActiveState.synchronize(state);
      const saved = publish(saveState(state));
      return { state: saved, result, changed: true, reconciliation: reconciliation.summary };
    });
  }

  function executeRequestedCue(state, index) {
    return cueExecutor(state, index, {
      lightingExecutor: lightingExecutorFactory(state, { registry: lightingAdapters, activeState: lightingActiveState })
    });
  }

  return {
    getState: () => {
      const state = loadState();
      return { ...state, live: { ...(state.live || {}), preparedMotions: preparedMotionState.snapshot() } };
    },
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
    prepareCamera: (cameraId, selectionId) => mutate(state => {
      preparedMotionState.clear(cameraId);
      return cameraPreparation.prepareCamera(state, cameraId, selectionId);
    }),
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
      preparedMotionState.clear(cameraId);
      cameraPreparation.setCameraMode(state, cameraId, "static");
      cameraPreparation.prepareCamera(state, cameraId, presetId);
      state.live.activityLog = [
        { at: Date.now(), message: `Camera preset commanded: ${camera.name} — ${preset.name}` },
        ...(Array.isArray(state.live.activityLog) ? state.live.activityLog : [])
      ].slice(0, 8);
    }),
    getCameraExecutionCapabilities: cameraId => {
      const camera = (loadState().devices || []).find(item => item?.type === "camera" && item.id === cameraId);
      if (!camera) throw new RangeError(`Camera is unavailable: ${cameraId}`);
      return cameraExecutionCapabilities(camera);
    },
    prepareMotionStart: (cameraId, shotId) => mutate(async state => {
      const shot = (state.shots || []).find(item => item?.id === shotId && item.enabled !== false);
      if (!shot || shot.shotType !== "motion" || shot.cameraDeviceId !== cameraId) throw new RangeError(`Unknown Motion Shot for camera ${cameraId}: ${shotId}`);
      const execution = shots.resolveShotExecution(state, shot, { referenceSource: "motion-studio-prepare-start" });
      if (!execution.valid || !execution.motion?.startPreset?.id) throw new RangeError(execution.errors?.join("; ") || "Motion Shot Start preset is unavailable");
      const presetId = execution.motion.startPreset.id;
      const outcome = await cameraExecutorFactory(state).recallPreset({ cameraDeviceId: cameraId, presetId });
      if (outcome?.ok !== true) {
        const error = new Error(outcome?.message || "Camera Start preset recall failed");
        error.code = outcome?.code || "CAMERA_PRESET_RECALL_FAILED";
        error.statusCode = 409;
        throw error;
      }
      preparedMotionState.prepare(cameraId, execution);
      state.live.activityLog = [
        { at: Date.now(), message: `Motion start commanded: ${execution.camera.name || cameraId} — ${execution.motion.startPreset.name || presetId}` },
        ...(Array.isArray(state.live.activityLog) ? state.live.activityLog : [])
      ].slice(0, 8);
    }),
    runCameraMotion: (cameraId, shotId) => mutate(async state => {
      const camera = (state.devices || []).find(item => item?.type === "camera" && item.id === cameraId && item.enabled !== false);
      if (!camera) throw new RangeError(`Camera is unavailable: ${cameraId}`);
      const shot = (state.shots || []).find(item => item?.id === shotId && item.enabled !== false);
      if (!shot || shot.shotType !== "motion" || shot.cameraDeviceId !== cameraId) {
        throw new RangeError(`Unknown Motion Shot for camera ${cameraId}: ${shotId}`);
      }
      const execution = shots.resolveShotExecution(state, shot, { referenceSource: "live-camera-director" });
      const outcome = await executeManualMotion(execution, { cameraExecutor: cameraExecutorFactory(state) });
      if (outcome.status !== SHOT_EXECUTION_STATUS.MOTION_COMMANDED) {
        const error = new Error(outcome.message || "Camera motion command failed");
        error.code = outcome.code || "CAMERA_MOTION_FAILED";
        error.statusCode = 409;
        throw error;
      }
      preparedMotionState.clear(cameraId);
      state.live = state.live && typeof state.live === "object" ? state.live : {};
      state.live.manualMotionCommands = state.live.manualMotionCommands && typeof state.live.manualMotionCommands === "object"
        ? state.live.manualMotionCommands : {};
      state.live.manualMotionCommands[cameraId] = {
        shotId: shot.id,
        shotName: shot.name,
        startPresetId: execution.motion.startPreset.id,
        endPresetId: execution.motion.endPreset.id,
        speed: execution.motion.speed,
        status: "commanded",
        at: Date.now()
      };
      state.live.activityLog = [
        { at: Date.now(), message: `Camera motion commanded: ${camera.name} — ${shot.name}` },
        ...(Array.isArray(state.live.activityLog) ? state.live.activityLog : [])
      ].slice(0, 8);
    }),
    setCameraTracking: (cameraId, active) => mutate(state => {
      if (active === true) preparedMotionState.clear(cameraId);
      return cameraPreparation.setCameraTracking(state, cameraId, active);
    }),
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
    createCue: input => mutate(state => service.createCue(state, input)),
    insertCue: (index, position) => mutate(state => service.insertCue(state, index, position)),
    deleteCue: (index, options) => mutate(state => service.deleteCue(state, index, options)),
    deleteCueById: (cueId, options) => mutate(state => service.deleteCueById(state, cueId, options)),
    updateCue: (index, patch) => mutate(state => service.updateCue(state, index, patch)),
    createProductionLook: input => mutate(state => looks.createProductionLook(state, input)),
    updateProductionLook: (lookId, patch) => mutate(state => looks.updateProductionLook(state, lookId, patch)),
    duplicateProductionLook: lookId => mutate(state => looks.duplicateProductionLook(state, lookId)),
    deleteProductionLook: (lookId, options) => mutate(state => looks.deleteProductionLook(state, lookId, options)),
    createDevice: input => mutate(state => devices.createDevice(state, input)),
    updateDevice: (deviceId, patch) => mutate(state => {
      const device = devices.getDeviceById(state, deviceId);
      if (device?.type === "camera") preparedMotionState.clear(deviceId);
      return devices.updateDevice(state, deviceId, patch);
    }),
    duplicateDevice: deviceId => mutate(state => devices.duplicateDevice(state, deviceId)),
    deleteDevice: (deviceId, options) => mutate(state => {
      preparedMotionState.clear(deviceId);
      return devices.deleteDevice(state, deviceId, options);
    }),
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
    discoverLightingControls: deviceId => discoverLightingControlsDetailed(deviceId).then(outcome => outcome.state),
    discoverLightingControlsDetailed,
    replaceLightingReferences: (missingSceneId, replacementSceneId, selection) =>
      mutate(state => replaceLightingReferences(state, missingSceneId, replacementSceneId, selection)),
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
    getPreparedMotion: cameraId => preparedMotionState.get(cameraId),
    updateVideoSource: (sourceId, patch) => mutate(state => updateVideoSource(state, sourceId, patch)),
    updateVideoSwitchingSettings: patch => mutate(state => updateVideoSwitchingSettings(state, patch)),
    setPreparedMotionStatus: (cameraId, status, label, errorMessage) => enqueue(() => {
      preparedMotionState.setStatus(cameraId, status, label, errorMessage);
      return publish(loadState());
    }),
    cancelPreparedMotion: cameraId => enqueue(() => {
      preparedMotionState.clear(cameraId);
      return publish(loadState());
    }),
    subscribe: subscriber => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    }
  };
}

module.exports = { createOperatorCommands };
