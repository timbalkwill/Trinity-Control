"use strict";

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const SERVICE_STATES = new Set([
  "disabled", "not-configured", "starting", "running-managed", "running-external",
  "connected", "degraded", "stopped", "failed", "restarting", "waiting-for-readiness"
]);
const DEFAULT_STARTUP_TIMEOUT_MS = 15000;
const DEFAULT_HEALTH_INTERVAL_MS = 5000;
const MIN_HEALTH_INTERVAL_MS = 1000;
const RESTART_COOLDOWN_MS = 10000;

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.round(number))) : fallback;
}

function normalizeQlcServiceSettings(input = {}) {
  return {
    ...input,
    manageAutomatically: input.manageAutomatically === true,
    applicationPath: typeof input.applicationPath === "string" ? input.applicationPath.trim() : "",
    workspacePath: typeof input.workspacePath === "string" ? input.workspacePath.trim() : "",
    startupTimeoutMs: boundedNumber(input.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS, 1000, 120000),
    healthCheckIntervalMs: boundedNumber(input.healthCheckIntervalMs, DEFAULT_HEALTH_INTERVAL_MS, MIN_HEALTH_INTERVAL_MS, 60000),
    restartIfClosed: input.restartIfClosed === true
  };
}

const SAFE_LAUNCH_MESSAGES = new Set([
  "QLC+ application not found.",
  "QLC+ workspace not found.",
  "QLC+ executable not found inside application bundle.",
  "Failed to start QLC+."
]);

function safeErrorMessage(error) {
  return SAFE_LAUNCH_MESSAGES.has(error?.message) ? error.message : "Failed to start QLC+.";
}

function launchArguments(settings, platform = process.platform, existsSync = fs.existsSync) {
  const normalized = normalizeQlcServiceSettings(settings);
  const isMacBundle = platform === "darwin" && normalized.applicationPath.toLocaleLowerCase().endsWith(".app");
  if (!normalized.applicationPath || !existsSync(normalized.applicationPath)) {
    throw Object.assign(new Error("QLC+ application not found."), { code: "application-not-found" });
  }
  if (!normalized.workspacePath || !existsSync(normalized.workspacePath)) {
    throw Object.assign(new Error("QLC+ workspace not found."), { code: "workspace-not-found" });
  }
  if (!isMacBundle) {
    return { command: normalized.applicationPath, args: [normalized.workspacePath], mode: "executable" };
  }
  const preferred = path.join(normalized.applicationPath, "Contents", "MacOS", "qlcplus-qml");
  const fallback = path.join(normalized.applicationPath, "Contents", "MacOS", "qlcplus");
  const executable = existsSync(preferred) ? preferred : existsSync(fallback) ? fallback : null;
  if (!executable) {
    throw Object.assign(new Error("QLC+ executable not found inside application bundle."), { code: "bundle-executable-not-found" });
  }
  return { command: executable, args: ["--open", normalized.workspacePath], mode: "mac-app-bundle" };
}

function createQlcLauncher({ spawnImpl = spawn, platform = process.platform, existsSync = fs.existsSync, logger = null } = {}) {
  return settings => new Promise((resolve, reject) => {
    let launch;
    try {
      launch = launchArguments(settings, platform, existsSync);
    } catch (error) {
      logger?.warn?.(`[QLC+ Service] Launch failed: ${safeErrorMessage(error)}`);
      reject(Object.assign(new Error(safeErrorMessage(error)), { code: error.code || "launch-failed" }));
      return;
    }
    logger?.info?.(`[QLC+ Service] Startup attempt began`);
    logger?.info?.(`[QLC+ Service] Launch mode: ${launch.mode}`);
    logger?.info?.(`[QLC+ Service] Resolved executable: ${launch.command}`);
    logger?.info?.(`[QLC+ Service] Workspace: ${path.basename(settings.workspacePath)}`);
    let child;
    try {
      child = spawnImpl(launch.command, launch.args, {
        shell: false,
        detached: true,
        stdio: "ignore"
      });
    } catch {
      logger?.warn?.(`[QLC+ Service] Launch failed`);
      reject(Object.assign(new Error("Failed to start QLC+."), { code: "launch-failed" }));
      return;
    }
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      logger?.warn?.(`[QLC+ Service] Launch failed`);
      reject(Object.assign(new Error("Failed to start QLC+."), { code: "launch-failed" }));
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      child?.unref?.();
      logger?.info?.(`[QLC+ Service] Child process started`);
      resolve({ child, mode: launch.mode });
    };
    child?.once?.("error", fail);
    child?.once?.("spawn", succeed);
    if (!child?.once) succeed();
  });
}

