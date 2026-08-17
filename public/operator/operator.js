(() => {
  const root = document.getElementById("app");
  const roles = ["main", "left", "right"];
  const pending = new Set();
  let state = null;
  let connectionStatus = navigator.onLine ? "reconnecting" : "offline";
  let errorMessage = "";

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

  function cameraColumn(camera, role) {
    const id = cameraId(camera);
    const name = camera?.displayName || `${role[0].toUpperCase()}${role.slice(1)} Camera`;
    const presets = (state.cameraPresetSummaries || []).filter(preset => preset.enabled && preset.cameraDeviceId === id);
    const motions = (state.shotSummaries || []).filter(shot => shot.enabled && shot.cameraDeviceId === id && (shot.motionEnabled || shot.shotType === "motion"));
    const orderedFavorites = items => items.filter(item => item.favorite === true).sort((left, right) => left.favoriteOrder - right.favoriteOrder);
    const favoritePresets = orderedFavorites(presets);
    const favoriteMotions = orderedFavorites(motions);
    const preparation = (state.live?.cameraPreparations || []).find(item => item.cameraId === id);
    const preparedMotion = state.live?.preparedMotions?.[id] || null;
    const ready = cameraReady(camera);
    const videoSource = videoSourceForCamera(id);
    const live = switcherConnected() && switcherStatus().liveSourceId === videoSource?.id;
    const takeReady = ready && switcherConnected() && videoSource?.switcherMappings?.[switcherStatus().backend || "atem"]?.input != null && (!live || preparedMotion);
    return `<section class="camera-column${live ? " live" : ""}" data-camera-id="${escapeHtml(id || "")}" data-camera-role="${role}">
      <header><div><span class="camera-role">${role}</span><h2>${escapeHtml(name)}</h2></div><span class="readiness ${ready ? "ready" : "not-ready"}">${escapeHtml(ready ? "Ready" : camera?.readiness || "Unavailable")}</span></header>
      <div class="live-badge">${live ? "LIVE" : "STANDBY"}</div>
      <div class="camera-content-scroll">${favoritePresets.length ? `<div class="control-group favorite-group favorite-static"><h3>FAVORITE STATIC</h3><div class="button-stack">${favoritePresets.map(preset => {
        const key = `preset:${id}:${preset.id}`;
        return `<button data-action="preset" data-camera-id="${escapeHtml(id)}" data-preset-id="${escapeHtml(preset.id)}"${disabledAttribute(key, ready)}>${escapeHtml(preset.name)}</button>`;
      }).join("")}</div></div>` : ""}${favoriteMotions.length ? `<div class="control-group favorite-group favorite-motion motion-group"><h3>FAVORITE MOTION</h3><div class="button-stack">${favoriteMotions.map(shot => {
        const key = `motion:${id}:${shot.id}`;
        const style = ({ presetTransition: "Preset Transition", pushIn: "Push In", pullOut: "Pull Out", panLeft: "Pan Left", panRight: "Pan Right", tiltUp: "Tilt Up", tiltDown: "Tilt Down", diagonalDrift: "Diagonal / Drift", reveal: "Reveal", custom: "Custom" })[shot.motionStyle] || "Preset Transition";
        const speed = ({ verySlow: "Very Slow", slow: "Slow", medium: "Medium", fast: "Fast" })[shot.motionSpeedSetting] || "Medium";
        const isPrepared = preparedMotion?.shotId === shot.id;
        return `<button class="${isPrepared ? "prepared" : ""}" data-action="prepare-motion" data-camera-id="${escapeHtml(id)}" data-shot-id="${escapeHtml(shot.id)}"${disabledAttribute(key, ready)}><strong>${isPrepared ? "✓ " : ""}${escapeHtml(shot.name)}</strong><small>${escapeHtml(style)} · ${escapeHtml(speed)} · ${isPrepared ? escapeHtml(preparedMotion.statusLabel) : "PREPARE"}</small></button>`;
      }).join("")}</div></div>` : ""}<details class="control-library all-static" ${favoritePresets.length ? "" : "open"}><summary>ALL STATIC <span>${presets.length}</span></summary><div class="button-stack">${presets.map(preset => {
        const key = `preset:${id}:${preset.id}`;
        return `<button data-action="preset" data-camera-id="${escapeHtml(id)}" data-preset-id="${escapeHtml(preset.id)}"${disabledAttribute(key, ready)}>${escapeHtml(preset.name)}</button>`;
      }).join("") || '<span class="empty">No presets</span>'}</div></details>
      <details class="control-library all-motion motion-group" ${favoriteMotions.length ? "" : "open"}><summary>ALL MOTION <span>${motions.length}</span></summary><div class="button-stack">${motions.map(shot => {
        const key = `motion:${id}:${shot.id}`;
        const style = ({ presetTransition: "Preset Transition", pushIn: "Push In", pullOut: "Pull Out", panLeft: "Pan Left", panRight: "Pan Right", tiltUp: "Tilt Up", tiltDown: "Tilt Down", diagonalDrift: "Diagonal / Drift", reveal: "Reveal", custom: "Custom" })[shot.motionStyle] || "Preset Transition";
        const speed = ({ verySlow: "Very Slow", slow: "Slow", medium: "Medium", fast: "Fast" })[shot.motionSpeedSetting] || "Medium";
        const isPrepared = preparedMotion?.shotId === shot.id;
        return `<button class="${isPrepared ? "prepared" : ""}" data-action="prepare-motion" data-camera-id="${escapeHtml(id)}" data-shot-id="${escapeHtml(shot.id)}"${disabledAttribute(key, ready)}><strong>${isPrepared ? "✓ " : ""}${escapeHtml(shot.name)}</strong><small>${escapeHtml(style)} · ${escapeHtml(speed)} · ${isPrepared ? escapeHtml(preparedMotion.statusLabel) : "PREPARE"}</small></button>`;
      }).join("") || '<span class="empty">No motion shots</span>'}</div></details>${preparedMotion ? `<button data-action="cancel-prep" data-camera-id="${escapeHtml(id)}">CANCEL PREP</button>` : ""}</div>
      <div class="last-commanded"><span>LAST COMMANDED</span><strong>${escapeHtml(preparation?.motionName || preparation?.presetName || "None")}</strong></div>
      <button class="take-live" data-action="take-source" data-source-id="${escapeHtml(videoSource?.id || "")}"${disabledAttribute(`take:${videoSource?.id}`, takeReady)}>${live && preparedMotion ? "RUN PREPARED MOVE" : live ? "ON AIR" : preparedMotion ? "TAKE LIVE + MOVE" : "TAKE LIVE"}</button>
    </section>`;
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
    </div><div class="rotate-message"><img src="trinity-logo.png" alt=""><strong>Rotate iPad to landscape</strong><span>Trinity Operator is designed for landscape operation.</span></div>`;
    root.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => handleAction(button)));
  }

  async function command(key, route, body = {}) {
    if (!connected()) throw new Error("Trinity is offline. Commands are disabled and will not be queued.");
    if (pending.has(key)) return;
    pending.add(key); errorMessage = ""; render();
    try {
      const response = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Command failed (${response.status})`);
      state = payload;
    } finally { pending.delete(key); render(); }
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    const id = button.dataset.cameraId;
    try {
      if (action === "preset") await command(`preset:${id}:${button.dataset.presetId}`, "/api/live/recall-camera-preset", { cameraId: id, presetId: button.dataset.presetId });
      if (action === "prepare-motion") {
        const existing = state.live?.preparedMotions?.[id];
        if (!existing || existing.shotId === button.dataset.shotId || window.confirm(`Replace prepared Motion ${existing.shotName}?`)) {
          await command(`motion:${id}:${button.dataset.shotId}`, "/api/live/prepare-motion", { cameraId: id, shotId: button.dataset.shotId });
        }
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
