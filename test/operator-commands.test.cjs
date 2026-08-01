const test = require("node:test");
const assert = require("node:assert/strict");
const { createOperatorCommands } = require("../operator-commands.cjs");

const clone = value => JSON.parse(JSON.stringify(value));

function initialState() {
  return {
    lightingScenes: [{ id: "light-cue", name: "Cue" }, { id: "light-manual", name: "Manual" }],
    productionLooks: [{ id: "look", lightingSceneId: "light-cue", cameraLayoutId: "layout" }],
    cameraLayouts: [{ id: "layout", programCamera: "main", programPreset: "Wide", previewCamera: "left", previewPreset: "Left" }],
    cameras: [{ id: "main", name: "Main" }, { id: "left", name: "Left" }],
    runOfService: [
      { id: "one", name: "One", productionLookId: "look" },
      { id: "two", name: "Two", productionLookId: "look" },
      { id: "three", name: "Three", productionLookId: "look" }
    ],
    live: { cueIndex: 0, hold: false, activityLog: [] }
  };
}

function harness(options = {}) {
  let persisted = initialState();
  const commands = createOperatorCommands({
    loadState: () => clone(persisted),
    saveState: state => { persisted = clone(state); return clone(persisted); },
    ...options
  });
  return { commands, state: () => clone(persisted) };
}

function lightingExecutionState({ enabled = true } = {}) {
  const current = initialState();
  current.devices = [{
    id: "qlc",
    name: "QLC+",
    type: "lighting",
    adapterType: "qlcplus-websocket",
    enabled,
    ipAddress: "127.0.0.1",
    metadata: {
      qlcplusWidgets: [{
        widgetId: "28",
        name: "Welcome",
        widgetType: "Button",
        canActivateScene: true,
        pageName: "Sunday Morning"
      }]
    }
  }];
  current.lightingScenes[1].externalControl = {
    adapterType: "qlcplus-websocket",
    widgetId: "28",
    widgetName: "Welcome",
    widgetType: "Button"
  };
  return current;
}

test("shared operator commands execute GO, NEXT, BACK, HOLD, and lighting actions", async () => {
  const { commands } = harness();
  let result = await commands.goCue(2);
  assert.equal(result.live.cueIndex, 2);
  assert.equal(result.live.executionSnapshot.cueId, "three");
  result = await commands.previousCue();
  assert.equal(result.live.cueIndex, 1);
  assert.equal(result.live.executionSnapshot.cueId, "two");
  result = await commands.nextCue();
  assert.equal(result.live.cueIndex, 2);
  assert.equal(result.live.executionSnapshot.cueId, "three");
  assert.equal((await commands.toggleHold()).live.hold, true);
});

test("Production Look edits do not change executed live snapshot until re-execution", async () => {
  const { commands } = harness();
  let result = await commands.goCue(0);
  const executed = JSON.stringify(result.live.executionSnapshot);
  result = await commands.updateProductionLook("look", { name: "Edited Look", lightingSceneId: "light-manual" });
  assert.equal(JSON.stringify(result.live.executionSnapshot), executed);
  result = await commands.goCue(0);
  assert.equal(result.live.executionSnapshot.productionLookName, "Edited Look");
  assert.equal(result.live.executionSnapshot.lighting.sceneId, "light-manual");
});

test("shared commands serialize writes and publish authoritative saved snapshots", async () => {
  const { commands } = harness();
  const published = [];
  commands.subscribe(state => published.push(state));
  await Promise.all([commands.nextCue(), commands.nextCue()]);
  assert.equal(commands.getState().live.cueIndex, 2);
  assert.deepEqual(published.map(state => state.live.cueIndex), [1, 2]);
});

