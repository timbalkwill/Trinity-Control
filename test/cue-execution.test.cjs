const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyLook,
  effectiveCueResources,
  executeCue
} = require("../cue-execution.cjs");

function state() {
  return {
    lightingScenes: [
      { id: "light-default" },
      { id: "light-override" }
    ],
    productionLooks: [{
      id: "look-default",
      lightingSceneId: "light-default",
      cameraLayoutId: "camera-default"
    }],
    cameraLayouts: [
      {
        id: "camera-default",
        programCamera: "main",
        programPreset: "Wide",
        previewCamera: "left",
        previewPreset: "Left",
        tracking: false
      },
      {
        id: "camera-override",
        programCamera: "right",
        programPreset: "Tight",
        previewCamera: "main",
        previewPreset: "Wide",
        tracking: true
      }
    ],
    runOfService: [
      { id: "legacy", name: "Legacy cue", productionLookId: "look-default" },
      {
        id: "custom",
        name: "Custom cue",
        productionLookId: "look-default",
        lightingSceneId: "light-override",
        cameraLayoutId: "camera-override"
      }
    ],
    live: {
      cueIndex: 0,
      hold: true,
      lightingOverrideId: "manual-light",
      activityLog: []
    }
  };
}

test("valid cue resources override the Production Look", () => {
  const result = executeCue(state(), 1, { now: () => 1234 });

  assert.equal(result.live.cueIndex, 1);
  assert.equal(result.live.cueStartedAt, 1234);
  assert.equal(result.live.lastLightingSceneId, "light-override");
  assert.equal(result.live.lightingOverrideId, null);
  assert.equal(result.live.programCamera, "right");
  assert.equal(result.live.programPreset, "Tight");
  assert.equal(result.live.previewCamera, "main");
  assert.equal(result.live.previewPreset, "Wide");
  assert.equal(result.live.tracking, true);
  assert.equal(result.live.hold, true);
});

test("legacy cues with missing override fields inherit Production Look resources", () => {
  const legacyState = state();
  const resources = effectiveCueResources(legacyState, legacyState.runOfService[0]);

  assert.deepEqual(resources, {
    lightingSceneId: "light-default",
    cameraLayoutId: "camera-default"
  });
});

test("empty-string overrides inherit Production Look resources", () => {
  const current = state();
  const cue = {
    productionLookId: "look-default",
    lightingSceneId: "",
    cameraLayoutId: ""
  };

  assert.deepEqual(effectiveCueResources(current, cue), {
    lightingSceneId: "light-default",
    cameraLayoutId: "camera-default"
  });
});

test("invalid cue lighting falls back to Production Look lighting", () => {
  const current = state();
  const cue = { productionLookId: "look-default", lightingSceneId: "missing-light" };
  assert.equal(effectiveCueResources(current, cue).lightingSceneId, "light-default");
});

test("invalid cue camera layout falls back to Production Look camera layout", () => {
  const current = state();
  const cue = { productionLookId: "look-default", cameraLayoutId: "missing-camera" };
  assert.equal(effectiveCueResources(current, cue).cameraLayoutId, "camera-default");
});

test("invalid cue and Production Look resource IDs resolve to null", () => {
  const current = state();
  current.productionLooks[0].lightingSceneId = "missing-look-light";
  current.productionLooks[0].cameraLayoutId = "missing-look-camera";
  const cue = {
    productionLookId: "look-default",
    lightingSceneId: "missing-cue-light",
    cameraLayoutId: "missing-cue-camera"
  };

  assert.deepEqual(effectiveCueResources(current, cue), {
    lightingSceneId: null,
    cameraLayoutId: null
  });
  assert.deepEqual(effectiveCueResources(current, {
    productionLookId: "missing-look",
    lightingSceneId: "missing-cue-light",
    cameraLayoutId: "missing-cue-camera"
  }), {
    lightingSceneId: null,
    cameraLayoutId: null
  });
});

for (const [command, targetIndex] of [
  ["GO", () => 1],
  ["NEXT", current => current.live.cueIndex + 1],
  ["BACK", current => current.live.cueIndex - 1]
]) {
  test(`${command} clears an existing manual lighting override`, () => {
    const current = state();
    if (command === "BACK") current.live.cueIndex = 1;
    const result = executeCue(current, targetIndex(current), { now: () => 1 });
    assert.equal(result.live.lightingOverrideId, null);
  });
}

test("an empty run of service does not throw or replace state", () => {
  const current = state();
  current.runOfService = [];
  const result = executeCue(current, 0);
  assert.equal(result, current);
  assert.equal(result.live.lightingOverrideId, "manual-light");
});

test("a missing cue and missing resource arrays are handled safely", () => {
  const current = { runOfService: new Array(1), live: { hold: true } };
  const result = executeCue(current, 0);
  assert.equal(result, current);
  assert.deepEqual(result.live, { hold: true });
});

test("cue execution initializes missing live state without replacing the state object", () => {
  const current = state();
  delete current.live;
  const result = executeCue(current, 0, { now: () => 2 });
  assert.equal(result, current);
  assert.equal(result.live.lastLightingSceneId, "light-default");
  assert.equal(result.live.lightingOverrideId, null);
});

test("Production Look compatibility execution applies resources and clears manual lighting", () => {
  const current = state();
  const result = applyLook(current, "look-default");
  assert.equal(result, current);
  assert.equal(result.live.lastLightingSceneId, "light-default");
  assert.equal(result.live.lightingOverrideId, null);
  assert.equal(result.live.programCamera, "main");
  assert.equal(result.live.programPreset, "Wide");
});

test("Production Look compatibility execution safely ignores a missing look", () => {
  const current = state();
  const live = { ...current.live };
  const result = applyLook(current, "missing-look");
  assert.equal(result, current);
  assert.deepEqual(result.live, live);
});
