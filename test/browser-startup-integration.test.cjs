const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ENGINE_EVENTS, ProductionEngine } = require('../src/core/production-engine.cjs');
const { createLocalNetworkServer } = require('../src/server/local-network-server.cjs');

async function connectStateStream(url) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const queued = [];
  const waiters = [];

  const pump = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!block.includes('event: state-changed')) continue;
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (!data) continue;
        const event = JSON.parse(data);
        const waiter = waiters.shift();
        if (waiter) waiter(event);
        else queued.push(event);
      }
    }
  })().catch(error => {
    if (error.name !== 'AbortError') throw error;
  });

  return {
    next: () => queued.length
      ? Promise.resolve(queued.shift())
      : new Promise(resolve => waiters.push(resolve)),
    close: async () => {
      controller.abort();
      await pump;
    }
  };
}

test('browser synchronization works immediately across repeated Trinity startups', async () => {
  const startupCount = 20;
  for (let iteration = 0; iteration < startupCount; iteration += 1) {
    const engine = new ProductionEngine({
      initialState: { live: { hold: false, activityLog: [] } }
    });
    const server = createLocalNetworkServer({
      getSnapshot: () => engine.getSnapshot(),
      publicDirectory: path.join(__dirname, '..', 'public'),
      host: '127.0.0.1',
      port: 0,
      logger: { info() {}, warn() {} }
    });
    engine.subscribe(ENGINE_EVENTS.STATE_CHANGED, event => server.broadcastStateChanged(event));
    const address = await server.start();
    const stream = await connectStateStream(`http://127.0.0.1:${address.port}/api/events`);

    try {
      const initial = await stream.next();
      assert.equal(initial.revision, 0, `startup ${iteration + 1} initial revision`);
      const httpSnapshot = fetch(`http://127.0.0.1:${address.port}/api/state`).then(response => response.json());
      await engine.dispatch({ type: 'SetHold', payload: { hold: true } });
      const update = await stream.next();
      await httpSnapshot;
      assert.equal(update.revision, 1, `startup ${iteration + 1} update revision`);
      assert.equal(update.state.live.hold, true, `startup ${iteration + 1} live update`);
    } finally {
      await stream.close();
      await server.close();
      engine.dispose();
    }
  }
});
