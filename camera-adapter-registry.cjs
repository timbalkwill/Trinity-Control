"use strict";

const { createPtzOpticsTransport, createViscaUdpTransport } = require("./ptzoptics-adapter.cjs");

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
  const presets = clone(Array.isArray(state?.cameraPresets) ? state.cameraPresets : []);
  const ptzoptics = transports.ptzoptics || createPtzOpticsTransport({ timeoutMs });
  const viscaUdp = transports.viscaUdp || createViscaUdpTransport();

  return Object.freeze({
    recallPreset({ cameraDeviceId, presetId }) {
      const camera = devices.find(item => item?.id === cameraDeviceId && item?.type === "camera");
      const preset = presets.find(item => item?.id === presetId && item?.cameraDeviceId === cameraDeviceId);
      const configuredAdapterType = camera?.adapterType || null;
      const adapterType = resolveCameraAdapter(camera);
      const configuredPort = camera?.port ?? camera?.connection?.port;
      const diagnostic = { adapterType: adapterType || configuredAdapterType, safeHost: safeHost(camera?.ipAddress || camera?.connection?.host), port: configuredPort ?? null, presetNumber: preset?.presetNumber ?? null };
      if (!camera || !adapterType) {
        return { ok: false, code: "adapterUnavailable", message: configuredAdapterType ? `Camera adapter is not supported: ${configuredAdapterType}` : "Camera adapter is not configured", ...diagnostic };
      }
      if (!diagnostic.safeHost) {
        return { ok: false, code: "configurationIncomplete", message: "Camera host is not configured", ...diagnostic };
      }
      if (adapterType === "visca-udp" && (!Number.isInteger(Number(configuredPort)) || Number(configuredPort) < 1 || Number(configuredPort) > 65535)) {
        return { ok: false, code: "configurationIncomplete", message: "Camera UDP port is not configured", ...diagnostic };
      }
      if (!preset || !Number.isInteger(preset.presetNumber) || preset.presetNumber < 0 || preset.presetNumber > 254) {
        return { ok: false, code: "presetMappingMissing", message: "Camera preset hardware mapping is missing or invalid", ...diagnostic };
      }
      const transport = adapterType === "visca-udp" ? viscaUdp : ptzoptics;
      return Promise.resolve(transport({
        host: diagnostic.safeHost,
        port: configuredPort,
        protocol: camera.protocol ?? camera.connection?.protocol,
        viscaAddress: camera.viscaAddress ?? camera.connection?.viscaAddress,
        username: camera.username ?? camera.connection?.username,
        password: camera.password ?? camera.connection?.password ?? camera.credentialReference ?? camera.connection?.credentialReference,
        presetNumber: preset.presetNumber
      })).then(
        outcome => ({ ...outcome, ...diagnostic }),
        () => ({ ok: false, code: "unexpectedAdapterError", message: "Unexpected camera adapter error", ...diagnostic })
      );
    }
  });
}

module.exports = { cameraExecutionCapabilities, createCameraExecutor, resolveCameraAdapter };
