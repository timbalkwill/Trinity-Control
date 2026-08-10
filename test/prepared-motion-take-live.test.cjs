"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createOperatorCommands } = require("../operator-commands.cjs");
const { createPreparedMotionState } = require("../prepared-motion-state.cjs");
const { createPreparedMotionTakeLive } = require("../prepared-motion-take-live.cjs");
const { extractPortableState } = require("../backup-operations.cjs");

const source = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const fixture = () => ({
  devices: [
    { id: "main", type: "camera", name: "Main", enabled: true, adapterType: "visca-udp", protocol: "visca-udp", ipAddress: "test.invalid", port: 1259 },
    { id: "left", type: "camera", name: "Left", enabled: true, adapterType: "visca-udp", protocol: "visca-udp", ipAddress: "test.invalid", port: 1259 }
  ],
  cameraPresets: [
    { id: "main-start", name: "Main Start", cameraDeviceId: "main", enabled: true, presetNumber: 1 },
    { id: "main-end", name: "Main End", cameraDeviceId: "main", enabled: true, presetNumber: 2 },
    { id: "left-start", name: "Left Start", cameraDeviceId: "left", enabled: true, presetNumber: 1 },
    { id: "left-end", name: "Left End", cameraDeviceId: "left", enabled: true, presetNumber: 2 }
  ],
  shots: ["main", "left"].map(id => ({
    id: `${id}-motion`, name: `${id} Motion`, shotType: "motion", enabled: true,
    cameraDeviceId: id, cameraPresetId: `${id}-start`, motionEndPresetId: `${id}-end`,
    motionStyle: "reveal", motionSpeedSetting: "slow", motionTargetDurationMs: 5000
  })),
  productionLooks: [], runOfService: [{ id: "cue", name: "Cue" }], cueTemplates: [], lightingScenes: [],
  live: { cueIndex: 0, activityLog: [], cameraPreparations: [] }, settings: {}
});

function harness({ recall = () => ({ ok: true }) } = {}) {
  let current = fixture();
  let saves = 0;
  const preparedMotionState = createPreparedMotionState({ now: () => 100 });
  const commands = createOperatorCommands({
    loadState: () => current,
    saveState: next => { saves += 1; current = next; return next; },
    preparedMotionState,
    cameraExecutorFactory: () => ({ recallPreset: recall })
  });
  return { commands, current: () => current, saves: () => saves };
}

function atem(initialLive = "main") {
  let liveCameraId = initialLive;
  let calls = 0;
  let resolver = null;
  return {
    service: {
      getStatus: () => ({ liveCameraId }),
      takeLive: cameraId => {
        calls += 1;
        return new Promise(resolve => { resolver = () => { liveCameraId = cameraId; resolve({ liveCameraId }); }; });
      }
    },
    confirm: () => resolver?.(),
    setPhysical: cameraId => { liveCameraId = cameraId; },
    calls: () => calls
  };
}

test("Prepare recalls Start once and creates runtime-only prepared state after success", async () => {
  const recalls = [];
  const h = harness({ recall: command => { recalls.push(command); return { ok: true }; } });
  const returned = await h.commands.prepareMotionStart("left", "left-motion");
  assert.deepEqual(recalls, [{ cameraDeviceId: "left", presetId: "left-start" }]);
  assert.equal(returned.live.preparedMotions.left.status, "ready");
  assert.equal(h.commands.getPreparedMotion("left").shotId, "left-motion");
  assert.equal("preparedMotions" in h.current().live, false);
  assert.equal(h.current().live.cameraPreparations?.find(item => item.cameraId === "left")?.preparedAssignment, undefined);
  assert.equal(extractPortableState(returned).live, undefined);
});

test("failed Prepare creates no prepared state", async () => {
  const h = harness({ recall: () => ({ ok: false, message: "offline" }) });
  await assert.rejects(h.commands.prepareMotionStart("left", "left-motion"), /offline/);
  assert.equal(h.commands.getPreparedMotion("left"), null);
});

test("one prepared Motion per camera replaces only that camera", async () => {
  const h = harness();
  await h.commands.prepareMotionStart("main", "main-motion");
  await h.commands.prepareMotionStart("left", "left-motion");
  assert.equal(h.commands.getPreparedMotion("main").shotId, "main-motion");
  assert.equal(h.commands.getPreparedMotion("left").shotId, "left-motion");
  h.current().shots.push({ ...h.current().shots[0], id: "main-other", name: "Other" });
  await h.commands.prepareMotionStart("main", "main-other");
  assert.equal(h.commands.getPreparedMotion("main").shotId, "main-other");
  assert.equal(h.commands.getPreparedMotion("left").shotId, "left-motion");
});

test("same-camera static recall invalidates preparation while another camera does not", async () => {
  const h = harness();
  await h.commands.prepareMotionStart("left", "left-motion");
  await h.commands.recallCameraPreset("main", "main-start");
  assert.ok(h.commands.getPreparedMotion("left"));
  await h.commands.recallCameraPreset("left", "left-start");
  assert.equal(h.commands.getPreparedMotion("left"), null);
});

test("cancel preparation publishes runtime state and sends no camera or ATEM command", async () => {
  let cameraCalls = 0;
  const h = harness({ recall: () => { cameraCalls += 1; return { ok: true }; } });
  await h.commands.prepareMotionStart("left", "left-motion");
  cameraCalls = 0;
  const returned = await h.commands.cancelPreparedMotion("left");
  assert.equal(cameraCalls, 0);
  assert.equal(returned.live.preparedMotions.left, undefined);
});

