"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cameraExecutionCapabilities, createCameraExecutor } = require("../camera-adapter-registry.cjs");
const { createViscaPresetStorePacket } = require("../ptzoptics-adapter.cjs");
const { findPresetNumberConflict, nextAvailablePresetNumber } = require("../camera-preset-operations.cjs");
const { createOperatorCommands } = require("../operator-commands.cjs");
const { extractPortableState } = require("../backup-operations.cjs");

const source = filename => fs.readFileSync(path.join(__dirname, "..", filename), "utf8");

function state() {
  return {
    devices: [{ id: "main", type: "camera", name: "Main Camera", enabled: true, adapterType: "visca-udp", protocol: "visca-udp", ipAddress: "camera.test", port: 1259 }],
    cameraPresets: [
      { id: "one", name: "Pastor Tight", cameraDeviceId: "main", presetNumber: 1, enabled: true },
      { id: "two", name: "Pastor Medium", cameraDeviceId: "main", presetNumber: 2, enabled: true },
      { id: "three", name: "Choir", cameraDeviceId: "main", presetNumber: 3, enabled: true }
    ],
    shots: [{ id: "motion", name: "Slow Pulpit Push", shotType: "motion", cameraDeviceId: "main", enabled: true }],
    videoSources: [{ id: "main-source", sourceType: "camera", cameraDeviceId: "main" }],
    live: { activityLog: [] }, lightingScenes: [], runOfService: [], productionLooks: [], cameraLayouts: []
  };
}

function harness(current, outcome = { ok: true }) {
  const stores = [];
  const recalls = [];
  let saves = 0;
  const commands = createOperatorCommands({
    loadState: () => current,
    saveState: next => { saves += 1; current = next; return next; },
    cameraExecutorFactory: () => ({
      storePreset: command => { stores.push(command); return outcome; },
      recallPreset: command => { recalls.push(command); return { ok: true }; }
    })
  });
  return { commands, stores, recalls, get current() { return current; }, get saves() { return saves; } };
}

test("adapter capability reports presetStore only for implemented adapters", () => {
  assert.equal(cameraExecutionCapabilities(state().devices[0]).presetStore, true);
  assert.equal(cameraExecutionCapabilities({ type: "camera", adapterType: "unknown" }).presetStore, false);
});

test("VISCA STORE packet uses memory-set operation and preserves address and preset", () => {
  const packet = createViscaPresetStorePacket({ address: 3, presetNumber: 42, sequenceNumber: 7 });
  assert.deepEqual([...packet.subarray(8)], [0x83, 0x01, 0x04, 0x3f, 0x01, 42, 0xff]);
  assert.equal(packet.readUInt32BE(4), 7);
});

test("PTZOptics and VISCA executors dispatch STORE through their native transport exactly once", async () => {
  for (const [camera, transportName] of [
    [{ ...state().devices[0], adapterType: "ptzoptics", protocol: "http", port: 80 }, "ptzopticsStore"],
    [state().devices[0], "viscaUdpStore"]
  ]) {
    const calls = [];
    const executor = createCameraExecutor({ devices: [camera], cameraPresets: [] }, { transports: { [transportName]: input => { calls.push(input); return { ok: true }; } } });
    assert.equal((await executor.storePreset({ cameraDeviceId: "main", presetNumber: 4 })).ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].presetNumber, 4);
  }
});

test("safe allocation avoids camera-scoped numbers and conflict lookup uses stable camera ID", () => {
  const current = state();
  current.devices[0].name = "Renamed Main Camera";
  assert.equal(nextAvailablePresetNumber(current, "main"), 4);
  assert.equal(findPresetNumberConflict(current, "main", 2).id, "two");
  assert.equal(findPresetNumberConflict(current, "other", 2), null);
});

test("SET START and SET END store once, create normal presets, assign references, and send nothing else", async () => {
  const selected = harness(state());
  await selected.commands.storeMotionPreset("main", "motion", "start", { name: "Pastor Wide", presetNumber: 4 });
  await selected.commands.storeMotionPreset("main", "motion", "end", { name: "Pastor Tight Motion End", presetNumber: 5 });
  assert.deepEqual(selected.stores, [
    { cameraDeviceId: "main", presetNumber: 4 },
    { cameraDeviceId: "main", presetNumber: 5 }
  ]);
  assert.equal(selected.recalls.length, 0);
  const shot = selected.current.shots[0];
  const start = selected.current.cameraPresets.find(preset => preset.id === shot.cameraPresetId);
  const end = selected.current.cameraPresets.find(preset => preset.id === shot.motionEndPresetId);
  assert.deepEqual([start.name, start.presetNumber, end.name, end.presetNumber], ["Pastor Wide", 4, "Pastor Tight Motion End", 5]);
  assert.equal("presetType" in start, false);
  assert.equal("presetType" in end, false);
});

