"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { atemConfiguration, cameraForProgramInput, createAtemService } = require("../atem-service.cjs");
const { normalizeDevice } = require("../device-operations.cjs");
const { buildSystemStatus } = require("../system-status.cjs");

function stateFixture(patch = {}) {
  return {
    devices: [
      { id: "main", type: "camera", name: "Main Camera", enabled: true },
      { id: "left", type: "camera", name: "Left Camera", enabled: true },
      { id: "right", type: "camera", name: "Right Camera", enabled: true },
      {
        id: "device-atem", type: "switcher", name: "ATEM Mini Pro", enabled: true,
        adapterType: "atem", ipAddress: "atem.test",
        metadata: { adapter: "atem", atemCameraInputs: { main: 4, left: 2, right: 1 } },
        ...patch
      }
    ],
    cameraPresets: [], productionLooks: [], runOfService: [{ id: "cue", name: "Cue" }],
    live: { cueIndex: 0 }
  };
}

class MockAtem extends EventEmitter {
  constructor({ failConnect = false } = {}) {
    super();
    this.failConnect = failConnect;
    this.state = { video: { mixEffects: [{ programInput: 4 }] } };
    this.connectCalls = [];
    this.programCalls = [];
    this.disconnectCalls = 0;
  }
  async connect(host) {
    this.connectCalls.push(host);
    if (this.failConnect) throw new Error("private network details");
    this.emit("connected");
  }
  async changeProgramInput(input) { this.programCalls.push(input); }
  async disconnect() { this.disconnectCalls += 1; }
  async destroy() {}
  setProgram(input) {
    this.state = { video: { mixEffects: [{ programInput: input }] } };
    this.emit("stateChanged", this.state, ["video.mixEffects.0.programInput"]);
  }
}

test("ATEM configuration stores camera-ID mappings without assuming input order", () => {
  const configuration = atemConfiguration(stateFixture());
  assert.equal(configuration.host, "atem.test");
  assert.deepEqual(configuration.cameraInputs, { main: 4, left: 2, right: 1 });
  assert.equal(cameraForProgramInput(configuration, 4), "main");
  assert.equal(cameraForProgramInput(configuration, 2), "left");
  assert.equal(cameraForProgramInput(configuration, 1), "right");
  assert.equal(cameraForProgramInput(configuration, 99), null);
});

test("ATEM configuration survives ordinary device normalization", () => {
  const normalized = normalizeDevice({
    id: "device-atem", type: "switcher", name: "ATEM Mini Pro", enabled: true,
    adapterType: "atem", ipAddress: "192.0.2.20",
    metadata: { adapter: "atem", atemCameraInputs: { main: 3, left: 1, right: 4 }, futureField: "preserved" }
  });
  assert.equal(normalized.id, "device-atem");
  assert.equal(normalized.ipAddress, "192.0.2.20");
  assert.deepEqual(normalized.metadata.atemCameraInputs, { main: 3, left: 1, right: 4 });
  assert.equal(normalized.metadata.futureField, "preserved");
});

test("physical PROGRAM changes and disconnects drive authoritative LIVE state", async () => {
  const current = stateFixture();
  const client = new MockAtem();
  const statuses = [];
  const service = createAtemService({ getState: () => current, clientFactory: () => client, logger: { error() {} } });
  service.subscribe(status => statuses.push(status));
  await service.initialize();
  assert.equal(service.getStatus().connectionState, "connected");
  assert.equal(service.getStatus().liveCameraId, "main");

  client.setProgram(2);
  assert.equal(service.getStatus().liveCameraId, "left");
  client.setProgram(1);
  assert.equal(service.getStatus().liveCameraId, "right");
  client.setProgram(99);
  assert.equal(service.getStatus().liveCameraId, null);
  client.emit("disconnected");
  assert.equal(service.getStatus().connectionState, "disconnected");
  assert.equal(service.getStatus().programInput, null);
  assert.equal(service.getStatus().liveCameraId, null);
  client.state = { video: { mixEffects: [{ programInput: 4 }] } };
  client.emit("connected");
  assert.equal(service.getStatus().liveCameraId, "main");
  assert.ok(statuses.length >= 6);
});

