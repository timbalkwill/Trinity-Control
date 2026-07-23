(() => {
  const root = document.getElementById("app");
  let state;
  let connectionStatus = "reconnecting";
  let errorMessage = "";

  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const byId = (items, id) => (items || []).find(item => item.id === id);
  const currentCue = () => state?.runOfService?.[state.live?.cueIndex || 0];
  const currentLook = () => byId(state?.productionLooks, currentCue()?.productionLookId);
  const lightingId = () => state?.live?.lightingOverrideId || state?.live?.lastLightingSceneId || currentCue()?.lightingSceneId || currentLook()?.lightingSceneId;

  async function command(route, body = {}) {
    errorMessage = "";
    const response = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Command failed (${response.status})`);
    state = payload;
    render();
  }

  function render() {
    if (!state) return;
    const cue = currentCue();
    const next = state.runOfService?.[(state.live?.cueIndex || 0) + 1];
    const activeLightingId = lightingId();
    const activeLighting = byId(state.lightingScenes, activeLightingId);
    root.innerHTML = `<div class="operator">
      <header class="topbar">
        <div class="brand"><img src="trinity-logo.png" alt=""><span>Trinity Browser Operator</span></div>
        <div class="status ${connectionStatus}">${escapeHtml(connectionStatus)}</div>
      </header>
      ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ""}
      <section class="summary">
        <div class="panel"><div class="eyebrow">CURRENT CUE</div><h1>${escapeHtml(cue?.name || "No cue")}</h1><div class="muted">${escapeHtml(cue?.notes || "")}</div></div>
        <div class="panel"><div class="eyebrow">NEXT CUE</div><h2>${escapeHtml(next?.name || "End of service")}</h2></div>
        <div class="panel"><div class="eyebrow">LIGHTING</div><h2>${escapeHtml(activeLighting?.name || "None")}</h2><div class="muted">${state.live?.lightingOverrideId ? "Manual override" : "Cue lighting"}</div></div>
      </section>
      <section class="controls">
        <button data-command="back">BACK</button>
        <button class="go" data-command="next">NEXT</button>
        <button class="hold ${state.live?.hold ? "active" : ""}" data-command="hold">${state.live?.hold ? "RELEASE HOLD" : "HOLD"}</button>
        <button data-command="refresh">REFRESH</button>
      </section>
      <section class="panel"><div class="eyebrow">LIGHTING OVERRIDE</div><div class="lighting-grid">
        ${(state.lightingScenes || []).filter(scene => scene.favorite).map(scene => `<button class="${state.live?.lightingOverrideId === scene.id ? "active" : ""}" data-light="${escapeHtml(scene.id)}">${escapeHtml(scene.name)}</button>`).join("")}
        <button data-command="cue-lighting">RETURN TO CUE</button>
      </div></section>
      <section class="panel"><div class="eyebrow">ORDER OF SERVICE</div><div class="cue-list">
        ${(state.runOfService || []).map((item, index) => `<div class="cue ${index === state.live?.cueIndex ? "current" : ""}"><span class="cue-number">${index + 1}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.notes || "")}</small></div><button class="go-cue" data-go="${index}">GO</button></div>`).join("")}
      </div></section>
    </div>`;

    root.querySelectorAll("[data-go]").forEach(button => button.onclick = () => run(() => command("/api/live/go", { index: Number(button.dataset.go) })));
    root.querySelectorAll("[data-light]").forEach(button => button.onclick = () => run(() => command("/api/lighting/override", { sceneId: button.dataset.light })));
    root.querySelectorAll("[data-command]").forEach(button => button.onclick = () => run(async () => {
      const action = button.dataset.command;
      if (action === "refresh") return refresh();
      const routes = { back: "/api/live/back", next: "/api/live/next", hold: "/api/live/hold", "cue-lighting": "/api/lighting/return-to-cue" };
      return command(routes[action]);
    }));
  }

  async function run(operation) {
    try { await operation(); }
    catch (error) { errorMessage = error.message; render(); }
  }

  async function refresh() {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error(`State refresh failed (${response.status})`);
    state = await response.json();
    render();
  }

  const events = new EventSource("/api/events");
  events.onopen = () => { connectionStatus = "connected"; render(); };
  events.onerror = () => { connectionStatus = navigator.onLine ? "reconnecting" : "offline"; render(); };
  events.addEventListener("state", event => { state = JSON.parse(event.data); render(); });
  window.addEventListener("offline", () => { connectionStatus = "offline"; render(); });
  window.addEventListener("online", () => { connectionStatus = "reconnecting"; render(); });
  run(refresh);
})();
