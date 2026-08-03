"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = filename => fs.readFileSync(path.join(root, filename), "utf8");

test("iPad operator uses the existing host command paths and stable camera IDs", () => {
  const client = source("public/operator/operator.js");
  const server = source("operator-server.cjs");
  assert.match(client, /const roles = \["main", "left", "right"\]/);
  assert.match(client, /camera\?\.cameraDeviceId/);
  assert.match(client, /preset\.cameraDeviceId === id/);
  assert.match(client, /shot\.cameraDeviceId === id/);
  assert.match(client, /\/api\/live\/recall-camera-preset/);
  assert.match(client, /\/api\/live\/run-camera-motion/);
  assert.match(client, /\/api\/atem\/take-live/);
  assert.match(server, /commands\.recallCameraPreset\(body\.cameraId, body\.presetId\)/);
  assert.match(server, /commands\.runCameraMotion\(body\.cameraId, body\.shotId\)/);
  assert.match(server, /await takeCameraLive\(body\.cameraId\)/);
});

test("iPad operator disables execution without a live connection and never queues commands", () => {
  const client = source("public/operator/operator.js");
  assert.match(client, /connectionStatus === "connected" && navigator\.onLine/);
  assert.match(client, /if \(!connected\(\)\) throw new Error/);
  assert.match(client, /if \(pending\.has\(key\)\) return/);
  assert.match(client, /pending\.add\(key\)/);
  assert.match(client, /pending\.delete\(key\)/);
  assert.doesNotMatch(client, /localStorage|indexedDB|serviceWorker|BackgroundSync|sendBeacon/);
});

test("resume performs a read-only authoritative refresh and ATEM LIVE remains physical", () => {
  const client = source("public/operator/operator.js");
  const server = source("operator-server.cjs");
  assert.match(client, /pageshow", refreshAuthoritativeState/);
  assert.match(client, /visibilityState === "visible"/);
  assert.match(client, /fetch\("\/api\/state", \{ cache: "no-store" \}\)/);
  assert.match(client, /state\.atemStatus\.liveCameraId === id/);
  assert.match(server, /subscribeAtemStatus/);
});

test("full-screen Home Screen metadata and required responsive layout are present", () => {
  const html = source("public/operator/index.html");
  const css = source("public/operator/operator.css");
  const manifest = JSON.parse(source("public/operator/manifest.webmanifest"));
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /manifest\.webmanifest/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "landscape");
  assert.match(css, /100dvh/);
  assert.match(css, /grid-template-columns:repeat\(3/);
  assert.match(css, /orientation:portrait/);
  assert.match(css, /min-height:52px/);
});