test("TAKE LIVE persists and publishes through the serialized authoritative command path", async () => {
  const { commands } = harness();
  await commands.updateState(state => {
    state.live.programCamera = "main";
    state.live.previewCamera = "left";
  });
  const published = [];
  commands.subscribe(state => published.push(state));
  const result = await commands.takeLive();
  assert.equal(result.live.programCamera, "left");
  assert.equal(result.live.previewCamera, "main");
  assert.equal(commands.getState().live.programCamera, "left");
  assert.equal(published.at(-1).live.programCamera, "left");

  let persisted = clone(result);
  const reloadCommands = createOperatorCommands({
    loadState: () => clone(persisted),
    saveState: state => { persisted = clone(state); return clone(persisted); }
  });
  assert.equal(reloadCommands.getState().live.programCamera, "left");
});

test("camera preparation and Make Live share serialized authoritative state", async () => {
  const current = initialState();
  current.devices = [
    { id: "main", type: "camera", name: "Main", logicalRole: "main", enabled: true },
    { id: "left", type: "camera", name: "Left", logicalRole: "left", enabled: true }
  ];
  current.cameraPresets = [{ id: "left-tight", name: "Left Tight", cameraDeviceId: "left", enabled: true }];
  let persisted = clone(current);
  const commands = createOperatorCommands({
    loadState: () => clone(persisted),
    saveState: state => { persisted = clone(state); return clone(persisted); }
  });
  const published = [];
  commands.subscribe(state => published.push(state));
  await commands.setCameraMode("left", "static");
  await commands.prepareCamera("left", "left-tight");
  const result = await commands.makeCameraLive("left");
  assert.equal(result.live.programCamera, "left");
  assert.equal(result.live.cameraPreparations.find(item => item.cameraId === "left").selectedPresetId, "left-tight");
  assert.equal(published.at(-1).live.programCamera, "left");
});

test("shared browser and Electron commands use the injected authoritative cue executor", async () => {
  const calls = [];
  const { commands } = harness({
    cueExecutor: (state, index) => {
      calls.push(index);
      state.live.cueIndex = index;
      return state;
    }
  });
  await commands.goCue(2);
  await commands.nextCue();
  await commands.previousCue();
  assert.deepEqual(calls, [2, 3, 2]);
});

test("Lighting Library execution requires an existing scene", async () => {
  const { commands } = harness();
  await assert.rejects(commands.executeLightingScene("missing"), /Unknown lighting scene/);
});

test("Lighting Library execution resolves through the existing lighting pipeline without changing state", async () => {
  let persisted = lightingExecutionState();
  const resolvedExecution = Object.freeze({
    lightingSceneId: "light-manual",
    adapterType: "qlcplus-websocket",
    widgetId: "28",
    widgetName: "Welcome",
    pageName: "Sunday Morning",
    executionType: "qlc-button"
  });
  const resolverCalls = [];
  const executorCalls = [];
  const expectedResult = { ok: true, activationMessageCount: 1, commandValue: 255 };
  const commands = createOperatorCommands({
    loadState: () => clone(persisted),
    saveState: state => { persisted = clone(state); return clone(persisted); },
    lightingExecutionResolver: (state, sceneId) => {
      resolverCalls.push({ state, sceneId });
      return { execution: resolvedExecution, validation: { state: "valid" } };
    },
    lightingExecutorFactory: (state, options) => ({
      execute(execution, context) {
        executorCalls.push({ state, options, execution, context });
        return expectedResult;
      }
    })
  });

  const before = clone(persisted);
  const result = await commands.executeLightingScene("light-manual");

  assert.equal(resolverCalls.length, 1);
  assert.equal(resolverCalls[0].sceneId, "light-manual");
  assert.equal(executorCalls.length, 1);
  assert.equal(executorCalls[0].execution, resolvedExecution);
  assert.equal(executorCalls[0].context.source, "lighting-library");
  assert.deepEqual(result, expectedResult);
  assert.deepEqual(persisted, before);
});

