"use strict";

const clone = value => JSON.parse(JSON.stringify(value));
const nullable = value => typeof value === "string" && value.trim() ? value.trim() : null;
const uniqueId = () => `lighting-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function normalizeExternalControl(input) {
  const widgetId = nullable(input?.widgetId);
  if (!widgetId) return null;
  return {
    adapterType: nullable(input?.adapterType) || "qlcplus-websocket",
    widgetId,
    widgetName: nullable(input?.widgetName),
    widgetType: nullable(input?.widgetType)
  };
}

function normalizeLightingScene(input = {}) {
  return { ...input, externalControl: normalizeExternalControl(input.externalControl) };
}

function migrateLightingScenes(scenes) {
  return Array.isArray(scenes) ? scenes.filter(item => item && typeof item === "object").map(normalizeLightingScene) : [];
}

function updateLightingScene(state, sceneId, patch = {}) {
  const index = (state?.lightingScenes || []).findIndex(item => item?.id === sceneId);
  if (index < 0) throw new RangeError(`Unknown lighting scene: ${sceneId}`);
  state.lightingScenes[index] = normalizeLightingScene({ ...state.lightingScenes[index], ...clone(patch), id: sceneId });
  return state.lightingScenes[index];
}

function duplicateLightingScene(state, sceneId, { id = uniqueId() } = {}) {
  const source = (state?.lightingScenes || []).find(item => item?.id === sceneId);
  if (!source) throw new RangeError(`Unknown lighting scene: ${sceneId}`);
  const duplicate = normalizeLightingScene({ ...clone(source), id, name: `${source.name || "Lighting Scene"} Copy`, externalControl: null });
  state.lightingScenes.push(duplicate);
  return duplicate;
}

function normalizedName(value) {
  return String(value || "")
    .replace(/^\s*trinity\s*[-–—:]\s*/i, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function suggestLightingControl(scene, widgets) {
  if (normalizeExternalControl(scene?.externalControl)) return null;
  const name = normalizedName(scene?.name);
  if (!name) return null;
  const matches = (widgets || []).filter(widget =>
    String(widget?.widgetType || "").toLocaleLowerCase() === "button" &&
    normalizedName(widget.name) === name
  );
  return matches.length === 1 ? matches[0] : null;
}

function filterLightingControls(widgets, { showAll = false, productionPage = null } = {}) {
  if (showAll) return Array.isArray(widgets) ? [...widgets] : [];
  return (widgets || []).filter(widget =>
    String(widget?.widgetType || "").toLocaleLowerCase() === "button" &&
    (!productionPage || widget.pageName === productionPage)
  );
}

function lightingDiscoveryView(widgets, { showAll = false, productionPage = null, elapsedMs = 0 } = {}) {
  const allWidgets = Array.isArray(widgets) ? widgets : [];
  const compatibleButtons = allWidgets.filter(widget =>
    String(widget?.widgetType || "").toLocaleLowerCase() === "button" &&
    widget?.canActivateScene === true
  );
  const pageWidgets = productionPage
    ? allWidgets.filter(widget => widget?.pageName === productionPage)
    : allWidgets;
  const pageButtons = compatibleButtons.filter(widget =>
    !productionPage || widget?.pageName === productionPage
  );
  return {
    visibleWidgets: showAll ? [...allWidgets] : [...pageButtons],
    compatibleButtonCount: compatibleButtons.length,
    pageButtonCount: pageButtons.length,
    pageWidgetCount: pageWidgets.length,
    totalWidgetCount: allWidgets.length,
    elapsedMs,
    productionPage,
    showAll
  };
}

function lightingMappingView(scene, device, { showAll = false } = {}) {
  const mapping = normalizeExternalControl(scene?.externalControl);
  const widgets = Array.isArray(device?.metadata?.qlcplusWidgets) ? device.metadata.qlcplusWidgets : [];
  const productionPage = device?.metadata?.qlcplusProductionPage || null;
  const compatible = filterLightingControls(widgets, { productionPage });
  const discovered = mapping ? widgets.find(widget => String(widget.widgetId) === mapping.widgetId) : null;
  let status = "not-mapped";
  if (!device || device.adapterType !== "qlcplus-websocket") status = "adapter-not-configured";
  else if (device.metadata?.lightingDiagnostic?.ok !== true) status = "qlc-unreachable";
  else if (mapping && !discovered) status = "mapped-control-missing";
  else if (mapping && String(discovered.widgetType || "").toLocaleLowerCase() !== "button") status = "mapped-control-not-button";
  else if (mapping) status = "mapped-valid";
  return {
    mapping, status, totalCount: widgets.length, compatibleCount: compatible.length,
    controls: filterLightingControls(widgets, { showAll, productionPage }), discovered,
    suggestion: suggestLightingControl(scene, compatible)
  };
}

module.exports = {
  duplicateLightingScene,
  filterLightingControls,
  lightingDiscoveryView,
  lightingMappingView,
  migrateLightingScenes,
  normalizeExternalControl,
  normalizeLightingScene,
  normalizedName,
  suggestLightingControl,
  updateLightingScene
};
