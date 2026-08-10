"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createShot, deleteShot, duplicateShot, migrateShots, normalizeShot, resolveShotExecution, updateShot
} = require("../shot-operations.cjs");
const { cameraExecutionCapabilities } = require("../camera-adapter-registry.cjs");
const { createOperatorCommands } = require("../operator-commands.cjs");
const { extractPortableState } = require("../backup-operations.cjs");

const source = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const state = () => ({
  devices: [
    { id: "main", type: "camera", name: "Main Camera", enabled: true, adapterType: "visca-udp", protocol: "visca-udp", ipAddress: "camera.invalid", port: 1259 },
    { id: "left", type: "camera", name: "Left PTZ", enabled: true, adapterType: "visca-udp", protocol: "visca-udp", ipAddress: "camera.invalid", port: 1259 }
  ],
  cameraPresets: [
    { id: "main-wide", name: "Pulpit Wide", cameraDeviceId: "main", enabled: true, presetNumber: 1 },
    { id: "main-tight", name: "Pulpit Tight", cameraDeviceId: "main", enabled: true, presetNumber: 2 },
    { id: "left-wide", name: "Choir Wide", cameraDeviceId: "left", enabled: true, presetNumber: 1 }
  ],
  shots: [], productionLooks: [], runOfService: [], cueTemplates: [], lightingScenes: [],
  live: { cueIndex: 0, activityLog: [], cameraPreparations: [] }, settings: {}
});

const motion = (overrides = {}) => ({
  id: "motion", name: "Slow Pulpit Push", shotType: "motion", enabled: true,
  cameraDeviceId: "main", cameraPresetId: "main-wide", motionEndPresetId: "main-tight",
  motionStyle: "pushIn", motionSpeedSetting: "slow", motionTargetDurationMs: 8000, ...overrides
});

test("Motion Shot creation requires a name and keeps stable camera-scoped preset IDs", () => {
  const current = state();
  const created = createShot(current, motion(), { id: "motion", now: 1 });
  assert.equal(created.cameraDeviceId, "main");
  assert.equal(created.cameraPresetId, "main-wide");
  assert.equal(created.motionEndPresetId, "main-tight");
  assert.throws(() => createShot(current, motion({ id: "blank", name: "  " })), /name is required/i);
  assert.throws(() => createShot(current, motion({ id: "cross", motionEndPresetId: "left-wide" })), /belongs to another camera/i);
});

test("missing Start and End presets remain stored but resolve Needs Attention", () => {
  const current = state();
  current.shots = [normalizeShot(motion({ cameraPresetId: "missing-start", motionEndPresetId: "missing-end" }))];
  const execution = resolveShotExecution(current, current.shots[0]);
  assert.equal(execution.valid, false);
  assert.match(execution.errors.join(" "), /Missing start preset/);
  assert.match(execution.errors.join(" "), /Missing end preset/);
  assert.equal(current.shots.length, 1);
});

test("legacy speed metadata migrates idempotently and new intent metadata persists", () => {
  const legacy = { id: "legacy", name: "Legacy", shotType: "motion", motionSpeedSetting: "verySlow", motionDurationMs: 6000, custom: "keep" };
  const once = migrateShots([legacy])[0];
  const twice = migrateShots([once])[0];
  assert.equal(once.motionSpeedSetting, "verySlow");
  assert.equal(once.motionDurationMs, 6000);
  assert.equal(once.motionTargetDurationMs, 6000);
  assert.equal(once.motionStyle, "presetTransition");
  assert.deepEqual(twice, once);

  const current = state();
  createShot(current, motion(), { id: "motion", now: 1 });
  updateShot(current, "motion", { motionStyle: "reveal", motionSpeedSetting: "medium", motionTargetDurationMs: 5000 }, { now: 2 });
  assert.equal(current.shots[0].motionStyle, "reveal");
  assert.equal(current.shots[0].motionTargetDurationMs, 5000);
});

test("unknown legacy Motion style is preserved for Needs Review rather than guessed", () => {
  const shot = normalizeShot({ name: "Legacy", shotType: "motion", motionStyle: "legacyOrbit" });
  assert.equal(shot.motionStyle, "legacyOrbit");
  assert.equal(resolveShotExecution(state(), shot).motion.style.recognized, false);
});

test("duplicate preserves intent with a new Shot ID and delete preserves unrelated data", () => {
  const current = state();
  createShot(current, motion(), { id: "motion", now: 1 });
  current.shots.push(normalizeShot({ id: "other", name: "Other" }));
  const copy = duplicateShot(current, "motion", { id: "copy", now: 2 });
  assert.equal(copy.id, "copy");
  assert.equal(copy.motionStyle, "pushIn");
  assert.equal(copy.motionTargetDurationMs, 8000);
  deleteShot(current, "motion");
  assert.ok(current.shots.some(item => item.id === "other"));
  assert.ok(current.shots.some(item => item.id === "copy"));
});

