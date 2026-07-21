const { DEVICE_STATES, DEVICE_TYPES } = require("../../core/device-manager.cjs");

class SimulationSwitcherController {
  constructor() {
    this.kind = "videoSwitcher";
    this.mode = "simulation";
    this.deviceId = "simulation-video-switcher";
    this.deviceManager = null;
  }

  register(deviceManager) {
    this.deviceManager = deviceManager;
    return deviceManager.registerDevice({
      id: this.deviceId,
      name: "Simulation Video Switcher",
      type: DEVICE_TYPES.VIDEO_SWITCHER,
      connectionState: DEVICE_STATES.SIMULATION,
      lastSeen: Date.now(),
      statusMessage: "Simulated switching ready",
      manufacturer: "Trinity Control",
      model: "Switcher Simulation",
      version: "1.0",
      supportsReconnect: false,
      supportsConfiguration: false,
      supportsHealthMonitoring: true,
      supportedCapabilities: ["videoSwitcher", "videoSwitcher.take"],
      health: { lastSuccessfulCommunication: Date.now(), reconnectAttempts: 0 }
    }, this);
  }

  async take({ cameraId, mode = "cut" }) {
    this.deviceManager?.reportHealth(this.deviceId, {
      success: true,
      statusMessage: `Simulated ${mode}: ${cameraId}`
    });
    return { cameraId, mode, simulated: true };
  }
}

module.exports = { SimulationSwitcherController };
