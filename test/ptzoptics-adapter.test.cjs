"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { executeCue } = require("../cue-execution.cjs");
const { createCameraExecutor, resolveCameraAdapter } = require("../camera-adapter-registry.cjs");
const { createPtzOpticsTransport, createViscaPresetRecallPacket, createViscaUdpTransport } = require("../ptzoptics-adapter.cjs");
const { normalizeShot } = require("../shot-operations.cjs");

function state(references = [{ role: "main", shotId: "main-shot" }]) {
  return {
    devices: [
      { id: "main", type: "camera", name: "Main", logicalRole: "main", enabled: true, adapterType: "ptzoptics", ipAddress: "camera-main.local", port: 80, protocol: "http", username: "operator", password: "private" },
      { id: "left", type: "camera", name: "Left", logicalRole: "left", enabled: true, adapterType: "ptzoptics", ipAddress: "camera-left.local", port: 8080, protocol: "http" }
    ],
    cameraPresets: [
      { id: "same-id", name: "Platform", cameraDeviceId: "main", presetNumber: 7, enabled: true },
      { id: "same-id", name: "Platform", cameraDeviceId: "left", presetNumber: 19, enabled: true }
    ],
    shots: [
      normalizeShot({ id: "main-shot", name: "Main Shot", shotType: "static", cameraDeviceId: "main", cameraPresetId: "same-id" }),
      normalizeShot({ id: "left-shot", name: "Left Shot", shotType: "static", cameraDeviceId: "left", cameraPresetId: "same-id" }),
      normalizeShot({ id: "motion", name: "Motion", shotType: "motion", cameraDeviceId: "main", cameraPresetId: "same-id", motionEndPresetId: "same-id" }),
      normalizeShot({ id: "tracking", name: "Tracking", shotType: "tracking", cameraDeviceId: "main", cameraPresetId: "same-id" })
    ],
    lightingScenes: [{ id: "warm", name: "Warm" }],
    cameraLayouts: [],
    productionLooks: [{ id: "look", name: "Look", enabled: true, lightingSceneId: "warm", cameraAssignments: references, cameraPresets: {}, priorityCameraId: "main" }],
    runOfService: [{ id: "cue", name: "Cue", productionLookId: "look" }],
    live: { cueIndex: 0, activityLog: [] }
  };
}

function executorFor(current, handler) {
  const calls = [];
  return {
    calls,
    executor: createCameraExecutor(current, {
      transports: {
        ptzoptics: configuration => {
          calls.push({ ...configuration, password: configuration.password ? "[present]" : null });
          return handler ? handler(configuration, calls.length) : { ok: true, message: "accepted", elapsedMs: 4 };
        }
      }
    })
  };
}

test("PTZOptics registry maps application preset identity to the camera hardware preset", async () => {
  const current = state();
  const selected = executorFor(current);
  const result = await selected.executor.recallPreset({ cameraDeviceId: "main", presetId: "same-id", shotId: "main-shot" });
  assert.equal(result.ok, true);
  assert.equal(result.adapterType, "ptzoptics");
  assert.equal(result.presetNumber, 7);
  assert.equal(result.safeHost, "camera-main.local");
  assert.equal(selected.calls[0].host, "camera-main.local");
  assert.equal(selected.calls[0].presetNumber, 7);
});

test("identical preset IDs and names remain scoped to their selected camera", async () => {
  const current = state();
  const selected = executorFor(current);
  await selected.executor.recallPreset({ cameraDeviceId: "left", presetId: "same-id" });
  assert.equal(selected.calls[0].host, "camera-left.local");
  assert.equal(selected.calls[0].port, 8080);
  assert.equal(selected.calls[0].presetNumber, 19);
});

test("missing and unsupported adapter types fail without transport", async () => {
  for (const adapterType of [null, "other"]) {
    const current = state();
    current.devices[0].adapterType = adapterType;
    const selected = executorFor(current);
    const result = await selected.executor.recallPreset({ cameraDeviceId: "main", presetId: "same-id" });
    assert.equal(result.code, "adapterUnavailable");
    assert.equal(selected.calls.length, 0);
  }
});

