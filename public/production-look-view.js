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
    const snapshot = state?.live?.executionSnapshot;
    if (snapshot?.cueId && snapshot.cueId === cue?.id) {
      const presets = (snapshot.cameras || []).filter(item => item.presetId).map(item => `${item.role}: ${item.presetName || `Missing: ${item.presetId}`}`).join(", ");
      return {
        name: snapshot.productionLookName || (snapshot.productionLookId ? "Missing reference" : "Not assigned"),
        lighting: snapshot.lighting?.sceneName || (snapshot.lighting?.sceneId ? "Missing reference" : "Not assigned"),
        lightingFadeMs: snapshot.lighting?.fadeMs || 0,
        stageWashMode: snapshot.lighting?.stageWashMode || "Not assigned",
        wallWashMode: snapshot.lighting?.wallWashMode || "Not assigned",
        programCamera: snapshot.video?.programCameraName || (snapshot.video?.programCameraId ? "Missing reference" : "Not assigned"),
        previewCamera: snapshot.video?.previewCameraName || (snapshot.video?.previewCameraId ? "Missing reference" : "Not assigned"),
        cameraLayout: snapshot.video?.cameraLayoutName || "Not assigned",
        presets: presets || [snapshot.video?.programPreset, snapshot.video?.previewPreset].filter(Boolean).join(" / ") || "No presets",
        motion: snapshot.motion?.enabled ? `On · ${snapshot.motion.speed || 1}x` : "Off",
        enabled: true,
        lightingSource: snapshot.lighting?.source || "Not assigned",
        cameraSource: snapshot.video?.source || "Not assigned",
        warnings: snapshot.warnings || [],
        executed: true
      };
    }
    const resources = resolve(state, cue);
    const look = resources.look;
    const presetLibrary = state?.cameraPresets || state?.cameraPresetSummaries || [];
    const presets = Array.isArray(look?.cameraAssignments) ? look.cameraAssignments.filter(item => item?.presetId).map(item => `${item.role}: ${byId(presetLibrary, item.presetId)?.name || `Missing: ${item.presetId}`}`).join(", ") : "";
    return { name: look?.name || (cue?.productionLookId ? "Missing reference" : "Not assigned"), lighting: resources.lighting?.name || ((cue?.lightingSceneId || look?.lightingSceneId) ? "Missing reference" : "Not assigned"), lightingFadeMs: look?.lightingFadeMs || 0, stageWashMode: look?.stageWashMode || "Not assigned", wallWashMode: look?.wallWashMode || "Not assigned", programCamera: resources.programCamera?.name || ((look?.programCameraId || resources.layout?.programCamera) ? "Missing reference" : "Not assigned"), previewCamera: resources.previewCamera?.name || ((look?.previewCameraId || resources.layout?.previewCamera) ? "Missing reference" : "Not assigned"), cameraLayout: resources.layout?.name || "Not assigned", presets: presets || "No presets", motion: look?.motionEnabled ? `On · ${look.motionSpeed || 1}x` : "Off", enabled: look?.enabled !== false, lightingSource: resources.lightingSource, cameraSource: resources.cameraSource, warnings: [], executed: false };
  }
  function card(state, cue, { compact = false } = {}) {
    const summary = summarize(state, cue);
    return `<div class="look-summary ${compact ? "compact" : ""}"><strong>${escapeHtml(summary.name)}</strong><span>💡 ${escapeHtml(summary.lighting)} <small>${escapeHtml(summary.lightingSource)}</small></span><span>🎥 ${escapeHtml(summary.programCamera)} / ${escapeHtml(summary.previewCamera)} <small>${escapeHtml(summary.cameraSource)}</small></span><span>📍 ${escapeHtml(summary.presets)}</span><span>Motion ${escapeHtml(summary.motion)}</span>${summary.warnings?.length ? `<span>⚠ ${escapeHtml(summary.warnings.join("; "))}</span>` : ""}<em class="${summary.enabled ? "enabled" : "disabled"}">${summary.enabled ? "Enabled" : "Disabled"}</em></div>`;
  }
  globalThis.TrinityLookView = { card, resolve, summarize };
})();
