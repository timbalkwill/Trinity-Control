const test = require('node:test');
const assert = require('node:assert/strict');
const { createHomeAssistantController, normalizeEntities } = require('../home-assistant-operations.cjs');

test('normalizes and deduplicates Home Assistant entities', () => {
  assert.deepEqual(normalizeEntities('switch.a, switch.b, switch.a'), ['switch.a', 'switch.b']);
});

test('reports not configured without credentials', async () => {
  const controller = createHomeAssistantController({ env: {}, fetchImpl: async () => { throw new Error('should not run'); } });
  const status = await controller.getStatus();
  assert.equal(status.configured, false);
  assert.equal(status.reachable, false);
});

test('turns all configured lighting switches on', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/services/')) return { ok: true, headers: { get: () => 'application/json' }, json: async () => [] };
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ state: 'on', attributes: { friendly_name: 'Lighting' } })
    };
  };
  const controller = createHomeAssistantController({
    env: {
      TRINITY_HA_URL: 'http://ha.local:8123',
      TRINITY_HA_TOKEN: 'token',
      TRINITY_HA_LIGHTING_ENTITIES: 'switch.a,switch.b'
    },
    fetchImpl
  });
  const status = await controller.turnOn();
  assert.equal(calls[0].url, 'http://ha.local:8123/api/services/switch/turn_on');
  assert.deepEqual(JSON.parse(calls[0].options.body), { entity_id: ['switch.a', 'switch.b'] });
  assert.equal(status.allOn, true);
});
