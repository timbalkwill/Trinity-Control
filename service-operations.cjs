"use strict";

function cues(state) {
  if (!Array.isArray(state.runOfService)) state.runOfService = [];
  state.live = state.live && typeof state.live === "object" ? state.live : {};
  return state.runOfService;
}

function indexOfCue(list, cueId) {
  return list.findIndex(cue => cue?.id === cueId);
}

function createCueId() {
  return `cue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function reorderCue(state, from, to) {
  const list = cues(state);
  if (![from, to].every(Number.isInteger) || from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return state;
  const activeId = list[state.live.cueIndex]?.id;
  const [cue] = list.splice(from, 1);
  list.splice(to, 0, cue);
  const activeIndex = indexOfCue(list, activeId);
  if (activeIndex >= 0) state.live.cueIndex = activeIndex;
  return state;
}

function duplicateCue(state, index, { id = createCueId() } = {}) {
  const list = cues(state);
  const source = list[index];
  if (!source) throw new RangeError("Cue not found");
  const copy = { ...source, id, name: `${source.name || "Cue"} Copy` };
  list.splice(index + 1, 0, copy);
  return state;
}

function insertCue(state, index, position, { id = createCueId() } = {}) {
  const list = cues(state);
  const reference = list[index];
  if (!reference) throw new RangeError("Cue not found");
  const cue = {
    id,
    name: "New Cue",
    duration: 300,
    notes: "",
    productionLookId: reference.productionLookId || "",
    lightingSceneId: "",
    cameraLayoutId: ""
  };
  list.splice(index + (position === "below" ? 1 : 0), 0, cue);
  return state;
}

function deleteCue(state, index, { confirmActive = false } = {}) {
  const list = cues(state);
  if (list.length <= 1) throw new RangeError("The final cue cannot be deleted");
  if (!list[index]) throw new RangeError("Cue not found");
  const activeIndex = Number(state.live.cueIndex) || 0;
  const activeId = list[activeIndex]?.id;
  if (index === activeIndex && !confirmActive) {
    const error = new Error("Deleting the active cue requires confirmation");
    error.code = "CONFIRM_ACTIVE_DELETE";
    error.statusCode = 409;
    throw error;
  }
  list.splice(index, 1);
  if (index === activeIndex) state.live.cueIndex = Math.min(index, list.length - 1);
  else {
    const nextActiveIndex = indexOfCue(list, activeId);
    state.live.cueIndex = nextActiveIndex >= 0 ? nextActiveIndex : Math.min(activeIndex, list.length - 1);
  }
  return state;
}

function updateCue(state, index, patch) {
  const list = cues(state);
  const cue = list[index];
  if (!cue) throw new RangeError("Cue not found");
  const allowed = ["name", "duration", "notes", "productionLookId", "lightingSceneId", "cameraLayoutId"];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) cue[key] = patch[key];
  }
  cue.name = String(cue.name || "Untitled Cue").trim() || "Untitled Cue";
  cue.duration = Math.max(0, Number(cue.duration) || 0);
  return state;
}

function timingSnapshot(state, now = Date.now()) {
  const list = Array.isArray(state?.runOfService) ? state.runOfService : [];
  const live = state?.live || {};
  const index = Math.max(0, Math.min(Number(live.cueIndex) || 0, Math.max(0, list.length - 1)));
  const cueElapsed = Math.max(0, Math.floor((now - Number(live.cueStartedAt || now)) / 1000));
  const serviceElapsed = Math.max(0, Math.floor((now - Number(live.serviceStartedAt || live.cueStartedAt || now)) / 1000));
  const currentRemaining = Math.max(0, (Number(list[index]?.duration) || 0) - cueElapsed);
  const futureRemaining = list.slice(index + 1).reduce((total, cue) => total + Math.max(0, Number(cue?.duration) || 0), 0);
  return { cueElapsed, serviceElapsed, estimatedRemaining: list.length ? currentRemaining + futureRemaining : 0, position: list.length ? index + 1 : 0, total: list.length };
}

function keyboardCommand(event) {
  if (event?.isComposing || event?.repeat || event?.editing) return null;
  const tag = String(event?.targetTag || event?.target?.tagName || "").toLowerCase();
  if (["input", "textarea", "select"].includes(tag) || event?.target?.isContentEditable) return null;
  return ({ " ": "go", Enter: "go", ArrowRight: "next", ArrowLeft: "back", h: "hold", H: "hold", Escape: "escape" })[event?.key] || null;
}

module.exports = { deleteCue, duplicateCue, insertCue, keyboardCommand, reorderCue, timingSnapshot, updateCue };
