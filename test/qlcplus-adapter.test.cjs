"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createLightingAdapterRegistry, safeConfiguration } = require("../lighting-adapter-registry.cjs");
const { createQlcPlusTransport, endpointFor, parseNumberResponse, parseVirtualConsoleHierarchy, parseWidgetList, virtualConsoleEndpointFor } = require("../qlcplus-websocket-transport.cjs");
const { normalizeDevice } = require("../device-operations.cjs");

function device(patch = {}) {
  return normalizeDevice({
    id: "lighting-engine", type: "lighting", name: "QLC+", enabled: true,
    adapterType: "qlcplus-websocket", ipAddress: "qlc-host.local", port: 9999,
    protocol: "ws", timeoutMs: 100, ...patch
  });
}

function mockTransport(overrides = {}) {
  return {
    calls: [],
    async testConnection(config) {
      this.calls.push(["test", { ...config, password: config.password ? "[configured]" : null }]);
      return { ok: true, code: "qlcConnected", widgetCount: 2, elapsedMs: 3, message: "QLC+ is reachable" };
    },
    async discoverControls(config) {
      this.calls.push(["discover", { ...config, password: config.password ? "[configured]" : null }]);
      return { ok: true, code: "qlcConnected", widgetCount: 2, widgets: [], elapsedMs: 4, message: "Discovered 2 QLC+ controls" };
    },
    activateControl() { this.calls.push(["activate"]); },
    ...overrides
  };
}

test("registry resolves QLC+ and applies the default web port", async () => {
  const transport = mockTransport();
  const registry = createLightingAdapterRegistry({ transports: { "qlcplus-websocket": transport } });
  const configured = device({ port: null, connection: { host: "qlc-host.local" } });
  assert.ok(registry.resolve(configured));
  const result = await registry.testConnection(configured);
  assert.equal(result.code, "qlcConnected");
  assert.equal(result.port, 9999);
  assert.equal(transport.calls[0][1].port, 9999);
});

test("missing or unsupported adapters report adapterUnavailable", async () => {
  const registry = createLightingAdapterRegistry({ transports: { "qlcplus-websocket": mockTransport() } });
  for (const adapterType of [null, "unsupported"]) {
    const result = await registry.testConnection(device({ adapterType, metadata: {} }));
    assert.equal(result.code, "adapterUnavailable");
  }
});

test("missing host reports configurationIncomplete without transport activity", async () => {
  const transport = mockTransport();
  const registry = createLightingAdapterRegistry({ transports: { "qlcplus-websocket": transport } });
  const result = await registry.testConnection(device({ ipAddress: null, connection: {} }));
  assert.equal(result.code, "configurationIncomplete");
  assert.equal(transport.calls.length, 0);
});

test("safe endpoint uses WebSocket configuration without credentials", () => {
  const configured = safeConfiguration(device({ protocol: "wss", username: "test-user", credentialReference: "test-value" }));
  assert.equal(endpointFor(configured), "wss://qlc-host.local:9999/qlcplusWS");
  assert.doesNotMatch(endpointFor(configured), /test-user|test-value|@/);
  assert.equal(virtualConsoleEndpointFor(configured), "https://qlc-host.local:9999/vc.json");
});

class MockSocket extends EventEmitter {
  constructor(script, calls) {
    super();
    this.script = script;
    this.calls = calls;
    queueMicrotask(() => script.noOpen ? undefined
      : script.connectError ? this.emit("error", { statusCode: script.connectError }) : this.emit("open", {}));
  }
  addEventListener(name, listener) { this.on(name, listener); }
  send(command) {
    if (this.script.throwSend) throw new Error("socket send failed");
    this.calls.push(command);
    const response = this.script.responses?.[command];
    queueMicrotask(() => response === "DISCONNECT"
      ? this.emit("close", {})
      : response !== undefined && this.emit("message", { data: response }));
  }
  close() { this.closed = true; }
}

function socketHarness(script) {
  const calls = [];
  const connections = [];
  return {
    calls,
    connections,
    factory(endpoint, options) {
      connections.push({ endpoint, options });
      return new MockSocket(script, calls);
    }
  };
}

test("connection succeeds and sends only read-only widget count", async () => {
  const harness = socketHarness({ responses: { "QLC+API|getWidgetsNumber": "QLC+API|getWidgetsNumber|2" } });
  const result = await createQlcPlusTransport({ webSocketFactory: harness.factory.bind(harness) })
    .testConnection(safeConfiguration(device()));
  assert.equal(result.code, "qlcConnected");
  assert.equal(result.widgetCount, 2);
  assert.deepEqual(harness.calls, ["QLC+API|getWidgetsNumber"]);
});

test("authentication and connection failures are sanitized", async () => {
  for (const [status, code] of [[401, "authenticationFailure"], [503, "connectionFailure"]]) {
    const harness = socketHarness({ connectError: status });
    const result = await createQlcPlusTransport({ webSocketFactory: harness.factory.bind(harness) })
      .testConnection(safeConfiguration(device({ username: "test-user", credentialReference: "test-value" })));
    assert.equal(result.code, code);
    assert.doesNotMatch(JSON.stringify(result), /test-user|test-value|Authorization/);
  }
});

test("bounded connection timeout closes the socket", async () => {
  const harness = socketHarness({ noOpen: true });
  const result = await createQlcPlusTransport({ webSocketFactory: harness.factory.bind(harness) })
    .testConnection({ host: "qlc-host.local", timeoutMs: 5 });
  assert.equal(result.code, "timeout");
});

