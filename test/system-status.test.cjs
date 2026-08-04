const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildSystemStatus, readGitMetadata } = require("../system-status.cjs");

const root = path.join(__dirname, "..");

function fixture() {
  return {
    devices: [
      {
        id: "camera-main",
        type: "camera",
        name: "Main Camera",
        enabled: true,
        connectionStatus: "connected",
        protocol: "visca-over-ip",
        trackingEnabled: true,
        lastCheckedAt: "2026-07-28T10:00:00.000Z"
      },
      {
        id: "lighting",
        type: "lighting",
        name: "QLC+",
        enabled: true,
        adapterType: "qlcplus-websocket",
        protocol: "ws",
        ipAddress: "127.0.0.1",
        port: 9999
      }
    ],
    cameraPresets: [
      { id: "wide", cameraDeviceId: "camera-main" },
      { id: "tight", cameraDeviceId: "camera-main" }
    ],
    productionLooks: [{ id: "look-welcome", name: "Welcome Look" }],
    runOfService: [
      { id: "cue-one", name: "Welcome", productionLookId: "look-welcome" },
      { id: "cue-two", name: "Worship" }
    ],
    live: {
      cueIndex: 0,
      hold: false,
      executionSnapshot: {
        productionLookId: "look-welcome",
        lighting: { sceneName: "Welcome" },
        lightingExecutions: [{ sceneName: "Welcome" }],
        lightingExecutionResults: [{ status: "succeeded", completedAt: "2026-07-28T10:01:00.000Z" }],
        warnings: []
      }
    }
  };
}

test("system status summarizes current state without mutating it", () => {
  const state = fixture();
  const original = structuredClone(state);
  const status = buildSystemStatus({
    state,
    qlcStatus: { state: "connected", connectionState: "connected" },
    operatorStatus: { running: true, port: 4310, localUrl: "http://localhost:4310", networkUrls: ["http://192.168.1.20:4310"] },
    appInfo: { version: "1.2.3", commit: "abc123" },
    storage: { userData: "/data", configuration: "/data/config.json", servicePlans: "/data", logs: "/logs" },
    processInfo: { memoryBytes: 1024, uptimeSeconds: 12, activeTimers: 2 },
    now: () => new Date("2026-07-28T12:00:00.000Z")
  });

  assert.deepEqual(state, original);
  assert.equal(status.generatedAt, "2026-07-28T12:00:00.000Z");
  assert.equal(status.lighting.health.status, "healthy");
  assert.equal(status.lighting.activeScene, "Welcome");
  assert.equal(status.cameras.items[0].presetCount, 2);
  assert.equal(status.production.currentCue, "Welcome");
  assert.equal(status.production.nextCue, "Worship");
  assert.equal(status.production.currentLook, "Welcome Look");
  assert.equal(status.operator.goReady, true);
  assert.equal(status.operator.backReady, false);
  assert.equal(status.host.operatorServerRunning, true);
  assert.equal(status.host.operatorNetworkUrls[0], "http://192.168.1.20:4310");
});

test("health reporting distinguishes warnings and errors", () => {
  const state = fixture();
  state.devices.find(device => device.type === "camera").connectionStatus = "offline";
  state.live.hold = true;
  state.live.executionSnapshot.warnings = ["Missing preset"];

  const status = buildSystemStatus({
    state,
    qlcStatus: { state: "disconnected", message: "Connection refused" },
    appInfo: {},
    storage: {}
  });

  assert.equal(status.lighting.health.status, "error");
  assert.equal(status.cameras.health.status, "error");
  assert.equal(status.production.health.status, "warning");
  assert.equal(status.operator.health.status, "warning");
});

test("build metadata honors supplied build values and reads repository metadata when available", () => {
  assert.deepEqual(readGitMetadata("/does/not/exist", {
    TRINITY_GIT_COMMIT: "1234567890abcdef",
    TRINITY_GIT_BRANCH: "release"
  }), { commit: "1234567890ab", branch: "release" });
  const repository = readGitMetadata(root, {});
  assert.notEqual(repository.commit, "Unavailable");
  assert.equal(repository.branch, "feature/shot-system-v2");
});

test("System Status UI uses one read-only refresh IPC surface", () => {
  const renderer = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
  const main = fs.readFileSync(path.join(root, "electron-main.cjs"), "utf8");
  const statusView = renderer.slice(renderer.indexOf("function systemStatusPage"), renderer.indexOf("function settingsPage"));

  assert.match(renderer, /\['systemStatus', 'System Status'\]/);
  assert.match(statusView, /REFRESH STATUS/);
  assert.match(statusView, /Application/);
  assert.match(statusView, /Lighting System/);
  assert.match(statusView, /Camera System/);
  assert.match(statusView, /Production System/);
  assert.match(statusView, /Operator Controls/);
  assert.match(statusView, /Production Host/);
  assert.match(statusView, /Performance/);
  assert.match(statusView, /Storage/);
  assert.match(preload, /getSystemStatus: \(\) => ipcRenderer\.invoke\("system:status"\)/);
  assert.match(main, /ipcMain\.handle\("system:status"/);
  assert.doesNotMatch(statusView, /window\.trinity\.(goCue|nextCue|previousCue|executeLightingScene|testDevice|discoverLightingControls|setCamera|makeCameraLive)/);
});
