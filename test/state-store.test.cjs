const test = require("node:test");
const assert = require("node:assert/strict");
const { StateStore } = require("../src/core/state-store.cjs");

test("initial and committed snapshots always contain monotonic revisions", () => {
  const store = new StateStore({ live: { hold: false } });
  assert.equal(store.getSnapshot().revision, 0);

  const next = store.getSnapshot();
  next.live.hold = true;
  const committed = store.commit(next);

  assert.equal(committed.revision, 1);
  assert.equal(store.getRevision(), 1);
  assert.equal(store.getSnapshot().revision, 1);
});

test("callers cannot mutate the authoritative snapshot", () => {
  const store = new StateStore({ live: { hold: false } });
  const external = store.getSnapshot();
  external.live.hold = true;

  assert.equal(store.getSnapshot().live.hold, false);
});
