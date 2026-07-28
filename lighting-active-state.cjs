"use strict";

function normalizedIdentity(state) {
  const device = (state?.devices || []).find(item => item?.type === "lighting" && item?.adapterType === "qlcplus-websocket");
  const connection = device?.connection || {};
  return {
    enabled: device?.enabled !== false,
    adapterType: device?.adapterType || null,
    host: connection.host || device?.ipAddress || null,
    port: connection.port || device?.port || 9999,
    protocol: connection.protocol || device?.protocol || "ws",
    workspacePath: state?.settings?.qlcplusService?.workspacePath || null
  };
}

function identityKey(identity) {
  return JSON.stringify([
    identity?.adapterType || null,
    identity?.host || null,
    Number(identity?.port) || null,
    identity?.protocol || null,
    identity?.workspacePath || null
  ]);
}

function createLightingActiveState({ now = Date.now, logger = null } = {}) {
  let active = null;
  let configurationIdentity = null;

  function reset(reason = "unknown") {
    if (active) logger?.info?.(`[Lighting Active State] reset reason=${reason} widget=${active.widgetId}`);
    active = null;
  }

  function synchronize(state) {
    const identity = normalizedIdentity(state);
    const nextIdentity = identityKey(identity);
    if (configurationIdentity !== null && configurationIdentity !== nextIdentity) reset("configuration-changed");
    configurationIdentity = nextIdentity;
    if (!identity.enabled || !identity.adapterType) reset(!identity.enabled ? "adapter-disabled" : "adapter-unconfigured");
    return identity;
  }

  function matches(execution) {
    return Boolean(active
      && active.adapterType === execution?.adapterType
      && active.widgetId === String(execution?.widgetId));
  }

  function markActive(execution, context = {}) {
    active = {
      adapterType: execution.adapterType,
      widgetId: String(execution.widgetId),
      lightingSceneId: execution.lightingSceneId || null,
      sourceCueExecutionId: context.cueExecutionId || null,
      activatedAt: new Date(now()).toISOString()
    };
    logger?.info?.(`[Lighting Active State] updated widget=${active.widgetId} cue=${active.sourceCueExecutionId || "unknown"}`);
    return { ...active };
  }

  return {
    get: () => active ? { ...active } : null,
    markActive,
    matches,
    reset,
    synchronize
  };
}

module.exports = { createLightingActiveState, identityKey, normalizedIdentity };
