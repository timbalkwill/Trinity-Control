"use strict";

const { performance } = require("node:perf_hooks");

function createTakeLatency({ sourceId, origin = "unknown", enabled = process.env.TRINITY_TAKE_LATENCY === "1", logger = console, now = () => performance.now() } = {}) {
  const startedAt = now();
  const points = new Map([["main_entry", startedAt]]);
  const mark = name => {
    const value = now();
    if (!points.has(name)) points.set(name, value);
    return value;
  };
  const elapsed = (from, to) => points.has(from) && points.has(to) ? Math.max(0, points.get(to) - points.get(from)) : null;
  const finish = outcome => {
    mark("finished");
    const result = Object.freeze({
      sourceId: sourceId || null,
      origin,
      outcome,
      mainToRouterMs: elapsed("main_entry", "router_entry"),
      routerToAdapterMs: elapsed("router_entry", "adapter_entry"),
      adapterToPreviewCommandMs: elapsed("adapter_entry", "preview_command"),
      previewToAutoCommandMs: elapsed("preview_command", "auto_command"),
      autoToTransitionMs: elapsed("auto_command", "transition_started"),
      transitionDurationMs: elapsed("transition_started", "transition_complete"),
      mainTotalMs: elapsed("main_entry", "finished")
    });
    if (enabled) logger.info?.(`[TakeLatency] source=${sourceId || "unknown"} origin=${origin} outcome=${outcome} main_to_router=${result.mainToRouterMs?.toFixed(1) ?? "n/a"}ms router_to_adapter=${result.routerToAdapterMs?.toFixed(1) ?? "n/a"}ms adapter_to_preview=${result.adapterToPreviewCommandMs?.toFixed(1) ?? "n/a"}ms preview_to_auto=${result.previewToAutoCommandMs?.toFixed(1) ?? "n/a"}ms auto_to_transition=${result.autoToTransitionMs?.toFixed(1) ?? "n/a"}ms transition_duration=${result.transitionDurationMs?.toFixed(1) ?? "n/a"}ms total=${result.mainTotalMs?.toFixed(1) ?? "n/a"}ms`);
    return result;
  };
  return Object.freeze({ mark, finish });
}

module.exports = { createTakeLatency };
