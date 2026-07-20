class SimulationLightingController {
  constructor() {
    this.kind = "lighting";
    this.mode = "simulation";
  }

  async applyScene({ sceneId }) {
    return { sceneId, simulated: true };
  }

  async releaseOverride({ sceneId }) {
    return { sceneId, simulated: true };
  }
}

module.exports = { SimulationLightingController };
