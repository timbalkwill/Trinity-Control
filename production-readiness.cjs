"use strict";

const { missingLightingDependencies } = require("./lighting-reconciliation.cjs");

const CAMERA_ROLES = ["main", "left", "right"];
const item = (id, label, state, summary, detail = summary, severity = state === "ready" || state === "optional" ? "ok" : state === "error" ? "error" : "warning") =>
  ({ id, label, state, summary, detail, severity });
const lower = value => String(value || "").toLowerCase();
const cameraAdapterAvailable = camera => [camera?.adapterType, camera?.protocol, camera?.connection?.protocol]
  .some(value => ["ptzoptics", "visca-udp", "visca-over-ip", "visca-ip"].includes(lower(value)));
const cameraConfigured = camera => Boolean(camera?.ipAddress || camera?.connection?.host) && Boolean(camera?.protocol || camera?.connection?.protocol) && cameraAdapterAvailable(camera);

function deriveProductionReadiness({ state = {}, qlcStatus = {}, videoStatus = {}, operatorStatus = {}, homeAssistant = {} } = {}) {
  const devices = state.devices || [];
  const lighting = devices.find(device => device.type === "lighting" && device.adapterType === "qlcplus-websocket");
  const qlcConnected = [qlcStatus.connectionState, qlcStatus.state].some(value => value === "connected");
  const widgets = lighting?.metadata?.qlcplusWidgets || [];
  const discovered = lighting?.metadata?.lightingDiagnostic?.ok === true || widgets.length > 0;
  const availableScenes = (state.lightingScenes || []).filter(scene => scene.available !== false && (scene.authoritativeSource === "qlcplus" || scene.externalControl?.widgetId)).length;
  const missing = missingLightingDependencies(state);
  const affectedLooks = new Set(missing.flatMap(entry => entry.dependencies.productionLooks.map(reference => reference.id))).size;
  const affectedCues = new Set(missing.flatMap(entry => entry.dependencies.serviceCues.map(reference => reference.id))).size;
  const needsReconciliation = (state.lightingScenes || []).filter(scene => scene.reconciliationStatus === "needs-reconciliation").length;
  let lightingItem;
  if (!lighting || lighting.enabled === false) lightingItem = item("lighting", "Lighting", "optional", "Optional / Disabled");
  else if (!qlcConnected) lightingItem = item("lighting", "Lighting", "error", "QLC+ unavailable", qlcStatus.message || "Expected lighting service is not connected");
  else if (!discovered) lightingItem = item("lighting", "Lighting", "warning", "Connected, discovery not verified");
  else lightingItem = item("lighting", "Lighting", "ready", "QLC+ connected", `${availableScenes} available scene${availableScenes === 1 ? "" : "s"}`);

  const reconciliation = missing.length || needsReconciliation
    ? item("lightingReconciliation", "Lighting Reconciliation", "warning", `${missing.length + needsReconciliation} unresolved`, `${missing.length} missing · ${needsReconciliation} needs reconciliation · ${affectedLooks} Looks · ${affectedCues} Cues`)
    : item("lightingReconciliation", "Lighting Reconciliation", "ready", "0 unresolved", `${availableScenes} available · 0 missing · 0 unresolved`);

  const switcherDevice = devices.find(device => device.type === "switcher");
  const switcherRequired = switcherDevice?.enabled !== false && (Boolean(switcherDevice) || (state.videoSources || []).some(source => source.enabled !== false));
  const switcherConnected = videoStatus.connectionState === "connected";
  const switcher = !switcherRequired
    ? item("videoSwitcher", "Video Switcher", "optional", "Optional / Disabled")
    : switcherConnected
      ? item("videoSwitcher", "Video Switcher", "ready", `${videoStatus.backendName || videoStatus.name || "Switcher"} connected`, `Live Source: ${videoStatus.liveSourceName || "None"}`)
      : item("videoSwitcher", "Video Switcher", "error", `${videoStatus.backendName || videoStatus.name || "Switcher"} unavailable`, videoStatus.message || "Active switcher is disconnected");

  const presentation = (state.videoSources || []).find(source => source.sourceType === "video" && source.enabled !== false);
  const backend = videoStatus.backend || "atem";
  const presentationMapping = presentation?.switcherMappings?.[backend]?.input;
  const presentationItem = !presentation
    ? item("presentation", "Presentation Source", "warning", "Not configured")
    : presentationMapping === null || presentationMapping === undefined
      ? item("presentation", "Presentation Source", "warning", "Mapping required", `No ${videoStatus.backendName || backend} mapping`)
      : item("presentation", "Presentation Source", switcherConnected ? "ready" : "warning", switcherConnected ? "Ready" : "Mapped, switcher unavailable", `${presentation.name} mapped to ${videoStatus.backendName || backend} input ${presentationMapping}`);

  const cameraItems = CAMERA_ROLES.map(role => {
    const camera = devices.find(device => device.type === "camera" && (device.id === role || device.logicalRole === role || (role === "main" && device.logicalRole === "center")));
    const label = `${role[0].toUpperCase()}${role.slice(1)} Camera`;
    if (!camera) return item(`camera-${role}`, label, "error", "Not configured");
    if (camera.enabled === false) return item(`camera-${role}`, label, "warning", "Disabled");
    if (!cameraConfigured(camera)) return item(`camera-${role}`, label, "error", cameraAdapterAvailable(camera) ? "Not configured" : "Adapter unavailable");
    const source = (state.videoSources || []).find(value => value.sourceType === "camera" && value.cameraDeviceId === camera.id);
    if (!source || source.switcherMappings?.[backend]?.input == null) return item(`camera-${role}`, label, "error", "Video mapping required");
    const connection = lower(camera.connectionStatus);
    if (["offline", "error", "unavailable", "disconnected"].includes(connection)) return item(`camera-${role}`, label, "error", "Unavailable", camera.connectionStatus);
    if (connection === "connected") return item(`camera-${role}`, label, "ready", "Connected", `${camera.name} · ${camera.protocol || camera.connection?.protocol}`);
    return item(`camera-${role}`, label, "warning", "Configured, not tested", "Configuration is complete; no authoritative connection is available");
  });

  const browserOperator = operatorStatus.running === true
    ? item("browserOperator", "Browser Operator", "ready", "Running", `Port ${operatorStatus.port || 4310}`)
    : item("browserOperator", "Browser Operator", "error", "Not running", operatorStatus.error || "Operator server unavailable");
  const homeAssistantItem = !homeAssistant.configured
    ? item("homeAssistant", "Home Assistant", "optional", "Optional / Disabled")
    : homeAssistant.reachable === true
      ? item("homeAssistant", "Home Assistant", "ready", "Connected")
      : homeAssistant.reachable === false
        ? item("homeAssistant", "Home Assistant", "warning", "Configured, unavailable")
        : item("homeAssistant", "Home Assistant", "warning", "Configured, not verified");
  const items = [lightingItem, switcher, presentationItem, ...cameraItems, browserOperator, homeAssistantItem, reconciliation];
  const blocking = items.filter(value => value.state === "error");
  const warnings = items.filter(value => value.state === "warning");
  const overall = blocking.length ? "error" : warnings.length ? "warning" : "ready";
  return {
    overall,
    label: overall === "ready" ? "READY TO RUN" : overall === "warning" ? "NEEDS ATTENTION" : "NOT READY",
    items,
    groups: {
      lighting: [lightingItem, reconciliation].some(value => value.state === "error") ? "error" : [lightingItem, reconciliation].some(value => value.state === "warning") ? "warning" : "ready",
      video: switcher.state === "error" ? "error" : presentationItem.state === "warning" ? "warning" : switcher.state === "optional" ? "optional" : "ready",
      cameras: cameraItems.some(value => value.state === "error") ? "error" : cameraItems.some(value => value.state === "warning") ? "warning" : "ready",
      host: browserOperator.state
    },
    preparedMotion: Object.values(state.live?.preparedMotions || {}).map(value => ({ cameraId: value.cameraId, shotId: value.shotId, shotName: value.shotName, statusLabel: value.statusLabel }))
  };
}

function safeProductionReadiness(readiness) {
  return {
    overall: readiness.overall,
    label: readiness.label,
    groups: { ...readiness.groups },
    issues: readiness.items.filter(item => ["warning", "error"].includes(item.state)).map(({ id, label, state, summary }) => ({ id, label, state, summary })),
    preparedMotion: readiness.preparedMotion.map(value => ({ ...value }))
  };
}

module.exports = { CAMERA_ROLES, deriveProductionReadiness, safeProductionReadiness };
