"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildManagedCameraProjection, resolveCameraDevice } = require("../camera-manager-operations.cjs");
const { projectBrowserState } = require("../device-operations.cjs");

function fixture(mainName = "Center Camera — renamed without identity impact") {
  return {
    devices: [
      { id: "camera-center-stable", type: "camera", name: mainName, logicalRole: "center", enabled: true, metadata: { legacyCameraId: "main" }, connection: {}, capabilities: {} },
      { id: "camera-left-stable", type: "camera", name: "Left PTZ", logicalRole: "left", enabled: true, metadata: { legacyCameraId: "left" }, connection: {}, capabilities: {} },
      { id: "camera-right-stable", type: "camera", name: "Right PTZ", logicalRole: "right", enabled: true, metadata: { legacyCameraId: "right" }, connection: {}, capabilities: {} },
      { id: "atem", type: "switcher", enabled: true, metadata: { adapter: "atem", atemCameraInputs: { "camera-center-stable": 1, "camera-left-stable": 2, "camera-right-stable": 3 } } }
    ],
    cameras: [
      { id: "main", role: "center", name: "Historical Center" },
      { id: "left", role: "left", name: "Historical Left" },
      { id: "right", role: "right", name: "Historical Right" }
    ],
    cameraPresets: [
      { id: "main-wide", name: "Main Wide", cameraDeviceId: "camera-center-stable", enabled: true },
      { id: "main-tight", name: "Main Tight", cameraDeviceId: "camera-center-stable", enabled: true },
      { id: "left-wide", name: "Left Wide", cameraDeviceId: "camera-left-stable", enabled: true },
      { id: "right-wide", name: "Right Wide", cameraDeviceId: "camera-right-stable", enabled: true }
    ],
    shots: [
      { id: "main-motion-one", name: "Main Motion One", shotType: "motion", motionEnabled: true, cameraDeviceId: "camera-center-stable", cameraPresetId: "main-wide", motionEndPresetId: "main-tight", enabled: true },
      { id: "main-motion-two", name: "Main Motion Two", shotType: "motion", motionEnabled: true, cameraDeviceId: "camera-center-stable", cameraPresetId: "main-tight", motionEndPresetId: "main-wide", enabled: true }
    ],
    runOfService: [], productionLooks: [], lightingScenes: [], cameraLayouts: [],
    live: { cueIndex: 0, activityLog: [] }
  };
}

test("desktop and Browser Operator resolve Main/Center to the same stable camera", () => {
  const state = fixture();
  const desktopMain = resolveCameraDevice(state, "main");
  const projection = projectBrowserState(state);
  const browserMain = projection.managedCameras.find(camera => camera.productionRole === "main");

  assert.equal(desktopMain.id, "camera-center-stable");
  assert.equal(browserMain.cameraDeviceId, desktopMain.id);
  assert.equal(browserMain.logicalRole, "center");
  assert.equal(browserMain.readiness, "Not configured");
  assert.equal(projection.managedCameras.filter(camera => camera.productionRole === "main").length, 1);
  assert.deepEqual(projection.managedCameras.slice(0, 3).map(camera => camera.productionRole), ["main", "left", "right"]);
});

test("Browser safe state preserves stable-ID scoped presets and Motion Shots for every column", () => {
  const projection = projectBrowserState(fixture());
  const resourcesFor = role => {
    const cameraId = projection.managedCameras.find(camera => camera.productionRole === role).cameraDeviceId;
    return {
      cameraId,
      presets: projection.cameraPresetSummaries.filter(preset => preset.cameraDeviceId === cameraId),
      motions: projection.shotSummaries.filter(shot => shot.cameraDeviceId === cameraId && shot.shotType === "motion")
    };
  };

  assert.equal(resourcesFor("main").cameraId, "camera-center-stable");
  assert.deepEqual(resourcesFor("main").presets.map(item => item.id), ["main-wide", "main-tight"]);
  assert.deepEqual(resourcesFor("main").motions.map(item => item.id), ["main-motion-one", "main-motion-two"]);
  assert.deepEqual(resourcesFor("left").presets.map(item => item.id), ["left-wide"]);
  assert.deepEqual(resourcesFor("right").presets.map(item => item.id), ["right-wide"]);
});

test("production identity ignores display names and does not mutate ATEM or resource IDs", () => {
  const state = fixture("A name with no Main or Center wording");
  const before = JSON.stringify(state);
  const projection = buildManagedCameraProjection(state);
  assert.equal(projection.find(camera => camera.productionRole === "main").cameraDeviceId, "camera-center-stable");
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(state.devices.find(device => device.id === "atem").metadata.atemCameraInputs, {
    "camera-center-stable": 1, "camera-left-stable": 2, "camera-right-stable": 3
  });
  assert.deepEqual(state.cameraPresets.map(item => item.id), ["main-wide", "main-tight", "left-wide", "right-wide"]);
  assert.deepEqual(state.shots.map(item => item.id), ["main-motion-one", "main-motion-two"]);
});