function workspaceCompatibility({ settings, device, lightingScenes } = {}) {
  const productionPage = device?.metadata?.qlcplusProductionPage || null;
  const pages = Array.isArray(device?.metadata?.qlcplusPages) ? device.metadata.qlcplusPages : [];
  const widgets = Array.isArray(device?.metadata?.qlcplusWidgets) ? device.metadata.qlcplusWidgets : [];
  if (!widgets.length) {
    return { state: "unverified", message: "Workspace could not be verified", severity: "warning", productionButtonCount: 0 };
  }
  if (productionPage && !pages.some(item => item?.pageName === productionPage)) {
    return { state: "expected-page-missing", message: "Expected Production Page missing", severity: "warning", productionButtonCount: 0 };
  }
  const widgetIds = new Set(widgets.map(item => String(item?.widgetId)));
  const mappedProduction = (lightingScenes || []).filter(scene =>
    scene?.productionScene !== false && scene?.externalControl?.widgetId
  );
  const missingMappedCount = mappedProduction.filter(scene => !widgetIds.has(String(scene.externalControl.widgetId))).length;
  if (missingMappedCount) {
    return {
      state: "mapped-controls-missing",
      message: "Mapped controls missing",
      severity: "warning",
      missingMappedCount,
      productionButtonCount: widgets.filter(item => item?.pageName === productionPage && item?.canActivateScene === true).length
    };
  }
  if (!mappedProduction.some(scene => widgetIds.has(String(scene.externalControl.widgetId)))) {
    return { state: "unverified", message: "Workspace could not be verified", severity: "warning", productionButtonCount: 0 };
  }
  return {
    state: "compatible",
    message: "Workspace compatible",
    severity: "ready",
    productionButtonCount: widgets.filter(item =>
      item?.canActivateScene === true && (!productionPage || item?.pageName === productionPage)
    ).length,
    workspaceName: settings?.workspacePath ? path.basename(settings.workspacePath) : null
  };
}

function delay(ms, setTimer) {
  return new Promise(resolve => setTimer(resolve, ms));
}

