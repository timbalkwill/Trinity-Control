"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const {
  createQlcLauncher,
  createQlcServiceManager,
  launchArguments,
  normalizeQlcServiceSettings,
  workspaceCompatibility
} = require("../qlcplus-service-manager.cjs");

function context(settings = {}, patch = {}) {
  return {
    settings: normalizeQlcServiceSettings({
      manageAutomatically: true,
      applicationPath: "/Applications/QLC Plus.app",
      workspacePath: "/Lighting Workspaces/Trinity Sunday.qxw",
      ...settings
    }),
    device: {
      id: "lighting",
      type: "lighting",
      enabled: true,
      adapterType: "qlcplus-websocket",
      metadata: {
        qlcplusProductionPage: "Sunday Morning",
        qlcplusPages: [{ pageName: "Sunday Morning" }],
        qlcplusWidgets: [{ widgetId: "10", name: "Welcome", pageName: "Sunday Morning", widgetType: "Button", canActivateScene: true }]
      }
    },
    lightingScenes: [{
      id: "welcome",
      productionScene: true,
      externalControl: { adapterType: "qlcplus-websocket", widgetId: "10" }
    }],
    ...patch
  };
}

test("legacy managed-service settings default safely and preserve configured values", () => {
  assert.deepEqual(normalizeQlcServiceSettings(), {
    manageAutomatically: false,
    applicationPath: "",
    workspacePath: "",
    startupTimeoutMs: 15000,
    healthCheckIntervalMs: 5000,
    restartIfClosed: false
  });
  const normalized = normalizeQlcServiceSettings({
    applicationPath: " /Applications/QLC+.app ",
    workspacePath: " /Shows/Trinity.qxw ",
    startupTimeoutMs: 22000,
    healthCheckIntervalMs: 50,
    restartIfClosed: true,
    future: "preserved"
  });
  assert.equal(normalized.applicationPath, "/Applications/QLC+.app");
  assert.equal(normalized.workspacePath, "/Shows/Trinity.qxw");
  assert.equal(normalized.startupTimeoutMs, 22000);
  assert.equal(normalized.healthCheckIntervalMs, 1000);
  assert.equal(normalized.restartIfClosed, true);
  assert.equal(normalized.future, "preserved");
});

test("platform launch plans preserve paths as separate arguments without a shell", async () => {
  const preferred = "/Applications/QLC Plus.app/Contents/MacOS/qlcplus-qml";
  const fallback = "/Applications/QLC Plus.app/Contents/MacOS/qlcplus";
  const existing = new Set([
    "/Applications/QLC Plus.app",
    "/Lighting Workspaces/Trinity Sunday.qxw",
    preferred
  ]);
  assert.deepEqual(launchArguments(context().settings, "darwin", value => existing.has(value)), {
    command: preferred,
    args: ["--open", "/Lighting Workspaces/Trinity Sunday.qxw"],
    mode: "mac-app-bundle"
  });
  assert.deepEqual(launchArguments(
    { applicationPath: "/opt/QLC Plus/qlcplus", workspacePath: "/Shows/Sunday Service.qxw" },
    "linux",
    () => true
  ), {
    command: "/opt/QLC Plus/qlcplus",
    args: ["/Shows/Sunday Service.qxw"],
    mode: "executable"
  });

  let invocation;
  const launcher = createQlcLauncher({
    platform: "darwin",
    existsSync: value => existing.has(value),
    spawnImpl: (command, args, options) => {
      invocation = { command, args, options };
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }
  });
  await launcher(context().settings);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.command, preferred);
  assert.deepEqual(invocation.args, ["--open", "/Lighting Workspaces/Trinity Sunday.qxw"]);
});

