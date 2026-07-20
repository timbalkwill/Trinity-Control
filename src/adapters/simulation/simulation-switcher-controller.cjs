class SimulationSwitcherController {
  constructor() {
    this.kind = "videoSwitcher";
    this.mode = "simulation";
  }

  async take({ cameraId, mode = "cut" }) {
    return { cameraId, mode, simulated: true };
  }
}

module.exports = { SimulationSwitcherController };
