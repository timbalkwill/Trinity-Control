const test = require("node:test");
const assert = require("node:assert/strict");
const { createOperatorCommands } = require("../operator-commands.cjs");

const clone = value => JSON.parse(JSON.stringify(value));

function initialState() {
  return {
    lightingScenes: [{ id: "light-cue", name: "Cue" }, { id: "light-manual", name: "Manual" }],
    productionLooks: [{ id: "look", lightingSceneId: "light-cue", cameraLayoutId: "layout" }],
    cameraLayouts: [{ id: "layout", programCamera: "main", programPreset: "Wide", previewCamera: "left", previewPreset: "Left" }],
    runOfService: [
      { id: "one", name: "One", productionLookId: "look" },
      { id: "two", name: "Two", productionLookId: "look" },
      { id: "three", name: "Three", productionLookId: "look" }
    ],
    live: { cueIndex: 0, hold: false, lightingOverrideId: null, activityLog: [] }
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

test("shared operator commands execute GO, NEXT, BACK, HOLD, and lighting actions", async () => {
  const { commands } = harness();
  assert.equal((await commands.goCue(2)).live.cueIndex, 2);
  assert.equal((await commands.previousCue()).live.cueIndex, 1);
  assert.equal((await commands.nextCue()).live.cueIndex, 2);
  assert.equal((await commands.toggleHold()).live.hold, true);
  assert.equal((await commands.setLightingOverride("light-manual")).live.lightingOverrideId, "light-manual");
  assert.equal((await commands.returnToCueLighting()).live.lightingOverrideId, null);
});

test("shared commands serialize writes and publish authoritative saved snapshots", async () => {
  const { commands } = harness();
  const published = [];
  commands.subscribe(state => published.push(state));
  await Promise.all([commands.nextCue(), commands.nextCue()]);
  assert.equal(commands.getState().live.cueIndex, 2);
  assert.deepEqual(published.map(state => state.live.cueIndex), [1, 2]);
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

test("lighting overrides require an existing scene", async () => {
  const { commands } = harness();
  await assert.rejects(commands.setLightingOverride("missing"), /Unknown lighting scene/);
});
