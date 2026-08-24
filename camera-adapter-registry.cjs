"use strict";

const { createPtzOpticsTransport, createPtzOpticsStoreTransport, createViscaUdpTransport, createViscaUdpStoreTransport } = require("./ptzoptics-adapter.cjs");
const { normalizeCameraPreset } = require("./camera-preset-operations.cjs");

const clone = value => JSON.parse(JSON.stringify(value));

function safeHost(host) {
  if (typeof host !== "string" || !host.trim()) return null;
  return host.trim().replace(/[\r\n]/g, "");
}

function normalizedIdentity(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function resolveCameraAdapter(camera) {
  const adapterType = normalizedIdentity(camera?.adapterType || camera?.metadata?.adapter);
  const protocol = normalizedIdentity(camera?.protocol || camera?.connection?.protocol);
  if (["visca-udp", "visca-over-ip", "visca-ip"].includes(adapterType)) return "visca-udp";
  if (["visca-udp", "visca-over-ip", "visca-ip"].includes(protocol)) return "visca-udp";
  if (adapterType === "ptzoptics" && ["udp", "visca"].includes(protocol)) return "visca-udp";
  if (adapterType === "ptzoptics") return "ptzoptics";
  return null;
}

function cameraExecutionCapabilities(camera) {
  const adapterType = resolveCameraAdapter(camera);
  const presetRecall = Boolean(adapterType);
  return Object.freeze({
    adapterType: adapterType || camera?.adapterType || null,
    presetRecall,
    presetStore: presetRecall,
    presetTransition: presetRecall,
    presetSpeedControl: false,
    panTiltVelocity: false,
    zoomVelocity: false,
    durationControl: false,
    motionStop: false,
    absolutePosition: false,
    positionInquiry: false
  });
}

function createCameraExecutor(state, { transports = {}, timeoutMs } = {}) {
  const devices = clone(Array.isArray(state?.devices) ? state.devices : []);
  const presets = clone(Array.isArray(state?.cameraPresets) ? state.cameraPresets : []).map(normalizeCameraPreset);
  const ptzoptics = transports.ptzoptics || createPtzOpticsTransport({ timeoutMs });
  const viscaUdp = transports.viscaUdp || createViscaUdpTransport();
  const ptzopticsStore = transports.ptzopticsStore || createPtzOpticsStoreTransport({ timeoutMs });
  const viscaUdpStore = transports.viscaUdpStore || createViscaUdpStoreTransport();

  function commandContext(cameraDeviceId, presetNumber) {
    const camera = devices.find(item => item?.id === cameraDeviceId && item?.type === "camera");
    const configuredAdapterType = camera?.adapterType || null;
    const adapterType = resolveCameraAdapter(camera);
    const configuredPort = camera?.port ?? camera?.connection?.port;
    const diagnostic = { adapterType: adapterType || configuredAdapterType, safeHost: safeHost(camera?.ipAddress || camera?.connection?.host), port: configuredPort ?? null, presetNumber };
    if (!camera || !adapterType) return { error: { ok: false, code: "adapterUnavailable", message: configuredAdapterType ? `Camera adapter is not supported: ${configuredAdapterType}` : "Camera adapter is not configured", ...diagnostic } };
    if (!diagnostic.safeHost) return { error: { ok: false, code: "configurationIncomplete", message: "Camera host is not configured", ...diagnostic } };
    if (adapterType === "visca-udp" && (!Number.isInteger(Number(configuredPort)) || Number(configuredPort) < 1 || Number(configuredPort) > 65535)) return { error: { ok: false, code: "configurationIncomplete", message: "Camera UDP port is not configured", ...diagnostic } };
    const configuredMaximum = camera?.metadata?.cameraManager?.capabilities?.maxPresetNumber;
    const maximum = Number.isInteger(configuredMaximum) ? Math.min(254, configuredMaximum) : 254;
    if (!Number.isInteger(presetNumber) || presetNumber < 0 || presetNumber > maximum) return { error: { ok: false, code: "presetMappingMissing", message: `Camera preset number must be between 0 and ${maximum}`, ...diagnostic } };
    return { camera, adapterType, configuredPort, diagnostic };
  }

  function configuration(context) {
    const { camera, configuredPort, diagnostic } = context;
    return {
      host: diagnostic.safeHost, port: configuredPort, protocol: camera.protocol ?? camera.connection?.protocol,
      viscaAddress: camera.viscaAddress ?? camera.connection?.viscaAddress,
      username: camera.username ?? camera.connection?.username,
      password: camera.password ?? camera.connection?.password ?? camera.credentialReference ?? camera.connection?.credentialReference,
      presetNumber: diagnostic.presetNumber
    };
  }

  return Object.freeze({
    recallPreset({ cameraDeviceId, presetId }) {
      const camera = devices.find(item => item?.id === cameraDeviceId && item?.type === "camera");
      const preset = presets.find(item => item?.id === presetId && item?.cameraDeviceId === cameraDeviceId);
      const context = commandContext(cameraDeviceId, preset?.presetNumber ?? null);
      if (context.error) return { ...context.error, ...(preset ? {} : { message: "Camera preset hardware mapping is missing or invalid" }) };
      const transport = context.adapterType === "visca-udp" ? viscaUdp : ptzoptics;
      return Promise.resolve(transport(configuration(context))).then(
        outcome => ({ ...outcome, ...context.diagnostic }),
        () => ({ ok: false, code: "unexpectedAdapterError", message: "Unexpected camera adapter error", ...context.diagnostic })
      );
    },
    storePreset({ cameraDeviceId, presetNumber }) {
      const context = commandContext(cameraDeviceId, presetNumber);
      if (context.error) return context.error;
      const transport = context.adapterType === "visca-udp" ? viscaUdpStore : ptzopticsStore;
      return Promise.resolve(transport(configuration(context))).then(
        outcome => ({ ...outcome, ...context.diagnostic }),
        () => ({ ok: false, code: "unexpectedAdapterError", message: "Unexpected camera adapter error", ...context.diagnostic })
      );
    }
  });
}

module.exports = { cameraExecutionCapabilities, createCameraExecutor, resolveCameraAdapter };
