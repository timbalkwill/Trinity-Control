const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { completeSetup, normalizeSetup, setupReadiness } = require("../onboarding-operations.cjs");
const { createHomeAssistantController } = require("../home-assistant-operations.cjs");
const { createBackupEnvelope, mergePortableState } = require("../backup-operations.cjs");

const root = path.join(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");

function stateFixture() {
  return {
    setup: normalizeSetup(),
    settings: { qlcplusService: { applicationPath: "", workspacePath: "" } },
    devices: [
      { id: "main", type: "camera", logicalRole: "main", name: "Main Camera", enabled: true, adapterType: "visca-udp", ipAddress: "10.0.0.10", connectionStatus: "notTested" },
      { id: "left", type: "camera", logicalRole: "left", name: "Left Camera", enabled: false },
      { id: "right", type: "camera", logicalRole: "right", name: "Right Camera", enabled: false },
      { id: "device-atem", type: "switcher", name: "ATEM", enabled: true, ipAddress: "10.0.0.20", metadata: { adapter: "atem", atemCameraInputs: { main: 1 } } }
    ],
    cameraPresets: [{ id: "main-wide", cameraDeviceId: "main" }],
    runOfService: [{ id: "cue-1", name: "Welcome" }]
  };
}

test("fresh setup is incomplete while a legacy persisted installation migrates completed", () => {
  assert.equal(normalizeSetup().completed, false);
  assert.equal(normalizeSetup(undefined, { legacy: true }).completed, true);
  const main = source("electron-main.cjs");
  const renderer = source("public/app.js");
  assert.match(main, /setup: normalizeSetup\(\)/);
  assert.match(main, /legacy: !Object\.prototype\.hasOwnProperty\.call\(state \|\| \{\}, "setup"\)/);
  assert.match(renderer, /setupWizardOpen = state\.setup\?\.completed !== true/);
});

test("completion persists skipped optional systems without changing production state", () => {
  const state = stateFixture();
  const before = structuredClone(state);
  completeSetup(state, { skippedSystems: ["qlcplus", "atem", "unknown"], now: () => 1000 });
  assert.equal(state.setup.completed, true);
  assert.deepEqual(state.setup.skippedSystems, ["qlcplus", "atem"]);
  assert.deepEqual({ ...state, setup: before.setup }, before);
});

test("readiness uses authoritative status and keeps hardware systems optional", () => {
  const readiness = setupReadiness({
    state: stateFixture(),
    operatorStatus: { running: true },
    qlcStatus: { connectionState: "disconnected" },
    atemStatus: { configured: true, connectionState: "disconnected" },
    homeAssistant: { configured: false, reachable: false }
  });
  assert.equal(readiness.find(item => item.id === "host").classification, "required");
  assert.equal(readiness.find(item => item.id === "browserOperator").state, "ready");
  assert.equal(readiness.find(item => item.id === "atem").detail, "Configured, not tested");
  assert.equal(readiness.find(item => item.id === "left").state, "not-configured");
  for (const id of ["qlcplus", "atem", "main", "left", "right", "homeAssistant"]) {
    assert.equal(readiness.find(item => item.id === id).classification, "optional");
  }
});

test("wizard import reuses Backup & Transfer and retains destination-local review items", () => {
  const current = stateFixture();
  current.settings.qlcplusService = { applicationPath: "C:\\Program Files\\QLC+\\qlcplus.exe", workspacePath: "C:\\Trinity Files\\Sunday.qxw", manageAutomatically: true };
  current.devices[0].credentialReference = "destination-secret";
  const portable = createBackupEnvelope(stateFixture(), { trinityVersion: "1.0.0", now: () => 0 });
  const imported = mergePortableState(current, portable.data);
  assert.equal(imported.settings.qlcplusService.applicationPath, current.settings.qlcplusService.applicationPath);
  assert.equal(imported.settings.qlcplusService.workspacePath, current.settings.qlcplusService.workspacePath);
  assert.equal(imported.settings.qlcplusService.manageAutomatically, false);
  assert.equal(imported.devices[0].credentialReference, "destination-secret");
  assert.equal(portable.security.credentialsIncluded, false);

  const renderer = source("public/app.js");
  assert.match(renderer, /async function selectBackupForImport/);
  assert.match(renderer, /async function confirmSelectedBackupImport/);
  assert.match(renderer, /setup-import.*selectBackupForImport/s);
  assert.match(renderer, /setup-import-confirm.*confirmSelectedBackupImport/s);
});

test("Home Assistant setup saves locally without network access and never returns the token", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "trinity-setup-ha-"));
  const app = { getPath: name => name === "userData" ? directory : directory };
  let fetchCalls = 0;
  const controller = createHomeAssistantController({
    app,
    projectDirectory: directory,
    env: {},
    fetchImpl: async () => { fetchCalls += 1; throw new Error("Network must not be contacted"); }
  });
  const result = controller.saveConfiguration({
    baseUrl: "http://homeassistant.local:8123/",
    token: "private-token",
    entities: "switch.one\nswitch.two"
  });
  assert.equal(fetchCalls, 0);
  assert.equal(result.baseUrl, "http://homeassistant.local:8123");
  assert.equal(result.tokenConfigured, true);
  assert.equal(Object.hasOwn(result, "token"), false);
  assert.deepEqual(result.entities, ["switch.one", "switch.two"]);
  const saved = JSON.parse(fs.readFileSync(path.join(directory, "home-assistant.config.json"), "utf8"));
  assert.equal(saved.token, "private-token");
});

