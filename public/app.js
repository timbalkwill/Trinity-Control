const root = document.getElementById('app');

let state;
let homeAssistantStatus = null;
let homeAssistantBusy = false;
let selectedLightingSceneId = null;
let showAllLightingControls = false;
let showAllDiscoveredLightingControls = false;
let lightingSceneFilter = 'production';
let qlcServiceStatus = null;
let atemStatus = null;
let operatorServerStatus;
let appInfo = null;
let page = 'live';
let cueEditorOpen = false;
let servicePageError = '';
let selectedLookId = null;
let lookSearch = '';
let settingsSection = 'devices';
let backupImportPreview = null;
let lastBackupExportAt = null;
let backupBusy = false;
let setupWizardOpen = false;
let setupStep = 'welcome';
let setupContext = null;
let setupSkippedSystems = new Set();
let systemStatus = null;
let systemStatusLoading = false;
let rendererFps = null;
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
let shotTypeFilter = '';
const motionCapabilitiesByCamera = new Map();
let renderSequence = 0;
let renderInProgress = false;
const suggestedPresetCategories = ['Pastor', 'Platform', 'Piano', 'Choir', 'Baptistry', 'Congregation', 'Wide', 'Utility'];
const suggestedShotCategories = ['Pastor', 'Platform', 'Music', 'Piano', 'Choir', 'Baptistry', 'Congregation', 'Wide', 'Utility'];
const motionStyleLabels = { presetTransition: 'Preset Transition', pushIn: 'Push In', pullOut: 'Pull Out', panLeft: 'Pan Left', panRight: 'Pan Right', tiltUp: 'Tilt Up', tiltDown: 'Tilt Down', diagonalDrift: 'Diagonal / Drift', reveal: 'Reveal', custom: 'Custom' };
const motionSpeedLabels = { verySlow: 'Very Slow', slow: 'Slow', medium: 'Medium', fast: 'Fast' };

const nav = [
  ['live', 'Live'],
  ['service', 'Service'],
  ['looks', 'Production Looks'],
  ['lighting', 'Lighting Library'],
  ['cameras', 'Camera Library'],
  ['shots', 'Shot Library'],
  ['settings', 'Settings']
];

const byId = (items, id) => items.find(item => item.id === id);

function lightingScenePickerOptions(current, emptyLabel) {
  const scenes = state.lightingScenes || [];
  const currentScene = byId(scenes, current);
  const currentOption = current && currentScene?.available === false
    ? `<option value="${escapeHtml(currentScene.id)}" selected>${escapeHtml(currentScene.name)} (Missing QLC+ function)</option>`
    : current && currentScene?.productionScene === false
      ? `<option value="${escapeHtml(currentScene.id)}" selected>${escapeHtml(currentScene.name)} (Utility — referenced)</option>`
    : current && !currentScene
      ? `<option value="${escapeHtml(current)}" selected>Missing reference</option>`
      : '';
  return `<option value="">${emptyLabel}</option>${currentOption}${scenes
    .filter(scene => scene.productionScene !== false && scene.available !== false)
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

const activeNotifications = new Map();

function ensureNotificationRegion() {
  let region = document.getElementById('trinity-notifications');
  if (region) return region;
  region = document.createElement('section');
  region.id = 'trinity-notifications';
  region.className = 'notification-stack';
  region.setAttribute('aria-label', 'Notifications');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-relevant', 'additions text');
  document.body.appendChild(region);
  return region;
}

function showNotification(message, { type = 'information', persistent = false } = {}) {
  const key = `${type}:${message}`;
  if (activeNotifications.has(key)) return activeNotifications.get(key);
  const region = ensureNotificationRegion();
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.setAttribute('role', type === 'error' ? 'alert' : 'status');
  notification.tabIndex = 0;
  notification.innerHTML = `<span aria-hidden="true">${type === 'success' ? '✓' : type === 'error' ? '!' : type === 'warning' ? '▲' : 'i'}</span><strong>${escapeHtml(message)}</strong><button type="button" aria-label="Dismiss notification" title="Dismiss">×</button>`;
  const dismiss = () => {
    activeNotifications.delete(key);
    notification.remove();
  };
  notification.querySelector('button').onclick = dismiss;
  region.appendChild(notification);
  activeNotifications.set(key, notification);
  if (!persistent) setTimeout(dismiss, type === 'error' ? 8000 : 4000);
  return notification;
}

function navigateToPage(nextPage) {
  if (!nav.some(([id]) => id === nextPage)) return;
  if (page === nextPage) return;
  page = nextPage;
  const label = nav.find(([id]) => id === page)?.[1] || 'Trinity Control';
  document.title = `Trinity Control — ${label}`;
  render({ reason: 'navigation', preserveScroll: false });
}

async function openApplicationDialog(kind, trigger = document.activeElement) {
  const info = appInfo || await window.trinity.getAppInfo();
  appInfo = info;
  const isAbout = kind === 'about';
  const backdrop = document.createElement('div');
  backdrop.className = 'application-dialog-backdrop';
  backdrop.innerHTML = `<section class="application-dialog panel" role="dialog" aria-modal="true" aria-labelledby="application-dialog-title">
    <img src="assets/trinity-logo.png" alt="Trinity Baptist Church">
    <span class="eyebrow">${isAbout ? 'APPLICATION INFORMATION' : 'KEYBOARD REFERENCE'}</span>
    <h2 id="application-dialog-title">${isAbout ? 'Trinity Control' : 'Keyboard Shortcuts'}</h2>
    ${isAbout
      ? `<p>Version ${escapeHtml(info.version)}</p><p>Production control system for Trinity Baptist Church<br>Hendersonville, Tennessee</p><dl><div><dt>Build</dt><dd>${escapeHtml(info.buildVersion)}</dd></div><div><dt>Electron</dt><dd>${escapeHtml(info.electronVersion)}</dd></div><div><dt>Node</dt><dd>${escapeHtml(info.nodeVersion)}</dd></div><div><dt>Platform</dt><dd>${escapeHtml(info.platform)} · ${escapeHtml(info.architecture)}</dd></div></dl><small>© ${new Date().getFullYear()} Trinity Baptist Church</small>`
      : `<dl class="shortcut-list"><div><dt>Command/Ctrl+1</dt><dd>Live</dd></div><div><dt>Command/Ctrl+2</dt><dd>Service</dd></div><div><dt>Command/Ctrl+3</dt><dd>Production Looks</dd></div><div><dt>Command/Ctrl+4</dt><dd>Camera Library</dd></div><div><dt>Command/Ctrl+5</dt><dd>Lighting Library</dd></div><div><dt>Command/Ctrl+,</dt><dd>Settings</dd></div><div><dt>Escape</dt><dd>Close this dialog</dd></div></dl>`}
    <button type="button" class="dialog-close primary-button">Done</button>
  </section>`;
  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');
  const closeButton = backdrop.querySelector('.dialog-close');
  const close = () => {
    backdrop.remove();
    document.body.classList.remove('modal-open');
    trigger?.focus?.({ preventScroll: true });
  };
  closeButton.onclick = close;
  backdrop.onclick = event => { if (event.target === backdrop) close(); };
  backdrop.onkeydown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      closeButton.focus();
    }
  };
  closeButton.focus();
}

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

    .cue-editor-error {
      align-self: center;
      margin-right: auto;
      color: #ffaaa6;
      font-size: 13px;
      font-weight: 700;
    }

    .cue-preview-summary-service {
      grid-template-columns: repeat(2, minmax(0, 1fr));
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
  const qlcDevice = (state?.devices || []).find(device =>
    device.type === 'lighting' && device.adapterType === 'qlcplus-websocket'
  );
  const qlcReadiness = !qlcDevice
    ? 'All Systems Ready'
    : qlcDevice.enabled === false
      ? 'Ready with Lighting Disabled'
      : qlcServiceStatus?.state !== 'connected'
        ? 'Attention Required'
        : qlcServiceStatus?.compatibility?.severity === 'warning'
          ? 'Systems Ready · Lighting Warning'
          : 'All Systems Ready';

  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          Trinity Control
          <span>${escapeHtml(appInfo?.version || state.version)}</span>
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
      navigateToPage(button.dataset.page);
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

function openCueEditor(index = null) {
  const creating = !Number.isInteger(index);
  const cue = creating ? { name: '', notes: '', productionLookId: '', lightingSceneId: '' } : state.runOfService[index];
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
          <h2 id="cue-editor-title">${creating ? 'Add Cue' : 'Edit Service Cue'}</h2>
        </div>
        <button type="button" class="cue-editor-close" aria-label="Close cue editor">×</button>
      </div>

      <div class="cue-editor-body cue-editor-body-simplified">
        <label class="cue-editor-full">
          Cue Name
          <input id="cue-edit-name" value="${escapeHtml(cue.name || '')}" maxlength="80" required placeholder="Announcements, Prayer, Choir Special…">
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
          Description / Operator Note
          <textarea id="cue-edit-notes" placeholder="Optional instructions for the operator">${escapeHtml(cue.notes || '')}</textarea>
        </label>

        <section class="cue-execution-preview cue-editor-full" aria-labelledby="cue-preview-title">
          <div class="cue-preview-heading">
            <div>
              <small>WHEN GO IS PRESSED</small>
              <h3 id="cue-preview-title">Cue Preview</h3>
            </div>
            <span id="cue-preview-status" class="cue-preview-status"></span>
          </div>

          <div class="cue-preview-summary cue-preview-summary-service">
            <div><span>Production Look</span><strong id="cue-preview-look"></strong></div>
            <div><span>Lighting</span><strong id="cue-preview-lighting"></strong></div>
          </div>

          <div id="cue-preview-warnings" class="cue-preview-warnings" hidden></div>
        </section>
      </div>

      <div class="cue-editor-actions">
        <div class="cue-editor-error" role="alert" hidden></div>
        <button type="button" class="cancel-cue">Cancel</button>
        <button type="button" class="save-cue">${creating ? 'Add to Service' : 'Save Cue'}</button>
      </div>
    </section>`;

  document.body.appendChild(backdrop);

  const nameInput = backdrop.querySelector('#cue-edit-name');
  const lookSelect = backdrop.querySelector('#cue-edit-look');
  const lightingSelect = backdrop.querySelector('#cue-edit-lighting');
  const notesInput = backdrop.querySelector('#cue-edit-notes');

  const updatePreview = () => {
    const look = byId(state.productionLooks, lookSelect.value);
    const lighting = byId(state.lightingScenes, lightingSelect.value || look?.lightingSceneId);
    const warnings = [];

    backdrop.querySelector('#cue-preview-look').textContent = look?.name || 'Not assigned';
    backdrop.querySelector('#cue-preview-lighting').textContent = lighting?.name || 'Not assigned';

    if (lookSelect.value && !look) warnings.push('The selected Production Look is unavailable.');
    if (!lighting) warnings.push('No lighting scene will be recalled.');
    if (lighting?.available === false) warnings.push('Missing QLC+ lighting function. GO will not send a stale lighting command.');
    if (lighting?.productionScene === false) warnings.push('Scene is marked Utility but is still referenced.');
    if (look?.enabled === false) warnings.push('The selected Production Look is disabled.');

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
    const errorBox = backdrop.querySelector('.cue-editor-error');
    const name = nameInput.value.trim();
    if (!name) {
      errorBox.textContent = 'Cue Name is required.';
      errorBox.hidden = false;
      nameInput.focus();
      return;
    }
    const input = {
      name,
      productionLookId: lookSelect.value,
      lightingSceneId: lightingSelect.value || '',
      notes: notesInput.value.trim()
    };
    try {
      state = creating ? await window.trinity.createCue(input) : await window.trinity.updateCue(index, input);
      close();
      render();
    } catch (error) {
      errorBox.textContent = error.message || 'Cue could not be saved.';
      errorBox.hidden = false;
    }
  };

  nameInput.focus();
  nameInput.select();
}

