"use strict";

const { DEVICE_STATES, DEVICE_TYPES } = require("../core/device-manager.cjs");
const { SimulationCameraController } = require("./simulation/simulation-camera-controller.cjs");
const { ViscaCameraAdapter } = require("./visca/visca-camera-adapter.cjs");

class UnavailableCameraAdapter {
  constructor(camera, diagnostic) {
    this.camera = camera;
    this.diagnostic = diagnostic;
  }

  async recallPreset() {
    throw new Error(this.diagnostic);
  }

  close() {}
}

function registerUnavailable(camera, diagnostic, deviceManager, logger) {
  const adapter = new UnavailableCameraAdapter(camera, diagnostic);
  deviceManager.registerDevice({
    id: `camera-${camera.id}`,
    name: camera.name,
    type: DEVICE_TYPES.CAMERA,
    connectionState: DEVICE_STATES.ERROR,
    lastSeen: null,
    statusMessage: diagnostic,
    manufacturer: camera.manufacturer || undefined,
    model: camera.model || undefined,
    supportsReconnect: false,
    supportsConfiguration: true,
    supportsHealthMonitoring: false,
    supportedCapabilities: ["camera", "camera.recallPreset"],
    health: { lastError: diagnostic }
  }, adapter, { resourceIds: [camera.id] });
  logger.error(`[Camera Adapter] ${diagnostic}`);
  return adapter;
}

function registerCameraAdapters({ cameras, deviceManager, logger = console, viscaTransportFactory } = {}) {
  const adapters = [];
  const simulationCameras = (cameras || []).filter(camera => camera.adapterType === "simulation");
  if (simulationCameras.length) {
    const adapter = new SimulationCameraController({ cameras: simulationCameras });
    adapter.register(deviceManager);
    adapters.push(adapter);
  }

  for (const camera of cameras || []) {
    if (camera.adapterType === "simulation") continue;
    if (camera.adapterType !== "visca-over-ip") {
      adapters.push(registerUnavailable(
        camera,
        `Camera ${camera.id}: unsupported adapter type "${camera.adapterType}"`,
        deviceManager,
        logger
      ));
      continue;
    }
    try {
      const adapter = new ViscaCameraAdapter({
        camera,
        logger,
        transport: viscaTransportFactory?.(camera)
      });
      adapter.register(deviceManager);
      adapters.push(adapter);
    } catch (error) {
      adapters.push(registerUnavailable(camera, error.message, deviceManager, logger));
    }
  }

  return {
    adapters,
    close() {
      for (const adapter of adapters) adapter.close?.();
    }
  };
}

module.exports = { UnavailableCameraAdapter, registerCameraAdapters };
