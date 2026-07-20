const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { ENGINE_EVENTS, ProductionEngine } = require("./src/core/production-engine.cjs");
const { SimulationCameraController } = require("./src/adapters/simulation/simulation-camera-controller.cjs");
const { SimulationSwitcherController } = require("./src/adapters/simulation/simulation-switcher-controller.cjs");
const { SimulationLightingController } = require("./src/adapters/simulation/simulation-lighting-controller.cjs");

app.setName("Trinity Control Refresh");

function dataPath() { return path.join(app.getPath("userData"), "trinity-data.json"); }
function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

function defaultState() {
  return {
    version: "1.0.2-alpha.5.2-refined",
    schemaVersion: 5,
    cameras: [
      { id: "main", name: "Main PTZ", role: "main", online: true, enabled: true },
      { id: "left", name: "Left PTZ", role: "left", online: true, enabled: true },
      { id: "right", name: "Right PTZ", role: "right", online: true, enabled: true }
    ],
    lightingScenes: [
      {
            "id": "light-preservice",
            "name": "Pre-Service",
            "category": "Sunday Morning",
            "favorite": true,
            "platform": 55,
            "fill": 25,
            "room": "Warm Amber",
            "ceiling": 20,
            "house": 55,
            "fade": 5
      },
      {
            "id": "light-countdown10",
            "name": "10 Minute Countdown",
            "category": "Sunday Morning",
            "favorite": false,
            "platform": 50,
            "fill": 20,
            "room": "Soft Blue",
            "ceiling": 28,
            "house": 45,
            "fade": 5
      },
      {
            "id": "light-countdown5",
            "name": "5 Minute Countdown",
            "category": "Sunday Morning",
            "favorite": false,
            "platform": 60,
            "fill": 25,
            "room": "Soft Blue",
            "ceiling": 30,
            "house": 35,
            "fade": 4
      },
      {
            "id": "light-welcome",
            "name": "Welcome",
            "category": "Sunday Morning",
            "favorite": true,
            "platform": 82,
            "fill": 40,
            "room": "Warm Amber",
            "ceiling": 20,
            "house": 40,
            "fade": 3
      },
      {
            "id": "light-prayer",
            "name": "Opening Prayer",
            "category": "Sunday Morning",
            "favorite": false,
            "platform": 65,
            "fill": 30,
            "room": "Warm Reflection",
            "ceiling": 15,
            "house": 25,
            "fade": 4
      },
      {
            "id": "light-worship",
            "name": "Worship Warm",
            "category": "Sunday Morning",
            "favorite": true,
            "platform": 90,
            "fill": 45,
            "room": "Soft Blue",
            "ceiling": 35,
            "house": 20,
            "fade": 3
      },
      {
            "id": "light-worship-bright",
            "name": "Worship Bright",
            "category": "Sunday Morning",
            "favorite": false,
            "platform": 100,
            "fill": 55,
            "room": "Soft Blue",
            "ceiling": 40,
            "house": 20,
            "fade": 3
      },
      {
            "id": "light-worship-intimate",
            "name": "Worship Intimate",
            "category": "Sunday Morning",
            "favorite": false,
            "platform": 65,
            "fill": 30,
            "room": "Lavender",
            "ceiling": 20,
            "house": 10,
            "fade": 5
      },
      {
            "id": "light-offering",
            "name": "Offering",
            "category": "Sunday Morning",
            "favorite": false,
            "platform": 78,
            "fill": 38,
            "room": "Warm Amber",
            "ceiling": 20,
            "house": 35,
            "fade": 3
      },
      {
            "id": "light-specialmusic",
            "name": "Special Music",
            "category": "Sunday Morning",
            "favorite": false,
            "platform": 85,
            "fill": 42,
            "room": "Soft Blue",
            "ceiling": 25,
            "house": 15,
            "fade": 4
      },
      {
            "id": "light-choir",
            "name": "Choir",
            "category": "Sunday Morning",
            "favorite": false,
            "platform": 95,
            "fill": 55,
            "room": "Warm Amber",
            "ceiling": 25,
            "house": 25,
            "fade": 3
      },
      {
            "id": "light-piano",
            "name": "Piano Solo",
            "category": "Sunday Morning",
            "favorite": false,
            "platform": 55,
            "fill": 25,
            "room": "Lavender",
            "ceiling": 18,
            "house": 15,
            "fade": 5
      },
      {
            "id": "light-sermon",
            "name": "Sermon Warm",
            "category": "Sunday Morning",
            "favorite": true,
            "platform": 82,
            "fill": 40,
            "room": "Warm Amber",
            "ceiling": 20,
            "house": 35,
            "fade": 3
      },
      {
            "id": "light-invitation",
            "name": "Invitation",
            "category": "Sunday Morning",
            "favorite": true,
            "platform": 65,
            "fill": 30,
            "room": "Lavender",
            "ceiling": 18,
            "house": 15,
            "fade": 5
      },
      {
            "id": "light-communion",
            "name": "Communion",
            "category": "Sunday Morning",
            "favorite": true,
            "platform": 55,
            "fill": 25,
            "room": "Warm Reflection",
            "ceiling": 12,
            "house": 10,
            "fade": 5
      },
      {
            "id": "light-baptism",
            "name": "Baptism",
            "category": "Sunday Morning",
            "favorite": true,
            "platform": 95,
            "fill": 50,
            "room": "Soft Blue",
            "ceiling": 30,
            "house": 40,
            "fade": 3
      },
      {
            "id": "light-closing",
            "name": "Closing Prayer",
            "category": "Sunday Morning",
            "favorite": false,
            "platform": 72,
            "fill": 35,
            "room": "Warm Amber",
            "ceiling": 18,
            "house": 30,
            "fade": 4
      },
      {
            "id": "light-dismissal",
            "name": "Dismissal",
            "category": "Sunday Morning",
            "favorite": false,
            "platform": 65,
            "fill": 30,
            "room": "Warm Amber",
            "ceiling": 30,
            "house": 75,
            "fade": 5
      },
      {
            "id": "light-camera-warm",
            "name": "Camera Warm",
            "category": "Camera",
            "favorite": false,
            "platform": 82,
            "fill": 45,
            "room": "Warm Amber",
            "ceiling": 15,
            "house": 30,
            "fade": 2
      },
      {
            "id": "light-camera-neutral",
            "name": "Camera Neutral",
            "category": "Camera",
            "favorite": false,
            "platform": 88,
            "fill": 48,
            "room": "Neutral",
            "ceiling": 15,
            "house": 30,
            "fade": 2
      },
      {
            "id": "light-camera-bright",
            "name": "Camera Bright",
            "category": "Camera",
            "favorite": false,
            "platform": 100,
            "fill": 60,
            "room": "White",
            "ceiling": 20,
            "house": 35,
            "fade": 2
      },
      {
            "id": "light-closeup",
            "name": "Livestream Close-Up",
            "category": "Camera",
            "favorite": false,
            "platform": 78,
            "fill": 52,
            "room": "Warm Amber",
            "ceiling": 10,
            "house": 25,
            "fade": 2
      },
      {
            "id": "light-interview",
            "name": "Interview",
            "category": "Camera",
            "favorite": false,
            "platform": 75,
            "fill": 55,
            "room": "Neutral",
            "ceiling": 10,
            "house": 35,
            "fade": 2
      },
      {
            "id": "light-stageleft",
            "name": "Stage Left Focus",
            "category": "Camera",
            "favorite": false,
            "platform": 72,
            "fill": 35,
            "room": "Warm Amber",
            "ceiling": 12,
            "house": 25,
            "fade": 3
      },
      {
            "id": "light-stageright",
            "name": "Stage Right Focus",
            "category": "Camera",
            "favorite": false,
            "platform": 72,
            "fill": 35,
            "room": "Warm Amber",
            "ceiling": 12,
            "house": 25,
            "fade": 3
      },
      {
            "id": "light-center",
            "name": "Center Platform",
            "category": "Camera",
            "favorite": false,
            "platform": 85,
            "fill": 42,
            "room": "Neutral",
            "ceiling": 12,
            "house": 25,
            "fade": 3
      },
      {
            "id": "light-fullstage",
            "name": "Full Stage Wash",
            "category": "Camera",
            "favorite": false,
            "platform": 100,
            "fill": 65,
            "room": "Neutral",
            "ceiling": 20,
            "house": 30,
            "fade": 2
      },
      {
            "id": "light-housefull",
            "name": "House Full",
            "category": "Room",
            "favorite": false,
            "platform": 35,
            "fill": 15,
            "room": "White",
            "ceiling": 50,
            "house": 100,
            "fade": 3
      },
      {
            "id": "light-househalf",
            "name": "House Half",
            "category": "Room",
            "favorite": false,
            "platform": 45,
            "fill": 20,
            "room": "Warm Amber",
            "ceiling": 35,
            "house": 50,
            "fade": 3
      },
      {
            "id": "light-housedim",
            "name": "House Dim",
            "category": "Room",
            "favorite": false,
            "platform": 55,
            "fill": 25,
            "room": "Warm Amber",
            "ceiling": 20,
            "house": 15,
            "fade": 4
      },
      {
            "id": "light-walkin",
            "name": "Walk-In",
            "category": "Room",
            "favorite": false,
            "platform": 45,
            "fill": 20,
            "room": "Warm Amber",
            "ceiling": 30,
            "house": 65,
            "fade": 5
      },
      {
            "id": "light-fellowship",
            "name": "Fellowship",
            "category": "Room",
            "favorite": false,
            "platform": 50,
            "fill": 25,
            "room": "Warm Amber",
            "ceiling": 40,
            "house": 85,
            "fade": 4
      },
      {
            "id": "light-cleaning",
            "name": "Cleaning",
            "category": "Room",
            "favorite": false,
            "platform": 100,
            "fill": 100,
            "room": "White",
            "ceiling": 100,
            "house": 100,
            "fade": 1
      },
      {
            "id": "light-security",
            "name": "Security Patrol",
            "category": "Room",
            "favorite": false,
            "platform": 20,
            "fill": 10,
            "room": "White",
            "ceiling": 20,
            "house": 35,
            "fade": 2
      },
      {
            "id": "light-amberfade",
            "name": "Slow Amber Fade",
            "category": "Effects",
            "favorite": false,
            "platform": 55,
            "fill": 25,
            "room": "Amber Slow Fade",
            "ceiling": 25,
            "house": 15,
            "fade": 8
      },
      {
            "id": "light-bluefade",
            "name": "Slow Blue Fade",
            "category": "Effects",
            "favorite": false,
            "platform": 60,
            "fill": 30,
            "room": "Blue Slow Fade",
            "ceiling": 30,
            "house": 15,
            "fade": 8
      },
      {
            "id": "light-drift",
            "name": "Gentle Color Drift",
            "category": "Effects",
            "favorite": false,
            "platform": 60,
            "fill": 30,
            "room": "Gentle Color Drift",
            "ceiling": 30,
            "house": 15,
            "fade": 10
      },
      {
            "id": "light-breathe",
            "name": "Breathing Amber",
            "category": "Effects",
            "favorite": false,
            "platform": 55,
            "fill": 25,
            "room": "Amber Slow Breathe",
            "ceiling": 25,
            "house": 15,
            "fade": 10
      },
      {
            "id": "light-christmasgold",
            "name": "Christmas Gold",
            "category": "Seasonal",
            "favorite": false,
            "platform": 75,
            "fill": 38,
            "room": "Gold",
            "ceiling": 30,
            "house": 25,
            "fade": 5
      },
      {
            "id": "light-christmasblue",
            "name": "Christmas Blue",
            "category": "Seasonal",
            "favorite": false,
            "platform": 75,
            "fill": 38,
            "room": "Deep Blue",
            "ceiling": 35,
            "house": 20,
            "fade": 5
      },
      {
            "id": "light-easter",
            "name": "Easter Sunrise",
            "category": "Seasonal",
            "favorite": false,
            "platform": 90,
            "fill": 48,
            "room": "Sunrise Amber",
            "ceiling": 40,
            "house": 30,
            "fade": 6
      },
      {
            "id": "light-patriotic",
            "name": "Patriotic",
            "category": "Seasonal",
            "favorite": false,
            "platform": 85,
            "fill": 45,
            "room": "Red White Blue",
            "ceiling": 35,
            "house": 25,
            "fade": 5
      },
      {
            "id": "light-full",
            "name": "Full White",
            "category": "Utility",
            "favorite": false,
            "platform": 100,
            "fill": 80,
            "room": "White",
            "ceiling": 50,
            "house": 60,
            "fade": 2
      },
      {
            "id": "light-allon",
            "name": "All Fixtures On",
            "category": "Utility",
            "favorite": false,
            "platform": 100,
            "fill": 100,
            "room": "White",
            "ceiling": 100,
            "house": 100,
            "fade": 1
      },
      {
            "id": "light-movers",
            "name": "Movers Only",
            "category": "Utility",
            "favorite": false,
            "platform": 100,
            "fill": 0,
            "room": "Off",
            "ceiling": 0,
            "house": 0,
            "fade": 2
      },
      {
            "id": "light-wallwash",
            "name": "Wall Wash Only",
            "category": "Utility",
            "favorite": false,
            "platform": 0,
            "fill": 0,
            "room": "Warm Amber",
            "ceiling": 0,
            "house": 0,
            "fade": 2
      },
      {
            "id": "light-stageonly",
            "name": "Stage Wash Only",
            "category": "Utility",
            "favorite": false,
            "platform": 90,
            "fill": 45,
            "room": "Off",
            "ceiling": 0,
            "house": 0,
            "fade": 2
      },
      {
            "id": "light-emergency",
            "name": "Emergency Full White",
            "category": "Utility",
            "favorite": false,
            "platform": 100,
            "fill": 100,
            "room": "White",
            "ceiling": 100,
            "house": 100,
            "fade": 0
      },
      {
            "id": "light-blackout",
            "name": "Blackout",
            "category": "Utility",
            "favorite": false,
            "platform": 0,
            "fill": 0,
            "room": "Off",
            "ceiling": 0,
            "house": 0,
            "fade": 1
      }
],
    cameraLayouts: [
      { id: "cam-worship-1", category: "Worship", favorite: true, name: "Worship 1 · Wide", programCamera: "main", programPreset: "Stage Wide", previewCamera: "left", previewPreset: "Stage Left", tracking: false },
      { id: "cam-worship-2", category: "Worship", favorite: true, name: "Worship 2 · Left", programCamera: "left", programPreset: "Stage Medium", previewCamera: "right", previewPreset: "Stage Right", tracking: false },
      { id: "cam-worship-3", category: "Worship", favorite: true, name: "Worship 3 · Intimate", programCamera: "right", programPreset: "Stage Medium", previewCamera: "main", previewPreset: "Stage Wide", tracking: false },
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
      { id: "look-worship-1", name: "Worship 1 · Wide", lightingSceneId: "light-worship", cameraLayoutId: "cam-worship-1", graphics: "Lyrics", houseLights: 20, tracking: false },
      { id: "look-worship-2", name: "Worship 2 · Bright", lightingSceneId: "light-worship-bright", cameraLayoutId: "cam-worship-2", graphics: "Lyrics", houseLights: 18, tracking: false },
      { id: "look-worship-3", name: "Worship 3 · Intimate", lightingSceneId: "light-worship-intimate", cameraLayoutId: "cam-worship-3", graphics: "Lyrics", houseLights: 10, tracking: false },
      { id: "look-welcome", name: "Welcome", lightingSceneId: "light-sermon", cameraLayoutId: "cam-sermon", graphics: "Welcome Lower Third", houseLights: 45, tracking: true },
      { id: "look-worship", name: "Worship", lightingSceneId: "light-worship", cameraLayoutId: "cam-worship", graphics: "Lyrics", houseLights: 20, tracking: false },
      { id: "look-sermon", name: "Sermon", lightingSceneId: "light-sermon", cameraLayoutId: "cam-sermon", graphics: "Scripture", houseLights: 35, tracking: true },
      { id: "look-invitation", name: "Invitation", lightingSceneId: "light-invitation", cameraLayoutId: "cam-sermon", graphics: "None", houseLights: 15, tracking: true },
      { id: "look-communion", name: "Communion", lightingSceneId: "light-communion", cameraLayoutId: "cam-communion", graphics: "Communion", houseLights: 10, tracking: false },
      { id: "look-baptism", name: "Baptism", lightingSceneId: "light-full", cameraLayoutId: "cam-baptism", graphics: "Baptism", houseLights: 40, tracking: false }
    ],
    cueTemplates: [
      { id: "tpl-welcome", category: "Service", name: "Welcome", duration: 300, notes: "Opening welcome", productionLookId: "look-welcome" },
      { id: "tpl-worship-1", category: "Music", name: "Worship 1", duration: 420, notes: "First worship song", productionLookId: "look-worship-1" },
      { id: "tpl-worship-2", category: "Music", name: "Worship 2", duration: 420, notes: "Second worship song", productionLookId: "look-worship-2" },
      { id: "tpl-worship-3", category: "Music", name: "Worship 3", duration: 420, notes: "Third worship song", productionLookId: "look-worship-3" },
      { id: "tpl-offering", category: "Service", name: "Offering", duration: 420, notes: "Offering and announcements", productionLookId: "look-welcome" },
      { id: "tpl-sermon", category: "Service", name: "Sermon", duration: 2100, notes: "Main preaching cue", productionLookId: "look-sermon" },
      { id: "tpl-invitation", category: "Service", name: "Invitation", duration: 600, notes: "Invitation", productionLookId: "look-invitation" },
      { id: "tpl-communion", category: "Service", name: "Communion", duration: 720, notes: "Communion service", productionLookId: "look-communion" },
      { id: "tpl-baptism", category: "Service", name: "Baptism", duration: 600, notes: "Baptism", productionLookId: "look-baptism" },
      { id: "tpl-video", category: "Media", name: "Video", duration: 240, notes: "Roll video", productionLookId: "look-worship" }
    ],
    runOfService: [
      { id: "cue-welcome", name: "Welcome", duration: 300, notes: "Opening welcome", productionLookId: "look-welcome" },
      { id: "cue-worship-1", name: "Worship 1", duration: 420, notes: "First worship song", productionLookId: "look-worship-1" },
      { id: "cue-worship-2", name: "Worship 2", duration: 420, notes: "Second worship song", productionLookId: "look-worship-2" },
      { id: "cue-worship-3", name: "Worship 3", duration: 420, notes: "Third worship song", productionLookId: "look-worship-3" },
      { id: "cue-sermon", name: "Sermon", duration: 2100, notes: "Main preaching cue", productionLookId: "look-sermon" },
      { id: "cue-invitation", name: "Invitation", duration: 600, notes: "Invitation", productionLookId: "look-invitation" }
    ],
    live: {
      cueIndex: 0,
      programCamera: "main",
      previewCamera: "left",
      programPreset: "Stage Wide",
      previewPreset: "Stage Left",
      hold: false,
      lightingOverrideId: null,
      lastLightingSceneId: null,
      cueStartedAt: Date.now(),
      activityLog: []
    }
  };
}

