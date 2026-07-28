const root = document.getElementById('app');

let state;
let homeAssistantStatus = null;
let homeAssistantBusy = false;
let selectedLightingSceneId = null;
let showAllLightingControls = false;
let showAllDiscoveredLightingControls = false;
let lightingSceneFilter = 'production';
let qlcServiceStatus = null;
let operatorServerStatus;
let page = 'live';
let cueEditorOpen = false;
let selectedLookId = null;
let lookSearch = '';
let settingsSection = 'devices';
let selectedDeviceId = null;
let deviceTypeFilter = '';
let deviceEnabledFilter = '';
let selectedManagedCameraId = null;
let selectedCameraPresetId = null;
let cameraPresetSearch = '';
let cameraPresetCategory = '';
let selectedShotId = null;
let shotSearch = '';
let shotCategory = '';
let shotCamera = '';
let shotFavorite = '';
let shotEnabled = '';
const suggestedPresetCategories = ['Pastor', 'Platform', 'Piano', 'Choir', 'Baptistry', 'Congregation', 'Wide', 'Utility'];
const suggestedShotCategories = ['Pastor', 'Platform', 'Music', 'Piano', 'Choir', 'Baptistry', 'Congregation', 'Wide', 'Utility'];

const nav = [
  ['live', 'LIVE'],
  ['service', 'SERVICE'],
  ['looks', 'LOOKS'],
  ['lighting', 'LIGHTING'],
  ['cameras', 'CAMERAS'],
  ['shots', 'SHOTS'],
  ['settings', '⚙ SETTINGS']
];

const byId = (items, id) => items.find(item => item.id === id);

function lightingScenePickerOptions(current, emptyLabel) {
  const scenes = state.lightingScenes || [];
  const currentScene = byId(scenes, current);
  const currentOption = current && currentScene?.productionScene === false
    ? `<option value="${escapeHtml(currentScene.id)}" selected>${escapeHtml(currentScene.name)} (Utility — referenced)</option>`
    : current && !currentScene
      ? `<option value="${escapeHtml(current)}" selected>Missing reference</option>`
      : '';
  return `<option value="">${emptyLabel}</option>${currentOption}${scenes
    .filter(scene => scene.productionScene !== false)
    .map(scene => `<option value="${scene.id}" ${scene.id === current ? 'selected' : ''}>${escapeHtml(scene.name)}</option>`)
    .join('')}`;
}

const normalizedLightingName = value => String(value || '')
  .replace(/^\s*trinity\s*[-–—:]\s*/i, '')
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

function cameraScopedPresets(presets, cameraDeviceId) {
  const scoped = new Map();
  for (const preset of presets || []) {
    if (!preset?.id || preset.cameraDeviceId !== cameraDeviceId) continue;
    const key = `${preset.cameraDeviceId}\u0000${preset.id}`;
    if (!scoped.has(key)) scoped.set(key, preset);
  }
  return [...scoped.values()];
}

const escapeHtml = (value = '') =>
  String(value).replace(
    /[&<>"']/g,
    ch =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[ch]
  );

const currentCue = () =>
  state.runOfService[state.live.cueIndex];

const currentLook = () =>
  byId(state.productionLooks, currentCue()?.productionLookId);

const liveCameraTiles = () => {
  const devices = (state.devices || []).filter(device => device.type === 'camera');
  return devices.length ? devices : (state.cameras || []);
};

const cueLightingId = cue =>
  cue?.lightingSceneId ||
  byId(state.productionLooks, cue?.productionLookId)?.lightingSceneId ||
  '';

const cueCameraLayoutId = cue =>
  cue?.cameraLayoutId ||
  byId(state.productionLooks, cue?.productionLookId)?.cameraLayoutId ||
  '';

const cueLighting = cue =>
  byId(state.lightingScenes, cueLightingId(cue));

const cueCameraLayout = cue =>
  byId(state.cameraLayouts, cueCameraLayoutId(cue));

const activeLighting = () =>
  byId(
    state.lightingScenes,
    state.live.lightingOverrideId || cueLightingId(currentCue())
  );

const formatElapsed = start => {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - Number(start || Date.now())) / 1000)
  );

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
};

const formatClock = timestamp =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });

const formatDuration = seconds => {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};

const timing = () => {
  const now = Date.now();
  const index = Number(state.live?.cueIndex) || 0;
  const cueElapsed = Math.max(0, Math.floor((now - Number(state.live?.cueStartedAt || now)) / 1000));
  const serviceElapsed = Math.max(0, Math.floor((now - Number(state.live?.serviceStartedAt || state.live?.cueStartedAt || now)) / 1000));
  const remaining = Math.max(0, (Number(state.runOfService[index]?.duration) || 0) - cueElapsed) + state.runOfService.slice(index + 1).reduce((sum, cue) => sum + Math.max(0, Number(cue.duration) || 0), 0);
  return { cueElapsed, serviceElapsed, remaining, position: state.runOfService.length ? index + 1 : 0, total: state.runOfService.length };
};

const activityTime = timestamp =>
  new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

const presetNames = [
  'Stage Wide',
  'Stage Medium',
  'Stage Left',
  'Stage Right',
  'Pulpit Wide',
  'Pulpit Tight',
  'Piano',
  'Choir',
  'Baptistry',
  'Communion',
  'Congregation Wide',
  'Congregation Left',
  'Congregation Right'
];

