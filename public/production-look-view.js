(() => {
  const byId = (items, id) => id && Array.isArray(items) ? items.find(item => item?.id === id) : undefined;
  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  function resolve(state, cue) {
    const look = byId(state?.productionLooks, cue?.productionLookId);
    const layout = byId(state?.cameraLayouts, cue?.cameraLayoutId || look?.cameraLayoutId);
    const deviceCameras = state?.devices || state?.deviceSummaries || [];
    const camera = id => byId(deviceCameras, id) || byId(state?.cameras, id);
    return {
      look,
      layout,
      lighting: byId(state?.lightingScenes, cue?.lightingSceneId || look?.lightingSceneId),
      programCamera: camera(look?.programCameraId || layout?.programCamera),
      previewCamera: camera(look?.previewCameraId || layout?.previewCamera),
      lightingSource: cue?.lightingSceneId ? "Cue Override" : look?.lightingSceneId ? "From Production Look" : "Not assigned",
      cameraSource: cue?.cameraLayoutId ? "Cue Override" : (look?.cameraLayoutId || look?.programCameraId || look?.previewCameraId) ? "From Production Look" : "Not assigned"
    };
  }
  function summarize(state, cue) {
    const resources = resolve(state, cue);
    const look = resources.look;
    const presetLibrary = state?.cameraPresets || state?.cameraPresetSummaries || [];
    const presets = Array.isArray(look?.cameraAssignments) ? look.cameraAssignments.filter(item => item?.presetId).map(item => `${item.role}: ${byId(presetLibrary, item.presetId)?.name || `Missing: ${item.presetId}`}`).join(", ") : "";
    return { name: look?.name || "Not assigned", lighting: resources.lighting?.name || "Not assigned", programCamera: resources.programCamera?.name || "Not assigned", previewCamera: resources.previewCamera?.name || "Not assigned", presets: presets || "No presets", motion: look?.motionEnabled ? `On · ${look.motionSpeed || 1}x` : "Off", enabled: look?.enabled !== false, lightingSource: resources.lightingSource, cameraSource: resources.cameraSource };
  }
  function card(state, cue, { compact = false } = {}) {
    const summary = summarize(state, cue);
    return `<div class="look-summary ${compact ? "compact" : ""}"><strong>${escapeHtml(summary.name)}</strong><span>💡 ${escapeHtml(summary.lighting)} <small>${escapeHtml(summary.lightingSource)}</small></span><span>🎥 ${escapeHtml(summary.programCamera)} / ${escapeHtml(summary.previewCamera)} <small>${escapeHtml(summary.cameraSource)}</small></span><span>📍 ${escapeHtml(summary.presets)}</span><span>Motion ${escapeHtml(summary.motion)}</span><em class="${summary.enabled ? "enabled" : "disabled"}">${summary.enabled ? "Enabled" : "Disabled"}</em></div>`;
  }
  globalThis.TrinityLookView = { card, resolve, summarize };
})();