test("missing host and missing hardware mapping fail without transport", async () => {
  const current = state();
  current.devices[0].ipAddress = null;
  current.devices[0].connection = {};
  let selected = executorFor(current);
  assert.equal((await selected.executor.recallPreset({ cameraDeviceId: "main", presetId: "same-id" })).code, "configurationIncomplete");
  assert.equal(selected.calls.length, 0);
  current.devices[0].ipAddress = "camera-main.local";
  current.cameraPresets[0].presetNumber = null;
  selected = executorFor(current);
  assert.equal((await selected.executor.recallPreset({ cameraDeviceId: "main", presetId: "same-id" })).code, "presetMappingMissing");
  assert.equal(selected.calls.length, 0);
});

test("VISCA UDP requires a configured port before transport execution", async () => {
  const current = state();
  current.devices[0] = { ...current.devices[0], adapterType: "visca-udp", protocol: "visca-udp", port: null };
  const calls = [];
  const executor = createCameraExecutor(current, { transports: { viscaUdp: configuration => { calls.push(configuration); return { ok: true }; } } });
  const result = await executor.recallPreset({ cameraDeviceId: "main", presetId: "same-id" });
  assert.equal(result.code, "configurationIncomplete");
  assert.equal(calls.length, 0);
});

test("authentication, connection, timeout, rejection, and unexpected errors are normalized", async () => {
  const cases = [
    [{ ok: false, code: "authenticationFailure", message: "Camera authentication failed" }, "authenticationFailure"],
    [{ ok: false, code: "connectionFailure", message: "Could not connect to the camera" }, "connectionFailure"],
    [{ ok: false, code: "timeout", message: "Camera preset recall timed out" }, "timeout"],
    [{ ok: false, code: "cameraRejected", message: "Camera rejected preset recall (500)" }, "cameraRejected"]
  ];
  for (const [outcome, code] of cases) {
    const selected = executorFor(state(), () => outcome);
    assert.equal((await selected.executor.recallPreset({ cameraDeviceId: "main", presetId: "same-id" })).code, code);
  }
  const selected = executorFor(state(), () => Promise.reject(new Error("transport internals sensitive-marker")));
  const result = await selected.executor.recallPreset({ cameraDeviceId: "main", presetId: "same-id" });
  assert.equal(result.code, "unexpectedAdapterError");
  assert.doesNotMatch(JSON.stringify(result), /sensitive-marker/);
});

test("GO preserves lighting and never invokes the PTZOptics adapter", async () => {
  const current = state([{ role: "main", shotId: "main-shot" }, { role: "left", shotId: "left-shot" }]);
  const selected = executorFor(current, configuration => configuration.host === "camera-main.local"
    ? { ok: false, code: "connectionFailure", message: "Could not connect to the camera" }
    : { ok: true, message: "accepted" });
  await executeCue(current, 0, { now: () => 1000, cameraExecutor: selected.executor });
  assert.equal(selected.calls.length, 0);
  assert.equal(Object.hasOwn(current.live.executionSnapshot, "shotExecutionResults"), false);
  assert.equal(current.live.lastLightingSceneId, "warm");
});

test("Static, Motion, and Tracking Look assignments all make zero GO adapter calls", async () => {
  for (const shotId of ["main-shot", "motion", "tracking"]) {
    const current = state([{ role: "assignment", shotId }]);
    const selected = executorFor(current);
    await executeCue(current, 0, { cameraExecutor: selected.executor });
    assert.equal(selected.calls.length, 0);
  }
});

test("even an injected synchronous camera executor is outside service execution", () => {
  const current = state();
  const calls = [];
  const result = executeCue(current, 0, { cameraExecutor: { recallPreset(command) { calls.push(command); return { ok: true }; } } });
  assert.equal(result, current);
  assert.equal(calls.length, 0);
});

function mockRequest(sequence, calls) {
  return (options, callback) => {
    calls.push({ ...options, headers: { ...options.headers } });
    const request = new EventEmitter();
    request.setTimeout = (_timeout, handler) => { request.timeoutHandler = handler; };
    request.destroy = error => request.emit("error", error);
    request.end = () => {
      const step = sequence.shift();
      if (step.error) return request.emit("error", step.error);
      const response = new EventEmitter();
      response.statusCode = step.statusCode;
      response.headers = step.headers || {};
      response.resume = () => {};
      callback(response);
      response.emit("end");
    };
    return request;
  };
}

