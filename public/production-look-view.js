(() => {
  const byId = (items, id) => id && Array.isArray(items) ? items.find(item => item?.id === id) : undefined;
  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const roles = ["main", "left", "right"];

  function cameraItems(state) {
    const devices = (state?.devices || []).filter(item => item?.type === "camera");
    const known = new Set(devices.map(item => item.id));
    return [...devices, ...(state?.cameras || []).filter(item => item?.id && !known.has(item.id))];
  }

  function cameraRole(state, cameraId) {
    const snapshot = state?.live?.executionSnapshot;
    const programCameraId = state?.live?.programCamera ?? snapshot?.video?.programCameraId;
    const previewCameraId = state?.live?.previewCamera ?? snapshot?.video?.previewCameraId;
    const auxiliaryCameraIds = snapshot?.video?.auxiliaryCameraIds || state?.live?.auxiliaryCameras || [];
    if (programCameraId === cameraId) return "program";
    if (previewCameraId === cameraId) return "preview";
    if (auxiliaryCameraIds.includes(cameraId)) return "auxiliary";
    return "idle";
  }

  function roleDetails(state, look, role) {
    const assignment = look?.cameraPresets?.[role] || {};
    const cameraId = assignment.cameraId || assignment.cameraDeviceId || null;
    const camera = byId(cameraItems(state), cameraId);
    const preset = (state?.cameraPresets || []).find(item => item?.id === assignment.presetId && (!cameraId || item?.cameraDeviceId === cameraId));
    return {
      role,
      cameraId,
      camera,
      presetId: assignment.presetId || null,
      preset,
      ready: Boolean(camera && preset)
    };
  }

  function resolve(state, cue) {
    const look = byId(state?.productionLooks, cue?.productionLookId);
    const lighting = byId(state?.lightingScenes, cue?.lightingSceneId || look?.lightingSceneId);
    const roleAssignments = Object.fromEntries(roles.map(role => [role, roleDetails(state, look, role)]));
    const priorityCamera = byId(cameraItems(state), look?.priorityCameraId);
    return {
      look,
      lighting,
      roles: roleAssignments,
      priorityCamera,
      lightingSource: cue?.lightingSceneId ? "Cue Override" : look?.lightingSceneId ? "From Production Look" : "Not assigned",
      cameraSource: look ? "From Production Look" : "Not assigned"
    };
  }

  function summarizeSnapshot(snapshot) {
    const assignments = snapshot.cameraAssignments || snapshot.cameras || [];
    const lightingExecution = snapshot.lightingExecutions?.[0];
    const byRole = Object.fromEntries(roles.map(role => [role, assignments.find(item => item?.role === role)]));
    const cameraParts = roles.map(role => byRole[role]?.presetName).filter(Boolean);
    return {
      name: snapshot.productionLookName || (snapshot.productionLookId ? "Missing reference" : "Not assigned"),
      lighting: lightingExecution?.widgetName || snapshot.lighting?.sceneName || (snapshot.lighting?.sceneId ? "Missing reference" : "Not assigned"),
      priorityCamera: snapshot.video?.programCameraName || "Not assigned",
      programCamera: snapshot.video?.programCameraName || (snapshot.video?.programCameraId ? "Missing reference" : "Not assigned"),
      previewCamera: snapshot.video?.previewCameraName || (snapshot.video?.previewCameraId ? "Missing reference" : "Not assigned"),
      cameraLayout: snapshot.video?.cameraLayoutName || "Not assigned",
      presets: cameraParts.length ? cameraParts.join(" • ") : "No presets",
      shots: "No Shots",
      motion: snapshot.motion?.enabled ? `On · ${snapshot.motion.speed || 1}x` : "Off",
      tracking: snapshot.motion?.enabled ? "Starts On" : "Off",
      roleAssignments: byRole,
      cameraReady: roles.every(role => Boolean(byRole[role]?.cameraDeviceId && byRole[role]?.presetId)),
      cameraSummary: cameraParts.length ? cameraParts.join(" • ") : "Camera presets not assigned",
      enabled: true,
      lightingSource: snapshot.lighting?.source || "Not assigned",
      cameraSource: snapshot.video?.source || "Executed snapshot",
      warnings: snapshot.warnings || [],
      executed: true
    };
  }

  function summarize(state, cue) {
    const snapshot = state?.live?.executionSnapshot;
    if (snapshot?.cueId && snapshot.cueId === cue?.id) return summarizeSnapshot(snapshot);

    const resources = resolve(state, cue);
    const roleAssignments = resources.roles;
    const cameraParts = roles.map(role => roleAssignments[role].preset?.name).filter(Boolean);
    const warnings = [];
    if (!resources.look) warnings.push("Production Look required");
    for (const role of roles) {
      if (!roleAssignments[role].ready) warnings.push(`${role[0].toUpperCase() + role.slice(1)} camera preset incomplete`);
    }
    return {
      name: resources.look?.name || (cue?.productionLookId ? "Missing reference" : "Not assigned"),
      lighting: resources.lighting?.name || ((cue?.lightingSceneId || resources.look?.lightingSceneId) ? "Missing reference" : "Not assigned"),
      priorityCamera: resources.priorityCamera?.name || (resources.look?.priorityCameraId ? "Missing reference" : "Not assigned"),
      programCamera: roleAssignments.main.camera?.name || "Not assigned",
      previewCamera: roleAssignments.left.camera?.name || "Not assigned",
      cameraLayout: "Not assigned",
      presets: cameraParts.length ? cameraParts.join(" • ") : "No presets",
      shots: "No Shots",
      motion: resources.look?.startMainTracking ? "On · 1x" : "Off",
      tracking: resources.look?.startMainTracking ? "Starts On" : "Off",
      roleAssignments,
      cameraReady: Boolean(resources.look) && roles.every(role => roleAssignments[role].ready),
      cameraSummary: cameraParts.length ? cameraParts.join(" • ") : "Camera presets not assigned",
      enabled: resources.look?.enabled !== false,
      lightingSource: resources.lightingSource,
      cameraSource: resources.cameraSource,
      warnings,
      executed: false
    };
  }

  function card(state, cue, { compact = false } = {}) {
    const summary = summarize(state, cue);
    const cameraRows = roles.map(role => {
      const assignment = summary.roleAssignments?.[role] || {};
      const cameraName = assignment.camera?.name || assignment.cameraName || "Not configured";
      const presetName = assignment.preset?.name || assignment.presetName || "No preset";
      return `<span class="look-role"><small>${role.toUpperCase()}</small><strong>${escapeHtml(cameraName)}</strong><em>${escapeHtml(presetName)}</em></span>`;
    }).join("");
    return `<div class="look-summary simplified ${compact ? "compact" : ""}"><div class="look-summary-title"><strong>${escapeHtml(summary.name)}</strong><em class="${summary.enabled ? "enabled" : "disabled"}">${summary.enabled ? "Enabled" : "Disabled"}</em></div><div class="look-summary-facts"><span>💡 <strong>${escapeHtml(summary.lighting)}</strong><small>${escapeHtml(summary.lightingSource)}</small></span><span>🎯 <strong>${escapeHtml(summary.priorityCamera)}</strong><small>Priority camera</small></span><span>Tracking <strong>${escapeHtml(summary.tracking)}</strong></span></div><div class="look-role-grid">${cameraRows}</div>${summary.warnings?.length ? `<div class="look-summary-warnings">${summary.warnings.map(item => `<span>⚠ ${escapeHtml(item)}</span>`).join("")}</div>` : ""}</div>`;
  }

  globalThis.TrinityLookView = { cameraRole, card, resolve, summarize };
})();
