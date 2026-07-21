const { DEVICE_STATES, DEVICE_TYPES } = require("../../core/device-manager.cjs");

class SimulationCameraController {
  constructor({ cameras = [] } = {}) {
    this.kind = "camera";
    this.mode = "simulation";
    this.deviceId = "simulation-camera-controller";
    this.deviceManager = null;
    this.cameras = cameras;
    this.deviceIds = new Map();
  }

  register(deviceManager) {
    this.deviceManager = deviceManager;
    const cameras = this.cameras.length ? this.cameras : [{ id: "*", name: "Simulation Camera Controller" }];
    return cameras.map(camera => {
      const deviceId = camera.id === "*" ? this.deviceId : `camera-${camera.id}`;
      this.deviceIds.set(camera.id, deviceId);
      return deviceManager.registerDevice({
      id: deviceId,
      name: camera.name,
      type: DEVICE_TYPES.CAMERA,
      connectionState: camera.enabled === false ? DEVICE_STATES.DISCONNECTED : DEVICE_STATES.SIMULATION,
      lastSeen: Date.now(),
      statusMessage: camera.enabled === false ? "Camera disabled" : "Simulated camera control ready",
      manufacturer: "Trinity Control",
      model: "Camera Simulation",
      version: "1.0",
      supportsReconnect: false,
      supportsConfiguration: false,
      supportsHealthMonitoring: true,
      supportedCapabilities: ["camera", "camera.recallPreset"],
      health: { lastSuccessfulCommunication: Date.now(), reconnectAttempts: 0 }
    }, this, { resourceIds: camera.id === "*" ? [] : [camera.id] });
    });
  }

  async recallPreset({ cameraId, preset }) {
    const camera = this.cameras.find(item => item.id === cameraId);
    if (camera?.enabled === false) throw new Error(`Camera is disabled: ${cameraId}`);
    const deviceId = this.deviceIds.get(cameraId) || this.deviceIds.get("*") || this.deviceId;
    this.deviceManager?.reportHealth(deviceId, {
      success: true,
      statusMessage: `Simulated preset recall: ${cameraId} · ${preset}`
    });
    return { cameraId, preset, simulated: true };
  }
}

module.exports = { SimulationCameraController };
