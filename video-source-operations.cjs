"use strict";

const SOURCE_TYPES = new Set(["camera", "video"]);
const text = value => typeof value === "string" && value.trim() ? value.trim() : null;
const inputNumber = value => value !== null && value !== undefined && value !== "" && Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

function normalizeVideoSource(input = {}) {
  const sourceType = SOURCE_TYPES.has(input.sourceType) ? input.sourceType : "video";
  const mappings = input.switcherMappings && typeof input.switcherMappings === "object"
    ? JSON.parse(JSON.stringify(input.switcherMappings)) : {};
  if (mappings.atem) mappings.atem = { ...mappings.atem, input: inputNumber(mappings.atem.input) };
  return {
    ...input,
    id: text(input.id),
    name: text(input.name) || "Video Source",
    sourceType,
    cameraDeviceId: sourceType === "camera" ? text(input.cameraDeviceId) : null,
    enabled: input.enabled !== false,
    switcherMappings: mappings,
    needsReview: input.needsReview === true
  };
}

function legacyAtemMappings(state) {
  const device = (state?.devices || []).find(item => item?.type === "switcher" &&
    (item.adapterType === "atem" || item.metadata?.adapter === "atem" || item.id === "device-atem"));
  return device?.metadata?.atemCameraInputs && typeof device.metadata.atemCameraInputs === "object"
    ? device.metadata.atemCameraInputs : {};
}

function defaultCameraSources(state, mappings) {
  const definitions = [
    ["source-main-camera", "Main", "main", 1],
    ["source-left-camera", "Left", "left", 2],
    ["source-right-camera", "Right", "right", 3]
  ];
  const cameras = (state?.devices || []).filter(item => item?.type === "camera");
  return definitions.map(([id, name, role, fallbackInput]) => {
    const camera = cameras.find(item => item.id === role) || cameras.find(item => item.logicalRole === role || (role === "main" && item.logicalRole === "center"));
    const cameraDeviceId = camera?.id || role;
    const input = inputNumber(mappings[cameraDeviceId]) ?? fallbackInput;
    return normalizeVideoSource({ id, name, sourceType: "camera", cameraDeviceId, enabled: true, switcherMappings: { atem: { input } } });
  });
}

function migrateVideoSources(state) {
  if (Array.isArray(state.videoSources) && state.videoSources.length) {
    state.videoSources = state.videoSources.filter(item => item && typeof item === "object").map(normalizeVideoSource);
  } else {
    const mappings = legacyAtemMappings(state);
    const cameraSources = defaultCameraSources(state, mappings);
    const occupiedByCamera = new Set(cameraSources.map(source => source.switcherMappings.atem?.input).filter(value => value !== null));
    const presentationConflict = occupiedByCamera.has(4);
    state.videoSources = [...cameraSources, normalizeVideoSource({
      id: "source-presentation", name: "Presentation", sourceType: "video", enabled: true,
      switcherMappings: { atem: { input: presentationConflict ? null : 4 } }, needsReview: presentationConflict
    })];
  }
  const configuredTransition = String(state.settings?.videoSwitching?.defaultTransition || "").toLocaleLowerCase();
  state.settings = {
    ...(state.settings || {}),
    activeSwitcherBackend: text(state.settings?.activeSwitcherBackend) || "atem",
    videoSwitching: {
      ...(state.settings?.videoSwitching || {}),
      defaultTransition: configuredTransition === "cut" ? "cut" : "mix"
    }
  };
  return state.videoSources;
}

function updateVideoSource(state, sourceId, patch = {}) {
  const index = (state.videoSources || []).findIndex(source => source.id === sourceId);
  if (index < 0) throw new RangeError(`Unknown Video Source: ${sourceId}`);
  state.videoSources[index] = normalizeVideoSource({ ...state.videoSources[index], ...patch, id: sourceId });
  return state.videoSources[index];
}

function updateVideoSwitchingSettings(state, patch = {}) {
  state.settings = state.settings && typeof state.settings === "object" ? state.settings : {};
  const requested = String(patch.defaultTransition || "").toLocaleLowerCase();
  if (!new Set(["mix", "cut"]).has(requested)) throw new TypeError("Default transition must be Mix or Cut");
  state.settings.videoSwitching = { ...(state.settings.videoSwitching || {}), defaultTransition: requested };
  return state.settings.videoSwitching;
}

module.exports = { migrateVideoSources, normalizeVideoSource, updateVideoSource, updateVideoSwitchingSettings };
