const test = require("node:test");
const assert = require("node:assert/strict");
const { effectiveCueResources, executeCue } = require("../cue-execution.cjs");

function state() {
  return {
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
      lightingOverrideId: "manual-light",
      activityLog: []
    }
  };
}

test("cue-specific lighting and camera resources override the Production Look", () => {
  const result = executeCue(state(), 1, { now: () => 1234 });

  assert.equal(result.live.cueIndex, 1);
  assert.equal(result.live.cueStartedAt, 1234);
  assert.equal(result.live.lastLightingSceneId, "light-override");
  assert.equal(result.live.lightingOverrideId, "light-override");
  assert.equal(result.live.programCamera, "right");
  assert.equal(result.live.programPreset, "Tight");
  assert.equal(result.live.previewCamera, "main");
  assert.equal(result.live.previewPreset, "Wide");
  assert.equal(result.live.tracking, true);
  assert.equal(result.live.activityLog[0].message, "Cue started: Custom cue");
});

test("legacy saved cues fall back to their Production Look resources", () => {
  const legacyState = state();
  const resources = effectiveCueResources(legacyState, legacyState.runOfService[0]);
  const result = executeCue(legacyState, 0, { now: () => 5678 });

  assert.deepEqual(resources, {
    lightingSceneId: "light-default",
    cameraLayoutId: "camera-default"
  });
  assert.equal(result.live.lastLightingSceneId, "light-default");
  assert.equal(result.live.lightingOverrideId, null);
  assert.equal(result.live.programCamera, "main");
  assert.equal(result.live.programPreset, "Wide");
});

test("GO, NEXT, and BACK target indices share identical cue execution behavior", () => {
  const go = executeCue(state(), 1, { now: () => 1 });
  const nextState = state();
  const next = executeCue(nextState, nextState.live.cueIndex + 1, { now: () => 1 });
  const backState = state();
  backState.live.cueIndex = 1;
  const back = executeCue(backState, backState.live.cueIndex - 1, { now: () => 1 });

  assert.deepEqual(next.live, go.live);
  assert.equal(back.live.cueIndex, 0);
  assert.equal(back.live.lastLightingSceneId, "light-default");
  assert.equal(back.live.programCamera, "main");
});
