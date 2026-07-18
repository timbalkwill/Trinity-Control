const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("trinity", {
  getState: () => ipcRenderer.invoke("state:get"),
  saveState: s => ipcRenderer.invoke("state:save", s),
  addCueTemplate: id => ipcRenderer.invoke("cue:addTemplate", id),
  moveCue: (from, to) => ipcRenderer.invoke("cue:move", { from, to }),
  removeCue: index => ipcRenderer.invoke("cue:remove", index),
  goCue: index => ipcRenderer.invoke("live:go", index),
  nextCue: () => ipcRenderer.invoke("live:next"),
  previousCue: () => ipcRenderer.invoke("live:back"),
  toggleHold: () => ipcRenderer.invoke("live:hold"),
  lightingOverride: id => ipcRenderer.invoke("lighting:override", id),
  returnToCueLighting: () => ipcRenderer.invoke("lighting:returnToCue")
});
