"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { atemConfiguration, cameraForProgramInput, createAtemService } = require("../atem-service.cjs");
const { normalizeDevice } = require("../device-operations.cjs");
const { buildSystemStatus } = require("../system-status.cjs");
const { createSwitcherAdapterRegistry } = require("../switcher-adapter-registry.cjs");
const { createVideoRouter } = require("../video-router.cjs");
const { createVideoTakeLive } = require("../video-take-live.cjs");

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
    this.state = { video: { mixEffects: [{ programInput: 4, previewInput: 2, transitionPosition: { inTransition: false, remainingFrames: 0 } }] } };
    this.connectCalls = [];
    this.programCalls = [];
    this.previewCalls = [];
    this.transitionStyleCalls = [];
    this.autoCalls = 0;
    this.cutCalls = 0;
    this.disconnectCalls = 0;
  }
  async connect(host) {
    this.connectCalls.push(host);
    if (this.failConnect) throw new Error("private network details");
    this.emit("connected");
  }
  async changeProgramInput(input) { this.programCalls.push(input); }
  async changePreviewInput(input) { this.previewCalls.push(input); this.setState({ previewInput: input }); }
  async setTransitionStyle(properties) { this.transitionStyleCalls.push(properties); }
  async autoTransition() { this.autoCalls += 1; this.setState({ inTransition: true, remainingFrames: 12 }); }
  async cut() { this.cutCalls += 1; this.setState({ inTransition: false, remainingFrames: 0, programInput: this.state.video.mixEffects[0].previewInput }); }
  async disconnect() { this.disconnectCalls += 1; }
  async destroy() {}
  setProgram(input) {
    this.setState({ programInput: input });
  }
  setState(patch) {
    const current = this.state.video.mixEffects[0];
    this.state = { video: { mixEffects: [{
      ...current,
      ...(patch.programInput === undefined ? {} : { programInput: patch.programInput }),
      ...(patch.previewInput === undefined ? {} : { previewInput: patch.previewInput }),
      transitionPosition: {
        ...current.transitionPosition,
        ...(patch.inTransition === undefined ? {} : { inTransition: patch.inTransition }),
        ...(patch.remainingFrames === undefined ? {} : { remainingFrames: patch.remainingFrames })
      }
    }] } };
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
  client.state = { video: { mixEffects: [{ programInput: 4, previewInput: 2, transitionPosition: { inTransition: false, remainingFrames: 0 } }] } };
  client.emit("connected");
  assert.equal(service.getStatus().liveCameraId, "main");
  assert.ok(statuses.length >= 6);
});

test("TAKE LIVE uses native Preview, Mix, and Auto and waits for authoritative transition completion", async () => {
  const current = stateFixture();
  const client = new MockAtem();
  const service = createAtemService({ getState: () => current, clientFactory: () => client, logger: { error() {} } });
  await service.initialize();

  const taking = service.takeLive("left");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(client.previewCalls, [2]);
  assert.deepEqual(client.transitionStyleCalls, [{ nextStyle: 0 }]);
  assert.equal(client.autoCalls, 1);
  assert.equal(client.programCalls.length, 0);
  assert.equal(service.getStatus().liveCameraId, "main");
  assert.equal(service.getStatus().transitioning, true);
  client.setState({ programInput: 2, inTransition: false, remainingFrames: 0 });
  await taking;
  assert.equal(service.getStatus().liveCameraId, "left");
  assert.deepEqual(current.live, { cueIndex: 0 });
});

test("explicit Cut uses native Preview and Cut without Auto or direct PROGRAM", async () => {
  const client = new MockAtem();
  const service = createAtemService({ getState: () => stateFixture(), clientFactory: () => client, logger: { error() {} } });
  await service.initialize();
  await service.takeLive("right", { transition: "cut" });
  assert.deepEqual(client.previewCalls, [1]);
  assert.equal(client.cutCalls, 1);
  assert.equal(client.autoCalls, 0);
  assert.equal(client.programCalls.length, 0);
  assert.equal(service.getStatus().liveCameraId, "right");
});

