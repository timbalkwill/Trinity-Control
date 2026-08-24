(() => {
  const root = document.getElementById("app");
  const roles = ["main", "left", "right"];
  const pending = new Set();
  let state = null;
  let connectionStatus = navigator.onLine ? "reconnecting" : "offline";
  let errorMessage = "";
  let openCameraSelectorId = null;

  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const currentIndex = () => Number(state?.live?.cueIndex) || 0;
  const connected = () => connectionStatus === "connected" && navigator.onLine;
  const cameras = () => roles.map(role => (state?.managedCameras || []).find(camera => camera.productionRole === role) || null);
  const cameraId = camera => camera?.cameraDeviceId || null;
  const cameraReady = camera => Boolean(cameraId(camera) && camera.enabled !== false && camera.configured);
  const switcherStatus = () => state?.videoSwitcherStatus || state?.atemStatus || {};
  const switcherConnected = () => switcherStatus().connectionState === "connected";
  const videoSourceForCamera = id => (state?.videoSources || []).find(source => source.sourceType === "camera" && source.cameraDeviceId === id);
  const disabled = (key, available = true) => !connected() || !available || pending.has(key);
  const disabledAttribute = (key, available) => disabled(key, available) ? " disabled" : "";
  const favoritesFirst = items => [...items].sort((left, right) =>
    Number(right.favorite === true) - Number(left.favorite === true) ||
    (Number(left.favoriteOrder) || 0) - (Number(right.favoriteOrder) || 0) ||
    String(left.name || "").localeCompare(String(right.name || ""))
  );

  function cameraColumn(camera, role) {
    const id = cameraId(camera);
    const name = camera?.displayName || `${role[0].toUpperCase()}${role.slice(1)} Camera`;
    const preparation = (state.live?.cameraPreparations || []).find(item => item.cameraId === id);
    const preparedMotion = state.live?.preparedMotions?.[id] || null;
    const ready = cameraReady(camera);
    const videoSource = videoSourceForCamera(id);
    const live = switcherConnected() && switcherStatus().liveSourceId === videoSource?.id;
    const takeReady = ready && switcherConnected() && videoSource?.switcherMappings?.[switcherStatus().backend || "atem"]?.input != null && (!live || preparedMotion);
    return `<section class="camera-column${live ? " live" : ""}" data-camera-id="${escapeHtml(id || "")}" data-camera-role="${role}">
      <header><button class="camera-selector-trigger" data-action="open-camera-selector" data-camera-id="${escapeHtml(id || "")}" aria-label="Open shots for ${escapeHtml(name)}"${disabledAttribute(`selector:${id}`, Boolean(id))}><span class="camera-role">${role}</span><strong>${escapeHtml(name)}</strong><i aria-hidden="true">›</i></button><span class="readiness ${ready ? "ready" : "not-ready"}">${escapeHtml(ready ? "Ready" : camera?.readiness || "Unavailable")}</span></header>
      <div class="live-badge">${live ? "LIVE" : "STANDBY"}</div>
      <div class="camera-summary">${preparedMotion ? `<div class="prepared-summary"><span>PREPARED MOTION</span><strong>${escapeHtml(preparedMotion.shotName || "Motion prepared")}</strong><b>${escapeHtml(preparedMotion.statusLabel || "READY FOR TAKE LIVE")}</b></div><button class="cancel-prep" data-action="cancel-prep" data-camera-id="${escapeHtml(id)}">CANCEL PREP</button>` : `<div class="camera-ready-summary"><span>SELECT A SHOT USING THE CAMERA NAME</span><strong>${ready ? "Configured / Ready" : escapeHtml(camera?.readiness || "Unavailable")}</strong></div>`}</div>
      <div class="last-commanded"><span>LAST COMMANDED</span><strong>${escapeHtml(preparation?.motionName || preparation?.presetName || "None")}</strong></div>
      <button class="take-live" data-action="take-source" data-source-id="${escapeHtml(videoSource?.id || "")}"${disabledAttribute(`take:${videoSource?.id}`, takeReady)}>${live && preparedMotion ? "RUN PREPARED MOVE" : live ? "ON AIR" : preparedMotion ? "TAKE LIVE + MOVE" : "TAKE LIVE"}</button>
    </section>`;
  }

  function cameraSelector() {
    if (!openCameraSelectorId) return "";
    const camera = (state.managedCameras || []).find(item => item.cameraDeviceId === openCameraSelectorId);
    if (!camera) { openCameraSelectorId = null; return ""; }
    const presets = favoritesFirst((state.cameraPresetSummaries || []).filter(item => item.enabled && item.cameraDeviceId === openCameraSelectorId));
    const motions = favoritesFirst((state.shotSummaries || []).filter(item => item.enabled && item.cameraDeviceId === openCameraSelectorId && (item.motionEnabled || item.shotType === "motion")));
    const itemName = item => `${item.favorite ? '<span aria-hidden="true">★</span>' : ""}<strong>${escapeHtml(item.name)}</strong>`;
    return `<div class="camera-selector-backdrop"><section class="camera-selector" role="dialog" aria-modal="true" aria-labelledby="camera-selector-title" data-selector-camera-id="${escapeHtml(openCameraSelectorId)}">
      <header><div><span>CAMERA SHOT SELECTOR</span><h2 id="camera-selector-title">${escapeHtml(camera.displayName || "Camera")}</h2></div><button data-action="close-camera-selector" aria-label="Cancel and close camera selector">CANCEL</button></header>
      ${errorMessage ? `<div class="selector-error" role="alert">${escapeHtml(errorMessage)}</div>` : ""}
      <div class="camera-selector-scroll"><section class="selector-section static-selector"><h3>STATIC</h3><div class="selector-buttons">${presets.map(preset => `<button data-action="preset" data-camera-id="${escapeHtml(openCameraSelectorId)}" data-preset-id="${escapeHtml(preset.id)}"${disabledAttribute(`preset:${openCameraSelectorId}:${preset.id}`, cameraReady(camera))}>${itemName(preset)}</button>`).join("") || '<span class="empty">No Static presets</span>'}</div></section>
      <section class="selector-section motion-selector"><h3>MOTION</h3><div class="selector-buttons">${motions.map(shot => `<button data-action="prepare-motion" data-camera-id="${escapeHtml(openCameraSelectorId)}" data-shot-id="${escapeHtml(shot.id)}"${disabledAttribute(`motion:${openCameraSelectorId}:${shot.id}`, cameraReady(camera))}>${itemName(shot)}<small>Prepare Start</small></button>`).join("") || '<span class="empty">No Motion Shots</span>'}</div></section></div>
    </section></div>`;
  }

  function render() {
    if (!state) return;
    const cues = state.runOfService || [];
    const cue = cues[currentIndex()];
    const presentation = (state.videoSources || []).find(source => source.sourceType === "video" && source.enabled !== false);
    const presentationLive = switcherConnected() && switcherStatus().liveSourceId === presentation?.id;
    const presentationReady = switcherConnected() && presentation?.switcherMappings?.[switcherStatus().backend || "atem"]?.input != null && !presentationLive;
    const readiness = state.productionReadiness;
    const readinessStrip = readiness ? `<details class="operator-readiness"><summary>${[["LIGHT", readiness.groups.lighting], ["VIDEO", readiness.groups.video], ["CAMERAS", readiness.groups.cameras], ["HOST", readiness.groups.host]].map(([label, value]) => `<span class="readiness-${escapeHtml(value)}"><i></i><b>${label}</b> ${value === "ready" ? "Ready" : value === "error" ? "Not Ready" : value === "optional" ? "Optional" : "Review"}</span>`).join("")}</summary>${readiness.issues.length ? `<div>${readiness.issues.map(issue => `<p><strong>${escapeHtml(issue.label)}</strong> — ${escapeHtml(issue.summary)}</p>`).join("")}</div>` : ""}</details>` : "";
    root.innerHTML = `<div class="operator-shell">
      <header class="topbar"><div class="brand"><img src="trinity-logo.png" alt=""><div><strong>Trinity Operator</strong><small>Live Service</small></div></div><div class="connection ${connectionStatus}"><i></i>${connectionStatus}</div></header>
      ${readinessStrip}
      ${errorMessage ? `<div class="error" role="alert">${escapeHtml(errorMessage)}</div>` : ""}
      <main class="workspace"><aside class="service-panel"><h1>ORDER OF SERVICE</h1><div class="cue-list">${cues.map((item, index) => `<button class="cue${index === currentIndex() ? " current" : ""}" data-action="cue" data-index="${index}"${disabledAttribute(`cue:${index}`, true)}><span>${index + 1}</span><div><strong>${escapeHtml(item.name || "Untitled cue")}</strong><small>${escapeHtml(item.notes || "")}</small></div></button>`).join("")}</div></aside><div class="source-workspace">${presentation ? `<section class="presentation-source ${presentationLive ? "live" : ""}"><div><span>VIDEO SOURCE</span><strong>${escapeHtml(presentation.name)}</strong></div><b>${presentationLive ? "LIVE" : "STANDBY"}</b><button data-action="take-source" data-source-id="${escapeHtml(presentation.id)}"${disabledAttribute(`take:${presentation.id}`, presentationReady)}>${presentationLive ? "ON AIR" : "TAKE LIVE"}</button></section>` : ""}<div class="camera-grid">${cameras().map((camera, index) => cameraColumn(camera, roles[index])).join("")}</div></div></main>
      <footer class="transport"><button data-action="back"${disabledAttribute("back", currentIndex() > 0)}>BACK</button><div><span>CURRENT</span><strong>${escapeHtml(cue?.name || "End of service")}</strong><small>${currentIndex() + 1} of ${cues.length}</small></div><button class="go" data-action="go"${disabledAttribute("go", currentIndex() < cues.length - 1)}>GO</button></footer>
    </div>${cameraSelector()}<div class="rotate-message"><img src="trinity-logo.png" alt=""><strong>Rotate iPad to landscape</strong><span>Trinity Operator is designed for landscape operation.</span></div>`;
    root.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => handleAction(button)));
  }

  async function command(key, route, body = {}) {
    if (!connected()) throw new Error("Trinity is offline. Commands are disabled and will not be queued.");
    if (pending.has(key)) return;
    const request = fetch(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    pending.add(key); errorMessage = ""; render();
    try {
      const response = await request;
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Command failed (${response.status})`);
      state = payload;
    } finally { pending.delete(key); render(); }
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    const id = button.dataset.cameraId;
    try {
      if (action === "open-camera-selector") { openCameraSelectorId = id; errorMessage = ""; render(); return; }
      if (action === "close-camera-selector") { openCameraSelectorId = null; errorMessage = ""; render(); return; }
      if (action === "preset") { await command(`preset:${id}:${button.dataset.presetId}`, "/api/live/recall-camera-preset", { cameraId: id, presetId: button.dataset.presetId }); openCameraSelectorId = null; render(); }
      if (action === "prepare-motion") {
        await command(`motion:${id}:${button.dataset.shotId}`, "/api/live/prepare-motion", { cameraId: id, shotId: button.dataset.shotId });
        openCameraSelectorId = null; render();
      }
      if (action === "cancel-prep") await command(`cancel-prep:${id}`, "/api/live/cancel-prepared-motion", { cameraId: id });
      if (action === "take-source") await command(`take:${button.dataset.sourceId}`, "/api/video-sources/take-live", { videoSourceId: button.dataset.sourceId });
      if (action === "cue") await command(`cue:${button.dataset.index}`, "/api/live/go", { index: Number(button.dataset.index), confirmJump: true });
      if (action === "back") await command("back", "/api/live/back");
      if (action === "go") await command("go", "/api/live/next");
    } catch (error) { errorMessage = error.message; render(); }
  }

  async function refreshAuthoritativeState() {
    if (!navigator.onLine) { connectionStatus = "offline"; render(); return; }
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) throw new Error(`State refresh failed (${response.status})`);
      state = await response.json();
    } catch (error) { connectionStatus = navigator.onLine ? "reconnecting" : "offline"; errorMessage = error.message; }
    render();
  }

  const events = new EventSource("/api/events");
  events.onopen = () => { connectionStatus = "connected"; errorMessage = ""; render(); };
  events.onerror = () => { connectionStatus = navigator.onLine ? "reconnecting" : "offline"; render(); };
  events.addEventListener("state", event => { state = JSON.parse(event.data); render(); });
  window.addEventListener("offline", () => { connectionStatus = "offline"; render(); });
  window.addEventListener("online", () => { connectionStatus = "reconnecting"; render(); refreshAuthoritativeState(); });
  window.addEventListener("pageshow", refreshAuthoritativeState);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshAuthoritativeState(); });
  refreshAuthoritativeState();
})();
