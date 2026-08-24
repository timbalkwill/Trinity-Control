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
      id, type: "camera", name: `${id[0].toUpperCase()}${id.slice(1)} Camera`, logicalRole: id,
      enabled: true, adapterType: "ptzoptics", ipAddress: `${id}.camera.local`
    })),
    cameraPresets: ["main", "left", "right"].map((cameraDeviceId, index) => ({
      id: `${cameraDeviceId}-preset`, name: `${cameraDeviceId} Position`, cameraDeviceId,
      presetNumber: index + 1, enabled: true
    })),
    shots: [{ id: "legacy-shot", name: "Legacy Static", shotType: "static", cameraDeviceId: "main", cameraPresetId: "main-preset" }],
    productionLooks: [{ id: "look", name: "Look", lightingSceneId: "warm", cameraAssignments: [{ role: "main", shotId: "legacy-shot" }] }],
    lightingScenes: [{ id: "warm", name: "Warm" }],
    runOfService: [{ id: "cue-one", name: "One", productionLookId: "look" }, { id: "cue-two", name: "Two" }],
    live: { cueIndex: 0, programCamera: null, previewCamera: null, cameraPreparations: [], activityLog: [] }
  };
}

function harness() {
  let persisted = fixture();
  const calls = [];
  const commands = createOperatorCommands({
    loadState: () => clone(persisted),
    saveState: state => { persisted = clone(state); return clone(persisted); },
    cameraExecutorFactory: () => ({
      recallPreset(command) { calls.push({ ...command }); return { ok: true, message: "accepted" }; }
    })
  });
  return { commands, calls, state: () => clone(persisted) };
}

for (const cameraId of ["main", "left", "right"]) {
  test(`manual ${cameraId} preset click executes only ${cameraId} exactly once`, async () => {
    const { commands, calls, state } = harness();
    const beforeCue = state().live.cueIndex;
    const beforeLighting = state().live.lastLightingSceneId;
    await commands.recallCameraPreset(cameraId, `${cameraId}-preset`);
    assert.deepEqual(calls, [{ cameraDeviceId: cameraId, presetId: `${cameraId}-preset` }]);
    assert.equal(state().live.cueIndex, beforeCue);
    assert.equal(state().live.lastLightingSceneId, beforeLighting);
    assert.equal(state().live.programCamera, null);
    assert.equal(state().live.previewCamera, null);
    assert.equal(state().live.cameraPreparations.find(item => item.cameraId === cameraId).selectedPresetId, `${cameraId}-preset`);
    for (const other of ["main", "left", "right"].filter(id => id !== cameraId)) {
      assert.equal(state().live.cameraPreparations.find(item => item.cameraId === other).selectedPresetId, null);
    }
  });
}

test("failed or unavailable manual camera actions do not become Last Commanded", async () => {
  let persisted = fixture();
  persisted.devices.find(item => item.id === "left").enabled = false;
  const commands = createOperatorCommands({
    loadState: () => clone(persisted),
    saveState: state => { persisted = clone(state); return clone(persisted); },
    cameraExecutorFactory: () => ({ recallPreset() { throw new Error("must not run"); } })
  });
  await assert.rejects(commands.recallCameraPreset("left", "left-preset"), /unavailable/);
  assert.deepEqual(persisted.live.cameraPreparations, []);
});

test("manual recall rejects missing and invalid authoritative hardware mappings before execution", async () => {
  for (const presetNumber of [undefined, null, Number.NaN, -1, 255, "stable-preset-id", 0]) {
    let persisted = fixture();
    if (presetNumber === 0) persisted.cameraPresets[0].presetNumber = "0";
    else persisted.cameraPresets[0].presetNumber = presetNumber;
    const calls = [];
    const commands = createOperatorCommands({
      loadState: () => clone(persisted),
      saveState: state => { persisted = clone(state); return clone(persisted); },
      cameraExecutorFactory: () => ({ recallPreset(command) { calls.push(command); return { ok: true }; } })
    });
    await assert.rejects(
      commands.recallCameraPreset("main", "main-preset"),
      error => error.code === "CAMERA_PRESET_MAPPING_MISSING" && /main Position has no valid hardware preset assigned\./.test(error.message)
    );
    assert.equal(calls.length, 0);
    assert.deepEqual(persisted.live.cameraPreparations, []);
  }
});

test("manual recall accepts hardware preset range endpoints without switching or lighting", async () => {
  for (const presetNumber of [0, 254]) {
    let persisted = fixture();
    persisted.cameraPresets[0].presetNumber = presetNumber;
    const calls = [];
    const commands = createOperatorCommands({
      loadState: () => clone(persisted),
      saveState: state => { persisted = clone(state); return clone(persisted); },
      cameraExecutorFactory: current => ({
        recallPreset(command) {
          const authoritative = current.cameraPresets.find(item => item.id === command.presetId && item.cameraDeviceId === command.cameraDeviceId);
          calls.push({ ...command, presetNumber: authoritative.presetNumber });
          return { ok: true };
        }
      })
    });
    await commands.recallCameraPreset("main", "main-preset");
    assert.deepEqual(calls, [{ cameraDeviceId: "main", presetId: "main-preset", presetNumber }]);
    assert.equal(persisted.live.programCamera, null);
    assert.equal(persisted.live.previewCamera, null);
    assert.equal(persisted.live.lastLightingSceneId, undefined);
  }
});

test("Camera Director exposes accessible controls and authoritative Video Source LIVE state", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(source, /aria-label="Open shots for \$\{escapeHtml\(camera\.name\)\}"/);
  assert.match(source, /data-open-desktop-camera-selector="\$\{escapeHtml\(camera\.id\)\}"/);
  assert.match(source, /data-live-indicator.*\$\{isLive \? '' : 'hidden'\}/);
  assert.match(source, /const isLive = switcherConnected && atemStatus\.liveSourceId === videoSource\?\.id/);
  assert.doesNotMatch(source.slice(source.indexOf("function CameraDirectorCard"), source.indexOf("function livePage")), /programCamera|previewCamera|MAKE LIVE/);
});

test("desktop selector state is ephemeral and only its long library scrolls", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(source, /let openDesktopCameraSelectorId = null/);
  assert.doesNotMatch(source, /localStorage.*openDesktopCameraSelector|sessionStorage.*openDesktopCameraSelector/);
  assert.match(styles, /\.desktop-camera-selector-scroll\{[^}]*overflow-y:auto/);
  assert.doesNotMatch(source, /window\.innerWidth|resize.*camera-director|cameraDirector.*scrollTop/i);
});
