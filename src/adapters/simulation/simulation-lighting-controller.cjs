const { DEVICE_STATES, DEVICE_TYPES } = require("../../core/device-manager.cjs");

class SimulationLightingController {
  constructor() {
    this.kind = "lighting";
    this.mode = "simulation";
    this.deviceId = "simulation-lighting-controller";
    this.deviceManager = null;
  }

  register(deviceManager) {
    this.deviceManager = deviceManager;
    return deviceManager.registerDevice({
      id: this.deviceId,
      name: "Simulation Lighting Controller",
      type: DEVICE_TYPES.LIGHTING,
      connectionState: DEVICE_STATES.SIMULATION,
      lastSeen: Date.now(),
      statusMessage: "Simulated lighting control ready",
      manufacturer: "Trinity Control",
      model: "Lighting Simulation",
      version: "1.0",
      supportsReconnect: false,
      supportsConfiguration: false,
      supportsHealthMonitoring: true,
      supportedCapabilities: ["lighting", "lighting.applyScene", "lighting.releaseOverride"],
      health: { lastSuccessfulCommunication: Date.now(), reconnectAttempts: 0 }
    }, this);
  }

  async applyScene({ sceneId }) {
    this.deviceManager?.reportHealth(this.deviceId, {
      success: true,
      statusMessage: `Simulated scene applied: ${sceneId}`
    });
    return { sceneId, simulated: true };
  }

  async releaseOverride({ sceneId }) {
    this.deviceManager?.reportHealth(this.deviceId, {
      success: true,
      statusMessage: `Simulated lighting returned: ${sceneId || "cue"}`
    });
    return { sceneId, simulated: true };
  }
}

module.exports = { SimulationLightingController };
