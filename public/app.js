const root = document.getElementById('app');
let state;
let page = 'live';
const nav = [['live','LIVE'],['service','SERVICE'],['looks','LOOKS'],['lighting','LIGHTING'],['cameras','CAMERAS']];

const byId = (items, id) => items.find(item => item.id === id);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const currentCue = () => state.runOfService[state.live.cueIndex];
const currentLook = () => byId(state.productionLooks, currentCue()?.productionLookId);
const activeLighting = () => byId(state.lightingScenes, state.live.lightingOverrideId || currentLook()?.lightingSceneId);

const formatElapsed = start => {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(start || Date.now())) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}` : `${minutes}:${String(secs).padStart(2,'0')}`;
};
const formatClock = timestamp => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const activityTime = timestamp => new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

const presetNames = ['Stage Wide','Stage Medium','Stage Left','Stage Right','Pulpit Wide','Pulpit Tight','Piano','Choir','Baptistry','Communion','Congregation Wide','Congregation Left','Congregation Right'];

function shell(content) {
  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">Trinity Control <span>${escapeHtml(state.version)}</span></div>
        <div class="ready"><i></i> All Systems Ready</div>
      </header>
      <main class="content">${content}</main>
      <nav class="bottom-nav">
        ${nav.map(([id,label]) => `<button class="${page === id ? 'active' : ''}" data-page="${id}">${label}</button>`).join('')}
      </nav>
    </div>`;
  document.querySelectorAll('[data-page]').forEach(button => {
    button.onclick = () => { page = button.dataset.page; render(); };
  });
}

