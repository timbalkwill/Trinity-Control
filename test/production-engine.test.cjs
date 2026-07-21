const test = require("node:test");
const assert = require("node:assert/strict");
const { ENGINE_EVENTS, ProductionEngine } = require("../src/core/production-engine.cjs");
const { SimulationCameraController } = require("../src/adapters/simulation/simulation-camera-controller.cjs");
const { SimulationSwitcherController } = require("../src/adapters/simulation/simulation-switcher-controller.cjs");
const { SimulationLightingController } = require("../src/adapters/simulation/simulation-lighting-controller.cjs");

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function stateWithTransition(delay = 0) {
  return {
    cameras: [
      { id: "main", name: "Main", lastPreset: "Wide" },
      { id: "left", name: "Left", lastPreset: "Left" },
      { id: "right", name: "Right", lastPreset: "Right" }
    ],
    lightingScenes: [
      { id: "light-worship", name: "Worship" },
      { id: "light-sermon", name: "Sermon" }
    ],
    cameraLayouts: [
      { id: "layout-worship", programCamera: "left", programPreset: "Left", previewCamera: "main", previewPreset: "Wide", tracking: false }
    ],
    productionLooks: [
      { id: "look-worship", cameraLayoutId: "layout-worship", lightingSceneId: "light-worship" }
    ],
    runOfService: [
      { id: "cue-worship", name: "Worship", productionLookId: "look-worship", transition: { mode: "auto", waitForPTZ: true, delay } }
    ],
    live: {
      cueIndex: 0,
      programCamera: "main",
      previewCamera: "left",
      programPreset: "Wide",
      previewPreset: "Left",
      hold: false,
      lightingOverrideId: null,
      lastLightingSceneId: null,
      activityLog: []
    }
  };
}

function createEngine(delay = 0, { persistState } = {}) {
  const engine = new ProductionEngine({ initialState: stateWithTransition(delay), persistState });
  engine.registerDeviceAdapter(new SimulationCameraController());
  engine.registerDeviceAdapter(new SimulationSwitcherController());
  engine.registerDeviceAdapter(new SimulationLightingController());
  return engine;
}

test("commands execute serially", async () => {
  const engine = createEngine();
  const order = [];
  engine.registerCommand("Slow", async ({ id, delay }) => {
    order.push(`start-${id}`);
    await wait(delay);
    order.push(`end-${id}`);
    return false;
  });

  await Promise.all([
    engine.dispatch({ type: "Slow", payload: { id: 1, delay: 20 } }),
    engine.dispatch({ type: "Slow", payload: { id: 2, delay: 0 } })
  ]);

  assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
  engine.dispose();
});

test("revision increments and state-change events are published", async () => {
  const engine = createEngine();
  const events = [];
  engine.subscribe(ENGINE_EVENTS.STATE_CHANGED, event => events.push(event));

  const result = await engine.dispatch({ type: "SetHold", payload: { hold: true } });

  assert.equal(result.revision, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].revision, 1);
  assert.equal(events[0].state.live.hold, true);
  engine.dispose();
});

test("cue activation applies its camera layout and lighting", async () => {
  const engine = createEngine();
  const result = await engine.dispatch({ type: "ActivateCue", payload: { index: 0 } });

  assert.equal(result.live.programCamera, "left");
  assert.equal(result.live.programPreset, "Left");
  assert.equal(result.live.previewCamera, "main");
  assert.equal(result.live.lastLightingSceneId, "light-worship");
  assert.equal(result.live.lastTransition.cueId, "cue-worship");
  engine.dispose();
});

test("manual camera switching updates program and preview", async () => {
  const engine = createEngine();
  const result = await engine.dispatch({ type: "TakeCamera", payload: { cameraId: "right", preset: "Right" } });

  assert.equal(result.live.programCamera, "right");
  assert.equal(result.live.programPreset, "Right");
  assert.equal(result.live.previewCamera, "main");
  assert.equal(result.live.previewPreset, "Wide");
  engine.dispose();
});

test("camera adapter failure publishes a production error without corrupting state", async () => {
  const engine = createEngine();
  const errors = [];
  engine.subscribe(ENGINE_EVENTS.ERROR, event => errors.push(event));
  engine.deviceManager.registerDevice({
    id: "hardware-main",
    name: "Hardware Main",
    type: "Camera",
    connectionState: "Error",
    statusMessage: "Offline",
    supportedCapabilities: ["camera"],
    supportsReconnect: true,
    supportsConfiguration: true,
    supportsHealthMonitoring: true
  }, {
    recallPreset: async () => { throw new Error("Camera unreachable"); }
  }, { resourceIds: ["main"] });

  await assert.rejects(
    engine.dispatch({ type: "TakeCamera", payload: { cameraId: "main", preset: "Pulpit" } }),
    /Camera unreachable/
  );
  assert.equal(engine.getSnapshot().revision, 0);
  assert.equal(engine.getSnapshot().live.programCamera, "main");
  assert.equal(errors.at(-1).commandType, "TakeCamera");
  assert.match(errors.at(-1).message, /Camera unreachable/);
  engine.dispose();
});

test("lighting override can be set and released", async () => {
  const engine = createEngine();
  const overridden = await engine.dispatch({ type: "SetLightingOverride", payload: { sceneId: "light-sermon" } });
  assert.equal(overridden.live.lightingOverrideId, "light-sermon");

  const released = await engine.dispatch({ type: "ReleaseLightingOverride" });
  assert.equal(released.live.lightingOverrideId, null);
  engine.dispose();
});