test("macOS bundle resolution falls back safely and validates every path before spawn", async () => {
  const application = "/Applications/QLC+.app";
  const workspace = "/Shows/Trinity.qxw";
  const fallback = `${application}/Contents/MacOS/qlcplus`;
  assert.equal(launchArguments(
    { applicationPath: application, workspacePath: workspace },
    "darwin",
    value => [application, workspace, fallback].includes(value)
  ).command, fallback);
  assert.throws(
    () => launchArguments({ applicationPath: application, workspacePath: workspace }, "darwin", value => value === workspace),
    /QLC\+ application not found\./
  );
  assert.throws(
    () => launchArguments({ applicationPath: application, workspacePath: workspace }, "darwin", value => value === application),
    /QLC\+ workspace not found\./
  );
  assert.throws(
    () => launchArguments(
      { applicationPath: application, workspacePath: workspace },
      "darwin",
      value => value === application || value === workspace
    ),
    /QLC\+ executable not found inside application bundle\./
  );
});

test("disabled automatic management performs no health check or launch", async () => {
  let calls = 0;
  const current = context({ manageAutomatically: false });
  const manager = createQlcServiceManager({
    getContext: () => current,
    discover: async () => { calls += 1; return { ok: true }; },
    launch: async () => { calls += 1; return {}; }
  });
  await manager.initialize();
  assert.equal(calls, 0);
  assert.equal(manager.getStatus().state, "disabled");
});

test("manual Start remains available when automatic initial launch is disabled", async () => {
  let launches = 0;
  let discoveries = 0;
  const manager = createQlcServiceManager({
    getContext: () => context({ manageAutomatically: false }),
    discover: async () => ({ ok: ++discoveries > 1, widgetCount: 1 }),
    launch: async () => {
      launches += 1;
      return { child: { unref() {} } };
    }
  });
  await manager.start();
  assert.equal(launches, 1);
  assert.equal(manager.getStatus().state, "connected");
});

test("reachable QLC+ is reused as external and discovery runs exactly once", async () => {
  let discoveryCalls = 0;
  const transitions = [];
  const manager = createQlcServiceManager({
    getContext: () => context(),
    discover: async () => ({ ok: ++discoveryCalls === 1, widgetCount: 1, elapsedMs: 4 }),
    launch: async () => { throw new Error("must not launch"); },
    onStatus: status => transitions.push(status.state)
  });
  await manager.initialize();
  assert.equal(discoveryCalls, 1);
  assert.equal(manager.getStatus().state, "connected");
  assert.equal(manager.getStatus().launchMode, "external");
  assert.equal(manager.getStatus().owned, false);
  assert.ok(transitions.includes("running-external"));
});

test("unreachable QLC+ launches once and bounded readiness refreshes once successfully", async () => {
  let discoveries = 0;
  let launches = 0;
  const child = { kill() {}, unref() {} };
  const manager = createQlcServiceManager({
    getContext: () => context({ startupTimeoutMs: 2000 }),
    discover: async () => ({ ok: ++discoveries >= 2, widgetCount: 1 }),
    launch: async settings => {
      launches += 1;
      assert.equal(settings.workspacePath, "/Lighting Workspaces/Trinity Sunday.qxw");
      return { child, mode: "mac-app" };
    }
  });
  await manager.initialize();
  assert.equal(launches, 1);
  assert.equal(discoveries, 2);
  assert.equal(manager.getStatus().state, "connected");
  assert.equal(manager.getStatus().launchMode, "managed");
});

test("launch errors are sanitized and concurrent launch attempts are deduplicated", async () => {
  let launches = 0;
  let release;
  const launchPromise = new Promise(resolve => { release = resolve; });
  const manager = createQlcServiceManager({
    getContext: () => context(),
    discover: async () => ({ ok: false }),
    launch: async () => {
      launches += 1;
      await launchPromise;
      throw new Error("private path and process details");
    }
  });
  const first = manager.start();
  const second = manager.start();
  await new Promise(resolve => setImmediate(resolve));
  release();
  await Promise.all([first, second]);
  assert.equal(launches, 1);
  assert.equal(manager.getStatus().state, "failed");
  assert.doesNotMatch(manager.getStatus().message, /private|process details/);
});

