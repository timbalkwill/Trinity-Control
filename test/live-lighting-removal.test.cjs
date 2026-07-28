"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
const main = fs.readFileSync(path.join(root, "electron-main.cjs"), "utf8");
const commands = fs.readFileSync(path.join(root, "operator-commands.cjs"), "utf8");
const server = fs.readFileSync(path.join(root, "operator-server.cjs"), "utf8");

test("Live page contains no lighting favorite or Return to Cue controls", () => {
  const livePage = renderer.slice(renderer.indexOf("function livePage()"), renderer.indexOf("function openCueDeleteModal"));
  assert.doesNotMatch(livePage, /FAVORITE LIGHTING|data-lighting|return-lighting|Return to cue/i);
  assert.doesNotMatch(livePage, /lightingOverride|returnToCueLighting/);
});

test("obsolete lighting override renderer, preload, IPC, command, and HTTP surfaces are absent", () => {
  assert.doesNotMatch(renderer, /lightingOverride|returnToCueLighting|lightingOverrideId|lightingOverrideExecutionResult/);
  assert.doesNotMatch(preload, /lighting:override|lighting:returnToCue|lightingOverride|returnToCueLighting/);
  assert.doesNotMatch(main, /lighting:override|lighting:returnToCue/);
  assert.doesNotMatch(commands, /setLightingOverride|returnToCueLighting|lightingOverrideId|lightingOverrideExecutionResult/);
  assert.doesNotMatch(server, /api\/lighting\/override|api\/lighting\/return-to-cue/);
});

test("Lighting Library retains direct execution through the shared lighting executor", () => {
  const lightingPage = renderer.slice(renderer.indexOf("function lightingPage()"), renderer.indexOf("function camerasPage()"));
  assert.match(lightingPage, /window\.trinity\.executeLightingScene\(card\.dataset\.selectLighting\)/);
  assert.match(preload, /executeLightingScene: sceneId => ipcRenderer\.invoke\("lighting-scene:execute", sceneId\)/);
  assert.match(main, /ipcMain\.handle\("lighting-scene:execute".*commands\.executeLightingScene/s);
  assert.match(commands, /executeLightingScene: sceneId => enqueue/);
  assert.match(commands, /lightingExecutorFactory\(state/);
});

test("opening and navigating Live cannot execute lighting", () => {
  const livePage = renderer.slice(renderer.indexOf("function livePage()"), renderer.indexOf("function openCueDeleteModal"));
  assert.doesNotMatch(livePage, /executeLightingScene|createLightingExecutor|activateControl|sendWidgetValue/);
});
