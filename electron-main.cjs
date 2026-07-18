const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;

function dataPath() {
  return path.join(app.getPath("userData"), "trinity-data.json");
}

function defaultState() {
  const cameras = [
    { id: "main", name: "Main PTZ", online: true },
    { id: "left", name: "Left PTZ", online: true },
    { id: "right", name: "Right PTZ", online: true }
  ];

  const presetNames = [
    "Stage Wide",
    "Stage Medium",
    "Pulpit Tight",
    "Pulpit Wide",
    "Stage Left",
    "Stage Right",
    "Baptistry",
    "Communion",
    "Congregation Wide",
    "Congregation Center"
  ];

  return {
    version: "0.6.0-alpha",
    cameras,
    presetNames,
    presets: Object.fromEntries(
      cameras.map((camera) => [
        camera.id,
        presetNames.map((name, index) => ({
          number: index + 1,
          name,
          saved: true
        }))
      ])
    ),
    runOfService: [
      { id: "welcome", name: "Welcome", duration: 300, notes: "Opening welcome" },
      { id: "worship", name: "Worship", duration: 1200, notes: "Congregational singing" },
      { id: "sermon", name: "Sermon", duration: 2100, notes: "Main preaching cue" },
      { id: "invitation", name: "Invitation", duration: 600, notes: "Invitation lighting and camera shot" }
    ],
    live: {
      programCamera: "main",
      previewCamera: "left",
      cueIndex: 0,
      hold: false
    }
  };
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(dataPath(), "utf8"));
  } catch {
    const state = defaultState();
    fs.writeFileSync(dataPath(), JSON.stringify(state, null, 2));
    return state;
  }
}

function saveState(state) {
  fs.writeFileSync(dataPath(), JSON.stringify(state, null, 2));
  return state;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: "#0a0f14",
    title: "Trinity Control",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "public", "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("state:get", () => loadState());

  ipcMain.handle("state:save", (_event, nextState) => saveState(nextState));

  ipcMain.handle("camera:select", (_event, { cameraId, target }) => {
    const state = loadState();
    if (target === "program") state.live.programCamera = cameraId;
    else state.live.previewCamera = cameraId;
    return saveState(state);
  });

  ipcMain.handle("cue:add", (_event, cue) => {
    const state = loadState();
    state.runOfService.push({
      id: `cue-${Date.now()}`,
      name: cue.name || "New Cue",
      duration: Number(cue.duration) || 300,
      notes: cue.notes || ""
    });
    return saveState(state);
  });

  ipcMain.handle("live:next", () => {
    const state = loadState();
    state.live.cueIndex = Math.min(
      state.runOfService.length - 1,
      state.live.cueIndex + 1
    );
    return saveState(state);
  });

  ipcMain.handle("live:back", () => {
    const state = loadState();
    state.live.cueIndex = Math.max(0, state.live.cueIndex - 1);
    return saveState(state);
  });

  ipcMain.handle("live:toggleHold", () => {
    const state = loadState();
    state.live.hold = !state.live.hold;
    return saveState(state);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
