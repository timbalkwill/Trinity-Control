const { app, BrowserWindow, dialog, ipcMain, Menu } = require("electron");
const { createHomeAssistantController } = require("./home-assistant-operations.cjs");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { createOperatorCommands } = require("./operator-commands.cjs");
const { normalizeExecutionSnapshot } = require("./cue-execution.cjs");
const { DEFAULT_PORT, createOperatorServer } = require("./operator-server.cjs");
const { normalizeProductionLooks } = require("./production-look-operations.cjs");
const { CAMERA_MANAGER_SCHEMA_VERSION } = require("./camera-manager-operations.cjs");
const { CAMERA_PRESET_SCHEMA_VERSION, hasDuplicateCameraPresetIds, migrateDuplicateCameraPresetIds, migrateLegacyPresets } = require("./camera-preset-operations.cjs");
const { SHOT_SCHEMA_VERSION, defaultShots, migrateShots } = require("./shot-operations.cjs");
const { CAMERA_PREPARATION_SCHEMA_VERSION, migrateCameraPreparations } = require("./camera-preparation-operations.cjs");
const { migrateLightingScenes } = require("./lighting-scene-operations.cjs");
const { migrateLiveState } = require("./live-operations.cjs");
const { createQlcLauncher, createQlcServiceManager, normalizeQlcServiceSettings } = require("./qlcplus-service-manager.cjs");
const {
  defaultCameras,
  defaultPlaceholders,
  normalizeDeviceCollection
} = require("./device-operations.cjs");
const { createApplicationMenuTemplate } = require("./application-menu.cjs");
const { buildSystemStatus, readGitMetadata } = require("./system-status.cjs");
const { createAtemService } = require("./atem-service.cjs");
const { atomicWrite, createBackupManager, defaultBackupFilename } = require("./backup-operations.cjs");
const { completeSetup, normalizeSetup, setupReadiness } = require("./onboarding-operations.cjs");

const existingUserDataPath = path.join(app.getPath("appData"), "Trinity Control Refresh");
app.setName("Trinity Control");
app.setPath("userData", existingUserDataPath);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow;
let operatorServer;
let qlcServiceManager;
let atemService;
let selectedBackupImportPath = null;
let qlcServiceStatus = { state: "disabled", message: "Automatic QLC+ management is disabled" };
let operatorServerStatus = {
  running: false,
  port: DEFAULT_PORT,
  localUrl: `http://localhost:${DEFAULT_PORT}`,
  networkUrls: []
};

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function dataPath() { return path.join(app.getPath("userData"), "trinity-data.json"); }
function defaultState() {
  return {
    version: "1.0.2-alpha.5.2-refined",
    schemaVersion: 7,
    deviceSchemaVersion: 1,
    cameraManagerSchemaVersion: CAMERA_MANAGER_SCHEMA_VERSION,
    cameraPresetSchemaVersion: CAMERA_PRESET_SCHEMA_VERSION,
    shotSchemaVersion: SHOT_SCHEMA_VERSION,
    cameraPreparationSchemaVersion: CAMERA_PREPARATION_SCHEMA_VERSION,
    settings: {
      qlcplusService: normalizeQlcServiceSettings()
    },
    setup: normalizeSetup(),
    cameras: [
      { id: "main", name: "Main Camera", role: "main", online: true, enabled: true },
      { id: "left", name: "Left Camera", role: "left", online: true, enabled: true },
      { id: "right", name: "Right Camera", role: "right", online: true, enabled: true }
    ],
    devices: [...defaultCameras(), ...defaultPlaceholders()],
    cameraPresets: [],
    shots: defaultShots(),
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
      lastLightingSceneId: null,
      cueStartedAt: Date.now(),
      serviceStartedAt: Date.now(),
      activityLog: []
    }
  };
}

