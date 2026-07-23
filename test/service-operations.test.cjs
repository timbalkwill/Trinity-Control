const test = require("node:test");
const assert = require("node:assert/strict");
const { deleteCue, duplicateCue, insertCue, keyboardCommand, reorderCue, timingSnapshot } = require("../service-operations.cjs");

function state() {
  return {
    runOfService: [
      { id: "a", name: "A", duration: 60, productionLookId: "look", lightingSceneId: "light-a", cameraLayoutId: "cam-a" },
      { id: "b", name: "B", duration: 120, productionLookId: "look" },
      { id: "c", name: "C", duration: 180, productionLookId: "look" }
    ],
    live: { cueIndex: 1, cueStartedAt: 9000, serviceStartedAt: 5000 }
  };
}

test("reorder preserves the active cue by ID", () => {
  const value = state();
  reorderCue(value, 0, 2);
  assert.deepEqual(value.runOfService.map(cue => cue.id), ["b", "c", "a"]);
  assert.equal(value.runOfService[value.live.cueIndex].id, "b");
});

test("duplicate retains cue-specific overrides with a unique identity", () => {
  const value = state();
  duplicateCue(value, 0, { id: "copy" });
  assert.deepEqual(value.runOfService[1], { ...value.runOfService[0], id: "copy", name: "A Copy" });
});

test("insert above and below creates editable cues", () => {
  const above = state();
  insertCue(above, 1, "above", { id: "above" });
  assert.equal(above.runOfService[1].id, "above");
  const below = state();
  insertCue(below, 1, "below", { id: "below" });
  assert.equal(below.runOfService[2].id, "below");
});

test("delete non-active cue preserves active cue", () => {
  const value = state();
  deleteCue(value, 0);
  assert.equal(value.runOfService[value.live.cueIndex].id, "b");
});

test("delete active cue requires confirmation and selects nearest cue", () => {
  const value = state();
  assert.throws(() => deleteCue(value, 1), error => error.code === "CONFIRM_ACTIVE_DELETE");
  deleteCue(value, 1, { confirmActive: true });
  assert.equal(value.runOfService[value.live.cueIndex].id, "c");
});

test("final remaining cue cannot be deleted", () => {
  const value = state();
  value.runOfService = [value.runOfService[0]];
  value.live.cueIndex = 0;
  assert.throws(() => deleteCue(value, 0, { confirmActive: true }), /final cue/i);
});

test("timing calculations report elapsed and estimated remaining without mutation", () => {
  const value = state();
  const snapshot = JSON.stringify(value);
  assert.deepEqual(timingSnapshot(value, 10000), { cueElapsed: 1, serviceElapsed: 5, estimatedRemaining: 299, position: 2, total: 3 });
  assert.equal(JSON.stringify(value), snapshot);
});

test("keyboard routing ignores editing targets", () => {
  assert.equal(keyboardCommand({ key: " " }), "go");
  assert.equal(keyboardCommand({ key: "Enter" }), "go");
  assert.equal(keyboardCommand({ key: "ArrowRight" }), "next");
  assert.equal(keyboardCommand({ key: "ArrowLeft" }), "back");
  assert.equal(keyboardCommand({ key: "H" }), "hold");
  assert.equal(keyboardCommand({ key: "Escape" }), "escape");
  assert.equal(keyboardCommand({ key: " ", targetTag: "input" }), null);
  assert.equal(keyboardCommand({ key: "Enter", editing: true }), null);
});
