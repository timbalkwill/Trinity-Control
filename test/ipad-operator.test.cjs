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
  assert.match(client, /camera\.productionRole === role/);
  assert.match(client, /camera\?\.cameraDeviceId/);
  assert.match(client, /preset\.cameraDeviceId === id/);
  assert.match(client, /shot\.cameraDeviceId === id/);
  assert.match(client, /\/api\/live\/recall-camera-preset/);
  assert.match(client, /\/api\/live\/prepare-motion/);
  assert.match(client, /\/api\/live\/cancel-prepared-motion/);
  assert.match(client, /\/api\/video-sources\/take-live/);
  assert.match(server, /commands\.recallCameraPreset\(body\.cameraId, body\.presetId\)/);
  assert.match(server, /commands\.prepareMotionStart\(body\.cameraId, body\.shotId\)/);
  assert.match(server, /commands\.cancelPreparedMotion\(body\.cameraId\)/);
  assert.match(server, /await takeVideoSource\(body\.videoSourceId\)/);
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

test("resume performs a read-only authoritative refresh and switcher LIVE remains physical", () => {
  const client = source("public/operator/operator.js");
  const server = source("operator-server.cjs");
  assert.match(client, /pageshow", refreshAuthoritativeState/);
  assert.match(client, /visibilityState === "visible"/);
  assert.match(client, /fetch\("\/api\/state", \{ cache: "no-store" \}\)/);
  assert.match(client, /switcherStatus\(\)\.liveSourceId === videoSource\?\.id/);
  assert.match(server, /subscribeVideoRouterStatus/);
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
  assert.match(css, /grid-template-columns:\s*repeat\(3/);
  assert.match(css, /orientation:\s*portrait/);
  assert.match(css, /min-height:\s*52px/);
});

test("transport is a reserved row outside every independently scrolling workspace region", () => {
  const client = source("public/operator/operator.js");
  const css = source("public/operator/operator.css");
  const workspaceStart = client.indexOf('<main class="workspace">');
  const workspaceEnd = client.indexOf("</main>", workspaceStart);
  const transportStart = client.indexOf('<footer class="transport">');
  const serviceStart = client.indexOf('<aside class="service-panel">');
  const serviceEnd = client.indexOf("</aside>", serviceStart);
  const cameraScrollStart = client.indexOf('<div class="camera-content-scroll">');
  const cameraScrollEnd = client.indexOf("</div></div></div>", cameraScrollStart);

  assert.ok(workspaceStart >= 0 && workspaceEnd > workspaceStart);
  assert.ok(transportStart > workspaceEnd);
  assert.ok(client.indexOf('data-action="back"') > transportStart);
  assert.ok(client.indexOf('data-action="go"') > transportStart);
  assert.ok(client.indexOf("CURRENT", transportStart) > transportStart);
  assert.ok(client.indexOf('data-action="back"') > serviceEnd);
  assert.ok(client.indexOf('data-action="go"') > cameraScrollEnd);
  assert.match(css, /grid-template-rows:\s*58px auto minmax\(0, 1fr\) minmax\(62px, auto\)/);
  assert.match(css, /\.workspace[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.camera-grid[^}]*min-height:\s*0[^}]*height:\s*100%[^}]*overflow:\s*hidden/s);
});

test("service and all three camera columns have bounded independent scrolling", () => {
  const client = source("public/operator/operator.js");
  const css = source("public/operator/operator.css");
  assert.match(client, /<div class="cue-list">/);
  assert.match(client, /<div class="camera-content-scroll">/);
  assert.match(client, /FAVORITE STATIC/);
  assert.match(client, /FAVORITE MOTION/);
  assert.match(client, /ALL STATIC/);
  assert.match(client, /ALL MOTION/);
  assert.match(client, /class="take-live"/);
  assert.match(css, /\.cue-list, \.camera-content-scroll[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.camera-column[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto auto/s);
  assert.match(css, /\.camera-grid[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(css, /grid-template-columns:\s*clamp\(220px, 24%, 280px\)/);
});

test("Safari and standalone viewport units retain safe-area and portrait handling", () => {
  const css = source("public/operator/operator.css");
  assert.match(css, /height:\s*100vh;\s*height:\s*100svh;\s*height:\s*100dvh/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /safe-area-inset-left/);
  assert.match(css, /orientation:\s*portrait/);
});
