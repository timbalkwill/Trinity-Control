"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const servicePage = renderer.slice(renderer.indexOf("function openCueDeleteModal"), renderer.indexOf("function looksPage"));
const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
const main = fs.readFileSync(path.join(root, "electron-main.cjs"), "utf8");

test("Service delete uses an accessible in-app modal and no native confirmation", () => {
  assert.match(servicePage, /role="dialog"/);
  assert.match(servicePage, /aria-modal="true"/);
  assert.match(servicePage, /Delete cue\?/);
  assert.match(servicePage, /Delete Cue/);
  assert.match(servicePage, /event\.key === 'Escape'/);
  assert.match(servicePage, /trigger\?\.focus/);
  assert.doesNotMatch(servicePage, /window\.confirm|window\.alert|\bconfirm\(/);
});

test("Service cards use cue IDs and only the dedicated handle is draggable", () => {
  assert.match(servicePage, /data-cue-id=/);
  assert.match(servicePage, /data-remove-cue=/);
  assert.match(servicePage, /data-drag-cue=/);
  assert.match(servicePage, /class="service-drag-handle" draggable="true"/);
  assert.doesNotMatch(servicePage, /class="service-cue-card[^"]*"[\s\S]{0,120}draggable="true"/);
  assert.match(servicePage, /data-move-cue=.*data-direction="up"/);
  assert.match(servicePage, /data-move-cue=.*data-direction="down"/);
});

test("Service ID operations cross preload and IPC without cue execution side effects", () => {
  for (const contract of ["reorderCueById", "moveCueById", "deleteCueById"]) assert.match(preload, new RegExp(contract));
  for (const channel of ["cue:move-by-id", "cue:nudge-by-id", "cue:remove-by-id"]) assert.match(main, new RegExp(channel));
  const editing = servicePage.slice(servicePage.indexOf("document.querySelectorAll('[data-template]')"));
  assert.doesNotMatch(editing, /activateControl|recallPreset|prepareCamera|qlcplusWS/);
});

test("delete submission is guarded against double confirmation and failures remain visible", () => {
  assert.match(servicePage, /if \(submitting\) return/);
  assert.match(servicePage, /submitting = true/);
  assert.match(servicePage, /service-delete-error/);
  assert.match(servicePage, /servicePageError = error\.message/);
});