test("TAKE LIVE sends exactly one mapped PROGRAM command and waits for ATEM confirmation", async () => {
  const current = stateFixture();
  const client = new MockAtem();
  const service = createAtemService({ getState: () => current, clientFactory: () => client, logger: { error() {} } });
  await service.initialize();

  for (const [cameraId, input] of [["main", 4], ["left", 2], ["right", 1]]) {
    const beforeLive = service.getStatus().liveCameraId;
    const beforeCalls = client.programCalls.length;
    await service.takeLive(cameraId);
    assert.equal(client.programCalls.length, beforeCalls + 1);
    assert.equal(client.programCalls.at(-1), input);
    assert.equal(service.getStatus().liveCameraId, beforeLive);
    client.setProgram(input);
    assert.equal(service.getStatus().liveCameraId, cameraId);
  }
  assert.deepEqual(current.live, { cueIndex: 0 });
});

test("disabled, disconnected, missing mapping, and failed connection remain safe", async () => {
  let current = stateFixture({ enabled: false });
  let created = 0;
  let service = createAtemService({ getState: () => current, clientFactory: () => { created += 1; return new MockAtem(); } });
  await service.initialize();
  assert.equal(created, 0);
  await assert.rejects(service.takeLive("main"), error => error.code === "ATEM_DISABLED");

  current = stateFixture({ metadata: { adapter: "atem", atemCameraInputs: {} } });
  const client = new MockAtem();
  service = createAtemService({ getState: () => current, clientFactory: () => client, logger: { error() {} } });
  await service.initialize();
  await assert.rejects(service.takeLive("main"), error => error.code === "ATEM_MAPPING_MISSING");
  assert.equal(client.programCalls.length, 0);
  client.emit("disconnected");
  await assert.rejects(service.takeLive("left"), error => error.code === "ATEM_DISCONNECTED");

  const failing = createAtemService({ getState: () => stateFixture(), clientFactory: () => new MockAtem({ failConnect: true }), logger: { error() {} } });
  await failing.initialize();
  assert.equal(failing.getStatus().connectionState, "error");
  assert.doesNotMatch(failing.getStatus().message, /private/);
});

test("System Status reads authoritative ATEM state without issuing a command", () => {
  const status = buildSystemStatus({
    state: stateFixture(),
    atemStatus: { name: "ATEM Mini Pro", enabled: true, configured: true, connectionState: "connected", host: "atem.test", programInput: 2, liveCameraId: "left" },
    appInfo: {}, storage: {}
  });
  assert.equal(status.atem.connectionState, "connected");
  assert.equal(status.atem.programInput, 2);
  assert.equal(status.atem.liveCameraId, "left");
  assert.equal(status.atem.liveCameraName, "Left Camera");
});

test("desktop integration keeps ATEM switching manual and isolated", () => {
  const root = path.join(__dirname, "..");
  const renderer = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
  const main = fs.readFileSync(path.join(root, "electron-main.cjs"), "utf8");
  const server = fs.readFileSync(path.join(root, "operator-server.cjs"), "utf8");
  const cueExecution = fs.readFileSync(path.join(root, "cue-execution.cjs"), "utf8");
  const looks = fs.readFileSync(path.join(root, "production-look-operations.cjs"), "utf8");
  const commands = fs.readFileSync(path.join(root, "operator-commands.cjs"), "utf8");
  const atemService = fs.readFileSync(path.join(root, "atem-service.cjs"), "utf8");
  const card = renderer.slice(renderer.indexOf("function CameraDirectorCard"), renderer.indexOf("function openCueDeleteModal"));

  assert.match(card, /data-atem-take-live/);
  assert.match(card, /atemStatus\.liveCameraId === camera\.id/);
  assert.match(card, /window\.trinity\.takeCameraLive/);
  assert.match(preload, /takeCameraLive: cameraId => ipcRenderer\.invoke\("atem:take-live", cameraId\)/);
  assert.match(main, /ipcMain\.handle\("atem:take-live"/);
  assert.match(server, /\/api\/atem\/take-live/);
  assert.match(server, /await takeCameraLive\(body\.cameraId\)/);
  assert.doesNotMatch(server, /changeProgramInput/);
  assert.doesNotMatch(cueExecution, /atem|changeProgramInput/i);
  assert.doesNotMatch(looks, /changeProgramInput|takeCameraLive/);
  assert.doesNotMatch(commands, /atem|changeProgramInput|takeCameraLive/i);
  assert.doesNotMatch(atemService, /recallPreset|cameraExecutor|lightingExecutor|goCue|nextCue|previousCue/);
});
