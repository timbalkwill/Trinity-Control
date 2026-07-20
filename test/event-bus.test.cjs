const test = require("node:test");
const assert = require("node:assert/strict");
const { EventBus } = require("../src/core/event-bus.cjs");

test("subscribers receive publications and can unsubscribe", () => {
  const bus = new EventBus();
  const received = [];
  const unsubscribe = bus.subscribe("production:test", payload => received.push(payload));

  bus.publish("production:test", { value: 1 });
  unsubscribe();
  bus.publish("production:test", { value: 2 });

  assert.deepEqual(received, [{ value: 1 }]);
});

test("one failing subscriber does not prevent other subscribers", () => {
  const reported = [];
  const received = [];
  const bus = new EventBus({ onSubscriberError: event => reported.push(event) });
  bus.subscribe("production:test", () => { throw new Error("subscriber failed"); });
  bus.subscribe("production:test", payload => received.push(payload));

  const result = bus.publish("production:test", { safe: true });

  assert.equal(result.errors.length, 1);
  assert.equal(reported.length, 1);
  assert.deepEqual(received, [{ safe: true }]);
});
