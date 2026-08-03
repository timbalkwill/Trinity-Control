const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("trinity", {
  getState: () => ipcRenderer.invoke("state:get"),
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  getSystemStatus: () => ipcRenderer.invoke("system:status"),
  onNavigate: subscriber => {
    const listener = (_event, page) => subscriber(page);
    ipcRenderer.on("app:navigate", listener);
    return () => ipcRenderer.removeListener("app:navigate", listener);
  },
  onShowAbout: subscriber => {
    const listener = () => subscriber();
    ipcRenderer.on("app:show-about", listener);
    return () => ipcRenderer.removeListener("app:show-about", listener);
  },
  onShowKeyboardShortcuts: subscriber => {
    const listener = () => subscriber();
    ipcRenderer.on("app:show-keyboard-shortcuts", listener);
    return () => ipcRenderer.removeListener("app:show-keyboard-shortcuts", listener);
  },
  getOperatorServerStatus: () => ipcRenderer.invoke("operator-server:status"),
  getQlcServiceStatus: () => ipcRenderer.invoke("qlc-service:status"),
  getAtemStatus: () => ipcRenderer.invoke("atem:status"),
  onAtemStatusChanged: subscriber => {
    const listener = (_event, status) => subscriber(status);
    ipcRenderer.on("atem:status-changed", listener);
    return () => ipcRenderer.removeListener("atem:status-changed", listener);
  },
  onQlcServiceStatusChanged: subscriber => {
    const listener = (_event, status) => subscriber(status);
    ipcRenderer.on("qlc-service:status-changed", listener);
    return () => ipcRenderer.removeListener("qlc-service:status-changed", listener);
  },
  updateQlcServiceSettings: patch => ipcRenderer.invoke("qlc-service:update-settings", patch),
  browseQlcApplication: () => ipcRenderer.invoke("qlc-service:browse-application"),
  browseQlcWorkspace: () => ipcRenderer.invoke("qlc-service:browse-workspace"),
  startQlcService: () => ipcRenderer.invoke("qlc-service:start"),
  restartQlcService: () => ipcRenderer.invoke("qlc-service:restart"),
  refreshQlcService: () => ipcRenderer.invoke("qlc-service:refresh"),
  setQlcDeviceEnabled: enabled => ipcRenderer.invoke("qlc-service:set-enabled", enabled),
  onStateChanged: subscriber => {
    const listener = (_event, state) => subscriber(state);
    ipcRenderer.on("operator:state-changed", listener);
    return () => ipcRenderer.removeListener("operator:state-changed", listener);
  },
  saveState: s => ipcRenderer.invoke("state:save", s),
  addCueTemplate: id => ipcRenderer.invoke("cue:addTemplate", id),
  moveCue: (from, to) => ipcRenderer.invoke("cue:move", { from, to }),
  reorderCueById: (cueId, targetCueId, placement) => ipcRenderer.invoke("cue:move-by-id", { cueId, targetCueId, placement }),
  moveCueById: (cueId, direction) => ipcRenderer.invoke("cue:nudge-by-id", { cueId, direction }),
  duplicateCue: index => ipcRenderer.invoke("cue:duplicate", index),
  createCue: input => ipcRenderer.invoke("cue:create", input),
  insertCue: (index, position) => ipcRenderer.invoke("cue:insert", { index, position }),
  removeCue: (index, options) => ipcRenderer.invoke("cue:remove", { index, options }),
  deleteCueById: (cueId, options) => ipcRenderer.invoke("cue:remove-by-id", { cueId, options }),
  updateCue: (index, patch) => ipcRenderer.invoke("cue:update", { index, patch }),
  createProductionLook: input => ipcRenderer.invoke("look:create", input),
  updateProductionLook: (lookId, patch) => ipcRenderer.invoke("look:update", { lookId, patch }),
  duplicateProductionLook: lookId => ipcRenderer.invoke("look:duplicate", lookId),
  deleteProductionLook: (lookId, options) => ipcRenderer.invoke("look:delete", { lookId, options }),
  createDevice: input => ipcRenderer.invoke("device:create", input),
  updateDevice: (deviceId, patch) => ipcRenderer.invoke("device:update", { deviceId, patch }),
  duplicateDevice: deviceId => ipcRenderer.invoke("device:duplicate", deviceId),
  deleteDevice: (deviceId, options) => ipcRenderer.invoke("device:delete", { deviceId, options }),
  reorderDevice: (from, to) => ipcRenderer.invoke("device:reorder", { from, to }),
  testDevice: deviceId => ipcRenderer.invoke("device:test", deviceId),
  testAllDevices: () => ipcRenderer.invoke("device:testAll"),
  testLightingConnection: deviceId => ipcRenderer.invoke("lighting-adapter:test", deviceId),
  discoverLightingControls: deviceId => ipcRenderer.invoke("lighting-adapter:discover", deviceId),
  executeLightingScene: sceneId => ipcRenderer.invoke("lighting-scene:execute", sceneId),
  updateLightingScene: (sceneId, patch) => ipcRenderer.invoke("lighting-scene:update", { sceneId, patch }),
  duplicateLightingScene: sceneId => ipcRenderer.invoke("lighting-scene:duplicate", sceneId),
  clearDeviceDiagnostic: deviceId => ipcRenderer.invoke("device:clearDiagnostic", deviceId),
  createCameraPreset: input => ipcRenderer.invoke("camera-preset:create", input),
  updateCameraPreset: (presetId, patch) => ipcRenderer.invoke("camera-preset:update", { presetId, patch }),
  duplicateCameraPreset: presetId => ipcRenderer.invoke("camera-preset:duplicate", presetId),
  deleteCameraPreset: (presetId, options) => ipcRenderer.invoke("camera-preset:delete", { presetId, options }),
  reorderCameraPreset: (cameraDeviceId, from, to) => ipcRenderer.invoke("camera-preset:reorder", { cameraDeviceId, from, to }),
  createShot: input => ipcRenderer.invoke("shot:create", input),
  updateShot: (shotId, patch) => ipcRenderer.invoke("shot:update", { shotId, patch }),
  duplicateShot: shotId => ipcRenderer.invoke("shot:duplicate", shotId),
  deleteShot: (shotId, options) => ipcRenderer.invoke("shot:delete", { shotId, options }),
  reorderShot: (from, to) => ipcRenderer.invoke("shot:reorder", { from, to }),
  goCue: (index, options) => ipcRenderer.invoke("live:go", { index, options }),
  nextCue: () => ipcRenderer.invoke("live:next"),
  previousCue: () => ipcRenderer.invoke("live:back"),
  takeLive: () => ipcRenderer.invoke("live:take"),
  setCameraMode: (cameraId, mode) => ipcRenderer.invoke("live:cameraMode", { cameraId, mode }),
  prepareCamera: (cameraId, selectionId) => ipcRenderer.invoke("live:prepareCamera", { cameraId, selectionId }),
  recallCameraPreset: (cameraId, presetId) => ipcRenderer.invoke("live:recallCameraPreset", { cameraId, presetId }),
  takeCameraLive: cameraId => ipcRenderer.invoke("atem:take-live", cameraId),
  setCameraTracking: (cameraId, active) => ipcRenderer.invoke("live:cameraTracking", { cameraId, active }),
  makeCameraLive: cameraId => ipcRenderer.invoke("live:makeCameraLive", cameraId),
  toggleHold: () => ipcRenderer.invoke("live:hold"),
  getHomeAssistantStatus: () => ipcRenderer.invoke("home-assistant:status"),
  turnLightingPowerOn: () => ipcRenderer.invoke("home-assistant:lighting-on"),
  turnLightingPowerOff: () => ipcRenderer.invoke("home-assistant:lighting-off")
});
