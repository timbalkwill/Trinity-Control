class SimulationCameraController {
  constructor() {
    this.kind = "camera";
    this.mode = "simulation";
  }

  async recallPreset({ cameraId, preset }) {
    return { cameraId, preset, simulated: true };
  }
}

module.exports = { SimulationCameraController };
