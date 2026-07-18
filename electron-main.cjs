const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

function dataPath() { return path.join(app.getPath("userData"), "trinity-data.json"); }
function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

function defaultState() {
  return {
    version: "0.8.3-alpha.3",
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
      { id: "cam-worship", category: "Worship", favorite: true, name: "Worship Wide", programCamera: "main", programPreset: "Stage Wide", previewCamera: "left", previewPreset: "Stage Left", tracking: false },
      { id: "cam-worship-left", category: "Worship", favorite: false, name: "Worship Left", programCamera: "left", programPreset: "Stage Left", previewCamera: "main", previewPreset: "Stage Wide", tracking: false },
      { id: "cam-worship-right", category: "Worship", favorite: false, name: "Worship Right", programCamera: "right", programPreset: "Stage Right", previewCamera: "main", previewPreset: "Stage Wide", tracking: false },
      { id: "cam-center-vocal", category: "Worship", favorite: false, name: "Center Vocal", programCamera: "main", programPreset: "Stage Medium", previewCamera: "left", previewPreset: "Stage Wide", tracking: true },
      { id: "cam-pastor-wide", category: "Sermon", favorite: false, name: "Pastor Wide", programCamera: "main", programPreset: "Pulpit Wide", previewCamera: "left", previewPreset: "Congregation Wide", tracking: true },
      { id: "cam-pastor-medium", category: "Sermon", favorite: true, name: "Pastor Medium", programCamera: "main", programPreset: "Stage Medium", previewCamera: "left", previewPreset: "Pulpit Wide", tracking: true },
      { id: "cam-sermon", category: "Sermon", favorite: true, name: "Pastor Tight", programCamera: "main", programPreset: "Pulpit Tight", previewCamera: "left", previewPreset: "Pulpit Wide", tracking: true },
      { id: "cam-guest", category: "Sermon", favorite: false, name: "Guest Speaker", programCamera: "left", programPreset: "Pulpit Tight", previewCamera: "main", previewPreset: "Pulpit Wide", tracking: true },
      { id: "cam-piano", category: "Music", favorite: false, name: "Piano", programCamera: "right", programPreset: "Piano", previewCamera: "main", previewPreset: "Stage Wide", tracking: false },
      { id: "cam-choir", category: "Music", favorite: false, name: "Choir", programCamera: "main", programPreset: "Stage Wide", previewCamera: "right", previewPreset: "Stage Right", tracking: false },
      { id: "cam-congregation", category: "Room", favorite: false, name: "Congregation", programCamera: "left", programPreset: "Congregation Wide", previewCamera: "main", previewPreset: "Stage Wide", tracking: false },
      { id: "cam-communion", category: "Special Events", favorite: true, name: "Communion", programCamera: "main", programPreset: "Communion", previewCamera: "right", previewPreset: "Stage Wide", tracking: false },
      { id: "cam-baptism", category: "Special Events", favorite: true, name: "Baptism", programCamera: "right", programPreset: "Baptistry", previewCamera: "main", previewPreset: "Stage Wide", tracking: false },
      { id: "cam-dedication", category: "Special Events", favorite: false, name: "Baby Dedication", programCamera: "main", programPreset: "Stage Medium", previewCamera: "left", previewPreset: "Stage Wide", tracking: false },
      { id: "cam-announcement", category: "Media", favorite: false, name: "Announcement", programCamera: "main", programPreset: "Pulpit Wide", previewCamera: "left", previewPreset: "Stage Wide", tracking: false },
      { id: "cam-blank", category: "Media", favorite: false, name: "Blank Stage", programCamera: "main", programPreset: "Stage Wide", previewCamera: "right", previewPreset: "Stage Wide", tracking: false }
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
    if (!Array.isArray(merged[key]) || !merged[key].length) {
      merged[key] = fresh[key];
    } else {
      const existing = new Set(merged[key].map(item => item.id));
      merged[key] = [...merged[key], ...fresh[key].filter(item => !existing.has(item.id))];
    }
  }
  merged.cameraLayouts = merged.cameraLayouts.map(layout => ({
    category: "Custom",
    favorite: false,
    ...layout
  }));
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
