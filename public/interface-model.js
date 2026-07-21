(function exposeInterfaceModel(root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.TrinityInterface = model;
})(typeof window === 'undefined' ? globalThis : window, function createInterfaceModel() {
  const ALL_CAPABILITIES = Object.freeze({
    canViewLive: true,
    canViewService: true,
    canViewCameras: true,
    canOperateService: true,
    canRecallCamera: true,
    canControlLighting: true,
    canEditService: true,
    canEditLooks: true,
    canEditLighting: true,
    canConfigureCameras: true,
    canConfigureLighting: true,
    canConfigureSystem: true
  });

  const OPERATOR_CAPABILITIES = Object.freeze({
    canViewLive: true,
    canViewService: true,
    canViewCameras: true,
    canOperateService: false,
    canRecallCamera: false,
    canControlLighting: false,
    canEditService: false,
    canEditLooks: false,
    canEditLighting: false,
    canConfigureCameras: false,
    canConfigureLighting: false,
    canConfigureSystem: false
  });

  const NAVIGATION = Object.freeze([
    { id: 'live', label: 'LIVE', capability: 'canViewLive' },
    { id: 'service', label: 'SERVICE', capability: 'canViewService' },
    { id: 'looks', label: 'LOOKS', capability: 'canEditLooks' },
    { id: 'lighting', label: 'LIGHTING', capability: 'canEditLighting' },
    { id: 'cameras', label: 'CAMERAS', capability: 'canViewCameras' },
    { id: 'configuration', label: 'CONFIGURATION', capability: 'canConfigureSystem' }
  ]);

  function detectMode(transport) {
    return transport?.getInterfaceMode?.() === 'operator'
      ? 'operator'
      : 'production-console';
  }

  function capabilitiesForMode(mode) {
    return { ...(mode === 'operator' ? OPERATOR_CAPABILITIES : ALL_CAPABILITIES) };
  }

  function navigationFor(capabilities) {
    return NAVIGATION
      .filter(item => capabilities[item.capability])
      .map(({ id, label }) => [id, label]);
  }

  function deviceForCapability(devices, capability) {
    return (devices || []).find(device =>
      (device.supportedCapabilities || []).includes(capability)
    ) || null;
  }

  function liveViewModel(state, devices = []) {
    const cues = state?.runOfService || [];
    const index = Number(state?.live?.cueIndex) || 0;
    const current = cues[index] || null;
    const look = (state?.productionLooks || [])
      .find(item => item.id === current?.productionLookId) || null;
    const camera = (state?.cameras || [])
      .find(item => item.id === state?.live?.programCamera) || null;
    return {
      current,
      next: cues[index + 1] || null,
      look,
      camera,
      programPreset: state?.live?.programPreset || null,
      cameraConnectionState: deviceForCapability(devices, 'camera')?.connectionState || 'Unknown'
    };
  }

  function cameraViewModels(state, devices = []) {
    const cameraDevice = deviceForCapability(devices, 'camera');
    return (state?.cameras || []).map(camera => ({
      id: camera.id,
      name: camera.name,
      online: ['Connected', 'Degraded', 'Simulation'].includes(cameraDevice?.connectionState),
      connectionState: cameraDevice?.connectionState || 'Unknown',
      positions: Array.isArray(camera.savedPositions)
        ? camera.savedPositions
        : Array.isArray(camera.positions)
          ? camera.positions
          : []
    }));
  }

  function deviceRegistryViewModels(devices = []) {
    return devices.map(device => ({
      ...device,
      environment: device.connectionState === 'Simulation' ? 'SIMULATION' : 'REAL',
      capabilitiesLabel: device.supportedCapabilities?.length
        ? device.supportedCapabilities.join(' · ')
        : 'None reported'
    }));
  }

  return {
    ALL_CAPABILITIES,
    OPERATOR_CAPABILITIES,
    cameraViewModels,
    capabilitiesForMode,
    detectMode,
    deviceForCapability,
    deviceRegistryViewModels,
    liveViewModel,
    navigationFor
  };
});
