"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { launchArguments } = require("../qlcplus-service-manager.cjs");
const { createBackupEnvelope, defaultBackupFilename, mergePortableState } = require("../backup-operations.cjs");

const root = path.join(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");

test("electron-builder provides an unsigned x64 NSIS Windows production target", () => {
  const pkg = require("../package.json");
  assert.equal(pkg.scripts["build:win"], "electron-builder --win nsis --x64 --publish never");
  assert.deepEqual(pkg.build.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.artifactName, "Trinity-Control-Setup-${version}-${arch}.${ext}");
  assert.equal(pkg.build.win.certificateFile, undefined);
  const workflow = source(".github/workflows/build.yml");
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npm run build:win/);
  assert.match(workflow, /dist\/Trinity-Control-Setup-\*-x64\.exe/);

  const packagedFiles = new Set(pkg.build.files);
  assert.ok(packagedFiles.has("lighting-active-state.cjs"));
  assert.ok(packagedFiles.has("home-assistant-operations.cjs"));
});

test("Electron owns Windows userData and prevents a second authoritative host", () => {
  const main = source("electron-main.cjs");
  assert.match(main, /path\.join\(app\.getPath\("appData"\), "Trinity Control Refresh"\)/);
  assert.match(main, /app\.setPath\("userData", existingUserDataPath\)/);
  assert.match(main, /app\.requestSingleInstanceLock\(\)/);
  assert.match(main, /if \(!hasSingleInstanceLock\) app\.quit\(\)/);
  assert.match(main, /app\.on\("second-instance"/);
  assert.match(main, /mainWindow\.focus\(\)/);
  assert.equal(path.win32.join("C:\\Users\\Volunteer\\AppData\\Roaming", "Trinity Control Refresh", "trinity-data.json"), "C:\\Users\\Volunteer\\AppData\\Roaming\\Trinity Control Refresh\\trinity-data.json");
});

test("Windows QLC+ paths containing spaces remain separate shell-free launch arguments", () => {
  const applicationPath = "C:\\Program Files\\QLC+\\qlcplus.exe";
  const workspacePath = "D:\\Trinity Lighting\\Sunday Morning.qxw";
  assert.deepEqual(launchArguments({ applicationPath, workspacePath }, "win32", () => true), {
    command: applicationPath,
    args: ["--web", "--open", workspacePath],
    mode: "executable"
  });
  const sourceText = source("qlcplus-service-manager.cjs");
  assert.match(sourceText, /shell: false/);
  assert.doesNotMatch(sourceText, /taskkill|killall|SIGKILL/);
});

test("Windows native dialogs preserve backup extension and constrain QLC+ executable selection", () => {
  const main = source("electron-main.cjs");
  assert.match(defaultBackupFilename(Date.parse("2026-08-04T12:00:00Z")), /\.trinitybackup$/);
  assert.match(main, /extensions: \["trinitybackup"\]/);
  assert.match(main, /endsWith\("\.trinitybackup"\)/);
  assert.match(main, /process\.platform === "win32"[^\n]+extensions: \["exe"\]/);
  assert.match(main, /extensions: \["qxw"\]/);
});

test("portable backups preserve IDs while machine-local paths and credentials remain local", () => {
  const current = {
    settings: { qlcplusService: { applicationPath: "C:\\Program Files\\QLC+\\qlcplus.exe", workspacePath: "D:\\Shows\\Sunday.qxw", manageAutomatically: true } },
    devices: [{ id: "main", type: "camera", password: "secret", credentialReference: "camera-token", connection: { password: "secret" } }],
    cameraPresets: [{ id: "preset-main-wide", cameraDeviceId: "main", presetNumber: 7 }],
    shots: [{ id: "motion-main", cameraDeviceId: "main", cameraPresetId: "preset-main-wide" }],
    runOfService: [], productionLooks: [], lightingScenes: [], cueTemplates: [], cameraLayouts: []
  };
  const envelope = createBackupEnvelope(current, { trinityVersion: "test", now: Date.now() });
  assert.equal(envelope.data.settings.qlcplusService.applicationPath, undefined);
  assert.equal(envelope.data.settings.qlcplusService.workspacePath, undefined);
  assert.equal(envelope.data.devices[0].password, undefined);
  assert.equal(envelope.data.devices[0].credentialReference, undefined);
  assert.equal(envelope.data.cameraPresets[0].id, "preset-main-wide");
  assert.equal(envelope.data.cameraPresets[0].presetNumber, 7);
  assert.equal(envelope.data.shots[0].cameraPresetId, "preset-main-wide");

  const windows = structuredClone(current);
  const imported = mergePortableState(windows, envelope.data);
  assert.equal(imported.settings.qlcplusService.applicationPath, current.settings.qlcplusService.applicationPath);
  assert.equal(imported.settings.qlcplusService.workspacePath, current.settings.qlcplusService.workspacePath);
});

test("Windows host networking and hardware adapters remain platform-neutral and startup-safe", () => {
  const main = source("electron-main.cjs");
  const operator = source("operator-server.cjs");
  const visca = source("ptzoptics-adapter.cjs");
  const atem = source("atem-service.cjs");
  const homeAssistant = source("home-assistant-operations.cjs");
  assert.match(operator, /http\.createServer/);
  assert.match(operator, /os\.networkInterfaces\(\)/);
  assert.match(operator, /DEFAULT_HOST = "0\.0\.0\.0"/);
  assert.match(operator, /DEFAULT_PORT = 4310/);
  assert.match(visca, /dgram\.createSocket\("udp4"\)/);
  assert.match(atem, /require\("atem-connection"\)/);
  assert.match(homeAssistant, /path\.join\(app\.getPath\('userData'\), 'home-assistant\.config\.json'\)/);
  const startup = main.slice(main.indexOf("app.whenReady()"), main.indexOf('ipcMain.handle("live:go"'));
  assert.doesNotMatch(startup, /\.recallCameraPreset\(|\.runCameraMotion\(|\.takeLive\(|\.goCue\(|\.nextCue\(|\.previousCue\(/);
  const shutdown = main.slice(main.indexOf('app.on("before-quit"'));
  assert.doesNotMatch(shutdown, /recallCameraPreset|runCameraMotion|takeLive|goCue|nextCue|previousCue|executeLightingScene/);
});
