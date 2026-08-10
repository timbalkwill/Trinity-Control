"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeLightingScene } = require("../lighting-scene-operations.cjs");
const { extractPortableState } = require("../backup-operations.cjs");

const renderer = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const lightingPage = renderer.slice(renderer.indexOf("function lightingPage"), renderer.indexOf("function camerasPage"));

test("legacy lighting details remain compatible data but are absent from truthful cards", () => {
  const legacy = normalizeLightingScene({
    id: "legacy", name: "Legacy", platform: 85, fill: 42, house: 15, fade: 4,
    externalControl: { widgetId: "123", widgetName: "Sermon", widgetType: "Button" }
  });
  assert.equal(legacy.platform, 85);
  assert.equal(legacy.fill, 42);
  assert.equal(legacy.house, 15);
  assert.equal(legacy.fade, 4);
  const portable = extractPortableState({ lightingScenes: [legacy] });
  assert.equal(portable.lightingScenes[0].platform, 85);
  assert.doesNotMatch(lightingPage, /scene\.(?:platform|fill|house|fade)/);
  assert.doesNotMatch(lightingPage, /Platform\s*<b>|Fill\s*<b>|House\s*<b>|Fade\s*<b>/);
  assert.doesNotMatch(lightingPage, /undefined%|undefineds/);
});

test("cards present authoritative QLC+ identity, page, and truthful availability", () => {
  assert.match(lightingPage, /scene\.qlcMirror\?\.name \|\| scene\.externalControl\?\.widgetName/);
  assert.match(lightingPage, /scene\.qlcMirror\?\.pageName/);
  assert.match(lightingPage, /● Available/);
  assert.match(lightingPage, /⚠ Missing in QLC\+/);
  assert.match(lightingPage, /Last known page:/);
  assert.match(lightingPage, /Needs Reconciliation/);
  assert.match(lightingPage, /No automatic remap/);
  assert.match(lightingPage, /QLC\+ Widget/);
});

test("card actions are explicit and unavailable scenes cannot activate", () => {
  assert.match(lightingPage, /scene\.available !== false \? `<button data-activate-lighting/);
  assert.match(lightingPage, /REVIEW \/ REPLACE/);
  assert.match(lightingPage, /isMissing \? 'REVIEW \/ REPLACE' : 'REVIEW'/);
  assert.doesNotMatch(lightingPage, /data-select-lighting/);
  assert.doesNotMatch(lightingPage, />EDIT</);
  assert.match(lightingPage, /executeLightingScene\(button\.dataset\.activateLighting\)/);
});

test("dependency and summary labels describe their real scopes", () => {
  assert.match(lightingPage, /Production Look\$\{lookReferences\.length === 1/);
  assert.match(lightingPage, /Service Cue\$\{cueReferences\.length === 1/);
  assert.match(lightingPage, /Not currently used/);
  assert.match(lightingPage, /availableScenes\.length\} Available/);
  assert.match(lightingPage, /missingScenes\.length\} Missing/);
  assert.match(lightingPage, /Needs Reconciliation/);
  assert.match(lightingPage, /Production Looks/);
  assert.match(lightingPage, /Service Cues/);
});

test("Production and Utility are explicitly identified as Trinity classification", () => {
  assert.match(lightingPage, /Trinity classification/);
  assert.match(lightingPage, /scene\.productionScene === false \? 'Utility' : 'Production'/);
});
