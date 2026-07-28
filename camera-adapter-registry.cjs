"use strict";

const { createPtzOpticsTransport } = require("./ptzoptics-adapter.cjs");

const clone = value => JSON.parse(JSON.stringify(value));

function safeHost(host) {
  if (typeof host !== "string" || !host.trim()) return null;
  return host.trim().replace(/[\r\n]/g, "");
}

function createCameraExecutor(state, { transports = {}, timeoutMs } = {}) {
  const devices = clone(Array.isArray(state?.devices) ? state.devices : []);
  const presets = clone(Array.isArray(state?.cameraPresets) ? state.cameraPresets : []);
  const ptzoptics = transports.ptzoptics || createPtzOpticsTransport({ timeoutMs });

  return Object.freeze({
    recallPreset({ cameraDeviceId, presetId }) {
      const camera = devices.find(item => item?.id === cameraDeviceId && item?.type === "camera");
      const preset = presets.find(item => item?.id === presetId && item?.cameraDeviceId === cameraDeviceId);
      const adapterType = camera?.adapterType || null;
      const diagnostic = { adapterType, safeHost: safeHost(camera?.ipAddress || camera?.connection?.host), presetNumber: preset?.presetNumber ?? null };
      if (!camera || !adapterType || adapterType !== "ptzoptics") {
        return { ok: false, code: "adapterUnavailable", message: adapterType ? `Camera adapter is not supported: ${adapterType}` : "Camera adapter is not configured", ...diagnostic };
      }
      if (!diagnostic.safeHost) {
        return { ok: false, code: "configurationIncomplete", message: "Camera host is not configured", ...diagnostic };
      }
      if (!preset || !Number.isInteger(preset.presetNumber) || preset.presetNumber < 0 || preset.presetNumber > 254) {
        return { ok: false, code: "presetMappingMissing", message: "Camera preset hardware mapping is missing or invalid", ...diagnostic };
      }
      return Promise.resolve(ptzoptics({
        host: diagnostic.safeHost,
        port: camera.port ?? camera.connection?.port,
        protocol: camera.protocol ?? camera.connection?.protocol,
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

module.exports = { createCameraExecutor };
