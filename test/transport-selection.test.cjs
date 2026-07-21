const test = require('node:test');
const assert = require('node:assert/strict');
const { PRELOAD_UNAVAILABLE, selectTransport } = require('../public/transport-selection.js');
const remoteClient = require('../public/remote-client.js');

function preloadApi() {
  return {
    getInterfaceMode: () => 'production-console',
    getState: async () => ({ revision: 1 }),
    getDevices: async () => [],
    onStateChanged: () => () => {},
    onDevicesChanged: () => () => {}
  };
}

function runtime(protocol, overrides = {}) {
  return {
    location: { protocol },
    TrinityTransport: require('../public/transport-selection.js'),
    TrinityInterface: { OPERATOR_CAPABILITIES: {} },
    navigator: { onLine: true },
    addEventListener() {},
    ...overrides
  };
}

test('Electron runtime selects the exposed IPC bridge without HTTP or SSE', async () => {
  let fetchCalls = 0;
  let eventSourceCalls = 0;
  const ipc = preloadApi();
  const environment = runtime('file:', {
    trinity: ipc,
    fetch: async () => { fetchCalls += 1; },
    EventSource: class { constructor() { eventSourceCalls += 1; } }
  });

  const selected = remoteClient.install(environment);
  assert.equal(selected, ipc);
  assert.equal(environment.trinityTransport, 'electron-ipc');
  assert.deepEqual(await environment.trinity.getState(), { revision: 1 });
  assert.equal(fetchCalls, 0);
  assert.equal(eventSourceCalls, 0);
});

test('browser runtime explicitly selects HTTP state and SSE events', async () => {
  const requests = [];
  const eventSources = [];
  class FakeEventSource {
    constructor(url) { eventSources.push(url); }
    addEventListener() {}
  }
  const environment = runtime('http:', {
    trinity: preloadApi(),
    EventSource: FakeEventSource,
    fetch: async url => {
      requests.push(url);
      return { ok: true, json: async () => ({ revision: 4 }) };
    }
  });

  remoteClient.install(environment);
  assert.equal(environment.trinityTransport, 'browser-http');
  assert.deepEqual(await environment.trinity.getState(), { revision: 4 });
  assert.deepEqual(requests, ['/api/state']);
  assert.deepEqual(eventSources, ['/api/events']);
});

test('missing Electron preload fails with a desktop-specific diagnostic', async () => {
  const environment = runtime('file:', {
    fetch: async () => assert.fail('Electron startup must not call fetchLatestState'),
    EventSource: class { constructor() { assert.fail('Electron startup must not open SSE'); } }
  });

  remoteClient.install(environment);
  assert.equal(environment.trinityTransport, 'electron-preload-unavailable');
  await assert.rejects(environment.trinity.getState(), new RegExp(PRELOAD_UNAVAILABLE));
});

test('an incomplete preload API is rejected rather than treated as browser mode', () => {
  assert.deepEqual(selectTransport('file:', { getState() {} }), {
    kind: 'electron-preload-unavailable',
    diagnostic: PRELOAD_UNAVAILABLE
  });
});
