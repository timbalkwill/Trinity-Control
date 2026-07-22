const test = require('node:test');
const assert = require('node:assert/strict');
const { synchronize } = require('../public/startup-synchronizer.js');

test('SSE updates received during the initial HTTP snapshot are replayed afterward', async () => {
  let resolveState;
  let stateSubscriber;
  let devicesSubscriber;
  const appliedStates = [];
  const appliedDevices = [];
  const transport = {
    getState: () => new Promise(resolve => { resolveState = resolve; }),
    getDevices: async () => [{ id: 'initial-device' }],
    onStateChanged: subscriber => { stateSubscriber = subscriber; },
    onDevicesChanged: subscriber => { devicesSubscriber = subscriber; }
  };

  const startup = synchronize({
    transport,
    onState: update => appliedStates.push(update.state),
    onDevices: update => appliedDevices.push(update.devices),
    logger: { info() {} }
  });

  stateSubscriber({ revision: 1, state: { revision: 1, live: { hold: true } } });
  devicesSubscriber({ devices: [{ id: 'updated-device' }] });
  resolveState({ revision: 0, live: { hold: false } });
  await startup;

  assert.deepEqual(appliedStates.map(state => state.revision), [0, 1]);
  assert.equal(appliedStates.at(-1).live.hold, true);
  assert.deepEqual(appliedDevices, [
    [{ id: 'initial-device' }],
    [{ id: 'updated-device' }]
  ]);
});