test("unexpected disconnect while awaiting a response is normalized", async () => {
  const harness = socketHarness({ responses: { "QLC+API|getWidgetsNumber": "DISCONNECT" } });
  const result = await createQlcPlusTransport({ webSocketFactory: harness.factory.bind(harness) })
    .testConnection(safeConfiguration(device()));
  assert.equal(result.code, "unexpectedDisconnect");
});

test("widget discovery preserves IDs, duplicate names, types, and status", async () => {
  const harness = socketHarness({ responses: {
    "QLC+API|getWidgetsNumber": "QLC+API|getWidgetsNumber|2",
    "QLC+API|getWidgetsList": "QLC+API|getWidgetsList|11|Sunday|29|Sunday",
    "QLC+API|getWidgetType|11": "QLC+API|getWidgetType|11|Button",
    "QLC+API|getWidgetStatus|11": "QLC+API|getWidgetStatus|11|255",
    "QLC+API|getWidgetType|29": "QLC+API|getWidgetType|29|Slider",
    "QLC+API|getWidgetStatus|29": "QLC+API|getWidgetStatus|29|0"
  } });
  const fetchImpl = async () => ({ ok: true, async json() {
    return { pages: [
      { id: 100, caption: "Sunday Morning", children: [{ id: 90, caption: "Scenes", children: [{ id: 11, caption: "Sunday" }] }] },
      { id: 101, caption: "Live Adjustments", children: [{ id: 29, caption: "Sunday" }] }
    ] };
  } });
  const result = await createQlcPlusTransport({ webSocketFactory: harness.factory.bind(harness), fetchImpl })
    .discoverControls(safeConfiguration(device()));
  assert.equal(result.ok, true);
  assert.deepEqual(result.widgets.map(item => [item.widgetId, item.name]), [["11", "Sunday"], ["29", "Sunday"]]);
  assert.equal(result.widgets[0].canActivateScene, true);
  assert.equal(result.widgets[1].canActivateScene, false);
  assert.equal(result.widgets[0].pageName, "Sunday Morning");
  assert.equal(result.widgets[0].parentName, "Scenes");
  assert.equal(result.widgets[1].pageName, "Live Adjustments");
  assert.deepEqual(result.pages.map(item => item.pageName), ["Sunday Morning", "Live Adjustments"]);
  assert.equal(harness.calls.some(command => /^\d+\|/.test(command)), false);
});

test("Virtual Console hierarchy uses explicit page and parent relationships", () => {
  const parsed = parseVirtualConsoleHierarchy({
    pages: [{ id: 1, caption: "Production", children: [{ id: 2, caption: "Frame", children: [{ id: 3, caption: "Sermon" }] }] }]
  });
  assert.deepEqual(parsed.pages, [{ pageIndex: 0, pageName: "Production", pageId: "1" }]);
  assert.deepEqual(parsed.controls.get("3"), {
    pageIndex: 0, pageName: "Production", parentWidgetId: "2", parentName: "Frame", containerPath: ["Frame"]
  });
});

test("malformed widget responses fail safely", async () => {
  assert.throws(() => parseNumberResponse("not qlc"), error => error.code === "invalidResponse");
  assert.throws(() => parseWidgetList("QLC+API|getWidgetsList|1"), error => error.code === "invalidResponse");
  const harness = socketHarness({ responses: { "QLC+API|getWidgetsNumber": "QLC+API|getWidgetsNumber|invalid" } });
  const result = await createQlcPlusTransport({ webSocketFactory: harness.factory.bind(harness) })
    .testConnection(safeConfiguration(device()));
  assert.equal(result.code, "invalidResponse");
});

test("registry test and discovery never call activation", async () => {
  const transport = mockTransport();
  const registry = createLightingAdapterRegistry({ transports: { "qlcplus-websocket": transport } });
  await registry.testConnection(device());
  await registry.discoverControls(device());
  assert.equal(transport.calls.some(([operation]) => operation === "activate"), false);
});

test("QLC+ toggle activation sends exactly one nonzero widget command", async () => {
  const harness = socketHarness({ responses: {} });
  const transport = createQlcPlusTransport({ webSocketFactory: harness.factory.bind(harness) });
  const result = await transport.activateControl(safeConfiguration(device()), { externalControlId: "101" });
  assert.equal(result.ok, true);
  assert.equal(result.activationMessageCount, 1);
  assert.equal(result.commandValue, 255);
  assert.deepEqual(harness.calls, ["101|255"]);
  assert.equal(harness.calls.includes("101|0"), false);
});

test("QLC+ toggle send failure is sanitized without a release attempt", async () => {
  const harness = socketHarness({ throwSend: true });
  const result = await createQlcPlusTransport({ webSocketFactory: harness.factory.bind(harness) })
    .activateControl(safeConfiguration(device()), { externalControlId: "101" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "commandSendFailure");
  assert.equal(result.message, "QLC+ command could not be sent");
  assert.deepEqual(harness.calls, []);
});

test("registry execution rejects unavailable, disabled, and unconfigured adapters without sending", async () => {
  const transport = mockTransport({
    async activateControl(config, input) {
      this.calls.push(["activate", input]);
      return { ok: true, code: "qlcConnected", message: "sent" };
    }
  });
  const registry = createLightingAdapterRegistry({ transports: { "qlcplus-websocket": transport } });
  assert.equal((await registry.execute(null, { widgetId: "101" })).code, "adapterUnavailable");
  assert.equal((await registry.execute(device({ enabled: false }), { widgetId: "101" })).code, "lightingDisabled");
  assert.equal((await registry.execute(device({ ipAddress: null, connection: {} }), { widgetId: "101" })).code, "configurationIncomplete");
  assert.equal(transport.calls.length, 0);
});
