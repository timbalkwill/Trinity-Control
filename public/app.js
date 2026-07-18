let state, page = "mission";
const app = document.querySelector("#app");
const names = {
  mission:"Mission Control",
  live:"Live Director",
  ros:"Run of Service",
  cameras:"Camera Library",
  shots:"Production Shots",
  devices:"Technical"
};

async function api(path, options={}) {
  const response = await fetch(path, {
    ...options,
    headers:{"content-type":"application/json", ...(options.headers || {})}
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || response.statusText);
  state = payload;
  render();
}
async function load() {
  state = await (await fetch("/api/state")).json();
  render();
}
const cameraName = id => state.devices.find(d=>d.id===id)?.name || id || "—";
const shotName = id => state.cameraShots.find(s=>s.id===id)?.name || id || "—";
const activeRos = () => state.runsOfService.find(r=>r.id===state.liveState.rosId) || state.runsOfService[0];
const activeCue = () => activeRos().cues[state.liveState.cueIndex];
const activeProductionShot = () => state.productionShots.find(s=>s.id===activeCue()?.productionShot);
const formatTime = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

function notify(message) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 2200);
}

function shell(content) {
  return `<div class="app">
    <header>
      <div>
        <div class="brand">TRINITY CONTROL <span class="badge">0.3.2 ALPHA</span></div>
        <div class="small">${state.meta.church} · ${state.meta.room} · Simulation Mode</div>
      </div>
      <nav>${Object.entries(names).map(([key,label])=>`<button data-page="${key}" class="${page===key?"active":""}">${label}</button>`).join("")}</nav>
    </header>
    <main>${content}</main>
    <footer><span>${state.devices.filter(d=>d.status==="online").length}/${state.devices.length} devices online</span><span>${new Date().toLocaleTimeString()}</span></footer>
  </div>`;
}

function mission() {
  const ready = state.devices.every(d=>d.status==="online");
  const ros = activeRos();
  const duration = ros.cues.reduce((n,c)=>n+c.duration,0);
  const cameras = state.devices.filter(d=>d.type==="camera");
  return shell(`
    <section class="card hero">
      <div class="kicker">Mission Control</div>
      <h1>${ready ? "Ready for Service" : "Attention Needed"}</h1>
      <p>${ros.name} · ${ros.cues.length} production cues · Estimated ${Math.round(duration/60)} minutes</p>
      <div class="status-list">
        ${state.devices.map(d=>`<div class="status"><span class="dot ${d.status}"></span><div><strong>${d.name}</strong><div class="small">${d.status} · simulated</div></div></div>`).join("")}
      </div>
      <div style="height:22px"></div>
      <div class="quick-camera-panel">
        <div class="kicker">Quick Camera Selection</div>
        <div class="camera-switch-grid">
          ${cameras.map(cam=>`<div class="camera-switch">
            <strong>${cam.name}</strong>
            <div class="controls">
              <button data-select-camera="${cam.id}" data-target="preview" class="${state.liveState.previewCamera===cam.id?"primary":""}">PREVIEW</button>
              <button data-select-camera="${cam.id}" data-target="program" class="${state.liveState.programCamera===cam.id?"good":""}">PROGRAM</button>
            </div>
          </div>`).join("")}
        </div>
      </div>
      <div style="height:22px"></div>
      <button class="primary" id="begin">${state.liveState.active ? "OPEN LIVE DIRECTOR" : "BEGIN SERVICE"}</button>
    </section>
  `);
}