test("adapter capability model truthfully exposes preset-only execution", () => {
  const capability = cameraExecutionCapabilities(state().devices[0]);
  assert.equal(capability.presetRecall, true);
  assert.equal(capability.presetTransition, true);
  assert.equal(capability.presetSpeedControl, false);
  assert.equal(capability.durationControl, false);
  assert.equal(capability.motionStop, false);
  assert.equal(capability.panTiltVelocity, false);
  assert.equal(capability.zoomVelocity, false);
});

test("Prepare Start recalls only Start once and invokes no ATEM or lighting path", async () => {
  let current = state();
  current.shots = [normalizeShot(motion())];
  const recalls = [];
  let atemCommands = 0;
  let lightingCommands = 0;
  const commands = createOperatorCommands({
    loadState: () => current,
    saveState: next => (current = next),
    cameraExecutorFactory: () => ({ recallPreset: command => { recalls.push(command); return { ok: true }; } }),
    lightingExecutorFactory: () => ({ execute: () => { lightingCommands += 1; } }),
    cueExecutor: () => { atemCommands += 1; }
  });
  await commands.prepareMotionStart("main", "motion");
  assert.deepEqual(recalls, [{ cameraDeviceId: "main", presetId: "main-wide" }]);
  assert.equal(atemCommands, 0);
  assert.equal(lightingCommands, 0);
  assert.equal(current.live.cameraPreparations.find(item => item.cameraId === "main")?.preparedAssignment, undefined);
  assert.equal(commands.getPreparedMotion("main").startPresetId, "main-wide");
});

test("Run Motion reuses manual executor, recalls End once, and sends no ATEM or lighting command", async () => {
  let current = state();
  current.shots = [normalizeShot(motion())];
  const recalls = [];
  let otherCommands = 0;
  const commands = createOperatorCommands({
    loadState: () => current,
    saveState: next => (current = next),
    cameraExecutorFactory: () => ({ recallPreset: command => { recalls.push(command); return { ok: true }; } }),
    lightingExecutorFactory: () => ({ execute: () => { otherCommands += 1; } }),
    cueExecutor: () => { otherCommands += 1; }
  });
  await commands.runCameraMotion("main", "motion");
  assert.equal(recalls.length, 1);
  assert.equal(recalls[0].presetId, "main-tight");
  assert.equal(otherCommands, 0);
});

test("Motion metadata is portable while runtime command state is excluded", () => {
  const current = state();
  current.shots = [normalizeShot(motion())];
  current.live.manualMotionCommands = { main: { shotId: "motion" } };
  const portable = extractPortableState(current);
  assert.equal(portable.shots[0].motionStyle, "pushIn");
  assert.equal(portable.shots[0].motionTargetDurationMs, 8000);
  assert.equal(portable.live, undefined);
});

test("Motion Studio and Live present intent truthfully without fake controls", () => {
  const renderer = source("public/app.js");
  const studio = renderer.slice(renderer.indexOf("function shotsPage()"), renderer.indexOf("function deviceConfigured"));
  const live = renderer.slice(renderer.indexOf("function CameraDirectorCard"), renderer.indexOf("function livePage"));
  assert.match(studio, /MOTION STUDIO/);
  assert.match(studio, /\+ NEW MOTION SHOT/);
  assert.match(studio, /motionStyle/);
  assert.match(studio, /Target Duration/);
  assert.match(studio, /Trinity speed control not available/);
  assert.match(studio, /Stop Motion not available/);
  assert.match(studio, /prepareMotionStart/);
  assert.match(studio, /runCameraMotion/);
  assert.match(live, /styleLabel.*speedLabel/s);
  assert.doesNotMatch(studio, /data-motion-stop|stopMotion\(/);
});

test("GO and BACK retain zero Motion commands and iPad has no Motion editor", () => {
  const cue = source("cue-execution.cjs");
  const plan = source("cue-execution-plan.cjs");
  const operator = source("public/operator/operator.js");
  assert.doesNotMatch(cue, /executeManualMotion|runCameraMotion|prepareMotionStart/);
  assert.doesNotMatch(plan, /executeManualMotion|runCameraMotion|prepareMotionStart/);
  assert.doesNotMatch(operator, /motionStyle.*select|motionTargetDuration.*input/);
  assert.match(operator, /data-action="prepare-motion"/);
});

test("desktop capability IPC is read-only and uses the adapter registry", () => {
  const preload = source("preload.cjs");
  const main = source("electron-main.cjs");
  const commands = source("operator-commands.cjs");
  assert.match(preload, /getCameraExecutionCapabilities/);
  assert.match(main, /camera:execution-capabilities/);
  assert.match(commands, /cameraExecutionCapabilities\(camera\)/);
});