function legacyLivePage() {
  const cue = currentCue();
  const look = currentLook();
  const lighting = cueLighting(cue);
  const currentLookDetails = window.TrinityLookView.summarize(state, cue);

  const nextCue =
    state.runOfService[state.live.cueIndex + 1];
  const nextLookDetails = window.TrinityLookView.summarize(state, nextCue);

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

function productionDirectorCameras() {
  const devices = (state.devices || []).filter(device => device?.type === 'camera');
  const legacy = state.cameras || [];
  const definitions = [
    { role: 'main', aliases: ['main', 'center'], fallbackName: 'Main Camera' },
    { role: 'left', aliases: ['left'], fallbackName: 'Left Camera' },
    { role: 'right', aliases: ['right'], fallbackName: 'Right Camera' }
  ];
  return definitions.map(definition => {
    const device = devices.find(item => item.id === definition.role || definition.aliases.includes(item.logicalRole));
    const legacyCamera = legacy.find(item => item.id === definition.role || definition.aliases.includes(item.role));
    return device || legacyCamera || { id: definition.role, name: definition.fallbackName, logicalRole: definition.role, missing: true, enabled: false };
  });
}

function normalizedCameraControlIdentity(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function cameraAdapterSupported(camera) {
  const adapter = normalizedCameraControlIdentity(camera?.adapterType);
  const protocol = normalizedCameraControlIdentity(camera?.protocol || camera?.connection?.protocol);
  return adapter === 'ptzoptics' || ['visca-udp', 'visca-over-ip', 'visca-ip'].includes(adapter) || ['visca-udp', 'visca-over-ip', 'visca-ip'].includes(protocol);
}

function directorCameraStatus(camera) {
  if (camera.missing) return { label: 'Not Configured', available: false, className: 'not-configured' };
  if (camera.enabled === false) return { label: 'Disabled', available: false, className: 'disabled' };
  if (['offline', 'error', 'unavailable'].includes(String(camera.connectionStatus || '').toLowerCase())) {
    return { label: 'Unavailable', available: false, className: 'unavailable' };
  }
  if (!cameraAdapterSupported(camera) || !deviceConfigured(camera)) return { label: 'Not Configured', available: false, className: 'not-configured' };
  return { label: 'Ready', available: true, className: 'ready' };
}

function CameraDirectorCard(camera) {
  const preparation = cameraPreparation(camera.id);
  const status = directorCameraStatus(camera);
  const presets = (state.cameraPresets || []).filter(preset => preset.enabled !== false && preset.cameraDeviceId === camera.id);
  const cameraPresetById = new Map(presets.map(preset => [preset.id, preset]));
  const motionShots = (state.shots || []).filter(shot => shot.enabled !== false && shot.shotType === 'motion' && shot.cameraDeviceId === camera.id);
  const preparedMotion = state.live?.preparedMotions?.[camera.id] || null;
  const lastMotion = state.live?.manualMotionCommands?.[camera.id] || null;
  const lastCommandedId = preparation.preparedAssignment?.mode === 'static' ? preparation.preparedAssignment.presetId : null;
  const controlsDisabled = !status.available || preparation.tracking?.active === true;
  const videoSource = (state.videoSources || []).find(source => source.sourceType === 'camera' && source.cameraDeviceId === camera.id);
  const switcherConnected = atemStatus?.connectionState === 'connected';
  const hasMapping = videoSource?.switcherMappings?.[atemStatus?.backend || 'atem']?.input != null;
  const isLive = switcherConnected && atemStatus.liveSourceId === videoSource?.id;
  const takeDisabled = !switcherConnected || !hasMapping || (isLive && !preparedMotion);
  return `<article class="camera-director-card ${isLive ? 'atem-live' : ''}" data-camera-card="${escapeHtml(camera.id)}" data-camera-role="${escapeHtml(camera.logicalRole || camera.role || camera.id)}">
    <header>
      <div><span class="eyebrow">${escapeHtml(String(camera.logicalRole || camera.role || camera.id).toUpperCase())} CAMERA</span><strong>${escapeHtml(camera.name)}</strong></div>
      <span class="camera-live-indicator" data-live-indicator ${isLive ? '' : 'hidden'}>● LIVE</span>
    </header>
    <div class="camera-director-status">
      <span class="preparation-status ${status.className}">${escapeHtml(status.label)}</span>
      <small>${preparation.tracking?.active ? 'Tracking active — position controls disabled' : lastCommandedId ? `Last Commanded: ${escapeHtml(preparation.preparedAssignment.presetName || '')}` : 'No position commanded'}</small>
    </div>
    <div class="camera-action-section">
      <div class="camera-action-heading"><strong>PRESETS</strong><span>${presets.length}</span></div>
      <div class="camera-preset-list" data-camera-list="${escapeHtml(camera.id)}" data-scroll-key="camera-presets-${escapeHtml(camera.id)}" tabindex="0" aria-label="Available positions for ${escapeHtml(camera.name)}">
        ${presets.length ? presets.map(preset => `<button
          class="camera-preset-action ${preset.id === lastCommandedId ? 'last-commanded' : ''}"
          data-recall-camera="${escapeHtml(camera.id)}"
          data-recall-preset="${escapeHtml(preset.id)}"
          aria-label="Recall ${escapeHtml(preset.name)} on ${escapeHtml(camera.name)}"
          ${controlsDisabled ? 'disabled' : ''}
        ><span>${escapeHtml(preset.name)}</span>${preset.id === lastCommandedId ? '<small>✓ Last Commanded</small>' : ''}</button>`).join('') : '<div class="camera-empty-state">No saved presets for this camera.</div>'}
      </div>
    </div>
    <div class="camera-action-section camera-motion-section">
      <div class="camera-action-heading"><strong>MOTION</strong><span>${motionShots.length}</span></div>
      <div class="camera-preset-list camera-motion-list" data-scroll-key="camera-motion-${escapeHtml(camera.id)}" tabindex="0" aria-label="Motion shots for ${escapeHtml(camera.name)}">
        ${motionShots.length ? motionShots.map(shot => {
          const startPreset = cameraPresetById.get(shot.cameraPresetId);
          const endPreset = cameraPresetById.get(shot.motionEndPresetId);
          const unavailableReason = !status.available ? status.label
            : preparation.tracking?.active === true ? 'Tracking active'
            : !startPreset ? 'Start preset is missing, disabled, or belongs to another camera'
            : !endPreset ? 'End preset is missing, disabled, or belongs to another camera'
            : null;
          const isLastMotion = lastMotion?.shotId === shot.id;
          const isPrepared = preparedMotion?.shotId === shot.id;
          const speedLabel = motionSpeedLabels[shot.motionSpeedSetting] || 'Medium';
          const styleLabel = motionStyleLabels[shot.motionStyle] || 'Preset Transition';
          return `<button
            class="camera-preset-action camera-motion-action ${isLastMotion ? 'last-commanded' : ''} ${isPrepared ? 'prepared' : ''}"
            data-prepare-motion-camera="${escapeHtml(camera.id)}"
            data-prepare-motion-shot="${escapeHtml(shot.id)}"
            aria-label="Prepare motion ${escapeHtml(shot.name)} on ${escapeHtml(camera.name)}"
            title="${escapeHtml(unavailableReason || `${startPreset.name} to ${endPreset.name} at ${speedLabel}`)}"
            ${unavailableReason ? 'disabled' : ''}
          ><span><strong>${isPrepared ? '✓ ' : ''}${escapeHtml(shot.name)}</strong><small>${escapeHtml(startPreset?.name || 'Missing start')} → ${escapeHtml(endPreset?.name || 'Missing end')}</small><small>${escapeHtml(styleLabel)} · ${escapeHtml(speedLabel)}</small></span><small>${isPrepared ? escapeHtml(preparedMotion.statusLabel || 'READY / START COMMANDED') : 'PREPARE'}</small></button>`;
        }).join('') : '<div class="camera-empty-state">No saved Motion Shots for this camera.</div>'}
      </div>
      <small class="camera-motion-feedback" data-motion-feedback="${escapeHtml(camera.id)}">${preparedMotion ? `${escapeHtml(preparedMotion.statusLabel)} · Start commanded, position not verified` : lastMotion ? `Last Motion: ${escapeHtml(lastMotion.shotName)} · Commanded` : 'NOT PREPARED'}</small>
      ${preparedMotion ? `<button type="button" class="secondary-button cancel-prepared-motion" data-cancel-prepared-motion="${escapeHtml(camera.id)}">CANCEL PREP</button>` : ''}
    </div>
    <button type="button" class="atem-take-live" data-take-video-source="${escapeHtml(videoSource?.id || '')}" ${takeDisabled ? 'disabled' : ''}>${isLive && preparedMotion ? 'RUN PREPARED MOVE' : isLive ? 'LIVE' : preparedMotion ? 'TAKE LIVE + MOVE' : 'TAKE LIVE'}</button>
  </article>`;
}

function livePage() {
  const presentationSource = (state.videoSources || []).find(source => source.sourceType === 'video' && source.enabled !== false);
  const presentationLive = atemStatus?.connectionState === 'connected' && atemStatus.liveSourceId === presentationSource?.id;
  const presentationMapped = presentationSource?.switcherMappings?.[atemStatus?.backend || 'atem']?.input != null;
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
      <div class="camera-director-heading"><div><span class="eyebrow">LIVE WORKSPACE</span><h1>Camera Director</h1></div><small>Video Switcher: ${escapeHtml(atemStatus?.backendName || 'ATEM')} · ${escapeHtml(atemStatus?.connectionState || 'Unknown')} · LIVE ${escapeHtml(atemStatus?.liveSourceName || '—')}</small></div>
      ${presentationSource ? `<div class="presentation-source-control ${presentationLive ? 'live' : ''}"><div><span class="eyebrow">VIDEO SOURCE</span><strong>${escapeHtml(presentationSource.name)}</strong><small>${presentationLive ? 'LIVE' : presentationMapped ? 'Ready' : 'Mapping required'}</small></div><button data-take-video-source="${escapeHtml(presentationSource.id)}" ${atemStatus?.connectionState !== 'connected' || !presentationMapped || presentationLive ? 'disabled' : ''}>${presentationLive ? 'LIVE' : 'TAKE LIVE'}</button></div>` : ''}
      <div class="camera-director-grid">${productionDirectorCameras().map(CameraDirectorCard).join('')}</div>
    </section>
  </div>`);

  document.querySelectorAll('[data-go-cue]').forEach(button => {
    button.onclick = async () => { state = await activateCue(Number(button.dataset.goCue)); render(); };
  });
  document.querySelector('[data-live-go]').onclick = async () => { state = await window.trinity.nextCue(); render(); };
  document.querySelector('[data-live-back]').onclick = async () => { state = await window.trinity.previousCue(); render(); };
  document.querySelectorAll('[data-recall-camera]').forEach(button => {
    button.onclick = async () => {
      button.disabled = true;
      try { state = await window.trinity.recallCameraPreset(button.dataset.recallCamera, button.dataset.recallPreset); render(); }
      catch (error) { button.disabled = false; window.alert(error.message); }
    };
  });
  document.querySelectorAll('[data-prepare-motion-camera]').forEach(button => {
    button.onclick = async () => {
      const feedback = document.querySelector(`[data-motion-feedback="${button.dataset.prepareMotionCamera}"]`);
      const existing = state.live?.preparedMotions?.[button.dataset.prepareMotionCamera];
      if (existing && existing.shotId !== button.dataset.prepareMotionShot && !window.confirm(`Replace prepared Motion ${existing.shotName} with this Motion Shot?`)) return;
      button.disabled = true;
      button.classList.add('executing');
      if (feedback) feedback.textContent = 'PREPARING…';
      try {
        state = await window.trinity.prepareMotionStart(button.dataset.prepareMotionCamera, button.dataset.prepareMotionShot);
        render();
      } catch (error) {
        button.disabled = false;
        button.classList.remove('executing');
        if (feedback) feedback.textContent = `FAILED: ${error.message || 'Preparation failed'}`;
        showNotification(error.message || 'Motion preparation failed', { type: 'error' });
      }
    };
  });
  document.querySelectorAll('[data-cancel-prepared-motion]').forEach(button => {
    button.onclick = async () => { state = await window.trinity.cancelPreparedMotion(button.dataset.cancelPreparedMotion); render(); };
  });
  document.querySelectorAll('[data-take-video-source]').forEach(button => {
    button.onclick = async () => {
      button.disabled = true;
      try { await window.trinity.takeVideoSource(button.dataset.takeVideoSource); }
      catch (error) {
        showNotification(error.message || 'Video Switcher failed', { type: 'error' });
        button.disabled = false;
      }
    };
  });
}

function openCueDeleteModal(cueId, trigger) {
  const cue = byId(state.runOfService || [], cueId);
  if (!cue) return;
  document.querySelector('.service-delete-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'service-delete-backdrop';
  backdrop.innerHTML = `
    <section class="service-delete-modal" role="dialog" aria-modal="true" aria-labelledby="service-delete-title" aria-describedby="service-delete-description">
      <span class="eyebrow">SERVICE CUE</span>
      <h2 id="service-delete-title">Delete cue?</h2>
      <p id="service-delete-description">“${escapeHtml(cue.name || 'Untitled Cue')}” will be removed from this service.</p>
      <div class="service-delete-error" role="alert" hidden></div>
      <div class="service-delete-actions">
        <button type="button" data-delete-cancel>Cancel</button>
        <button type="button" class="danger" data-delete-confirm>Delete Cue</button>
      </div>
    </section>`;
  document.body.appendChild(backdrop);
  const cancel = backdrop.querySelector('[data-delete-cancel]');
  const confirmDelete = backdrop.querySelector('[data-delete-confirm]');
  const errorMessage = backdrop.querySelector('.service-delete-error');
  let submitting = false;
  const close = () => {
    if (submitting) return;
    backdrop.remove();
    trigger?.focus?.();
  };
  cancel.onclick = close;
  backdrop.onclick = event => { if (event.target === backdrop) close(); };
  backdrop.onkeydown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.key === 'Tab') {
      if ((event.shiftKey && document.activeElement === cancel) || (!event.shiftKey && document.activeElement === confirmDelete)) {
        event.preventDefault();
        (event.shiftKey ? confirmDelete : cancel).focus();
      }
    }
  };
  confirmDelete.onclick = async () => {
    if (submitting) return;
    submitting = true;
    cancel.disabled = true;
    confirmDelete.disabled = true;
    try {
      state = await window.trinity.deleteCueById(cueId, { confirmActive: true });
      backdrop.remove();
      servicePageError = '';
      showNotification('Cue deleted', { type: 'success' });
      render();
    } catch (error) {
      submitting = false;
      cancel.disabled = false;
      confirmDelete.disabled = false;
      errorMessage.hidden = false;
      errorMessage.textContent = error.message || 'Cue could not be deleted.';
      confirmDelete.focus();
    }
  };
  cancel.focus();
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
        data-cue-id="${escapeHtml(cue.id)}"
        aria-label="${escapeHtml(cue.name || 'Untitled Cue')}, position ${index + 1} of ${state.runOfService.length}"
      >
        <button type="button" class="service-drag-handle" draggable="true" data-drag-cue="${escapeHtml(cue.id)}" aria-label="Reorder “${escapeHtml(cue.name || 'Untitled Cue')}”" title="Drag to reorder">⋮⋮</button>
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
          <button data-move-cue="${escapeHtml(cue.id)}" data-direction="up" ${index === 0 ? 'disabled' : ''} aria-label="Move ${escapeHtml(cue.name || 'cue')} up">↑ UP</button>
          <button data-move-cue="${escapeHtml(cue.id)}" data-direction="down" ${index === state.runOfService.length - 1 ? 'disabled' : ''} aria-label="Move ${escapeHtml(cue.name || 'cue')} down">↓ DOWN</button>
          <button data-edit="${index}">EDIT</button>
          <button data-duplicate="${index}">COPY</button>
          <button class="cue-delete" data-remove-cue="${escapeHtml(cue.id)}" aria-label="Delete ${escapeHtml(cue.name || 'cue')}">DELETE</button>
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
          <div class="service-heading-actions">
            <span class="service-count-pill">${state.runOfService.length} cues</span>
            <button type="button" id="service-create-cue" class="primary-button">+ ADD CUE</button>
          </div>
        </div>
        ${servicePageError ? `<div class="service-operation-error" role="alert">${escapeHtml(servicePageError)}</div>` : ''}

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
          ${state.runOfService.length
            ? state.runOfService.map(cueCard).join('')
            : '<div class="empty-state-card"><span aria-hidden="true">＋</span><h3>No cues have been added to this service.</h3><p>Create a custom cue or use a prepared template.</p><button type="button" id="service-add-first-cue" class="primary-button">Add First Cue</button></div>'}
        </div>
      </section>

      <aside class="panel service-add-panel">
        <div class="service-page-heading">
          <div>
            <h2>Quick Add Templates</h2>
            <p>Add a prepared cue, then edit it like any other cue.</p>
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
      showNotification('Cue added', { type: 'success' });
      render();
    };
  });
  document.getElementById('service-create-cue')?.addEventListener('click', () => openCueEditor());
  document.getElementById('service-add-first-cue')?.addEventListener('click', () => openCueEditor());

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

  document.querySelectorAll('[data-remove-cue]').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      openCueDeleteModal(button.dataset.removeCue, button);
    };
  });

  document.querySelectorAll('[data-move-cue]').forEach(button => {
    button.onclick = async event => {
      event.stopPropagation();
      if (button.disabled) return;
      button.disabled = true;
      try {
        state = await window.trinity.moveCueById(button.dataset.moveCue, button.dataset.direction);
        servicePageError = '';
        showNotification('Order updated', { type: 'success' });
        render();
      } catch (error) {
        servicePageError = error.message || 'Cue order could not be saved.';
        render();
      }
    };
  });

  let draggedCueId = null;
  document.querySelectorAll('[data-drag-cue]').forEach(handle => {
    handle.ondragstart = event => {
      draggedCueId = handle.dataset.dragCue;
      handle.closest('.service-cue-card')?.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedCueId);
    };
    handle.ondragend = () => {
      draggedCueId = null;
      document.querySelectorAll('.service-cue-card').forEach(item => item.classList.remove('dragging', 'drop-before', 'drop-after'));
    };
  });
  document.querySelectorAll('.service-cue-card').forEach(card => {
    card.ondragover = event => {
      if (!draggedCueId) return;
      event.preventDefault();
      const rect = card.getBoundingClientRect();
      card.classList.toggle('drop-before', event.clientY < rect.top + rect.height / 2);
      card.classList.toggle('drop-after', event.clientY >= rect.top + rect.height / 2);
    };
    card.ondragleave = () => card.classList.remove('drop-before', 'drop-after');
    card.ondrop = async event => {
      event.preventDefault();
      if (!draggedCueId) return;
      const rect = card.getBoundingClientRect();
      const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      const targetCueId = card.dataset.cueId;
      try {
        if (draggedCueId !== targetCueId) state = await window.trinity.reorderCueById(draggedCueId, targetCueId, placement);
        servicePageError = '';
        showNotification('Order updated', { type: 'success' });
      } catch (error) {
        servicePageError = error.message || 'Cue order could not be saved.';
      }
      render();
    };
  });
}

function looksPage() {
  if (!selectedLookId || !byId(state.productionLooks, selectedLookId)) selectedLookId = state.productionLooks[0]?.id || null;
  const selected = byId(state.productionLooks, selectedLookId);
  const filtered = state.productionLooks.filter(look => String(look.name || '').toLowerCase().includes(lookSearch.toLowerCase()));
  const lightingOptions = current => lightingScenePickerOptions(current, 'Not assigned');
  const selectedLighting = byId(state.lightingScenes || [], selected?.lightingSceneId);
  shell(`<div class="page-scroll"><div class="looks-workspace">
    <aside class="panel look-library"><div class="section-title"><span>PRODUCTION LOOKS</span><strong>${state.productionLooks.length} looks</strong></div>
      <div class="look-toolbar"><input id="look-search" value="${escapeHtml(lookSearch)}" placeholder="Search looks"><button id="look-create">NEW LOOK</button></div>
      <div class="look-list">${filtered.map(look => `<button class="look-list-item ${look.id === selectedLookId ? 'selected' : ''}" data-select-look="${look.id}"><strong>${escapeHtml(look.name)}</strong><span>${look.enabled === false ? 'Disabled' : 'Enabled'}</span></button>`).join('') || '<p class="empty-state">No matching looks.</p>'}</div>
    </aside>
    <section class="panel look-editor">${selected ? `<div class="look-editor-header"><div><span class="eyebrow">PRODUCTION LOOK</span><h1>${escapeHtml(selected.name)}</h1><p>Configure the production settings used by this look.</p></div><div class="row-actions"><button id="look-duplicate">DUPLICATE</button><button id="look-delete" class="danger">DELETE</button></div></div>
      <div class="look-sections production-look-form">
        <fieldset><legend>PRODUCTION LOOK</legend><label>Look Name<input id="look-name" value="${escapeHtml(selected.name)}" required></label><label>Lighting Scene<select id="look-lighting">${lightingOptions(selected.lightingSceneId)}</select>${selectedLighting?.available === false ? '<small class="look-warning">⚠ Missing QLC+ lighting function</small>' : selectedLighting?.productionScene === false ? '<small class="look-warning">Scene is marked Utility but is still referenced.</small>' : ''}</label><label class="checkbox-label"><input type="checkbox" id="look-enabled" ${selected.enabled !== false ? 'checked' : ''}> Enabled</label></fieldset>
        <section class="production-look-summary" aria-label="Look Summary"><span class="eyebrow">LOOK SUMMARY</span><dl><div><dt>Name</dt><dd>${escapeHtml(selected.name)}</dd></div><div><dt>Lighting Scene</dt><dd>${escapeHtml(selectedLighting?.name || 'Not assigned')}</dd></div><div><dt>Status</dt><dd><em class="${selected.enabled === false ? 'disabled' : 'enabled'}">${selected.enabled === false ? 'Disabled' : 'Enabled'}</em></dd></div></dl></section>
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
    try {
      state = await window.trinity.updateProductionLook(selected.id, {
        name: document.getElementById('look-name').value,
        enabled: document.getElementById('look-enabled').checked,
        lightingSceneId: document.getElementById('look-lighting').value || null
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
  const productionScenes = (state.lightingScenes || []).filter(scene => scene.productionScene !== false && scene.available !== false);
  const utilityScenes = (state.lightingScenes || []).filter(scene => scene.productionScene === false && scene.available !== false);
  const reconciliationScenes = (state.lightingScenes || []).filter(scene => scene.reconciliationStatus === 'needs-reconciliation');
  const missingScenes = (state.lightingScenes || []).filter(scene => scene.available === false && scene.reconciliationStatus !== 'needs-reconciliation');
  const availableScenes = (state.lightingScenes || []).filter(scene => scene.available !== false);
  const filteredScenes = lightingSceneFilter === 'all'
    ? state.lightingScenes
    : lightingSceneFilter === 'utility' ? utilityScenes : productionScenes;
  const selectedLookReferences = selectedScene ? (state.productionLooks || []).filter(look => look.lightingSceneId === selectedScene.id) : [];
  const selectedCueReferences = selectedScene ? (state.runOfService || []).filter(cue => cueLightingId(cue) === selectedScene.id) : [];
  const selectedDirectCueReferences = selectedScene ? (state.runOfService || []).filter(cue => cue.lightingSceneId === selectedScene.id) : [];
  const selectedTemplateReferences = selectedScene ? (state.cueTemplates || []).filter(template => template.lightingSceneId === selectedScene.id) : [];
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
  const availableReplacements = (state.lightingScenes || []).filter(scene => scene.available !== false && scene.id !== selectedScene?.id);
  const controlOption = control => `${control.name || 'Unnamed'} — ${control.widgetType || 'Unknown'} — ID ${control.widgetId}${control.status !== undefined ? ` — ${control.status}` : ''}`;
  const selectedNeedsReconciliation = selectedScene?.reconciliationStatus === 'needs-reconciliation';
  const missingReplacement = selectedScene?.available === false && !selectedNeedsReconciliation ? `<section class="wide panel lighting-missing-replacement"><span class="eyebrow">MISSING QLC+ FUNCTION</span>
        <p class="look-warning">⚠ ${escapeHtml(selectedScene.qlcMirror?.name || selectedScene.name)} (Widget ID ${escapeHtml(selectedScene.qlcMirror?.widgetId || mapping?.widgetId || 'unknown')}) is no longer available.</p>
        <p>Used by ${selectedLookReferences.length} Production Look${selectedLookReferences.length === 1 ? '' : 's'} and ${selectedCueReferences.length} Service Cue${selectedCueReferences.length === 1 ? '' : 's'}.</p>
        <div class="lighting-replacement-references">${[
          ...selectedLookReferences.map(item => ({ type: 'look', id: item.id, label: `Production Look: ${item.name}` })),
          ...selectedDirectCueReferences.map(item => ({ type: 'cue', id: item.id, label: `Service Cue: ${item.name}` })),
          ...selectedTemplateReferences.map(item => ({ type: 'template', id: item.id, label: `Quick Add Template: ${item.name}` }))
        ].map(item => `<label class="checkbox-label"><input type="checkbox" data-lighting-reference="${item.type}" value="${escapeHtml(item.id)}" checked> ${escapeHtml(item.label)}</label>`).join('')}</div>
        <label>Replace selected references with<select id="lighting-replacement-scene"><option value="">Choose an available QLC+ function</option>${availableReplacements.map(scene => `<option value="${escapeHtml(scene.id)}">${escapeHtml(scene.name)}</option>`).join('')}</select></label>
        <button type="button" id="lighting-apply-replacement">APPLY REPLACEMENT</button>
      </section>` : selectedNeedsReconciliation ? `<section class="wide panel lighting-reconciliation-review"><span class="eyebrow">NEEDS RECONCILIATION</span><p class="look-warning">This legacy record has no safe authoritative QLC+ widget identity.</p><p>No automatic remap will be performed. Review its mapping against discovered QLC+ controls.</p></section>` : '';
  const editor = selectedScene ? `<div class="settings-editor-backdrop"><section class="settings-editor panel" role="dialog" aria-modal="true">
    <div class="look-editor-header"><div><span class="eyebrow">LIGHTING SCENE</span><h1>${escapeHtml(selectedScene.name)}</h1></div><button id="lighting-editor-close">×</button></div>
    <div class="settings-form">
      ${missingReplacement}
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
      ${lightingDevice?.enabled === false ? `<section class="empty-state-card disabled-state" role="status"><span aria-hidden="true">◌</span><h2>Lighting is disabled in Trinity.</h2><p>QLC+ may still be running, but discovery and cue lighting execution are unavailable.</p><button type="button" id="lighting-open-device-settings" class="secondary-button">Open Device Settings</button></section>` : ''}

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
            ${availableScenes.length} Available · ${missingScenes.length} Missing${reconciliationScenes.length ? ` · ${reconciliationScenes.length} Needs Reconciliation` : ''} · ${state.productionLooks.length} Production Looks · ${state.runOfService.length} Service Cues
          </strong>
        </div>
        <div class="look-toolbar"><select id="lighting-scene-filter"><option value="production" ${lightingSceneFilter === 'production' ? 'selected' : ''}>Production Scenes (${productionScenes.length})</option><option value="utility" ${lightingSceneFilter === 'utility' ? 'selected' : ''}>Utility Scenes (${utilityScenes.length})</option><option value="all" ${lightingSceneFilter === 'all' ? 'selected' : ''}>All Scenes (${state.lightingScenes.length})</option></select></div>

        <div class="card-grid lighting-scene-grid">
          ${filteredScenes
            .map(scene => {
              const needsReconciliation = scene.reconciliationStatus === 'needs-reconciliation';
              const isMissing = scene.available === false && !needsReconciliation;
              const authoritativeName = scene.qlcMirror?.name || scene.externalControl?.widgetName || scene.name || 'Unnamed QLC+ function';
              const pageName = scene.qlcMirror?.pageName || null;
              const widgetType = scene.qlcMirror?.type || scene.externalControl?.widgetType || 'Button';
              const widgetId = scene.qlcMirror?.widgetId || scene.externalControl?.widgetId || null;
              const lookReferences = (state.productionLooks || [])
                .filter(look => look.lightingSceneId === scene.id);
              const cueReferences = (state.runOfService || [])
                .filter(cue => cueLightingId(cue) === scene.id);
              const usageSummary = lookReferences.length || cueReferences.length
                ? `<span><b>${lookReferences.length}</b> Production Look${lookReferences.length === 1 ? '' : 's'}</span><span><b>${cueReferences.length}</b> Service Cue${cueReferences.length === 1 ? '' : 's'}</span>`
                : '<small>Not currently used</small>';

              return `<article class="edit-card lighting-scene-card ${isMissing ? 'lighting-scene-missing' : needsReconciliation ? 'lighting-scene-reconciliation' : ''}">
                <header class="lighting-scene-card-header">
                  <div>
                    <small>Trinity classification · <span class="scene-classification-badge ${scene.productionScene === false ? 'utility' : 'production'}">${scene.productionScene === false ? 'Utility' : 'Production'}</span></small>
                    <h2>${escapeHtml(authoritativeName)}</h2>
                  </div>
                </header>

                <div class="lighting-authoritative-details">
                  <strong class="lighting-availability ${isMissing ? 'missing' : needsReconciliation ? 'reconciliation' : 'available'}">${isMissing ? '⚠ Missing in QLC+' : needsReconciliation ? 'Needs Reconciliation' : '● Available'}</strong>
                  ${pageName ? `<span>QLC+ · ${escapeHtml(pageName)}</span>` : '<span>QLC+</span>'}
                  ${isMissing && pageName ? `<small>Last known page: ${escapeHtml(pageName)}</small>` : ''}
                  ${needsReconciliation ? '<small>No automatic remap</small>' : widgetId ? `<small>${escapeHtml(widgetType)} · QLC+ Widget ${escapeHtml(widgetId)}</small>` : `<small>${escapeHtml(widgetType)}</small>`}
                </div>

                <div class="lighting-scene-usage">
                  <span class="eyebrow">USED BY</span>
                  <div class="lighting-usage-counts">${usageSummary}</div>
                </div>
                <div class="lighting-card-actions">
                  ${scene.available !== false ? `<button data-activate-lighting="${scene.id}" class="success">ACTIVATE</button>` : ''}
                  <button data-edit-lighting="${scene.id}">${isMissing ? 'REVIEW / REPLACE' : 'REVIEW'}</button>
                </div>
              </article>`;
            })
            .join('') || '<p class="empty-state">No scenes in this classification.</p>'}
        </div>
      </section>
    </div>${editor}
  `);
  document.getElementById('lighting-open-device-settings')?.addEventListener('click', () => {
    settingsSection = 'devices';
    navigateToPage('settings');
  });

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

  document.querySelectorAll('[data-activate-lighting]').forEach(button => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await window.trinity.executeLightingScene(button.dataset.activateLighting); }
      catch (error) { showNotification(error.message || 'Lighting activation failed', { type: 'error' }); }
      finally { button.disabled = false; }
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
  document.getElementById('lighting-apply-replacement')?.addEventListener('click', async () => {
    const replacementSceneId = document.getElementById('lighting-replacement-scene')?.value;
    const selectedIds = type => [...document.querySelectorAll(`[data-lighting-reference="${type}"]:checked`)].map(input => input.value);
    const selection = { productionLookIds: selectedIds('look'), serviceCueIds: selectedIds('cue'), cueTemplateIds: selectedIds('template') };
    const selectedCount = selection.productionLookIds.length + selection.serviceCueIds.length + selection.cueTemplateIds.length;
    if (!replacementSceneId || !selectedCount || !window.confirm(`Replace ${selectedCount} selected reference${selectedCount === 1 ? '' : 's'} to ${selectedScene.name}? Inherited cue usage will follow its Production Look.`)) return;
    state = await window.trinity.replaceLightingReferences(selectedScene.id, replacementSceneId, selection);
    render();
  });
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
  const readiness = !selected?.enabled ? 'Disabled' : !deviceConfigured(selected) ? 'Not configured' : diagnostic?.message || (cameraAdapterSupported(selected) ? 'Configured — not tested' : 'Adapter not implemented');
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
    const status = !device.enabled ? 'Disabled' : !deviceConfigured(device) ? 'Not configured' : device.metadata?.diagnostic?.message || (cameraAdapterSupported(device) ? 'Configured — not tested' : 'Adapter not implemented');
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
        <label class="checkbox-label"><input type="checkbox" data-preset-field="favorite" ${selectedPreset.favorite ? 'checked' : ''}> ★ Favorite — shown first on the iPad</label>
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
    && (!shotTypeFilter || shot.shotType === shotTypeFilter)
  );
  const options = (items, current, empty) => `<option value="">${empty}</option>${items.map(item => `<option value="${item.id}" ${item.id === current ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
  const card = shot => {
    const resolved = shotResolution(shot);
    const cardCameraId = shot.cameraDeviceId || resolved.camera?.id || null;
    const cardPresets = cameraScopedPresets(state.cameraPresets, cardCameraId);
    const startPreset = cardPresets.find(item => item.id === shot.cameraPresetId);
    const endPreset = cardPresets.find(item => item.id === shot.motionEndPresetId);
    const motionReady = shot.shotType === 'motion' && resolved.camera?.enabled !== false && startPreset && endPreset && cameraAdapterSupported(resolved.camera);
    const motionStatus = !resolved.camera || resolved.camera.enabled === false || !cameraAdapterSupported(resolved.camera) ? 'Unavailable' : motionReady ? 'Ready' : 'Needs Attention';
    const index = shots.indexOf(shot);
    return `<article class="shot-card ${shot.id === selectedShotId ? 'selected' : ''} ${shot.enabled ? '' : 'disabled'}" data-select-shot="${shot.id}">
      <div><span>${shot.favorite ? '★' : escapeHtml(shot.icon || '◎')}</span><strong>${escapeHtml(shot.name)}</strong><em>${escapeHtml(resolved.readiness)}</em></div>
      <small>${escapeHtml(shot.category || 'Utility')} · ${escapeHtml([shot.subject, shot.framingType].filter(Boolean).join(' · ') || 'Framing not assigned')}</small>
      ${shot.shotType === 'motion' ? `<small>${escapeHtml(resolved.camera?.name || 'Camera missing')} · ${escapeHtml(startPreset?.name || 'Missing Start')} → ${escapeHtml(endPreset?.name || 'Missing End')}</small><small>${escapeHtml(motionStyleLabels[shot.motionStyle] || `Needs Review: ${shot.motionStyle || 'style'}`)} · ${escapeHtml(motionSpeedLabels[shot.motionSpeedSetting] || 'Medium')} · <em>${motionStatus}</em></small>` : `<small>Camera: ${escapeHtml(resolved.camera?.name || 'Not assigned')} · Preset: ${escapeHtml(resolved.preset?.name || (shot.cameraPresetId ? 'Missing preset' : 'Not assigned'))}</small><small>Tracking: ${shot.trackingPreferred ? 'Preferred' : escapeHtml(shot.trackingMode || 'Off')} · Motion: ${shot.motionEnabled ? 'On' : 'Off'}</small>`}
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
  const motionStyleOptions = Object.entries(motionStyleLabels).map(([value, label]) => `<option value="${value}" ${(selected?.motionStyle || 'presetTransition') === value ? 'selected' : ''}>${label}</option>`).join('');
  const selectedEndPreset = scopedPresets.find(item => item.id === selected?.motionEndPresetId);
  const motionErrors = selectedType === 'motion' ? [
    !resolved?.camera ? 'Camera is missing' : resolved.camera.enabled === false ? 'Camera is disabled' : null,
    !selected?.cameraPresetId ? 'Start preset is required' : !resolved?.preset ? 'Start preset is missing or belongs to another camera' : null,
    !selected?.motionEndPresetId ? 'End preset is required' : !selectedEndPreset ? 'End preset is missing or belongs to another camera' : null,
    selected?.motionStyle && !motionStyleLabels[selected.motionStyle] ? 'Motion style needs review' : null,
    resolved?.camera && !cameraAdapterSupported(resolved.camera) ? 'Current camera adapter cannot recall presets' : null
  ].filter(Boolean) : [];
  const motionBlockingErrors = motionErrors.filter(error => error !== 'Motion style needs review');
  const motionStatus = !resolved?.camera || resolved.camera.enabled === false || !cameraAdapterSupported(resolved.camera) ? 'UNAVAILABLE' : motionErrors.length ? 'NEEDS ATTENTION' : 'READY';
  const capabilities = motionCapabilitiesByCamera.get(selectedCameraId) || null;
  const preparedStudioMotion = selectedCameraId ? state.live?.preparedMotions?.[selectedCameraId] || null : null;
  const lastCommandedStart = preparedStudioMotion?.shotId === selected?.id;
  const editor = selected ? `<div class="shot-editor ${selectedType === 'motion' ? 'motion-studio-editor' : ''}">
    <div class="shot-editor-heading"><div><span class="eyebrow">${selectedType === 'motion' ? 'MOTION STUDIO' : 'SHOT DETAILS'}</span><h1>${escapeHtml(selected.name)}</h1><p>${escapeHtml(selectedType === 'motion' ? motionStatus : resolved.readiness)}</p></div><div class="row-actions"><button id="shot-save" class="live-button">SAVE</button><button id="shot-duplicate">DUPLICATE</button><button id="shot-toggle">${selected.enabled ? 'DISABLE' : 'ENABLE'}</button><button class="danger" id="shot-delete">DELETE</button></div></div>
    <div class="shot-section-grid">
      <fieldset><legend>OVERVIEW</legend>${textField('Name','name',selected.name)}${textField('Description','description',selected.description)}<label>Shot Type<select data-shot-field="shotType"><option value="static" ${(selected.shotType || 'static') === 'static' ? 'selected' : ''}>Static</option><option value="motion" ${selected.shotType === 'motion' ? 'selected' : ''}>Motion</option><option value="tracking" ${selected.shotType === 'tracking' ? 'selected' : ''}>Tracking</option></select></label><label>Category<input data-shot-field="category" list="shot-categories" value="${escapeHtml(selected.category || '')}"><datalist id="shot-categories">${[...categories.values()].map(category => `<option value="${escapeHtml(category)}">`).join('')}</datalist></label>${textField('Tags','tags',(selected.tags || []).join(', '))}<label class="checkbox-label"><input type="checkbox" data-shot-field="favorite" ${selected.favorite ? 'checked' : ''}> ★ Favorite — shown first on the iPad</label><label class="checkbox-label"><input type="checkbox" data-shot-field="enabled" ${selected.enabled ? 'checked' : ''}> Enabled</label></fieldset>
      <fieldset><legend>CAMERA TARGET</legend><label>Camera<select data-shot-field="cameraDeviceId">${options(cameras, selected.cameraDeviceId, 'Resolve by role')}</select><small>${escapeHtml(resolved.camera?.name || (selected.cameraDeviceId ? 'Selected camera is missing' : 'No specific camera selected'))}</small></label><label>${selectedType === 'static' ? 'Preset' : selectedType === 'motion' ? 'START' : 'Starting Preset'}<select data-shot-field="cameraPresetId">${presetOptions(selected.cameraPresetId, 'No preset')}</select><small>${escapeHtml(resolved.preset?.name || (selected.cameraPresetId ? 'Selected preset is missing or does not match the camera' : 'No preset selected'))}</small></label>${selectedType === 'motion' ? `<div class="motion-transition-arrow" aria-hidden="true">↓</div><label>END<select data-shot-field="motionEndPresetId">${presetOptions(selected.motionEndPresetId, 'No end preset')}</select><small>${escapeHtml(selectedEndPreset?.name || (selected.motionEndPresetId ? 'Selected End preset is missing or does not match the camera' : 'No End preset selected'))}</small></label><label>Motion Style<select data-shot-field="motionStyle">${selected.motionStyle && !motionStyleLabels[selected.motionStyle] ? `<option value="${escapeHtml(selected.motionStyle)}" selected>Needs Review: ${escapeHtml(selected.motionStyle)}</option>` : ''}${motionStyleOptions}</select></label><label>Intended Speed<select data-shot-field="motionSpeedSetting">${motionSpeedOptions}</select><small>Creative intent only; current adapters do not apply speed.</small></label><label>Target Duration<input type="number" min="0" step="0.5" data-shot-duration-seconds value="${selected.motionTargetDurationMs ? selected.motionTargetDurationMs / 1000 : ''}" placeholder="Optional seconds"><small>Target only; actual duration is not guaranteed.</small></label><label class="wide">Motion Intent Notes<textarea data-shot-field="motionNotes">${escapeHtml(selected.motionNotes || '')}</textarea></label>` : ''}${selectedType === 'tracking' ? `<label class="checkbox-label"><input type="checkbox" data-shot-field="trackingPreferred" ${selected.trackingPreferred ? 'checked' : ''}> Enable Tracking</label>` : ''}<div class="resolved-shot"><em>${escapeHtml(selectedType === 'motion' ? motionStatus : resolved.readiness)}</em>${motionErrors.map(error => `<small>⚠ ${escapeHtml(error)}</small>`).join('')}</div></fieldset>
    </div>
    ${selectedType === 'motion' ? `<section class="motion-studio-summary panel"><span class="eyebrow">MOTION SUMMARY</span><h2>${escapeHtml(selected.name)}</h2><strong>${escapeHtml(resolved.camera?.name || 'Camera missing')}</strong><p>${escapeHtml(resolved.preset?.name || 'Missing Start')} → ${escapeHtml(selectedEndPreset?.name || 'Missing End')}</p><p>${escapeHtml(motionStyleLabels[selected.motionStyle] || `Needs Review: ${selected.motionStyle}`)} · ${escapeHtml(motionSpeedLabels[selected.motionSpeedSetting] || 'Medium')}${selected.motionTargetDurationMs ? ` · ~${selected.motionTargetDurationMs / 1000} sec target` : ''}</p><small>Execution today: camera preset transition to End. Start position and physical duration are not verified.</small></section>
    <section class="motion-capability-panel panel"><span class="eyebrow">EXECUTION CAPABILITY</span><h2>${escapeHtml(capabilities?.adapterType || 'Adapter not configured')}</h2><ul><li class="${capabilities?.presetTransition ? 'supported' : 'unsupported'}">${capabilities?.presetTransition ? '✓' : '○'} Camera preset transition</li><li class="unsupported">○ Trinity speed control not available</li><li class="unsupported">○ Trinity duration control not available</li><li class="unsupported">○ Stop Motion not available</li><li class="unsupported">○ Physical position feedback not available</li></ul><p>Required Start: <strong>${escapeHtml(resolved.preset?.name || 'Missing Start')}</strong></p><p>Status: ${lastCommandedStart ? `${escapeHtml(preparedStudioMotion.statusLabel)}; physical position remains unverified.` : 'NOT PREPARED · Start position not verified.'}</p><span class="eyebrow">TEST TOOLS</span><div class="row-actions"><button id="motion-prepare-start" ${motionBlockingErrors.length || !capabilities?.presetRecall ? 'disabled' : ''}>PREPARE START</button><button id="motion-run" class="live-button" ${motionBlockingErrors.length || !capabilities?.presetRecall ? 'disabled' : ''}>RUN MOTION TEST</button>${lastCommandedStart ? '<button id="motion-cancel-prep">CANCEL PREP</button>' : ''}</div><small>Production workflow: Prepare in Live, then Take Live. Run Motion Test does not switch ATEM.</small></section>` : ''}
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

  shell(`<div class="shot-library page-scroll ${shotTypeFilter === 'motion' ? 'motion-studio-workspace' : ''}"><aside class="panel shot-sidebar"><div class="section-title"><span>${shotTypeFilter === 'motion' ? 'MOTION STUDIO' : 'SHOT LIBRARY'}</span><strong>${filtered.length} ${shotTypeFilter === 'motion' ? 'Motion Shots' : 'reusable Shots'}</strong></div><div class="shot-filters"><input id="shot-search" value="${escapeHtml(shotSearch)}" placeholder="Search Shots"><select id="shot-type"><option value="" ${!shotTypeFilter ? 'selected' : ''}>All Shot types</option><option value="static" ${shotTypeFilter === 'static' ? 'selected' : ''}>Static</option><option value="motion" ${shotTypeFilter === 'motion' ? 'selected' : ''}>Motion Studio</option><option value="tracking" ${shotTypeFilter === 'tracking' ? 'selected' : ''}>Tracking</option></select><select id="shot-category"><option value="">All categories</option>${[...categories.values()].map(category => `<option ${shotCategory === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select><select id="shot-camera"><option value="">All cameras / roles</option>${cameras.map(camera => `<option value="${camera.id}" ${shotCamera === camera.id ? 'selected' : ''}>${escapeHtml(camera.name)}</option>`).join('')}${[...new Set(cameras.map(camera => camera.logicalRole).filter(Boolean))].map(role => `<option value="${escapeHtml(role)}" ${shotCamera === role ? 'selected' : ''}>Role: ${escapeHtml(role)}</option>`).join('')}</select><select id="shot-favorite"><option value="">All favorites</option><option value="true" ${shotFavorite === 'true' ? 'selected' : ''}>Favorites only</option></select><select id="shot-enabled"><option value="">Enabled and disabled</option><option value="true" ${shotEnabled === 'true' ? 'selected' : ''}>Enabled</option><option value="false" ${shotEnabled === 'false' ? 'selected' : ''}>Disabled</option></select><button id="shot-new">${shotTypeFilter === 'motion' ? '+ NEW MOTION SHOT' : 'NEW SHOT'}</button></div><div class="shot-list">${filtered.map(card).join('') || '<div class="empty-state">No matching Shots.</div>'}</div></aside><main class="panel">${editor}</main></div>`);

  document.getElementById('shot-search').oninput = event => { shotSearch = event.target.value; shotsPage(); document.getElementById('shot-search')?.focus(); };
  document.getElementById('shot-type').onchange = event => { shotTypeFilter = event.target.value; selectedShotId = filtered.find(shot => shot.shotType === shotTypeFilter)?.id || shots.find(shot => !shotTypeFilter || shot.shotType === shotTypeFilter)?.id || null; render(); };
  document.getElementById('shot-category').onchange = event => { shotCategory = event.target.value; render(); };
  document.getElementById('shot-camera').onchange = event => { shotCamera = event.target.value; render(); };
  document.getElementById('shot-favorite').onchange = event => { shotFavorite = event.target.value; render(); };
  document.getElementById('shot-enabled').onchange = event => { shotEnabled = event.target.value; render(); };
  document.getElementById('shot-new').onclick = async () => { const motion = shotTypeFilter === 'motion'; state = await window.trinity.createShot({ name: motion ? 'New Motion Shot' : 'New Shot', shotType: motion ? 'motion' : 'static', motionStyle: 'presetTransition', motionSpeedSetting: 'medium', enabled: true }); selectedShotId = state.shots.at(-1).id; render(); };
  document.querySelectorAll('[data-select-shot]').forEach(cardElement => cardElement.onclick = event => { if (event.target.closest('[data-move-shot]')) return; selectedShotId = cardElement.dataset.selectShot; render(); });
  document.querySelectorAll('[data-move-shot]').forEach(button => button.onclick = async event => { event.stopPropagation(); const from = state.shots.findIndex(shot => shot.id === button.dataset.moveShot); state = await window.trinity.reorderShot(from, from + Number(button.dataset.direction)); render(); });
  if (!selected) return;
  const save = async patch => { try { state = await window.trinity.updateShot(selected.id, patch); render(); } catch (error) { window.alert(error.message); render(); } };
  const shotFieldValue = input => {
    let value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value || null;
    if (input.dataset.shotField === 'tags') value = input.value.split(',').map(tag => tag.trim()).filter(Boolean);
    return value;
  };
  const visibleShotPatch = () => {
    const patch = Object.fromEntries(
      [...document.querySelectorAll('[data-shot-field]')].map(input => [input.dataset.shotField, shotFieldValue(input)])
    );
    const duration = document.querySelector('[data-shot-duration-seconds]');
    if (duration) patch.motionTargetDurationMs = Math.max(0, Number(duration.value) || 0) * 1000;
    return patch;
  };
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
  const durationInput = document.querySelector('[data-shot-duration-seconds]');
  if (durationInput) durationInput.onchange = () => save({ motionTargetDurationMs: Math.max(0, Number(durationInput.value) || 0) * 1000 });
  const saveButton = document.getElementById('shot-save');
  saveButton.onpointerdown = event => { event.preventDefault(); save(visibleShotPatch()); };
  saveButton.onclick = event => { if (event.detail === 0) save(visibleShotPatch()); };
  document.getElementById('shot-duplicate').onclick = async () => { state = await window.trinity.duplicateShot(selected.id); selectedShotId = state.shots.at(-1).id; render(); };
  document.getElementById('shot-toggle').onclick = () => save({ enabled: !selected.enabled });
  document.getElementById('motion-prepare-start')?.addEventListener('click', async () => {
    try {
      state = await window.trinity.prepareMotionStart(selectedCameraId, selected.id);
      showNotification('Start preset commanded. Physical position remains unverified.', { type: 'success' });
      render();
    } catch (error) { showNotification(error.message || 'Start preset could not be prepared.', { type: 'error' }); }
  });
  document.getElementById('motion-run')?.addEventListener('click', async () => {
    try {
      state = await window.trinity.runCameraMotion(selectedCameraId, selected.id);
      showNotification('Motion End preset commanded. Speed and duration remain camera-controlled.', { type: 'success' });
      render();
    } catch (error) { showNotification(error.message || 'Motion command failed.', { type: 'error' }); }
  });
  document.getElementById('motion-cancel-prep')?.addEventListener('click', async () => {
    state = await window.trinity.cancelPreparedMotion(selectedCameraId);
    render();
  });
  const remove = async () => {
    const referenceSummary = shotReferenceSummary(selected.id);
    if (!window.confirm(`Delete ${selected.name}?\n\n${Object.entries(referenceSummary.counts).map(([label,count]) => `${label}: ${count}`).join('\n')}\nTotal: ${referenceSummary.total}\n\nReferences will remain saved as missing Shot references.`)) return;
    state = await window.trinity.deleteShot(selected.id, { confirmReferences: true });
    selectedShotId = state.shots[0]?.id || null;
    render();
  };
  document.getElementById('shot-delete').onclick = remove;
  if (selectedType === 'motion' && selectedCameraId && !motionCapabilitiesByCamera.has(selectedCameraId)) {
    window.trinity.getCameraExecutionCapabilities(selectedCameraId)
      .then(value => { motionCapabilitiesByCamera.set(selectedCameraId, value); if (page === 'shots' && selectedShotId === selected.id) render(); })
      .catch(() => { motionCapabilitiesByCamera.set(selectedCameraId, { presetRecall: false, presetTransition: false }); if (page === 'shots') render(); });
  }
}

function deviceConfigured(device) {
  if (device.type === 'browserOperator') return true;
  if (device.type === 'camera') {
    const protocol = normalizedCameraControlIdentity(device.protocol || device.connection?.protocol);
    const needsUdpPort = normalizedCameraControlIdentity(device.adapterType) === 'visca-udp' || protocol.includes('visca');
    return Boolean(device.ipAddress && device.protocol && (!needsUdpPort || Number(device.port) > 0));
  }
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

async function selectBackupForImport() {
  backupBusy = true;
  render();
  try {
    const result = await window.trinity.selectTrinityBackup();
    backupImportPreview = result.canceled ? null : result.preview;
    return result;
  } catch (error) {
    backupImportPreview = null;
    showNotification(error.message || 'The backup could not be validated', { type: 'error', persistent: true });
    return { canceled: true, error };
  } finally {
    backupBusy = false;
    render();
  }
}

async function confirmSelectedBackupImport() {
  backupBusy = true;
  render();
  try {
    const result = await window.trinity.importTrinityBackup();
    state = result.state;
    backupImportPreview = null;
    showNotification(`Backup imported. ${result.preview.counts.serviceCues} service cues and ${result.preview.counts.devices} devices restored. Machine-local settings still require review.`, { type: 'success', persistent: true });
    return result;
  } catch (error) {
    showNotification(error.message || 'Backup import failed; current configuration was preserved', { type: 'error', persistent: true });
    return null;
  } finally {
    backupBusy = false;
    render();
  }
}

async function refreshSetupContext() {
  setupContext = await window.trinity.getSetupContext();
  if (setupWizardOpen) render({ reason: 'setup-context' });
  return setupContext;
}

function setupStatusBadge(item) {
  const skipped = setupSkippedSystems.has(item.id);
  const status = skipped ? 'skipped' : item.state;
  const label = skipped ? 'Skipped' : status === 'ready' ? 'Ready' : status === 'needs-review' ? 'Needs Review' : 'Not Configured';
  return `<span class="setup-status ${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function setupWizardPage() {
  const steps = ['host', 'browser', 'qlcplus', 'atem', 'cameras', 'homeAssistant', 'review'];
  const stepIndex = steps.indexOf(setupStep);
  const context = setupContext;
  const cameras = context?.cameras || [];
  const atemDevice = (state.devices || []).find(device => device.type === 'switcher' && (device.adapterType === 'atem' || device.metadata?.adapter === 'atem' || device.id === 'device-atem'));
  const qlc = context?.qlcplus?.settings || state.settings?.qlcplusService || {};
  const operatorUrl = context?.operator?.networkUrls?.[0] || context?.operator?.localUrl || 'Available after the Browser Operator starts';
  const wizardNavigation = setupStep === 'welcome' ? '' : `<div class="setup-navigation">
    <button id="setup-back" ${stepIndex <= 0 ? 'disabled' : ''}>BACK</button>
    <span>Step ${Math.max(1, stepIndex + 1)} of ${steps.length}</span>
    ${setupStep === 'review' ? '<button id="setup-finish" class="primary">FINISH SETUP</button>' : '<button id="setup-next" class="primary">NEXT</button>'}
  </div>`;
  let content;
  if (!context) {
    content = '<section class="panel setup-loading">Reading local setup status…</section>';
  } else if (setupStep === 'welcome') {
    const counts = backupImportPreview?.counts;
    content = `<section class="setup-welcome"><span class="eyebrow">TRINITY CONTROL SETUP</span><h1>Welcome to Trinity Control</h1>
      <p>This desktop computer is the production host. An iPad can be used as the remote operator surface on your trusted local network.</p>
      <p>Setup guides configuration and validation only. It will not move cameras, recall presets, switch ATEM, execute lighting, or run GO/BACK.</p>
      <div class="setup-choice-grid"><button id="setup-import" class="setup-choice">IMPORT TRINITY BACKUP<small>Validate and restore an existing portable configuration</small></button><button id="setup-new" class="setup-choice primary">SET UP AS NEW<small>Review this computer’s machine-local configuration</small></button></div>
      ${backupImportPreview ? `<section class="panel setup-import-preview"><h2>Backup ready to import</h2><p>${Number(counts.serviceCues) || 0} service cues · ${Number(counts.devices) || 0} devices · ${Number(counts.lightingScenes) || 0} lighting scenes</p><div class="settings-warning">Portable configuration will be replaced only after confirmation. QLC+ paths and credentials remain machine-local and require review.</div><div class="row-actions"><button id="setup-import-cancel">CANCEL</button><button id="setup-import-confirm" class="primary">CONFIRM IMPORT</button></div></section>` : ''}
    </section>`;
  } else if (setupStep === 'host') {
    content = `<section class="panel setup-step"><span class="eyebrow">REQUIRED</span><h1>Production Host</h1><p>This computer runs production execution. These values are read-only.</p>${diagnosticRows([
      ['Host type', context.hostLabel], ['Platform', context.platform], ['Application version', context.version], ['Computer name', context.computerName], ['Trinity data location', context.dataLocation], ['Operator server port', context.operator?.port || 4310]
    ])}</section>`;
  } else if (setupStep === 'browser') {
    content = `<section class="panel setup-step"><span class="eyebrow">REQUIRED · TRUSTED LAN</span><h1>Browser Operator</h1>${diagnosticRows([
      ['Status', context.operator?.running ? 'Enabled and running' : 'Enabled; server needs review'], ['Port', context.operator?.port || 4310], ['Operator URL', operatorUrl]
    ])}<div class="setup-guidance"><strong>iPad setup</strong><p>Open the Operator URL on the iPad → Add to Home Screen → use landscape orientation.</p><p>Browser Operator is currently available to devices that can reach this computer on the local network. A later security sprint will add access control.</p>${context.platform === 'win32' ? '<p>Windows Firewall may ask for private-network access. Trinity does not modify firewall rules automatically.</p>' : ''}</div></section>`;
  } else if (setupStep === 'qlcplus') {
    content = `<section class="panel setup-step"><span class="eyebrow">OPTIONAL</span><h1>Lighting / QLC+</h1><p>Select machine-local paths. Browsing and saving these paths does not launch QLC+ or activate lighting.</p>
      <div class="settings-form"><label class="wide">QLC+ executable / application<div class="path-picker"><input value="${escapeHtml(qlc.applicationPath || '')}" readonly><button id="setup-browse-qlc">BROWSE</button></div></label><label class="wide">QLC+ workspace<div class="path-picker"><input value="${escapeHtml(qlc.workspacePath || '')}" readonly><button id="setup-browse-workspace">BROWSE</button></div></label></div>
      ${diagnosticRows([['Executable path', context.qlcplus.applicationPathValid ? 'Valid' : qlc.applicationPath ? 'Needs review' : 'Not selected'], ['Workspace path', context.qlcplus.workspacePathValid ? 'Valid' : qlc.workspacePath ? 'Needs review' : 'Not selected'], ['Connection', context.qlcplus.status?.connectionState || context.qlcplus.status?.state || 'Not tested']])}
      <button class="setup-skip" data-setup-skip="qlcplus">${setupSkippedSystems.has('qlcplus') ? 'INCLUDE IN SETUP' : 'SKIP FOR NOW'}</button></section>`;
  } else if (setupStep === 'atem') {
    content = `<section class="panel setup-step"><span class="eyebrow">OPTIONAL</span><h1>ATEM</h1><p>Saving setup fields does not connect or switch PROGRAM.</p>${atemDevice ? `<div class="settings-form"><label>Name<input id="setup-atem-name" value="${escapeHtml(atemDevice.name)}"></label><label>Host / IP<input id="setup-atem-host" value="${escapeHtml(atemDevice.ipAddress || '')}"></label><label class="checkbox-label"><input id="setup-atem-enabled" type="checkbox" ${atemDevice.enabled ? 'checked' : ''}> Enabled</label>${cameras.map(camera => { const source = (state.videoSources || []).find(item => item.sourceType === 'camera' && item.cameraDeviceId === camera.id); return `<label>${escapeHtml(camera.name)} input<input type="number" min="1" data-setup-atem-input="${escapeHtml(camera.id)}" value="${source?.switcherMappings?.atem?.input ?? atemDevice.metadata?.atemCameraInputs?.[camera.id] ?? ''}"></label>`; }).join('')}</div><div class="row-actions"><button id="setup-save-atem">SAVE ATEM SETTINGS</button><button class="setup-skip" data-setup-skip="atem">${setupSkippedSystems.has('atem') ? 'INCLUDE IN SETUP' : 'SKIP FOR NOW'}</button></div>${diagnosticRows([['Connection state', context.atem.connectionState || 'Not tested'], ['PROGRAM input', context.atem.connectionState === 'connected' ? context.atem.programInput ?? 'Unknown' : 'Not read']])}` : '<div class="settings-warning">ATEM device record is unavailable. You can finish setup and configure it later.</div>'}</section>`;
  } else if (setupStep === 'cameras') {
    content = `<section class="panel setup-step"><span class="eyebrow">OPTIONAL</span><h1>Cameras</h1><p>These fields save configuration only. Setup cannot recall presets, run Motion, or send PTZ commands.</p><div class="setup-camera-grid">${cameras.map(camera => `<article class="panel" data-setup-camera="${escapeHtml(camera.id)}"><h2>${escapeHtml(camera.logicalRole || camera.id)}</h2><label>Name<input data-setup-camera-field="name" value="${escapeHtml(camera.name)}"></label><label>Adapter<select data-setup-camera-field="adapterType"><option value="">Not configured</option><option value="visca-udp" ${camera.adapterType === 'visca-udp' ? 'selected' : ''}>VISCA UDP</option><option value="ptzoptics" ${camera.adapterType === 'ptzoptics' ? 'selected' : ''}>PTZOptics HTTP</option></select></label><label>Protocol<input data-setup-camera-field="protocol" value="${escapeHtml(camera.protocol || '')}"></label><label>Host / IP<input data-setup-camera-field="ipAddress" value="${escapeHtml(camera.ipAddress || '')}"></label><label>Port<input type="number" data-setup-camera-field="port" value="${camera.port ?? ''}"></label><label>VISCA address<input type="number" min="1" max="7" data-setup-camera-field="viscaAddress" value="${camera.viscaAddress ?? ''}"></label><label class="checkbox-label"><input type="checkbox" data-setup-camera-field="enabled" ${camera.enabled ? 'checked' : ''}> Enabled</label><small>Presets: ${(state.cameraPresets || []).filter(preset => preset.cameraDeviceId === camera.id).length} · ${escapeHtml(deviceStatusLabel(camera.connectionStatus))}</small><button data-setup-save-camera="${escapeHtml(camera.id)}">SAVE CAMERA</button></article>`).join('')}</div><button class="setup-skip" data-setup-skip="cameras">${setupSkippedSystems.has('cameras') ? 'INCLUDE IN SETUP' : 'SKIP FOR NOW'}</button></section>`;
  } else if (setupStep === 'homeAssistant') {
    const ha = context.homeAssistant;
    content = `<section class="panel setup-step"><span class="eyebrow">OPTIONAL · MACHINE-LOCAL CREDENTIAL</span><h1>Home Assistant</h1><p>Portable backups exclude the access token. Enter a token only when it needs to be added or replaced; saved tokens are never displayed.</p><div class="settings-form"><label class="wide">Home Assistant URL<input id="setup-ha-url" value="${escapeHtml(ha.baseUrl || '')}" placeholder="http://homeassistant.local:8123"></label><label class="wide">Access token<input id="setup-ha-token" type="password" value="" placeholder="${ha.tokenConfigured ? 'Token saved — leave blank to keep it' : 'Enter a long-lived access token'}" autocomplete="new-password"></label><label class="wide">Lighting entities<textarea id="setup-ha-entities">${escapeHtml((ha.entities || []).join('\n'))}</textarea></label></div><div class="row-actions"><button id="setup-save-ha">SAVE HOME ASSISTANT SETTINGS</button><button class="setup-skip" data-setup-skip="homeAssistant">${setupSkippedSystems.has('homeAssistant') ? 'INCLUDE IN SETUP' : 'SKIP FOR NOW'}</button></div><small>Saving does not contact Home Assistant or issue a production command.</small></section>`;
  } else {
    content = `<section class="panel setup-step"><span class="eyebrow">FINAL REVIEW</span><h1>Setup Readiness</h1><p>Optional systems may remain incomplete. “Connected” appears only when authoritative runtime status confirms it.</p><div class="setup-review">${context.readiness.map(item => `<div><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.classification.toUpperCase())} · ${escapeHtml(setupSkippedSystems.has(item.id) ? 'Skipped for now' : item.detail)}</small></span>${setupStatusBadge(item)}</div>`).join('')}</div>${context.readiness.some(item => item.classification === 'optional' && item.state !== 'ready' && !setupSkippedSystems.has(item.id)) ? '<div class="settings-warning">Some optional systems remain incomplete. You may finish setup and configure them later from Settings.</div>' : ''}</section>`;
  }
  root.innerHTML = `<main class="setup-wizard"><header><img src="assets/trinity-logo.png" alt="Trinity Baptist Church"><span>FIRST-RUN SETUP</span>${state.setup?.completed ? '<button id="setup-close">CLOSE</button>' : ''}</header><div class="setup-wizard-body">${content}</div>${wizardNavigation}</main>`;
  document.getElementById('setup-close')?.addEventListener('click', () => { setupWizardOpen = false; render(); });
  document.getElementById('setup-new')?.addEventListener('click', () => { setupStep = 'host'; render(); });
  document.getElementById('setup-import')?.addEventListener('click', () => void selectBackupForImport());
  document.getElementById('setup-import-cancel')?.addEventListener('click', async () => { await window.trinity.cancelTrinityBackupImport(); backupImportPreview = null; render(); });
  document.getElementById('setup-import-confirm')?.addEventListener('click', async () => { if (await confirmSelectedBackupImport()) { await refreshSetupContext(); setupStep = 'review'; render(); } });
  document.getElementById('setup-back')?.addEventListener('click', () => { setupStep = steps[Math.max(0, stepIndex - 1)]; render(); });
  document.getElementById('setup-next')?.addEventListener('click', async () => { await refreshSetupContext(); setupStep = steps[Math.min(steps.length - 1, stepIndex + 1)]; render(); });
  document.querySelectorAll('[data-setup-skip]').forEach(button => button.onclick = () => { const id = button.dataset.setupSkip; setupSkippedSystems.has(id) ? setupSkippedSystems.delete(id) : setupSkippedSystems.add(id); render(); });
  document.getElementById('setup-browse-qlc')?.addEventListener('click', async () => { const selected = await window.trinity.browseQlcApplication(); if (selected) state = await window.trinity.updateQlcServiceSettings({ applicationPath: selected }); await refreshSetupContext(); });
  document.getElementById('setup-browse-workspace')?.addEventListener('click', async () => { const selected = await window.trinity.browseQlcWorkspace(); if (selected) state = await window.trinity.updateQlcServiceSettings({ workspacePath: selected }); await refreshSetupContext(); });
  document.getElementById('setup-save-atem')?.addEventListener('click', async () => { const mappings = {}; document.querySelectorAll('[data-setup-atem-input]').forEach(input => { if (input.value) mappings[input.dataset.setupAtemInput] = Number(input.value); }); state = await window.trinity.updateSetupDevice(atemDevice.id, { name: document.getElementById('setup-atem-name').value, ipAddress: document.getElementById('setup-atem-host').value || null, enabled: document.getElementById('setup-atem-enabled').checked, metadata: { ...(atemDevice.metadata || {}), adapter: 'atem', atemCameraInputs: mappings } }); for (const source of state.videoSources || []) { if (source.sourceType === 'camera' && mappings[source.cameraDeviceId] !== undefined) state = await window.trinity.updateVideoSource(source.id, { switcherMappings: { ...(source.switcherMappings || {}), atem: { input: mappings[source.cameraDeviceId] } } }); } await refreshSetupContext(); showNotification('ATEM settings saved without switching PROGRAM', { type: 'success' }); });
  document.querySelectorAll('[data-setup-save-camera]').forEach(button => button.onclick = async () => { const card = button.closest('[data-setup-camera]'); const patch = {}; card.querySelectorAll('[data-setup-camera-field]').forEach(input => { patch[input.dataset.setupCameraField] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? (input.value ? Number(input.value) : null) : input.value || null; }); state = await window.trinity.updateSetupDevice(button.dataset.setupSaveCamera, patch); await refreshSetupContext(); showNotification('Camera settings saved without sending a PTZ command', { type: 'success' }); });
  document.getElementById('setup-save-ha')?.addEventListener('click', async () => { const token = document.getElementById('setup-ha-token').value; await window.trinity.updateHomeAssistantConfiguration({ baseUrl: document.getElementById('setup-ha-url').value, ...(token ? { token } : {}), entities: document.getElementById('setup-ha-entities').value }); await refreshSetupContext(); showNotification('Home Assistant settings saved without contacting the server', { type: 'success' }); });
  document.getElementById('setup-finish')?.addEventListener('click', async () => { state = await window.trinity.finishSetup({ skippedSystems: [...setupSkippedSystems] }); setupWizardOpen = false; setupStep = 'welcome'; render({ reason: 'setup-finished', preserveScroll: false }); });
}

function formatDiagnosticDate(value) {
  if (!value || value === 'Never' || value === 'None recorded') return value || 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return 'Unavailable';
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function healthBadge(health) {
  const status = ['healthy', 'warning', 'error'].includes(health?.status) ? health.status : 'warning';
  return `<span class="system-health-badge ${status}">${escapeHtml(status)}</span>`;
}

function diagnosticRows(rows) {
  return `<dl class="system-status-details">${rows.map(([label, value]) =>
    `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? 'Unavailable')}</dd></div>`
  ).join('')}</dl>`;
}

function systemStatusPage() {
  if (!systemStatus) {
    return `<div class="settings-heading"><div><span class="eyebrow">READ-ONLY DIAGNOSTICS</span><h1>System Status</h1><p>Current application and production health. No controls are executed from this page.</p></div><button id="refresh-system-status" ${systemStatusLoading ? 'disabled' : ''}>${systemStatusLoading ? 'REFRESHING…' : 'REFRESH STATUS'}</button></div>
      <section class="panel system-status-empty">${systemStatusLoading ? 'Reading current system status…' : 'Select Refresh Status to load diagnostics.'}</section>`;
  }
  const cards = [
    ['Application', systemStatus.application.health, diagnosticRows([
      ['Version', systemStatus.application.version],
      ['Commit', systemStatus.application.commit],
      ['Build date', formatDiagnosticDate(systemStatus.application.buildDate)],
      ['Build configuration', systemStatus.application.buildConfiguration],
      ['Branch', systemStatus.application.branch],
      ['Environment', systemStatus.application.environment],
      ['Electron', systemStatus.application.electronVersion],
      ['Node', systemStatus.application.nodeVersion],
      ['Chrome', systemStatus.application.chromeVersion],
      ['Operating system', `${systemStatus.application.operatingSystem} · ${systemStatus.application.architecture}`]
    ])],
    ['Lighting System', systemStatus.lighting.health, diagnosticRows([
      ['QLC+ enabled', systemStatus.lighting.enabled ? 'Yes' : 'No'],
      ['QLC+ connected', systemStatus.lighting.connected ? 'Yes' : 'No'],
      ['Adapter', systemStatus.lighting.adapter],
      ['Transport', systemStatus.lighting.transport],
      ['Active lighting scene', systemStatus.lighting.activeScene],
      ['Last successful command', formatDiagnosticDate(systemStatus.lighting.lastSuccessfulCommand)],
      ['Connection status', systemStatus.lighting.connectionStatus],
      ['Missing QLC+ functions', systemStatus.lighting.unresolvedFunctionCount || 0],
      ['Affected Production Looks', systemStatus.lighting.affectedProductionLookCount || 0],
      ['Affected Service Cues', systemStatus.lighting.affectedServiceCueCount || 0]
    ])],
    ['Video Switcher · ATEM', systemStatus.atem.health, diagnosticRows([
      ['Enabled', systemStatus.atem.enabled ? 'Yes' : 'No'],
      ['Configured', systemStatus.atem.configured ? 'Yes' : 'No'],
      ['Connection state', systemStatus.atem.connectionState],
      ['Host', systemStatus.atem.host],
      ['Current PROGRAM input', systemStatus.atem.programInput],
      ['Live Source', systemStatus.atem.liveSourceName || systemStatus.atem.liveCameraName || systemStatus.atem.liveSourceId || systemStatus.atem.liveCameraId || 'None']
    ])],
    ['Production System', systemStatus.production.health, diagnosticRows([
      ['Loaded service plan', systemStatus.production.servicePlan],
      ['Current cue', systemStatus.production.currentCue],
      ['Next cue', systemStatus.production.nextCue],
      ['Current Production Look', systemStatus.production.currentLook],
      ['Snapshot available', systemStatus.production.snapshotAvailable ? 'Yes' : 'No'],
      ['Execution ready', systemStatus.production.executionReady ? 'Yes' : 'No']
    ])],
    ['Operator Controls', systemStatus.operator.health, diagnosticRows([
      ['Mode', systemStatus.operator.mode],
      ['GO ready', systemStatus.operator.goReady ? 'Yes' : 'No'],
      ['BACK ready', systemStatus.operator.backReady ? 'Yes' : 'No'],
      ['Live state', systemStatus.operator.liveState]
    ])],
    ['Production Host', systemStatus.host.health, diagnosticRows([
      ['Platform', `${systemStatus.host.platform} · ${systemStatus.host.architecture}`],
      ['Operator server', systemStatus.host.operatorServerRunning ? 'Running' : 'Not running'],
      ['Operator port', systemStatus.host.operatorPort],
      ['Operator LAN URL', systemStatus.host.operatorNetworkUrls?.[0] || systemStatus.host.operatorLocalUrl],
      ['QLC+ executable', systemStatus.host.qlcApplicationConfigured ? 'Configured' : 'Needs configuration'],
      ['QLC+ workspace', systemStatus.host.qlcWorkspaceConfigured ? 'Configured' : 'Needs configuration']
    ])],
    ['Performance', systemStatus.performance.health, diagnosticRows([
      ['Renderer FPS', rendererFps === null ? 'Unavailable' : rendererFps.toFixed(0)],
      ['Memory usage', formatBytes(systemStatus.performance.memoryBytes)],
      ['CPU time', `${Math.round(((systemStatus.performance.cpuUserMicroseconds || 0) + (systemStatus.performance.cpuSystemMicroseconds || 0)) / 1000)} ms`],
      ['Application uptime', `${Math.round(systemStatus.performance.uptimeSeconds || 0)} seconds`],
      ['Active timers', systemStatus.performance.activeTimers ?? 'Unavailable']
    ])],
    ['Storage', systemStatus.storage.health, diagnosticRows([
      ['User data', systemStatus.storage.userData],
      ['Configuration', systemStatus.storage.configuration],
      ['Service plans', systemStatus.storage.servicePlans],
      ['Logs', systemStatus.storage.logs]
    ])]
  ];
  const cameraRows = systemStatus.cameras.items.length
    ? `<div class="system-camera-list">${systemStatus.cameras.items.map(camera => `<article>
        <strong>${escapeHtml(camera.name)}</strong>
        ${diagnosticRows([
          ['Status', camera.status],
          ['Protocol', camera.protocol],
          ['Preset count', camera.presetCount],
          ['Tracking enabled', camera.tracking ? 'Yes' : 'No'],
          ['Last communication', formatDiagnosticDate(camera.lastCommunication)]
        ])}
      </article>`).join('')}</div>`
    : '<p class="system-status-muted">No cameras configured.</p>';
  cards.splice(2, 0, ['Camera System', systemStatus.cameras.health,
    `<p class="system-status-count">${systemStatus.cameras.configuredCount} configured</p>${cameraRows}`]);
  return `<div class="settings-heading"><div><span class="eyebrow">READ-ONLY DIAGNOSTICS</span><h1>System Status</h1><p>Current application and production health. No controls are executed from this page.</p></div><button id="refresh-system-status" ${systemStatusLoading ? 'disabled' : ''}>${systemStatusLoading ? 'REFRESHING…' : 'REFRESH STATUS'}</button></div>
    <p class="system-status-timestamp">Updated ${escapeHtml(formatDiagnosticDate(systemStatus.generatedAt))}</p>
    <div class="system-status-grid">${cards.map(([title, health, content]) => `<section class="panel system-status-card">
      <div class="system-status-card-heading"><div><h2>${escapeHtml(title)}</h2><small>${escapeHtml(health.message)}</small></div>${healthBadge(health)}</div>
      ${content}
    </section>`).join('')}</div>`;
}

function measureRendererFps(durationMs = 350) {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve(null);
  return new Promise(resolve => {
    const started = performance.now();
    let frames = 0;
    const sample = timestamp => {
      frames += 1;
      if (timestamp - started >= durationMs) resolve(frames * 1000 / (timestamp - started));
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function refreshSystemStatus() {
  if (systemStatusLoading) return;
  systemStatusLoading = true;
  render();
  try {
    [systemStatus, rendererFps] = await Promise.all([
      window.trinity.getSystemStatus(),
      measureRendererFps()
    ]);
  } catch (error) {
    showNotification(`System status could not be refreshed: ${error.message}`, { type: 'error' });
  } finally {
    systemStatusLoading = false;
    render();
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
    ['diagnostics', 'Diagnostics'],
    ['backup', 'Backup & Transfer'],
    ['systemStatus', 'System Status'],
    ['runSetup', 'Run Setup Wizard']
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
  const selectedIsAtem = selected?.type === 'switcher' && (selected.adapterType === 'atem' || selected.metadata?.adapter === 'atem' || selected.id === 'device-atem');
  const selectedReferences = selected?.type === 'camera' ? cameraReferenceSummary(selected.id) : null;
  const summary = device => {
    const diagnostic = device.metadata?.diagnostic;
    if (device.type === 'lighting' && device.adapterType === 'qlcplus-websocket') {
      const enabled = device.enabled !== false;
      const processLabel = qlcServiceStatus?.processState === 'running-managed'
        ? 'Running · Trinity-owned'
        : qlcServiceStatus?.processState === 'running-external'
          ? 'Running · External'
          : 'Stopped';
      const connectionLabel = enabled && qlcServiceStatus?.connectionState === 'connected'
        ? 'Connected'
        : enabled ? 'Disconnected' : 'Not managed';
      const executionLabel = enabled && qlcServiceStatus?.executionAvailability === 'available'
        ? 'Available'
        : 'Unavailable';
      const controls = Number(qlcServiceStatus?.compatibility?.productionButtonCount)
        || (device.metadata?.qlcplusWidgets || []).filter(widget => widget.canActivateScene === true).length;
      return `<article class="device-card ${enabled ? '' : 'disabled'}">
        <div class="device-card-head"><span class="device-type">lighting</span><strong>${escapeHtml(device.name)}</strong></div>
        <div class="device-facts"><span>${enabled ? 'Enabled in Trinity' : 'Disabled in Trinity'}</span><span>${deviceConfigured(device) ? 'Configured' : 'Not configured'}</span><span>Process: ${escapeHtml(processLabel)}</span><span>Connection: ${escapeHtml(connectionLabel)}</span><span>Lighting execution: ${escapeHtml(executionLabel)}</span><span>Controls discovered: ${controls}</span></div>
        <small>${escapeHtml(!enabled && processLabel !== 'Stopped' ? 'QLC+ process still running. Trinity monitoring and execution are disabled.' : qlcServiceStatus?.message || diagnostic?.message || 'Status not checked')}</small>
        <div class="row-actions"><button data-configure-device="${device.id}">CONFIGURE</button><button data-toggle-device="${device.id}">${enabled ? 'DISABLE IN TRINITY' : 'ENABLE IN TRINITY'}</button><button data-duplicate-device="${device.id}">DUPLICATE</button><button class="danger" data-delete-device="${device.id}">DELETE</button></div>
      </article>`;
    }
    if (device.type === 'switcher' && (device.adapterType === 'atem' || device.metadata?.adapter === 'atem' || device.id === 'device-atem')) {
      return `<article class="device-card ${device.enabled ? '' : 'disabled'}">
        <div class="device-card-head"><span class="device-type">switcher</span><strong>${escapeHtml(device.name)}</strong></div>
        <div class="device-facts"><span>${device.enabled ? 'Enabled' : 'Disabled'}</span><span>${deviceConfigured(device) ? 'Configured' : 'Not configured'}</span><span>${escapeHtml(atemStatus?.connectionState || 'Unknown')}</span></div>
        <small>${escapeHtml(device.ipAddress || device.connection?.host || 'No host assigned')}</small>
        <small>PROGRAM input: ${escapeHtml(atemStatus?.programInput ?? 'Unknown')} · LIVE camera: ${escapeHtml(atemStatus?.liveCameraId || 'Unmapped / none')}</small>
        <div class="row-actions"><button data-configure-device="${device.id}">CONFIGURE</button><button data-toggle-device="${device.id}">${device.enabled ? 'DISABLE' : 'ENABLE'}</button></div>
      </article>`;
    }
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
      <div class="device-card-head camera-config-card-head"><span class="role-pill">${escapeHtml(camera.logicalRole)}</span><strong class="camera-config-name" title="${escapeHtml(camera.name)}">${escapeHtml(camera.name)}</strong></div>
      <div class="device-facts"><span>${camera.enabled ? 'Enabled' : 'Disabled'}</span><span>${deviceConfigured(camera) ? 'Configured' : 'Not configured'}</span><span>${escapeHtml(deviceStatusLabel(camera.connectionStatus))}</span></div>
      <small>${escapeHtml([camera.manufacturer, camera.model].filter(Boolean).join(' ') || 'Manufacturer/model not assigned')}</small>
      <small>${escapeHtml(camera.ipAddress || 'No IP address')} · ${escapeHtml(camera.protocol || 'No protocol')}</small>
      <small>Tracking ${camera.trackingEnabled ? 'Yes' : 'No'} · Motion ${camera.motionEnabled ? 'Yes' : 'No'} · Presets ${camera.presetSupport ? (legacy?.savedPositions?.length || 'Supported') : 'No'}</small>
      <div class="row-actions settings-card-actions"><button data-configure-device="${camera.id}">RENAME / EDIT</button><button data-duplicate-device="${camera.id}">DUPLICATE</button><button data-toggle-device="${camera.id}">${camera.enabled ? 'DISABLE' : 'ENABLE'}</button><button data-test-device="${camera.id}">TEST</button><button data-move-device="${camera.id}" data-direction="-1" aria-label="Move ${escapeHtml(camera.name)} up" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button><button data-move-device="${camera.id}" data-direction="1" aria-label="Move ${escapeHtml(camera.name)} down" title="Move down" ${index === cameras.length - 1 ? 'disabled' : ''}>↓</button><button class="danger" data-delete-device="${camera.id}">DELETE</button></div>
    </article>`;
  };
  const editor = selected ? `<div class="settings-editor-backdrop"><section class="settings-editor panel" role="dialog" aria-modal="true">
    <div class="look-editor-header"><div><span class="eyebrow">DEVICE CONFIGURATION</span><h1>${escapeHtml(selected.name)}</h1></div><button id="device-editor-close">×</button></div>
    <div class="settings-form">
      <label>Name<input data-device-field="name" value="${escapeHtml(selected.name)}"></label>
      ${selected.type === 'camera' ? `<label>Logical role<input data-device-field="logicalRole" list="camera-roles" value="${escapeHtml(selected.logicalRole || '')}"><datalist id="camera-roles">${['main','left','right','audience','pastor','choir'].map(role => `<option value="${role}">`).join('')}</datalist></label>` : ''}
      ${selected.type === 'camera' ? `<label>Camera adapter<select data-device-field="adapterType"><option value="" ${!selected.adapterType ? 'selected' : ''}>Not configured</option><option value="visca-udp" ${selected.adapterType === 'visca-udp' ? 'selected' : ''}>VISCA over UDP</option><option value="ptzoptics" ${selected.adapterType === 'ptzoptics' ? 'selected' : ''}>PTZOptics HTTP CGI (legacy)</option></select></label>` : ''}
      ${selectedIsAtem ? '<span class="wide field-help">ATEM control and status use the switcher Ethernet connection only. No video is ingested.</span>' : `<label>Manufacturer<input data-device-field="manufacturer" value="${escapeHtml(selected.manufacturer || '')}"></label><label>Model<input data-device-field="model" value="${escapeHtml(selected.model || '')}"></label>`}
      <label>IP address / host<input data-device-field="ipAddress" value="${escapeHtml(selected.ipAddress || selected.connection?.host || '')}"></label>
      ${selectedIsAtem ? '' : `<label>Port<input type="number" min="0" max="65535" data-device-field="port" value="${selected.port ?? ''}"></label>`}
      ${selectedIsAtem ? '' : selected.type === 'camera' ? `<label>Protocol<select data-device-field="protocol"><option value="" ${!selected.protocol ? 'selected' : ''}>Not configured</option><option value="visca-udp" ${['visca-udp','visca-over-ip','visca-ip'].includes(normalizedCameraControlIdentity(selected.protocol)) ? 'selected' : ''}>VISCA (UDP)</option><option value="http" ${selected.protocol === 'http' ? 'selected' : ''}>HTTP</option><option value="https" ${selected.protocol === 'https' ? 'selected' : ''}>HTTPS</option></select></label>` : `<label>Protocol<input data-device-field="protocol" value="${escapeHtml(selected.protocol || '')}"></label>`}
      ${selected.type === 'camera' ? `<label>VISCA address<input type="number" min="1" max="7" data-device-field="viscaAddress" value="${selected.viscaAddress ?? ''}" placeholder="1"></label>` : ''}
      ${selectedIsAtem ? `<section class="wide video-source-settings"><span class="eyebrow">VIDEO SWITCHING</span><p>Active Switcher: <strong>ATEM</strong></p>${(state.videoSources || []).map(source => `<div class="video-source-settings-row" data-video-source-row="${escapeHtml(source.id)}"><label>Name<input data-video-source-name value="${escapeHtml(source.name)}"></label><label>Type<select data-video-source-type><option value="camera" ${source.sourceType === 'camera' ? 'selected' : ''}>Camera</option><option value="video" ${source.sourceType === 'video' ? 'selected' : ''}>Video</option></select></label>${source.sourceType === 'camera' ? `<label>Linked Camera<select data-video-source-camera>${productionDirectorCameras().map(camera => `<option value="${escapeHtml(camera.id)}" ${source.cameraDeviceId === camera.id ? 'selected' : ''}>${escapeHtml(camera.name)}</option>`).join('')}</select></label>` : ''}<label>ATEM Input<input type="number" min="1" data-video-source-atem-input value="${source.switcherMappings?.atem?.input ?? ''}" placeholder="Unmapped"></label>${source.needsReview ? '<small class="look-warning">Needs Review: input conflict detected during migration.</small>' : ''}</div>`).join('')}</section>` : `<label>Username<input data-device-field="username" value="${escapeHtml(selected.username || '')}"></label><label>Credential<input type="password" data-device-field="credentialReference" value="${escapeHtml(selected.credentialReference || '')}" autocomplete="new-password"></label>`}
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
      <div class="camera-settings-collection"><div class="device-grid camera-settings-grid">${cameras.map(cameraCard).join('')}</div></div>`;
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
      <section class="panel qlc-service-panel"><div class="section-title"><span>QLC+ SERVICE</span><strong id="qlc-service-message">${escapeHtml(qlcServiceStatus?.message || 'Status not checked')}</strong></div>
        <div class="device-facts"><span>Status: <b id="qlc-service-state">${escapeHtml(qlcServiceStatus?.state || 'unknown')}</b></span><span>Launch mode: ${escapeHtml(serviceLaunchMode)}</span><span>Workspace: ${escapeHtml(workspaceName)}</span><span>Compatibility: ${escapeHtml(compatibility)}</span><span>Controls: ${Number(qlcServiceStatus?.compatibility?.productionButtonCount) || 0} production buttons discovered</span></div>
        <div class="row-actions"><button id="qlc-service-start" ${serviceConnected || lightingDevice?.enabled === false ? 'disabled' : ''}>START QLC+</button><button id="qlc-service-restart" ${qlcServiceStatus?.owned && lightingDevice?.enabled !== false ? '' : 'disabled'}>RESTART QLC+</button><button id="qlc-service-refresh" ${lightingDevice?.enabled === false ? 'disabled' : ''}>RECONNECT</button><button id="qlc-open-configuration">OPEN QLC+ CONFIGURATION</button></div>
      </section>
      <section class="panel settings-form" id="qlc-service-configuration"><span class="eyebrow wide">QLC+ SERVICE SETTINGS</span>
        <label class="checkbox-label"><input type="checkbox" data-qlc-service-field="manageAutomatically" ${serviceSettings.manageAutomatically ? 'checked' : ''}> Manage QLC+ Automatically</label>
        <label class="wide">QLC+ Application<div class="path-picker"><input data-qlc-service-field="applicationPath" value="${escapeHtml(serviceSettings.applicationPath || '')}" placeholder="${appInfo?.platform === 'win32' ? 'C:\\Program Files\\QLC+\\qlcplus.exe' : '/Applications/QLC+.app'}"><button type="button" id="qlc-browse-application">BROWSE</button></div></label>
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
        <label class="checkbox-label"><input type="checkbox" data-lighting-device-field="enabled" ${lightingDevice.enabled ? 'checked' : ''}> Enabled in Trinity</label>
      </section>
      <div class="settings-editor-actions"><div class="qlc-discovery-summary">${diagnostic?.widgetCount !== undefined ? discoverySummary : escapeHtml(diagnostic?.message || 'QLC+ has not been tested.')}</div><label class="checkbox-label"><input type="checkbox" id="qlc-show-all-controls" ${showAllDiscoveredLightingControls ? 'checked' : ''}> Show All Controls</label><button id="qlc-test-connection">TEST CONNECTION</button><button id="qlc-discover-controls">REFRESH CONTROLS</button></div>
      ${widgets.length ? `<div class="section-title"><span>${escapeHtml(showAllDiscoveredLightingControls ? 'All QLC+ Controls' : productionPage ? `${productionPage} Controls` : 'Compatible QLC+ Controls')}</span></div><div class="diagnostic-table">${visibleWidgets.map(widget => `<div><strong>${escapeHtml(widget.name)}</strong><span>ID ${escapeHtml(widget.widgetId)}</span><span>${escapeHtml(widget.widgetType || 'Unknown')}</span><span>${escapeHtml(widget.status || 'Unknown')}</span><span>${widget.canActivateScene ? 'Scene-capable' : 'Read only'}</span>${showAllDiscoveredLightingControls ? `<span>${escapeHtml(widget.pageName || 'Page unavailable')}</span>` : ''}</div>`).join('')}</div>` : ''}` : '<div class="settings-warning">No lighting device is configured.</div>'}`;
  } else if (settingsSection === 'diagnostics') {
    body = `<div class="settings-heading"><div><span class="eyebrow">STUB ADAPTER STATUS</span><h1>Diagnostics</h1><p>Results are configuration checks only; no hardware connection is attempted.</p></div><button id="run-all-tests">RUN ALL TESTS</button></div>
      <div class="diagnostic-table">${devices.map(device => { const result = device.metadata?.diagnostic; return `<div><strong>${escapeHtml(device.name)}</strong><span>${escapeHtml(device.type)}</span><span>${deviceConfigured(device) ? 'Configured' : 'Not configured'}</span><span>${device.enabled ? 'Enabled' : 'Disabled'}</span><span>${escapeHtml(deviceStatusLabel(device.connectionStatus))}</span><span>${escapeHtml(result?.message || 'Not tested')}</span><button data-test-device="${device.id}">TEST</button><button data-clear-diagnostic="${device.id}">CLEAR</button></div>`; }).join('')}</div>`;
  } else if (settingsSection === 'backup') {
    const countRows = preview => [
      ['Service Cues', preview.counts.serviceCues], ['Quick Add Templates', preview.counts.quickAddTemplates],
      ['Production Looks', preview.counts.productionLooks], ['Lighting Scenes', preview.counts.lightingScenes],
      ['Cameras', preview.counts.cameras], ['Camera Presets', preview.counts.cameraPresets],
      ['Shots', preview.counts.shots], ['Devices', preview.counts.devices]
    ].map(([label, count]) => `<div><span>${label}</span><strong>${Number(count) || 0}</strong></div>`).join('');
    body = `<div class="settings-heading"><div><span class="eyebrow">PORTABLE CONFIGURATION</span><h1>Backup & Transfer</h1><p>Move Trinity configuration between computers or create a safety backup.</p></div></div>
      <div class="backup-transfer-grid">
        <section class="panel backup-transfer-panel"><div><span class="eyebrow">EXPORT</span><h2>Create a Trinity backup</h2><p>Creates one portable file containing production configuration and stable IDs.</p></div><button id="backup-export" ${backupBusy ? 'disabled' : ''}>${backupBusy ? 'WORKING…' : 'EXPORT TRINITY BACKUP'}</button><small>Last Export: ${lastBackupExportAt ? escapeHtml(new Date(lastBackupExportAt).toLocaleString()) : 'Not exported in this application session'}</small></section>
        <section class="panel backup-transfer-panel"><div><span class="eyebrow">IMPORT</span><h2>Restore a Trinity backup</h2><p>Selecting a file only validates and previews it. Nothing is replaced until you confirm.</p></div><button id="backup-select" ${backupBusy ? 'disabled' : ''}>SELECT BACKUP FILE</button><small>Passwords, tokens, runtime status, and computer-specific QLC+ paths are not transferred.</small></section>
      </div>
      ${backupImportPreview ? `<section class="panel backup-preview" role="region" aria-labelledby="backup-preview-title">
        <div><span class="eyebrow">TRINITY BACKUP</span><h2 id="backup-preview-title">Ready to import</h2></div>
        <div class="backup-metadata"><span>Created <strong>${escapeHtml(new Date(backupImportPreview.createdAt).toLocaleString())}</strong></span><span>Trinity Version <strong>${escapeHtml(backupImportPreview.trinityVersion)}</strong></span><span>Backup Format <strong>${backupImportPreview.backupFormatVersion}</strong></span></div>
        <div class="backup-counts">${countRows(backupImportPreview)}</div>
        <div class="settings-warning"><strong>This is a replace operation.</strong> Importing this backup will replace the portable Trinity configuration on this computer. A recovery backup of the current configuration will be created first.</div>
        <div class="backup-preview-actions"><button id="backup-cancel">CANCEL</button><button id="backup-confirm" class="primary" ${backupBusy ? 'disabled' : ''}>IMPORT BACKUP</button></div>
      </section>` : ''}`;
  } else if (settingsSection === 'systemStatus') {
    body = systemStatusPage();
  } else {
    body = `<div class="coming-later"><span class="eyebrow">${escapeHtml(settingsSection.toUpperCase())}</span><h1>Coming later</h1><p>This Settings section is reserved for a future hardware-independent configuration adapter.</p></div>`;
  }

  shell(`<div class="settings-layout"><aside class="settings-nav"><div class="settings-admin-label">⚠ ADMINISTRATOR SETTINGS</div>${sections.map(([id,label]) => `<button class="${settingsSection === id ? 'active' : ''}" data-settings-section="${id}">${label}</button>`).join('')}</aside><section class="settings-content page-scroll">${body}</section></div>${editor}`);
  document.querySelectorAll('[data-settings-section]').forEach(button => button.onclick = () => {
    if (button.dataset.settingsSection === 'runSetup') {
      setupWizardOpen = true;
      setupStep = 'welcome';
      setupSkippedSystems = new Set(state.setup?.skippedSystems || []);
      render({ reason: 'setup-reopened', preserveScroll: false });
      void refreshSetupContext();
      return;
    }
    settingsSection = button.dataset.settingsSection;
    selectedDeviceId = null;
    render();
    if (settingsSection === 'systemStatus' && !systemStatus) void refreshSystemStatus();
  });
  document.getElementById('refresh-system-status')?.addEventListener('click', () => void refreshSystemStatus());
  document.getElementById('backup-export')?.addEventListener('click', async () => {
    backupBusy = true; render();
    try {
      const result = await window.trinity.exportTrinityBackup();
      if (!result.canceled) { lastBackupExportAt = Date.now(); showNotification('Trinity backup exported', { type: 'success' }); }
    } catch (error) { showNotification(error.message || 'Backup export failed', { type: 'error' }); }
    finally { backupBusy = false; render(); }
  });
  document.getElementById('backup-select')?.addEventListener('click', async () => {
    await selectBackupForImport();
  });
  document.getElementById('backup-cancel')?.addEventListener('click', async () => {
    await window.trinity.cancelTrinityBackupImport(); backupImportPreview = null; render();
  });
  document.getElementById('backup-confirm')?.addEventListener('click', async () => {
    await confirmSelectedBackupImport();
  });
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
  document.querySelectorAll('[data-toggle-device]').forEach(button => button.onclick = async () => {
    const device = byId(state.devices, button.dataset.toggleDevice);
    state = device.type === 'lighting' && device.adapterType === 'qlcplus-websocket'
      ? await window.trinity.setQlcDeviceEnabled(!device.enabled)
      : await window.trinity.updateDevice(device.id, { enabled: !device.enabled });
    render();
  });
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
  document.querySelectorAll('[data-atem-camera-input]').forEach(input => input.onchange = async () => {
    const cameraInputs = { ...(selected.metadata?.atemCameraInputs || {}) };
    if (input.value === '') delete cameraInputs[input.dataset.atemCameraInput];
    else cameraInputs[input.dataset.atemCameraInput] = Number(input.value);
    state = await window.trinity.updateDevice(selected.id, {
      metadata: { ...(selected.metadata || {}), adapter: 'atem', atemCameraInputs: cameraInputs }
    });
    render();
  });
  document.querySelectorAll('[data-video-source-row]').forEach(row => row.onchange = async () => {
    const current = (state.videoSources || []).find(source => source.id === row.dataset.videoSourceRow);
    const input = row.querySelector('[data-video-source-atem-input]').value;
    state = await window.trinity.updateVideoSource(current.id, {
      name: row.querySelector('[data-video-source-name]').value,
      sourceType: row.querySelector('[data-video-source-type]').value,
      cameraDeviceId: row.querySelector('[data-video-source-camera]')?.value || null,
      switcherMappings: { ...(current.switcherMappings || {}), atem: { input: input === '' ? null : Number(input) } },
      needsReview: false
    });
    render();
  });
  document.querySelectorAll('[data-lighting-device-field]').forEach(input => input.onchange = async () => {
    const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? (input.value ? Number(input.value) : null) : input.value || null;
    state = input.dataset.lightingDeviceField === 'enabled'
      ? await window.trinity.setQlcDeviceEnabled(value)
      : await window.trinity.updateDevice(lightingDevice.id, { [input.dataset.lightingDeviceField]: value });
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

function updateQlcStatusElements() {
  if (!state) return;
  const qlcDevice = (state.devices || []).find(device =>
    device.type === 'lighting' && device.adapterType === 'qlcplus-websocket'
  );
  const readiness = !qlcDevice
    ? 'All Systems Ready'
    : qlcDevice.enabled === false
      ? 'Ready with Lighting Disabled'
      : qlcServiceStatus?.state !== 'connected'
        ? 'Attention Required'
        : qlcServiceStatus?.compatibility?.severity === 'warning'
          ? 'Systems Ready · Lighting Warning'
          : 'All Systems Ready';
  const badge = document.querySelector('.topbar .ready');
  if (badge) badge.innerHTML = `<i></i>${escapeHtml(readiness)}`;
  const stateLabel = document.getElementById('qlc-service-state');
  if (stateLabel) stateLabel.textContent = qlcServiceStatus?.state || 'Unknown';
  const messageLabel = document.getElementById('qlc-service-message');
  if (messageLabel) messageLabel.textContent = qlcServiceStatus?.message || '';
}

function render({ reason = 'application-state-change', preserveScroll = true } = {}) {
  if (!state) {
    return;
  }
  if (renderInProgress) return;
  renderInProgress = true;
  renderSequence += 1;
  const scrollSnapshot = preserveScroll
    ? window.TrinityRendererLifecycle.captureScrollState(page)
    : null;

  try {
    if (setupWizardOpen) {
      setupWizardPage();
    } else if (page === 'live') {
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
  } finally {
    renderInProgress = false;
  }
  if (scrollSnapshot) requestAnimationFrame(() => {
    window.TrinityRendererLifecycle.restoreScrollState(scrollSnapshot, page);
  });
}

document.addEventListener('keydown', async event => {
  if (setupWizardOpen) return;
  const tag = event.target?.tagName?.toLowerCase();
  if (event.isComposing || event.repeat || cueEditorOpen || ['input', 'textarea', 'select'].includes(tag) || event.target?.isContentEditable) {
    if (event.key === 'Escape' && cueEditorOpen) document.querySelector('.cue-editor-close')?.click();
    return;
  }
  const command = ({ ArrowRight: 'next', ArrowLeft: 'back', h: 'hold', H: 'hold', Escape: 'escape' })[event.key];
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
    window.trinity.onNavigate(nextPage => navigateToPage(nextPage));
    window.trinity.onShowAbout(() => { void openApplicationDialog('about'); });
    window.trinity.onShowKeyboardShortcuts(() => { void openApplicationDialog('shortcuts'); });
    window.trinity.onStateChanged(nextState => {
      if (!state) pendingState = nextState;
      else {
        const previousReconciliation = (state.devices || []).find(device => device.type === 'lighting')?.metadata?.lightingReconciliation;
        const nextReconciliation = (nextState.devices || []).find(device => device.type === 'lighting')?.metadata?.lightingReconciliation;
        if (JSON.stringify(previousReconciliation) !== JSON.stringify(nextReconciliation)) {
          const impacted = (nextReconciliation?.removed || []).filter(item =>
            (item.dependencies?.productionLooks?.length || 0) + (item.dependencies?.serviceCues?.length || 0) + (item.dependencies?.cueTemplates?.length || 0) > 0
          );
          if (impacted.length) {
            const dependencyTotal = impacted.reduce((total, item) => total +
              (item.dependencies.productionLooks.length + item.dependencies.serviceCues.length + item.dependencies.cueTemplates.length), 0);
            showNotification(`Lighting configuration changed: ${impacted.length} removed QLC+ function${impacted.length === 1 ? '' : 's'} affect ${dependencyTotal} relationship${dependencyTotal === 1 ? '' : 's'}. Review the Lighting Library.`, { type: 'warning' });
          }
        }
        if (window.TrinityRendererLifecycle.equivalentState(state, nextState)) {
          state = nextState;
          updateQlcStatusElements();
          return;
        }
        state = nextState;
        render({ reason: 'operator-state-changed' });
      }
    });
    window.trinity.onQlcServiceStatusChanged(status => {
      const unchanged = window.TrinityRendererLifecycle.equivalentStatus(qlcServiceStatus, status);
      qlcServiceStatus = status;
      if (!state) return;
      if (unchanged) updateQlcStatusElements();
      else render({ reason: 'qlc-service-status-changed' });
    });
    window.trinity.onVideoSwitcherStatusChanged(status => {
      atemStatus = status;
      if (state && (page === 'live' || page === 'settings')) render({ reason: 'atem-status-changed' });
    });
    const [initialState, initialServerStatus, initialQlcServiceStatus, initialAtemStatus, initialAppInfo] = await Promise.all([
      window.trinity.getState(),
      window.trinity.getOperatorServerStatus(),
      window.trinity.getQlcServiceStatus(),
      window.trinity.getVideoSwitcherStatus(),
      window.trinity.getAppInfo()
    ]);
    state = pendingState || initialState;
    operatorServerStatus = initialServerStatus;
    qlcServiceStatus = initialQlcServiceStatus;
    atemStatus = initialAtemStatus;
    appInfo = initialAppInfo;

    setupWizardOpen = state.setup?.completed !== true;
    setupSkippedSystems = new Set(state.setup?.skippedSystems || []);
    if (setupWizardOpen) setupContext = await window.trinity.getSetupContext();

    render({ reason: 'initial-load', preserveScroll: false });
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