test("invalid camera, endpoint, and hardware number send no STORE", async () => {
  const selected = harness(state());
  await assert.rejects(selected.commands.storeMotionPreset("missing", "motion", "start", { name: "A", presetNumber: 4 }), /unavailable/);
  await assert.rejects(selected.commands.storeMotionPreset("main", "motion", "other", { name: "A", presetNumber: 4 }), /endpoint/);
  for (const presetNumber of [-1, 255, 1.5]) await assert.rejects(selected.commands.storeMotionPreset("main", "motion", "end", { name: "A", presetNumber }), /between 0 and 254/);
  assert.equal(selected.stores.length, 0);
});

test("known hardware preset requires explicit reuse or overwrite", async () => {
  const selected = harness(state());
  await assert.rejects(selected.commands.storeMotionPreset("main", "motion", "start", { name: "Changed", presetNumber: 1 }), error => error.code === "CONFIRM_PRESET_OVERWRITE");
  assert.equal(selected.stores.length, 0);
  assert.equal(selected.current.cameraPresets[0].name, "Pastor Tight");
  await selected.commands.storeMotionPreset("main", "motion", "start", { name: "Ignored", presetNumber: 1, reuseExisting: true });
  assert.equal(selected.stores.length, 0);
  assert.equal(selected.current.shots[0].cameraPresetId, "one");
  await selected.commands.storeMotionPreset("main", "motion", "end", { name: "Updated Tight", presetNumber: 1, confirmOverwrite: true });
  assert.equal(selected.stores.length, 1);
  assert.equal(selected.current.cameraPresets[0].name, "Updated Tight");
  assert.equal(selected.current.shots[0].motionEndPresetId, "one");
});

test("failed STORE leaves preset metadata and Motion references untouched", async () => {
  const current = state();
  const before = JSON.stringify(current);
  const selected = harness(current, { ok: false, code: "cameraRejected", message: "Camera rejected preset store" });
  await assert.rejects(selected.commands.storeMotionPreset("main", "motion", "start", { name: "Pastor Wide", presetNumber: 4 }), /rejected/);
  assert.equal(JSON.stringify(selected.current), before);
  assert.equal(selected.saves, 0);
});

test("LIVE camera STORE requires explicit confirmation but does not block reuse", async () => {
  const current = state();
  current.videoSwitcherStatus = { liveSourceId: "main-source" };
  const selected = harness(current);
  await assert.rejects(selected.commands.storeMotionPreset("main", "motion", "start", { name: "Wide", presetNumber: 4 }), error => error.code === "CONFIRM_LIVE_PRESET_STORE");
  assert.equal(selected.stores.length, 0);
  await selected.commands.storeMotionPreset("main", "motion", "start", { name: "Wide", presetNumber: 4, confirmLive: true });
  assert.equal(selected.stores.length, 1);
});

test("stored normal presets remain portable and usable by Static and both Motion endpoints", async () => {
  const selected = harness(state());
  await selected.commands.storeMotionPreset("main", "motion", "start", { name: "Pastor Wide", presetNumber: 4 });
  const presetId = selected.current.shots[0].cameraPresetId;
  selected.current.shots.push({ id: "static", name: "Wide", shotType: "static", cameraDeviceId: "main", cameraPresetId: presetId });
  selected.current.shots[0].motionEndPresetId = presetId;
  const portable = extractPortableState(selected.current);
  assert.equal(portable.cameraPresets.find(preset => preset.id === presetId).presetNumber, 4);
  assert.equal(portable.shots.find(shot => shot.id === "static").cameraPresetId, presetId);
  assert.deepEqual([portable.shots[0].cameraPresetId, portable.shots[0].motionEndPresetId], [presetId, presetId]);
});

test("desktop exposes assisted STORE and explicit VERIFY while iPad remains authoring-free", () => {
  const desktop = source("public/app.js");
  const preload = source("preload.cjs");
  const ipad = source("public/operator/operator.js");
  assert.match(desktop, /SET \$\{endpoint\.toUpperCase\(\)\}/);
  assert.match(desktop, /REUSE EXISTING PRESET/);
  assert.match(desktop, /OVERWRITE PRESET/);
  assert.match(desktop, /data-motion-verify/);
  assert.match(preload, /motion-studio:store-preset/);
  assert.doesNotMatch(ipad, /storeMotionPreset|SET START|SET END|preset STORE/);
});