function createQlcServiceManager({
  getContext,
  discover,
  launch = createQlcLauncher(),
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  restartCooldownMs = RESTART_COOLDOWN_MS,
  logger = null,
  onStatus = () => {}
} = {}) {
  let ownedChild = null;
  let managedLaunch = false;
  let activeLaunch = null;
  let stopped = false;
  let monitorTimer = null;
  let lastRestartAt = 0;
  let status = {
    state: "disabled",
    launchMode: null,
    owned: false,
    message: "Automatic QLC+ management is disabled",
    compatibility: null,
    checkedAt: null
  };

  const publish = patch => {
    status = { ...status, ...patch, checkedAt: now() };
    onStatus({ ...status });
    return { ...status };
  };
  const context = () => {
    const current = getContext?.() || {};
    return { ...current, settings: normalizeQlcServiceSettings(current.settings) };
  };

  async function check({ externalIfReachable = false } = {}) {
    const current = context();
    const result = await discover(current.device);
    if (!result?.ok) return { ok: false, result, current };
    if (activeLaunch) {
      logger?.info?.("[QLC+ Service] WebSocket connected");
      logger?.info?.("[QLC+ Service] Discovery succeeded");
    }
    const processState = managedLaunch ? "running-managed" : "running-external";
    publish({
      state: processState,
      launchMode: managedLaunch ? "managed" : "external",
      owned: managedLaunch,
      message: managedLaunch ? "QLC+ is running under Trinity management" : "QLC+ was already running"
    });
    const compatibility = workspaceCompatibility(current);
    publish({
      state: "connected",
      processState,
      launchMode: managedLaunch ? "managed" : externalIfReachable ? "external" : status.launchMode,
      owned: managedLaunch,
      message: "Connected",
      compatibility,
      widgetCount: result.widgetCount ?? result.widgets?.length ?? 0,
      elapsedMs: result.elapsedMs || 0
    });
    return { ok: true, result, current, compatibility };
  }

  async function waitForReadiness() {
    const startedAt = now();
    const timeout = context().settings.startupTimeoutMs;
    do {
      if (stopped || context().device?.enabled === false) return { ok: false, cancelled: true };
      publish({ state: "waiting-for-readiness", message: "Waiting for QLC+" });
      if (now() === startedAt) logger?.info?.("[QLC+ Service] Waiting for WebSocket");
      const result = await check();
      if (result.ok) return result;
      if (now() - startedAt >= timeout) break;
      await delay(Math.min(500, Math.max(50, timeout)), setTimer);
    } while (now() - startedAt <= timeout);
    publish({ state: "degraded", message: "QLC+ process launched, but WebSocket readiness timed out" });
    logger?.warn?.("[QLC+ Service] Startup timed out");
    return { ok: false, timeout: true };
  }

  async function launchManaged({ restarting = false } = {}) {
    if (activeLaunch) return activeLaunch;
    activeLaunch = (async () => {
      const current = context();
      if (!current.settings.applicationPath || !current.settings.workspacePath) {
        return publish({ state: "not-configured", message: "QLC+ application and workspace are required" });
      }
      publish({ state: restarting ? "restarting" : "starting", message: restarting ? "Restarting QLC+" : "Starting QLC+" });
      try {
        const launched = await launch(current.settings);
        ownedChild = launched.child || null;
        managedLaunch = true;
        publish({ state: "running-managed", launchMode: "managed", owned: true, message: "QLC+ launched by Trinity" });
        return await waitForReadiness();
      } catch (error) {
        return publish({ state: "failed", launchMode: "managed", owned: false, message: safeErrorMessage(error) });
      }
    })().finally(() => { activeLaunch = null; });
    return activeLaunch;
  }

  async function initialize() {
    stopped = false;
    const current = context();
    if (!current.settings.manageAutomatically) {
      return publish({ state: "disabled", launchMode: null, owned: false, message: "Automatic QLC+ management is disabled" });
    }
    const existing = await check({ externalIfReachable: true });
    if (existing.ok) return existing;
    return launchManaged();
  }

  async function start() {
    stopped = false;
    const existing = await check({ externalIfReachable: true });
    return existing.ok ? existing : launchManaged();
  }

  async function refresh() {
    const result = await check({ externalIfReachable: !ownedChild });
    if (!result.ok) publish({ state: ownedChild ? "degraded" : "stopped", message: "QLC+ is unavailable" });
    return result;
  }

  async function restart() {
    if (!managedLaunch) {
      return publish({ message: "Trinity cannot safely restart an externally managed QLC+ instance" });
    }
    if (ownedChild?.kill) ownedChild.kill();
    else if (status.state === "connected") {
      return publish({ message: "Trinity cannot safely terminate this QLC+ application bundle" });
    }
    ownedChild = null;
    lastRestartAt = now();
    return launchManaged({ restarting: true });
  }

  async function monitorOnce() {
    const result = await refresh();
    if (result.ok) return result;
    const settings = context().settings;
    if (!settings.restartIfClosed || (lastRestartAt && now() - lastRestartAt < restartCooldownMs)) return result;
    lastRestartAt = now();
    return launchManaged({ restarting: true });
  }

  function scheduleMonitor() {
    if (monitorTimer) clearTimer(monitorTimer);
    const settings = context().settings;
    if (stopped || (!settings.manageAutomatically && !settings.restartIfClosed)) return;
    monitorTimer = setTimer(async () => {
      await monitorOnce();
      scheduleMonitor();
    }, settings.healthCheckIntervalMs);
  }

  function shutdown() {
    stopped = true;
    if (monitorTimer) clearTimer(monitorTimer);
    monitorTimer = null;
  }

  return {
    getStatus: () => ({ ...status }),
    initialize,
    launchManaged,
    monitorOnce,
    refresh,
    restart,
    scheduleMonitor,
    shutdown,
    start
  };
}

module.exports = {
  DEFAULT_HEALTH_INTERVAL_MS,
  DEFAULT_STARTUP_TIMEOUT_MS,
  MIN_HEALTH_INTERVAL_MS,
  RESTART_COOLDOWN_MS,
  SERVICE_STATES,
  createQlcLauncher,
  createQlcServiceManager,
  launchArguments,
  normalizeQlcServiceSettings,
  safeErrorMessage,
  workspaceCompatibility
};
