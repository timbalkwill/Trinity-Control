"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const service = require("../service-operations.cjs");
const { createOperatorCommands } = require("../operator-commands.cjs");
const { executeCue } = require("../cue-execution.cjs");

function stateFixture() {
  return {
    runOfService: [],
    cueTemplates: [{ id: "template", name: "Sermon", notes: "Prepared", productionLookId: "look", lightingSceneId: "" }],
    productionLooks: [{ id: "look", name: "Teaching", lightingSceneId: "warm" }],
    lightingScenes: [{ id: "warm", name: "Warm" }, { id: "blue", name: "Blue" }],
    devices: [],
    live: { cueIndex: 0 }
  };
}

test("custom cues use the ordinary persisted cue model and require a name", () => {
  const state = stateFixture();
  const cue = service.createCue(state, {
    name: "  Prayer Response  ",
    notes: "  Watch the pastor for the close.  ",
    productionLookId: "look",
    lightingSceneId: "blue"
  }, { id: "custom" });

  assert.deepEqual(cue, {
    id: "custom",
    name: "Prayer Response",
    duration: 0,
    notes: "Watch the pastor for the close.",
    productionLookId: "look",
    lightingSceneId: "blue"
  });
  assert.equal(state.runOfService[0], cue);
  assert.throws(() => service.createCue(state, { name: "   " }), /Cue Name is required/);
});

test("custom cues can be edited, reordered, duplicated, and deleted by existing operations", () => {
  const state = stateFixture();
  service.createCue(state, { name: "One" }, { id: "one" });
  service.createCue(state, { name: "Two" }, { id: "two" });
  service.updateCue(state, 0, { name: "Opening Prayer", notes: "Stand by", productionLookId: "look" });
  service.moveCueById(state, "one", "down");
  service.duplicateCue(state, 1, { id: "copy" });

  assert.deepEqual(state.runOfService.map(cue => cue.id), ["two", "one", "copy"]);
  assert.equal(state.runOfService[1].name, "Opening Prayer");
  service.deleteCueById(state, "copy");
  assert.deepEqual(state.runOfService.map(cue => cue.id), ["two", "one"]);
});

test("operator creation persists custom and template-derived cues through the same command", async () => {
  let current = stateFixture();
  const commands = createOperatorCommands({
    loadState: () => current,
    saveState: state => (current = state)
  });

  await commands.createCue({ name: "Custom Moment", notes: "Free text" });
  await commands.createCue(current.cueTemplates[0]);
  await commands.createCue(current.cueTemplates[0]);

  assert.deepEqual(current.runOfService.map(cue => cue.name), ["Custom Moment", "Sermon", "Sermon"]);
  assert.equal(new Set(current.runOfService.map(cue => cue.id)).size, 3);
  assert.equal(current.runOfService.some(cue => cue.id === "template"), false);
  assert.equal(current.runOfService.some(cue => "templateId" in cue || "type" in cue), false);
});

test("GO on a custom cue freezes configured lighting and sends zero camera commands", () => {
  const state = stateFixture();
  service.createCue(state, { name: "Announcements", productionLookId: "look", lightingSceneId: "blue" }, { id: "announcements" });
  let cameraCommands = 0;

  executeCue(state, 0, {
    now: () => 1234,
    cameraExecutor: () => { cameraCommands += 1; }
  });

  assert.equal(state.live.activeCueId, "announcements");
  assert.equal(state.live.executionSnapshot.lighting.sceneId, "blue");
  assert.equal(cameraCommands, 0);
});

test("Service UI exposes custom creation and a shared camera-free editor", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  const editor = renderer.slice(renderer.indexOf("function openCueEditor"), renderer.indexOf("function legacyLivePage"));
  const preload = fs.readFileSync(path.join(__dirname, "../preload.cjs"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "../electron-main.cjs"), "utf8");

  assert.match(renderer, /id="service-create-cue"[^>]*>\+ ADD CUE<\/button>/);
  assert.match(editor, /Cue Name/);
  assert.match(editor, /Description \/ Operator Note/);
  assert.match(editor, /Production Look/);
  assert.match(editor, /Lighting Override/);
  assert.match(editor, /creating \? await window\.trinity\.createCue\(input\) : await window\.trinity\.updateCue/);
  assert.doesNotMatch(editor, /camera|preset|shot/i);
  assert.match(preload, /createCue: input => ipcRenderer\.invoke\("cue:create", input\)/);
  assert.match(main, /ipcMain\.handle\("cue:create", \(_e, input\) => commands\.createCue\(input\)\)/);
  assert.match(main, /ipcMain\.handle\("cue:addTemplate"[\s\S]*commands\.createCue\(template\)/);
});