test("stale delayed cue completion cannot overwrite a newer manual camera command", async () => {
  const engine = createEngine(30);
  await engine.dispatch({ type: "ActivateCue", payload: { index: 0 } });
  await engine.dispatch({ type: "TakeCamera", payload: { cameraId: "right", preset: "Right" } });
  await wait(60);

  const result = engine.getSnapshot();
  assert.equal(result.live.programCamera, "right");
  assert.equal(result.live.programPreset, "Right");
  assert.equal(result.revision, 2);
  engine.dispose();
});

test("camera configuration is updated through an explicit command", async () => {
  const engine = createEngine();
  const result = await engine.dispatch({
    type: "UpdateCameraConfiguration",
    payload: {
      cameraId: "main",
      changes: { name: "Center PTZ", role: "center", enabled: false, lastPreset: "Pulpit" }
    }
  });

  const camera = result.cameras.find(item => item.id === "main");
  assert.deepEqual(
    { name: camera.name, role: camera.role, enabled: camera.enabled, lastPreset: camera.lastPreset },
    { name: "Center PTZ", role: "center", enabled: false, lastPreset: "Pulpit" }
  );
  assert.equal(result.revision, 1);
  engine.dispose();
});

test("lighting configuration is normalized through an explicit command", async () => {
  const engine = createEngine();
  const result = await engine.dispatch({
    type: "UpdateLightingSceneConfiguration",
    payload: {
      sceneId: "light-worship",
      changes: {
        name: "Worship Bright",
        category: "Sunday",
        room: "Blue",
        platform: 120,
        fill: 42,
        ceiling: -5,
        house: 18,
        fade: 2.5,
        favorite: true
      }
    }
  });

  const scene = result.lightingScenes.find(item => item.id === "light-worship");
  assert.deepEqual(
    {
      name: scene.name,
      category: scene.category,
      room: scene.room,
      platform: scene.platform,
      fill: scene.fill,
      ceiling: scene.ceiling,
      house: scene.house,
      fade: scene.fade,
      favorite: scene.favorite
    },
    {
      name: "Worship Bright",
      category: "Sunday",
      room: "Blue",
      platform: 100,
      fill: 42,
      ceiling: 0,
      house: 18,
      fade: 2.5,
      favorite: true
    }
  );
  engine.dispose();
});

test("configuration commands persist the committed authoritative snapshot", async () => {
  const persisted = [];
  const engine = createEngine(0, {
    persistState: snapshot => persisted.push(snapshot)
  });

  const result = await engine.dispatch({
    type: "UpdateCameraConfiguration",
    payload: { cameraId: "left", changes: { name: "Stage Left" } }
  });

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].revision, result.revision);
  assert.equal(persisted[0].cameras.find(item => item.id === "left").name, "Stage Left");
  persisted[0].cameras[0].name = "External mutation";
  assert.notEqual(engine.getSnapshot().cameras[0].name, "External mutation");
  engine.dispose();
});

test("configuration commands reject fields outside their explicit contract", async () => {
  const engine = createEngine();

  await assert.rejects(
    engine.dispatch({
      type: "UpdateCameraConfiguration",
      payload: { cameraId: "main", changes: { online: false } }
    }),
    /Unsupported camera configuration fields: online/
  );
  assert.equal(engine.getSnapshot().revision, 0);
  assert.notEqual(engine.getSnapshot().cameras[0].online, false);
  engine.dispose();
});

test("network camera configuration validates and preserves immutable saved positions", async () => {
  const engine = createEngine();
  const initial = engine.getSnapshot();
  initial.cameras[0].adapterType = "simulation";
  initial.cameras[0].host = "";
  initial.cameras[0].savedPositions = [
    { id: "pulpit", name: "Pulpit", hardwarePresetNumber: null }
  ];
  await engine.replaceSnapshot(initial);

  const result = await engine.dispatch({
    type: "UpdateCameraConfiguration",
    payload: {
      cameraId: "main",
      changes: {
        adapterType: "visca-over-ip",
        protocol: "visca-over-ip",
        host: "192.168.1.50",
        port: 5678,
        cameraAddress: 1,
        connectionTimeoutMs: 1500,
        healthCheckIntervalMs: 15000,
        manufacturer: "Configured Vendor",
        model: "PTZ Camera",
        savedPositions: [{ id: "pulpit", name: "Pulpit", hardwarePresetNumber: 7 }]
      }
    }
  });
  const camera = result.cameras.find(item => item.id === "main");
  assert.equal(camera.adapterType, "visca-over-ip");
  assert.equal(camera.host, "192.168.1.50");
  assert.equal(camera.savedPositions[0].hardwarePresetNumber, 7);

  await assert.rejects(engine.dispatch({
    type: "UpdateCameraConfiguration",
    payload: { cameraId: "main", changes: { port: 70000 } }
  }), /port must be an integer/);
  await assert.rejects(engine.dispatch({
    type: "UpdateCameraConfiguration",
    payload: {
      cameraId: "main",
      changes: { savedPositions: [{ id: "pulpit", name: "Renamed", hardwarePresetNumber: 8 }] }
    }
  }), /IDs and names are immutable/);
  engine.dispose();
});
