"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "live-layout-fix.css"), "utf8");

test("Live retains four camera sources in the existing renderer workflow", () => {
  const livePage = renderer.slice(renderer.indexOf("function livePage()"), renderer.indexOf("function openCueDeleteModal"));
  assert.match(livePage, /liveCameraTiles\(\)\.slice\(0, 3\)/);
  assert.match(livePage, /cameras\.map\(CameraLiveCard\)\.join\(''\)\}\$\{PcMediaLiveCard\(\)\}/);
});

test("standard Live camera layout is an equal 2 by 2 grid without scrolling", () => {
  assert.match(styles, /\.simple-camera-grid\s*\{[^}]*overflow:\s*hidden !important;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*grid-template-rows:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(styles, /\.simple-camera-card\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
});

test("every camera card stacks its preview and controls vertically", () => {
  const card = styles.slice(styles.indexOf(".simple-camera-card {"), styles.indexOf(".simple-camera-card > header"));
  assert.match(card, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(card, /grid-template-areas:\s*"header header"\s*"preview preview"\s*"summary mode"\s*"selector actions"/);
  assert.doesNotMatch(card, /"preview summary"|"preview mode"|"preview selector"|"preview actions"/);
});

test("previews expand within available height and controls remain below them", () => {
  assert.match(styles, /\.simple-camera-preview\s*\{[^}]*width:\s*auto;[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*aspect-ratio:\s*16 \/ 9;/s);
  assert.match(styles, /\.camera-live-actions\s*\{[^}]*grid-area:\s*actions;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
});

test("camera grid collapses only at the genuinely narrow breakpoint", () => {
  assert.match(styles, /@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.simple-camera-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(styles, /@media \(max-width:\s*1080px\)[\s\S]*?display:\s*none/);
});
