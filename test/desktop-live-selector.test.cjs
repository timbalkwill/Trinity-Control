"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
const renderer = source("public/app.js");
const card = renderer.slice(renderer.indexOf("function CameraDirectorCard"), renderer.indexOf("function DesktopCameraSelector"));
const selector = renderer.slice(renderer.indexOf("function DesktopCameraSelector"), renderer.indexOf("function livePage"));
const live = renderer.slice(renderer.indexOf("function livePage"), renderer.indexOf("function openCueDeleteModal"));

test("Main, Left, and Right camera headings are the stable-ID selector controls", () => {
  const resolver = renderer.slice(renderer.indexOf("function productionDirectorCameras"), renderer.indexOf("function normalizedCameraControlIdentity"));
  for (const role of ["main", "left", "right"]) assert.match(resolver, new RegExp(`role: '${role}'`));
  assert.match(card, /data-open-desktop-camera-selector="\$\{escapeHtml\(camera\.id\)\}"/);
  assert.match(card, /aria-label="Open shots for \$\{escapeHtml\(camera\.name\)\}"/);
  assert.doesNotMatch(card, />\s*(?:SHOTS|PRESETS|OPEN|SELECT)\s*</);
});

test("focused selector scopes Static and Motion by one stable camera ID", () => {
  assert.match(selector, /preset\.cameraDeviceId === camera\.id/);
  assert.match(selector, /shot\.shotType === 'motion' && shot\.cameraDeviceId === camera\.id/);
  assert.match(selector, /<h3>STATIC<\/h3>[\s\S]*<h3>MOTION<\/h3>/);
  assert.match(selector, /data-desktop-recall-camera="\$\{escapeHtml\(camera\.id\)\}"/);
  assert.match(selector, /data-desktop-prepare-camera="\$\{escapeHtml\(camera\.id\)\}"/);
});

test("favorites sort first once within each section without duplicate libraries", () => {
  assert.match(renderer, /const desktopFavoritesFirst = items => \[\.\.\.items\]\.sort/);
  assert.match(renderer, /Number\(right\.favorite === true\) - Number\(left\.favorite === true\)/);
  assert.match(selector, /const presets = desktopFavoritesFirst/);
  assert.match(selector, /const motions = desktopFavoritesFirst/);
  assert.doesNotMatch(selector, /favoritePresets|favoriteMotions|ALL STATIC|ALL MOTION|FAVORITE STATIC|FAVORITE MOTION/);
});

test("Static and Motion use existing narrow commands and close only after success", () => {
  assert.match(live, /window\.trinity\.recallCameraPreset\(button\.dataset\.desktopRecallCamera, button\.dataset\.desktopRecallPreset\)/);
  assert.match(live, /window\.trinity\.prepareMotionStart\(button\.dataset\.desktopPrepareCamera, button\.dataset\.desktopPrepareMotion\)/);
  assert.match(live, /recallCameraPreset[\s\S]*openDesktopCameraSelectorId = null/);
  assert.match(live, /prepareMotionStart[\s\S]*openDesktopCameraSelectorId = null/);
  assert.match(live, /desktopCameraSelectorError = error\.message/);
  assert.doesNotMatch(live, /recallCameraPreset[\s\S]{0,300}(?:takeVideoSource|takeCameraLive)/);
  assert.doesNotMatch(live, /prepareMotionStart[\s\S]{0,300}(?:runCameraMotion|takeVideoSource|takeCameraLive)/);
});

test("opening and cancelling selector are local-only and never persisted", () => {
  assert.match(live, /openDesktopCameraSelectorId = button\.dataset\.openDesktopCameraSelector/);
  assert.match(live, /data-close-desktop-camera-selector[\s\S]*openDesktopCameraSelectorId = null/);
  assert.doesNotMatch(live, /data-close-desktop-camera-selector[\s\S]{0,250}window\.trinity/);
  assert.doesNotMatch(renderer, /localStorage.*openDesktopCameraSelector|sessionStorage.*openDesktopCameraSelector/);
});

test("minimal cards retain prepared state, Cancel Prep, and deliberate Video Router Take Live", () => {
  assert.match(card, /PREPARED MOTION/);
  assert.match(card, /preparedMotion\.shotName/);
  assert.match(card, /READY FOR TAKE LIVE/);
  assert.match(card, /data-cancel-prepared-motion/);
  assert.match(card, /data-take-video-source/);
  assert.doesNotMatch(card, /camera-preset-list|camera-motion-list|data-desktop-recall|data-desktop-prepare/);
  assert.match(live, /window\.trinity\.takeVideoSource\(button\.dataset\.takeVideoSource\)/);
});

test("Presentation, Production Readiness, and equal camera columns remain intact", () => {
  const styles = source("public/live-layout-fix.css");
  assert.match(live, /class="production-readiness-strip"/);
  assert.match(live, /class="presentation-source-control/);
  assert.match(live, /productionDirectorCameras\(\)\.map\(CameraDirectorCard\)/);
  assert.match(styles, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.simple-live-main\{grid-template-rows:auto auto minmax\(52px,auto\) minmax\(0,1fr\)\}/);
  assert.match(styles, /\.camera-director-card\{padding:10px;gap:8px;grid-template-rows:auto auto minmax\(0,1fr\) auto\}/);
  assert.match(styles, /\.desktop-camera-preparation\{overflow-y:auto/);
  assert.match(styles, /\.atem-take-live\{min-height:54px\}/);
});

test("desktop-only refactor leaves authoring and Browser Operator contracts present", () => {
  const ipad = source("public/operator/operator.js");
  assert.match(renderer, /SET \$\{endpoint\.toUpperCase\(\)\}/);
  assert.match(renderer, /OPEN CAMERA LIBRARY/);
  assert.match(ipad, /data-action="open-camera-selector"/);
  assert.match(ipad, /<h3>STATIC<\/h3>[\s\S]*<h3>MOTION<\/h3>/);
});
