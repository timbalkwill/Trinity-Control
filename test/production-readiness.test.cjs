"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deriveProductionReadiness, safeProductionReadiness } = require("../production-readiness.cjs");
const { extractPortableState } = require("../backup-operations.cjs");

const root = path.join(__dirname, "..");
const source = filename => fs.readFileSync(path.join(root, filename), "utf8");

function fixture() {
  const cameras = ["main", "left", "right"].map((role, index) => ({
    id: role, type: "camera", name: `${role} camera`, logicalRole: role, enabled: true,
    adapterType: "ptzoptics", protocol: "visca-over-ip", ipAddress: `camera-${index}.test`, port: 5678,
    connectionStatus: "connected"
  }));
  return {
    settings: {},
    devices: [
      ...cameras,
      { id: "switcher", type: "switcher", enabled: true },
      { id: "lights", type: "lighting", enabled: true, adapterType: "qlcplus-websocket", metadata: {
        lightingDiagnostic: { ok: true }, qlcplusWidgets: [{ widgetId: "1", widgetType: "Button", canActivateScene: true }]
      } }
    ],
    videoSources: [
      ...cameras.map((camera, index) => ({ id: `source-${camera.id}`, sourceType: "camera", cameraDeviceId: camera.id, enabled: true, switcherMappings: { atem: { input: index + 1 } } })),
      { id: "presentation", name: "ProPresenter", sourceType: "video", enabled: true, switcherMappings: { atem: { input: 4 } } }
    ],
    lightingScenes: [{ id: "welcome", name: "Welcome", available: true, authoritativeSource: "qlcplus", externalControl: { widgetId: "1" } }],
    productionLooks: [], runOfService: [], cueTemplates: [], cameraPresets: [], shots: [],
    live: { preparedMotions: {} }
  };
}

const context = state => ({
  state,
  qlcStatus: { connectionState: "connected" },
  videoStatus: { backend: "atem", backendName: "ATEM", connectionState: "connected", liveSourceName: "Main Camera" },
  operatorStatus: { running: true, port: 4310 },
  homeAssistant: { configured: false }
});

test("healthy authoritative state derives Ready to Run without mutation", () => {
  const current = fixture();
  const before = structuredClone(current);
  const result = deriveProductionReadiness(context(current));
  assert.equal(result.overall, "ready");
  assert.equal(result.label, "READY TO RUN");
  assert.equal(result.items.find(item => item.id === "lighting").summary, "QLC+ connected");
  assert.equal(result.items.find(item => item.id === "videoSwitcher").summary, "ATEM connected");
  assert.equal(result.items.find(item => item.id === "lightingReconciliation").summary, "0 unresolved");
  assert.deepEqual(current, before);
});

test("warning-only state derives Needs Attention with truthful camera and dependency reasons", () => {
  const current = fixture();
  current.devices.find(device => device.id === "left").connectionStatus = "notTested";
  current.lightingScenes.push({ id: "missing", name: "Missing", available: false, externalControl: { widgetId: "9" } });
  current.productionLooks.push({ id: "look", name: "Look", lightingSceneId: "missing" });
  const result = deriveProductionReadiness(context(current));
  assert.equal(result.overall, "warning");
  assert.equal(result.label, "NEEDS ATTENTION");
  assert.equal(result.items.find(item => item.id === "camera-left").summary, "Configured, not tested");
  assert.match(result.items.find(item => item.id === "lightingReconciliation").detail, /1 missing/);
});

test("required service failures derive Not Ready without deleting disconnected QLC definitions", () => {
  const current = fixture();
  current.videoSources.find(source => source.id === "presentation").switcherMappings = {};
  const result = deriveProductionReadiness({ ...context(current), qlcStatus: { connectionState: "disconnected" }, videoStatus: { backend: "atem", backendName: "ATEM", connectionState: "disconnected" } });
  assert.equal(result.overall, "error");
  assert.equal(result.label, "NOT READY");
  assert.equal(result.items.find(item => item.id === "lighting").state, "error");
  assert.equal(result.items.find(item => item.id === "videoSwitcher").state, "error");
  assert.equal(result.items.find(item => item.id === "presentation").summary, "Mapping required");
  assert.equal(current.lightingScenes[0].available, true);
});

test("camera readiness distinguishes configured-not-tested, unavailable, and connected", () => {
  const current = fixture();
  current.devices.find(device => device.id === "left").connectionStatus = "notTested";
  current.devices.find(device => device.id === "right").connectionStatus = "offline";
  const result = deriveProductionReadiness(context(current));
  assert.equal(result.items.find(item => item.id === "camera-main").summary, "Connected");
  assert.equal(result.items.find(item => item.id === "camera-left").summary, "Configured, not tested");
  assert.equal(result.items.find(item => item.id === "camera-right").summary, "Unavailable");
});

test("optional Home Assistant and prepared Motion do not change healthy overall readiness", () => {
  const current = fixture();
  current.live.preparedMotions.main = { cameraId: "main", shotId: "push", shotName: "Slow Push", statusLabel: "READY" };
  const result = deriveProductionReadiness(context(current));
  assert.equal(result.overall, "ready");
  assert.equal(result.items.find(item => item.id === "homeAssistant").state, "optional");
  assert.deepEqual(result.preparedMotion.map(item => item.shotId), ["push"]);
});

test("Browser projection contains concise safe readiness and no network configuration", () => {
  const safe = safeProductionReadiness(deriveProductionReadiness(context(fixture())));
  assert.equal(safe.label, "READY TO RUN");
  assert.deepEqual(Object.keys(safe.groups), ["lighting", "video", "cameras", "host"]);
  assert.doesNotMatch(JSON.stringify(safe), /camera-0\.test|9999|token|ipAddress|switcherMappings/);
});

test("runtime readiness is neither persisted nor included in portable backup", () => {
  const current = fixture();
  current.productionReadiness = deriveProductionReadiness(context(current));
  const portable = extractPortableState(current);
  assert.equal(portable.productionReadiness, undefined);
  assert.equal(portable.live, undefined);
});

test("desktop and iPad surfaces use derived readiness without adding controls", () => {
  const desktop = source("public/app.js");
  const operator = source("public/operator/operator.js");
  assert.match(desktop, /PRODUCTION READINESS/);
  assert.match(desktop, /production-readiness-strip/);
  assert.match(operator, /operator-readiness/);
  assert.match(operator, /state\.productionReadiness/);
  assert.doesNotMatch(operator, /data-action="(?:readiness|configure)/);
});

test("readiness evaluation is pure and contains no execution or polling path", () => {
  const implementation = source("production-readiness.cjs");
  const operator = source("public/operator/operator.js");
  assert.doesNotMatch(implementation, /recallPreset|takeSource|activateControl|executeCue|goCue|previousCue|nextCue|fetch\(|new WebSocket/i);
  assert.doesNotMatch(operator, /setInterval|setTimeout/);
});

test("compact strips preserve bounded desktop and iPad workspace rows", () => {
  const desktopCss = source("public/live-layout-fix.css");
  const ipadCss = source("public/operator/operator.css");
  assert.match(desktopCss, /grid-template-rows:auto auto minmax\(60px,auto\) minmax\(0,1fr\)/);
  assert.match(ipadCss, /grid-template-rows: 58px auto minmax\(0, 1fr\) minmax\(62px, auto\)/);
  assert.match(ipadCss, /\.camera-content-scroll[^}]*overflow-y: auto/);
});
