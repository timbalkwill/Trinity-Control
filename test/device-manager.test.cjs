const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEVICE_EVENTS,
  DEVICE_STATES,
  DEVICE_TYPES,
  DeviceManager
} = require("../src/core/device-manager.cjs");
const { ProductionEngine } = require("../src/core/production-engine.cjs");
const { SimulationCameraController } = require("../src/adapters/simulation/simulation-camera-controller.cjs");
const { SimulationSwitcherController } = require("../src/adapters/simulation/simulation-switcher-controller.cjs");
const { SimulationLightingController } = require("../src/adapters/simulation/simulation-lighting-controller.cjs");

function registration(overrides = {}) {
  return {
    id: "device-one",
    name: "Device One",
    type: DEVICE_TYPES.CONTROLLER,
    connectionState: DEVICE_STATES.CONNECTED,
    statusMessage: "Ready",
    supportsReconnect: true,
    supportsConfiguration: false,
    supportsHealthMonitoring: true,
    supportedCapabilities: ["test.execute"],
    ...overrides
  };
}

test("devices register once and are discoverable by capability", () => {
  const manager = new DeviceManager();
  const adapter = { execute() {} };
  const device = manager.registerDevice(registration(), adapter);

  assert.equal(device.id, "device-one");
  assert.equal(manager.getAdapterByCapability("test.execute"), adapter);
  assert.throws(() => manager.registerDevice(registration(), adapter), /already registered/);
});

test("device updates and removal publish lifecycle events", () => {
  const manager = new DeviceManager();
  const events = [];
  manager.subscribe("*", (_event, eventName) => events.push(eventName));
  manager.registerDevice(registration(), {});
  const updated = manager.updateDevice("device-one", {
    connectionState: DEVICE_STATES.DEGRADED,
    statusMessage: "Packet loss"
  });

  assert.equal(updated.connectionState, DEVICE_STATES.DEGRADED);
  assert.equal(manager.removeDevice("device-one"), true);
  assert.equal(manager.getDevice("device-one"), null);
  assert.deepEqual(events, [
    DEVICE_EVENTS.REGISTERED,
    DEVICE_EVENTS.UPDATED,
    DEVICE_EVENTS.REMOVED
  ]);
});

test("health reports track communication, errors, reconnects, and uptime", () => {
  let now = 1000;
  const manager = new DeviceManager({ now: () => now });
  const events = [];
  manager.subscribe("*", (_event, eventName) => events.push(eventName));
  manager.registerDevice(registration(), {});

  now = 2500;
  let device = manager.reportHealth("device-one", { success: true, statusMessage: "Healthy" });
  assert.equal(device.lastSeen, 2500);
  assert.equal(device.health.lastSuccessfulCommunication, 2500);
  assert.equal(device.health.uptime, 1500);

  device = manager.recordReconnectAttempt("device-one");
  assert.equal(device.health.reconnectAttempts, 1);

  device = manager.reportHealth("device-one", { error: new Error("Link failed") });
  assert.equal(device.connectionState, DEVICE_STATES.ERROR);
  assert.equal(device.health.lastError, "Link failed");
  assert.ok(events.includes(DEVICE_EVENTS.HEALTH));
  assert.ok(events.includes(DEVICE_EVENTS.ERROR));
});

test("simulation adapters self-register realistic runtime devices", () => {
  const manager = new DeviceManager();
  new SimulationCameraController().register(manager);
  new SimulationSwitcherController().register(manager);
  new SimulationLightingController().register(manager);

  const devices = manager.getDevices();
  assert.equal(devices.length, 3);
  assert.ok(devices.every(device => device.connectionState === DEVICE_STATES.SIMULATION));
  assert.ok(devices.every(device => device.supportsHealthMonitoring));
  assert.ok(manager.getAdapterByCapability("camera") instanceof SimulationCameraController);
  assert.ok(manager.getAdapterByCapability("videoSwitcher") instanceof SimulationSwitcherController);
  assert.ok(manager.getAdapterByCapability("lighting") instanceof SimulationLightingController);
});

test("Production Engine discovers adapters through Device Manager capabilities", () => {
  const manager = new DeviceManager();
  const calls = [];
  manager.registerDevice(registration({
    id: "camera-device",
    type: DEVICE_TYPES.CAMERA,
    supportedCapabilities: ["camera"]
  }), {
    recallPreset: payload => calls.push(payload)
  });
  const engine = new ProductionEngine({
    deviceManager: manager,
    initialState: {
      cameras: [{ id: "main", name: "Main" }],
      lightingScenes: [], cameraLayouts: [], productionLooks: [], runOfService: [],
      live: { cueIndex: 0, programCamera: "main", previewCamera: "main", activityLog: [] }
    }
  });

  assert.equal(engine.getDevices().length, 1);
  assert.equal(engine.getAdapter("camera"), manager.getAdapterByCapability("camera"));
  engine.getAdapter("camera").recallPreset({ cameraId: "main", preset: "Pulpit" });
  assert.deepEqual(calls, [{ cameraId: "main", preset: "Pulpit" }]);
  engine.dispose();
});
