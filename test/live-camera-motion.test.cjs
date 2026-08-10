"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createOperatorCommands } = require("../operator-commands.cjs");

const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
  return {
    devices: ["main", "left", "right"].map(id => ({
      id, type: "camera", name: `${id} camera`, enabled: true,
      adapterType: "ptzoptics", protocol: "visca-udp", ipAddress: `${id}.camera.local`
    })),
    cameraPresets: ["main", "left", "right"].flatMap(cameraDeviceId => ["start", "end"].map((position, index) => ({
      id: `${cameraDeviceId}-${position}`, name: `${position} position`, cameraDeviceId, presetNumber: index + 1, enabled: true
    }))),
    shots: ["main", "left", "right"].map(cameraDeviceId => ({
      id: `${cameraDeviceId}-move`, name: `${cameraDeviceId} move`, shotType: "motion", enabled: true,
      cameraDeviceId, cameraPresetId: `${cameraDeviceId}-start`, motionEndPresetId: `${cameraDeviceId}-end`, motionSpeedSetting: "slow"
    })).concat({
      id: "tracking", name: "tracking", shotType: "tracking", enabled: true,
      cameraDeviceId: "main", cameraPresetId: "main-start"
    }),
    runOfService: [{ id: "cue", name: "Cue" }],
    live: { cueIndex: 0, activityLog: [] }
  };
}

function harness(outcome = { ok: true, message: "accepted" }) {
  let persisted = fixture();
  const cameraCalls = [];
  const commands = createOperatorCommands({
    loadState: () => clone(persisted),
    saveState: state => { persisted = clone(state); return clone(persisted); },
    cameraExecutorFactory: () => ({
      recallPreset(command) { cameraCalls.push({ ...command }); return outcome; }
    })
  });
  return { commands, cameraCalls, state: () => clone(persisted), replace: value => { persisted = clone(value); } };
}

for (const cameraId of ["main", "left", "right"]) {
  test(`manual ${cameraId} Motion Shot commands only its end preset exactly once`, async () => {
    const { commands, cameraCalls, state } = harness();
    const before = state();
    await commands.runCameraMotion(cameraId, `${cameraId}-move`);
    assert.deepEqual(cameraCalls, [{ cameraDeviceId: cameraId, presetId: `${cameraId}-end`, shotId: `${cameraId}-move` }]);
    assert.equal(state().live.cueIndex, before.live.cueIndex);
    assert.equal(state().live.programCamera, undefined);
    assert.equal(state().live.previewCamera, undefined);
    assert.equal(state().live.lastLightingSceneId, undefined);
    assert.equal(state().live.manualMotionCommands[cameraId].status, "commanded");
    assert.equal(state().live.manualMotionCommands[cameraId].startPresetId, `${cameraId}-start`);
    assert.equal(state().live.manualMotionCommands[cameraId].endPresetId, `${cameraId}-end`);
  });
}

test("motion execution rejects cross-camera, missing, disabled, static, and tracking definitions before transport", async () => {
  const cases = [
    state => { state.shots[0].motionEndPresetId = "left-end"; },
    state => { state.shots[0].cameraPresetId = "missing"; },
    state => { state.cameraPresets.find(item => item.id === "main-end").enabled = false; },
    state => { state.shots[0].shotType = "static"; },
    state => { state.shots[0] = state.shots.find(item => item.id === "tracking"); }
  ];
  for (const mutate of cases) {
    const harnessState = harness();
    const changed = harnessState.state();
    mutate(changed);
    harnessState.replace(changed);
    await assert.rejects(harnessState.commands.runCameraMotion("main", changed.shots[0].id));
    assert.equal(harnessState.cameraCalls.length, 0);
  }
});

test("failed adapter outcome is surfaced and never recorded as Last Commanded Motion", async () => {
  const { commands, cameraCalls, state } = harness({ ok: false, code: "offline", message: "Camera offline" });
  await assert.rejects(commands.runCameraMotion("main", "main-move"), /Camera offline/);
  assert.equal(cameraCalls.length, 1);
  assert.equal(state().live.manualMotionCommands, undefined);
});

test("renderer prepares authoritative Motion shots for the camera with independent scrolling and truthful feedback", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const card = renderer.slice(renderer.indexOf("function CameraDirectorCard"), renderer.indexOf("function livePage"));
  assert.match(card, /shot\.shotType === 'motion' && shot\.cameraDeviceId === camera\.id/);
  assert.match(card, /data-scroll-key="camera-presets-/);
  assert.match(card, /data-scroll-key="camera-motion-/);
  assert.match(card, /data-prepare-motion-camera=.*camera\.id/);
  assert.match(card, /data-prepare-motion-shot=.*shot\.id/);
  assert.match(card, /Last Motion:/);
  assert.match(renderer, /window\.trinity\.prepareMotionStart/);
  assert.match(renderer, /PREPARING…/);
  assert.match(renderer, /FAILED:/);
  assert.doesNotMatch(card, /data-stop-motion|STOP MOTION/);
  assert.ok(card.indexOf("camera-motion-section") < card.indexOf("data-atem-take-live"));
});

test("IPC and preload expose the same manual motion command without changing ATEM transport", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.cjs"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "electron-main.cjs"), "utf8");
  assert.match(preload, /runCameraMotion: \(cameraId, shotId\) => ipcRenderer\.invoke\("live:runCameraMotion", \{ cameraId, shotId \}\)/);
  assert.match(main, /ipcMain\.handle\("live:runCameraMotion".*commands\.runCameraMotion\(cameraId, shotId\)/);
});
