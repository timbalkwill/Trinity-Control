(() => {
  const root = document.getElementById("app");
  let state;
  let connectionStatus = "reconnecting";
  let errorMessage = "";

  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const byId = (items, id) => (items || []).find(item => item.id === id);
  const currentIndex = () => Number(state?.live?.cueIndex) || 0;
  const currentCue = () => state?.runOfService?.[currentIndex()];
  const lookFor = cue => byId(state?.productionLooks, cue?.productionLookId);
  const lightingFor = cue => byId(state?.lightingScenes, cue?.lightingSceneId || lookFor(cue)?.lightingSceneId);
  const cameraFor = cue => byId(state?.cameraLayouts, cue?.cameraLayoutId || lookFor(cue)?.cameraLayoutId);
  const activeLighting = () => byId(state?.lightingScenes, state?.live?.lightingOverrideId || state?.live?.lastLightingSceneId) || lightingFor(currentCue());
  const formatTime = seconds => { const value = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`; };
  const timing = () => {
    const now = Date.now();
    const index = currentIndex();
    const elapsedCue = Math.max(0, Math.floor((now - Number(state.live?.cueStartedAt || now)) / 1000));
    const elapsedService = Math.max(0, Math.floor((now - Number(state.live?.serviceStartedAt || state.live?.cueStartedAt || now)) / 1000));
    const remaining = Math.max(0, (Number(state.runOfService[index]?.duration) || 0) - elapsedCue) + state.runOfService.slice(index + 1).reduce((sum, cue) => sum + (Number(cue.duration) || 0), 0);
    return { elapsedCue, elapsedService, remaining };
  };
  const cueDetails = cue => {
    if (!cue) return '<div class="muted">End of service</div>';
    return `<h2>${escapeHtml(cue.name || "Untitled cue")}</h2><div class="meta"><span>${formatTime(cue.duration)}</span><span>${escapeHtml(lookFor(cue)?.name || "No Production Look")}</span><span>💡 ${escapeHtml(lightingFor(cue)?.name || "None")}</span><span>📷 ${escapeHtml(cameraFor(cue)?.name || "None")}</span></div><p class="muted">${escapeHtml(cue.notes || "No notes")}</p>`;
  };

  async function command(route, body = {}) {
    errorMessage = "";
    const response = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) { const error = new Error(payload.error || `Command failed (${response.status})`); error.code = payload.code; throw error; }
    state = payload;
    render();
  }

  async function go(index) {
    const confirmJump = Math.abs(index - currentIndex()) > 2;
    if (confirmJump && !window.confirm(`Jump to cue ${index + 1}?`)) return;
    return command("/api/live/go", { index, confirmJump });
  }

  function render() {
    if (!state) return;
    const cue = currentCue();
    const next = state.runOfService?.[currentIndex() + 1];
    const times = timing();
    root.innerHTML = `<div class="operator compact-operator">
      <header class="topbar"><div class="brand"><img src="trinity-logo.png" alt=""><span>Trinity Operator</span></div><div class="status ${connectionStatus}">${escapeHtml(connectionStatus)}</div></header>
      ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ""}
      <section class="summary"><div class="panel current-card"><div class="eyebrow">CURRENT · ${currentIndex() + 1} of ${state.runOfService.length}</div>${cueDetails(cue)}</div><div class="panel next-card"><div class="eyebrow">NEXT</div>${cueDetails(next)}</div><div class="panel timing-card"><div class="eyebrow">SERVICE PROGRESS</div><strong>Service ${formatTime(times.elapsedService)}</strong><strong>Cue ${formatTime(times.elapsedCue)}</strong><strong>Remaining ${formatTime(times.remaining)}</strong></div></section>
      <section class="controls compact-controls"><button data-command="back">BACK</button><button class="go" data-command="go">GO</button><button data-command="next">NEXT</button><button class="hold ${state.live?.hold ? "active" : ""}" data-command="hold">${state.live?.hold ? "RELEASE HOLD" : "HOLD"}</button></section>
      <section class="panel active-resources"><div><div class="eyebrow">CURRENT LIGHTING</div><h2>${escapeHtml(activeLighting()?.name || "None")}</h2></div><div><div class="eyebrow">CURRENT CAMERA</div><h2>${escapeHtml(cameraFor(cue)?.name || "None")}</h2></div></section>
      <section class="panel cue-list-panel"><div class="eyebrow">ORDER OF SERVICE</div><div class="cue-list">${(state.runOfService || []).map((item, index) => `<div class="cue ${index === currentIndex() ? "current" : ""}"><span class="cue-number">${index + 1}</span><div><strong>${escapeHtml(item.name)}</strong><small>${formatTime(item.duration)} · ${escapeHtml(lookFor(item)?.name || "No look")} · ${escapeHtml(item.notes || "")}</small></div><button class="go-cue" data-go="${index}">GO</button></div>`).join("")}</div></section>
    </div>`;
    root.querySelectorAll("[data-go]").forEach(button => button.onclick = () => run(() => go(Number(button.dataset.go))));
    root.querySelectorAll("[data-command]").forEach(button => button.onclick = () => run(() => routeCommand(button.dataset.command)));
  }

  const routeCommand = action => action === "back" ? command("/api/live/back") : action === "hold" ? command("/api/live/hold") : command("/api/live/next");
  async function run(operation) { try { await operation(); } catch (error) { errorMessage = error.message; render(); } }
  async function refresh() { const response = await fetch("/api/state", { cache: "no-store" }); if (!response.ok) throw new Error(`State refresh failed (${response.status})`); state = await response.json(); render(); }

  document.addEventListener("keydown", event => {
    const tag = event.target?.tagName?.toLowerCase();
    if (event.isComposing || event.repeat || ["input", "textarea", "select"].includes(tag) || event.target?.isContentEditable) return;
    const action = ({ " ": "go", Enter: "go", ArrowRight: "next", ArrowLeft: "back", h: "hold", H: "hold" })[event.key];
    if (!action) return;
    event.preventDefault();
    run(() => routeCommand(action));
  });

  const events = new EventSource("/api/events");
  events.onopen = () => { connectionStatus = "connected"; render(); };
  events.onerror = () => { connectionStatus = navigator.onLine ? "reconnecting" : "offline"; render(); };
  events.addEventListener("state", event => { state = JSON.parse(event.data); render(); });
  window.addEventListener("offline", () => { connectionStatus = "offline"; render(); });
  window.addEventListener("online", () => { connectionStatus = "reconnecting"; render(); });
  setInterval(() => { if (state) render(); }, 1000);
  run(refresh);
})();
