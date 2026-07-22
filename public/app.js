const root = document.getElementById('app');

let state;
let page = 'live';

const nav = [
  ['live', 'LIVE'],
  ['service', 'SERVICE'],
  ['looks', 'LOOKS'],
  ['lighting', 'LIGHTING'],
  ['cameras', 'CAMERAS']
];

const byId = (items, id) => items.find(item => item.id === id);

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
          All Systems Ready
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
  const isProgram =
    state.live.programCamera === camera.id;

  const isPreview =
    state.live.previewCamera === camera.id;

  const selected = isProgram
  ? state.live.programPreset
  : isPreview
    ? state.live.previewPreset
    : camera.lastPreset || 'Stage Wide';

  return `
    <article
      class="camera-monitor
        ${isProgram ? 'program' : ''}
        ${isPreview ? 'preview' : ''}"
      data-take-camera="${camera.id}"
    >
      <div class="monitor-topline">
        <span>
          ${
            isProgram
              ? '● LIVE'
              : isPreview
                ? '● PREVIEW'
                : 'CAMERA'
          }
        </span>

        <strong>${escapeHtml(camera.name)}</strong>
      </div>

      <div class="video-placeholder">
        <div class="lens">◎</div>

        <div>
          ${isProgram ? 'PROGRAM OUTPUT' : 'LIVE CAMERA VIEW'}
        </div>

        <small>
          ${escapeHtml(selected || 'Stage Wide')}
        </small>
      </div>

      <div class="camera-controls">
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

        <button
          class="${isProgram ? 'live-button' : ''}"
          data-take-button="${camera.id}"
        >
          ${isProgram ? 'ON AIR' : 'TAKE LIVE'}
        </button>
      </div>
    </article>
  `;
}

async function activateCue(index) {
  state = await window.trinity.goCue(index);
  return state;
}