test("readiness polling is bounded and timeout becomes degraded", async () => {
  let clock = 0;
  let calls = 0;
  const manager = createQlcServiceManager({
    getContext: () => context({ startupTimeoutMs: 1000 }),
    discover: async () => { calls += 1; return { ok: false }; },
    launch: async () => ({ child: { unref() {} } }),
    now: () => clock,
    setTimer: callback => { clock += 500; callback(); return 1; }
  });
  await manager.initialize();
  assert.ok(calls >= 2 && calls <= 4);
  assert.equal(manager.getStatus().state, "degraded");
});

test("restart policy, cooldown, ownership, and shutdown are bounded", async () => {
  let clock = 20000;
  let launches = 0;
  let kills = 0;
  let healthy = false;
  const current = context({ restartIfClosed: true });
  const manager = createQlcServiceManager({
    getContext: () => current,
    discover: async () => ({ ok: healthy }),
    launch: async () => {
      launches += 1;
      healthy = true;
      return { child: { kill: () => { kills += 1; healthy = false; }, unref() {} } };
    },
    now: () => clock
  });
  await manager.initialize();
  assert.equal(launches, 1);
  healthy = false;
  clock += 10001;
  await manager.monitorOnce();
  assert.equal(launches, 2);
  await manager.monitorOnce();
  assert.equal(launches, 2);
  await manager.restart();
  assert.equal(kills, 1);
  manager.shutdown();
  assert.equal(kills, 1, "shutdown must not terminate QLC+");

  let externalLaunches = 0;
  const external = createQlcServiceManager({
    getContext: () => context(),
    discover: async () => ({ ok: true }),
    launch: async () => { externalLaunches += 1; return {}; }
  });
  await external.initialize();
  await external.restart();
  assert.equal(externalLaunches, 0);
  assert.match(external.getStatus().message, /cannot safely restart/);
});

test("restart disabled never relaunches after a failed health check", async () => {
  let reachable = true;
  let launches = 0;
  const manager = createQlcServiceManager({
    getContext: () => context({ restartIfClosed: false }),
    discover: async () => ({ ok: reachable }),
    launch: async () => { launches += 1; return {}; }
  });
  await manager.initialize();
  reachable = false;
  await manager.monitorOnce();
  assert.equal(launches, 0);
  assert.equal(manager.getStatus().state, "stopped");
});

test("workspace compatibility reports compatible, missing page, missing mappings, and unverified", () => {
  assert.equal(workspaceCompatibility(context()).state, "compatible");
  const missingPage = context({}, { device: { ...context().device, metadata: { ...context().device.metadata, qlcplusPages: [] } } });
  assert.equal(workspaceCompatibility(missingPage).state, "expected-page-missing");
  const missingMapping = context({}, {
    lightingScenes: [{ productionScene: true, externalControl: { widgetId: "missing" } }]
  });
  assert.equal(workspaceCompatibility(missingMapping).state, "mapped-controls-missing");
  const unverified = context({}, { device: { ...context().device, metadata: { qlcplusWidgets: [] } } });
  assert.equal(workspaceCompatibility(unverified).state, "unverified");
});

test("managed service renderer and Electron integration expose no credentials or activation path", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "electron-main.cjs"), "utf8");
  const service = fs.readFileSync(path.join(__dirname, "..", "qlcplus-service-manager.cjs"), "utf8");
  assert.match(renderer, /Manage QLC\+ Automatically/);
  assert.match(renderer, /START QLC\+/);
  assert.match(renderer, /RESTART QLC\+/);
  assert.match(renderer, /OPEN QLC\+ CONFIGURATION/);
  assert.match(main, /dialog\.showOpenDialog/);
  assert.doesNotMatch(service, /activateControl|setWidget/);
  assert.doesNotMatch(service, /command:\s*"open"|args:\s*\["-a"/);
  assert.doesNotMatch(main.slice(main.indexOf("createQlcServiceManager"), main.indexOf("operatorServer =")), /activateControl/);
  assert.doesNotMatch(renderer.slice(renderer.indexOf("QLC\\+ SERVICE"), renderer.indexOf("function render")), /credentialReference|password/);
});
