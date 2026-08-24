"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { executeCue } = require("../cue-execution.cjs");
const { normalizeProductionLook } = require("../production-look-operations.cjs");

test("legacy simplified Look camera fields remain loadable", () => {
  const look = normalizeProductionLook({
    id: "look", name: "Legacy", lightingSceneId: "warm", priorityCameraId: "left",
    cameraPresets: { main: "main-wide", left: "left-tight" }, startMainTracking: true,
    cameraAssignments: [{ role: "main", cameraId: "main", presetId: "main-wide", shotId: "shot" }]
  });
  assert.equal(look.id, "look");
  assert.equal(look.priorityCameraId, "left");
  assert.equal(look.cameraAssignments[0].shotId, "shot");
});

test("simplified Look execution applies lighting and preserves independent cameras", () => {
  const current = {
    lightingScenes: [{ id: "warm", name: "Warm" }],
    productionLooks: [{
      id: "look", name: "Legacy", enabled: true, lightingSceneId: "warm", priorityCameraId: "left",
      cameraPresets: { main: "main-wide" }, startMainTracking: true,
      cameraAssignments: [{ role: "main", cameraId: "main", presetId: "main-wide", shotId: "shot" }]
    }],
    runOfService: [{ id: "cue", productionLookId: "look" }],
    live: {
      programCamera: "main", previewCamera: "right",
      cameraPreparations: [{ cameraId: "main", selectedPresetId: "manual", tracking: { active: false } }]
    }
  };
  const before = JSON.parse(JSON.stringify({
    programCamera: current.live.programCamera,
    previewCamera: current.live.previewCamera,
    cameraPreparations: current.live.cameraPreparations
  }));
  executeCue(current, 0, { cameraExecutor: () => { throw new Error("must not execute"); } });
  assert.equal(current.live.lastLightingSceneId, "warm");
  assert.deepEqual({
    programCamera: current.live.programCamera,
    previewCamera: current.live.previewCamera,
    cameraPreparations: current.live.cameraPreparations
  }, before);
  assert.equal(Object.hasOwn(current.live.executionSnapshot, "simplifiedLook"), false);
});

test("desktop Looks editor retains legacy compatibility controls without an execution side effect", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(source, /Production Look/);
  assert.doesNotMatch(source, /applyCueStartPreparations/);
});
