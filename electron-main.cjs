const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

function dataPath() { return path.join(app.getPath("userData"), "trinity-data.json"); }
function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

function defaultState() {
  return {
    version: "0.7.0-alpha.2",
    cameras: [
      { id: "main", name: "Main PTZ", online: true },
      { id: "left", name: "Left PTZ", online: true },
      { id: "right", name: "Right PTZ", online: true }
    ],
    lightingScenes: [
      { id: "light-worship", name: "Worship", platform: 90, fill: 45, room: "Soft Blue", ceiling: 35, house: 20, fade: 3 },
      { id: "light-sermon", name: "Sermon Warm", platform: 82, fill: 40, room: "Warm Amber", ceiling: 20, house: 35, fade: 3 },
      { id: "light-invitation", name: "Invitation", platform: 65, fill: 30, room: "Lavender", ceiling: 18, house: 15, fade: 5 },
      { id: "light-communion", name: "Communion", platform: 55, fill: 25, room: "Warm Reflection", ceiling: 12, house: 10, fade: 5 },
      { id: "light-full", name: "Full White", platform: 100, fill: 80, room: "White", ceiling: 50, house: 60, fade: 2 }
    ],
    cameraLayouts: [
      { id: "cam-worship", name: "Worship Wide", programCamera: "main", programPreset: "Stage Wide", previewCamera: "left", previewPreset: "Stage Left", tracking: false },
      { id: "cam-sermon", name: "Pastor Tight", programCamera: "main", programPreset: "Pulpit Tight", previewCamera: "left", previewPreset: "Pulpit Wide", tracking: true },
      { id: "cam-communion", name: "Communion Layout", programCamera: "main", programPreset: "Communion", previewCamera: "right", previewPreset: "Stage Wide", tracking: false },
      { id: "cam-baptism", name: "Baptism Layout", programCamera: "right", programPreset: "Baptistry", previewCamera: "main", previewPreset: "Stage Wide", tracking: false }
    ],
    productionLooks: [
      { id: "look-welcome", name: "Welcome", lightingSceneId: "light-sermon", cameraLayoutId: "cam-sermon", graphics: "Welcome Lower Third", houseLights: 45, tracking: true },
      { id: "look-worship", name: "Worship", lightingSceneId: "light-worship", cameraLayoutId: "cam-worship", graphics: "Lyrics", houseLights: 20, tracking: false },
      { id: "look-sermon", name: "Sermon", lightingSceneId: "light-sermon", cameraLayoutId: "cam-sermon", graphics: "Scripture", houseLights: 35, tracking: true },
      { id: "look-invitation", name: "Invitation", lightingSceneId: "light-invitation", cameraLayoutId: "cam-sermon", graphics: "None", houseLights: 15, tracking: true },
      { id: "look-communion", name: "Communion", lightingSceneId: "light-communion", cameraLayoutId: "cam-communion", graphics: "Communion", houseLights: 10, tracking: false },
      { id: "look-baptism", name: "Baptism", lightingSceneId: "light-full", cameraLayoutId: "cam-baptism", graphics: "Baptism", houseLights: 40, tracking: false }
    ],
    cueTemplates: [
      { id: "tpl-welcome", category: "Service", name: "Welcome", duration: 300, notes: "Opening welcome", productionLookId: "look-welcome" },
      { id: "tpl-worship", category: "Music", name: "Worship", duration: 1200, notes: "Congregational singing", productionLookId: "look-worship" },
      { id: "tpl-offering", category: "Service", name: "Offering", duration: 420, notes: "Offering and announcements", productionLookId: "look-welcome" },
      { id: "tpl-sermon", category: "Service", name: "Sermon", duration: 2100, notes: "Main preaching cue", productionLookId: "look-sermon" },
      { id: "tpl-invitation", category: "Service", name: "Invitation", duration: 600, notes: "Invitation", productionLookId: "look-invitation" },
      { id: "tpl-communion", category: "Service", name: "Communion", duration: 720, notes: "Communion service", productionLookId: "look-communion" },
      { id: "tpl-baptism", category: "Service", name: "Baptism", duration: 600, notes: "Baptism", productionLookId: "look-baptism" },
      { id: "tpl-video", category: "Media", name: "Video", duration: 240, notes: "Roll video", productionLookId: "look-worship" }
    ],
    runOfService: [
      { id: "cue-welcome", name: "Welcome", duration: 300, notes: "Opening welcome", productionLookId: "look-welcome" },
      { id: "cue-worship", name: "Worship", duration: 1200, notes: "Congregational singing", productionLookId: "look-worship" },
      { id: "cue-sermon", name: "Sermon", duration: 2100, notes: "Main preaching cue", productionLookId: "look-sermon" },
      { id: "cue-invitation", name: "Invitation", duration: 600, notes: "Invitation", productionLookId: "look-invitation" }
    ],
    live: {
      cueIndex: 0,
      programCamera: "main",
      previewCamera: "left",
      hold: false,
      lightingOverrideId: null,
      lastLightingSceneId: null
    }
  };
}