function migrate(state) {
  const fresh = defaultState();
  const merged = { ...fresh, ...state, version: fresh.version, schemaVersion: fresh.schemaVersion };
  for (const key of ["lightingScenes", "cameraLayouts", "productionLooks", "cueTemplates"]) {
    if (!Array.isArray(merged[key]) || !merged[key].length) {
      merged[key] = fresh[key];
    } else {
      const existing = new Set(merged[key].map(item => item.id));
      merged[key] = [...merged[key], ...fresh[key].filter(item => !existing.has(item.id))];
    }
  }
    merged.lightingScenes = merged.lightingScenes.map(scene => ({
    category: "Custom",
    favorite: false,
    ...scene
  }));
merged.cameraLayouts = merged.cameraLayouts.map(layout => ({
    category: "Custom",
    favorite: false,
    ...layout
  }));
  if (!Array.isArray(merged.runOfService)) merged.runOfService = fresh.runOfService;
  merged.live = { ...fresh.live, ...(state.live || {}) };
  if (!merged.live.cueStartedAt) merged.live.cueStartedAt = Date.now();
  if (!Array.isArray(merged.live.activityLog)) merged.live.activityLog = [];
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

function addActivity(state, message) {
  state.live.activityLog = [{ at: Date.now(), message }, ...(state.live.activityLog || [])].slice(0, 8);
}

function applyLook(state, lookId) {
  const look = state.productionLooks.find(x => x.id === lookId);
  if (!look) return state;
  const layout = state.cameraLayouts.find(x => x.id === look.cameraLayoutId);
  if (layout) {
    state.live.programCamera = layout.programCamera;
    state.live.previewCamera = layout.previewCamera;
    state.live.programPreset = layout.programPreset;
    state.live.previewPreset = layout.previewPreset;
  }
  state.live.lastLightingSceneId = look.lightingSceneId;
  state.live.lightingOverrideId = null;
  return state;
}

app.whenReady().then(() => {
  const engine = new ProductionEngine({
    initialState: loadState(),
    persistState: state => saveState(state)
  });
  engine.registerAdapter("camera", new SimulationCameraController());
  engine.registerAdapter("videoSwitcher", new SimulationSwitcherController());
  engine.registerAdapter("lighting", new SimulationLightingController());

  ipcMain.handle("state:get", () => engine.getSnapshot());
  ipcMain.handle("state:save", (_e, state) => engine.replaceSnapshot(migrate(state)));
  ipcMain.handle("cue:addTemplate", async (_e, templateId) => {
    const state = engine.getSnapshot();
    const template = state.cueTemplates.find(item => item.id === templateId);
    if (!template) return state;
    state.runOfService.push({
      id: uid("cue"),
      name: template.name,
      duration: template.duration,
      notes: template.notes,
      productionLookId: template.productionLookId
    });
    return engine.replaceSnapshot(state, "AddCueTemplate");
  });
  ipcMain.handle("cue:move", async (_e, { from, to }) => {
    const state = engine.getSnapshot();
    if (from < 0 || to < 0 || from >= state.runOfService.length || to >= state.runOfService.length || from === to) return state;
    const currentCueId = state.runOfService[state.live.cueIndex]?.id;
    const [item] = state.runOfService.splice(from, 1);
    state.runOfService.splice(to, 0, item);
    const currentIndex = state.runOfService.findIndex(cue => cue.id === currentCueId);
    if (currentIndex >= 0) state.live.cueIndex = currentIndex;
    return engine.replaceSnapshot(state, "MoveCue");
  });
  ipcMain.handle("cue:remove", async (_e, index) => {
    const state = engine.getSnapshot();
    state.runOfService.splice(index, 1);
    state.live.cueIndex = Math.min(state.live.cueIndex, Math.max(0, state.runOfService.length - 1));
    return engine.replaceSnapshot(state, "RemoveCue");
  });
  ipcMain.handle("live:go", (_e, index) => engine.dispatch({ type: "ActivateCue", payload: { index } }));
  ipcMain.handle("live:next", () => engine.dispatch({ type: "NextCue" }));
  ipcMain.handle("live:back", () => engine.dispatch({ type: "PreviousCue" }));
  ipcMain.handle("live:setHold", (_e, hold) => engine.dispatch({ type: "SetHold", payload: { hold } }));
  ipcMain.handle("live:hold", () => {
    const hold = !engine.getSnapshot().live.hold;
    return engine.dispatch({ type: "SetHold", payload: { hold } });
  });
  ipcMain.handle("camera:take", (_e, payload) => engine.dispatch({ type: "TakeCamera", payload }));
  ipcMain.handle("lighting:override", (_e, sceneId) => engine.dispatch({ type: "SetLightingOverride", payload: { sceneId } }));
  ipcMain.handle("lighting:returnToCue", () => engine.dispatch({ type: "ReleaseLightingOverride" }));

  const win = new BrowserWindow({
    width: 1366, height: 900, minWidth: 1024, minHeight: 700,
    backgroundColor: "#081018", title: "Trinity Control",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false }
  });
  engine.subscribe(ENGINE_EVENTS.STATE_CHANGED, event => {
    if (!win.isDestroyed()) win.webContents.send("production:state-changed", event);
  });
  engine.subscribe(ENGINE_EVENTS.ACTIVITY, event => {
    if (!win.isDestroyed()) win.webContents.send("production:activity", event);
  });
  engine.subscribe(ENGINE_EVENTS.ERROR, event => {
    if (!win.isDestroyed()) win.webContents.send("production:error", event);
  });
  win.loadFile(path.join(__dirname, "public", "index.html"));
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