function migrate(state) {
  const fresh = defaultState();
  const merged = { ...fresh, ...state, version: fresh.version, schemaVersion: fresh.schemaVersion };
  merged.settings = {
    ...(state?.settings || {}),
    qlcplusService: normalizeQlcServiceSettings(state?.settings?.qlcplusService)
  };
  merged.setup = normalizeSetup(state?.setup, {
    legacy: !Object.prototype.hasOwnProperty.call(state || {}, "setup")
  });
  for (const key of ["lightingScenes", "cameraLayouts", "cueTemplates"]) {
    if (!Array.isArray(merged[key]) || !merged[key].length) {
      merged[key] = fresh[key];
    } else {
      const existing = new Set(merged[key].map(item => item.id));
      merged[key] = [...merged[key], ...fresh[key].filter(item => !existing.has(item.id))];
    }
  }
  merged.devices = normalizeDeviceCollection(state.devices, { legacyCameras: merged.cameras });
  merged.deviceSchemaVersion = 1;
  merged.cameraPresets = migrateLegacyPresets({ ...merged, cameraPresets: state.cameraPresets });
  merged.shots = migrateShots(state.shots);
  const savedLooks = Object.prototype.hasOwnProperty.call(state, "productionLooks") && Array.isArray(state.productionLooks);
  merged.productionLooks = normalizeProductionLooks(savedLooks ? state.productionLooks : fresh.productionLooks, { state: merged });
  merged.cameraManagerSchemaVersion = CAMERA_MANAGER_SCHEMA_VERSION;
  merged.cameraPresetSchemaVersion = CAMERA_PRESET_SCHEMA_VERSION;
  merged.shotSchemaVersion = SHOT_SCHEMA_VERSION;
    merged.lightingScenes = migrateLightingScenes(merged.lightingScenes.map(scene => ({
    category: "Custom",
    favorite: false,
    ...scene
  })));
merged.cameraLayouts = merged.cameraLayouts.map(layout => ({
    category: "Custom",
    favorite: false,
    ...layout
  }));
  if (!Array.isArray(merged.runOfService)) merged.runOfService = fresh.runOfService;
  merged.live = migrateLiveState({ ...fresh.live, ...(state.live || {}) });
  if (state.live?.executionSnapshot) merged.live.executionSnapshot = normalizeExecutionSnapshot(state.live.executionSnapshot);
  if (!merged.live.cueStartedAt) merged.live.cueStartedAt = Date.now();
  if (!state.live?.serviceStartedAt) merged.live.serviceStartedAt = merged.live.cueStartedAt;
  if (!Array.isArray(merged.live.activityLog)) merged.live.activityLog = [];
  migrateCameraPreparations(merged);
  merged.runOfService = merged.runOfService.map((cue, i) => ({
    productionLookId: fresh.productionLooks[Math.min(i, fresh.productionLooks.length - 1)]?.id || "look-sermon",
    ...cue
  }));
  return migrateDuplicateCameraPresetIds(merged);
}

function loadState() {
  let serialized;
  let parsed;
  try {
    serialized = fs.readFileSync(dataPath(), "utf8");
    parsed = JSON.parse(serialized);
  } catch {
    const state = migrate(defaultState());
    saveState(state);
    return state;
  }
  const needsPresetIdMigration = hasDuplicateCameraPresetIds(parsed);
  const needsSetupMigration = !Object.prototype.hasOwnProperty.call(parsed, "setup");
  let migrated;
  try { migrated = migrate(parsed); }
  catch (error) {
    if (error?.code === "CAMERA_PRESET_MIGRATION_AMBIGUOUS") throw error;
    const state = migrate(defaultState());
    saveState(state);
    return state;
  }
  if (needsPresetIdMigration) {
    const recoveryDirectory = path.join(app.getPath("userData"), "Trinity Recovery Backups");
    const timestamp = new Date().toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
    atomicWrite(path.join(recoveryDirectory, `trinity-data-before-preset-id-migration-${timestamp}.json`), serialized);
  }
  if (needsPresetIdMigration || needsSetupMigration) saveState(migrated);
  return migrated;
}
function saveState(state) { atomicWrite(dataPath(), `${JSON.stringify(state, null, 2)}\n`); return state; }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366, height: 900, minWidth: 1024, minHeight: 700,
    backgroundColor: "#081018", title: "Trinity Control",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, "public", "index.html"));
}

