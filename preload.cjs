const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("trinity", {
  getState: () => ipcRenderer.invoke("state:get"),
  getOperatorServerStatus: () => ipcRenderer.invoke("operator-server:status"),
  onStateChanged: subscriber => {
    const listener = (_event, state) => subscriber(state);
    ipcRenderer.on("operator:state-changed", listener);
    return () => ipcRenderer.removeListener("operator:state-changed", listener);
  },
  saveState: s => ipcRenderer.invoke("state:save", s),
  addCueTemplate: id => ipcRenderer.invoke("cue:addTemplate", id),
  moveCue: (from, to) => ipcRenderer.invoke("cue:move", { from, to }),
  duplicateCue: index => ipcRenderer.invoke("cue:duplicate", index),
  insertCue: (index, position) => ipcRenderer.invoke("cue:insert", { index, position }),
  removeCue: (index, options) => ipcRenderer.invoke("cue:remove", { index, options }),
  updateCue: (index, patch) => ipcRenderer.invoke("cue:update", { index, patch }),
  createProductionLook: input => ipcRenderer.invoke("look:create", input),
  updateProductionLook: (lookId, patch) => ipcRenderer.invoke("look:update", { lookId, patch }),
  duplicateProductionLook: lookId => ipcRenderer.invoke("look:duplicate", lookId),
  deleteProductionLook: (lookId, options) => ipcRenderer.invoke("look:delete", { lookId, options }),
  goCue: (index, options) => ipcRenderer.invoke("live:go", { index, options }),
  nextCue: () => ipcRenderer.invoke("live:next"),
  previousCue: () => ipcRenderer.invoke("live:back"),
  toggleHold: () => ipcRenderer.invoke("live:hold"),
  lightingOverride: id => ipcRenderer.invoke("lighting:override", id),
  returnToCueLighting: () => ipcRenderer.invoke("lighting:returnToCue")
});
