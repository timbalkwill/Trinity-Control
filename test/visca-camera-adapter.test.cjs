const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { DeviceManager, DEVICE_STATES } = require("../src/core/device-manager.cjs");
const { registerCameraAdapters } = require("../src/adapters/camera-adapter-factory.cjs");
const { ViscaCameraAdapter } = require("../src/adapters/visca/visca-camera-adapter.cjs");
const { TcpViscaTransport } = require("../src/adapters/visca/tcp-visca-transport.cjs");
const {
  classifyResponse,
  powerInquiryCommand,
  presetRecallCommand
} = require("../src/adapters/visca/visca-commands.cjs");

const quietLogger = { info() {}, error() {}, warn() {} };
const tick = () => new Promise(resolve => setImmediate(resolve));

function camera(overrides = {}) {
  return {
    id: "main",
    name: "Main PTZ",
    enabled: true,
    adapterType: "visca-over-ip",
    host: "127.0.0.1",
    port: 5678,
    cameraAddress: 1,
    connectionTimeoutMs: 100,
    healthCheckIntervalMs: 5000,
    savedPositions: [{ id: "pulpit", name: "Pulpit", hardwarePresetNumber: 7 }],
    ...overrides
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  server.close();
  await tick();
}

test("VISCA commands encode preset recall and health inquiry", () => {
  assert.deepEqual([...presetRecallCommand(1, 7)], [0x81, 0x01, 0x04, 0x3f, 0x02, 0x07, 0xff]);
  assert.deepEqual([...powerInquiryCommand(2)], [0x82, 0x09, 0x04, 0x00, 0xff]);
  assert.equal(classifyResponse(Buffer.from([0x90, 0x50, 0x02, 0xff])), "completion");
  assert.throws(() => presetRecallCommand(1, 255), /0 to 254/);
  assert.throws(() => presetRecallCommand(8, 1), /address/);
});

test("TCP VISCA transport receives a successful camera response", async () => {
  const received = [];
  const server = net.createServer(socket => socket.on("data", command => {
    received.push(command);
    socket.write(Buffer.from([0x90, 0x50, 0x02, 0xff]));
  }));
  const port = await listen(server);
  const transport = new TcpViscaTransport();
  try {
    const response = await transport.request({
      host: "127.0.0.1", port, command: powerInquiryCommand(1), timeoutMs: 250
    });
    assert.equal(classifyResponse(response), "completion");
    assert.deepEqual(received.map(buffer => [...buffer]), [[0x81, 0x09, 0x04, 0x00, 0xff]]);
  } finally {
    transport.close();
    await closeServer(server);
  }
});

test("TCP VISCA transport reports timeout and connection failure", async () => {
  const silentServer = net.createServer(() => {});
  const port = await listen(silentServer);
  const transport = new TcpViscaTransport();
  await assert.rejects(
    transport.request({ host: "127.0.0.1", port, command: powerInquiryCommand(1), timeoutMs: 50 }),
    /timed out/
  );
  await closeServer(silentServer);
  const closedServer = net.createServer();
  const closedPort = await listen(closedServer);
  await new Promise(resolve => closedServer.close(resolve));
  await assert.rejects(
    transport.request({ host: "127.0.0.1", port: closedPort, command: powerInquiryCommand(1), timeoutMs: 100 }),
    /connection failed/
  );
  transport.close();
});

test("preset recall validates mappings and updates Device Manager health", async () => {
  const requests = [];
  const transport = {
    request: async request => {
      requests.push(request);
      return Buffer.from([0x90, 0x50, 0xff]);
    },
    close() {}
  };
  const manager = new DeviceManager();
  const adapter = new ViscaCameraAdapter({ camera: camera(), transport, logger: quietLogger });
  adapter.register(manager);
  await tick();
  const beforeRecall = manager.getDevice("camera-main").lastSeen;
  const result = await adapter.recallPreset({ cameraId: "main", preset: "Pulpit" });
  assert.equal(result.hardwarePresetNumber, 7);
  assert.deepEqual([...requests.at(-1).command], [0x81, 0x01, 0x04, 0x3f, 0x02, 0x07, 0xff]);
  assert.ok(manager.getDevice("camera-main").lastSeen >= beforeRecall);
  assert.equal(manager.getDevice("camera-main").connectionState, DEVICE_STATES.CONNECTED);
  await assert.rejects(adapter.recallPreset({ cameraId: "main", preset: "Missing" }), /no saved position/);
  adapter.camera.savedPositions[0].hardwarePresetNumber = 999;
  await assert.rejects(adapter.recallPreset({ cameraId: "main", preset: "Pulpit" }), /0 to 254/);
  adapter.close();
});

test("health failures update errors and reconnect attempts without throwing", async () => {
  const transport = { request: async () => { throw new Error("offline"); }, closeCalled: false, close() { this.closeCalled = true; } };
  const manager = new DeviceManager();
  const adapter = new ViscaCameraAdapter({ camera: camera(), transport, logger: quietLogger });
  adapter.register(manager);
  await tick();
  const device = manager.getDevice("camera-main");
  assert.equal(device.connectionState, DEVICE_STATES.ERROR);
  assert.match(device.health.lastError, /offline/);
  assert.equal(device.health.reconnectAttempts, 1);
  adapter.close();
  assert.equal(transport.closeCalled, true);
});

test("factory routes multiple configured cameras and never silently falls back", async () => {
  const manager = new DeviceManager();
  const registry = registerCameraAdapters({
    cameras: [
      camera({ id: "sim", name: "Simulation", adapterType: "simulation" }),
      camera({ id: "real", name: "Real Camera" }),
      camera({ id: "bad", name: "Bad Camera", adapterType: "unsupported" })
    ],
    deviceManager: manager,
    logger: quietLogger,
    viscaTransportFactory: () => ({ request: async () => Buffer.from([0x90, 0x50, 0xff]), close() {} })
  });
  await tick();
  assert.notEqual(
    manager.getAdapterByCapability("camera", { resourceId: "sim" }),
    manager.getAdapterByCapability("camera", { resourceId: "real" })
  );
  assert.equal(manager.getDevice("camera-real").connectionState, DEVICE_STATES.CONNECTED);
  assert.equal(manager.getDevice("camera-bad").connectionState, DEVICE_STATES.ERROR);
  await assert.rejects(
    manager.getAdapterByCapability("camera", { resourceId: "bad" }).recallPreset(),
    /unsupported adapter type/
  );
  registry.close();
});
