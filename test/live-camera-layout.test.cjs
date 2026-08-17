"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "live-layout-fix.css"), "utf8");
const livePage = renderer.slice(renderer.indexOf("function livePage()"), renderer.indexOf("function openCueDeleteModal"));

test("Live renders exactly three stable production camera roles", () => {
  const resolver = renderer.slice(renderer.indexOf("function productionDirectorCameras()"), renderer.indexOf("function directorCameraStatus"));
  assert.match(resolver, /role: 'main'/);
  assert.match(resolver, /role: 'left'/);
  assert.match(resolver, /role: 'right'/);
  assert.match(livePage, /productionDirectorCameras\(\)\.map\(CameraDirectorCard\)/);
});

test("Camera Director contains no PC Media or video preview UI", () => {
  assert.doesNotMatch(livePage, /PC Media|PcMediaLiveCard|simple-camera-preview|video-placeholder|<video|<img|<canvas/);
});

test("normal desktop layout keeps three equal camera columns beside a wider service panel", () => {
  assert.match(styles, /\.simple-live-layout\{[^}]*grid-template-columns:clamp\(260px,21vw,340px\) minmax\(0,1fr\)/);
  assert.match(styles, /\.camera-director-grid\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test("desktop Presentation owns a reserved row above the three-camera grid", () => {
  assert.match(styles, /\.simple-live-main\{display:grid;grid-template-rows:auto minmax\(60px,auto\) minmax\(0,1fr\);gap:10px\}/);
  assert.match(styles, /\.simple-live-main>\.presentation-source-control\{[^}]*position:static[^}]*min-height:60px[^}]*overflow:hidden/);
  assert.match(styles, /\.simple-live-main>\.presentation-source-control button\{[^}]*position:static[^}]*min-width:150px[^}]*visibility:visible/);
  assert.doesNotMatch(styles, /\.presentation-source-control\{[^}]*(?:position:absolute|position:fixed)/);
  const heading = livePage.indexOf('class="camera-director-heading"');
  const presentation = livePage.indexOf('class="presentation-source-control');
  const cameras = livePage.indexOf('class="camera-director-grid"');
  assert.ok(heading >= 0 && heading < presentation && presentation < cameras);
});

test("desktop viewport containment leaves the remaining height to camera cards", () => {
  assert.match(styles, /html,body,#app,\.shell\{width:100%;height:100%;overflow:hidden\}/);
  assert.match(styles, /\.content\{min-height:0;overflow:hidden/);
  assert.match(styles, /\.simple-live-layout\{[^}]*height:100%[^}]*overflow:hidden/);
  assert.match(styles, /\.camera-director-grid\{[^}]*height:100%[^}]*min-height:0[^}]*overflow:hidden/);
  assert.match(styles, /\.camera-preset-list\{[^}]*overflow-y:auto/);
});

test("Presentation and camera LIVE indicators remain source-authoritative", () => {
  assert.match(livePage, /presentationLive = atemStatus\?\.connectionState === 'connected' && atemStatus\.liveSourceId === presentationSource\?\.id/);
  const card = renderer.slice(renderer.indexOf('function CameraDirectorCard'), renderer.indexOf('function livePage'));
  assert.match(card, /atemStatus\.liveSourceId === videoSource\?\.id/);
  assert.match(livePage, /presentationLive \? 'LIVE' : presentationMapped \? 'Ready'/);
});

test("narrow layout reflows camera columns without horizontal scrolling", () => {
  assert.match(styles, /@media\(max-width:1100px\)\{[\s\S]*?\.camera-director-grid\{grid-template-columns:minmax\(0,1fr\);overflow-y:auto/);
  assert.match(styles, /overflow:hidden/);
});

test("each camera owns an independently scrollable accessible preset list", () => {
  assert.match(renderer, /data-camera-list=/);
  assert.match(renderer, /tabindex="0" aria-label="Available positions for/);
  assert.match(styles, /\.camera-preset-list\{[^}]*overflow-y:auto/);
});
