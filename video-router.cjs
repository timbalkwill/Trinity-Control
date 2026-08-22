"use strict";

const VIDEO_TRANSITIONS = new Set(["mix", "cut"]);
const normalizeVideoTransition = value => VIDEO_TRANSITIONS.has(String(value || "").toLocaleLowerCase())
  ? String(value).toLocaleLowerCase() : "mix";

function createVideoRouter({ getState, adapters } = {}) {
  if (typeof getState !== "function" || !adapters) throw new TypeError("Video Router requires state and adapters");
  const subscribers = new Set();
  const activeBackend = () => getState()?.settings?.activeSwitcherBackend || "atem";
  const defaultTransition = () => normalizeVideoTransition(getState()?.settings?.videoSwitching?.defaultTransition);
  const sources = () => Array.isArray(getState()?.videoSources) ? getState().videoSources : [];
  const getSource = sourceId => sources().find(source => source.id === sourceId) || null;

  function getStatus() {
    const backend = activeBackend();
    const adapter = adapters.resolve(backend);
    const adapterStatus = adapter?.getStatus?.() || { connectionState: "unavailable" };
    const liveSource = adapterStatus.programInput === null || adapterStatus.programInput === undefined ? null : sources().find(source =>
      source.enabled !== false && source.switcherMappings?.[backend]?.input === adapterStatus.programInput
    ) || null;
    return Object.freeze({
      backend, backendName: adapterStatus.name || backend.toUpperCase(),
      enabled: adapterStatus.enabled === true, configured: adapterStatus.configured === true,
      connectionState: adapterStatus.connectionState || "unavailable", programInput: adapterStatus.programInput ?? null,
      previewInput: adapterStatus.previewInput ?? null, transitioning: adapterStatus.transitioning === true,
      defaultTransition: defaultTransition(),
      liveSourceId: liveSource?.id || null, liveSourceName: liveSource?.name || null,
      message: adapterStatus.message || null
    });
  }

  async function takeSource(sourceId, options = {}) {
    const source = getSource(sourceId);
    if (!source || source.enabled === false) throw Object.assign(new Error("Video Source is unavailable"), { code: "VIDEO_SOURCE_UNAVAILABLE" });
    const backend = activeBackend();
    const adapter = adapters.resolve(backend);
    if (!adapter) throw Object.assign(new Error(`Switcher backend is unavailable: ${backend}`), { code: "SWITCHER_BACKEND_UNAVAILABLE" });
    const mapping = source.switcherMappings?.[backend];
    if (!mapping || mapping.input === null || mapping.input === undefined) throw Object.assign(new Error(`Video Source has no ${backend.toUpperCase()} mapping`), { code: "SOURCE_MAPPING_MISSING" });
    const transition = normalizeVideoTransition(options.transition || defaultTransition());
    await adapter.takeSource(mapping, { transition });
    const status = getStatus();
    if (status.liveSourceId !== sourceId) throw Object.assign(new Error("Switcher did not confirm the requested Video Source"), { code: "SWITCHER_CONFIRMATION_MISSING" });
    return status;
  }

  function publish() { const status = getStatus(); for (const subscriber of subscribers) try { subscriber(status); } catch {} }
  function subscribe(subscriber) { subscribers.add(subscriber); return () => subscribers.delete(subscriber); }
  function bindAdapter(type) { return adapters.resolve(type)?.subscribe?.(publish) || (() => {}); }

  return Object.freeze({ getSource, getSources: () => sources().map(source => JSON.parse(JSON.stringify(source))), getStatus, takeSource, subscribe, bindAdapter });
}

module.exports = { createVideoRouter, normalizeVideoTransition };
