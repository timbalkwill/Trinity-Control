"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createApplicationMenuTemplate } = require("../application-menu.cjs");

const root = path.join(__dirname, "..");
const packageJson = require("../package.json");
const main = fs.readFileSync(path.join(root, "electron-main.cjs"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

function flatten(items) {
  return items.flatMap(item => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])]);
}

test("application metadata consistently identifies Trinity Control", () => {
  assert.equal(packageJson.build.productName, "Trinity Control");
  assert.equal(packageJson.build.appId, "org.trinitybaptist.trinitycontrol");
  assert.match(packageJson.description, /Production control system for Trinity Baptist Church/);
  assert.match(main, /app\.setName\("Trinity Control"\)/);
  assert.match(main, /title: "Trinity Control"/);
  assert.match(html, /<title>Trinity Control<\/title>/);
  assert.match(main, /minWidth: 1024, minHeight: 700/);
});

test("production menu omits development commands and development menu includes them", () => {
  const production = flatten(createApplicationMenuTemplate({ isMac: true, isDevelopment: false }));
  const development = flatten(createApplicationMenuTemplate({ isMac: true, isDevelopment: true }));
  assert.equal(production.some(item => ["reload", "toggleDevTools"].includes(item.role)), false);
  assert.equal(development.some(item => item.role === "reload"), true);
  assert.equal(development.some(item => item.role === "toggleDevTools"), true);
});

test("menu navigation uses the established page path without execution side effects", () => {
  const pages = [];
  const menu = flatten(createApplicationMenuTemplate({ navigate: page => pages.push(page) }));
  menu.find(item => item.label === "Service").click();
  menu.find(item => item.label === "Lighting Library").click();
  assert.deepEqual(pages, ["service", "lighting"]);
  const source = fs.readFileSync(path.join(root, "application-menu.cjs"), "utf8");
  assert.doesNotMatch(source, /goCue|nextCue|activateControl|lightingOverride|recallPreset|prepareCamera|makeCameraLive/);
});

test("About dialog shows safe package and runtime information", () => {
  const about = renderer.slice(renderer.indexOf("async function openApplicationDialog"), renderer.indexOf("const currentCue"));
  assert.match(about, /Production control system for Trinity Baptist Church/);
  assert.match(about, /Hendersonville, Tennessee/);
  assert.match(about, /info\.version/);
  assert.match(about, /info\.electronVersion/);
  assert.match(about, /info\.nodeVersion/);
  assert.doesNotMatch(about, /credential|password|workspacePath|userData|homeDir/);
});

test("official wordmark remains untouched and square icon requirements are documented", () => {
  assert.equal(fs.existsSync(path.join(root, "public", "assets", "trinity-logo.png")), true);
  const instructions = fs.readFileSync(path.join(root, "build", "icons", "README.md"), "utf8");
  assert.match(instructions, /officially approved Trinity emblem/);
  assert.match(instructions, /not cropped, redrawn, or stretched/);
  assert.match(instructions, /trinity-control\.icns/);
  assert.match(instructions, /trinity-control\.ico/);
});