function live() {
  const ros = activeRos();
  const cue = activeCue();
  const next = ros.cues[state.liveState.cueIndex+1];
  const ps = activeProductionShot();
  const cameras = state.devices.filter(d=>d.type==="camera");
  return shell(`
    <div class="grid cols-2">
      <section class="card"><div class="kicker">Current Cue</div><div class="big-state">${cue?.name || "No cue"}</div><div class="small">${cue?.notes || "No operator notes."}</div></section>
      <section class="card"><div class="kicker">Next Cue</div><div class="big-state">${next?.name || "End of Service"}</div><div class="small">${state.liveState.paused ? "HOLD ACTIVE" : "Ready"}</div></section>
      <section class="card"><div class="kicker">Program</div><div class="big-state">${cameraName(state.liveState.programCamera)}</div><div class="small">${shotName(ps?.assignments?.[state.liveState.programCamera])}</div></section>
      <section class="card"><div class="kicker">Preview</div><div class="big-state">${cameraName(state.liveState.previewCamera)}</div><div class="small">${shotName(ps?.assignments?.[state.liveState.previewCamera])}</div></section>
    </div>
    <div style="height:16px"></div>
    <section class="card">
      <div class="kicker">Camera Selection</div>
      <div class="camera-switch-grid">
        ${cameras.map(cam=>`<div class="camera-switch">
          <strong>${cam.name}</strong>
          <div class="controls">
            <button data-select-camera="${cam.id}" data-target="preview" class="${state.liveState.previewCamera===cam.id?"primary":""}">PREVIEW</button>
            <button data-select-camera="${cam.id}" data-target="program" class="${state.liveState.programCamera===cam.id?"good":""}">PROGRAM</button>
          </div>
        </div>`).join("")}
      </div>
    </section>
    <div style="height:16px"></div>
    <section class="card">
      <div class="row">
        <div><strong>${ps?.name || "No production shot"}</strong><div class="small">Lighting: ${ps?.lighting || "—"} · House lights: ${ps?.houseLights ?? "—"}% · Tracking: ${cue?.tracking ? "ON":"OFF"}</div></div>
        <div class="controls">
          <button id="back">BACK</button><button id="cut">CUT</button><button id="auto">AUTO</button>
          <button id="hold">${state.liveState.paused ? "RESUME":"HOLD"}</button>
          <button class="good" id="next">TAKE NEXT</button><button class="danger" id="end">END</button>
        </div>
      </div>
    </section>
    <div style="height:16px"></div>
    <section class="card"><h3>Run of Service</h3><div class="cue-list">
      ${ros.cues.map((c,i)=>`<div class="cue ${i===state.liveState.cueIndex?"current":""} ${i<state.liveState.cueIndex?"done":""}">
        <div>${i<state.liveState.cueIndex?"✓":i===state.liveState.cueIndex?"▶":"○"}</div>
        <div><strong>${c.name}</strong><div class="small">${state.productionShots.find(s=>s.id===c.productionShot)?.name || "No shot"}</div></div>
        <div>${formatTime(c.duration)}</div>
      </div>`).join("")}
    </div></section>
  `);
}

function rosPage() {
  const ros = activeRos();
  return shell(`
    <section class="card">
      <div class="row"><div><div class="kicker">Planning</div><h2>${ros.name}</h2></div><button class="ghost" id="add-cue">+ Add Cue</button></div>
      <div class="cue-list">
        ${ros.cues.map((c,i)=>`<div class="cue">
          <div>${i+1}</div>
          <div><strong>${c.name}</strong><div class="small">${c.notes || "No notes"} · ${state.productionShots.find(s=>s.id===c.productionShot)?.name || "No production shot"}</div></div>
          <div>${formatTime(c.duration)}</div>
        </div>`).join("")}
      </div>
    </section>
  `);
}

function camerasPage() {
  const cameras = state.devices.filter(d=>d.type==="camera");
  const allNames = [...new Set(state.cameraShots.map(s=>s.name))].sort((a,b)=>a.localeCompare(b));
  return shell(`<div class="camera-grid">
    ${cameras.map(cam=>{
      const own = state.cameraShots.filter(s=>s.cameraId===cam.id);
      const byName = new Map(own.map(s=>[s.name,s]));
      return `<section class="card">
        <div class="row"><div><h2>${cam.name}</h2><div class="small">${own.length}/${allNames.length} presets available</div></div><button data-add-shot="${cam.id}">+ Preset</button></div>
        <div class="small" style="margin-bottom:10px">The full preset list is shown for every camera.</div>
        ${allNames.map(name=>{
          const preset = byName.get(name);
          return `<div class="shot row">
            <div><strong>${name}</strong><div class="small">${preset ? preset.category : "Not yet created for this camera"}</div></div>
            ${preset ? `<button class="ghost" data-recall-shot="${preset.id}">Recall</button>` : `<button data-create-missing="${cam.id}" data-name="${name}">Create</button>`}
          </div>`;
        }).join("")}
      </section>`;
    }).join("")}
  </div>`);
}

function shotsPage() {
  const cameras = state.devices.filter(d=>d.type==="camera");
  return shell(`<div class="grid cols-3">${state.productionShots.map(ps=>`<section class="card">
    <div class="kicker">Production Shot</div><h2>${ps.name}</h2>
    ${cameras.map(c=>`<div class="shot"><div class="small">${c.name}</div><strong>${shotName(ps.assignments[c.id])}</strong></div>`).join("")}
    <div class="small">Preferred: ${cameraName(ps.preferredCamera)}<br>Lighting: ${ps.lighting}<br>House lights: ${ps.houseLights}%</div>
  </section>`).join("")}</div>`);
}