test("Lighting Library execution preserves the existing lighting-disabled result without activation", async () => {
  let persisted = lightingExecutionState({ enabled: false });
  let activations = 0;
  const commands = createOperatorCommands({
    loadState: () => clone(persisted),
    saveState: state => { persisted = clone(state); return clone(persisted); },
    lightingAdapters: {
      execute() {
        activations += 1;
        return { ok: true };
      }
    }
  });

  const result = await commands.executeLightingScene("light-manual");

  assert.equal(activations, 0);
  assert.deepEqual(result, {
    ok: true,
    skipped: true,
    reason: "lighting-disabled",
    activationMessageCount: 0,
    message: "Lighting is disabled in Trinity"
  });
});

test("Lighting Library execution propagates the existing disconnected execution failure", async () => {
  let persisted = lightingExecutionState();
  let activations = 0;
  const disconnected = { ok: false, code: "connectionFailure", message: "QLC+ is disconnected" };
  const commands = createOperatorCommands({
    loadState: () => clone(persisted),
    saveState: state => { persisted = clone(state); return clone(persisted); },
    lightingAdapters: {
      async testConnection() {
        return disconnected;
      },
      async execute() {
        activations += 1;
        return { ok: true };
      }
    }
  });

  const result = await commands.executeLightingScene("light-manual");

  assert.deepEqual(result, disconnected);
  assert.equal(activations, 0);
});

test("browser and Electron cue edits share serialized state logic", async () => {
  const { commands } = harness();
  await commands.reorderCue(0, 2);
  assert.equal(commands.getState().runOfService[commands.getState().live.cueIndex].id, "one");
  await commands.duplicateCue(2);
  assert.equal(commands.getState().runOfService[3].name, "One Copy");
  await commands.updateCue(3, { notes: "Auto-saved" });
  assert.equal(commands.getState().runOfService[3].notes, "Auto-saved");
});

test("ID-based Service edits persist authoritative order and delete exactly one duplicate name", async () => {
  const { commands } = harness();
  await commands.reorderCueById("one", "three", "after");
  assert.deepEqual(commands.getState().runOfService.map(cue => cue.id), ["two", "three", "one"]);
  await commands.moveCueById("one", "up");
  assert.deepEqual(commands.getState().runOfService.map(cue => cue.id), ["two", "one", "three"]);
  const renamed = commands.getState();
  renamed.runOfService[0].name = "Duplicate";
  renamed.runOfService[1].name = "Duplicate";
  await commands.replaceState(renamed);
  await commands.deleteCueById("two", { confirmActive: true });
  assert.deepEqual(commands.getState().runOfService.map(cue => cue.id), ["one", "three"]);
});

test("failed Service persistence leaves authoritative stored order unchanged", async () => {
  let persisted = initialState();
  const commands = createOperatorCommands({
    loadState: () => clone(persisted),
    saveState: () => { throw new Error("disk unavailable"); }
  });
  const before = persisted.runOfService.map(cue => cue.id);
  await assert.rejects(commands.reorderCueById("one", "three", "after"), /disk unavailable/);
  assert.deepEqual(persisted.runOfService.map(cue => cue.id), before);
  await assert.rejects(commands.deleteCueById("one", { confirmActive: true }), /disk unavailable/);
  assert.deepEqual(persisted.runOfService.map(cue => cue.id), before);
});

test("large cue jumps require explicit confirmation while NEXT and BACK remain immediate", async () => {
  const { commands } = harness();
  await assert.rejects(commands.goCue(3), error => error.code === "CONFIRM_CUE_JUMP");
  await commands.goCue(3, { confirmJump: true });
  await commands.previousCue();
  assert.equal(commands.getState().live.cueIndex, 1);
});

test("cue-specific lighting overrides execute after reorder while camera overrides remain inert", async () => {
  const { commands } = harness();
  await commands.updateCue(0, { lightingSceneId: "light-manual", cameraLayoutId: "layout" });
  await commands.reorderCue(0, 1);
  await commands.duplicateCue(1);
  const result = await commands.goCue(2);
  assert.equal(result.live.lastLightingSceneId, "light-manual");
  assert.equal(result.live.programPreset, undefined);
});