function sendApplicationCommand(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function installApplicationMenu() {
  const template = createApplicationMenuTemplate({
    isMac: process.platform === "darwin",
    isDevelopment: !app.isPackaged,
    navigate: page => sendApplicationCommand("app:navigate", page),
    showAbout: () => sendApplicationCommand("app:show-about"),
    showKeyboardShortcuts: () => sendApplicationCommand("app:show-keyboard-shortcuts"),
    showSystemStatus: () => sendApplicationCommand("app:navigate", "settings"),
    closeWindow: () => mainWindow?.close()
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  const commands = createOperatorCommands({ loadState, saveState, normalizeState: migrate });
  const backupManager = createBackupManager({
    getState: commands.getState,
    replaceState: commands.replaceState,
    normalizeState: migrate,
    trinityVersion: app.getVersion(),
    userDataPath: app.getPath("userData")
  });
  atemService = createAtemService({ getState: commands.getState, logger: console });
  const homeAssistant = createHomeAssistantController({ app, projectDirectory: __dirname });
  commands.subscribe(state => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("operator:state-changed", state);
    }
  });
  ipcMain.handle("state:get", () => commands.getState());
  ipcMain.handle("app:info", () => ({
    name: "Trinity Control",
    version: app.getVersion(),
    buildVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    isPackaged: app.isPackaged
  }));
  ipcMain.handle("system:status", () => {
    const packageStats = fs.statSync(path.join(__dirname, "package.json"));
    const git = readGitMetadata(__dirname);
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const activeResources = typeof process.getActiveResourcesInfo === "function" ? process.getActiveResourcesInfo() : [];
    return buildSystemStatus({
      state: commands.getState(),
      qlcStatus: qlcServiceStatus,
      atemStatus: atemService.getStatus(),
      operatorStatus: operatorServerStatus,
      appInfo: {
        name: "Trinity Control",
        version: app.getVersion(),
        buildConfiguration: app.isPackaged ? "Packaged" : "Source",
        buildDate: process.env.TRINITY_BUILD_DATE || process.env.BUILD_DATE || packageStats.mtime.toISOString(),
        commit: git.commit,
        branch: git.branch,
        environment: app.isPackaged ? (/[-.]rc/i.test(app.getVersion()) ? "Release Candidate" : "Production") : "Development",
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        chromeVersion: process.versions.chrome,
        operatingSystem: process.platform,
        architecture: process.arch
      },
      processInfo: {
        memoryBytes: memory.rss,
        cpuUserMicroseconds: cpu.user,
        cpuSystemMicroseconds: cpu.system,
        uptimeSeconds: process.uptime(),
        activeTimers: activeResources.filter(resource => resource === "Timeout").length
      },
      storage: {
        userData: app.getPath("userData"),
        configuration: dataPath(),
        servicePlans: app.getPath("userData"),
        logs: app.getPath("logs")
      },
      localSettings: {
        qlcApplicationConfigured: Boolean(commands.getState().settings?.qlcplusService?.applicationPath),
        qlcWorkspaceConfigured: Boolean(commands.getState().settings?.qlcplusService?.workspacePath)
      }
    });
  });
  ipcMain.handle("state:save", (_e, s) => commands.replaceState(s));
  ipcMain.handle("backup:export", async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export Trinity Backup",
      defaultPath: path.join(app.getPath("documents"), defaultBackupFilename()),
      filters: [{ name: "Trinity Backup", extensions: ["trinitybackup"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = result.filePath.toLowerCase().endsWith(".trinitybackup") ? result.filePath : `${result.filePath}.trinitybackup`;
    const exported = backupManager.exportTo(filePath);
    return { canceled: false, preview: exported.preview };
  });
  ipcMain.handle("backup:select-import", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select Trinity Backup",
      properties: ["openFile"],
      filters: [{ name: "Trinity Backup", extensions: ["trinitybackup"] }, { name: "All Files", extensions: ["*"] }]
    });
    if (result.canceled || !result.filePaths[0]) {
      selectedBackupImportPath = null;
      return { canceled: true };
    }
    const filePath = result.filePaths[0];
    const preview = backupManager.previewFile(filePath);
    selectedBackupImportPath = filePath;
    return { canceled: false, preview };
  });
  ipcMain.handle("backup:cancel-import", () => { selectedBackupImportPath = null; return true; });
  ipcMain.handle("backup:confirm-import", async () => {
    if (!selectedBackupImportPath) throw Object.assign(new Error("Select a Trinity backup before importing"), { code: "BACKUP_NOT_SELECTED" });
    const filePath = selectedBackupImportPath;
    selectedBackupImportPath = null;
    const imported = await backupManager.importFile(filePath);
    return { state: imported.state, preview: imported.preview, restartRequired: imported.restartRequired };
  });
  const setupContext = () => {
    const current = commands.getState();
    const qlcSettings = current.settings?.qlcplusService || {};
    const homeAssistantConfiguration = homeAssistant.getConfiguration();
    return {
      platform: process.platform,
      hostLabel: process.platform === "win32" ? "Windows production host" : process.platform === "darwin" ? "macOS host" : `${process.platform} host`,
      version: app.getVersion(),
      computerName: os.hostname(),
      dataLocation: app.getPath("userData"),
      operator: operatorServerStatus,
      qlcplus: {
        settings: qlcSettings,
        status: qlcServiceStatus,
        applicationPathValid: Boolean(qlcSettings.applicationPath && fs.existsSync(qlcSettings.applicationPath)),
        workspacePathValid: Boolean(qlcSettings.workspacePath && fs.existsSync(qlcSettings.workspacePath))
      },
      atem: atemService.getStatus(),
      cameras: (current.devices || []).filter(device => device.type === "camera" && ["main", "left", "right"].includes(device.logicalRole || device.id)),
      homeAssistant: homeAssistantConfiguration,
      readiness: setupReadiness({
        state: current,
        operatorStatus: operatorServerStatus,
        qlcStatus: qlcServiceStatus,
        atemStatus: atemService.getStatus(),
        homeAssistant: homeAssistantConfiguration
      })
    };
  };
  ipcMain.handle("setup:context", setupContext);
  ipcMain.handle("setup:finish", (_event, options) => commands.updateState(state => {
    completeSetup(state, { skippedSystems: options?.skippedSystems });
  }));
  ipcMain.handle("setup:update-device", (_event, { deviceId, patch }) => {
    const current = commands.getState();
    const device = (current.devices || []).find(item => item.id === deviceId);
    if (!device || !["camera", "switcher"].includes(device.type)) throw new RangeError("Setup device not found");
    const allowed = device.type === "camera"
      ? ["name", "enabled", "adapterType", "protocol", "ipAddress", "port", "viscaAddress"]
      : ["name", "enabled", "ipAddress", "metadata"];
    const safePatch = Object.fromEntries(Object.entries(patch || {}).filter(([key]) => allowed.includes(key)));
    return commands.updateDevice(deviceId, safePatch);
  });
  ipcMain.handle("home-assistant:configuration", () => homeAssistant.getConfiguration());
  ipcMain.handle("home-assistant:update-configuration", (_event, patch) => homeAssistant.saveConfiguration(patch));
  ipcMain.handle("operator-server:status", () => operatorServerStatus);
  ipcMain.handle("qlc-service:status", () => qlcServiceStatus);
  ipcMain.handle("qlc-service:update-settings", (_e, patch) => commands.updateState(state => {
    state.settings = {
      ...(state.settings || {}),
      qlcplusService: normalizeQlcServiceSettings({
        ...state.settings?.qlcplusService,
        ...(patch || {})
      })
    };
  }));
  ipcMain.handle("qlc-service:browse-application", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose QLC+ Application",
      properties: process.platform === "darwin" ? ["openFile", "openDirectory"] : ["openFile"],
      ...(process.platform === "win32" ? { filters: [{ name: "QLC+ Application", extensions: ["exe"] }] } : {})
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle("qlc-service:browse-workspace", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose QLC+ Workspace",
      properties: ["openFile"],
      filters: [{ name: "QLC+ Workspace", extensions: ["qxw"] }, { name: "All Files", extensions: ["*"] }]
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle("cue:addTemplate", (_e, templateId) => {
    const template = commands.getState().cueTemplates.find(item => item.id === templateId);
    if (!template) throw new RangeError("Cue template not found");
    return commands.createCue(template);
  });
  ipcMain.handle("cue:move", (_e, { from, to }) => commands.reorderCue(from, to));
  ipcMain.handle("cue:move-by-id", (_e, { cueId, targetCueId, placement }) => commands.reorderCueById(cueId, targetCueId, placement));
  ipcMain.handle("cue:nudge-by-id", (_e, { cueId, direction }) => commands.moveCueById(cueId, direction));
  ipcMain.handle("cue:duplicate", (_e, index) => commands.duplicateCue(index));
  ipcMain.handle("cue:create", (_e, input) => commands.createCue(input));
  ipcMain.handle("cue:insert", (_e, { index, position }) => commands.insertCue(index, position));
  ipcMain.handle("cue:remove", (_e, { index, options }) => commands.deleteCue(index, options));
  ipcMain.handle("cue:remove-by-id", (_e, { cueId, options }) => commands.deleteCueById(cueId, options));
  ipcMain.handle("cue:update", (_e, { index, patch }) => commands.updateCue(index, patch));
  ipcMain.handle("look:create", (_e, input) => commands.createProductionLook(input));
  ipcMain.handle("look:update", (_e, { lookId, patch }) => commands.updateProductionLook(lookId, patch));
  ipcMain.handle("look:duplicate", (_e, lookId) => commands.duplicateProductionLook(lookId));
  ipcMain.handle("look:delete", (_e, { lookId, options }) => commands.deleteProductionLook(lookId, options));
  ipcMain.handle("device:create", (_e, input) => commands.createDevice(input));
  ipcMain.handle("device:update", async (_e, { deviceId, patch }) => {
    const state = await commands.updateDevice(deviceId, patch);
    if ((state.devices || []).find(device => device.id === deviceId)?.type === "switcher") await atemService.reconfigure();
    return state;
  });
  ipcMain.handle("device:duplicate", (_e, deviceId) => commands.duplicateDevice(deviceId));
  ipcMain.handle("device:delete", (_e, { deviceId, options }) => commands.deleteDevice(deviceId, options));
  ipcMain.handle("device:reorder", (_e, { from, to }) => commands.reorderDevice(from, to));
  ipcMain.handle("device:test", (_e, deviceId) => commands.testDevice(deviceId));
  ipcMain.handle("device:testAll", () => commands.testAllDevices());
  ipcMain.handle("lighting-adapter:test", (_e, deviceId) => commands.testLightingConnection(deviceId));
  ipcMain.handle("lighting-adapter:discover", (_e, deviceId) => commands.discoverLightingControls(deviceId));
  ipcMain.handle("lighting-scene:execute", (_e, sceneId) => commands.executeLightingScene(sceneId));
  ipcMain.handle("lighting-scene:update", (_e, { sceneId, patch }) => commands.updateLightingScene(sceneId, patch));
  ipcMain.handle("lighting-scene:duplicate", (_e, sceneId) => commands.duplicateLightingScene(sceneId));
  ipcMain.handle("device:clearDiagnostic", (_e, deviceId) => commands.clearDeviceDiagnostic(deviceId));
  ipcMain.handle("camera-preset:create", (_e, input) => commands.createCameraPreset(input));
  ipcMain.handle("camera-preset:update", (_e, { presetId, patch }) => commands.updateCameraPreset(presetId, patch));
  ipcMain.handle("camera-preset:duplicate", (_e, presetId) => commands.duplicateCameraPreset(presetId));
  ipcMain.handle("camera-preset:delete", (_e, { presetId, options }) => commands.deleteCameraPreset(presetId, options));
  ipcMain.handle("camera-preset:reorder", (_e, { cameraDeviceId, from, to }) => commands.reorderCameraPreset(cameraDeviceId, from, to));
  ipcMain.handle("shot:create", (_e, input) => commands.createShot(input));
  ipcMain.handle("shot:update", (_e, { shotId, patch }) => commands.updateShot(shotId, patch));
  ipcMain.handle("shot:duplicate", (_e, shotId) => commands.duplicateShot(shotId));
  ipcMain.handle("shot:delete", (_e, { shotId, options }) => commands.deleteShot(shotId, options));
  ipcMain.handle("shot:reorder", (_e, { from, to }) => commands.reorderShot(from, to));
  ipcMain.handle("live:go", (_e, { index, options }) => commands.goCue(index, options));
  ipcMain.handle("live:next", () => commands.nextCue());
  ipcMain.handle("live:back", () => commands.previousCue());
  ipcMain.handle("live:take", () => commands.takeLive());
  ipcMain.handle("live:cameraMode", (_e, { cameraId, mode }) => commands.setCameraMode(cameraId, mode));
  ipcMain.handle("live:prepareCamera", (_e, { cameraId, selectionId }) => commands.prepareCamera(cameraId, selectionId));
  ipcMain.handle("live:recallCameraPreset", (_e, { cameraId, presetId }) => commands.recallCameraPreset(cameraId, presetId));
  ipcMain.handle("live:runCameraMotion", (_e, { cameraId, shotId }) => commands.runCameraMotion(cameraId, shotId));
  ipcMain.handle("live:cameraTracking", (_e, { cameraId, active }) => commands.setCameraTracking(cameraId, active));
  ipcMain.handle("live:makeCameraLive", (_e, cameraId) => commands.makeCameraLive(cameraId));
  ipcMain.handle("live:hold", () => commands.toggleHold());
  ipcMain.handle("atem:status", () => atemService.getStatus());
  ipcMain.handle("atem:take-live", (_e, cameraDeviceId) => atemService.takeLive(cameraDeviceId));
  ipcMain.handle("home-assistant:status", () => homeAssistant.getStatus());
  ipcMain.handle("home-assistant:lighting-on", () => homeAssistant.turnOn());
  ipcMain.handle("home-assistant:lighting-off", () => homeAssistant.turnOff());

  const serviceContext = () => {
    const state = commands.getState();
    return {
      settings: state.settings?.qlcplusService,
      device: (state.devices || []).find(device => device.type === "lighting"),
      lightingScenes: state.lightingScenes || []
    };
  };
  qlcServiceManager = createQlcServiceManager({
    getContext: serviceContext,
    discover: async device => {
      if (!device) return { ok: false, code: "configurationIncomplete", message: "Lighting device is not configured" };
      const state = await commands.discoverLightingControls(device.id);
      const updated = (state.devices || []).find(item => item.id === device.id);
      return updated?.metadata?.lightingDiagnostic || { ok: false, message: "QLC+ discovery failed" };
    },
    launch: createQlcLauncher({ logger: console }),
    logger: console,
    onStatus: status => {
      qlcServiceStatus = status;
      if (["stopped", "degraded", "restarting", "failed"].includes(status.state)) {
        commands.resetLightingActiveState(`service-${status.state}`);
      }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("qlc-service:status-changed", status);
    }
  });
  ipcMain.handle("qlc-service:start", () => qlcServiceManager.start());
  ipcMain.handle("qlc-service:restart", () => qlcServiceManager.restart());
  ipcMain.handle("qlc-service:refresh", () => qlcServiceManager.refresh());
  ipcMain.handle("qlc-service:set-enabled", async (_event, enabled) => {
    const current = commands.getState();
    const lightingDevice = (current.devices || []).find(device =>
      device.type === "lighting" && device.adapterType === "qlcplus-websocket"
    );
    if (!lightingDevice) throw new RangeError("QLC+ lighting device is not configured");
    await commands.updateDevice(lightingDevice.id, { enabled: enabled === true });
    if (enabled === true) await qlcServiceManager.enable();
    else qlcServiceManager.disable();
    return commands.getState();
  });

  createWindow();
  installApplicationMenu();
  atemService.subscribe(status => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("atem:status-changed", status);
  });
  void atemService.initialize();
  void qlcServiceManager.initialize().then(() => qlcServiceManager.scheduleMonitor());
  operatorServer = createOperatorServer({
    commands,
    assetsDirectory: path.join(__dirname, "public"),
    getAtemStatus: () => atemService?.getStatus(),
    subscribeAtemStatus: subscriber => atemService?.subscribe(subscriber) || (() => {}),
    takeCameraLive: cameraDeviceId => atemService.takeLive(cameraDeviceId)
  });
  try {
    operatorServerStatus = await operatorServer.start();
  } catch (error) {
    operatorServerStatus = { ...operatorServerStatus, error: error.message };
    console.error(`[Trinity Operator] Server failed to start on port ${DEFAULT_PORT}: ${error.message}`);
  }
});
app.on("activate", () => { if (!mainWindow) createWindow(); });
app.on("before-quit", event => {
  qlcServiceManager?.shutdown();
  if (!operatorServer && !atemService) return;
  event.preventDefault();
  const server = operatorServer;
  const switcher = atemService;
  operatorServer = null;
  atemService = null;
  Promise.all([
    server?.close().catch(error => console.error(`[Trinity Operator] Server failed to close cleanly: ${error.message}`)),
    switcher?.shutdown()
  ])
    .finally(() => app.quit());
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
