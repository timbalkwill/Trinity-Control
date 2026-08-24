"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createAtemService } = require("../atem-service.cjs");
const { createTakeLatency } = require("../take-latency.cjs");

const root = path.join(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");

function state() {
  return { devices: [{ id: "atem", type: "switcher", name: "ATEM", enabled: true, adapterType: "atem", ipAddress: "test.invalid", metadata: { atemCameraInputs: { main: 1, left: 2 } } }] };
}

class BatchedAtem extends EventEmitter {
  constructor() {
    super();
    this.state = { video: { mixEffects: [{ programInput: 1, previewInput: 1, transitionPosition: { inTransition: false, remainingFrames: 0 } }] } };
    this.batches = [];
    this.releaseAck = null;
  }
  async connect() { this.emit("connected"); }
  sendCommands(commands) {
    this.batches.push(commands.map(command => command.constructor.rawName));
    return new Promise(resolve => { this.releaseAck = resolve; });
  }
  async disconnect() {}
  async destroy() {}
  setState({ previewInput, programInput, inTransition, remainingFrames }) {
    const current = this.state.video.mixEffects[0];
    this.state = { video: { mixEffects: [{
      ...current,
      ...(previewInput === undefined ? {} : { previewInput }),
      ...(programInput === undefined ? {} : { programInput }),
      transitionPosition: { ...current.transitionPosition, ...(inTransition === undefined ? {} : { inTransition }), ...(remainingFrames === undefined ? {} : { remainingFrames }) }
    }] } };
    this.emit("stateChanged", this.state);
  }
}

test("Mix batches Preview, style, and Auto before any acknowledgement or Preview confirmation", async () => {
  const client = new BatchedAtem();
  const service = createAtemService({ getState: state, clientFactory: () => client, logger: { error() {} } });
  await service.initialize();
  const taking = service.takeLive("left");
  assert.deepEqual(client.batches, [["CPvI", "CTTp", "DAut"]]);
  assert.equal(service.getStatus().previewInput, 1);
  client.setState({ previewInput: 2, inTransition: true, remainingFrames: 12 });
  client.releaseAck();
  client.setState({ programInput: 2, inTransition: false, remainingFrames: 0 });
  await taking;
  assert.equal(service.getStatus().liveCameraId, "left");
});

test("latency diagnostics use deterministic monotonic timing and stay opt-in", () => {
  const times = [0, 2, 3, 5, 7, 19, 519, 520];
  const logs = [];
  const trace = createTakeLatency({ sourceId: "source-left", origin: "desktop", enabled: true, logger: { info: line => logs.push(line) }, now: () => times.shift() });
  for (const point of ["router_entry", "adapter_entry", "preview_command", "auto_command", "transition_started", "transition_complete"]) trace.mark(point);
  const result = trace.finish("switched");
  assert.equal(result.mainToRouterMs, 2);
  assert.equal(result.routerToAdapterMs, 1);
  assert.equal(result.previewToAutoCommandMs, 2);
  assert.equal(result.autoToTransitionMs, 12);
  assert.equal(result.transitionDurationMs, 500);
  assert.match(logs[0], /^\[TakeLatency\].*source=source-left.*origin=desktop/);
});

test("desktop and Browser Operator dispatch before visual rerender and contain no artificial delay", () => {
  const desktop = source("public/app.js");
  const ipad = source("public/operator/operator.js");
  const takeCoordinator = source("video-take-live.cjs");
  const router = source("video-router.cjs");
  const desktopHandler = desktop.slice(desktop.indexOf("document.querySelectorAll('[data-take-video-source]')"), desktop.indexOf("function openCueDeleteModal"));
  const browserCommand = ipad.slice(ipad.indexOf("async function command"), ipad.indexOf("async function handleAction"));
  assert.ok(desktopHandler.indexOf("window.trinity.takeVideoSource") < desktopHandler.indexOf("button.disabled = true"));
  assert.ok(browserCommand.indexOf("fetch(route") < browserCommand.indexOf("render()"));
  for (const text of [desktopHandler, browserCommand, takeCoordinator, router]) assert.doesNotMatch(text, /setTimeout|sleep\(|debounce|requestAnimationFrame/);
  assert.doesNotMatch(browserCommand, /EventSource|refreshAuthoritativeState/);
  assert.doesNotMatch(router, /writeFile|saveState|readFile|normalizeState/);
  const main = source("electron-main.cjs");
  assert.match(main, /TRINITY_TAKE_LATENCY/);
  assert.match(main, /take-latency\.log/);
  assert.match(main, /fs\.appendFile\([\s\S]*take-latency\.log/);
});
