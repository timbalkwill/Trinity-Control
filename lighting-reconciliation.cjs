"use strict";

const text = value => typeof value === "string" && value.trim() ? value.trim() : null;
const identity = value => text(String(value ?? ""));

function authoritativeControls(widgets) {
  return (Array.isArray(widgets) ? widgets : []).filter(widget =>
    identity(widget?.widgetId) &&
    String(widget?.widgetType || "").toLocaleLowerCase() === "button" &&
    widget?.canActivateScene === true
  );
}

function qlcSceneId(widgetId, usedIds = new Set()) {
  const safe = String(widgetId).replace(/[^a-zA-Z0-9_-]+/g, "-") || "control";
  const base = `qlc-widget-${safe}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function mirrorMetadata(widget, now) {
  return {
    identityType: "widget-id",
    widgetId: String(widget.widgetId),
    name: text(widget.name) || "Unnamed QLC+ button",
    type: text(widget.widgetType) || "Button",
    pageName: text(widget.pageName),
    available: true,
    lastDiscoveredAt: new Date(now).toISOString(),
    missingSince: null
  };
}

function sceneWidgetId(scene) {
  return identity(scene?.qlcMirror?.widgetId ?? scene?.externalControl?.widgetId);
}

function dependencyIndex(state, sceneId) {
  const looks = (state?.productionLooks || []).filter(item => item?.lightingSceneId === sceneId);
  const directCues = (state?.runOfService || []).filter(item => item?.lightingSceneId === sceneId);
  const inheritedCues = (state?.runOfService || []).filter(item => {
    if (item?.lightingSceneId) return false;
    return looks.some(look => look.id === item?.productionLookId);
  });
  const directTemplates = (state?.cueTemplates || []).filter(item => item?.lightingSceneId === sceneId);
  const inheritedTemplates = (state?.cueTemplates || []).filter(item => {
    if (item?.lightingSceneId) return false;
    return looks.some(look => look.id === item?.productionLookId);
  });
  return {
    sceneId,
    productionLooks: looks.map(item => ({ id: item.id, name: item.name || item.id })),
    serviceCues: [...directCues, ...inheritedCues].map(item => ({
      id: item.id, name: item.name || item.id, source: directCues.includes(item) ? "direct" : "production-look"
    })),
    cueTemplates: [...directTemplates, ...inheritedTemplates].map(item => ({
      id: item.id, name: item.name || item.id, source: directTemplates.includes(item) ? "direct" : "production-look"
    }))
  };
}

function dependencyCount(index) {
  return index.productionLooks.length + index.serviceCues.length + index.cueTemplates.length;
}

function missingLightingDependencies(state) {
  return (state?.lightingScenes || [])
    .filter(scene => scene?.available === false)
    .map(scene => ({
      sceneId: scene.id,
      widgetId: sceneWidgetId(scene),
      name: scene?.qlcMirror?.name || scene?.name || scene.id,
      dependencies: dependencyIndex(state, scene.id)
    }))
    .filter(item => dependencyCount(item.dependencies) > 0);
}

function semanticWidget(widget) {
  return {
    widgetId: String(widget.widgetId), name: text(widget.name) || "Unnamed QLC+ button",
    widgetType: text(widget.widgetType), status: text(widget.status),
    canActivateScene: widget.canActivateScene === true, pageIndex: widget.pageIndex ?? null,
    pageName: text(widget.pageName), parentWidgetId: identity(widget.parentWidgetId),
    parentName: text(widget.parentName), containerPath: Array.isArray(widget.containerPath) ? [...widget.containerPath] : []
  };
}

function semanticDiscoveryEqual(device, widgets, pages) {
  const priorWidgets = Array.isArray(device?.metadata?.qlcplusWidgets) ? device.metadata.qlcplusWidgets : [];
  const priorPages = Array.isArray(device?.metadata?.qlcplusPages) ? device.metadata.qlcplusPages : [];
  return JSON.stringify(priorWidgets.map(semanticWidget)) === JSON.stringify((widgets || []).map(semanticWidget)) &&
    JSON.stringify(priorPages) === JSON.stringify(pages || []);
}

function reconcileLightingScenes(state, widgets, { now = Date.now() } = {}) {
  const discovered = authoritativeControls(widgets);
  const scenes = Array.isArray(state.lightingScenes) ? state.lightingScenes : (state.lightingScenes = []);
  const usedIds = new Set(scenes.map(scene => scene?.id).filter(Boolean));
  const discoveredIds = new Set(discovered.map(widget => String(widget.widgetId)));
  const groups = new Map();
  for (const scene of scenes) {
    const widgetId = sceneWidgetId(scene);
    if (!widgetId) continue;
    if (!groups.has(widgetId)) groups.set(widgetId, []);
    groups.get(widgetId).push(scene);
  }
  const summary = { added: [], removed: [], renamed: [], changed: [], restored: [], ambiguous: [], needsReconciliation: [], unchanged: 0 };

  for (const scene of scenes) {
    if (sceneWidgetId(scene) || scene.reconciliationStatus === "needs-reconciliation") continue;
    scene.available = false;
    scene.reconciliationStatus = "needs-reconciliation";
    summary.needsReconciliation.push({ sceneId: scene.id, name: scene.name || scene.id, reason: "stable-qlc-identity-missing" });
  }

  for (const widget of discovered) {
    const widgetId = String(widget.widgetId);
    const matches = groups.get(widgetId) || [];
    if (matches.length > 1) {
      summary.ambiguous.push({ widgetId, sceneIds: matches.map(scene => scene.id) });
      for (const scene of matches) {
        scene.available = false;
        scene.reconciliationStatus = "needs-reconciliation";
      }
      continue;
    }
    if (!matches.length) {
      const metadata = mirrorMetadata(widget, now);
      const scene = {
        id: qlcSceneId(widgetId, usedIds), name: metadata.name, category: "QLC+",
        favorite: false, enabled: true, productionScene: true, available: true,
        authoritativeSource: "qlcplus", qlcMirror: metadata,
        externalControl: { adapterType: "qlcplus-websocket", widgetId, widgetName: metadata.name, widgetType: metadata.type }
      };
      usedIds.add(scene.id);
      scenes.push(scene);
      groups.set(widgetId, [scene]);
      summary.added.push({ sceneId: scene.id, widgetId, name: scene.name });
      continue;
    }
    const scene = matches[0];
    const oldName = scene.qlcMirror?.name || scene.externalControl?.widgetName || scene.name;
    const oldType = scene.qlcMirror?.type || scene.externalControl?.widgetType || null;
    const wasMissing = scene.available === false || scene.qlcMirror?.available === false;
    const metadataChanged = oldName !== (text(widget.name) || "Unnamed QLC+ button") ||
      oldType !== (text(widget.widgetType) || "Button") ||
      (scene.qlcMirror?.pageName || null) !== (text(widget.pageName) || null);
    if (!metadataChanged && !wasMissing && scene.authoritativeSource === "qlcplus") {
      summary.unchanged += 1;
      continue;
    }
    const metadata = mirrorMetadata(widget, now);
    scene.name = metadata.name;
    scene.available = true;
    delete scene.reconciliationStatus;
    scene.authoritativeSource = "qlcplus";
    scene.qlcMirror = metadata;
    scene.externalControl = { adapterType: "qlcplus-websocket", widgetId, widgetName: metadata.name, widgetType: metadata.type };
    if (wasMissing) summary.restored.push({ sceneId: scene.id, widgetId, name: metadata.name });
    else if (oldName !== metadata.name) summary.renamed.push({ sceneId: scene.id, widgetId, from: oldName, to: metadata.name });
    else summary.changed.push({ sceneId: scene.id, widgetId, name: metadata.name });
  }

  for (const scene of scenes) {
    const widgetId = sceneWidgetId(scene);
    if (!widgetId || discoveredIds.has(widgetId) || scene.available === false) continue;
    const missingSince = new Date(now).toISOString();
    scene.available = false;
    scene.authoritativeSource = "qlcplus";
    scene.qlcMirror = {
      identityType: "widget-id", widgetId,
      name: scene.qlcMirror?.name || scene.externalControl?.widgetName || scene.name || "Missing QLC+ button",
      type: scene.qlcMirror?.type || scene.externalControl?.widgetType || null,
      pageName: scene.qlcMirror?.pageName || null, available: false,
      lastDiscoveredAt: scene.qlcMirror?.lastDiscoveredAt || null, missingSince
    };
    summary.removed.push({
      sceneId: scene.id, widgetId, name: scene.qlcMirror.name,
      dependencies: dependencyIndex(state, scene.id)
    });
  }
  return { changed: Object.entries(summary).some(([key, value]) => key !== "unchanged" && Array.isArray(value) && value.length), summary };
}

function replaceLightingReferences(state, missingSceneId, replacementSceneId, selection = {}) {
  const missing = (state?.lightingScenes || []).find(scene => scene?.id === missingSceneId && scene.available === false);
  const replacement = (state?.lightingScenes || []).find(scene => scene?.id === replacementSceneId && scene.available !== false);
  if (!missing) throw new RangeError(`Missing Lighting Scene is unavailable: ${missingSceneId}`);
  if (!replacement) throw new RangeError(`Replacement Lighting Scene is unavailable: ${replacementSceneId}`);
  const all = selection.all === true;
  const selected = key => new Set(Array.isArray(selection[key]) ? selection[key] : []);
  const lookIds = selected("productionLookIds");
  const cueIds = selected("serviceCueIds");
  const templateIds = selected("cueTemplateIds");
  let updated = 0;
  for (const look of state.productionLooks || []) if (look.lightingSceneId === missingSceneId && (all || lookIds.has(look.id))) {
    look.lightingSceneId = replacementSceneId; updated += 1;
  }
  for (const cue of state.runOfService || []) if (cue.lightingSceneId === missingSceneId && (all || cueIds.has(cue.id))) {
    cue.lightingSceneId = replacementSceneId; updated += 1;
  }
  for (const template of state.cueTemplates || []) if (template.lightingSceneId === missingSceneId && (all || templateIds.has(template.id))) {
    template.lightingSceneId = replacementSceneId; updated += 1;
  }
  return { updated, missingSceneId, replacementSceneId };
}

module.exports = {
  authoritativeControls,
  dependencyCount,
  dependencyIndex,
  missingLightingDependencies,
  reconcileLightingScenes,
  replaceLightingReferences,
  sceneWidgetId,
  semanticDiscoveryEqual
};