test("failed Preview or Auto never falls back to Cut or direct PROGRAM", async () => {
  for (const failure of ["preview", "auto"]) {
    const client = new MockAtem();
    if (failure === "preview") client.changePreviewInput = async () => { throw new Error("preview failed"); };
    if (failure === "auto") client.autoTransition = async () => { throw new Error("auto failed"); };
    const service = createAtemService({ getState: () => stateFixture(), clientFactory: () => client, logger: { error() {} } });
    await service.initialize();
    await assert.rejects(service.takeLive("left"), error => error.code === (failure === "preview" ? "ATEM_PREVIEW_FAILED" : "ATEM_AUTO_FAILED"));
    assert.equal(client.cutCalls, 0);
    assert.equal(client.programCalls.length, 0);
    assert.equal(service.getStatus().liveCameraId, "main");
  }
});

test("prepared Motion waits until Mix completes authoritatively and then runs End exactly once", async () => {
  const current = stateFixture();
  current.settings = { activeSwitcherBackend: "atem", videoSwitching: { defaultTransition: "mix" } };
  current.videoSources = [
    { id: "source-main", name: "Main", sourceType: "camera", cameraDeviceId: "main", enabled: true, switcherMappings: { atem: { input: 4 } } },
    { id: "source-left", name: "Left", sourceType: "camera", cameraDeviceId: "left", enabled: true, switcherMappings: { atem: { input: 2 } } }
  ];
  const client = new MockAtem();
  const service = createAtemService({ getState: () => current, clientFactory: () => client, logger: { error() {} } });
  await service.initialize();
  const router = createVideoRouter({ getState: () => current, adapters: createSwitcherAdapterRegistry({ atem: service }) });
  let prepared = { shotId: "left-motion" };
  let motionCalls = 0;
  const commands = {
    getPreparedMotion: cameraId => cameraId === "left" ? prepared : null,
    setPreparedMotionStatus: async () => {},
    runCameraMotion: async () => { motionCalls += 1; prepared = null; return {}; }
  };
  const transaction = createVideoTakeLive({ commands, videoRouter: router });
  const taking = transaction.takeSource("source-left");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.autoCalls, 1);
  assert.equal(motionCalls, 0);
  assert.equal(router.getStatus().liveSourceId, "source-main");
  client.setState({ programInput: 2, inTransition: false, remainingFrames: 0 });
  await taking;
  assert.equal(motionCalls, 1);
  assert.equal(prepared, null);
  assert.equal(router.getStatus().liveSourceId, "source-left");
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

test("desktop integration routes logical Video Sources through the ATEM adapter while execution stays isolated", () => {
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

  assert.match(card, /data-take-video-source/);
  assert.match(card, /atemStatus\.liveSourceId === videoSource\?\.id/);
  assert.match(card, /window\.trinity\.takeVideoSource/);
  assert.match(preload, /takeVideoSource: sourceId => ipcRenderer\.invoke\("video-switcher:take-source", \{ videoSourceId: sourceId \}\)/);
  assert.match(main, /ipcMain\.handle\("video-switcher:take-source"/);
  assert.match(server, /\/api\/video-sources\/take-live/);
  assert.match(server, /await takeVideoSource\(body\.videoSourceId\)/);
  assert.doesNotMatch(server, /changeProgramInput/);
  assert.doesNotMatch(cueExecution, /atem|changeProgramInput/i);
  assert.doesNotMatch(looks, /changeProgramInput|takeCameraLive/);
  assert.doesNotMatch(commands, /atem|changeProgramInput|takeCameraLive/i);
  assert.doesNotMatch(atemService, /recallPreset|cameraExecutor|lightingExecutor|goCue|nextCue|previousCue/);
});
