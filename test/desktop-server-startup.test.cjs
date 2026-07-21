const test = require('node:test');
const assert = require('node:assert/strict');
const { startLocalNetworkServer } = require('../src/server/start-local-network-server.cjs');

test('desktop startup continues when the remote server port is unavailable', async () => {
  const messages = [];
  const conflict = new Error('listen EADDRINUSE: address already in use 0.0.0.0:4310');
  const result = await startLocalNetworkServer(
    { start: async () => { throw conflict; } },
    { error: message => messages.push(message) }
  );

  assert.equal(result.started, false);
  assert.equal(result.error, conflict);
  assert.match(messages[0], /Server failed to start:.*EADDRINUSE/);
});