function openCueEditor(index) {
  const cue = state.runOfService[index];

  if (!cue) {
    return;
  }

  document
    .querySelector('.cue-editor-backdrop')
    ?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'cue-editor-backdrop';

  backdrop.innerHTML = `
    <section
      class="cue-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cue-editor-title"
    >
      <div class="cue-editor-header">
        <h2 id="cue-editor-title">
          Edit Service Cue
        </h2>

        <button
          type="button"
          class="cue-editor-close"
          aria-label="Close cue editor"
        >
          ×
        </button>
      </div>

      <div class="cue-editor-body">
        <label>
          Cue Name

          <input
            id="cue-edit-name"
            value="${escapeHtml(cue.name || '')}"
            maxlength="80"
          >
        </label>

        <label>
          Production Look

          <select id="cue-edit-look">
            ${state.productionLooks
              .map(
                look =>
                  `<option
                    value="${look.id}"
                    ${
                      look.id === cue.productionLookId
                        ? 'selected'
                        : ''
                    }
                  >
                    ${escapeHtml(look.name)}
                  </option>`
              )
              .join('')}
          </select>
        </label>

        <label>
          Lighting Scene Override

          <select id="cue-edit-lighting">
            <option value="">
              Use Production Look
            </option>

            ${state.lightingScenes
              .map(
                scene =>
                  `<option
                    value="${scene.id}"
                    ${
                      scene.id === cue.lightingSceneId
                        ? 'selected'
                        : ''
                    }
                  >
                    ${escapeHtml(scene.name)}
                  </option>`
              )
              .join('')}
          </select>
        </label>

        <label>
          Camera Layout Override

          <select id="cue-edit-camera">
            <option value="">
              Use Production Look
            </option>

            ${state.cameraLayouts
              .map(
                layout =>
                  `<option
                    value="${layout.id}"
                    ${
                      layout.id === cue.cameraLayoutId
                        ? 'selected'
                        : ''
                    }
                  >
                    ${escapeHtml(layout.name)}
                  </option>`
              )
              .join('')}
          </select>
        </label>

        <label>
          Notes

          <textarea
            id="cue-edit-notes"
            placeholder="Operator notes for this cue"
          >${escapeHtml(cue.notes || '')}</textarea>
        </label>

        <div class="cue-editor-effective">
          <div>
            <span>EFFECTIVE LIGHTING</span>
            <strong id="cue-effective-lighting"></strong>
          </div>

          <div>
            <span>EFFECTIVE CAMERA LAYOUT</span>
            <strong id="cue-effective-camera"></strong>
          </div>
        </div>
      </div>

      <div class="cue-editor-actions">
        <button
          type="button"
          class="cancel-cue"
        >
          Cancel
        </button>

        <button
          type="button"
          class="save-cue"
        >
          Save Cue
        </button>
      </div>
    </section>
  `;

  document.body.appendChild(backdrop);

  const nameInput =
    backdrop.querySelector('#cue-edit-name');

  const lookSelect =
    backdrop.querySelector('#cue-edit-look');

  const lightingSelect =
    backdrop.querySelector('#cue-edit-lighting');

  const cameraSelect =
    backdrop.querySelector('#cue-edit-camera');

  const notesInput =
    backdrop.querySelector('#cue-edit-notes');

  const close = () => {
    backdrop.remove();
  };

  const updateEffective = () => {
    const look = byId(
      state.productionLooks,
      lookSelect.value
    );

    const lighting = byId(
      state.lightingScenes,
      lightingSelect.value || look?.lightingSceneId
    );

    const camera = byId(
      state.cameraLayouts,
      cameraSelect.value || look?.cameraLayoutId
    );

    backdrop.querySelector(
      '#cue-effective-lighting'
    ).textContent = lighting?.name || 'None';

    backdrop.querySelector(
      '#cue-effective-camera'
    ).textContent = camera?.name || 'None';
  };

  lookSelect.onchange = updateEffective;
  lightingSelect.onchange = updateEffective;
  cameraSelect.onchange = updateEffective;

  updateEffective();

  backdrop.querySelector(
    '.cue-editor-close'
  ).onclick = close;

  backdrop.querySelector(
    '.cancel-cue'
  ).onclick = close;

  backdrop.onclick = event => {
    if (event.target === backdrop) {
      close();
    }
  };

  backdrop.querySelector(
    '.save-cue'
  ).onclick = async () => {
    cue.name =
      nameInput.value.trim() || 'Untitled Cue';

    cue.productionLookId =
      lookSelect.value;

    cue.lightingSceneId =
      lightingSelect.value || '';

    cue.cameraLayoutId =
      cameraSelect.value || '';

    cue.notes =
      notesInput.value.trim();

    state = await window.trinity.saveState(state);

    close();
    render();
  };

  nameInput.focus();
  nameInput.select();
}

