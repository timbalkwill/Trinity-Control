const root = document.getElementById("app");

let state;
let page = "mission";
let selectedPresetCamera = "main";

const pages = [
  ["mission", "Mission Control"],
  ["director", "Live Director"],
  ["service", "Run of Service"],
  ["cameras", "Camera Library"]
];

function cameraName(id) {
  return state.cameras.find((camera) => camera.id === id)?.name || "Unknown Camera";
}

function currentCue() {
  return state.runOfService[state.live.cueIndex];
}

function shell(content, title) {
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <h1>Trinity Control</h1>
          <small>${state.version}</small>
        </div>
        <nav class="nav">
          ${pages.map(([id, label]) => `
            <button data-page="${id}" class="${page === id ? "active" : ""}">
              ${label}
            </button>
          `).join("")}
        </nav>
      </aside>
      <main class="main">
        <header class="topbar">
          <div>
            <div class="kicker">Production Workspace</div>
            <h2>${title}</h2>
          </div>
          <div class="status-pill">Simulation Ready</div>
        </header>
        ${content}
      </main>
    </div>
  `;

  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      page = button.dataset.page;
      render();
    });
  });
}

function missionPage() {
  const cue = currentCue();
  shell(`
    <div class="grid three">
      <section class="card">
        <div class="kicker">Connected Cameras</div>
        <div class="hero-value">${state.cameras.filter(c => c.online).length}/${state.cameras.length}</div>
        <div class="muted">All cameras available in simulation</div>
      </section>
      <section class="card">
        <div class="kicker">Current Cue</div>
        <div class="hero-value">${cue?.name || "None"}</div>
        <div class="muted">${cue?.notes || "No cue selected"}</div>
      </section>
      <section class="card">
        <div class="kicker">Run of Service</div>
        <div class="hero-value">${state.runOfService.length}</div>
        <div class="muted">Production cues loaded</div>
      </section>
    </div>
    <div style="height:16px"></div>
    <div class="grid two">
      <section class="card">
        <h3>System Readiness</h3>
        ${state.cameras.map(camera => `
          <div class="camera-row">
            <div>
              <strong>${camera.name}</strong>
              <div class="muted">${camera.online ? "Online" : "Offline"}</div>
            </div>
            <span>${camera.online ? "● Ready" : "● Offline"}</span>
          </div>
        `).join("")}
      </section>
      <section class="card">
        <h3>Start Production</h3>
        <p class="muted">Open the Live Director to switch cameras and advance through the service.</p>
        <button class="primary" id="open-director">Open Live Director</button>
      </section>
    </div>
  `, "Mission Control");

  document.getElementById("open-director").onclick = () => {
    page = "director";
    render();
  };
}

function directorPage() {
  const cue = currentCue();
  const nextCue = state.runOfService[state.live.cueIndex + 1];

  shell(`
    <div class="grid two">
      <section class="card">
        <div class="kicker">Program</div>
        <div class="monitor program-border">${cameraName(state.live.programCamera)}</div>
      </section>
      <section class="card">
        <div class="kicker">Preview</div>
        <div class="monitor preview-border">${cameraName(state.live.previewCamera)}</div>
      </section>
    </div>
    <div style="height:16px"></div>
    <div class="grid two">
      <section class="card">
        <h3>Cameras</h3>
        ${state.cameras.map(camera => `
          <div class="camera-row">
            <div>
              <strong>${camera.name}</strong>
              <div class="muted">${camera.online ? "Ready" : "Offline"}</div>
            </div>
            <button data-camera="${camera.id}" data-target="preview"
              class="${state.live.previewCamera === camera.id ? "primary" : ""}">
              Preview
            </button>
            <button data-camera="${camera.id}" data-target="program"
              class="${state.live.programCamera === camera.id ? "program" : ""}">
              Program
            </button>
          </div>
        `).join("")}
      </section>
      <section class="card">
        <div class="kicker">Current Cue</div>
        <h3 style="font-size:30px">${cue?.name || "No Cue"}</h3>
        <p class="muted">${cue?.notes || ""}</p>
        <div class="kicker">Next Cue</div>
        <h3>${nextCue?.name || "End of Service"}</h3>
        <div class="actions">
          <button id="back-cue">Back</button>
          <button id="hold-cue" class="${state.live.hold ? "danger" : ""}">
            ${state.live.hold ? "Held" : "Hold"}
          </button>
          <button id="next-cue" class="primary">Take Next</button>
        </div>
      </section>
    </div>
  `, "Live Director");

  document.querySelectorAll("[data-camera]").forEach((button) => {
    button.onclick = async () => {
      state = await window.trinity.selectCamera(
        button.dataset.camera,
        button.dataset.target
      );
      render();
    };
  });

  document.getElementById("next-cue").onclick = async () => {
    state = await window.trinity.nextCue();
    render();
  };

  document.getElementById("back-cue").onclick = async () => {
    state = await window.trinity.previousCue();
    render();
  };

  document.getElementById("hold-cue").onclick = async () => {
    state = await window.trinity.toggleHold();
    render();
  };
}

function servicePage() {
  shell(`
    <section class="card">
      <div class="actions" style="justify-content:space-between;align-items:center">
        <div>
          <div class="kicker">Planning</div>
          <h3>Sunday Morning Service</h3>
        </div>
        <button class="primary" id="show-add-cue">Add Cue</button>
      </div>
      <div id="cue-form" hidden>
        <div class="form">
          <input id="cue-name" placeholder="Cue name" />
          <input id="cue-duration" type="number" min="1" value="5" placeholder="Minutes" />
          <textarea id="cue-notes" placeholder="Operator notes"></textarea>
          <div class="actions">
            <button id="cancel-cue">Cancel</button>
            <button class="primary" id="save-cue">Save Cue</button>
          </div>
        </div>
      </div>
      <div style="margin-top:14px">
        ${state.runOfService.map((cue, index) => `
          <div class="cue-row">
            <strong>${index + 1}</strong>
            <div>
              <strong>${cue.name}</strong>
              <div class="muted">${cue.notes || "No notes"}</div>
            </div>
            <span>${Math.round(cue.duration / 60)} min</span>
          </div>
        `).join("")}
      </div>
    </section>
  `, "Run of Service");

  const form = document.getElementById("cue-form");
  document.getElementById("show-add-cue").onclick = () => {
    form.hidden = false;
    document.getElementById("cue-name").focus();
  };
  document.getElementById("cancel-cue").onclick = () => {
    form.hidden = true;
  };
  document.getElementById("save-cue").onclick = async () => {
    const name = document.getElementById("cue-name").value.trim();
    const minutes = Number(document.getElementById("cue-duration").value || 5);
    const notes = document.getElementById("cue-notes").value.trim();

    if (!name) return;

    state = await window.trinity.addCue({
      name,
      duration: Math.max(1, minutes) * 60,
      notes
    });
    render();
  };
}

function camerasPage() {
  const camera = state.cameras.find(c => c.id === selectedPresetCamera);
  const presets = state.presets[selectedPresetCamera] || [];

  shell(`
    <section class="card">
      <div class="kicker">Shared Preset Library</div>
      <h3>All cameras use the same preset names and numbers</h3>
      <div class="camera-tabs">
        ${state.cameras.map(c => `
          <button data-preset-camera="${c.id}" class="${c.id === selectedPresetCamera ? "primary" : ""}">
            ${c.name}
          </button>
        `).join("")}
      </div>
      <div class="muted" style="margin-bottom:10px">
        Editing a preset affects this camera only while keeping the shared preset number.
      </div>
      ${presets.map(preset => `
        <div class="preset-row">
          <strong>${String(preset.number).padStart(3, "0")}</strong>
          <div>
            <strong>${preset.name}</strong>
            <div class="muted">${camera.name}</div>
          </div>
          <button>Recall</button>
        </div>
      `).join("")}
    </section>
  `, "Camera Library");

  document.querySelectorAll("[data-preset-camera]").forEach((button) => {
    button.onclick = () => {
      selectedPresetCamera = button.dataset.presetCamera;
      render();
    };
  });
}

function render() {
  if (page === "mission") missionPage();
  if (page === "director") directorPage();
  if (page === "service") servicePage();
  if (page === "cameras") camerasPage();
}

async function start() {
  state = await window.trinity.getState();
  render();
}

start();
