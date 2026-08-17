const fs = require("fs");
const path = require("path");
const { missingLightingDependencies } = require("./lighting-reconciliation.cjs");

function readGitMetadata(projectDirectory, environment = process.env) {
  const suppliedCommit = environment.TRINITY_GIT_COMMIT || environment.GIT_COMMIT || environment.COMMIT_SHA;
  const suppliedBranch = environment.TRINITY_GIT_BRANCH || environment.GIT_BRANCH || environment.BRANCH_NAME;
  let commit = suppliedCommit || null;
  let branch = suppliedBranch || null;
  try {
    let gitDirectory = path.join(projectDirectory, ".git");
    if (fs.statSync(gitDirectory).isFile()) {
      const gitEntry = fs.readFileSync(gitDirectory, "utf8").trim();
      if (gitEntry.startsWith("gitdir:")) gitDirectory = path.resolve(projectDirectory, gitEntry.slice(7).trim());
    }
    const head = fs.readFileSync(path.join(gitDirectory, "HEAD"), "utf8").trim();
    if (head.startsWith("ref:")) {
      const reference = head.slice(5);
      branch ||= reference.replace(/^refs\/heads\//, "");
      commit ||= fs.readFileSync(path.join(gitDirectory, reference), "utf8").trim();
    } else {
      commit ||= head;
    }
  } catch {
    // Packaged applications normally do not include repository metadata.
  }
  return {
    commit: commit ? commit.slice(0, 12) : "Unavailable",
    branch: branch || "Unavailable"
  };
}

function health(status, message) {
  return { status, message };
}

function buildSystemStatus({ state, qlcStatus = {}, atemStatus = {}, operatorStatus = {}, appInfo, storage, localSettings = {}, now = () => new Date(), processInfo = {} }) {
  const devices = state?.devices || [];
  const cameras = devices.filter(device => device.type === "camera");
  const lightingDevice = devices.find(device => device.type === "lighting");
  const presets = state?.cameraPresets || [];
  const cues = state?.runOfService || [];
  const cueIndex = Number.isInteger(state?.live?.cueIndex) ? state.live.cueIndex : 0;
  const currentCue = cues[cueIndex] || null;
  const nextCue = cues[cueIndex + 1] || null;
  const snapshot = state?.live?.executionSnapshot || null;
  const currentLook = (state?.productionLooks || []).find(look =>
    look.id === (snapshot?.productionLookId || currentCue?.productionLookId)
  );
  const lightingExecution = snapshot?.lightingExecutions?.[0];
  const successfulLighting = [...(snapshot?.lightingExecutionResults || [])]
    .reverse()
    .find(result => ["success", "succeeded"].includes(result.status));
  const enabledLighting = Boolean(lightingDevice) && lightingDevice.enabled !== false;
  const connectedLighting = qlcStatus.connectionState === "connected" || qlcStatus.state === "connected";
  const cameraErrors = cameras.filter(camera => camera.enabled !== false &&
    ["error", "offline", "disconnected"].includes(String(camera.connectionStatus || "").toLowerCase()));
  const executionWarnings = snapshot?.warnings || [];
  const unresolvedLighting = missingLightingDependencies(state);
  const affectedLooks = new Set(unresolvedLighting.flatMap(item => item.dependencies.productionLooks.map(reference => reference.id)));
  const affectedCues = new Set(unresolvedLighting.flatMap(item => item.dependencies.serviceCues.map(reference => reference.id)));

  return {
    generatedAt: now().toISOString(),
    application: { ...appInfo, health: health("healthy", "Application is running") },
    lighting: {
      configured: Boolean(lightingDevice),
      enabled: enabledLighting,
      connected: connectedLighting,
      adapter: lightingDevice?.adapterType || "Not configured",
      transport: lightingDevice
        ? `${lightingDevice.protocol || lightingDevice.connection?.protocol || "ws"}://${lightingDevice.ipAddress || lightingDevice.connection?.host || "localhost"}:${lightingDevice.port || lightingDevice.connection?.port || 9999}`
        : "Not configured",
      activeScene: lightingExecution?.sceneName || snapshot?.lighting?.sceneName || "None",
      lastSuccessfulCommand: successfulLighting?.completedAt || successfulLighting?.executedAt || "None recorded",
      connectionStatus: qlcStatus.connectionState || qlcStatus.state || "Unknown",
      unresolvedFunctionCount: unresolvedLighting.length,
      affectedProductionLookCount: affectedLooks.size,
      affectedServiceCueCount: affectedCues.size,
      health: !lightingDevice || !enabledLighting
        ? health("warning", "Lighting is disabled or not configured")
        : connectedLighting
          ? unresolvedLighting.length
            ? health("warning", `${unresolvedLighting.length} missing QLC+ function${unresolvedLighting.length === 1 ? "" : "s"} affect Trinity relationships`)
            : health("healthy", "QLC+ is connected and available")
          : health("error", qlcStatus.message || "QLC+ is disconnected")
    },
    cameras: {
      configuredCount: cameras.length,
      items: cameras.map(camera => ({
        id: camera.id,
        name: camera.name,
        status: camera.connectionStatus || (camera.enabled === false ? "Disabled" : "Not tested"),
        protocol: camera.protocol || camera.connection?.protocol || "Not configured",
        presetCount: presets.filter(preset => preset.cameraDeviceId === camera.id).length,
        tracking: Boolean(camera.trackingEnabled),
        lastCommunication: camera.lastCheckedAt || "Never"
      })),
      health: cameraErrors.length
        ? health("error", `${cameraErrors.length} camera${cameraErrors.length === 1 ? "" : "s"} need attention`)
        : cameras.length
          ? health("healthy", `${cameras.length} cameras configured`)
          : health("warning", "No cameras configured")
    },
    atem: {
      name: atemStatus.name || "ATEM Mini Pro",
      enabled: atemStatus.enabled === true,
      configured: atemStatus.configured === true,
      connectionState: atemStatus.connectionState || "notConfigured",
      host: atemStatus.host || "Not configured",
      programInput: atemStatus.programInput ?? "Unknown",
      liveCameraId: atemStatus.liveCameraId || null,
      liveCameraName: cameras.find(camera => camera.id === atemStatus.liveCameraId)?.name || null,
      liveSourceId: atemStatus.liveSourceId || null,
      liveSourceName: atemStatus.liveSourceName || null,
      health: atemStatus.connectionState === "connected"
        ? health("healthy", "ATEM is connected")
        : atemStatus.enabled === false
          ? health("warning", "ATEM is disabled")
          : health("error", atemStatus.message || "ATEM is not connected")
    },
    production: {
      servicePlan: state?.servicePlan?.name || state?.servicePlanName || (cues.length ? "Loaded service plan" : "None"),
      currentCue: currentCue?.name || "None",
      nextCue: nextCue?.name || "None",
      currentLook: currentLook?.name || snapshot?.productionLookName || "None",
      snapshotAvailable: Boolean(snapshot),
      executionReady: Boolean(currentCue) && executionWarnings.length === 0,
      health: !currentCue
        ? health("warning", "No current cue is available")
        : executionWarnings.length
          ? health("warning", `${executionWarnings.length} execution warning${executionWarnings.length === 1 ? "" : "s"}`)
          : health("healthy", "Production state is ready")
    },
    operator: {
      mode: state?.live?.hold ? "Hold" : "Live",
      goReady: Boolean(currentCue),
      backReady: cueIndex > 0,
      liveState: snapshot ? "Execution snapshot active" : "Awaiting GO",
      health: state?.live?.hold
        ? health("warning", "Operator controls are on hold")
        : health("healthy", "Operator controls are available")
    },
    host: {
      platform: appInfo?.operatingSystem || process.platform,
      architecture: appInfo?.architecture || process.arch,
      operatorServerRunning: operatorStatus.running === true,
      operatorPort: operatorStatus.port || 4310,
      operatorLocalUrl: operatorStatus.localUrl || "http://localhost:4310",
      operatorNetworkUrls: Array.isArray(operatorStatus.networkUrls) ? [...operatorStatus.networkUrls] : [],
      qlcApplicationConfigured: localSettings.qlcApplicationConfigured === true,
      qlcWorkspaceConfigured: localSettings.qlcWorkspaceConfigured === true,
      health: operatorStatus.running === true
        ? health("healthy", "Windows host services are available")
        : health("warning", "Browser Operator server is not running")
    },
    performance: {
      memoryBytes: processInfo.memoryBytes ?? null,
      cpuUserMicroseconds: processInfo.cpuUserMicroseconds ?? null,
      cpuSystemMicroseconds: processInfo.cpuSystemMicroseconds ?? null,
      uptimeSeconds: processInfo.uptimeSeconds ?? null,
      activeTimers: processInfo.activeTimers ?? null,
      health: health("healthy", "Performance diagnostics available")
    },
    storage: {
      userData: storage.userData,
      configuration: storage.configuration,
      servicePlans: storage.servicePlans,
      logs: storage.logs,
      health: health("healthy", "Storage locations are available")
    }
  };
}

module.exports = { buildSystemStatus, readGitMetadata };
