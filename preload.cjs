const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("trinity", {
  getConnectionStatus: () => "connected",
  onConnectionStatusChanged: subscriber => {
    subscriber("connected");
    return () => {};
  },
  getState: () => ipcRenderer.invoke("state:get"),
  saveState: s => ipcRenderer.invoke("state:save", s),
  addCueTemplate: id => ipcRenderer.invoke("cue:addTemplate", id),
  moveCue: (from, to) => ipcRenderer.invoke("cue:move", { from, to }),
  removeCue: index => ipcRenderer.invoke("cue:remove", index),
  goCue: index => ipcRenderer.invoke("live:go", index),
  nextCue: () => ipcRenderer.invoke("live:next"),
  previousCue: () => ipcRenderer.invoke("live:back"),
  toggleHold: () => ipcRenderer.invoke("live:hold"),
  setHold: hold => ipcRenderer.invoke("live:setHold", hold),
  takeCamera: (cameraId, preset) => ipcRenderer.invoke("camera:take", { cameraId, preset }),
  lightingOverride: id => ipcRenderer.invoke("lighting:override", id),
  returnToCueLighting: () => ipcRenderer.invoke("lighting:returnToCue"),
  updateCameraConfiguration: (cameraId, changes) =>
    ipcRenderer.invoke("configuration:camera:update", { cameraId, changes }),
  updateLightingConfiguration: (sceneId, changes) =>
    ipcRenderer.invoke("configuration:lighting:update", { sceneId, changes }),
  onStateChanged: subscriber => {
    const listener = (_event, update) => subscriber(update);
    ipcRenderer.on("production:state-changed", listener);
    return () => ipcRenderer.removeListener("production:state-changed", listener);
  },
  onActivity: subscriber => {
    const listener = (_event, activity) => subscriber(activity);
    ipcRenderer.on("production:activity", listener);
    return () => ipcRenderer.removeListener("production:activity", listener);
  },
  onProductionError: subscriber => {
    const listener = (_event, error) => subscriber(error);
    ipcRenderer.on("production:error", listener);
    return () => ipcRenderer.removeListener("production:error", listener);
  }
});
