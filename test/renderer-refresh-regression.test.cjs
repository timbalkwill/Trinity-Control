"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
const manager = fs.readFileSync(path.join(root, "qlcplus-service-manager.cjs"), "utf8");

test("background events suppress equivalent full renders and target QLC status", () => {
  assert.match(renderer, /equivalentState\(state, nextState\)/);
  assert.match(renderer, /equivalentStatus\(qlcServiceStatus, status\)/);
  assert.match(renderer, /updateQlcStatusElements\(\)/);
  assert.match(renderer, /qlc-service-state/);
  assert.match(renderer, /qlc-service-message/);
});

test("legitimate renders preserve scroll while navigation deliberately starts fresh", () => {
  assert.match(renderer, /captureScrollState\(page\)/);
  assert.match(renderer, /restoreScrollState\(scrollSnapshot, page\)/);
  assert.match(renderer, /reason: 'navigation', preserveScroll: false/);
  assert.doesNotMatch(renderer, /scrollTo\s*\(\s*0\s*,\s*0\s*\)|location\.reload/);
});

test("renderer subscriptions and timers have one initialization owner", () => {
  assert.equal((renderer.match(/onStateChanged\(/g) || []).length, 1);
  assert.equal((renderer.match(/onQlcServiceStatusChanged\(/g) || []).length, 1);
  assert.equal((preload.match(/ipcRenderer\.on\("operator:state-changed"/g) || []).length, 1);
  assert.equal((preload.match(/ipcRenderer\.on\("qlc-service:status-changed"/g) || []).length, 1);
  assert.equal((manager.match(/monitorTimer = setTimer/g) || []).length, 1);
  assert.match(preload, /removeListener\("operator:state-changed"/);
  assert.match(preload, /removeListener\("qlc-service:status-changed"/);
});

test("health monitoring contains no execution or device activation path", () => {
  const monitor = manager.slice(manager.indexOf("async function monitorOnce"), manager.indexOf("function shutdown"));
  assert.doesNotMatch(monitor, /executeCue|activateControl|recallPreset|prepareCamera|lightingOverride|nextCue|goCue/);
});
