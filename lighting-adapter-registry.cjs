"use strict";

const { DEFAULT_QLC_PORT, createQlcPlusTransport } = require("./qlcplus-websocket-transport.cjs");

function safeConfiguration(device) {
  const connection = device?.connection || {};
  return {
    adapterType: device?.adapterType || device?.metadata?.adapter || null,
    host: connection.host || device?.ipAddress || null,
    port: connection.port || device?.port || DEFAULT_QLC_PORT,
    protocol: connection.protocol || device?.protocol || "ws",
    timeoutMs: connection.timeoutMs || device?.timeoutMs
      ? Math.max(250, Math.min(30000, Number(connection.timeoutMs || device?.timeoutMs) || 3000))
      : 3000,
    username: connection.username || device?.username || null,
    password: connection.password || device?.password || connection.credentialReference || device?.credentialReference || null
  };
}

function resultDetails(config) {
  return {
    adapterType: config.adapterType,
    safeHost: config.host,
    port: config.port
  };
}

function createLightingAdapterRegistry({ transports = {} } = {}) {
  const qlcplus = transports["qlcplus-websocket"] || createQlcPlusTransport();
  function resolve(device) {
    const config = safeConfiguration(device);
    if (config.adapterType !== "qlcplus-websocket") return null;
    return {
      testConnection: async () => ({ ...(await qlcplus.testConnection(config)), ...resultDetails(config) }),
      discoverControls: async () => ({ ...(await qlcplus.discoverControls(config)), ...resultDetails(config) }),
      activateControl: input => qlcplus.activateControl(config, input)
    };
  }
  async function run(device, operation) {
    const config = safeConfiguration(device);
    if (device?.enabled === false) {
      return { ok: false, code: "lightingDisabled", message: "Lighting is disabled in Trinity", ...resultDetails(config) };
    }
    const adapter = resolve(device);
    if (!adapter) {
      return { ok: false, code: "adapterUnavailable", message: "Lighting adapter is not configured or supported", ...resultDetails(config) };
    }
    if (!config.host) {
      return { ok: false, code: "configurationIncomplete", message: "QLC+ host is not configured", ...resultDetails(config) };
    }
    try {
      return await adapter[operation]();
    } catch {
      return { ok: false, code: "unexpectedAdapterError", message: "Unexpected lighting adapter error", ...resultDetails(config) };
    }
  }
  async function execute(device, execution) {
    const config = safeConfiguration(device);
    if (!device) {
      return { ok: false, code: "adapterUnavailable", message: "Lighting adapter is not configured", ...resultDetails(config) };
    }
    if (device.enabled === false) {
      return { ok: false, code: "lightingDisabled", message: "Lighting is disabled in Trinity", ...resultDetails(config) };
    }
    const adapter = resolve(device);
    if (!adapter) {
      return { ok: false, code: "adapterUnavailable", message: "Lighting adapter is not configured or supported", ...resultDetails(config) };
    }
    if (!config.host) {
      return { ok: false, code: "configurationIncomplete", message: "QLC+ host is not configured", ...resultDetails(config) };
    }
    try {
      return { ...(await adapter.activateControl({ externalControlId: execution.widgetId })), ...resultDetails(config) };
    } catch {
      return { ok: false, code: "unexpectedAdapterError", message: "Lighting activation failed", ...resultDetails(config) };
    }
  }
  return {
    resolve,
    testConnection: device => run(device, "testConnection"),
    discoverControls: device => run(device, "discoverControls"),
    execute
  };
}

module.exports = { createLightingAdapterRegistry, safeConfiguration };