test("QLC+ setup uses platform-aware executable and workspace pickers", () => {
  const main = source("electron-main.cjs");
  assert.match(main, /process\.platform === "win32".*extensions: \["exe"\]/s);
  assert.match(main, /process\.platform === "darwin" \? \["openFile", "openDirectory"\]/);
  assert.match(main, /name: "QLC\+ Workspace", extensions: \["qxw"\]/);
  assert.match(source("public/app.js"), /updateQlcServiceSettings\(\{ applicationPath: selected \}\)/);
});

test("wizard device saves and finish expose no production execution path", () => {
  const main = source("electron-main.cjs");
  const preload = source("preload.cjs");
  const renderer = source("public/app.js");
  const mainSetup = main.slice(main.indexOf('const setupContext ='), main.indexOf('ipcMain.handle("operator-server:status"'));
  const rendererSetup = renderer.slice(renderer.indexOf("function setupWizardPage"), renderer.indexOf("function formatDiagnosticDate"));

  assert.match(mainSetup, /setup:update-device/);
  assert.match(mainSetup, /commands\.updateDevice/);
  assert.doesNotMatch(mainSetup, /atemService\.reconfigure|takeLive|goCue|nextCue|previousCue|executeLightingScene|recallCameraPreset|runCameraMotion/);
  assert.doesNotMatch(rendererSetup, /window\.trinity\.(goCue|nextCue|previousCue|takeCameraLive|executeLightingScene|recallCameraPreset|runCameraMotion)/);
  assert.match(preload, /finishSetup: options => ipcRenderer\.invoke\("setup:finish", options\)/);
  assert.match(renderer, /\['runSetup', 'Run Setup Wizard'\]/);
  assert.match(renderer, /document\.addEventListener\('keydown',[\s\S]*?if \(setupWizardOpen\) return;/);
});

test("wizard includes Windows, macOS, firewall, iPad, and non-secure LAN guidance", () => {
  const main = source("electron-main.cjs");
  const renderer = source("public/app.js");
  assert.match(main, /Windows production host/);
  assert.match(main, /macOS host/);
  assert.match(renderer, /Windows Firewall may ask for private-network access/);
  assert.match(renderer, /Add to Home Screen/);
  assert.match(renderer, /use landscape orientation/);
  assert.match(renderer, /later security sprint will add access control/);
});
