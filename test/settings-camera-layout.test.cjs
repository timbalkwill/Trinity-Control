"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "settings.css"), "utf8");
const cameraCardStart = renderer.lastIndexOf("const cameraCard");
const cameraCard = renderer.slice(
  cameraCardStart,
  renderer.indexOf("const editor = selected", cameraCardStart)
);

test("Settings camera collection uses a shrink-safe responsive grid", () => {
  assert.match(renderer, /camera-settings-collection"><div class="device-grid camera-settings-grid/);
  assert.match(styles, /\.camera-settings-collection\s*\{[^}]*container-type:\s*inline-size[^}]*container-name:\s*camera-collection/s);
  assert.match(styles, /\.camera-settings-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(styles, /@container camera-collection \(min-width:\s*1144px\)\s*\{\s*\.camera-settings-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.doesNotMatch(styles, /\.camera-settings-grid\s*\{[^}]*(?:auto-fit|auto-fill)/s);
  assert.match(styles, /\.settings-layout\s*\{[^}]*min-width:\s*0/s);
  assert.match(styles, /\.settings-content\s*\{[^}]*min-width:\s*0/s);
  assert.match(styles, /\.device-card\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
  assert.doesNotMatch(styles, /\.camera-config-card\s*\{[^}]*(?:position:\s*absolute|width:\s*[5-9]\d\dpx)/s);
  assert.doesNotMatch(styles, /\.settings-content\s*\{[^}]*overflow-x:\s*(?:auto|scroll)/s);
});

test("camera card content cannot force horizontal overflow", () => {
  assert.match(styles, /\.device-facts\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(styles, /\.device-card small\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(styles, /\.camera-config-card \.settings-card-actions\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(styles, /\.camera-config-card \.settings-card-actions\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*margin:\s*0[^}]*box-sizing:\s*border-box/s);
  assert.match(styles, /\.camera-config-card \.settings-card-actions\s*\{[^}]*position:\s*static[^}]*justify-content:\s*flex-start/s);
  assert.doesNotMatch(styles, /\.camera-config-card \.settings-card-actions\s*\{[^}]*(?:margin-inline:\s*-|transform:|position:\s*absolute)/s);
  assert.match(styles, /\.camera-config-card \.settings-card-actions button\s*\{[^}]*flex:\s*0 0 auto[^}]*text-overflow:\s*clip/s);
  assert.doesNotMatch(styles, /\.camera-config-card \.settings-card-actions button\s*\{[^}]*(?:overflow:\s*hidden|text-overflow:\s*ellipsis|white-space:\s*nowrap)/s);
  assert.match(renderer, /\.row-actions\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(styles, /\.camera-config-name\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
  assert.match(cameraCard, /class="camera-config-name" title="\$\{escapeHtml\(camera\.name\)\}"/);
});

test("all camera actions and accessible move semantics remain intact", () => {
  for (const action of [
    "data-configure-device",
    "data-duplicate-device",
    "data-toggle-device",
    "data-test-device",
    "data-delete-device"
  ]) assert.match(cameraCard, new RegExp(action));
  assert.match(cameraCard, /class="danger" data-delete-device/);
  assert.match(cameraCard, /aria-label="Move \$\{escapeHtml\(camera\.name\)\} up"/);
  assert.match(cameraCard, /aria-label="Move \$\{escapeHtml\(camera\.name\)\} down"/);
  assert.match(cameraCard, /index === 0 \? 'disabled'/);
  assert.match(cameraCard, /index === cameras\.length - 1 \? 'disabled'/);
});

test("camera layout remains presentation-only", () => {
  const layoutSource = `${styles}\n${cameraCard}`;
  assert.doesNotMatch(layoutSource, /goCue|executeCue|activateControl|recallPreset|prepareCamera|makeCameraLive/);
  assert.doesNotMatch(cameraCard, /\brender\s*\(/);
  assert.doesNotMatch(renderer, /(?:ResizeObserver|addEventListener\(['"]resize|onresize|cameraGridColumns)/);
});

test("camera container threshold includes two safe cards, gap, and focus allowance", () => {
  const safeCardWidth = 560;
  const gridGap = 8;
  const focusAllowance = 16;
  const threshold = 1144;
  assert.equal(threshold, (safeCardWidth * 2) + gridGap + focusAllowance);
  const columnsAt = width => width >= threshold ? 2 : 1;
  assert.equal(columnsAt(threshold + 1), 2);
  assert.equal(columnsAt(threshold), 2);
  for (const width of [threshold - 1, threshold - 25, threshold - 50, threshold - 100, 800]) {
    assert.equal(columnsAt(width), 1);
  }
});