test("TAKE LIVE without preparation switches ATEM only after confirmation", async () => {
  const h = harness({ recall: () => { throw new Error("camera should not move"); } });
  const a = atem("main");
  const coordinator = createPreparedMotionTakeLive({ commands: h.commands, atemService: a.service });
  const taking = coordinator.takeLive("left");
  assert.equal(a.calls(), 1);
  a.confirm();
  const result = await taking;
  assert.equal(result.motion, null);
  assert.equal(a.service.getStatus().liveCameraId, "left");
});

test("prepared Motion waits for confirmed PROGRAM then commands End exactly once", async () => {
  const recalls = [];
  const h = harness({ recall: command => { recalls.push(command); return { ok: true }; } });
  await h.commands.prepareMotionStart("left", "left-motion");
  recalls.length = 0;
  const a = atem("main");
  const coordinator = createPreparedMotionTakeLive({ commands: h.commands, atemService: a.service });
  const taking = coordinator.takeLive("left");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(recalls.length, 0);
  assert.equal(h.commands.getPreparedMotion("left").status, "taking-live");
  a.confirm();
  const result = await taking;
  assert.equal(result.motion, "commanded");
  assert.deepEqual(recalls, [{ cameraDeviceId: "left", presetId: "left-end", shotId: "left-motion" }]);
  assert.equal(h.commands.getPreparedMotion("left"), null);
  assert.equal(a.service.getStatus().liveCameraId, "left");
  assert.equal(a.calls(), 1);
});

test("failed ATEM switch preserves preparation and sends no Motion command", async () => {
  const recalls = [];
  const h = harness({ recall: command => { recalls.push(command); return { ok: true }; } });
  await h.commands.prepareMotionStart("left", "left-motion");
  recalls.length = 0;
  const atemService = { getStatus: () => ({ liveCameraId: "main" }), takeLive: async () => { throw new Error("switch failed"); } };
  const coordinator = createPreparedMotionTakeLive({ commands: h.commands, atemService });
  await assert.rejects(coordinator.takeLive("left"), /switch failed/);
  assert.equal(recalls.length, 0);
  assert.equal(h.commands.getPreparedMotion("left").status, "ready");
});

test("duplicate TAKE LIVE shares one transaction and cannot duplicate Motion", async () => {
  const recalls = [];
  const h = harness({ recall: command => { recalls.push(command); return { ok: true }; } });
  await h.commands.prepareMotionStart("left", "left-motion");
  recalls.length = 0;
  const a = atem("main");
  const coordinator = createPreparedMotionTakeLive({ commands: h.commands, atemService: a.service });
  const first = coordinator.takeLive("left");
  const second = coordinator.takeLive("left");
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  a.confirm();
  await Promise.all([first, second]);
  assert.equal(a.calls(), 1);
  assert.equal(recalls.length, 1);
});

test("already-LIVE prepared camera runs explicitly without redundant ATEM switch", async () => {
  const recalls = [];
  const h = harness({ recall: command => { recalls.push(command); return { ok: true }; } });
  await h.commands.prepareMotionStart("main", "main-motion");
  recalls.length = 0;
  const a = atem("main");
  const coordinator = createPreparedMotionTakeLive({ commands: h.commands, atemService: a.service });
  await coordinator.takeLive("main");
  assert.equal(a.calls(), 0);
  assert.equal(recalls[0].presetId, "main-end");
});

test("physical ATEM changes and other-camera switches do not consume prepared Motion", async () => {
  const h = harness();
  await h.commands.prepareMotionStart("left", "left-motion");
  const a = atem("main");
  a.setPhysical("left");
  assert.equal(h.commands.getPreparedMotion("left").status, "ready");
  a.setPhysical("main");
  assert.equal(h.commands.getPreparedMotion("left").status, "ready");
});

test("new command host starts with no restored prepared state", async () => {
  const first = harness();
  await first.commands.prepareMotionStart("left", "left-motion");
  const saved = first.current();
  const secondState = createPreparedMotionState();
  assert.equal(secondState.get("left"), null);
  assert.equal("preparedMotions" in saved.live, false);
});

test("desktop and iPad expose synchronized Prepare → Take Live workflow without Motion editing", () => {
  const desktop = source("public/app.js");
  const ipad = source("public/operator/operator.js");
  const server = source("operator-server.cjs");
  assert.match(desktop, /data-prepare-motion-camera/);
  assert.match(desktop, /TAKE LIVE \+ MOVE/);
  assert.match(desktop, /RUN PREPARED MOVE/);
  assert.match(ipad, /prepare-motion/);
  assert.match(ipad, /READY \/ START COMMANDED|statusLabel/);
  assert.match(server, /api\/live\/prepare-motion/);
  assert.doesNotMatch(ipad, /motionStyle.*<select|motionTargetDurationMs.*<input/);
});

test("GO, BACK, lighting, and physical ATEM subscription contain no prepared-Motion trigger", () => {
  const cue = source("cue-execution.cjs");
  const plan = source("cue-execution-plan.cjs");
  const main = source("electron-main.cjs");
  assert.doesNotMatch(cue, /preparedMotion|prepareMotionStart/);
  assert.doesNotMatch(plan, /preparedMotion|prepareMotionStart/);
  const subscription = main.slice(main.indexOf("atemService.subscribe"), main.indexOf("void atemService.initialize"));
  assert.doesNotMatch(subscription, /preparedMotion|runCameraMotion/);
});