function cameraCard(camera) {
  const isProgram = state.live.programCamera === camera.id;
  const isPreview = state.live.previewCamera === camera.id;
  const selected = isProgram ? state.live.programPreset : isPreview ? state.live.previewPreset : 'Stage Wide';
  return `
    <article class="camera-monitor ${isProgram ? 'program' : ''} ${isPreview ? 'preview' : ''}" data-take-camera="${camera.id}">
      <div class="monitor-topline">
        <span>${isProgram ? '● LIVE' : isPreview ? '● PREVIEW' : 'CAMERA'}</span>
        <strong>${escapeHtml(camera.name)}</strong>
      </div>
      <div class="video-placeholder">
        <div class="lens">◎</div>
        <div>${isProgram ? 'PROGRAM OUTPUT' : 'LIVE CAMERA VIEW'}</div>
        <small>${escapeHtml(selected || 'Stage Wide')}</small>
      </div>
      <div class="camera-controls">
        <select data-camera-preset="${camera.id}" aria-label="Preset for ${escapeHtml(camera.name)}">
          ${presetNames.map(name => `<option ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
        </select>
        <button class="${isProgram ? 'live-button' : ''}" data-take-button="${camera.id}">${isProgram ? 'ON AIR' : 'TAKE LIVE'}</button>
      </div>
    </article>`;
}

function livePage() {
  const cue = currentCue();
  const look = currentLook();
  const lighting = activeLighting();
  const nextCue = state.runOfService[state.live.cueIndex + 1];
  const favorites = state.lightingScenes.filter(scene => scene.favorite).slice(0, 6);
  const activity = state.live.activityLog || [];

  shell(`
    <div class="live-layout refined-live">
      <aside class="panel cue-panel">
        <div class="section-title"><span>ORDER OF SERVICE · ${state.runOfService.length} CUES</span><strong>Sunday Service</strong></div>
        <div class="cue-scroll">
          ${state.runOfService.map((item, index) => {
            const cls = index === state.live.cueIndex ? 'current' : index < state.live.cueIndex ? 'completed' : '';
            return `<button class="cue-item ${cls}" data-go-cue="${index}">
              <span class="cue-number">${index === state.live.cueIndex ? '▶' : index + 1}</span>
              <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(byId(state.productionLooks, item.productionLookId)?.name || '')}</small></div>
              <span class="cue-icons">◉ ◇ ♪</span>
            </button>`;
          }).join('')}
        </div>
      </aside>

      <section class="main-scroll refined-main">
        <div class="summary-row">
          <div class="panel current-summary refined-summary">
            <div class="cue-heading"><span class="eyebrow">CURRENT CUE</span><h1>${escapeHtml(cue?.name || 'No Cue')}</h1><p>${escapeHtml(cue?.notes || '')}</p></div>
            <div class="summary-metric"><span>TIME IN CUE</span><strong id="cue-elapsed">${formatElapsed(state.live.cueStartedAt)}</strong><small>Started ${formatClock(state.live.cueStartedAt)}</small></div>
            <div class="summary-metric"><span>NEXT CUE</span><strong>${escapeHtml(nextCue?.name || 'End of service')}</strong></div>
            <div class="summary-metric"><span>LIGHTING</span><strong>${escapeHtml(lighting?.name || 'None')}</strong></div>
            <div class="summary-metric"><span>LOOK</span><strong>${escapeHtml(look?.name || 'None')}</strong></div>
          </div>
          <div class="panel notes-card"><span class="eyebrow">NOTES</span><p>${escapeHtml(cue?.notes || 'No notes for this cue.')}</p></div>
        </div>

        <div class="camera-grid">
          ${state.cameras.map(cameraCard).join('')}
        </div>

        <div class="panel quick-panel">
          <div class="section-title"><span>FAVORITE LIGHTING SCENES</span></div>
          <div class="quick-grid">
            ${favorites.map(scene => `<button data-lighting="${scene.id}" class="${state.live.lightingOverrideId === scene.id ? 'selected' : ''}">${escapeHtml(scene.name)}</button>`).join('')}
            <button class="danger" data-lighting="light-blackout">⏻ BLACKOUT</button>
          </div>
          ${state.live.lightingOverrideId ? `<button id="return-lighting" class="return-button">Return to cue lighting</button>` : ''}
        </div>

        <div class="lower-grid">
          <section class="panel activity-panel">
            <div class="lower-title"><span>ACTIVITY LOG</span></div>
            <div class="activity-list">${activity.length ? activity.map(item => `<div><time>${activityTime(item.at)}</time><span>${escapeHtml(item.message)}</span></div>`).join('') : '<p class="empty-state">Activity will appear here as cues, cameras, and lights are changed.</p>'}</div>
          </section>
          <section class="panel status-panel">
            <div class="lower-title"><span>SYSTEM STATUS</span></div>
            <div class="status-grid">
              ${state.cameras.map(camera => `<div><i></i><strong>${escapeHtml(camera.name)}</strong><small>Ready</small></div>`).join('')}
              <div><i></i><strong>QLC+</strong><small>Simulation</small></div>
              <div><i></i><strong>ATEM</strong><small>Simulation</small></div>
              <div><i></i><strong>Streaming</strong><small>Ready</small></div>
              <div><i></i><strong>Network</strong><small>Good</small></div>
            </div>
          </section>
        </div>
      </section>
    </div>`);

  const timer = setInterval(() => {
    const el = document.getElementById('cue-elapsed');
    if (!el || page !== 'live') return clearInterval(timer);
    el.textContent = formatElapsed(state.live.cueStartedAt);
  }, 1000);

  document.querySelectorAll('[data-go-cue]').forEach(button => button.onclick = async () => {
    state = await window.trinity.goCue(Number(button.dataset.goCue));
    render();
  });

  const takeCamera = async cameraId => {
    if (cameraId === state.live.programCamera) return;
    const previousProgram = state.live.programCamera;
    const previousPreset = state.live.programPreset;
    state.live.programCamera = cameraId;
    const selector = document.querySelector(`[data-camera-preset="${cameraId}"]`);
    state.live.programPreset = selector?.value || 'Stage Wide';
    state.live.previewCamera = previousProgram;
    state.live.previewPreset = previousPreset || 'Stage Wide';
    state.live.activityLog = [{ at: Date.now(), message: `Camera live: ${byId(state.cameras, cameraId)?.name || cameraId}` }, ...(state.live.activityLog || [])].slice(0, 8);
    state = await window.trinity.saveState(state);
    render();
  };

  document.querySelectorAll('[data-take-camera]').forEach(card => card.onclick = event => {
    if (event.target.closest('select') || event.target.closest('button')) return;
    takeCamera(card.dataset.takeCamera);
  });
  document.querySelectorAll('[data-take-button]').forEach(button => button.onclick = () => takeCamera(button.dataset.takeButton));
  document.querySelectorAll('[data-camera-preset]').forEach(select => select.onchange = async () => {
    const cameraId = select.dataset.cameraPreset;
    if (cameraId === state.live.programCamera) state.live.programPreset = select.value;
    else { state.live.previewCamera = cameraId; state.live.previewPreset = select.value; }
    state.live.activityLog = [{ at: Date.now(), message: `${byId(state.cameras, cameraId)?.name || cameraId} preset: ${select.value}` }, ...(state.live.activityLog || [])].slice(0, 8);
    state = await window.trinity.saveState(state);
    render();
  });
  document.querySelectorAll('[data-lighting]').forEach(button => button.onclick = async () => { state = await window.trinity.lightingOverride(button.dataset.lighting); render(); });
  const returnButton = document.getElementById('return-lighting');
  if (returnButton) returnButton.onclick = async () => { state = await window.trinity.returnToCueLighting(); render(); };
}

function servicePage() {
  const categories = [...new Set(state.cueTemplates.map(template => template.category))];
  shell(`
    <div class="page-scroll">
      <div class="two-column">
        <section class="panel">
          <div class="section-title"><span>RUN OF SERVICE</span><strong>${state.runOfService.length} cues</strong></div>
          <div class="service-list">
            ${state.runOfService.map((cue,index) => `<div class="service-row ${index === state.live.cueIndex ? 'current' : ''}" draggable="true" data-cue-index="${index}">
              <span class="drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
              <strong>${String(index + 1).padStart(2,'0')}</strong>
              <div><b>${escapeHtml(cue.name)}</b><small>${escapeHtml(byId(state.productionLooks,cue.productionLookId)?.name || '')}</small></div>
              <div class="row-actions"><button data-go="${index}">GO</button><button data-remove="${index}" aria-label="Remove ${escapeHtml(cue.name)}">×</button></div>
            </div>`).join('')}
          </div>
        </section>
        <aside class="panel">
          <div class="section-title"><span>ADD CUE</span></div>
          <div class="template-grid">
            ${categories.map(category => state.cueTemplates.filter(t => t.category === category).map(template => `<article class="template-card"><small>${escapeHtml(category)}</small><h3>${escapeHtml(template.name)}</h3><p>${escapeHtml(byId(state.productionLooks,template.productionLookId)?.name || '')}</p><button data-template="${template.id}">ADD</button></article>`).join('')).join('')}
          </div>
        </aside>
      </div>
    </div>`);
  document.querySelectorAll('[data-template]').forEach(button => button.onclick = async () => { state = await window.trinity.addCueTemplate(button.dataset.template); render(); });
  document.querySelectorAll('[data-go]').forEach(button => button.onclick = async () => { state = await window.trinity.goCue(Number(button.dataset.go)); page = 'live'; render(); });
  document.querySelectorAll('[data-remove]').forEach(button => button.onclick = async () => { state = await window.trinity.removeCue(Number(button.dataset.remove)); render(); });

  let draggedIndex = null;
  const rows = [...document.querySelectorAll('[data-cue-index]')];
  rows.forEach(row => {
    row.addEventListener('dragstart', event => {
      if (event.target.closest('button')) { event.preventDefault(); return; }
      draggedIndex = Number(row.dataset.cueIndex);
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(draggedIndex));
    });
    row.addEventListener('dragover', event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      rows.forEach(item => item.classList.remove('drop-before','drop-after'));
      const rect = row.getBoundingClientRect();
      row.classList.add(event.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
    });
    row.addEventListener('dragleave', event => {
      if (!row.contains(event.relatedTarget)) row.classList.remove('drop-before','drop-after');
    });
    row.addEventListener('drop', async event => {
      event.preventDefault();
      const from = draggedIndex ?? Number(event.dataTransfer.getData('text/plain'));
      const target = Number(row.dataset.cueIndex);
      const rect = row.getBoundingClientRect();
      let to = target + (event.clientY >= rect.top + rect.height / 2 ? 1 : 0);
      if (from < to) to -= 1;
      to = Math.max(0, Math.min(to, state.runOfService.length - 1));
      rows.forEach(item => item.classList.remove('dragging','drop-before','drop-after'));
      draggedIndex = null;
      if (from !== to) state = await window.trinity.moveCue(from, to);
      render();
    });
    row.addEventListener('dragend', () => {
      draggedIndex = null;
      rows.forEach(item => item.classList.remove('dragging','drop-before','drop-after'));
    });
  });
}

function looksPage() {
  shell(`<div class="page-scroll"><section class="panel"><div class="section-title"><span>PRODUCTION LOOKS</span><strong>${state.productionLooks.length} looks</strong></div><div class="card-grid">${state.productionLooks.map(look => `<article class="edit-card"><small>PRODUCTION LOOK</small><h2>${escapeHtml(look.name)}</h2><label>Lighting<select data-look="${look.id}" data-field="lightingSceneId">${state.lightingScenes.map(scene => `<option value="${scene.id}" ${scene.id === look.lightingSceneId ? 'selected' : ''}>${escapeHtml(scene.name)}</option>`).join('')}</select></label><label>Camera layout<select data-look="${look.id}" data-field="cameraLayoutId">${state.cameraLayouts.map(layout => `<option value="${layout.id}" ${layout.id === look.cameraLayoutId ? 'selected' : ''}>${escapeHtml(layout.name)}</option>`).join('')}</select></label><label>Graphics<input data-look="${look.id}" data-field="graphics" value="${escapeHtml(look.graphics)}"></label><label>House lights<input type="number" min="0" max="100" data-look="${look.id}" data-field="houseLights" value="${look.houseLights}"></label></article>`).join('')}</div></section></div>`);
  document.querySelectorAll('[data-look]').forEach(input => input.onchange = async () => {
    const look = byId(state.productionLooks,input.dataset.look);
    look[input.dataset.field] = input.type === 'number' ? Number(input.value) : input.value;
    state = await window.trinity.saveState(state);
    render();
  });
}

function lightingPage() {
  shell(`<div class="page-scroll"><section class="panel"><div class="section-title"><span>LIGHTING LIBRARY</span><strong>${state.lightingScenes.length} scenes</strong></div><div class="card-grid">${state.lightingScenes.map(scene => `<article class="edit-card ${scene.favorite ? 'favorite' : ''}"><small>${escapeHtml(scene.category || 'Custom')}</small><h2>${escapeHtml(scene.name)}</h2><div class="metrics"><span>Platform <b>${scene.platform}%</b></span><span>Fill <b>${scene.fill}%</b></span><span>House <b>${scene.house}%</b></span><span>Fade <b>${scene.fade}s</b></span></div><button data-preview-light="${scene.id}">PREVIEW ON LIVE PAGE</button></article>`).join('')}</div></section></div>`);
  document.querySelectorAll('[data-preview-light]').forEach(button => button.onclick = async () => { state = await window.trinity.lightingOverride(button.dataset.previewLight); page = 'live'; render(); });
}

function camerasPage() {
  shell(`<div class="page-scroll"><section class="panel"><div class="section-title"><span>CAMERA LAYOUTS</span><strong>${state.cameraLayouts.length} layouts</strong></div><div class="card-grid">${state.cameraLayouts.map(layout => `<article class="edit-card ${layout.favorite ? 'favorite' : ''}"><small>${escapeHtml(layout.category || 'Custom')}</small><h2>${escapeHtml(layout.name)}</h2><div class="metrics vertical"><span>Program <b>${escapeHtml(byId(state.cameras,layout.programCamera)?.name || layout.programCamera)} · ${escapeHtml(layout.programPreset)}</b></span><span>Preview <b>${escapeHtml(byId(state.cameras,layout.previewCamera)?.name || layout.previewCamera)} · ${escapeHtml(layout.previewPreset)}</b></span><span>Tracking <b>${layout.tracking ? 'ON' : 'OFF'}</b></span></div></article>`).join('')}</div></section></div>`);
}

function render() {
  if (!state) return;
  if (page === 'live') livePage();
  else if (page === 'service') servicePage();
  else if (page === 'looks') looksPage();
  else if (page === 'lighting') lightingPage();
  else camerasPage();
}

(async () => {
  try {
    state = await window.trinity.getState();
    render();
  } catch (error) {
    root.innerHTML = `<div class="fatal"><h1>Trinity Control could not start</h1><pre>${escapeHtml(error?.stack || error)}</pre></div>`;
  }
})();
