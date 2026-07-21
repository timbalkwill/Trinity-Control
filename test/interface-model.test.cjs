const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ALL_CAPABILITIES,
  OPERATOR_CAPABILITIES,
  cameraViewModels,
  capabilitiesForMode,
  detectMode,
  liveViewModel,
  navigationFor
} = require("../public/interface-model.js");

test("operator mode is detected explicitly from the transport", () => {
  assert.equal(detectMode({ getInterfaceMode: () => "operator" }), "operator");
  assert.equal(detectMode({ getInterfaceMode: () => "production-console" }), "production-console");
  assert.equal(detectMode({}), "production-console");
});

test("capabilities keep browser operation read-only and desktop complete", () => {
  assert.deepEqual(capabilitiesForMode("operator"), OPERATOR_CAPABILITIES);
  assert.equal(OPERATOR_CAPABILITIES.canOperateService, false);
  assert.equal(OPERATOR_CAPABILITIES.canRecallCamera, false);
  assert.equal(OPERATOR_CAPABILITIES.canEditService, false);
  assert.equal(OPERATOR_CAPABILITIES.canConfigureSystem, false);
  assert.equal(ALL_CAPABILITIES.canOperateService, true);
  assert.equal(ALL_CAPABILITIES.canConfigureCameras, true);
});

test("operator navigation exposes only Live, Service, and Cameras", () => {
  assert.deepEqual(navigationFor(OPERATOR_CAPABILITIES), [
    ["live", "LIVE"],
    ["service", "SERVICE"],
    ["cameras", "CAMERAS"]
  ]);
  assert.deepEqual(
    navigationFor(ALL_CAPABILITIES).map(([id]) => id),
    ["live", "service", "looks", "lighting", "cameras", "configuration"]
  );
});

test("browser view models render only authoritative service and camera data", () => {
  const state = {
    runOfService: [
      { id: "one", name: "Welcome", productionLookId: "look-one" },
      { id: "two", name: "Sermon", productionLookId: "look-two" }
    ],
    productionLooks: [{ id: "look-one", name: "Welcome Look" }],
    cameras: [{ id: "main", name: "Center PTZ", online: true }],
    live: { cueIndex: 0, programCamera: "main", programPreset: "Pulpit Tight" }
  };

  assert.deepEqual(liveViewModel(state), {
    current: state.runOfService[0],
    next: state.runOfService[1],
    look: state.productionLooks[0],
    camera: state.cameras[0],
    programPreset: "Pulpit Tight"
  });
  assert.deepEqual(cameraViewModels(state)[0].positions, []);
  assert.equal(cameraViewModels(state)[0].name, "Center PTZ");
});
