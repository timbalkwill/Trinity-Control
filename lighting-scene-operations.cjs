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
  return {
    ...input,
    productionScene: input.productionScene !== false,
    available: input.available !== false,
    externalControl: normalizeExternalControl(input.externalControl)
  };
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

function filterLightingScenes(scenes, filter = "production") {
  const items = Array.isArray(scenes) ? scenes : [];
  if (filter === "all") return [...items];
  if (filter === "utility") return items.filter(item => item?.productionScene === false);
  return items.filter(item => item?.productionScene !== false);
}

function lightingSceneCounts(scenes) {
  const items = Array.isArray(scenes) ? scenes : [];
  const production = items.filter(item => item?.productionScene !== false).length;
  return { production, utility: items.length - production, total: items.length };
}

function utilitySceneReferenceWarning(state, lightingSceneId) {
  const scene = (state?.lightingScenes || []).find(item => item?.id === lightingSceneId);
  if (!scene || scene.productionScene !== false) return null;
  const lookCount = (state?.productionLooks || []).filter(item => item?.lightingSceneId === lightingSceneId).length;
  const cueCount = (state?.runOfService || []).filter(item => item?.lightingSceneId === lightingSceneId).length;
  return lookCount || cueCount ? "Scene is marked Utility but is still referenced." : null;
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

function lightingValidation(state, lightingSceneId, message, severity = "error", details = {}) {
  return {
    lightingSceneId: lightingSceneId || null,
    state,
    severity,
    message,
    ...details
  };
}

function resolveLightingExecution(state, lightingSceneId, { resolvedAt = Date.now() } = {}) {
  const scene = (state?.lightingScenes || []).find(item => item?.id === lightingSceneId);
  if (!scene) {
    return {
      execution: null,
      validation: lightingValidation("lighting-scene-missing", lightingSceneId, `Lighting Scene is missing: ${lightingSceneId || "unassigned"}`)
    };
  }
  if (scene.enabled === false) {
    return {
      execution: null,
      validation: lightingValidation("lighting-scene-disabled", scene.id, `Lighting Scene is disabled: ${scene.name || scene.id}`)
    };
  }
  if (scene.available === false || scene.qlcMirror?.available === false) {
    return {
      execution: null,
      validation: lightingValidation("qlc-function-missing", scene.id, `QLC+ lighting function is missing: ${scene.qlcMirror?.name || scene.name || scene.id}`, "error", {
        widgetId: scene.qlcMirror?.widgetId || scene.externalControl?.widgetId || null
      })
    };
  }

  const rawMapping = scene.externalControl;
  if (!rawMapping || typeof rawMapping !== "object") {
    return {
      execution: null,
      validation: lightingValidation("mapping-missing", scene.id, `Lighting Scene has no QLC+ mapping: ${scene.name || scene.id}`)
    };
  }
  const widgetId = nullable(rawMapping.widgetId);
  if (!widgetId) {
    return {
      execution: null,
      validation: lightingValidation("widget-missing", scene.id, `Lighting Scene mapping has no widget ID: ${scene.name || scene.id}`)
    };
  }

  const adapterType = nullable(rawMapping.adapterType);
  const lightingDevices = (state?.devices || []).filter(item => item?.type === "lighting");
  const device = lightingDevices.find(item => item?.adapterType === adapterType) || lightingDevices[0];
  if (!device || !device.adapterType) {
    return {
      execution: null,
      validation: lightingValidation("adapter-not-configured", scene.id, `Lighting adapter is not configured for: ${scene.name || scene.id}`, "error", { widgetId })
    };
  }
  if (device.enabled === false) {
    return {
      execution: null,
      validation: lightingValidation("adapter-disabled", scene.id, `Lighting adapter is disabled: ${device.name || device.id}`, "error", { widgetId })
    };
  }
  if (adapterType !== "qlcplus-websocket" || device.adapterType !== "qlcplus-websocket") {
    return {
      execution: null,
      validation: lightingValidation("unknown-adapter", scene.id, `Unknown lighting adapter: ${adapterType || device.adapterType}`, "error", { widgetId })
    };
  }

  const widgets = Array.isArray(device.metadata?.qlcplusWidgets) ? device.metadata.qlcplusWidgets : [];
  const widget = widgets.find(item => String(item?.widgetId) === widgetId);
  if (!widget) {
    return {
      execution: null,
      validation: lightingValidation("widget-not-discovered", scene.id, `Mapped QLC+ widget is not currently discovered: ${widgetId}`, "error", { widgetId })
    };
  }
  if (String(widget.widgetType || "").toLocaleLowerCase() !== "button" || widget.canActivateScene !== true) {
    return {
      execution: null,
      validation: lightingValidation("widget-not-button", scene.id, `Mapped QLC+ widget is not a scene-capable button: ${widgetId}`, "error", { widgetId })
    };
  }

  const execution = Object.freeze({
    lightingSceneId: scene.id,
    adapterType,
    widgetId,
    widgetName: widget.name || rawMapping.widgetName || null,
    pageName: widget.pageName || null,
    executionType: "qlc-button",
    resolvedAt: Number(resolvedAt) || 0
  });
  const productionPage = device.metadata?.qlcplusProductionPage || null;
  const validation = productionPage && widget.pageName !== productionPage
    ? lightingValidation("page-mismatch", scene.id, `Mapped QLC+ widget is outside Production Page ${productionPage}`, "warning", {
      widgetId,
      pageName: widget.pageName || null,
      productionPage
    })
    : lightingValidation("valid", scene.id, `Lighting Scene resolved: ${scene.name || scene.id}`, "info", { widgetId });
  return { execution, validation };
}

module.exports = {
  duplicateLightingScene,
  filterLightingControls,
  filterLightingScenes,
  lightingDiscoveryView,
  lightingMappingView,
  lightingSceneCounts,
  migrateLightingScenes,
  normalizeExternalControl,
  normalizeLightingScene,
  normalizedName,
  resolveLightingExecution,
  suggestLightingControl,
  updateLightingScene,
  utilitySceneReferenceWarning
};
