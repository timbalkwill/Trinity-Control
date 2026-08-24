"use strict";

const SETUP_VERSION = 1;
const OPTIONAL_SYSTEMS = Object.freeze(["qlcplus", "atem", "cameras", "homeAssistant"]);

function normalizeSetup(value, { legacy = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      version: SETUP_VERSION,
      completed: legacy,
      completedAt: null,
      skippedSystems: []
    };
  }
  return {
    ...value,
    version: SETUP_VERSION,
    completed: value.completed === true,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
    skippedSystems: [...new Set((Array.isArray(value.skippedSystems) ? value.skippedSystems : [])
      .filter(system => OPTIONAL_SYSTEMS.includes(system)))]
  };
}

function cameraConfigured(camera) {
  return Boolean(camera?.enabled && camera?.adapterType && (camera.ipAddress || camera.connection?.host));
}

function setupReadiness({ state, operatorStatus = {}, qlcStatus = {}, atemStatus = {}, homeAssistant = {} } = {}) {
  const devices = state?.devices || [];
  const qlc = state?.settings?.qlcplusService || {};
  const cameras = ["main", "left", "right"].map(role => {
    const camera = devices.find(device => device.type === "camera" && (device.logicalRole === role || device.id === role));
    return {
      id: camera?.id || null,
      role,
      name: camera?.name || `${role[0].toUpperCase()}${role.slice(1)} Camera`,
      classification: "optional",
      state: cameraConfigured(camera) ? (camera.connectionStatus === "connected" ? "ready" : "needs-review") : "not-configured",
      detail: cameraConfigured(camera) ? (camera.connectionStatus === "connected" ? "Connected" : "Configured, not tested") : "Not configured"
    };
  });
  const qlcConfigured = Boolean(qlc.applicationPath && qlc.workspacePath);
  const atemConfigured = Boolean(atemStatus.configured);
  return [
    { id: "host", label: "Production Host", classification: "required", state: "ready", detail: "Ready" },
    {
      id: "browserOperator", label: "Browser Operator", classification: "required",
      state: operatorStatus.running ? "ready" : "needs-review",
      detail: operatorStatus.running ? "Ready" : "Server not running"
    },
    {
      id: "qlcplus", label: "QLC+", classification: "optional",
      state: qlcStatus.connectionState === "connected" ? "ready" : qlcConfigured ? "needs-review" : "not-configured",
      detail: qlcStatus.connectionState === "connected" ? "Connected" : qlcConfigured ? "Configured, not connected" : "Needs executable and workspace"
    },
    {
      id: "atem", label: "ATEM", classification: "optional",
      state: atemStatus.connectionState === "connected" ? "ready" : atemConfigured ? "needs-review" : "not-configured",
      detail: atemStatus.connectionState === "connected" ? "Connected" : atemConfigured ? "Configured, not tested" : "Not configured"
    },
    ...cameras.map(camera => ({ ...camera, label: `${camera.name}` })),
    {
      id: "homeAssistant", label: "Home Assistant", classification: "optional",
      state: homeAssistant.reachable ? "ready" : homeAssistant.configured ? "needs-review" : "not-configured",
      detail: homeAssistant.reachable ? "Connected" : homeAssistant.configured ? "Configured, not tested" : "Not configured"
    }
  ];
}

function completeSetup(state, { skippedSystems = [], now = Date.now } = {}) {
  state.setup = normalizeSetup({
    ...(state.setup || {}),
    completed: true,
    completedAt: new Date(typeof now === "function" ? now() : now).toISOString(),
    skippedSystems
  });
  return state.setup;
}

module.exports = { OPTIONAL_SYSTEMS, SETUP_VERSION, completeSetup, normalizeSetup, setupReadiness };
