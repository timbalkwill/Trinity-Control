"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");

test("navigation labels, selection, title, and menu subscriptions share one path", () => {
  for (const label of ["Live", "Service", "Production Looks", "Camera Library", "Lighting Library", "Shot Library", "Settings"]) {
    assert.match(renderer, new RegExp(`'${label}'`));
  }
  assert.match(renderer, /function navigateToPage/);
  assert.match(renderer, /if \(page === nextPage\) return/);
  assert.match(renderer, /document\.title = `Trinity Control —/);
  assert.match(renderer, /window\.trinity\.onNavigate/);
  assert.equal((preload.match(/ipcRenderer\.on\("app:navigate"/g) || []).length, 1);
  assert.match(preload, /removeListener\("app:navigate"/);
});

test("notifications are accessible, deduplicated, and never invoke root render", () => {
  const notifications = renderer.slice(renderer.indexOf("const activeNotifications"), renderer.indexOf("function navigateToPage"));
  assert.match(notifications, /activeNotifications\.has\(key\)/);
  assert.match(notifications, /aria-live/);
  assert.match(notifications, /role.*alert/);
  assert.match(notifications, /Dismiss notification/);
  assert.doesNotMatch(notifications, /\brender\(/);
  assert.match(styles, /\.notification-stack/);
  assert.match(styles, /top: 78px/);
});

test("empty and disabled states provide intentional recovery actions", () => {
  assert.match(renderer, /No cues have been added to this service\./);
  assert.match(renderer, /Add First Cue/);
  assert.match(renderer, /Lighting is disabled in Trinity\./);
  assert.match(renderer, /Open Device Settings/);
});

test("dialogs manage focus, Escape, background scrolling, and safe confirmation behavior", () => {
  const dialog = renderer.slice(renderer.indexOf("async function openApplicationDialog"), renderer.indexOf("const currentCue"));
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /event\.key === 'Escape'/);
  assert.match(dialog, /trigger\?\.focus/);
  assert.match(dialog, /closeButton\.focus/);
  assert.match(dialog, /modal-open/);
  const deleteDialog = renderer.slice(renderer.indexOf("function openCueDeleteModal"), renderer.indexOf("function servicePage"));
  assert.match(deleteDialog, /confirmDelete\.onclick/);
  assert.match(deleteDialog, /if \(submitting\) return/);
});

test("shared controls expose visible focus, disabled, primary, secondary, and destructive variants", () => {
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /\.primary-button/);
  assert.match(styles, /\.secondary-button/);
  assert.match(styles, /button:disabled/);
  assert.match(styles, /\.danger,\s*\.cue-delete/);
  assert.match(styles, /--control-height/);
  assert.match(styles, /--focus-ring/);
});

test("Space and Enter are not global GO shortcuts", () => {
  const keyboard = renderer.slice(renderer.indexOf("document.addEventListener('keydown'"), renderer.indexOf("(async () =>"));
  assert.doesNotMatch(keyboard, /' ': 'go'|Enter: 'go'/);
  assert.doesNotMatch(keyboard, /goCue\(/);
});

test("QLC+ semantics remain separate and presentation updates remain render-safe", () => {
  for (const label of ["Enabled in Trinity", "Disabled in Trinity", "Process:", "Connection:", "Lighting execution:", "Controls discovered:"]) {
    assert.match(renderer, new RegExp(label));
  }
  assert.match(renderer, /Ready with Lighting Disabled/);
  assert.match(renderer, /equivalentStatus\(qlcServiceStatus, status\)/);
  assert.match(renderer, /updateQlcStatusElements\(\)/);
});