function ensureAppStyles() {
  if (document.getElementById('trinity-refresh-added-styles')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'trinity-refresh-added-styles';

  style.textContent = `
    .topbar {
      display: grid !important;
      grid-template-columns: minmax(220px, 1fr) auto minmax(220px, 1fr);
      align-items: center;
      position: relative;
    }

    .brand {
      justify-self: start;
    }

    .header-logo {
      justify-self: center;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 280px;
      pointer-events: none;
    }

    .header-logo img {
      display: block;
      height: 48px;
      width: auto;
      max-width: 330px;
      object-fit: contain;
    }

    .ready {
      justify-self: end;
    }

    .service-row > div:nth-child(3) {
      min-width: 0;
    }

    .row-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: nowrap;
    }

    .drag-handle { touch-action: none; padding: 10px 6px; }

    .row-actions button[data-edit] {
      color: #8db6ff;
      border-color: rgba(47, 124, 255, 0.65);
      background: rgba(47, 124, 255, 0.12);
    }

    .row-actions button[data-edit]:hover {
      color: #ffffff;
      background: rgba(47, 124, 255, 0.32);
    }

    .cue-detail-badges {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 6px;
    }

    .cue-detail-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 7px;
      border-radius: 999px;
      font-size: 10px;
      line-height: 1.25;
      white-space: nowrap;
      color: rgba(255, 255, 255, 0.58);
      background: rgba(255, 255, 255, 0.055);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .cue-detail-badge.override-light {
      color: #75e6bd;
      background: rgba(32, 201, 151, 0.13);
      border-color: rgba(32, 201, 151, 0.36);
    }

    .cue-detail-badge.override-camera {
      color: #8db6ff;
      background: rgba(47, 124, 255, 0.14);
      border-color: rgba(47, 124, 255, 0.4);
    }

    .cue-editor-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(3, 7, 18, 0.8);
      backdrop-filter: blur(7px);
    }

    .cue-editor {
      width: min(680px, calc(100vw - 40px));
      max-height: calc(100vh - 48px);
      overflow: auto;
      color: #ffffff;
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 18px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.58);
    }

    .cue-editor-header {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 22px;
      background: #111827;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .cue-editor-header h2 {
      margin: 0;
      font-size: 22px;
    }

    .cue-editor-close {
      width: 38px;
      height: 38px;
      padding: 0;
      border-radius: 10px;
      font-size: 21px;
    }

    .cue-editor-body {
      display: grid;
      gap: 17px;
      padding: 22px;
    }

    .cue-editor-body label {
      display: grid;
      gap: 7px;
      color: rgba(255, 255, 255, 0.7);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    .cue-editor-body input,
    .cue-editor-body select,
    .cue-editor-body textarea {
      box-sizing: border-box;
      width: 100%;
      padding: 12px 13px;
      color: #ffffff;
      background: #0b1220;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      font: inherit;
      letter-spacing: normal;
      text-transform: none;
    }

    .cue-editor-body input:focus,
    .cue-editor-body select:focus,
    .cue-editor-body textarea:focus {
      outline: 2px solid rgba(47, 124, 255, 0.48);
      border-color: #2f7cff;
    }

    .cue-editor-body textarea {
      min-height: 110px;
      resize: vertical;
    }

    .cue-editor-effective {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .cue-editor-effective div {
      padding: 12px 13px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 11px;
    }

    .cue-editor-effective span {
      display: block;
      margin-bottom: 5px;
      color: rgba(255, 255, 255, 0.48);
      font-size: 10px;
      letter-spacing: 0.08em;
    }

    .cue-editor-effective strong {
      color: #ffffff;
      font-size: 14px;
    }

    .cue-editor-actions {
      position: sticky;
      bottom: 0;
      z-index: 2;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 16px 22px 22px;
      background: #111827;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .cue-editor-actions button {
      min-width: 110px;
    }

    .cue-editor-actions .save-cue {
      color: #ffffff;
      background: #155eef;
      border-color: #2f7cff;
    }

    @media (max-width: 850px) {
      .topbar {
        grid-template-columns: 1fr auto;
      }

      .header-logo {
        display: none;
      }

      .cue-editor-effective {
        grid-template-columns: 1fr;
      }
    }
  `;

  document.head.appendChild(style);
}

function shell(content) {
  ensureAppStyles();
  const qlcManagementEnabled = state?.settings?.qlcplusService?.manageAutomatically === true;
  const qlcReadiness = !qlcManagementEnabled
    ? 'All Systems Ready'
    : qlcServiceStatus?.state !== 'connected'
      ? 'Lighting Not Ready'
      : qlcServiceStatus?.compatibility?.severity === 'warning'
        ? 'Systems Ready · Lighting Warning'
        : 'All Systems Ready';

  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          Trinity Control
          <span>${escapeHtml(state.version)}</span>
        </div>

        <div class="header-logo">
          <img
            src="assets/trinity-logo.png"
            alt="Trinity Baptist Church"
          >
        </div>

        <div class="ready">
          <i></i>
          ${escapeHtml(qlcReadiness)}
        </div>
      </header>

      <main class="content">
        ${content}
      </main>

      <nav class="bottom-nav">
        ${nav
          .map(
            ([id, label]) =>
              `<button
                class="${page === id ? 'active' : ''}"
                data-page="${id}"
              >${label}</button>`
          )
          .join('')}
      </nav>
    </div>
  `;

  document.querySelectorAll('[data-page]').forEach(button => {
    button.onclick = () => {
      page = button.dataset.page;
      render();
    };
  });
}

function cameraCard(camera) {
  const snapshot = state.live?.executionSnapshot;
  const role = window.TrinityLookView.cameraRole(state, camera.id);
  const isProgram = role === 'program';
  const isPreview = role === 'preview';
  const isAuxiliary = role === 'auxiliary';
  const legacyCamera = byId(state.cameras || [], camera.id);
  const selected = legacyCamera?.lastPreset || 'Stage Wide';
  const executedAssignment = (snapshot?.cameraAssignments || []).find(item => item.cameraDeviceId === camera.id);
  const executedPreset = executedAssignment?.presetName || (isProgram ? snapshot?.video?.programPreset : isPreview ? snapshot?.video?.previewPreset : null);
  const executedShot = executedAssignment?.shotName || (isProgram ? snapshot?.video?.programShotName : isPreview ? snapshot?.video?.previewShotName : null);
  const tracking = executedAssignment?.tracking?.preferred ? 'Preferred' : executedAssignment?.tracking?.mode || 'Off';
  const motion = executedAssignment?.motion?.enabled ? 'On' : 'Off';

  return `
    <article
      class="camera-monitor
        ${isProgram ? 'program' : ''}
        ${isPreview ? 'preview' : ''}
        ${isAuxiliary ? 'auxiliary' : ''}"
      data-take-camera="${camera.id}"
    >
      <div class="monitor-topline">
        <span>
          ${
            isProgram
              ? '● LIVE / PROGRAM'
              : isPreview
                ? '● PREVIEW'
                : isAuxiliary
                  ? '● AUXILIARY'
                  : 'CAMERA / IDLE'
          }
        </span>

        <strong>${escapeHtml(camera.name)}</strong>
      </div>

      <div class="video-placeholder">
        <div class="lens">◎</div>

        <div>
          ${isProgram ? 'PROGRAM OUTPUT' : isPreview ? 'PREVIEW CAMERA' : isAuxiliary ? 'AUXILIARY CAMERA' : 'CAMERA IDLE'}
        </div>

        <small>
          Shot: ${escapeHtml(executedShot || 'Not assigned')}<br>
          Preset: ${escapeHtml(executedPreset || 'Not assigned')}<br>
          Tracking: ${escapeHtml(tracking)} · Motion: ${escapeHtml(motion)}
          ${executedAssignment?.warnings?.length ? `<br>⚠ ${escapeHtml(executedAssignment.warnings.join('; '))}` : ''}
        </small>
      </div>

      <div class="camera-controls">
        <label class="manual-preset-label">Manual preset (future)
        <select
          data-camera-preset="${camera.id}"
          aria-label="Preset for ${escapeHtml(camera.name)}"
        >
          ${presetNames
            .map(
              name =>
                `<option
                  ${name === selected ? 'selected' : ''}
                >${escapeHtml(name)}</option>`
            )
            .join('')}
        </select>
        </label>

        <button
          class="${isProgram ? 'live-button' : ''}"
          ${isPreview ? 'data-take-live' : 'disabled'}
        >
          ${isProgram ? 'ON AIR' : isPreview ? 'TAKE LIVE' : 'STANDBY'}
        </button>
      </div>
    </article>
  `;
}

async function activateCue(index) {
  const needsConfirmation = Math.abs(index - (Number(state.live?.cueIndex) || 0)) > 2;
  if (needsConfirmation && !window.confirm(`Jump to cue ${index + 1}?`)) return state;
  state = await window.trinity.goCue(index, { confirmJump: needsConfirmation });
  return state;
}

function openCueEditor(index) {
  const cue = state.runOfService[index];
  if (!cue) return;

  cueEditorOpen = true;
  document.querySelector('.cue-editor-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'cue-editor-backdrop';
  backdrop.innerHTML = `
    <section class="cue-editor cue-editor-simplified" role="dialog" aria-modal="true" aria-labelledby="cue-editor-title">
      <div class="cue-editor-header">
        <div>
          <small>SERVICE CUE</small>
          <h2 id="cue-editor-title">Edit Service Cue</h2>
        </div>
        <button type="button" class="cue-editor-close" aria-label="Close cue editor">×</button>
      </div>

      <div class="cue-editor-body cue-editor-body-simplified">
        <label class="cue-editor-full">
          Cue Name
          <input id="cue-edit-name" value="${escapeHtml(cue.name || '')}" maxlength="80">
        </label>

        <label>
          Production Look
          <select id="cue-edit-look">
            <option value="">No Production Look</option>
            ${state.productionLooks.map(look => `<option value="${look.id}" ${look.id === cue.productionLookId ? 'selected' : ''}>${escapeHtml(look.name)}</option>`).join('')}
          </select>
        </label>

        <label>
          Lighting Override
          <select id="cue-edit-lighting">
            ${lightingScenePickerOptions(cue.lightingSceneId, 'Use Production Look')}
          </select>
          <small class="field-help">Leave this set to Use Production Look unless this cue needs different lighting.</small>
        </label>

        <label class="cue-editor-full">
          Notes
          <textarea id="cue-edit-notes" placeholder="Operator notes for this cue">${escapeHtml(cue.notes || '')}</textarea>
        </label>

        <section class="cue-execution-preview cue-editor-full" aria-labelledby="cue-preview-title">
          <div class="cue-preview-heading">
            <div>
              <small>WHEN GO IS PRESSED</small>
              <h3 id="cue-preview-title">Cue Preview</h3>
            </div>
            <span id="cue-preview-status" class="cue-preview-status"></span>
          </div>

          <div class="cue-preview-summary">
            <div><span>Production Look</span><strong id="cue-preview-look"></strong></div>
            <div><span>Lighting</span><strong id="cue-preview-lighting"></strong></div>
            <div><span>Priority Camera</span><strong id="cue-preview-priority"></strong></div>
            <div><span>Main Tracking</span><strong id="cue-preview-tracking"></strong></div>
          </div>

          <div class="cue-preview-cameras">
            ${['main', 'left', 'right'].map(role => `
              <article class="cue-preview-camera" data-preview-role="${role}">
                <span>${role.toUpperCase()} CAMERA</span>
                <strong data-preview-camera-name>Not configured</strong>
                <small data-preview-preset-name>No preset selected</small>
              </article>`).join('')}
          </div>

          <div id="cue-preview-warnings" class="cue-preview-warnings" hidden></div>
        </section>
      </div>

      <div class="cue-editor-actions">
        <button type="button" class="cancel-cue">Cancel</button>
        <button type="button" class="save-cue">Save Cue</button>
      </div>
    </section>`;

  document.body.appendChild(backdrop);

  const nameInput = backdrop.querySelector('#cue-edit-name');
  const lookSelect = backdrop.querySelector('#cue-edit-look');
  const lightingSelect = backdrop.querySelector('#cue-edit-lighting');
  const notesInput = backdrop.querySelector('#cue-edit-notes');

  const cameraItems = () => {
    const devices = (state.devices || []).filter(item => item.type === 'camera');
    const known = new Set(devices.map(item => item.id));
    return [...devices, ...(state.cameras || []).filter(item => item?.id && !known.has(item.id))];
  };

  const cameraForAssignment = assignment =>
    cameraItems().find(item => item.id === assignment?.cameraId || item.id === assignment?.cameraDeviceId);

  const presetForAssignment = assignment =>
    (state.cameraPresets || []).find(item =>
      item.id === assignment?.presetId &&
      (!assignment?.cameraId || item.cameraDeviceId === assignment.cameraId)
    );

  const updatePreview = () => {
    const look = byId(state.productionLooks, lookSelect.value);
    const lighting = byId(state.lightingScenes, lightingSelect.value || look?.lightingSceneId);
    const priority = cameraItems().find(item => item.id === look?.priorityCameraId);
    const warnings = [];

    backdrop.querySelector('#cue-preview-look').textContent = look?.name || 'Not assigned';
    backdrop.querySelector('#cue-preview-lighting').textContent = lighting?.name || 'Not assigned';
    backdrop.querySelector('#cue-preview-priority').textContent = priority?.name || (look?.priorityCameraId ? 'Missing camera' : 'Not assigned');
    backdrop.querySelector('#cue-preview-tracking').textContent = look?.startMainTracking ? 'Starts On' : 'Off';

    if (!look) warnings.push('Choose a Production Look.');
    if (!lighting) warnings.push('No lighting scene will be recalled.');
    if (lighting?.productionScene === false) warnings.push('Scene is marked Utility but is still referenced.');
    if (look?.enabled === false) warnings.push('The selected Production Look is disabled.');

    for (const role of ['main', 'left', 'right']) {
      const assignment = look?.cameraPresets?.[role] || {};
      const camera = cameraForAssignment(assignment);
      const preset = presetForAssignment(assignment);
      const card = backdrop.querySelector(`[data-preview-role="${role}"]`);
      card.querySelector('[data-preview-camera-name]').textContent = camera?.name || (assignment.cameraId ? 'Missing camera' : 'Not configured');
      card.querySelector('[data-preview-preset-name]').textContent = preset?.name || (assignment.presetId ? 'Missing preset' : 'No preset selected');
      card.classList.toggle('warning', Boolean((assignment.cameraId && !camera) || (assignment.presetId && !preset)));
      if (!assignment.cameraId || !assignment.presetId) warnings.push(`${role[0].toUpperCase() + role.slice(1)} camera preset is not configured.`);
      else if (!camera || !preset) warnings.push(`${role[0].toUpperCase() + role.slice(1)} camera preset reference is missing.`);
    }

    const warningBox = backdrop.querySelector('#cue-preview-warnings');
    warningBox.hidden = warnings.length === 0;
    warningBox.innerHTML = warnings.map(item => `<span>⚠ ${escapeHtml(item)}</span>`).join('');

    const status = backdrop.querySelector('#cue-preview-status');
    status.textContent = warnings.length ? `${warnings.length} item${warnings.length === 1 ? '' : 's'} to review` : 'Ready';
    status.className = `cue-preview-status ${warnings.length ? 'warning' : 'ready'}`;
  };

  const close = () => {
    cueEditorOpen = false;
    backdrop.remove();
  };

  lookSelect.onchange = updatePreview;
  lightingSelect.onchange = updatePreview;
  updatePreview();

  backdrop.querySelector('.cue-editor-close').onclick = close;
  backdrop.querySelector('.cancel-cue').onclick = close;
  backdrop.onclick = event => { if (event.target === backdrop) close(); };

  backdrop.querySelector('.save-cue').onclick = async () => {
    state = await window.trinity.updateCue(index, {
      name: nameInput.value.trim() || 'Untitled Cue',
      productionLookId: lookSelect.value,
      lightingSceneId: lightingSelect.value || '',
      cameraLayoutId: '',
      notes: notesInput.value.trim()
    });
    close();
    render();
  };

  nameInput.focus();
  nameInput.select();
}

function legacyLivePage() {
  const cue = currentCue();
  const look = currentLook();
  const lighting = activeLighting();
  const currentLookDetails = window.TrinityLookView.summarize(state, cue);

  const nextCue =
    state.runOfService[state.live.cueIndex + 1];
  const nextLookDetails = window.TrinityLookView.summarize(state, nextCue);

  const favorites =
    state.lightingScenes
      .filter(scene => scene.favorite)
      .slice(0, 6);

  const activity =
    state.live.activityLog || [];
  const serviceTiming = timing();

  shell(`
    <div class="live-layout refined-live">
      <aside class="panel cue-panel">
        <div class="section-title">
          <span>
            ORDER OF SERVICE ·
            ${state.runOfService.length}
            CUES
          </span>

          <strong>Sunday Service</strong>
        </div>

        <div class="cue-scroll">
          ${state.runOfService
            .map((item, index) => {
              const cls =
                index === state.live.cueIndex
                  ? 'current'
                  : index < state.live.cueIndex
                    ? 'completed'
                    : '';

              return `
                <button
                  class="cue-item ${cls}"
                  data-go-cue="${index}"
                >
                  <span class="cue-number">
                    ${
                      index === state.live.cueIndex
                        ? '▶'
                        : index + 1
                    }
                  </span>

                  <div>
                    <strong>
                      ${escapeHtml(item.name)}
                    </strong>

                    <small>
                      ${escapeHtml(
                        byId(
                          state.productionLooks,
                          item.productionLookId
                        )?.name || ''
                      )}
                    </small>
                  </div>

                  <span class="cue-icons">
                    ◉ ◇ ♪
                  </span>
                </button>
              `;
            })
            .join('')}
        </div>
      </aside>

      <section class="main-scroll refined-main">
        <div class="summary-row">
          <div class="panel current-summary refined-summary">
            <div class="cue-heading">
              <span class="eyebrow">
                CURRENT CUE
              </span>

              <h1>
                ${escapeHtml(cue?.name || 'No Cue')}
              </h1>

              <p>
                ${formatDuration(cue?.duration)} · ${escapeHtml(cue?.notes || 'No notes')}
              </p>
            </div>

            <div class="summary-metric">
              <span>TIME IN CUE</span>

              <strong id="cue-elapsed">
                ${formatElapsed(state.live.cueStartedAt)}
              </strong>

              <small>
                Started
                ${formatClock(state.live.cueStartedAt)}
              </small>
            </div>

            <div class="summary-metric">
              <span>SERVICE / REMAINING</span>
              <strong id="service-elapsed">${formatDuration(serviceTiming.serviceElapsed)} / ${formatDuration(serviceTiming.remaining)}</strong>
              <small>${serviceTiming.position} of ${serviceTiming.total || state.runOfService.length}</small>
            </div>

            <div class="summary-metric">
              <span>NEXT CUE</span>

              <strong>
                ${escapeHtml(
                  nextCue?.name || 'End of service'
                )}
              </strong>
              <small>${nextCue ? `${formatDuration(nextCue.duration)} · ${escapeHtml(nextLookDetails.name)} · 💡 ${escapeHtml(nextLookDetails.lighting)} (${escapeHtml(nextLookDetails.lightingSource)}) · 🎥 ${escapeHtml(nextLookDetails.programCamera)} / ${escapeHtml(nextLookDetails.previewCamera)} (${escapeHtml(nextLookDetails.cameraSource)}) · Motion ${escapeHtml(nextLookDetails.motion)} · ${escapeHtml(nextCue.notes || 'No notes')}` : ''}</small>
            </div>

            <div class="summary-metric">
              <span>LIGHTING</span>

              <strong>
                ${escapeHtml(lighting?.name || 'None')}
              </strong>
              <small>${escapeHtml(currentLookDetails.lightingSource)} · Fade ${currentLookDetails.lightingFadeMs || 0} ms · Stage ${escapeHtml(currentLookDetails.stageWashMode)} · Wall ${escapeHtml(currentLookDetails.wallWashMode)}</small>
            </div>

            <div class="summary-metric">
              <span>LOOK</span>

              <strong>
                ${escapeHtml(currentLookDetails.name)}
              </strong>
              <small>🎥 ${escapeHtml(currentLookDetails.programCamera)} / ${escapeHtml(currentLookDetails.previewCamera)} (${escapeHtml(currentLookDetails.cameraSource)}) · Layout ${escapeHtml(currentLookDetails.cameraLayout)} · 📍 ${escapeHtml(currentLookDetails.presets)} · Motion ${escapeHtml(currentLookDetails.motion)}</small>
              ${currentLookDetails.warnings?.length ? `<small class="device-error">⚠ ${escapeHtml(currentLookDetails.warnings.join('; '))}</small>` : ''}
            </div>
          </div>

          <div class="panel notes-card">
            <span class="eyebrow">
              NOTES
            </span>

            <p>
              ${escapeHtml(
                cue?.notes || 'No notes for this cue.'
              )}
            </p>
          </div>
        </div>

        <div class="camera-grid">
        ${liveCameraTiles().map(cameraCard).join('')}
        </div>

        <div class="panel quick-panel">
          <div class="section-title">
            <span>
              FAVORITE LIGHTING SCENES
            </span>
          </div>

          <div class="quick-grid">
            ${favorites
              .map(
                scene =>
                  `<button
                    data-lighting="${scene.id}"
                    class="${
                      state.live.lightingOverrideId === scene.id
                        ? 'selected'
                        : ''
                    }"
                  >
                    ${escapeHtml(scene.name)}
                  </button>`
              )
              .join('')}

            <button
              class="danger"
              data-lighting="light-blackout"
            >
              ⏻ BLACKOUT
            </button>
          </div>

          ${
            state.live.lightingOverrideId
              ? `<button
                  id="return-lighting"
                  class="return-button"
                >
                  Return to cue lighting
                </button>`
              : ''
          }
        </div>

        <div class="lower-grid">
          <section class="panel activity-panel">
            <div class="lower-title">
              <span>ACTIVITY LOG</span>
            </div>

            <div class="activity-list">
              ${
                activity.length
                  ? activity
                      .map(
                        item =>
                          `<div>
                            <time>
                              ${activityTime(item.at)}
                            </time>

                            <span>
                              ${escapeHtml(item.message)}
                            </span>
                          </div>`
                      )
                      .join('')
                  : `<p class="empty-state">
                      Activity will appear here as cues,
                      cameras, and lights are changed.
                    </p>`
              }
            </div>
          </section>

          <section class="panel status-panel">
            <div class="lower-title">
              <span>SYSTEM STATUS</span>
            </div>

            <div class="status-grid">
              ${liveCameraTiles()
                .map(
                  camera =>
                    `<div>
                      <i></i>

                      <strong>
                        ${escapeHtml(camera.name)}
                      </strong>

                      <small>Ready</small>
                    </div>`
                )
                .join('')}

              <div>
                <i></i>
                <strong>QLC+</strong>
                <small>Simulation</small>
              </div>

              <div>
                <i></i>
                <strong>ATEM</strong>
                <small>Simulation</small>
              </div>

              <div>
                <i></i>
                <strong>Streaming</strong>
                <small>Ready</small>
              </div>

              <div>
                <i></i>
                <strong>Network</strong>
                <small>Good</small>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  `);

  const timer = setInterval(() => {
    const element =
      document.getElementById('cue-elapsed');

    if (!element || page !== 'live') {
      clearInterval(timer);
      return;
    }

    element.textContent =
      formatElapsed(state.live.cueStartedAt);
    const serviceElement = document.getElementById('service-elapsed');
    const snapshot = timing();
    if (serviceElement) serviceElement.textContent = `${formatDuration(snapshot.serviceElapsed)} / ${formatDuration(snapshot.remaining)}`;
  }, 1000);

  document
    .querySelectorAll('[data-go-cue]')
    .forEach(button => {
      button.onclick = async () => {
        state = await activateCue(
          Number(button.dataset.goCue)
        );

        render();
      };
    });

  document.querySelectorAll('[data-take-live]').forEach(button => {
    button.onclick = async () => {
      try {
        state = await window.trinity.takeLive();
        render();
      } catch (error) {
        window.alert(error.message);
      }
    };
  });

  document
    .querySelectorAll('[data-camera-preset]')
    .forEach(select => {
      select.onchange = async () => {
        const cameraId =
  select.dataset.cameraPreset;

const camera =
  byId(state.cameras, cameraId);

/*
 * Every camera remembers its own most recently
 * selected preset.
 */
if (camera) {
  camera.lastPreset = select.value;
}

if (
  cameraId === state.live.programCamera
) {
  state.live.programPreset =
    select.value;
} else {
  state.live.previewCamera =
    cameraId;

  state.live.previewPreset =
    select.value;
}

        state.live.activityLog = [
          {
            at: Date.now(),
            message:
              `${
                byId(state.cameras, cameraId)?.name ||
                cameraId
              } preset: ${select.value}`
          },
          ...(state.live.activityLog || [])
        ].slice(0, 8);

        state =
          await window.trinity.saveState(state);

        render();
      };
    });

  document
    .querySelectorAll('[data-lighting]')
    .forEach(button => {
      button.onclick = async () => {
        state =
          await window.trinity.lightingOverride(
            button.dataset.lighting
          );

        render();
      };
    });

  const returnButton =
    document.getElementById('return-lighting');

  if (returnButton) {
    returnButton.onclick = async () => {
      state =
        await window.trinity.returnToCueLighting();

      render();
    };
  }
}

function cameraPreparation(cameraId) {
  return (state.live?.cameraPreparations || []).find(item => item.cameraId === cameraId) || {
    cameraId,
    selectedMode: 'static',
    selectedPresetId: null,
    selectedMotionId: null,
    preparationStatus: 'idle',
    tracking: { supported: false, active: false }
  };
}

function CameraModeSelector(camera, preparation) {
  const disabled = preparation.tracking?.active ? 'disabled' : '';
  return `<div class="camera-mode-selector" role="group" aria-label="Preparation mode for ${escapeHtml(camera.name)}">
    <button data-camera-mode="${camera.id}" data-mode="static" class="${preparation.selectedMode === 'static' ? 'selected' : ''}" ${disabled}>STATIC</button>
    <button data-camera-mode="${camera.id}" data-mode="motion" class="${preparation.selectedMode === 'motion' ? 'selected' : ''}" ${disabled}>MOTION</button>
  </div>`;
}

function CameraPreparationSelector(camera, preparation) {
  const disabled = preparation.tracking?.active ? 'disabled' : '';
  const choices = preparation.selectedMode === 'motion'
    ? (state.shots || []).filter(shot => shot.enabled !== false && (shot.cameraDeviceId === camera.id || (!shot.cameraDeviceId && shot.logicalCameraRole === camera.logicalRole)))
    : (state.cameraPresets || []).filter(preset => preset.enabled !== false && preset.cameraDeviceId === camera.id);
  const selected = preparation.selectedMode === 'motion' ? preparation.selectedMotionId : preparation.selectedPresetId;
  return `<label class="camera-preparation-selector">
    <span>${preparation.selectedMode === 'motion' ? 'Motion' : 'Preset'}</span>
    <select data-camera-preparation="${camera.id}" ${disabled}>
      <option value="">Choose ${preparation.selectedMode === 'motion' ? 'motion' : 'preset'}…</option>
      ${choices.map(choice => `<option value="${escapeHtml(choice.id)}" ${choice.id === selected ? 'selected' : ''}>${escapeHtml(choice.name)}</option>`).join('')}
    </select>
  </label>`;
}

function TrackingButton(camera, preparation) {
  if (!preparation.tracking?.supported) return '<span class="tracking-space" aria-hidden="true"></span>';
  return `<button data-camera-tracking="${camera.id}" data-active="${preparation.tracking.active ? 'true' : 'false'}" class="tracking-button ${preparation.tracking.active ? 'active' : ''}">
    ${preparation.tracking.active ? 'STOP TRACKING' : 'START TRACKING'}
  </button>`;
}

function MakeLiveButton(camera, isLive) {
  return `<button data-make-camera-live="${camera.id}" class="make-live-button ${isLive ? 'is-live' : ''}">
    ${isLive ? '● LIVE' : 'MAKE LIVE'}
  </button>`;
}

function PcMediaLiveCard() {
  return `<article class="simple-camera-card pc-media-card" data-media-card="pc-media">
    <header><strong>PC Media</strong><span>PREVIEW ONLY</span></header>
    <div class="simple-camera-preview pc-media-preview">
      <div class="lens">▣</div>
      <strong>PC MEDIA PREVIEW</strong>
      <small>Presentation and video source</small>
    </div>
    <div class="prepared-summary pc-media-summary">
      <span class="preparation-status ready">Available</span>
      <small>Preview-only source</small>
    </div>
    <div class="camera-mode-selector pc-media-mode" aria-hidden="true">
      <button class="selected" disabled>STATIC</button>
      <button disabled>MOTION</button>
    </div>
    <label class="camera-preparation-selector pc-media-source">
      <span>Source</span>
      <select disabled><option>PC Media</option></select>
    </label>
    <div class="camera-live-actions pc-media-actions">
      <span class="tracking-space" aria-hidden="true"></span>
      <button class="make-live-button" disabled>PREVIEW ONLY</button>
    </div>
  </article>`;
}

function CameraLiveCard(camera) {
  const preparation = cameraPreparation(camera.id);
  const isLive = state.live?.programCamera === camera.id;
  const statusLabels = {
    idle: 'Not prepared',
    preparing: 'Preparing',
    ready: 'Ready',
    running: 'Motion Running',
    complete: 'Complete',
    error: preparation.errorMessage || 'Error'
  };
  const preparedName = preparation.selectedMode === 'motion'
    ? preparation.preparedAssignment?.motionName
    : preparation.preparedAssignment?.presetName;
  return `<article class="simple-camera-card ${isLive ? 'live' : ''}" data-camera-card="${camera.id}">
    <header><strong>${escapeHtml(camera.name)}</strong><span>${isLive ? '● LIVE' : 'OFF AIR'}</span></header>
    <div class="simple-camera-preview">
      <div class="lens">◎</div>
      <strong>${isLive ? 'PROGRAM' : 'CAMERA PREVIEW'}</strong>
    </div>
    <div class="prepared-summary">
      <span class="preparation-status ${preparation.preparationStatus}">${escapeHtml(statusLabels[preparation.preparationStatus] || 'Idle')}</span>
      <small>${escapeHtml(preparedName || (preparation.selectedMode === 'motion' ? 'No motion selected' : 'No preset selected'))}</small>
    </div>
    ${CameraModeSelector(camera, preparation)}
    ${CameraPreparationSelector(camera, preparation)}
    <div class="camera-live-actions">
      ${TrackingButton(camera, preparation)}
      ${MakeLiveButton(camera, isLive)}
    </div>
  </article>`;
}

function livePage() {
  const favorites = (state.lightingScenes || []).filter(scene => scene.favorite).slice(0, 6);
  const cameras = liveCameraTiles().slice(0, 3);
  shell(`<div class="simple-live-layout">
    <aside class="panel simple-cue-panel">
      <div class="section-title"><span>ORDER OF SERVICE</span><strong>${state.runOfService.length} cues</strong></div>
      <div class="cue-scroll">
        ${state.runOfService.map((cue, index) => `<button class="cue-item ${index === state.live.cueIndex ? 'current' : index < state.live.cueIndex ? 'completed' : ''}" data-go-cue="${index}">
          <span class="cue-number">${index === state.live.cueIndex ? '▶' : index + 1}</span>
          <div><strong>${escapeHtml(cue.name)}</strong><small>${escapeHtml(cue.notes || '')}</small></div>
        </button>`).join('')}
      </div>
      <div class="simple-cue-controls">
        <button data-live-back>BACK</button>
        <button class="go-control" data-live-go>GO</button>
      </div>
    </aside>
    <section class="simple-live-main">
      <div class="camera-grid simple-camera-grid">${cameras.map(CameraLiveCard).join('')}${PcMediaLiveCard()}</div>
      <section class="panel quick-panel simple-lighting-panel">
        <div class="section-title"><span>FAVORITE LIGHTING</span><strong>${escapeHtml(activeLighting()?.name || 'None')}</strong></div>
        <div class="quick-grid">
          ${favorites.map(scene => `<button data-lighting="${scene.id}" class="${state.live.lightingOverrideId === scene.id ? 'selected' : ''}">${escapeHtml(scene.name)}</button>`).join('')}
          <button class="danger" data-lighting="light-blackout">⏻ BLACKOUT</button>
        </div>
        ${state.live.lightingOverrideId ? '<button id="return-lighting" class="return-button">Return to cue lighting</button>' : ''}
      </section>
    </section>
  </div>`);

  document.querySelectorAll('[data-go-cue]').forEach(button => {
    button.onclick = async () => { state = await activateCue(Number(button.dataset.goCue)); render(); };
  });
  document.querySelector('[data-live-go]').onclick = async () => { state = await window.trinity.nextCue(); render(); };
  document.querySelector('[data-live-back]').onclick = async () => { state = await window.trinity.previousCue(); render(); };
  document.querySelectorAll('[data-camera-mode]').forEach(button => {
    button.onclick = async () => { state = await window.trinity.setCameraMode(button.dataset.cameraMode, button.dataset.mode); render(); };
  });
  document.querySelectorAll('[data-camera-preparation]').forEach(select => {
    select.onchange = async () => {
      if (!select.value) return;
      try { state = await window.trinity.prepareCamera(select.dataset.cameraPreparation, select.value); render(); }
      catch (error) { window.alert(error.message); }
    };
  });
  document.querySelectorAll('[data-camera-tracking]').forEach(button => {
    button.onclick = async () => {
      state = await window.trinity.setCameraTracking(button.dataset.cameraTracking, button.dataset.active !== 'true');
      render();
    };
  });
  document.querySelectorAll('[data-make-camera-live]').forEach(button => {
    button.onclick = async () => { state = await window.trinity.makeCameraLive(button.dataset.makeCameraLive); render(); };
  });
  document.querySelectorAll('[data-lighting]').forEach(button => {
    button.onclick = async () => { state = await window.trinity.lightingOverride(button.dataset.lighting); render(); };
  });
  const returnButton = document.getElementById('return-lighting');
  if (returnButton) returnButton.onclick = async () => { state = await window.trinity.returnToCueLighting(); render(); };
}

function servicePage() {
  const categories = [...new Set(state.cueTemplates.map(template => template.category))];

  // Readiness must inspect the editable Production Look definition, not the
  // frozen executionSnapshot. TrinityLookView.summarize() intentionally returns
  // the snapshot for the cue that is currently live, but that snapshot does not
  // expose roleAssignments. Using it here caused whichever cue was live to be
  // falsely marked as missing all three camera presets.
  const validateCue = cue => {
    const look = byId(state.productionLooks, cue.productionLookId);
    const lighting = cueLighting(cue);
    const roleLabels = { main: 'Main', left: 'Left', right: 'Right' };
    const issues = [];
    const cameraDevices = (state.devices || []).filter(item => item.type === 'camera');
    const knownCameraIds = new Set(cameraDevices.map(item => item.id));
    const cameras = [
      ...cameraDevices,
      ...(state.cameras || []).filter(item => item?.id && !knownCameraIds.has(item.id))
    ];
    const presets = state.cameraPresets || [];

    const roleAssignments = Object.fromEntries(['main', 'left', 'right'].map(role => {
      const assignment = look?.cameraPresets?.[role] || {};
      const cameraId = assignment.cameraId || assignment.cameraDeviceId || '';
      const camera = cameras.find(item => item.id === cameraId);
      const preset = presets.find(item =>
        item.id === assignment.presetId &&
        (!cameraId || item.cameraDeviceId === cameraId)
      );
      return [role, { assignment, camera, preset }];
    }));

    const priorityCamera = look?.priorityCameraId
      ? cameras.find(item => item.id === look.priorityCameraId)
      : null;

    if (!look) {
      issues.push({ code: 'production-look', label: 'Production Look missing' });
    }
    if (!lighting) {
      issues.push({ code: 'lighting', label: 'Lighting scene missing' });
    }
    if (look) {
      for (const role of ['main', 'left', 'right']) {
        const resolved = roleAssignments[role];
        if (!resolved.assignment.cameraId && !resolved.assignment.cameraDeviceId) {
          issues.push({ code: `${role}-camera`, label: `${roleLabels[role]} camera missing` });
        } else if (!resolved.camera) {
          issues.push({ code: `${role}-camera`, label: `${roleLabels[role]} camera missing` });
        } else if (!resolved.assignment.presetId || !resolved.preset) {
          issues.push({ code: `${role}-preset`, label: `${roleLabels[role]} preset missing` });
        }
      }
      if (look.priorityCameraId && !priorityCamera) {
        issues.push({ code: 'priority-camera', label: 'Priority camera missing' });
      }
    }

    const summary = {
      roleAssignments,
      priorityCamera,
      cameraReady: ['main', 'left', 'right'].every(role =>
        Boolean(roleAssignments[role]?.camera && roleAssignments[role]?.preset)
      )
    };

    return { look, lighting, summary, issues, ready: issues.length === 0 };
  };

  const validations = state.runOfService.map(validateCue);
  const cueIssueCount = validations.filter(item => !item.ready).length;
  const issueCount = validations.reduce((total, item) => total + item.issues.length, 0);
  const missingLookCount = validations.filter(item => item.issues.some(issue => issue.code === 'production-look')).length;
  const missingLightingCount = validations.filter(item => item.issues.some(issue => issue.code === 'lighting')).length;
  const cameraIssueCount = validations.filter(item => item.issues.some(issue => /camera|preset/.test(issue.code))).length;

  const readinessLabel = issueCount === 0 ? 'Ready for service' : `${cueIssueCount} cue${cueIssueCount === 1 ? '' : 's'} need attention`;

  const cueCard = (cue, index) => {
    const validation = validations[index];
    const { look, lighting, summary, issues, ready } = validation;
    const cameraPresets = ['main', 'left', 'right']
      .map(role => summary.roleAssignments?.[role]?.preset?.name)
      .filter(Boolean)
      .join(' • ');

    return `
      <article
        class="service-cue-card ${index === state.live.cueIndex ? 'current' : ''} ${ready ? 'ready' : 'needs-attention'}"
        draggable="true"
        data-cue-index="${index}"
      >
        <div class="service-cue-number">${index === state.live.cueIndex ? '▶' : index + 1}</div>

        <div class="service-cue-copy">
          <div class="service-cue-title-row">
            <strong>${escapeHtml(cue.name || 'Untitled Cue')}</strong>
            <span class="cue-readiness ${ready ? 'ready' : 'warning'}">${ready ? 'READY' : 'CHECK'}</span>
          </div>
          <span class="service-cue-look">${escapeHtml(look?.name || 'Production Look missing')}</span>
          <div class="service-cue-meta">
            <span class="${lighting ? 'valid' : 'warning'}">💡 ${escapeHtml(lighting?.name || 'Lighting scene missing')}</span>
            <span class="${summary.cameraReady ? 'valid' : 'warning'}">📷 ${escapeHtml(cameraPresets || 'Camera presets incomplete')}</span>
          </div>
          ${issues.length ? `<div class="service-cue-issues">${issues.map(item => `<span>⚠ ${escapeHtml(item.label)}</span>`).join('')}</div>` : ''}
        </div>

        <div class="service-cue-actions">
          <button class="cue-go" data-go="${index}">GO</button>
          <button data-edit="${index}">EDIT</button>
          <button data-duplicate="${index}">COPY</button>
          <button class="cue-delete" data-remove="${index}" aria-label="Remove ${escapeHtml(cue.name || 'cue')}">DELETE</button>
        </div>
      </article>`;
  };

  shell(`
    <div class="service-workspace">
      <section class="panel service-order-panel">
        <div class="service-page-heading">
          <div>
            <h2>Order of Service</h2>
            <p>Drag cues to reorder. Edit any cue marked Check before the service.</p>
          </div>
          <span class="service-count-pill">${state.runOfService.length} cues</span>
        </div>

        <section class="service-readiness ${issueCount === 0 ? 'ready' : 'warning'}" aria-label="Service readiness">
          <div class="service-readiness-primary">
            <span>${issueCount === 0 ? '✓' : '⚠'}</span>
            <div>
              <strong>${escapeHtml(readinessLabel)}</strong>
              <small>${issueCount === 0 ? 'Every cue has a valid Production Look, lighting scene, and three camera presets.' : `${issueCount} total issue${issueCount === 1 ? '' : 's'} found across the service.`}</small>
            </div>
          </div>
          <div class="service-readiness-facts">
            <span><strong>${missingLookCount}</strong><small>Missing Looks</small></span>
            <span><strong>${missingLightingCount}</strong><small>Lighting Issues</small></span>
            <span><strong>${cameraIssueCount}</strong><small>Camera Issues</small></span>
          </div>
        </section>

        <div class="service-card-list">
          ${state.runOfService.map(cueCard).join('')}
        </div>
      </section>

      <aside class="panel service-add-panel">
        <div class="service-page-heading">
          <div>
            <h2>Add a Cue</h2>
            <p>Choose a prepared cue template.</p>
          </div>
        </div>
        <div class="template-grid">
          ${categories.map(category => state.cueTemplates
            .filter(template => template.category === category)
            .map(template => `
              <article class="template-card">
                <small>${escapeHtml(category)}</small>
                <h3>${escapeHtml(template.name)}</h3>
                <p>${escapeHtml(byId(state.productionLooks, template.productionLookId)?.name || 'Choose a Production Look after adding')}</p>
                <button data-template="${template.id}">ADD CUE</button>
              </article>`).join('')
          ).join('')}
        </div>
        <div class="service-help">The readiness summary checks Production Looks, lighting scenes, and Main, Left, and Right camera presets. Timers and countdowns are not used.</div>
      </aside>
    </div>
  `);

  document.querySelectorAll('[data-template]').forEach(button => {
    button.onclick = async () => {
      state = await window.trinity.addCueTemplate(button.dataset.template);
      render();
    };
  });

  document.querySelectorAll('[data-go]').forEach(button => {
    button.onclick = async event => {
      event.stopPropagation();
      state = await activateCue(Number(button.dataset.go));
      page = 'live';
      render();
    };
  });

  document.querySelectorAll('[data-edit]').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      openCueEditor(Number(button.dataset.edit));
    };
  });

  document.querySelectorAll('[data-duplicate]').forEach(button => {
    button.onclick = async event => {
      event.stopPropagation();
      state = await window.trinity.duplicateCue(Number(button.dataset.duplicate));
      render();
    };
  });

  document.querySelectorAll('[data-remove]').forEach(button => {
    button.onclick = async event => {
      event.stopPropagation();
      if (!window.confirm('Remove this cue from the service?')) return;
      try {
        state = await window.trinity.deleteCue(Number(button.dataset.remove));
        render();
      } catch (error) {
        window.alert(error.message);
      }
    };
  });

  let draggedIndex = null;
  document.querySelectorAll('.service-cue-card').forEach(card => {
    card.ondragstart = event => {
      draggedIndex = Number(card.dataset.cueIndex);
      card.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
    };
    card.ondragend = () => {
      draggedIndex = null;
      card.classList.remove('dragging');
      document.querySelectorAll('.service-cue-card').forEach(item => item.classList.remove('drop-before', 'drop-after'));
    };
    card.ondragover = event => {
      event.preventDefault();
      const rect = card.getBoundingClientRect();
      card.classList.toggle('drop-before', event.clientY < rect.top + rect.height / 2);
      card.classList.toggle('drop-after', event.clientY >= rect.top + rect.height / 2);
    };
    card.ondragleave = () => card.classList.remove('drop-before', 'drop-after');
    card.ondrop = async event => {
      event.preventDefault();
      if (draggedIndex === null) return;
      const targetIndex = Number(card.dataset.cueIndex);
      const rect = card.getBoundingClientRect();
      let destination = event.clientY < rect.top + rect.height / 2 ? targetIndex : targetIndex + 1;
      if (draggedIndex < destination) destination -= 1;
      if (destination !== draggedIndex) state = await window.trinity.reorderCue(draggedIndex, destination);
      render();
    };
  });
}

function looksPage() {
  if (!selectedLookId || !byId(state.productionLooks, selectedLookId)) selectedLookId = state.productionLooks[0]?.id || null;
  const selected = byId(state.productionLooks, selectedLookId);
  const filtered = state.productionLooks.filter(look => String(look.name || '').toLowerCase().includes(lookSearch.toLowerCase()));
  const roleCamera = role => (state.devices || []).find(device => device.type === 'camera' && (device.logicalRole === role || (role === 'main' && (device.id === 'main' || device.logicalRole === 'center'))));
  const selectedOption = (value, current) => value === current ? 'selected' : '';
  const lightingOptions = current => lightingScenePickerOptions(current, 'Not assigned');
  const presetEditor = role => {
    const label = role[0].toUpperCase() + role.slice(1);
    const camera = roleCamera(role);
    const assignment = selected?.cameraPresets?.[role] || {};
    const presets = camera ? (state.cameraPresets || []).filter(item => item.cameraDeviceId === camera.id && item.enabled !== false) : [];
    const selectedPreset = (state.cameraPresets || []).find(item => item.id === assignment.presetId && item.cameraDeviceId === camera?.id);
    const missing = assignment.presetId && (!selectedPreset || selectedPreset.cameraDeviceId !== assignment.cameraId);
    const empty = !camera ? `No ${label} camera configured` : !presets.length ? `No ${label} camera presets` : 'Not assigned';
    return `<label>${label} Camera Preset<select data-look-preset="${role}" ${camera ? '' : 'disabled'}><option value="">${empty}</option>${missing ? `<option value="${escapeHtml(assignment.presetId)}" selected>Missing preset reference</option>` : ''}${selectedPreset?.enabled === false && !missing ? `<option value="${selectedPreset.id}" selected>${escapeHtml(selectedPreset.name)} (Disabled)</option>` : ''}${presets.map(item => `<option value="${item.id}" ${selectedOption(item.id, assignment.presetId)}>${escapeHtml(item.name)}</option>`).join('')}</select><small>${camera ? escapeHtml(camera.name) : `No ${label} camera configured`}</small></label>`;
  };
  const priorityOptions = current => {
    const cameras = ['main', 'left', 'right'].map(role => ({ role, camera: roleCamera(role) })).filter(item => item.camera);
    const exists = cameras.some(item => item.camera.id === current);
    return `<option value="">Not assigned</option>${current && !exists ? `<option value="${escapeHtml(current)}" selected>Missing camera reference</option>` : ''}${cameras.map(({ role, camera }) => `<option value="${camera.id}" ${selectedOption(camera.id, current)}>${role[0].toUpperCase() + role.slice(1)} Camera — ${escapeHtml(camera.name)}</option>`).join('')}`;
  };
  const mainCamera = roleCamera('main');
  const trackingUnsupported = !mainCamera || mainCamera.trackingEnabled === false || mainCamera.metadata?.cameraManager?.capabilities?.tracking === 'unsupported';
  shell(`<div class="page-scroll"><div class="looks-workspace">
    <aside class="panel look-library"><div class="section-title"><span>PRODUCTION LOOKS</span><strong>${state.productionLooks.length} looks</strong></div>
      <div class="look-toolbar"><input id="look-search" value="${escapeHtml(lookSearch)}" placeholder="Search looks"><button id="look-create">NEW LOOK</button></div>
      <div class="look-list">${filtered.map(look => `<button class="look-list-item ${look.id === selectedLookId ? 'selected' : ''}" data-select-look="${look.id}"><strong>${escapeHtml(look.name)}</strong><span>${look.enabled === false ? 'Disabled' : 'Enabled'}</span></button>`).join('') || '<p class="empty-state">No matching looks.</p>'}</div>
    </aside>
    <section class="panel look-editor">${selected ? `<div class="look-editor-header"><div><span class="eyebrow">HOW SHOULD THIS CUE BEGIN?</span><h1>${escapeHtml(selected.name)}</h1></div><div class="row-actions"><button id="look-duplicate">DUPLICATE</button><button id="look-delete" class="danger">DELETE</button></div></div>
      <div class="look-sections simplified-look-form">
        <fieldset><legend>LOOK</legend><label>Look Name<input id="look-name" value="${escapeHtml(selected.name)}" required></label><label class="checkbox-label"><input type="checkbox" id="look-enabled" ${selected.enabled !== false ? 'checked' : ''}> Enabled</label><label>Lighting Scene<select id="look-lighting">${lightingOptions(selected.lightingSceneId)}</select>${byId(state.lightingScenes || [], selected.lightingSceneId)?.productionScene === false ? '<small class="look-warning">Scene is marked Utility but is still referenced.</small>' : ''}</label></fieldset>
        <fieldset><legend>CAMERA STARTING PRESETS</legend>${['main', 'left', 'right'].map(presetEditor).join('')}</fieldset>
        <fieldset><legend>STARTING LIVE CAMERA</legend><label>Priority Camera<select id="look-priority">${priorityOptions(selected.priorityCameraId)}</select></label><label class="checkbox-label"><input type="checkbox" id="look-main-tracking" ${selected.startMainTracking ? 'checked' : ''} ${trackingUnsupported ? 'disabled' : ''}> Start Main Camera Tracking</label>${trackingUnsupported ? `<small class="look-warning">${mainCamera ? 'Main camera tracking is not supported.' : 'No Main camera configured.'}</small>` : ''}</fieldset>
      </div>
      <div class="look-form-actions"><button id="look-cancel">CANCEL</button><button id="look-save" class="live-button">SAVE LOOK</button></div>` : '<div class="empty-state">Create a Production Look to begin.</div>'}</section>
  </div></div>`);

  document.getElementById('look-search').oninput = event => { lookSearch = event.target.value; looksPage(); document.getElementById('look-search')?.focus(); };
  document.getElementById('look-create').onclick = async () => { state = await window.trinity.createProductionLook({ name: 'New Production Look' }); selectedLookId = state.productionLooks.at(-1).id; render(); };
  document.querySelectorAll('[data-select-look]').forEach(button => button.onclick = () => { selectedLookId = button.dataset.selectLook; render(); });
  if (!selected) return;
  document.getElementById('look-duplicate').onclick = async () => {
    const previousIds = new Set((state.productionLooks || []).map(look => look.id));
    try {
      state = await window.trinity.duplicateProductionLook(selected.id);
      const duplicate = (state.productionLooks || []).find(look => !previousIds.has(look.id));
      selectedLookId = duplicate?.id || state.productionLooks.at(-1)?.id || selected.id;
      render();
    } catch (error) {
      window.alert(error.message);
    }
  };
  document.getElementById('look-cancel').onclick = () => render();
  document.getElementById('look-save').onclick = async () => {
    const cameraPresets = Object.fromEntries(['main', 'left', 'right'].map(role => {
      const presetId = document.querySelector(`[data-look-preset="${role}"]`)?.value || null;
      const camera = roleCamera(role);
      const preset = (state.cameraPresets || []).find(item => item.id === presetId && item.cameraDeviceId === camera?.id);
      return [role, {
        cameraId: camera?.id || selected.cameraPresets?.[role]?.cameraId || null,
        presetId: preset?.id || null
      }];
    }));
    try {
      state = await window.trinity.updateProductionLook(selected.id, {
        name: document.getElementById('look-name').value,
        enabled: document.getElementById('look-enabled').checked,
        lightingSceneId: document.getElementById('look-lighting').value || null,
        cameraPresets,
        priorityCameraId: document.getElementById('look-priority').value || null,
        startMainTracking: document.getElementById('look-main-tracking').checked
      });
      render();
    } catch (error) { window.alert(error.message); }
  };
  document.getElementById('look-delete').onclick = async () => {
    const references = state.runOfService.filter(cue => cue.productionLookId === selected.id);
    if (references.length && !window.confirm(`This Look is referenced by ${references.length} cue${references.length === 1 ? '' : 's'}. Delete it without changing those cue references?`)) return;
    state = await window.trinity.deleteProductionLook(selected.id, { confirmReferences: references.length > 0 });
    selectedLookId = state.productionLooks[0]?.id || null;
    render();
  };
}

function lightingPage() {
  const lightingDevice = (state.devices || []).find(device => device.type === 'lighting');
  const discoveredControls = lightingDevice?.metadata?.qlcplusWidgets || [];
  const productionPage = lightingDevice?.metadata?.qlcplusProductionPage || null;
  const allCompatibleControls = discoveredControls.filter(control => String(control.widgetType || '').toLocaleLowerCase() === 'button');
  const compatibleControls = productionPage
    ? allCompatibleControls.filter(control => control.pageName === productionPage)
    : allCompatibleControls;
  const selectedScene = byId(state.lightingScenes || [], selectedLightingSceneId);
  const productionScenes = (state.lightingScenes || []).filter(scene => scene.productionScene !== false);
  const utilityScenes = (state.lightingScenes || []).filter(scene => scene.productionScene === false);
  const filteredScenes = lightingSceneFilter === 'all'
    ? state.lightingScenes
    : lightingSceneFilter === 'utility' ? utilityScenes : productionScenes;
  const selectedLookReferences = selectedScene ? (state.productionLooks || []).filter(look => look.lightingSceneId === selectedScene.id) : [];
  const selectedCueReferences = selectedScene ? (state.runOfService || []).filter(cue => cueLightingId(cue) === selectedScene.id) : [];
  const selectedUtilityWarning = selectedScene?.productionScene === false && (selectedLookReferences.length || selectedCueReferences.length)
    ? 'Scene is marked Utility but is still referenced.'
    : null;
  const mapping = selectedScene?.externalControl || null;
  const mappedControl = mapping ? discoveredControls.find(control => String(control.widgetId) === String(mapping.widgetId)) : null;
  const suggestionMatches = selectedScene && !mapping ? compatibleControls.filter(control => normalizedLightingName(control.name) === normalizedLightingName(selectedScene.name)) : [];
  const suggestion = suggestionMatches.length === 1 ? suggestionMatches[0] : null;
  const mappingStatus = !lightingDevice || lightingDevice.adapterType !== 'qlcplus-websocket' ? 'Adapter not configured'
    : lightingDevice.metadata?.lightingDiagnostic?.ok !== true ? 'QLC+ unreachable'
    : mapping && !mappedControl ? 'Mapped control not currently discovered'
    : mapping && String(mappedControl.widgetType || '').toLocaleLowerCase() !== 'button' ? 'Mapped control is not a button'
    : mapping ? 'Mapped' : 'Not mapped';
  const visibleControls = showAllLightingControls ? discoveredControls : compatibleControls;
  const controlOption = control => `${control.name || 'Unnamed'} — ${control.widgetType || 'Unknown'} — ID ${control.widgetId}${control.status !== undefined ? ` — ${control.status}` : ''}`;
  const editor = selectedScene ? `<div class="settings-editor-backdrop"><section class="settings-editor panel" role="dialog" aria-modal="true">
    <div class="look-editor-header"><div><span class="eyebrow">LIGHTING SCENE</span><h1>${escapeHtml(selectedScene.name)}</h1></div><button id="lighting-editor-close">×</button></div>
    <div class="settings-form">
      <section class="wide panel"><span class="eyebrow">PRODUCTION SCENE</span>
        <label class="checkbox-label"><input type="checkbox" id="lighting-production-scene" ${selectedScene.productionScene !== false ? 'checked' : ''}> Use in Service Planning</label>
        <small>Production scenes are available in Service cues and can be executed during GO. Utility scenes remain available in the Lighting Library for manual recall.</small>
        ${selectedUtilityWarning ? `<p class="look-warning">${selectedUtilityWarning}</p>` : ''}
      </section>
      <section class="wide panel"><span class="eyebrow">QLC+ MAPPING</span>
        <p><strong>${escapeHtml(mappingStatus)}</strong> · ${discoveredControls.length} discovered · ${compatibleControls.length} compatible buttons${productionPage ? ` on ${escapeHtml(productionPage)}` : ''}</p>
        <label>Control<select id="lighting-control-mapping">
          <option value="">Not mapped</option>
          ${mapping && (!mappedControl || !visibleControls.some(control => String(control.widgetId) === String(mapping.widgetId))) ? `<option value="${escapeHtml(mapping.widgetId)}" selected>${mappedControl ? escapeHtml(controlOption(mappedControl)) : `Previously mapped control not found — Widget ID ${escapeHtml(mapping.widgetId)}`}</option>` : ''}
          ${visibleControls.map(control => `<option value="${escapeHtml(control.widgetId)}" ${String(mapping?.widgetId) === String(control.widgetId) ? 'selected' : ''}>${escapeHtml(controlOption(control))}</option>`).join('')}
        </select></label>
        <label class="checkbox-label"><input type="checkbox" id="lighting-show-all-controls" ${showAllLightingControls ? 'checked' : ''}> Show all controls for diagnostics</label>
        ${suggestion ? `<p>Suggested match: <strong>${escapeHtml(controlOption(suggestion))}</strong> <button id="lighting-use-suggestion" type="button">USE SUGGESTION</button></p>` : ''}
      </section>
    </div>
    <div class="settings-editor-actions"><button id="lighting-refresh-controls">REFRESH DISCOVERED CONTROLS</button><button id="lighting-clear-mapping">CLEAR MAPPING</button><button id="lighting-duplicate-scene">DUPLICATE</button><button id="lighting-save-mapping">SAVE</button></div>
  </section></div>` : '';
  shell(`
    <div class="page-scroll lighting-page-scroll">

      <section class="panel home-assistant-lighting-panel">
        <div class="section-title">
          <span>LIGHTING POWER</span>
          <strong id="ha-lighting-status">${homeAssistantStatus?.reachable ? (homeAssistantStatus.allOn ? 'ON' : homeAssistantStatus.anyOn ? 'PARTIAL' : 'OFF') : homeAssistantStatus?.configured ? 'OFFLINE' : 'NOT CONFIGURED'}</strong>
        </div>
        <div class="home-assistant-lighting-content">
          <div>
            <h2>Home Assistant Smart Outlets</h2>
            <p>${escapeHtml(homeAssistantStatus?.message || 'Checking Home Assistant connection…')}</p>
            <small>${escapeHtml((homeAssistantStatus?.entities || []).map(item => typeof item === 'string' ? item : `${item.friendlyName}: ${item.state}`).join(' · ') || 'Configure entities in home-assistant.config.json')}</small>
          </div>
          <div class="home-assistant-lighting-actions">
            <button id="ha-lighting-refresh" ${homeAssistantBusy ? 'disabled' : ''}>REFRESH</button>
            <button id="ha-lighting-off" class="danger" ${homeAssistantBusy || !homeAssistantStatus?.configured ? 'disabled' : ''}>POWER OFF</button>
            <button id="ha-lighting-on" class="success" ${homeAssistantBusy || !homeAssistantStatus?.configured ? 'disabled' : ''}>POWER ON</button>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="section-title">
          <span>LIGHTING LIBRARY</span>

          <strong>
            ${productionScenes.length} Production · ${utilityScenes.length} Utility · ${state.productionLooks.length} Looks · ${state.runOfService.length} Cues
          </strong>
        </div>
        <div class="look-toolbar"><select id="lighting-scene-filter"><option value="production" ${lightingSceneFilter === 'production' ? 'selected' : ''}>Production Scenes (${productionScenes.length})</option><option value="utility" ${lightingSceneFilter === 'utility' ? 'selected' : ''}>Utility Scenes (${utilityScenes.length})</option><option value="all" ${lightingSceneFilter === 'all' ? 'selected' : ''}>All Scenes (${state.lightingScenes.length})</option></select></div>

        <div class="card-grid lighting-scene-grid">
          ${filteredScenes
            .map(scene => {
              const lookReferences = (state.productionLooks || [])
                .filter(look => look.lightingSceneId === scene.id);
              const cueReferences = (state.runOfService || [])
                .filter(cue => cueLightingId(cue) === scene.id);
              const referenceNames = [
                ...lookReferences.map(look => look.name),
                ...cueReferences.map(cue => cue.name)
              ].filter((name, index, names) => name && names.indexOf(name) === index);
              const usageSummary = referenceNames.length
                ? referenceNames.slice(0, 3).map(escapeHtml).join(' · ') + (referenceNames.length > 3 ? ` · +${referenceNames.length - 3}` : '')
                : 'Not currently used';

              return `<article class="edit-card lighting-scene-card ${scene.favorite ? 'favorite' : ''} ${state.live?.lightingOverrideId === scene.id ? 'selected' : ''}" data-select-lighting="${scene.id}">
                <header class="lighting-scene-card-header">
                  <div>
                    <small>${escapeHtml(scene.category || 'Custom')} · <span class="scene-classification-badge ${scene.productionScene === false ? 'utility' : 'production'}">${scene.productionScene === false ? 'Utility' : 'Production'}</span></small>
                    <h2>${escapeHtml(scene.name)}</h2>
                  </div>
                  <button class="lighting-favorite-button" data-favorite-lighting="${scene.id}" title="${scene.favorite ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${scene.favorite ? 'Remove' : 'Add'} ${escapeHtml(scene.name)} ${scene.favorite ? 'from' : 'to'} favorites">${scene.favorite ? '★' : '☆'}</button>
                </header>

                <div class="metrics">
                  <span>Platform <b>${scene.platform}%</b></span>
                  <span>Fill <b>${scene.fill}%</b></span>
                  <span>House <b>${scene.house}%</b></span>
                  <span>Fade <b>${scene.fade}s</b></span>
                </div>

                <div class="lighting-scene-usage">
                  <div class="lighting-usage-counts">
                    <span><b>${lookReferences.length}</b> Look${lookReferences.length === 1 ? '' : 's'}</span>
                    <span><b>${cueReferences.length}</b> Cue${cueReferences.length === 1 ? '' : 's'}</span>
                  </div>
                  <small title="${escapeHtml(referenceNames.join(' · '))}">${usageSummary}</small>
                </div>
                <button data-edit-lighting="${scene.id}">EDIT</button>
              </article>`;
            })
            .join('') || '<p class="empty-state">No scenes in this classification.</p>'}
        </div>
      </section>
    </div>${editor}
  `);

  const refreshHomeAssistant = async () => {
    homeAssistantBusy = true;
    render();
    try {
      homeAssistantStatus = await window.trinity.getHomeAssistantStatus();
    } catch (error) {
      homeAssistantStatus = { configured: true, reachable: false, message: error.message, entities: [] };
    } finally {
      homeAssistantBusy = false;
      render();
    }
  };

  document.querySelector('#ha-lighting-refresh')?.addEventListener('click', refreshHomeAssistant);
  document.querySelector('#ha-lighting-on')?.addEventListener('click', async () => {
    homeAssistantBusy = true;
    render();
    try { homeAssistantStatus = await window.trinity.turnLightingPowerOn(); }
    catch (error) { window.alert(error.message); }
    finally { homeAssistantBusy = false; render(); }
  });
  document.querySelector('#ha-lighting-off')?.addEventListener('click', async () => {
    if (!window.confirm('Power off all configured lighting smart outlets?')) return;
    homeAssistantBusy = true;
    render();
    try { homeAssistantStatus = await window.trinity.turnLightingPowerOff(); }
    catch (error) { window.alert(error.message); }
    finally { homeAssistantBusy = false; render(); }
  });
  document.getElementById('lighting-scene-filter')?.addEventListener('change', event => {
    lightingSceneFilter = event.target.value;
    render();
  });

  document.querySelectorAll('[data-select-lighting]').forEach(card => {
    card.addEventListener('click', async event => {
      if (event.target.closest('[data-favorite-lighting], [data-edit-lighting]')) return;
      state = await window.trinity.lightingOverride(card.dataset.selectLighting);
      render();
    });
  });
  document.querySelectorAll('[data-favorite-lighting]').forEach(button => {
    button.addEventListener('click', async event => {
      event.stopPropagation();
      const sceneId = button.dataset.favoriteLighting;
      const scene = byId(state.lightingScenes, sceneId);
      if (!scene) return;
      state = await window.trinity.saveState({
        ...state,
        lightingScenes: state.lightingScenes.map(item => item.id === sceneId ? { ...item, favorite: !scene.favorite } : item)
      });
      render();
    });
  });
  document.querySelectorAll('[data-edit-lighting]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      selectedLightingSceneId = button.dataset.editLighting;
      showAllLightingControls = false;
      render();
    });
  });
  document.getElementById('lighting-editor-close')?.addEventListener('click', () => { selectedLightingSceneId = null; render(); });
  document.getElementById('lighting-show-all-controls')?.addEventListener('change', event => { showAllLightingControls = event.target.checked; render(); });
  document.getElementById('lighting-use-suggestion')?.addEventListener('click', () => {
    const select = document.getElementById('lighting-control-mapping');
    if (select && suggestion) select.value = String(suggestion.widgetId);
  });
  document.getElementById('lighting-clear-mapping')?.addEventListener('click', () => {
    const select = document.getElementById('lighting-control-mapping');
    if (select) select.value = '';
  });
  document.getElementById('lighting-refresh-controls')?.addEventListener('click', async () => {
    if (!lightingDevice) return;
    state = await window.trinity.discoverLightingControls(lightingDevice.id);
    render();
  });
  document.getElementById('lighting-save-mapping')?.addEventListener('click', async () => {
    const widgetId = document.getElementById('lighting-control-mapping')?.value || null;
    const control = discoveredControls.find(item => String(item.widgetId) === String(widgetId));
    const externalControl = widgetId ? {
      adapterType: 'qlcplus-websocket',
      widgetId,
      widgetName: control?.name || mapping?.widgetName || null,
      widgetType: control?.widgetType || mapping?.widgetType || null
    } : null;
    state = await window.trinity.updateLightingScene(selectedScene.id, {
      externalControl,
      productionScene: document.getElementById('lighting-production-scene').checked
    });
    render();
  });
  document.getElementById('lighting-duplicate-scene')?.addEventListener('click', async () => {
    const previous = new Set(state.lightingScenes.map(scene => scene.id));
    state = await window.trinity.duplicateLightingScene(selectedScene.id);
    selectedLightingSceneId = state.lightingScenes.find(scene => !previous.has(scene.id))?.id || null;
    render();
  });

  if (homeAssistantStatus === null && !homeAssistantBusy) {
    window.trinity.getHomeAssistantStatus()
      .then(status => { homeAssistantStatus = status; if (page === 'lighting') render(); })
      .catch(error => { homeAssistantStatus = { configured: true, reachable: false, message: error.message, entities: [] }; if (page === 'lighting') render(); });
  }

}

function camerasPage() {
  const roleOrder = { main: 0, left: 1, right: 2 };
  const cameraPriority = device => device.id === 'main' || device.logicalRole === 'main' || (device.logicalRole === 'center' && /\bmain\b/i.test(device.name)) ? 0 : roleOrder[device.logicalRole] ?? 3;
  const devices = (state.devices || []).filter(device => device.type === 'camera').sort((a, b) => cameraPriority(a) - cameraPriority(b));
  if (!selectedManagedCameraId || !devices.some(device => device.id === selectedManagedCameraId)) selectedManagedCameraId = devices[0]?.id || null;
  const selected = devices.find(device => device.id === selectedManagedCameraId);
  const managerMetadata = selected?.metadata?.cameraManager || {};
  const capabilityKeys = [['panTilt','Pan / tilt'],['zoom','Zoom'],['focus','Focus'],['presetRecall','Preset recall'],['presetSave','Preset save'],['tracking','Tracking'],['motion','Motion'],['tally','Tally'],['preview','Preview']];
  const capabilities = managerMetadata.capabilities || {};
  const inferredCapability = key => capabilities[key] || (['presetRecall','presetSave'].includes(key) && selected?.presetSupport ? 'supported' : ['tracking'].includes(key) && selected?.trackingEnabled ? 'supported' : ['motion'].includes(key) && selected?.motionEnabled ? 'supported' : selected?.protocol && ['panTilt','zoom'].includes(key) ? 'adapterRequired' : 'unknown');
  const allPresets = (state.cameraPresets || []).filter(preset => preset.cameraDeviceId === selected?.id);
  const categoryMap = new Map(suggestedPresetCategories.map(category => [category.toLowerCase(), category]));
  for (const preset of state.cameraPresets || []) {
    const category = preset.category || 'Utility';
    if (!categoryMap.has(category.toLowerCase())) categoryMap.set(category.toLowerCase(), category);
  }
  const categories = [...categoryMap.values()];
  const presets = allPresets.filter(preset => (!cameraPresetCategory || (preset.category || 'Utility').toLowerCase() === cameraPresetCategory.toLowerCase()) && (!cameraPresetSearch || `${preset.name} ${preset.category || 'Utility'}`.toLowerCase().includes(cameraPresetSearch.toLowerCase())));
  const currentPreset = allPresets.find(preset => preset.id === managerMetadata.currentPresetId);
  const diagnostic = selected?.metadata?.diagnostic;
  const readiness = !selected?.enabled ? 'Disabled' : !deviceConfigured(selected) ? 'Not configured' : diagnostic?.message || 'Adapter not implemented';
  const presetUsage = preset => {
    const looks = (state.productionLooks || []).filter(look => {
      const refs = [
        ...Object.values(look.roleAssignments || {}),
        ...Object.values(look.cameraPresets || {}),
        ...(look.cameraAssignments || [])
      ].filter(Boolean);
      return refs.some(ref => (ref.cameraId || ref.cameraDeviceId) === preset.cameraDeviceId && ref.presetId === preset.id);
    });
    const shots = (state.shots || []).filter(shot => shot.cameraDeviceId === preset.cameraDeviceId && shot.cameraPresetId === preset.id);
    const lookIds = new Set(looks.map(look => look.id));
    const cues = (state.runOfService || []).filter(cue => lookIds.has(cue.productionLookId || cue.lookId));
    return { looks, shots, cues };
  };
  const selectedPreset = (state.cameraPresets || []).find(preset => preset.id === selectedCameraPresetId);
  const cameraCard = device => {
    const devicePresets = (state.cameraPresets || []).filter(preset => preset.cameraDeviceId === device.id);
    const deviceShots = (state.shots || []).filter(shot => shot.cameraDeviceId === device.id || (!shot.cameraDeviceId && shot.logicalCameraRole === device.logicalRole));
    const favorites = devicePresets.filter(preset => preset.favorite && preset.enabled);
    const status = !device.enabled ? 'Disabled' : !deviceConfigured(device) ? 'Not configured' : device.metadata?.diagnostic?.message || 'Ready for adapter';
    const output = state.live?.programCamera === device.id ? 'PROGRAM' : state.live?.previewCamera === device.id ? 'PREVIEW' : 'STANDBY';
    return `<button class="managed-camera-card ${device.id === selected?.id ? 'selected' : ''}" data-managed-camera="${device.id}">
      <div class="managed-camera-card-top"><span class="role-pill">${escapeHtml(device.logicalRole || 'camera')}</span><span class="camera-output ${output.toLowerCase()}">${output}</span></div>
      <strong>${escapeHtml(device.name)}</strong>
      <small>${escapeHtml([device.manufacturer, device.model].filter(Boolean).join(' ') || 'Model not assigned')}</small>
      <span class="readiness">${escapeHtml(status)}</span>
      <div class="camera-card-counts"><span><b>${devicePresets.length}</b> presets</span><span><b>${favorites.length}</b> favorites</span><span><b>${deviceShots.length}</b> shots</span></div>
    </button>`;
  };
  const presetRow = (preset, index) => {
    const usage = presetUsage(preset);
    const usageNames = [...usage.looks.slice(0, 2).map(item => item.name), ...usage.shots.slice(0, 1).map(item => item.name)].filter(Boolean);
    return `<div class="preset-row ${preset.enabled ? '' : 'disabled'}">
      <button class="favorite-button" data-favorite-preset="${preset.id}" title="Favorite">${preset.favorite ? '★' : '☆'}</button>
      <div class="preset-primary"><strong>${escapeHtml(preset.name)}</strong><small>${escapeHtml(preset.category || 'Utility')} · Preset ${preset.presetNumber ?? '—'}${preset.enabled ? '' : ' · Disabled'}</small></div>
      <div class="preset-usage"><small>USED BY</small><strong>${usage.looks.length} Look${usage.looks.length === 1 ? '' : 's'} · ${usage.shots.length} Shot${usage.shots.length === 1 ? '' : 's'} · ${usage.cues.length} Cue${usage.cues.length === 1 ? '' : 's'}</strong>${usageNames.length ? `<span>${usageNames.map(escapeHtml).join(' · ')}</span>` : '<span>Not currently referenced</span>'}</div>
      <div class="preset-actions"><button data-edit-preset="${preset.id}">EDIT</button><button data-duplicate-preset="${preset.id}">DUPLICATE</button><button data-move-preset="${preset.id}" data-direction="-1" ${index === 0 ? 'disabled' : ''}>↑</button><button data-move-preset="${preset.id}" data-direction="1" ${index === presets.length - 1 ? 'disabled' : ''}>↓</button><button class="danger" data-delete-preset="${preset.id}">DELETE</button></div>
    </div>`;
  };
  const selectedPresetCamera = devices.find(device => device.id === selectedPreset?.cameraDeviceId);
  const copyTargets = devices.filter(device => device.id !== selectedPreset?.cameraDeviceId && device.enabled !== false);
  const presetEditor = selectedPreset ? `<div class="settings-editor-backdrop"><section class="settings-editor panel camera-preset-editor" role="dialog" aria-modal="true">
    <div class="look-editor-header"><div><span class="eyebrow">CAMERA-SCOPED PRESET</span><h1>${escapeHtml(selectedPreset.name)}</h1><p>${escapeHtml(selectedPresetCamera?.name || 'Unknown camera')} · Identity is camera + preset ID</p></div><button id="preset-editor-close">×</button></div>
    <div class="camera-preset-editor-grid">
      <div class="settings-form camera-preset-form">
        <label class="wide">Preset Name<input data-preset-field="name" value="${escapeHtml(selectedPreset.name)}"></label>
        <label>Preset Number<input type="number" min="0" data-preset-field="presetNumber" value="${selectedPreset.presetNumber ?? ''}"></label>
        <label>Category<select id="preset-category-editor">${categories.map(category => `<option value="${escapeHtml(category)}" ${(selectedPreset.category || 'Utility').toLowerCase() === category.toLowerCase() ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}<option value="__custom__">Custom…</option></select></label>
        <label class="wide">Custom Category<input id="preset-custom-category" value="${escapeHtml(selectedPreset.category && !suggestedPresetCategories.some(category => category.toLowerCase() === selectedPreset.category.toLowerCase()) ? selectedPreset.category : '')}" placeholder="Type a custom category"></label>
        <label class="checkbox-label"><input type="checkbox" data-preset-field="favorite" ${selectedPreset.favorite ? 'checked' : ''}> Favorite preset</label>
        <label class="checkbox-label"><input type="checkbox" data-preset-field="enabled" ${selectedPreset.enabled ? 'checked' : ''}> Enabled</label>
        <label class="wide">Notes<textarea data-preset-field="notes">${escapeHtml(selectedPreset.notes || '')}</textarea></label>
      </div>
      <aside class="camera-preset-summary">
        <span class="eyebrow">PRESET SUMMARY</span>
        <div><small>Camera</small><strong>${escapeHtml(selectedPresetCamera?.name || 'Missing camera')}</strong></div>
        <div><small>Role</small><strong>${escapeHtml(selectedPresetCamera?.logicalRole || selectedPreset.logicalRole || 'camera')}</strong></div>
        <div><small>Category</small><strong>${escapeHtml(selectedPreset.category || 'Utility')}</strong></div>
        <div><small>Used by</small><strong>${(state.shots || []).filter(shot => shot.cameraDeviceId === selectedPreset.cameraDeviceId && shot.cameraPresetId === selectedPreset.id).length} Shot${(state.shots || []).filter(shot => shot.cameraDeviceId === selectedPreset.cameraDeviceId && shot.cameraPresetId === selectedPreset.id).length === 1 ? '' : 's'}</strong></div>
        <div class="copy-preset-panel">
          <small>COPY THIS PRESET TO ANOTHER CAMERA</small>
          ${copyTargets.length ? `<select id="copy-preset-target">${copyTargets.map(device => `<option value="${escapeHtml(device.id)}">${escapeHtml(device.name)} (${escapeHtml(device.logicalRole || 'camera')})</option>`).join('')}</select><button id="copy-preset-to-camera">COPY TO CAMERA</button>` : '<p>No other enabled cameras are available.</p>'}
          <p>The copied preset keeps the name and category, but receives a new camera-scoped ID.</p>
        </div>
      </aside>
    </div><div class="settings-editor-actions"><span>Changes save immediately. Hardware recall will be enabled when the camera adapter is connected.</span><button id="preset-editor-done">DONE</button></div>
  </section></div>` : '';

  const cameraRefs = selected ? cameraReferenceSummary(selected.id) : { total: 0, counts: {} };
  shell(`<div class="camera-manager page-scroll">
    <div class="camera-manager-heading"><div><span class="eyebrow">CAMERA PRESET MANAGER</span><h1>Cameras</h1><p>Select a camera, manage its presets, and see where each preset is used.</p></div><button id="configure-camera-device">CAMERA SETTINGS</button></div>
    <div class="managed-camera-strip">${devices.map(cameraCard).join('')}</div>
    ${selected ? `<div class="camera-detail-grid camera-preset-dashboard">
      <section class="panel camera-overview"><div class="section-title"><span>SELECTED CAMERA</span><strong>${escapeHtml(selected.name)}</strong></div>
        <div class="camera-overview-grid"><div><small>STATUS</small><strong>${escapeHtml(readiness)}</strong></div><div><small>MODEL</small><strong>${escapeHtml([selected.manufacturer, selected.model].filter(Boolean).join(' ') || 'Not assigned')}</strong></div><div><small>CURRENT PRESET</small><strong>${escapeHtml(currentPreset?.name || 'Unknown')}</strong></div><div><small>OUTPUT</small><strong>${state.live?.programCamera === selected.id ? 'PROGRAM' : state.live?.previewCamera === selected.id ? 'PREVIEW' : 'Standby'}</strong></div></div>
        <div class="row-actions"><button id="run-camera-diagnostic">RUN DIAGNOSTIC</button><button id="camera-settings-link">OPEN CAMERA SETTINGS</button></div>
      </section>
      <section class="panel preset-panel"><div class="section-title"><span>PRESET LIBRARY</span><strong>${allPresets.length} presets for ${escapeHtml(selected.name)}</strong></div>
        <div class="preset-toolbar"><input id="preset-search" value="${escapeHtml(cameraPresetSearch)}" placeholder="Search presets"><select id="preset-category"><option value="">All categories</option>${categories.map(category => `<option ${cameraPresetCategory === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select><button id="create-preset">CREATE PRESET</button></div><div class="preset-quick-filters"><button data-preset-quick-filter="" class="${cameraPresetCategory ? '' : 'selected'}">ALL</button>${['Platform','Pulpit','Congregation','Worship','Utility'].map(category => `<button data-preset-quick-filter="${category}" class="${cameraPresetCategory.toLowerCase() === category.toLowerCase() ? 'selected' : ''}">${category.toUpperCase()}</button>`).join('')}</div>
        <div class="preset-list">${presets.length ? presets.map(presetRow).join('') : '<div class="empty-state">No matching presets. Create an operational name such as Pastor Tight or Main Wide.</div>'}</div>
      </section>
      <details class="panel camera-advanced"><summary><span><b>Advanced Camera Management</b><small>Rename, duplicate, disable, or delete ${escapeHtml(selected.name)}</small></span><span class="advanced-chevron">▾</span></summary><div class="camera-advanced-body"><div><p>These actions are rarely needed. Deleting a camera preserves ${cameraRefs.total} existing reference${cameraRefs.total === 1 ? '' : 's'} as missing references.</p><div class="camera-reference-summary">${Object.entries(cameraRefs.counts).filter(([,count]) => count).map(([label,count]) => `<span>${escapeHtml(label)} <b>${count}</b></span>`).join('') || '<span>No current references</span>'}</div></div><div class="danger-zone-actions"><button id="camera-rename">RENAME / EDIT</button><button id="camera-duplicate">DUPLICATE</button><button id="camera-toggle">${selected.enabled ? 'DISABLE' : 'ENABLE'}</button><button class="danger" id="camera-delete">DELETE CAMERA</button></div></div></details>
    </div>` : '<div class="empty-state">No camera devices configured.</div>'}
  </div>${presetEditor}`);

  document.querySelectorAll('[data-managed-camera]').forEach(button => button.onclick = () => { selectedManagedCameraId = button.dataset.managedCamera; selectedCameraPresetId = null; render(); });
  document.getElementById('configure-camera-device')?.addEventListener('click', () => { page = 'settings'; settingsSection = 'cameras'; selectedDeviceId = selected?.id || null; render(); });
  document.getElementById('camera-settings-link')?.addEventListener('click', () => { page = 'settings'; settingsSection = 'cameras'; selectedDeviceId = selected.id; render(); });
  document.getElementById('camera-rename')?.addEventListener('click', () => { page = 'settings'; settingsSection = 'cameras'; selectedDeviceId = selected.id; render(); });
  document.getElementById('camera-duplicate')?.addEventListener('click', async () => { state = await window.trinity.duplicateDevice(selected.id); selectedManagedCameraId = state.devices.filter(device => device.type === 'camera').at(-1)?.id || selected.id; render(); });
  document.getElementById('camera-toggle')?.addEventListener('click', async () => { state = await window.trinity.updateDevice(selected.id, { enabled: !selected.enabled }); render(); });
  document.getElementById('camera-delete')?.addEventListener('click', () => confirmAndDeleteCamera(selected.id, { returnToCameraManager: true }));
  document.getElementById('run-camera-diagnostic')?.addEventListener('click', async () => { state = await window.trinity.testDevice(selected.id); render(); });
  document.getElementById('preset-search')?.addEventListener('input', event => { cameraPresetSearch = event.target.value; render(); });
  document.getElementById('preset-category')?.addEventListener('change', event => { cameraPresetCategory = event.target.value; render(); });
  document.querySelectorAll('[data-preset-quick-filter]').forEach(button => button.addEventListener('click', () => { cameraPresetCategory = button.dataset.presetQuickFilter; render(); }));
  document.getElementById('create-preset')?.addEventListener('click', async () => { state = await window.trinity.createCameraPreset({ name: 'New Preset', cameraDeviceId: selected.id, logicalRole: selected.logicalRole, category: null, enabled: true }); selectedCameraPresetId = state.cameraPresets.at(-1).id; render(); });
  document.querySelectorAll('[data-edit-preset]').forEach(button => button.onclick = () => { selectedCameraPresetId = button.dataset.editPreset; render(); });
  document.querySelectorAll('[data-duplicate-preset]').forEach(button => button.onclick = async () => { state = await window.trinity.duplicateCameraPreset(button.dataset.duplicatePreset); render(); });
  document.querySelectorAll('[data-favorite-preset]').forEach(button => button.onclick = async () => { const preset = byId(state.cameraPresets, button.dataset.favoritePreset); state = await window.trinity.updateCameraPreset(preset.id, { favorite: !preset.favorite }); render(); });
  document.querySelectorAll('[data-move-preset]').forEach(button => button.onclick = async () => { const preset = byId(state.cameraPresets, button.dataset.movePreset); const ordered = (state.cameraPresets || []).filter(item => item.cameraDeviceId === selected.id); const from = ordered.findIndex(item => item.id === preset.id); state = await window.trinity.reorderCameraPreset(selected.id, from, from + Number(button.dataset.direction)); render(); });
  document.querySelectorAll('[data-delete-preset]').forEach(button => button.onclick = async () => {
    const preset = byId(state.cameraPresets, button.dataset.deletePreset);
    const references = [...(state.productionLooks || []).flatMap(look => [...Object.values(look.cameraPresets || {}), ...(look.cameraAssignments || [])].filter(item => item.presetId === preset.id)), ...(state.runOfService || []).filter(cue => [cue.cameraPresetId, cue.presetId].includes(preset.id)), ...(state.shots || []).filter(shot => shot.cameraPresetId === preset.id)];
    const confirmReferences = references.length ? window.confirm(`${preset.name} has ${references.length} reference${references.length === 1 ? '' : 's'}. Delete and preserve missing references?`) : window.confirm(`Delete ${preset.name}?`);
    if (!confirmReferences) return;
    state = await window.trinity.deleteCameraPreset(preset.id, { confirmReferences: references.length > 0 }); render();
  });
  document.querySelectorAll('[data-preset-field]').forEach(input => input.onchange = async () => { const field = input.dataset.presetField; let value = input.type === 'checkbox' ? input.checked : input.value; if (field === 'presetNumber') value = value === '' ? null : Number(value); state = await window.trinity.updateCameraPreset(selectedPreset.id, { [field]: value }); render(); });
  document.getElementById('preset-category-editor')?.addEventListener('change', async event => {
    if (event.target.value === '__custom__') return document.getElementById('preset-custom-category')?.focus();
    state = await window.trinity.updateCameraPreset(selectedPreset.id, { category: event.target.value });
    render();
  });
  document.getElementById('preset-custom-category')?.addEventListener('change', async event => {
    const category = event.target.value.trim();
    if (!category) return;
    state = await window.trinity.updateCameraPreset(selectedPreset.id, { category });
    render();
  });
  document.getElementById('preset-editor-close')?.addEventListener('click', () => { selectedCameraPresetId = null; render(); });
  document.getElementById('copy-preset-to-camera')?.addEventListener('click', async () => {
    const targetCameraId = document.getElementById('copy-preset-target')?.value;
    const targetCamera = devices.find(device => device.id === targetCameraId);
    if (!targetCamera) return;
    const sameName = (state.cameraPresets || []).find(preset => preset.cameraDeviceId === targetCamera.id && preset.name.trim().toLowerCase() === selectedPreset.name.trim().toLowerCase());
    if (sameName && !window.confirm(`${targetCamera.name} already has a preset named ${selectedPreset.name}. Create another camera-scoped copy?`)) return;
    state = await window.trinity.createCameraPreset({
      name: selectedPreset.name,
      cameraDeviceId: targetCamera.id,
      logicalRole: targetCamera.logicalRole,
      category: selectedPreset.category || 'Utility',
      presetNumber: null,
      favorite: selectedPreset.favorite,
      enabled: selectedPreset.enabled,
      notes: selectedPreset.notes || ''
    });
    selectedManagedCameraId = targetCamera.id;
    selectedCameraPresetId = state.cameraPresets.at(-1)?.id || null;
    render();
  });
  document.getElementById('preset-editor-done')?.addEventListener('click', () => { selectedCameraPresetId = null; render(); });
}

function shotResolution(shot) {
  const cameras = (state.devices || []).filter(device => device.type === 'camera');
  const requested = byId(cameras, shot.cameraDeviceId);
  const byRole = cameras.find(camera => camera.logicalRole === shot.logicalCameraRole && camera.enabled);
  const camera = requested?.enabled ? requested : byRole || requested || null;
  const requestedPreset = byId(state.cameraPresets || [], shot.cameraPresetId);
  const preset = requestedPreset?.cameraDeviceId === camera?.id ? requestedPreset : null;
  let readiness = 'Ready';
  if (!camera) readiness = 'Missing camera';
  else if (!camera.enabled) readiness = 'Camera disabled';
  else if (shot.cameraPresetId && !requestedPreset) readiness = 'Missing preset';
  else if (requestedPreset && requestedPreset.cameraDeviceId !== camera.id) readiness = 'Preset/camera mismatch';
  else if (preset && !preset.enabled) readiness = 'Preset disabled';
  else if (!camera.ipAddress || !camera.protocol) readiness = 'Configuration incomplete';
  return { camera, preset, readiness };
}

function shotReferenceSummary(shotId) {
  const counts = { 'Production Looks': 0, Cues: 0, Templates: 0, 'Motion Studio': 0 };
  for (const look of state.productionLooks || []) {
    if (look.selectedShotId === shotId) counts['Production Looks'] += 1;
    counts['Production Looks'] += (look.cameraAssignments || []).filter(item => item.shotId === shotId).length;
  }
  counts.Cues = (state.runOfService || []).filter(cue => [cue.shotId, cue.selectedShotId].includes(shotId)).length;
  counts.Templates = (state.cueTemplates || []).filter(template => [template.shotId, template.selectedShotId].includes(shotId)).length;
  counts['Motion Studio'] = (state.motionStudioReferences || []).filter(item => item.shotId === shotId).length;
  return { counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
}

function shotsPage() {
  const shots = state.shots || [];
  if (!selectedShotId || !byId(shots, selectedShotId)) selectedShotId = shots[0]?.id || null;
  const selected = byId(shots, selectedShotId);
  const categories = new Map(suggestedShotCategories.map(category => [category.toLowerCase(), category]));
  for (const shot of shots) {
    const category = shot.category || 'Utility';
    if (!categories.has(category.toLowerCase())) categories.set(category.toLowerCase(), category);
  }
  const cameras = (state.devices || []).filter(device => device.type === 'camera');
  const filtered = shots.filter(shot =>
    (!shotSearch || `${shot.name} ${shot.description || ''} ${shot.subject || ''} ${shot.framingType || ''} ${(shot.tags || []).join(' ')}`.toLowerCase().includes(shotSearch.toLowerCase())) &&
    (!shotCategory || (shot.category || 'Utility').toLowerCase() === shotCategory.toLowerCase()) &&
    (!shotCamera || shot.cameraDeviceId === shotCamera || shot.logicalCameraRole === shotCamera) &&
    (!shotFavorite || String(shot.favorite) === shotFavorite) &&
    (!shotEnabled || String(shot.enabled) === shotEnabled)
  );
  const options = (items, current, empty) => `<option value="">${empty}</option>${items.map(item => `<option value="${item.id}" ${item.id === current ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
  const card = shot => {
    const resolved = shotResolution(shot);
    const index = shots.indexOf(shot);
    return `<article class="shot-card ${shot.id === selectedShotId ? 'selected' : ''} ${shot.enabled ? '' : 'disabled'}" data-select-shot="${shot.id}">
      <div><span>${shot.favorite ? '★' : escapeHtml(shot.icon || '◎')}</span><strong>${escapeHtml(shot.name)}</strong><em>${escapeHtml(resolved.readiness)}</em></div>
      <small>${escapeHtml(shot.category || 'Utility')} · ${escapeHtml([shot.subject, shot.framingType].filter(Boolean).join(' · ') || 'Framing not assigned')}</small>
      <small>Camera: ${escapeHtml(resolved.camera?.name || 'Not assigned')} · Preset: ${escapeHtml(resolved.preset?.name || (shot.cameraPresetId ? 'Missing preset' : 'Not assigned'))}</small>
      <small>Tracking: ${shot.trackingPreferred ? 'Preferred' : escapeHtml(shot.trackingMode || 'Off')} · Motion: ${shot.motionEnabled ? 'On' : 'Off'}</small>
      <span class="shot-order-controls"><button data-move-shot="${shot.id}" data-direction="-1" ${index === 0 ? 'disabled' : ''}>↑</button><button data-move-shot="${shot.id}" data-direction="1" ${index === shots.length - 1 ? 'disabled' : ''}>↓</button></span>
    </article>`;
  };
  const resolved = selected ? shotResolution(selected) : null;
  const selectedType = selected?.shotType || 'static';
  const selectedCameraId = selected?.cameraDeviceId || resolved?.camera?.id || null;
  const scopedPresets = cameraScopedPresets(state.cameraPresets, selectedCameraId);
  const textField = (label, name, value = '') => `<label>${label}<input data-shot-field="${name}" value="${escapeHtml(value ?? '')}"></label>`;
  const presetOptions = (current, empty) => {
    const currentPreset = scopedPresets.find(item => item.id === current);
    return `<option value="">${empty}</option>${current && !currentPreset ? `<option value="${escapeHtml(current)}" selected>Missing or assigned to another camera</option>` : ''}${scopedPresets.map(item => `<option value="${item.id}" ${item.id === current ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
  };
  const motionSpeedOptions = [
    ['verySlow', 'Very Slow'],
    ['slow', 'Slow'],
    ['medium', 'Medium'],
    ['fast', 'Fast']
  ].map(([value, label]) => `<option value="${value}" ${(selected?.motionSpeedSetting || 'medium') === value ? 'selected' : ''}>${label}</option>`).join('');
  const editor = selected ? `<div class="shot-editor">
    <div class="shot-editor-heading"><div><span class="eyebrow">SHOT DETAILS</span><h1>${escapeHtml(selected.name)}</h1><p>${escapeHtml(resolved.readiness)}</p></div><div class="row-actions"><button id="shot-save" class="live-button">SAVE</button><button id="shot-duplicate">DUPLICATE</button><button id="shot-toggle">${selected.enabled ? 'DISABLE' : 'ENABLE'}</button><button class="danger" id="shot-delete">DELETE</button></div></div>
    <div class="shot-section-grid">
      <fieldset><legend>OVERVIEW</legend>${textField('Name','name',selected.name)}${textField('Description','description',selected.description)}<label>Shot Type<select data-shot-field="shotType"><option value="static" ${(selected.shotType || 'static') === 'static' ? 'selected' : ''}>Static</option><option value="motion" ${selected.shotType === 'motion' ? 'selected' : ''}>Motion</option><option value="tracking" ${selected.shotType === 'tracking' ? 'selected' : ''}>Tracking</option></select></label><label>Category<input data-shot-field="category" list="shot-categories" value="${escapeHtml(selected.category || '')}"><datalist id="shot-categories">${[...categories.values()].map(category => `<option value="${escapeHtml(category)}">`).join('')}</datalist></label>${textField('Tags','tags',(selected.tags || []).join(', '))}<label class="checkbox-label"><input type="checkbox" data-shot-field="favorite" ${selected.favorite ? 'checked' : ''}> Favorite</label><label class="checkbox-label"><input type="checkbox" data-shot-field="enabled" ${selected.enabled ? 'checked' : ''}> Enabled</label></fieldset>
      <fieldset><legend>CAMERA TARGET</legend><label>Camera<select data-shot-field="cameraDeviceId">${options(cameras, selected.cameraDeviceId, 'Resolve by role')}</select><small>${escapeHtml(resolved.camera?.name || (selected.cameraDeviceId ? 'Selected camera is missing' : 'No specific camera selected'))}</small></label><label>${selectedType === 'static' ? 'Preset' : selectedType === 'motion' ? 'Start Preset' : 'Starting Preset'}<select data-shot-field="cameraPresetId">${presetOptions(selected.cameraPresetId, 'No preset')}</select><small>${escapeHtml(resolved.preset?.name || (selected.cameraPresetId ? 'Selected preset is missing or does not match the camera' : 'No preset selected'))}</small></label>${selectedType === 'motion' ? `<label>End Preset<select data-shot-field="motionEndPresetId">${presetOptions(selected.motionEndPresetId, 'No end preset')}</select></label><label>Speed<select data-shot-field="motionSpeedSetting">${motionSpeedOptions}</select></label>` : ''}${selectedType === 'tracking' ? `<label class="checkbox-label"><input type="checkbox" data-shot-field="trackingPreferred" ${selected.trackingPreferred ? 'checked' : ''}> Enable Tracking</label>` : ''}<div class="resolved-shot"><em>${escapeHtml(resolved.readiness)}</em></div></fieldset>
    </div>
    <details class="advanced-camera-notes"><summary>ADVANCED CAMERA NOTES</summary><div class="advanced-camera-notes-grid">
      ${textField('Logical camera role','logicalCameraRole',selected.logicalCameraRole)}
      ${textField('Subject','subject',selected.subject)}
      ${textField('Framing type','framingType',selected.framingType)}
      ${textField('Composition','composition',selected.composition)}
      ${textField('Orientation','orientation',selected.orientation)}
      ${textField('Safe area','safeArea',selected.safeArea)}
      <label>Framing notes<textarea data-shot-field="framingNotes">${escapeHtml(selected.framingNotes || '')}</textarea></label>
      <label>Color<input type="color" data-shot-field="color" value="${escapeHtml(selected.color || '#4da9ff')}"></label>
      ${textField('Icon','icon',selected.icon)}
      <label>Operator notes<textarea data-shot-field="operatorNotes">${escapeHtml(selected.operatorNotes || '')}</textarea></label>
      ${textField('Thumbnail reference','thumbnailReference',selected.thumbnailReference)}
    </div></details>
  </div>` : '<div class="empty-state">Create a Shot to begin.</div>';

  shell(`<div class="shot-library page-scroll"><aside class="panel shot-sidebar"><div class="section-title"><span>SHOT LIBRARY</span><strong>${shots.length} reusable Shots</strong></div><div class="shot-filters"><input id="shot-search" value="${escapeHtml(shotSearch)}" placeholder="Search Shots"><select id="shot-category"><option value="">All categories</option>${[...categories.values()].map(category => `<option ${shotCategory === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select><select id="shot-camera"><option value="">All cameras / roles</option>${cameras.map(camera => `<option value="${camera.id}" ${shotCamera === camera.id ? 'selected' : ''}>${escapeHtml(camera.name)}</option>`).join('')}${[...new Set(cameras.map(camera => camera.logicalRole).filter(Boolean))].map(role => `<option value="${escapeHtml(role)}" ${shotCamera === role ? 'selected' : ''}>Role: ${escapeHtml(role)}</option>`).join('')}</select><select id="shot-favorite"><option value="">All favorites</option><option value="true" ${shotFavorite === 'true' ? 'selected' : ''}>Favorites only</option></select><select id="shot-enabled"><option value="">Enabled and disabled</option><option value="true" ${shotEnabled === 'true' ? 'selected' : ''}>Enabled</option><option value="false" ${shotEnabled === 'false' ? 'selected' : ''}>Disabled</option></select><button id="shot-new">NEW SHOT</button></div><div class="shot-list">${filtered.map(card).join('') || '<div class="empty-state">No matching Shots.</div>'}</div></aside><main class="panel">${editor}</main></div>`);

  document.getElementById('shot-search').oninput = event => { shotSearch = event.target.value; shotsPage(); document.getElementById('shot-search')?.focus(); };
  document.getElementById('shot-category').onchange = event => { shotCategory = event.target.value; render(); };
  document.getElementById('shot-camera').onchange = event => { shotCamera = event.target.value; render(); };
  document.getElementById('shot-favorite').onchange = event => { shotFavorite = event.target.value; render(); };
  document.getElementById('shot-enabled').onchange = event => { shotEnabled = event.target.value; render(); };
  document.getElementById('shot-new').onclick = async () => { state = await window.trinity.createShot({ name: 'New Shot', shotType: 'static', enabled: true }); selectedShotId = state.shots.at(-1).id; render(); };
  document.querySelectorAll('[data-select-shot]').forEach(cardElement => cardElement.onclick = event => { if (event.target.closest('[data-move-shot]')) return; selectedShotId = cardElement.dataset.selectShot; render(); });
  document.querySelectorAll('[data-move-shot]').forEach(button => button.onclick = async event => { event.stopPropagation(); const from = state.shots.findIndex(shot => shot.id === button.dataset.moveShot); state = await window.trinity.reorderShot(from, from + Number(button.dataset.direction)); render(); });
  if (!selected) return;
  const save = async patch => { try { state = await window.trinity.updateShot(selected.id, patch); render(); } catch (error) { window.alert(error.message); render(); } };
  const shotFieldValue = input => {
    let value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value || null;
    if (input.dataset.shotField === 'tags') value = input.value.split(',').map(tag => tag.trim()).filter(Boolean);
    return value;
  };
  const visibleShotPatch = () => Object.fromEntries(
    [...document.querySelectorAll('[data-shot-field]')].map(input => [input.dataset.shotField, shotFieldValue(input)])
  );
  document.querySelectorAll('[data-shot-field]').forEach(input => input.onchange = () => {
    const value = shotFieldValue(input);
    if (input.dataset.shotField === 'cameraDeviceId') {
      const patch = { cameraDeviceId: value };
      if (value !== selectedCameraId) {
        if (selected.cameraPresetId) patch.cameraPresetId = null;
        if (selected.motionEndPresetId) patch.motionEndPresetId = null;
      }
      save(patch);
      return;
    }
    save({ [input.dataset.shotField]: value });
  });
  const saveButton = document.getElementById('shot-save');
  saveButton.onpointerdown = event => { event.preventDefault(); save(visibleShotPatch()); };
  saveButton.onclick = event => { if (event.detail === 0) save(visibleShotPatch()); };
  document.getElementById('shot-duplicate').onclick = async () => { state = await window.trinity.duplicateShot(selected.id); selectedShotId = state.shots.at(-1).id; render(); };
  document.getElementById('shot-toggle').onclick = () => save({ enabled: !selected.enabled });
  const remove = async () => {
    const referenceSummary = shotReferenceSummary(selected.id);
    if (!window.confirm(`Delete ${selected.name}?\n\n${Object.entries(referenceSummary.counts).map(([label,count]) => `${label}: ${count}`).join('\n')}\nTotal: ${referenceSummary.total}\n\nReferences will remain saved as missing Shot references.`)) return;
    state = await window.trinity.deleteShot(selected.id, { confirmReferences: true });
    selectedShotId = state.shots[0]?.id || null;
    render();
  };
  document.getElementById('shot-delete').onclick = remove;
}

function deviceConfigured(device) {
  if (device.type === 'browserOperator') return true;
  if (device.type === 'camera') return Boolean(device.ipAddress && device.protocol);
  return Boolean(device.connection?.host || device.metadata?.configured);
}

function deviceStatusLabel(value) {
  return ({
    notTested: 'Not tested',
    notConfigured: 'Not configured',
    stub: 'Adapter not implemented'
  })[value] || value || 'Not tested';
}

function cameraReferenceCounts(deviceId) {
  const counts = {
    'Production Looks': 0,
    'Camera layouts': 0,
    'Cues': 0,
    'Camera presets': 0,
    Shots: 0
  };
  for (const look of state.productionLooks || []) {
    if (look.programCameraId === deviceId) counts['Production Looks'] += 1;
    if (look.previewCameraId === deviceId) counts['Production Looks'] += 1;
    counts['Production Looks'] += (look.cameraAssignments || []).filter(item => item.cameraId === deviceId).length;
  }
  for (const layout of state.cameraLayouts || []) {
    if (layout.programCamera === deviceId || layout.previewCamera === deviceId) counts['Camera layouts'] += 1;
  }
  for (const cue of state.runOfService || []) {
    if (cue.cameraId === deviceId || cue.programCameraId === deviceId || cue.previewCameraId === deviceId) counts.Cues += 1;
  }
  counts['Camera presets'] = (state.cameraPresets || []).filter(preset => preset.cameraDeviceId === deviceId).length;
  counts.Shots = (state.shots || []).filter(shot => shot.cameraDeviceId === deviceId).length;
  return counts;
}

function cameraReferenceSummary(deviceId) {
  const counts = cameraReferenceCounts(deviceId);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return {
    counts,
    total,
    text: Object.entries(counts).map(([label, count]) => `${label}: ${count}`).join('\n')
  };
}

async function confirmAndDeleteCamera(deviceId, { returnToCameraManager = false } = {}) {
  const device = byId(state.devices || [], deviceId);
  if (!device) return;
  const references = cameraReferenceSummary(deviceId);
  const confirmed = window.confirm(
    `Delete ${device.name}?\n\nReferences will remain saved as missing references and can be repaired later.\n\n${references.text}\nTotal references: ${references.total}\n\nThis cannot be undone.`
  );
  if (!confirmed) return;
  try {
    state = await window.trinity.deleteDevice(device.id, { confirmReferences: true });
    selectedDeviceId = null;
    if (selectedManagedCameraId === device.id) {
      selectedManagedCameraId = (state.devices || []).find(item => item.type === 'camera')?.id || null;
    }
    if (returnToCameraManager) page = 'cameras';
    render();
  } catch (error) {
    window.alert(error.message);
  }
}

function settingsPage() {
  const sections = [
    ['devices', 'Devices'],
    ['cameras', 'Cameras'],
    ['lighting', 'Lighting'],
    ['video', 'Video'],
    ['audio', 'Audio'],
    ['presentation', 'Presentation'],
    ['network', 'Network'],
    ['diagnostics', 'Diagnostics']
  ];
  const devices = state.devices || [];
  const filtered = devices.filter(device =>
    (!deviceTypeFilter || device.type === deviceTypeFilter) &&
    (!deviceEnabledFilter || String(device.enabled) === deviceEnabledFilter)
  );
  const cameras = devices.filter(device => device.type === 'camera');
  const lightingDevice = devices.find(device => device.type === 'lighting') || null;
  const qlcplusPages = lightingDevice?.metadata?.qlcplusPages || [];
  const roleWarnings = cameras.filter(camera => camera.enabled && cameras.some(other => other.id !== camera.id && other.enabled && other.logicalRole === camera.logicalRole));
  const selected = byId(devices, selectedDeviceId) || null;
  const selectedReferences = selected?.type === 'camera' ? cameraReferenceSummary(selected.id) : null;
  const summary = device => {
    const diagnostic = device.metadata?.diagnostic;
    return `<article class="device-card ${device.enabled ? '' : 'disabled'}">
      <div class="device-card-head"><span class="device-type">${escapeHtml(device.type)}</span><strong>${escapeHtml(device.name)}</strong></div>
      ${device.logicalRole ? `<span class="role-pill">${escapeHtml(device.logicalRole)}</span>` : ''}
      <div class="device-facts"><span>${device.enabled ? 'Enabled' : 'Disabled'}</span><span>${deviceConfigured(device) ? 'Configured' : 'Not configured'}</span><span>${escapeHtml(deviceStatusLabel(device.connectionStatus))}</span></div>
      <small>${escapeHtml([device.manufacturer, device.model].filter(Boolean).join(' ') || 'Manufacturer/model not assigned')}</small>
      <small>${escapeHtml(device.ipAddress || device.connection?.host || 'No host assigned')}</small>
      <small>${device.lastCheckedAt ? `Last checked ${escapeHtml(new Date(device.lastCheckedAt).toLocaleString())}` : 'Never tested'}</small>
      ${device.lastError ? `<p class="device-error">${escapeHtml(device.lastError)}</p>` : ''}
      ${diagnostic ? `<p class="diagnostic-result">${escapeHtml(diagnostic.message)}</p>` : ''}
      <div class="row-actions"><button data-configure-device="${device.id}">CONFIGURE</button><button data-toggle-device="${device.id}">${device.enabled ? 'DISABLE' : 'ENABLE'}</button><button data-duplicate-device="${device.id}">DUPLICATE</button><button class="danger" data-delete-device="${device.id}">DELETE</button></div>
    </article>`;
  };
  const cameraCard = (camera, index) => {
    const legacy = byId(state.cameras, camera.id);
    return `<article class="device-card camera-config-card ${camera.enabled ? '' : 'disabled'}">
      <div class="device-card-head"><span class="role-pill">${escapeHtml(camera.logicalRole)}</span><strong>${escapeHtml(camera.name)}</strong></div>
      <div class="device-facts"><span>${camera.enabled ? 'Enabled' : 'Disabled'}</span><span>${deviceConfigured(camera) ? 'Configured' : 'Not configured'}</span><span>${escapeHtml(deviceStatusLabel(camera.connectionStatus))}</span></div>
      <small>${escapeHtml([camera.manufacturer, camera.model].filter(Boolean).join(' ') || 'Manufacturer/model not assigned')}</small>
      <small>${escapeHtml(camera.ipAddress || 'No IP address')} · ${escapeHtml(camera.protocol || 'No protocol')}</small>
      <small>Tracking ${camera.trackingEnabled ? 'Yes' : 'No'} · Motion ${camera.motionEnabled ? 'Yes' : 'No'} · Presets ${camera.presetSupport ? (legacy?.savedPositions?.length || 'Supported') : 'No'}</small>
      <div class="row-actions"><button data-configure-device="${camera.id}">RENAME / EDIT</button><button data-duplicate-device="${camera.id}">DUPLICATE</button><button data-toggle-device="${camera.id}">${camera.enabled ? 'DISABLE' : 'ENABLE'}</button><button data-test-device="${camera.id}">TEST</button><button data-move-device="${camera.id}" data-direction="-1" ${index === 0 ? 'disabled' : ''}>↑</button><button data-move-device="${camera.id}" data-direction="1" ${index === cameras.length - 1 ? 'disabled' : ''}>↓</button><button class="danger" data-delete-device="${camera.id}">DELETE</button></div>
    </article>`;
  };
  const editor = selected ? `<div class="settings-editor-backdrop"><section class="settings-editor panel" role="dialog" aria-modal="true">
    <div class="look-editor-header"><div><span class="eyebrow">DEVICE CONFIGURATION</span><h1>${escapeHtml(selected.name)}</h1></div><button id="device-editor-close">×</button></div>
    <div class="settings-form">
      <label>Name<input data-device-field="name" value="${escapeHtml(selected.name)}"></label>
      ${selected.type === 'camera' ? `<label>Logical role<input data-device-field="logicalRole" list="camera-roles" value="${escapeHtml(selected.logicalRole || '')}"><datalist id="camera-roles">${['main','left','right','audience','pastor','choir'].map(role => `<option value="${role}">`).join('')}</datalist></label>` : ''}
      ${selected.type === 'camera' ? `<label>Camera adapter<select data-device-field="adapterType"><option value="" ${!selected.adapterType ? 'selected' : ''}>Not configured</option><option value="ptzoptics" ${selected.adapterType === 'ptzoptics' ? 'selected' : ''}>PTZOptics</option></select></label>` : ''}
      <label>Manufacturer<input data-device-field="manufacturer" value="${escapeHtml(selected.manufacturer || '')}"></label>
      <label>Model<input data-device-field="model" value="${escapeHtml(selected.model || '')}"></label>
      <label>IP address / host<input data-device-field="ipAddress" value="${escapeHtml(selected.ipAddress || selected.connection?.host || '')}"></label>
      <label>Port<input type="number" min="0" max="65535" data-device-field="port" value="${selected.port ?? ''}"></label>
      <label>Protocol<input data-device-field="protocol" value="${escapeHtml(selected.protocol || '')}" placeholder="visca-over-ip"></label>
      <label>Username<input data-device-field="username" value="${escapeHtml(selected.username || '')}"></label>
      <label>Credential<input type="password" data-device-field="credentialReference" value="${escapeHtml(selected.credentialReference || '')}" autocomplete="new-password"></label>
      ${selected.type === 'camera' ? `<label class="checkbox-label"><input type="checkbox" data-device-field="trackingEnabled" ${selected.trackingEnabled ? 'checked' : ''}> Tracking enabled</label><label class="checkbox-label"><input type="checkbox" data-device-field="motionEnabled" ${selected.motionEnabled ? 'checked' : ''}> Motion enabled</label><label class="checkbox-label"><input type="checkbox" data-device-field="presetSupport" ${selected.presetSupport ? 'checked' : ''}> Preset support</label>` : ''}
      <label class="checkbox-label"><input type="checkbox" data-device-field="enabled" ${selected.enabled ? 'checked' : ''}> Enabled</label>
      <label class="wide">Notes<textarea data-device-field="notes">${escapeHtml(selected.notes || '')}</textarea></label>
    </div>
    <div class="settings-editor-actions"><span>Changes save immediately.</span><button data-test-device="${selected.id}">TEST CONNECTION</button><button id="device-editor-done">DONE</button></div>
    ${selected.type === 'camera' ? `<section class="danger-zone"><div><span class="eyebrow">DANGER ZONE</span><strong>Delete ${escapeHtml(selected.name)}</strong><p>References are preserved as missing references. ${selectedReferences.total} current reference${selectedReferences.total === 1 ? '' : 's'}.</p><ul>${Object.entries(selectedReferences.counts).map(([label, count]) => `<li>${escapeHtml(label)}: <b>${count}</b></li>`).join('')}</ul></div><button class="danger" data-delete-device="${selected.id}">DELETE CAMERA</button></section>` : ''}
  </section></div>` : '';

  let body;
  if (settingsSection === 'devices') {
    body = `<div class="settings-heading"><div><span class="eyebrow">ADMINISTRATOR AREA</span><h1>Devices</h1><p>System configuration is separated from live service operation.</p></div><button id="add-device">ADD DEVICE</button></div>
      <div class="device-filters"><select id="device-type-filter"><option value="">All types</option>${['camera','lighting','switcher','audio','presentation','browserOperator'].map(type => `<option value="${type}" ${deviceTypeFilter === type ? 'selected' : ''}>${type}</option>`).join('')}</select><select id="device-enabled-filter"><option value="">Enabled and disabled</option><option value="true" ${deviceEnabledFilter === 'true' ? 'selected' : ''}>Enabled</option><option value="false" ${deviceEnabledFilter === 'false' ? 'selected' : ''}>Disabled</option></select></div>
      <div class="device-grid">${filtered.map(summary).join('')}</div>`;
  } else if (settingsSection === 'cameras') {
    body = `<div class="settings-heading"><div><span class="eyebrow">CAMERA COLLECTION</span><h1>Cameras</h1><p>Suggested roles are optional. Custom logical roles are supported.</p></div><button id="add-camera">ADD CAMERA</button></div>
      ${roleWarnings.length ? `<div class="settings-warning">Duplicate enabled logical role: ${escapeHtml([...new Set(roleWarnings.map(camera => camera.logicalRole))].join(', '))}. Assignments remain unchanged.</div>` : ''}
      <div class="device-grid">${cameras.map(cameraCard).join('')}</div>`;
  } else if (settingsSection === 'lighting') {
    const diagnostic = lightingDevice?.metadata?.lightingDiagnostic;
    const widgets = lightingDevice?.metadata?.qlcplusWidgets || [];
    const productionPage = lightingDevice?.metadata?.qlcplusProductionPage || null;
    const compatibleButtons = widgets.filter(widget => String(widget.widgetType || '').toLocaleLowerCase() === 'button' && widget.canActivateScene === true);
    const pageWidgets = productionPage ? widgets.filter(widget => widget.pageName === productionPage) : widgets;
    const pageButtons = compatibleButtons.filter(widget => !productionPage || widget.pageName === productionPage);
    const visibleWidgets = showAllDiscoveredLightingControls ? widgets : pageButtons;
    const elapsedMs = diagnostic?.elapsedMs || 0;
    const discoverySummary = showAllDiscoveredLightingControls
      ? `<strong>Showing all controls</strong><span>${compatibleButtons.length} compatible buttons · ${widgets.length} total widgets · ${elapsedMs} ms</span>`
      : productionPage
        ? `<strong>Production Page: ${escapeHtml(productionPage)}</strong><span>${pageButtons.length} production buttons · ${pageWidgets.length} page widgets · ${widgets.length} total widgets · ${elapsedMs} ms</span>`
        : `<span>${compatibleButtons.length} compatible buttons · ${widgets.length} total widgets · ${elapsedMs} ms</span>`;
    const serviceSettings = state.settings?.qlcplusService || {};
    const serviceConnected = qlcServiceStatus?.state === 'connected';
    const serviceLaunchMode = qlcServiceStatus?.launchMode === 'managed' ? 'Managed by Trinity'
      : qlcServiceStatus?.launchMode === 'external' ? 'Already running' : 'Not running';
    const workspaceName = serviceSettings.workspacePath ? serviceSettings.workspacePath.split(/[\\/]/).pop() : 'Not configured';
    const compatibility = qlcServiceStatus?.compatibility?.message || 'Workspace could not be verified';
    body = `<div class="settings-heading"><div><span class="eyebrow">LIGHTING INTEGRATION</span><h1>QLC+</h1><p>Configure and inspect QLC+ without activating any lighting controls.</p></div></div>
      <section class="panel qlc-service-panel"><div class="section-title"><span>QLC+ SERVICE</span><strong>${escapeHtml(qlcServiceStatus?.message || 'Status not checked')}</strong></div>
        <div class="device-facts"><span>Status: ${escapeHtml(qlcServiceStatus?.state || 'unknown')}</span><span>Launch mode: ${escapeHtml(serviceLaunchMode)}</span><span>Workspace: ${escapeHtml(workspaceName)}</span><span>Compatibility: ${escapeHtml(compatibility)}</span><span>Controls: ${Number(qlcServiceStatus?.compatibility?.productionButtonCount) || 0} production buttons discovered</span></div>
        <div class="row-actions"><button id="qlc-service-start" ${serviceConnected ? 'disabled' : ''}>START QLC+</button><button id="qlc-service-restart" ${qlcServiceStatus?.owned ? '' : 'disabled'}>RESTART QLC+</button><button id="qlc-service-refresh">REFRESH STATUS</button><button id="qlc-open-configuration">OPEN QLC+ CONFIGURATION</button></div>
      </section>
      <section class="panel settings-form" id="qlc-service-configuration"><span class="eyebrow wide">QLC+ SERVICE SETTINGS</span>
        <label class="checkbox-label"><input type="checkbox" data-qlc-service-field="manageAutomatically" ${serviceSettings.manageAutomatically ? 'checked' : ''}> Manage QLC+ Automatically</label>
        <label class="wide">QLC+ Application<div class="path-picker"><input data-qlc-service-field="applicationPath" value="${escapeHtml(serviceSettings.applicationPath || '')}" placeholder="/Applications/QLC+.app"><button type="button" id="qlc-browse-application">BROWSE</button></div></label>
        <label class="wide">QLC+ Workspace<div class="path-picker"><input data-qlc-service-field="workspacePath" value="${escapeHtml(serviceSettings.workspacePath || '')}" placeholder="Choose a .qxw workspace"><button type="button" id="qlc-browse-workspace">BROWSE</button></div></label>
        <label>Startup Timeout (ms)<input type="number" min="1000" max="120000" data-qlc-service-field="startupTimeoutMs" value="${serviceSettings.startupTimeoutMs || 15000}"></label>
        <label>Health Check Interval (ms)<input type="number" min="1000" max="60000" data-qlc-service-field="healthCheckIntervalMs" value="${serviceSettings.healthCheckIntervalMs || 5000}"></label>
        <label class="checkbox-label"><input type="checkbox" data-qlc-service-field="restartIfClosed" ${serviceSettings.restartIfClosed ? 'checked' : ''}> Restart If Closed</label>
      </section>
      ${lightingDevice ? `<section class="panel settings-form">
        <label>Adapter<select data-lighting-device-field="adapterType"><option value="" ${!lightingDevice.adapterType || lightingDevice.adapterType === 'qlc-plus' ? 'selected' : ''}>Not configured</option><option value="qlcplus-websocket" ${lightingDevice.adapterType === 'qlcplus-websocket' ? 'selected' : ''}>QLC+ WebSocket</option></select></label>
        <label>Host<input data-lighting-device-field="ipAddress" value="${escapeHtml(lightingDevice.ipAddress || lightingDevice.connection?.host || '')}"></label>
        <label>Web port<input type="number" min="1" max="65535" data-lighting-device-field="port" value="${lightingDevice.port || lightingDevice.connection?.port || 9999}"></label>
        <label>WebSocket protocol<select data-lighting-device-field="protocol"><option value="ws" ${(lightingDevice.protocol || lightingDevice.connection?.protocol || 'ws') === 'ws' ? 'selected' : ''}>ws</option><option value="wss" ${(lightingDevice.protocol || lightingDevice.connection?.protocol) === 'wss' ? 'selected' : ''}>wss</option></select></label>
        <label>Username<input data-lighting-device-field="username" value="${escapeHtml(lightingDevice.username || lightingDevice.connection?.username || '')}"></label>
        <label>Credential<input type="password" data-lighting-device-field="credentialReference" value="${escapeHtml(lightingDevice.credentialReference || lightingDevice.connection?.credentialReference || '')}" autocomplete="new-password"></label>
        <label>Timeout (ms)<input type="number" min="250" max="30000" data-lighting-device-field="timeoutMs" value="${lightingDevice.timeoutMs || lightingDevice.connection?.timeoutMs || 3000}"></label>
        <label>Production Page<select id="qlc-production-page"><option value="">All pages</option>${qlcplusPages.map(item => `<option value="${escapeHtml(item.pageName)}" ${lightingDevice.metadata?.qlcplusProductionPage === item.pageName ? 'selected' : ''}>${escapeHtml(item.pageName)}</option>`).join('')}</select></label>
        <label class="checkbox-label"><input type="checkbox" data-lighting-device-field="enabled" ${lightingDevice.enabled ? 'checked' : ''}> Enabled</label>
      </section>
      <div class="settings-editor-actions"><div class="qlc-discovery-summary">${diagnostic?.widgetCount !== undefined ? discoverySummary : escapeHtml(diagnostic?.message || 'QLC+ has not been tested.')}</div><label class="checkbox-label"><input type="checkbox" id="qlc-show-all-controls" ${showAllDiscoveredLightingControls ? 'checked' : ''}> Show All Controls</label><button id="qlc-test-connection">TEST CONNECTION</button><button id="qlc-discover-controls">REFRESH CONTROLS</button></div>
      ${widgets.length ? `<div class="section-title"><span>${escapeHtml(showAllDiscoveredLightingControls ? 'All QLC+ Controls' : productionPage ? `${productionPage} Controls` : 'Compatible QLC+ Controls')}</span></div><div class="diagnostic-table">${visibleWidgets.map(widget => `<div><strong>${escapeHtml(widget.name)}</strong><span>ID ${escapeHtml(widget.widgetId)}</span><span>${escapeHtml(widget.widgetType || 'Unknown')}</span><span>${escapeHtml(widget.status || 'Unknown')}</span><span>${widget.canActivateScene ? 'Scene-capable' : 'Read only'}</span>${showAllDiscoveredLightingControls ? `<span>${escapeHtml(widget.pageName || 'Page unavailable')}</span>` : ''}</div>`).join('')}</div>` : ''}` : '<div class="settings-warning">No lighting device is configured.</div>'}`;
  } else if (settingsSection === 'diagnostics') {
    body = `<div class="settings-heading"><div><span class="eyebrow">STUB ADAPTER STATUS</span><h1>Diagnostics</h1><p>Results are configuration checks only; no hardware connection is attempted.</p></div><button id="run-all-tests">RUN ALL TESTS</button></div>
      <div class="diagnostic-table">${devices.map(device => { const result = device.metadata?.diagnostic; return `<div><strong>${escapeHtml(device.name)}</strong><span>${escapeHtml(device.type)}</span><span>${deviceConfigured(device) ? 'Configured' : 'Not configured'}</span><span>${device.enabled ? 'Enabled' : 'Disabled'}</span><span>${escapeHtml(deviceStatusLabel(device.connectionStatus))}</span><span>${escapeHtml(result?.message || 'Not tested')}</span><button data-test-device="${device.id}">TEST</button><button data-clear-diagnostic="${device.id}">CLEAR</button></div>`; }).join('')}</div>`;
  } else {
    body = `<div class="coming-later"><span class="eyebrow">${escapeHtml(settingsSection.toUpperCase())}</span><h1>Coming later</h1><p>This Settings section is reserved for a future hardware-independent configuration adapter.</p></div>`;
  }

  shell(`<div class="settings-layout"><aside class="settings-nav"><div class="settings-admin-label">⚠ ADMINISTRATOR SETTINGS</div>${sections.map(([id,label]) => `<button class="${settingsSection === id ? 'active' : ''}" data-settings-section="${id}">${label}</button>`).join('')}</aside><section class="settings-content page-scroll">${body}</section></div>${editor}`);
  document.querySelectorAll('[data-settings-section]').forEach(button => button.onclick = () => { settingsSection = button.dataset.settingsSection; selectedDeviceId = null; render(); });
  const typeFilter = document.getElementById('device-type-filter');
  if (typeFilter) typeFilter.onchange = () => { deviceTypeFilter = typeFilter.value; render(); };
  const enabledFilter = document.getElementById('device-enabled-filter');
  if (enabledFilter) enabledFilter.onchange = () => { deviceEnabledFilter = enabledFilter.value; render(); };
  document.getElementById('add-device')?.addEventListener('click', async () => {
    const type = window.prompt('Device type: camera, lighting, switcher, audio, presentation, or browserOperator', 'camera');
    if (!['camera','lighting','switcher','audio','presentation','browserOperator'].includes(type)) return window.alert('Choose a supported device type.');
    state = await window.trinity.createDevice({ type, name: type === 'camera' ? 'New Camera' : 'New Device', logicalRole: type === 'camera' ? 'camera' : null, enabled: false });
    selectedDeviceId = state.devices.at(-1).id;
    render();
  });
  document.getElementById('add-camera')?.addEventListener('click', async () => { state = await window.trinity.createDevice({ type: 'camera', name: 'New Camera', logicalRole: 'camera', enabled: false, presetSupport: true }); selectedDeviceId = state.devices.at(-1).id; render(); });
  document.querySelectorAll('[data-configure-device]').forEach(button => button.onclick = () => { selectedDeviceId = button.dataset.configureDevice; render(); });
  document.querySelectorAll('[data-toggle-device]').forEach(button => button.onclick = async () => { const device = byId(state.devices, button.dataset.toggleDevice); state = await window.trinity.updateDevice(device.id, { enabled: !device.enabled }); render(); });
  document.querySelectorAll('[data-duplicate-device]').forEach(button => button.onclick = async () => { state = await window.trinity.duplicateDevice(button.dataset.duplicateDevice); render(); });
  document.querySelectorAll('[data-delete-device]').forEach(button => button.onclick = async () => {
    await confirmAndDeleteCamera(button.dataset.deleteDevice);
  });
  document.querySelectorAll('[data-move-device]').forEach(button => button.onclick = async () => {
    const deviceIndex = state.devices.findIndex(device => device.id === button.dataset.moveDevice);
    const cameraPositions = state.devices.map((device,index) => device.type === 'camera' ? index : -1).filter(index => index >= 0);
    const position = cameraPositions.indexOf(deviceIndex);
    const target = cameraPositions[position + Number(button.dataset.direction)];
    if (target !== undefined) state = await window.trinity.reorderDevice(deviceIndex, target);
    render();
  });
  document.querySelectorAll('[data-test-device]').forEach(button => button.onclick = async () => { state = await window.trinity.testDevice(button.dataset.testDevice); render(); });
  document.querySelectorAll('[data-clear-diagnostic]').forEach(button => button.onclick = async () => { state = await window.trinity.clearDeviceDiagnostic(button.dataset.clearDiagnostic); render(); });
  document.getElementById('run-all-tests')?.addEventListener('click', async () => { state = await window.trinity.testAllDevices(); render(); });
  document.getElementById('device-editor-close')?.addEventListener('click', () => { selectedDeviceId = null; render(); });
  document.getElementById('device-editor-done')?.addEventListener('click', () => { selectedDeviceId = null; render(); });
  document.querySelectorAll('[data-device-field]').forEach(input => input.onchange = async () => {
    const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? (input.value ? Number(input.value) : null) : input.value || null;
    state = await window.trinity.updateDevice(selected.id, { [input.dataset.deviceField]: value });
    const updated = byId(state.devices, selected.id);
    const duplicates = state.devices.filter(device => device.id !== updated.id && device.type === 'camera' && device.enabled && updated.enabled && device.logicalRole === updated.logicalRole);
    if (duplicates.length) window.alert(`Warning: logical role "${updated.logicalRole}" is also used by ${duplicates.map(device => device.name).join(', ')}.`);
    render();
  });
  document.querySelectorAll('[data-lighting-device-field]').forEach(input => input.onchange = async () => {
    const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? (input.value ? Number(input.value) : null) : input.value || null;
    state = await window.trinity.updateDevice(lightingDevice.id, { [input.dataset.lightingDeviceField]: value });
    render();
  });
  document.getElementById('qlc-test-connection')?.addEventListener('click', async () => {
    state = await window.trinity.testLightingConnection(lightingDevice.id);
    render();
  });
  document.getElementById('qlc-discover-controls')?.addEventListener('click', async () => {
    state = await window.trinity.discoverLightingControls(lightingDevice.id);
    render();
  });
  document.getElementById('qlc-production-page')?.addEventListener('change', async event => {
    state = await window.trinity.updateDevice(lightingDevice.id, {
      metadata: { ...lightingDevice.metadata, qlcplusProductionPage: event.target.value || null }
    });
    render();
  });
  document.getElementById('qlc-show-all-controls')?.addEventListener('change', event => {
    showAllDiscoveredLightingControls = event.target.checked;
    render();
  });
  document.querySelectorAll('[data-qlc-service-field]').forEach(input => input.addEventListener('change', async () => {
    const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    state = await window.trinity.updateQlcServiceSettings({ [input.dataset.qlcServiceField]: value });
    render();
  }));
  const browseServicePath = async (browse, field) => {
    const selectedPath = await browse();
    if (!selectedPath) return;
    state = await window.trinity.updateQlcServiceSettings({ [field]: selectedPath });
    render();
  };
  document.getElementById('qlc-browse-application')?.addEventListener('click', () => browseServicePath(window.trinity.browseQlcApplication, 'applicationPath'));
  document.getElementById('qlc-browse-workspace')?.addEventListener('click', () => browseServicePath(window.trinity.browseQlcWorkspace, 'workspacePath'));
  const runServiceAction = async action => {
    await action();
    qlcServiceStatus = await window.trinity.getQlcServiceStatus();
    render();
  };
  document.getElementById('qlc-service-start')?.addEventListener('click', () => runServiceAction(window.trinity.startQlcService));
  document.getElementById('qlc-service-restart')?.addEventListener('click', () => runServiceAction(window.trinity.restartQlcService));
  document.getElementById('qlc-service-refresh')?.addEventListener('click', () => runServiceAction(window.trinity.refreshQlcService));
  document.getElementById('qlc-open-configuration')?.addEventListener('click', () => {
    document.getElementById('qlc-service-configuration')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelector('[data-lighting-device-field="ipAddress"]')?.focus();
  });
}

function render() {
  if (!state) {
    return;
  }

  if (page === 'live') {
    livePage();
  } else if (page === 'service') {
    servicePage();
  } else if (page === 'looks') {
    looksPage();
  } else if (page === 'lighting') {
    lightingPage();
  } else if (page === 'shots') {
    shotsPage();
  } else if (page === 'settings') {
    settingsPage();
  } else {
    camerasPage();
  }
}

document.addEventListener('keydown', async event => {
  const tag = event.target?.tagName?.toLowerCase();
  if (event.isComposing || event.repeat || cueEditorOpen || ['input', 'textarea', 'select'].includes(tag) || event.target?.isContentEditable) {
    if (event.key === 'Escape' && cueEditorOpen) document.querySelector('.cue-editor-close')?.click();
    return;
  }
  const command = ({ ' ': 'go', Enter: 'go', ArrowRight: 'next', ArrowLeft: 'back', h: 'hold', H: 'hold', Escape: 'escape' })[event.key];
  if (!command) return;
  event.preventDefault();
  if (command === 'escape') return document.querySelector('.cue-editor-close')?.click();
  if (command === 'hold') state = await window.trinity.toggleHold();
  else if (command === 'back') state = await window.trinity.previousCue();
  else state = await window.trinity.nextCue();
  render();
});

(async () => {
  try {
    let pendingState;
    window.trinity.onStateChanged(nextState => {
      if (!state) pendingState = nextState;
      else {
        state = nextState;
        render();
      }
    });
    window.trinity.onQlcServiceStatusChanged(status => {
      qlcServiceStatus = status;
      if (state) render();
    });
    const [initialState, initialServerStatus, initialQlcServiceStatus] = await Promise.all([
      window.trinity.getState(),
      window.trinity.getOperatorServerStatus(),
      window.trinity.getQlcServiceStatus()
    ]);
    state = pendingState || initialState;
    operatorServerStatus = initialServerStatus;
    qlcServiceStatus = initialQlcServiceStatus;

    render();
  } catch (error) {
    root.innerHTML = `
      <div class="fatal">
        <h1>
          Trinity Control could not start
        </h1>

        <pre>
          ${escapeHtml(error?.stack || error)}
        </pre>
      </div>
    `;
  }
})();