test("HTTP-CGI transport sends POSCALL and sanitizes authentication failure", async () => {
  const calls = [];
  const transport = createPtzOpticsTransport({
    requestImpl: mockRequest([
      { statusCode: 401, headers: { "www-authenticate": 'Digest realm="camera", nonce="abc", qop="auth"' } },
      { statusCode: 401 }
    ], calls),
    now: (() => { let value = 0; return () => value += 2; })()
  });
  const result = await transport({ host: "camera.local", port: 80, protocol: "http", username: "operator", password: "private", presetNumber: 12 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/cgi-bin/ptzctrl.cgi?ptzcmd&POSCALL&12");
  assert.match(calls[1].headers.Authorization, /^Digest /);
  assert.equal(result.code, "authenticationFailure");
  assert.doesNotMatch(JSON.stringify(result), /private|Authorization/);
});

test("HTTP-CGI transport normalizes timeout and connection errors", async () => {
  for (const [error, code] of [Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }), Object.assign(new Error("private host"), { code: "ECONNREFUSED" })].map((error, index) => [error, index ? "connectionFailure" : "timeout"])) {
    const transport = createPtzOpticsTransport({ requestImpl: mockRequest([{ error }], []) });
    const result = await transport({ host: "camera.local", protocol: "http", presetNumber: 1 });
    assert.equal(result.code, code);
    assert.doesNotMatch(result.message, /private host/);
  }
});

test("VISCA UDP adapter resolution is protocol-based and independent of display model", () => {
  assert.equal(resolveCameraAdapter({ adapterType: "visca-udp", manufacturer: "PTZOptics", model: "Move SE" }), "visca-udp");
  assert.equal(resolveCameraAdapter({ adapterType: "ptzoptics", protocol: "VISCA (UDP)", model: "Move SE" }), "visca-udp");
  assert.equal(resolveCameraAdapter({ protocol: "visca-over-ip", manufacturer: "Other compatible vendor" }), "visca-udp");
  assert.equal(resolveCameraAdapter({ adapterType: "unsupported", protocol: "custom" }), null);
});

test("VISCA UDP preset packet contains the configured address and hardware preset", () => {
  const packet = createViscaPresetRecallPacket({ address: 3, presetNumber: 42, sequenceNumber: 7 });
  assert.deepEqual([...packet], [0x01, 0x00, 0x00, 0x07, 0, 0, 0, 7, 0x83, 0x01, 0x04, 0x3f, 0x02, 42, 0xff]);
});

test("VISCA UDP transport sends one datagram to the configured host and port", async () => {
  const sends = [];
  const socket = new EventEmitter();
  socket.close = () => { socket.closed = true; };
  socket.send = (packet, port, host, callback) => {
    sends.push({ packet: [...packet], port, host });
    callback(null);
  };
  const transport = createViscaUdpTransport({ socketFactory: () => socket, now: () => 10 });
  const result = await transport({ host: "camera.test", port: 1259, viscaAddress: 2, presetNumber: 9, sequenceNumber: 1 });
  assert.equal(result.ok, true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].host, "camera.test");
  assert.equal(sends[0].port, 1259);
  assert.deepEqual(sends[0].packet.slice(8), [0x82, 0x01, 0x04, 0x3f, 0x02, 9, 0xff]);
  assert.equal(socket.closed, true);
});

test("configured church camera endpoints route once through injected VISCA UDP transport", async () => {
  const cameras = [
    ["main", "10.1.10.183", 1],
    ["left", "10.1.10.197", 2],
    ["right", "10.1.10.64", 3]
  ];
  const current = {
    devices: cameras.map(([id, ipAddress, viscaAddress]) => ({
      id, type: "camera", name: `${id} PTZ`, enabled: true, adapterType: "visca-udp",
      manufacturer: "PTZOptics", model: "Move SE", ipAddress, port: 1259, protocol: "visca-udp", viscaAddress
    })),
    cameraPresets: cameras.map(([id], index) => ({ id: `${id}-preset`, cameraDeviceId: id, presetNumber: index + 10 }))
  };
  const calls = [];
  const executor = createCameraExecutor(current, { transports: { viscaUdp: configuration => { calls.push(configuration); return { ok: true, message: "sent" }; } } });
  for (const [id] of cameras) {
    const result = await executor.recallPreset({ cameraDeviceId: id, presetId: `${id}-preset` });
    assert.equal(result.ok, true);
  }
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => [call.host, call.port, call.viscaAddress]), [
    ["10.1.10.183", 1259, 1], ["10.1.10.197", 1259, 2], ["10.1.10.64", 1259, 3]
  ]);
});