function devicesPage() {
  return shell(`<section class="card"><h2>Device Health</h2><table><thead><tr><th>Device</th><th>Type</th><th>Status</th><th>Mode</th><th></th></tr></thead><tbody>
    ${state.devices.map(d=>`<tr><td>${d.name}</td><td>${d.type}</td><td><span class="dot ${d.status}" style="display:inline-block;margin-right:8px"></span>${d.status}</td><td>${d.simulated?"Simulation":"Hardware"}</td><td><button data-toggle-device="${d.id}">Toggle</button></td></tr>`).join("")}
  </tbody></table></section>`);
}

function render() {
  if (!state) return;
  const pages = {mission,live,ros:rosPage,cameras:camerasPage,shots:shotsPage,devices:devicesPage};
  app.innerHTML = pages[page]();

  document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>{page=b.dataset.page;render();});
  document.querySelector("#begin")?.addEventListener("click", async()=>{if(!state.liveState.active)await api("/api/live/start",{method:"POST"});page="live";render();});
  document.querySelector("#next")?.addEventListener("click",()=>api("/api/live/next",{method:"POST"}));
  document.querySelector("#back")?.addEventListener("click",()=>api("/api/live/back",{method:"POST"}));
  document.querySelector("#hold")?.addEventListener("click",()=>api("/api/live/toggle-hold",{method:"POST"}));
  document.querySelector("#end")?.addEventListener("click",async()=>{await api("/api/live/end",{method:"POST"});page="mission";render();});
  document.querySelector("#cut")?.addEventListener("click",()=>api("/api/switch",{method:"POST",body:JSON.stringify({mode:"cut"})}));
  document.querySelector("#auto")?.addEventListener("click",()=>api("/api/switch",{method:"POST",body:JSON.stringify({mode:"auto"})}));
  document.querySelectorAll("[data-toggle-device]").forEach(b=>b.onclick=()=>api("/api/device/toggle",{method:"POST",body:JSON.stringify({id:b.dataset.toggleDevice})}));

  document.querySelectorAll("[data-select-camera]").forEach(b=>b.onclick=async()=>{
    await api("/api/live/select-camera",{method:"POST",body:JSON.stringify({cameraId:b.dataset.selectCamera,target:b.dataset.target})});
    notify(`${b.dataset.target === "program" ? "Program" : "Preview"} camera changed`);
  });

  document.querySelectorAll("[data-add-shot]").forEach(b=>b.onclick=async()=>{
    const name = prompt("Preset name:");
    if(!name)return;
    const category = prompt("Category: Stage, Congregation, Events, or Custom","Custom") || "Custom";
    await api("/api/camera-shots",{method:"POST",body:JSON.stringify({cameraId:b.dataset.addShot,name,category})});
    notify("Camera preset created");
  });

  document.querySelectorAll("[data-create-missing]").forEach(b=>b.onclick=async()=>{
    const category = prompt(`Category for "${b.dataset.name}":`,"Custom") || "Custom";
    await api("/api/camera-shots",{method:"POST",body:JSON.stringify({cameraId:b.dataset.createMissing,name:b.dataset.name,category})});
    notify("Preset added to this camera");
  });

  document.querySelectorAll("[data-recall-shot]").forEach(b=>b.onclick=()=>notify("Preset recalled in simulation"));

  document.querySelector("#add-cue")?.addEventListener("click", async()=>{
    const name = prompt("Cue name:");
    if(!name)return;
    const minutes = Number(prompt("Estimated duration in minutes:","5") || "5");
    const options = state.productionShots.map((s,i)=>`${i+1}. ${s.name}`).join("\n");
    const selected = Number(prompt(`Choose a Production Shot:\n${options}`,"1") || "1");
    const chosen = state.productionShots[Math.max(0,Math.min(state.productionShots.length-1,selected-1))];
    const notes = prompt("Operator notes (optional):","") || "";
    const tracking = confirm("Enable camera tracking for this cue?");
    await api("/api/cues",{method:"POST",body:JSON.stringify({
      rosId:activeRos().id,
      name,
      duration:Math.max(0,Math.round(minutes*60)),
      productionShot:chosen?.id,
      notes,
      tracking
    })});
    notify("Cue added");
  });
}

load();
setInterval(()=>{const el=document.querySelector("footer span:last-child");if(el)el.textContent=new Date().toLocaleTimeString();},1000);