test("Browser and Electron Production Look commands share authoritative narrow mutations", async () => {
  const { commands } = harness();
  let result = await commands.createProductionLook({ name: "New Look", lightingSceneId: "light-cue" });
  const created = result.productionLooks.at(-1);
  result = await commands.updateProductionLook(created.id, { enabled: false });
  assert.equal(result.productionLooks.at(-1).enabled, false);
  result = await commands.duplicateProductionLook(created.id);
  assert.notEqual(result.productionLooks.at(-1).id, created.id);
  assert.equal(result.productionLooks.at(-1).name, "New Look Copy");
});

test("device configuration commands share serialized authoritative state", async () => {
  const { commands } = harness();
  let result = await commands.createDevice({ id: "camera-four", type: "camera", name: "Fourth", logicalRole: "audience", enabled: false });
  assert.equal(result.devices[0].id, "camera-four");
  result = await commands.updateDevice("camera-four", { name: "Audience", enabled: true });
  assert.equal(result.devices[0].name, "Audience");
  result = await commands.duplicateDevice("camera-four");
  assert.notEqual(result.devices[1].id, "camera-four");
  result = await commands.testDevice("camera-four");
  assert.notEqual(result.devices[0].metadata.diagnostic.message, "Connected");
  result = await commands.deleteDevice(result.devices[1].id);
  assert.equal(result.devices.length, 1);
});

test("deleted cameras remain absent from subsequent authoritative loads", async () => {
  const { commands } = harness();
  await commands.createDevice({ id: "main", type: "camera", name: "Main Camera", logicalRole: "main", enabled: true });
  await commands.createDevice({ id: "user-camera", type: "camera", name: "User Camera", logicalRole: "audience", enabled: true });
  let result = await commands.deleteDevice("main", { confirmReferences: true });
  assert.equal(result.devices.some(device => device.id === "main"), false);
  result = await commands.deleteDevice("user-camera");
  assert.equal(result.devices.some(device => device.id === "user-camera"), false);
  assert.deepEqual(commands.getState().devices, []);
});

test("camera preset commands use the same serialized authoritative state", async () => {
  const { commands } = harness();
  await commands.createDevice({ id: "main", type: "camera", name: "Main Camera", logicalRole: "main", enabled: true });
  let result = await commands.createCameraPreset({ id: "preset-one", cameraDeviceId: "main", name: "Pastor Tight", presetNumber: 1, favorite: true });
  assert.equal(result.cameraPresets[0].name, "Pastor Tight");
  result = await commands.updateCameraPreset("preset-one", { category: "Pastor" });
  assert.equal(result.cameraPresets[0].category, "Pastor");
  result = await commands.duplicateCameraPreset("preset-one");
  assert.notEqual(result.cameraPresets[1].id, "preset-one");
  result = await commands.reorderCameraPreset("main", 0, 1);
  assert.equal(result.cameraPresets[1].id, "preset-one");
  result = await commands.deleteCameraPreset(result.cameraPresets[0].id);
  assert.equal(result.cameraPresets.length, 1);
});

test("Shot commands use serialized authoritative state and preserve deletion references", async () => {
  const { commands } = harness();
  let result = await commands.createShot({ id: "shot-one", name: "Pastor Tight", category: "Pastor", tags: ["sermon"] });
  assert.equal(result.shots[0].name, "Pastor Tight");
  result = await commands.updateShot("shot-one", { favorite: true, enabled: false, category: "Custom" });
  assert.equal(result.shots[0].favorite, true);
  result = await commands.duplicateShot("shot-one");
  const duplicate = result.shots[1];
  assert.notEqual(duplicate.id, "shot-one");
  result = await commands.reorderShot(1, 0);
  assert.equal(result.shots[0].id, duplicate.id);
  result = await commands.deleteShot(duplicate.id);
  assert.deepEqual(result.shots.map(shot => shot.id), ["shot-one"]);
});
