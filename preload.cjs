const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("trinity", {
  getState: () => ipcRenderer.invoke("state:get"),
  saveState: (state) => ipcRenderer.invoke("state:save", state),
  selectCamera: (cameraId, target) =>
    ipcRenderer.invoke("camera:select", { cameraId, target }),
  addCue: (cue) => ipcRenderer.invoke("cue:add", cue),
  nextCue: () => ipcRenderer.invoke("live:next"),
  previousCue: () => ipcRenderer.invoke("live:back"),
  toggleHold: () => ipcRenderer.invoke("live:toggleHold")
});