function migrate(state) {
  const fresh = defaultState();
  const merged = { ...fresh, ...state, version: fresh.version };
  for (const key of ["lightingScenes", "cameraLayouts", "productionLooks", "cueTemplates"]) {
    if (!Array.isArray(merged[key]) || !merged[key].length) merged[key] = fresh[key];
  }
  if (!Array.isArray(merged.runOfService)) merged.runOfService = fresh.runOfService;
  merged.live = { ...fresh.live, ...(state.live || {}) };
  merged.runOfService = merged.runOfService.map((cue, i) => ({
    productionLookId: fresh.productionLooks[Math.min(i, fresh.productionLooks.length - 1)]?.id || "look-sermon",
    ...cue
  }));
  return merged;
}

function loadState() {
  try { return migrate(JSON.parse(fs.readFileSync(dataPath(), "utf8"))); }
  catch { const s = defaultState(); saveState(s); return s; }
}
function saveState(state) { fs.writeFileSync(dataPath(), JSON.stringify(state, null, 2)); return state; }

function applyLook(state, lookId) {
  const look = state.productionLooks.find(x => x.id === lookId);
  if (!look) return state;
  const layout = state.cameraLayouts.find(x => x.id === look.cameraLayoutId);
  if (layout) {
    state.live.programCamera = layout.programCamera;
    state.live.previewCamera = layout.previewCamera;
  }
  state.live.lastLightingSceneId = look.lightingSceneId;
  state.live.lightingOverrideId = null;
  return state;
}

app.whenReady().then(() => {
  ipcMain.handle("state:get", () => loadState());
  ipcMain.handle("state:save", (_e, s) => saveState(migrate(s)));
  ipcMain.handle("cue:addTemplate", (_e, templateId) => {
    const s = loadState(); const t = s.cueTemplates.find(x => x.id === templateId); if (!t) return s;
    s.runOfService.push({ id: uid("cue"), name: t.name, duration: t.duration, notes: t.notes, productionLookId: t.productionLookId });
    return saveState(s);
  });
  ipcMain.handle("cue:move", (_e, { from, to }) => {
    const s = loadState(); if (from < 0 || to < 0 || from >= s.runOfService.length || to >= s.runOfService.length) return s;
    const [item] = s.runOfService.splice(from, 1); s.runOfService.splice(to, 0, item); return saveState(s);
  });
  ipcMain.handle("cue:remove", (_e, index) => {
    const s = loadState(); s.runOfService.splice(index, 1); s.live.cueIndex = Math.min(s.live.cueIndex, Math.max(0, s.runOfService.length - 1)); return saveState(s);
  });
  ipcMain.handle("live:go", (_e, index) => {
    const s = loadState(); s.live.cueIndex = Math.max(0, Math.min(index, s.runOfService.length - 1)); applyLook(s, s.runOfService[s.live.cueIndex]?.productionLookId); return saveState(s);
  });
  ipcMain.handle("live:next", () => {
    const s = loadState(); s.live.cueIndex = Math.min(s.runOfService.length - 1, s.live.cueIndex + 1); applyLook(s, s.runOfService[s.live.cueIndex]?.productionLookId); return saveState(s);
  });
  ipcMain.handle("live:back", () => {
    const s = loadState(); s.live.cueIndex = Math.max(0, s.live.cueIndex - 1); applyLook(s, s.runOfService[s.live.cueIndex]?.productionLookId); return saveState(s);
  });
  ipcMain.handle("live:hold", () => { const s = loadState(); s.live.hold = !s.live.hold; return saveState(s); });
  ipcMain.handle("lighting:override", (_e, sceneId) => { const s = loadState(); s.live.lightingOverrideId = sceneId; return saveState(s); });
  ipcMain.handle("lighting:returnToCue", () => { const s = loadState(); s.live.lightingOverrideId = null; return saveState(s); });

  const win = new BrowserWindow({
    width: 1366, height: 900, minWidth: 1024, minHeight: 700,
    backgroundColor: "#081018", title: "Trinity Control",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, "public", "index.html"));
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
