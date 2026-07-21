const { DEVICE_STATES, DEVICE_TYPES } = require("../../core/device-manager.cjs");

class SimulationCameraController {
  constructor() {
    this.kind = "camera";
    this.mode = "simulation";
    this.deviceId = "simulation-camera-controller";
    this.deviceManager = null;
  }

  register(deviceManager) {
    this.deviceManager = deviceManager;
    return deviceManager.registerDevice({
      id: this.deviceId,
      name: "Simulation Camera Controller",
      type: DEVICE_TYPES.CAMERA,
      connectionState: DEVICE_STATES.SIMULATION,
      lastSeen: Date.now(),
      statusMessage: "Simulated camera control ready",
      manufacturer: "Trinity Control",
      model: "Camera Simulation",
      version: "1.0",
      supportsReconnect: false,
      supportsConfiguration: false,
      supportsHealthMonitoring: true,
      supportedCapabilities: ["camera", "camera.recallPreset"],
      health: { lastSuccessfulCommunication: Date.now(), reconnectAttempts: 0 }
    }, this);
  }

  async recallPreset({ cameraId, preset }) {
    this.deviceManager?.reportHealth(this.deviceId, {
      success: true,
      statusMessage: `Simulated preset recall: ${cameraId} · ${preset}`
    });
    return { cameraId, preset, simulated: true };
  }
}

module.exports = { SimulationCameraController };
