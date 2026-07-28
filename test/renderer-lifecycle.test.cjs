"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

let scrollCalls = [];
global.scrollX = 0;
global.scrollY = 0;
global.innerWidth = 100;
global.innerHeight = 100;
global.scrollTo = (left, top) => scrollCalls.push([left, top]);
global.getComputedStyle = element => element.style || {};

const lifecycle = require(path.join(__dirname, "..", "public", "renderer-lifecycle.js"));

function element({ id = "", top = 0, height = 1000, clientHeight = 100, overflowY = "auto" } = {}) {
  return {
    id,
    scrollTop: top,
    scrollLeft: 0,
    scrollHeight: height,
    scrollWidth: 100,
    clientHeight,
    clientWidth: 100,
    style: { overflowY },
    getAttribute: () => null,
    getClientRects: () => [{}],
    focus() {}
  };
}

function documentWith(elements = []) {
  return {
    activeElement: null,
    body: { scrollHeight: 1000, scrollWidth: 100 },
    documentElement: { scrollHeight: 1000, scrollWidth: 100 },
    querySelectorAll: () => elements,
    getElementById: id => elements.find(item => item.id === id) || null,
    querySelector: () => null
  };
}

test("equivalent cloned state ignores volatile health metadata", () => {
  const previous = { runOfService: [{ id: "cue-1" }], devices: [{ id: "qlc", lastCheckedAt: "one", metadata: { lightingDiagnostic: { ok: true, elapsedMs: 44, discoveredAt: "one" } } }] };
  const next = structuredClone(previous);
  next.devices[0].lastCheckedAt = "two";
  next.devices[0].metadata.lightingDiagnostic.elapsedMs = 51;
  next.devices[0].metadata.lightingDiagnostic.discoveredAt = "two";
  assert.equal(lifecycle.equivalentState(previous, next), true);
  next.runOfService.push({ id: "cue-2" });
  assert.equal(lifecycle.equivalentState(previous, next), false);
});

test("equivalent status ignores poll timestamps but detects connection changes", () => {
  assert.equal(lifecycle.equivalentStatus(
    { state: "connected", checkedAt: 1, elapsedMs: 20 },
    { state: "connected", checkedAt: 2, elapsedMs: 40 }
  ), true);
  assert.equal(lifecycle.equivalentStatus(
    { state: "connected", checkedAt: 1 },
    { state: "degraded", checkedAt: 2 }
  ), false);
});

test("capture and restore preserve window and nested scroll positions", () => {
  const pageContent = element({ id: "page-content", top: 734 });
  const library = element({ id: "library-panel", top: 412 });
  const before = documentWith([pageContent, library]);
  const snapshot = lifecycle.captureScrollState("service", before);
  const nextPageContent = element({ id: "page-content", top: 0 });
  const nextLibrary = element({ id: "library-panel", top: 0 });
  const after = documentWith([nextPageContent, nextLibrary]);
  scrollCalls = [];
  assert.equal(lifecycle.restoreScrollState(snapshot, "service", after), true);
  assert.equal(nextPageContent.scrollTop, 734);
  assert.equal(nextLibrary.scrollTop, 412);
  assert.deepEqual(scrollCalls, [[0, 0]]);
});

test("restoration clamps after shrink and never crosses page navigation", () => {
  const oldPanel = element({ id: "page-content", top: 900 });
  const snapshot = lifecycle.captureScrollState("service", documentWith([oldPanel]));
  const shortPanel = element({ id: "page-content", height: 250, clientHeight: 100 });
  assert.equal(lifecycle.restoreScrollState(snapshot, "service", documentWith([shortPanel])), true);
  assert.equal(shortPanel.scrollTop, 150);
  shortPanel.scrollTop = 0;
  assert.equal(lifecycle.restoreScrollState(snapshot, "lighting", documentWith([shortPanel])), false);
  assert.equal(shortPanel.scrollTop, 0);
});