function livePage() {
  const cue = currentCue();
  const look = currentLook();
  const lighting = activeLighting();

  const nextCue =
    state.runOfService[state.live.cueIndex + 1];

  const favorites =
    state.lightingScenes
      .filter(scene => scene.favorite)
      .slice(0, 6);

  const activity =
    state.live.activityLog || [];

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
                ${escapeHtml(cue?.notes || '')}
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
              <span>NEXT CUE</span>

              <strong>
                ${escapeHtml(
                  nextCue?.name || 'End of service'
                )}
              </strong>
            </div>

            <div class="summary-metric">
              <span>LIGHTING</span>

              <strong>
                ${escapeHtml(lighting?.name || 'None')}
              </strong>
            </div>

            <div class="summary-metric">
              <span>LOOK</span>

              <strong>
                ${escapeHtml(look?.name || 'None')}
              </strong>
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
          ${state.cameras.map(cameraCard).join('')}
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
              ${state.cameras
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

  const takeCamera = async cameraId => {
    if (cameraId === state.live.programCamera) {
      return;
    }

    const previousProgram =
      state.live.programCamera;

    const previousPreset =
      state.live.programPreset;

    state.live.programCamera = cameraId;

    const selector = document.querySelector(
      `[data-camera-preset="${cameraId}"]`
    );

    const camera =
  byId(state.cameras, cameraId);

state.live.programPreset =
  selector?.value ||
  camera?.lastPreset ||
  'Stage Wide';

if (camera) {
  camera.lastPreset =
    state.live.programPreset;
}
    state.live.previewCamera =
      previousProgram;

    const previousCamera =
  byId(state.cameras, previousProgram);

if (previousCamera) {
  previousCamera.lastPreset =
    state.live.previewPreset;
}

    state.live.activityLog = [
      {
        at: Date.now(),
        message:
          `Camera live: ${
            byId(state.cameras, cameraId)?.name ||
            cameraId
          }`
      },
      ...(state.live.activityLog || [])
    ].slice(0, 8);

    state = await window.trinity.saveState(state);

    render();
  };

  document
    .querySelectorAll('[data-take-camera]')
    .forEach(card => {
      card.onclick = event => {
        if (
          event.target.closest('select') ||
          event.target.closest('button')
        ) {
          return;
        }

        takeCamera(card.dataset.takeCamera);
      };
    });

  document
    .querySelectorAll('[data-take-button]')
    .forEach(button => {
      button.onclick = () =>
        takeCamera(button.dataset.takeButton);
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

function servicePage() {
  const categories = [
    ...new Set(
      state.cueTemplates.map(
        template => template.category
      )
    )
  ];

  shell(`
    <div class="page-scroll">
      <div class="two-column">
        <section class="panel">
          <div class="section-title">
            <span>RUN OF SERVICE</span>

            <strong>
              ${state.runOfService.length}
              cues
            </strong>
          </div>

          <div class="service-list">
            ${state.runOfService
              .map((cue, index) => {
                const lighting =
                  cueLighting(cue);

                const camera =
                  cueCameraLayout(cue);

                const productionLook =
                  byId(
                    state.productionLooks,
                    cue.productionLookId
                  );

                return `
                  <div
                    class="service-row
                      ${
                        index === state.live.cueIndex
                          ? 'current'
                          : ''
                      }"
                    draggable="true"
                    data-cue-index="${index}"
                  >
                    <span
                      class="drag-handle"
                      title="Drag to reorder"
                      aria-hidden="true"
                    >
                      ⋮⋮
                    </span>

                    <strong>
                      ${String(index + 1).padStart(2, '0')}
                    </strong>

                    <div>
                      <b>
                        ${escapeHtml(cue.name)}
                      </b>

                      <small>
                        ${escapeHtml(
                          productionLook?.name || ''
                        )}
                      </small>

                      <span class="cue-detail-badges">
                        <span
                          class="cue-detail-badge
                            ${
                              cue.lightingSceneId
                                ? 'override-light'
                                : ''
                            }"
                        >
                          💡
                          ${escapeHtml(
                            lighting?.name ||
                            'No lighting'
                          )}
                        </span>

                        <span
                          class="cue-detail-badge
                            ${
                              cue.cameraLayoutId
                                ? 'override-camera'
                                : ''
                            }"
                        >
                          📷
                          ${escapeHtml(
                            camera?.name ||
                            'No camera layout'
                          )}
                        </span>
                      </span>
                    </div>

                    <div class="row-actions">
                      <button data-go="${index}">
                        GO
                      </button>

                      <button data-edit="${index}">
                        EDIT
                      </button>

                      <button
                        data-remove="${index}"
                        aria-label="Remove ${escapeHtml(
                          cue.name
                        )}"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </section>

        <aside class="panel">
          <div class="section-title">
            <span>ADD CUE</span>
          </div>

          <div class="template-grid">
            ${categories
              .map(category =>
                state.cueTemplates
                  .filter(
                    template =>
                      template.category === category
                  )
                  .map(
                    template =>
                      `<article class="template-card">
                        <small>
                          ${escapeHtml(category)}
                        </small>

                        <h3>
                          ${escapeHtml(template.name)}
                        </h3>

                        <p>
                          ${escapeHtml(
                            byId(
                              state.productionLooks,
                              template.productionLookId
                            )?.name || ''
                          )}
                        </p>

                        <button
                          data-template="${template.id}"
                        >
                          ADD
                        </button>
                      </article>`
                  )
                  .join('')
              )
              .join('')}
          </div>
        </aside>
      </div>
    </div>
  `);

  document
    .querySelectorAll('[data-template]')
    .forEach(button => {
      button.onclick = async () => {
        state =
          await window.trinity.addCueTemplate(
            button.dataset.template
          );

        render();
      };
    });

  document
    .querySelectorAll('[data-go]')
    .forEach(button => {
      button.onclick = async () => {
        state = await activateCue(
          Number(button.dataset.go)
        );

        page = 'live';
        render();
      };
    });

  document
    .querySelectorAll('[data-edit]')
    .forEach(button => {
      button.onclick = () => {
        openCueEditor(
          Number(button.dataset.edit)
        );
      };
    });

  document
    .querySelectorAll('[data-remove]')
    .forEach(button => {
      button.onclick = async () => {
        state =
          await window.trinity.removeCue(
            Number(button.dataset.remove)
          );

        render();
      };
    });

  let draggedIndex = null;

  const rows = [
    ...document.querySelectorAll(
      '[data-cue-index]'
    )
  ];

  rows.forEach(row => {
    row.addEventListener(
      'dragstart',
      event => {
        if (event.target.closest('button')) {
          event.preventDefault();
          return;
        }

        draggedIndex =
          Number(row.dataset.cueIndex);

        row.classList.add('dragging');

        event.dataTransfer.effectAllowed =
          'move';

        event.dataTransfer.setData(
          'text/plain',
          String(draggedIndex)
        );
      }
    );

    row.addEventListener(
      'dragover',
      event => {
        event.preventDefault();

        event.dataTransfer.dropEffect =
          'move';

        rows.forEach(item =>
          item.classList.remove(
            'drop-before',
            'drop-after'
          )
        );

        const rect =
          row.getBoundingClientRect();

        row.classList.add(
          event.clientY <
            rect.top + rect.height / 2
            ? 'drop-before'
            : 'drop-after'
        );
      }
    );

    row.addEventListener(
      'dragleave',
      event => {
        if (!row.contains(event.relatedTarget)) {
          row.classList.remove(
            'drop-before',
            'drop-after'
          );
        }
      }
    );

    row.addEventListener(
      'drop',
      async event => {
        event.preventDefault();

        const from =
          draggedIndex ??
          Number(
            event.dataTransfer.getData(
              'text/plain'
            )
          );

        const target =
          Number(row.dataset.cueIndex);

        const rect =
          row.getBoundingClientRect();

        let to =
          target +
          (event.clientY >=
          rect.top + rect.height / 2
            ? 1
            : 0);

        if (from < to) {
          to -= 1;
        }

        to = Math.max(
          0,
          Math.min(
            to,
            state.runOfService.length - 1
          )
        );

        rows.forEach(item =>
          item.classList.remove(
            'dragging',
            'drop-before',
            'drop-after'
          )
        );

        draggedIndex = null;

        if (from !== to) {
          state =
            await window.trinity.moveCue(
              from,
              to
            );
        }

        render();
      }
    );

    row.addEventListener(
      'dragend',
      () => {
        draggedIndex = null;

        rows.forEach(item =>
          item.classList.remove(
            'dragging',
            'drop-before',
            'drop-after'
          )
        );
      }
    );
  });
}

function looksPage() {
  shell(`
    <div class="page-scroll">
      <section class="panel">
        <div class="section-title">
          <span>PRODUCTION LOOKS</span>

          <strong>
            ${state.productionLooks.length}
            looks
          </strong>
        </div>

        <div class="card-grid">
          ${state.productionLooks
            .map(
              look =>
                `<article class="edit-card">
                  <small>PRODUCTION LOOK</small>

                  <h2>
                    ${escapeHtml(look.name)}
                  </h2>

                  <label>
                    Lighting

                    <select
                      data-look="${look.id}"
                      data-field="lightingSceneId"
                    >
                      ${state.lightingScenes
                        .map(
                          scene =>
                            `<option
                              value="${scene.id}"
                              ${
                                scene.id ===
                                look.lightingSceneId
                                  ? 'selected'
                                  : ''
                              }
                            >
                              ${escapeHtml(scene.name)}
                            </option>`
                        )
                        .join('')}
                    </select>
                  </label>

                  <label>
                    Camera layout

                    <select
                      data-look="${look.id}"
                      data-field="cameraLayoutId"
                    >
                      ${state.cameraLayouts
                        .map(
                          layout =>
                            `<option
                              value="${layout.id}"
                              ${
                                layout.id ===
                                look.cameraLayoutId
                                  ? 'selected'
                                  : ''
                              }
                            >
                              ${escapeHtml(layout.name)}
                            </option>`
                        )
                        .join('')}
                    </select>
                  </label>

                  <label>
                    Graphics

                    <input
                      data-look="${look.id}"
                      data-field="graphics"
                      value="${escapeHtml(
                        look.graphics
                      )}"
                    >
                  </label>

                  <label>
                    House lights

                    <input
                      type="number"
                      min="0"
                      max="100"
                      data-look="${look.id}"
                      data-field="houseLights"
                      value="${look.houseLights}"
                    >
                  </label>
                </article>`
            )
            .join('')}
        </div>
      </section>
    </div>
  `);

  document
    .querySelectorAll('[data-look]')
    .forEach(input => {
      input.onchange = async () => {
        const look = byId(
          state.productionLooks,
          input.dataset.look
        );

        look[input.dataset.field] =
          input.type === 'number'
            ? Number(input.value)
            : input.value;

        state =
          await window.trinity.saveState(state);

        render();
      };
    });
}

function lightingPage() {
  shell(`
    <div class="page-scroll">
      <section class="panel">
        <div class="section-title">
          <span>LIGHTING LIBRARY</span>

          <strong>
            ${state.lightingScenes.length}
            scenes
          </strong>
        </div>

        <div class="card-grid">
          ${state.lightingScenes
            .map(
              scene =>
                `<article
                  class="edit-card
                    ${
                      scene.favorite
                        ? 'favorite'
                        : ''
                    }"
                >
                  <small>
                    ${escapeHtml(
                      scene.category || 'Custom'
                    )}
                  </small>

                  <h2>
                    ${escapeHtml(scene.name)}
                  </h2>

                  <div class="metrics">
                    <span>
                      Platform
                      <b>${scene.platform}%</b>
                    </span>

                    <span>
                      Fill
                      <b>${scene.fill}%</b>
                    </span>

                    <span>
                      House
                      <b>${scene.house}%</b>
                    </span>

                    <span>
                      Fade
                      <b>${scene.fade}s</b>
                    </span>
                  </div>

                  <button
                    data-preview-light="${scene.id}"
                  >
                    PREVIEW ON LIVE PAGE
                  </button>
                </article>`
            )
            .join('')}
        </div>
      </section>
    </div>
  `);

  document
    .querySelectorAll('[data-preview-light]')
    .forEach(button => {
      button.onclick = async () => {
        state =
          await window.trinity.lightingOverride(
            button.dataset.previewLight
          );

        page = 'live';
        render();
      };
    });
}

function camerasPage() {
  shell(`
    <div class="page-scroll">
      <section class="panel">
        <div class="section-title">
          <span>CAMERA LAYOUTS</span>

          <strong>
            ${state.cameraLayouts.length}
            layouts
          </strong>
        </div>

        <div class="card-grid">
          ${state.cameraLayouts
            .map(
              layout =>
                `<article
                  class="edit-card
                    ${
                      layout.favorite
                        ? 'favorite'
                        : ''
                    }"
                >
                  <small>
                    ${escapeHtml(
                      layout.category || 'Custom'
                    )}
                  </small>

                  <h2>
                    ${escapeHtml(layout.name)}
                  </h2>

                  <div class="metrics vertical">
                    <span>
                      Program

                      <b>
                        ${escapeHtml(
                          byId(
                            state.cameras,
                            layout.programCamera
                          )?.name ||
                          layout.programCamera
                        )}
                        ·
                        ${escapeHtml(
                          layout.programPreset
                        )}
                      </b>
                    </span>

                    <span>
                      Preview

                      <b>
                        ${escapeHtml(
                          byId(
                            state.cameras,
                            layout.previewCamera
                          )?.name ||
                          layout.previewCamera
                        )}
                        ·
                        ${escapeHtml(
                          layout.previewPreset
                        )}
                      </b>
                    </span>

                    <span>
                      Tracking

                      <b>
                        ${
                          layout.tracking
                            ? 'ON'
                            : 'OFF'
                        }
                      </b>
                    </span>
                  </div>
                </article>`
            )
            .join('')}
        </div>
      </section>
    </div>
  `);
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
  } else {
    camerasPage();
  }
}

(async () => {
  try {
    state =
      await window.trinity.getState();

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
