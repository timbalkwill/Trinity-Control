"use strict";

const { executeCue } = require("./cue-execution.cjs");

function createOperatorCommands({ loadState, saveState, normalizeState = state => state, cueExecutor = executeCue }) {
  const subscribers = new Set();
  let queue = Promise.resolve();

  function publish(state) {
    for (const subscriber of subscribers) {
      try { subscriber(state); }
      catch { /* One disconnected client must not fail a persisted command. */ }
    }
    return state;
  }

  function enqueue(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  }

  function mutate(operation) {
    return enqueue(() => {
      const state = loadState();
      operation(state);
      return publish(saveState(state));
    });
  }

  return {
    getState: () => loadState(),
    replaceState: state => enqueue(() => publish(saveState(normalizeState(state)))),
    updateState: operation => mutate(operation),
    goCue: index => mutate(state => cueExecutor(state, index)),
    nextCue: () => mutate(state => cueExecutor(state, Number(state.live?.cueIndex || 0) + 1)),
    previousCue: () => mutate(state => cueExecutor(state, Number(state.live?.cueIndex || 0) - 1)),
    toggleHold: () => mutate(state => {
      state.live = state.live && typeof state.live === "object" ? state.live : {};
      state.live.hold = !state.live.hold;
    }),
    setLightingOverride: sceneId => mutate(state => {
      if (typeof sceneId !== "string" || !sceneId) throw new TypeError("sceneId is required");
      const scene = (state.lightingScenes || []).find(item => item.id === sceneId);
      if (!scene) throw new RangeError(`Unknown lighting scene: ${sceneId}`);
      state.live = state.live && typeof state.live === "object" ? state.live : {};
      state.live.lightingOverrideId = sceneId;
      state.live.activityLog = [
        { at: Date.now(), message: `Lighting scene: ${scene.name || sceneId}` },
        ...(Array.isArray(state.live.activityLog) ? state.live.activityLog : [])
      ].slice(0, 8);
    }),
    returnToCueLighting: () => mutate(state => {
      state.live = state.live && typeof state.live === "object" ? state.live : {};
      state.live.lightingOverrideId = null;
      state.live.activityLog = [
        { at: Date.now(), message: "Returned to cue lighting" },
        ...(Array.isArray(state.live.activityLog) ? state.live.activityLog : [])
      ].slice(0, 8);
    }),
    subscribe: subscriber => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    }
  };
}

module.exports = { createOperatorCommands };
