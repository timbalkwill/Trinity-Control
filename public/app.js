const root=document.getElementById("app");let state,page="live";
const nav=[['live','LIVE'],['service','SERVICE'],['looks','LOOKS'],['lighting','LIGHTING'],['cameras','CAMERAS']];
const byId=(arr,id)=>arr.find(x=>x.id===id);const currentCue=()=>state.runOfService[state.live.cueIndex];const currentLook=()=>byId(state.productionLooks,currentCue()?.productionLookId);const activeLight=()=>byId(state.lightingScenes,state.live.lightingOverrideId||currentLook()?.lightingSceneId);
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function shell(content){root.innerHTML=`<div class="shell"><header class="top"><div class="brand">Trinity Control <small>${state.version}</small></div><div class="status">● Simulation Ready</div></header><main class="content">${content}</main><nav class="nav">${nav.map(([id,label])=>`<button data-page="${id}" class="${page===id?'active':''}">${label}</button>`).join('')}</nav></div>`;document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{page=b.dataset.page;render()})}
function livePage(){
  const cue=currentCue(),next=state.runOfService[state.live.cueIndex+1],look=currentLook(),light=activeLight();
  const favorites=state.lightingScenes.filter(s=>s.favorite).slice(0,6);
  const quickLights=favorites.length?favorites:state.lightingScenes.slice(0,6);
  const presetOptions=(selected)=>state.presetNames.map(p=>`<option ${p===selected?'selected':''}>${esc(p)}</option>`).join('');

  shell(`<div class="live-main">
    <section class="card ros-panel">
      <div><div class="kicker">Order of Service</div><h2>Sunday Service · ${state.runOfService.length} cues</h2></div>
      <div class="ros-list">${state.runOfService.map((c,i)=>{
        const status=i<state.live.cueIndex?'completed':i===state.live.cueIndex?'current':i===state.live.cueIndex+1?'next':'upcoming';
        const icon=status==='completed'?'✓':status==='current'?'▶':status==='next'?'●':'○';
        return `<div class="ros-item ${status}" data-live-go="${i}">
          <div class="ros-status">${icon}</div><div><strong>${esc(c.name)}</strong></div>
        </div>`;
      }).join('')}</div>
    </section>

    <section class="card stack">
      <div><div class="kicker">Current Cue</div><div class="hero">${esc(cue?.name||'No Cue')}</div><div class="muted">${esc(cue?.notes||'')}</div></div>

      <div class="live-camera-console">
        <div class="kicker">Manual Camera Control · tap a camera to put it on Program</div>
        <div class="live-camera-grid">${state.cameras.map(camera=>{
          const isProgram=state.live.programCamera===camera.id;
          const isPreview=state.live.previewCamera===camera.id;
          const selectedPreset=isProgram?(state.live.programPreset||state.presetNames[0]):isPreview?(state.live.previewPreset||state.presetNames[0]):(state.presets[camera.id]?.[0]?.name||state.presetNames[0]);
          return `<div class="live-camera ${isProgram?'program':''} ${isPreview?'preview':''}">
            <div class="camera-role ${isProgram?'on-program':''}">${isProgram?'● PROGRAM':isPreview?'● PREVIEW':'CAMERA'}</div>
            <button data-program-camera="${camera.id}">${esc(camera.name)}</button>
            <select data-camera-preset="${camera.id}">${presetOptions(selectedPreset)}</select>
          </div>`;
        }).join('')}</div>
      </div>

      <div class="grid three">
        <div><div class="kicker">Program</div><div class="monitor program">${esc(byId(state.cameras,state.live.programCamera)?.name||'None')}<div class="muted">${esc(state.live.programPreset||'')}</div></div></div>
        <div><div class="kicker">Preview</div><div class="monitor preview">${esc(byId(state.cameras,state.live.previewCamera)?.name||'None')}<div class="muted">${esc(state.live.previewPreset||'')}</div></div></div>
        <div><div class="kicker">Next</div><div class="monitor">${esc(next?.name||'End')}</div></div>
      </div>

      <div><div class="kicker">Production State</div><div class="actions">
        <span class="badge">${esc(look?.name||'No look')}</span>
        <span class="badge">${esc(light?.name||'No lighting')}</span>
        <span class="badge">House ${look?.houseLights??0}%</span>
        <span class="badge">${look?.tracking?'Tracking ON':'Tracking OFF'}</span>
      </div></div>

      ${state.live.lightingOverrideId?`<div class="override"><strong>Manual Lighting Override Active:</strong> ${esc(light?.name)} <button id="return-light">Return to Cue Lighting</button></div>`:''}

      <div><div class="kicker">Favorite Lighting Scenes</div>
        <div class="live-lighting-favorites">${quickLights.map(s=>`<button data-light="${s.id}" class="${state.live.lightingOverrideId===s.id?'warn':''}">${esc(s.name)}</button>`).join('')}</div>
      </div>

      <div class="actions">
        <button class="go" id="next">TAKE NEXT</button><button id="back">BACK</button>
        <button class="${state.live.hold?'warn':''}" id="hold">${state.live.hold?'HOLD ACTIVE':'HOLD'}</button>
        <button class="danger" id="blackout">BLACKOUT</button>
      </div>
    </section>
  </div>`);

  document.getElementById('next').onclick=async()=>{state=await window.trinity.nextCue();render()};
  document.getElementById('back').onclick=async()=>{state=await window.trinity.previousCue();render()};
  document.getElementById('hold').onclick=async()=>{state=await window.trinity.toggleHold();render()};
  document.querySelectorAll('[data-live-go]').forEach(el=>el.onclick=async()=>{state=await window.trinity.goCue(Number(el.dataset.liveGo));render()});
  document.querySelectorAll('[data-light]').forEach(button=>button.onclick=async()=>{state=await window.trinity.lightingOverride(button.dataset.light);render()});

  document.querySelectorAll('[data-program-camera]').forEach(button=>button.onclick=async()=>{
    const newProgram=button.dataset.programCamera;
    if(newProgram===state.live.programCamera)return;
    state.live.previewCamera=state.live.programCamera;
    state.live.previewPreset=state.live.programPreset||state.presetNames[0];
    state.live.programCamera=newProgram;
    const selector=document.querySelector(`[data-camera-preset="${newProgram}"]`);
    state.live.programPreset=selector?.value||state.presetNames[0];
    state=await window.trinity.saveState(state);render();
  });

  document.querySelectorAll('[data-camera-preset]').forEach(select=>select.onchange=async()=>{
    const cameraId=select.dataset.cameraPreset;
    if(cameraId===state.live.programCamera){state.live.programPreset=select.value}
    else{state.live.previewCamera=cameraId;state.live.previewPreset=select.value}
    state=await window.trinity.saveState(state);render();
  });

  const returnButton=document.getElementById('return-light');
  if(returnButton)returnButton.onclick=async()=>{state=await window.trinity.returnToCueLighting();render()};
  document.getElementById('blackout').onclick=async()=>{state=await window.trinity.lightingOverride('light-blackout');render()};
}
function servicePage(){const cats=[...new Set(state.cueTemplates.map(t=>t.category))];shell(`<div class="grid service-grid"><section class="card"><h2>Run of Service</h2><div class="cue-list">${state.runOfService.map((c,i)=>`<div class="cue-row ${i===state.live.cueIndex?'current':i===state.live.cueIndex+1?'next':''}"><strong>${String(i+1).padStart(2,'0')}</strong><div><strong>${esc(c.name)}</strong><div class="muted">${esc(byId(state.productionLooks,c.productionLookId)?.name||'No look')} · ${Math.round(c.duration/60)} min</div></div><div class="actions"><button data-go="${i}">GO</button><button data-up="${i}">↑</button><button data-down="${i}">↓</button><button data-remove="${i}">×</button></div></div>`).join('')}</div></section><aside class="card"><h2>Add Cue</h2><div class="library">${cats.map(cat=>state.cueTemplates.filter(t=>t.category===cat).map(t=>`<div class="template"><div class="kicker">${esc(cat)}</div><strong>${esc(t.name)}</strong><div class="muted">${esc(byId(state.productionLooks,t.productionLookId)?.name||'')}</div><button data-template="${t.id}">Add</button></div>`).join('')).join('')}</div></aside></div>`);document.querySelectorAll('[data-template]').forEach(b=>b.onclick=async()=>{state=await window.trinity.addCueTemplate(b.dataset.template);render()});document.querySelectorAll('[data-go]').forEach(b=>b.onclick=async()=>{state=await window.trinity.goCue(Number(b.dataset.go));render()});document.querySelectorAll('[data-up]').forEach(b=>b.onclick=async()=>{const i=Number(b.dataset.up);if(i>0)state=await window.trinity.moveCue(i,i-1);render()});document.querySelectorAll('[data-down]').forEach(b=>b.onclick=async()=>{const i=Number(b.dataset.down);if(i<state.runOfService.length-1)state=await window.trinity.moveCue(i,i+1);render()});document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{state=await window.trinity.removeCue(Number(b.dataset.remove));render()});}
function looksPage(){shell(`<section class="card"><h2>Production Look Library</h2><div class="editor-grid">${state.productionLooks.map(l=>`<div class="editor"><div class="kicker">Production Look</div><h3>${esc(l.name)}</h3><label>Lighting<select data-look="${l.id}" data-field="lightingSceneId">${state.lightingScenes.map(s=>`<option value="${s.id}" ${s.id===l.lightingSceneId?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label>Camera Layout<select data-look="${l.id}" data-field="cameraLayoutId">${state.cameraLayouts.map(c=>`<option value="${c.id}" ${c.id===l.cameraLayoutId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>Graphics<input data-look="${l.id}" data-field="graphics" value="${esc(l.graphics)}"></label><label>House Lights<input type="number" min="0" max="100" data-look="${l.id}" data-field="houseLights" value="${l.houseLights}"></label></div>`).join('')}</div></section>`);document.querySelectorAll('[data-look]').forEach(el=>el.onchange=async()=>{const l=byId(state.productionLooks,el.dataset.look);l[el.dataset.field]=el.type==='number'?Number(el.value):el.value;state=await window.trinity.saveState(state);render()});}
let lightingSearch="",lightingCategory="All";
function lightingPage(){
  const categories=["All","Favorites",...[...new Set(state.lightingScenes.map(s=>s.category||"Custom"))]];
  const visible=state.lightingScenes.filter(s=>{
    const categoryMatch=lightingCategory==="All"||(lightingCategory==="Favorites"&&s.favorite)||s.category===lightingCategory;
    const searchMatch=!lightingSearch||`${s.name} ${s.category} ${s.room}`.toLowerCase().includes(lightingSearch.toLowerCase());
    return categoryMatch&&searchMatch;
  });

  shell(`<section class="card">
    <h2>Lighting Scene Library <span class="badge">${state.lightingScenes.length} scenes</span></h2>
    <div class="lighting-toolbar">
      <input id="lighting-search" placeholder="Search lighting scenes…" value="${esc(lightingSearch)}">
      <select id="lighting-category">${categories.map(c=>`<option ${c===lightingCategory?'selected':''}>${esc(c)}</option>`).join('')}</select>
      <button id="add-lighting">+ Add Scene</button>
    </div>
    <div class="editor-grid">${visible.map(s=>`
      <div class="editor lighting-card ${s.favorite?'favorite':''}">
        <div class="kicker">${esc(s.category||'Custom')} ${s.favorite?'<span class="star">★ FAVORITE</span>':''}</div>
        <h3>${esc(s.name)}</h3>
        ${[['Platform','platform'],['SlimPAR Fill','fill'],['Ceiling','ceiling'],['House','house'],['Fade Seconds','fade']].map(([label,key])=>`
          <div class="metric"><span>${label}</span><strong>${s[key]}${key==='fade'?'s':'%'}</strong></div>`).join('')}
        <div class="metric"><span>Room</span><strong>${esc(s.room)}</strong></div>
        <div class="lighting-actions">
          <button data-preview-light="${s.id}">Preview</button>
          <button data-favorite-light="${s.id}">${s.favorite?'★':'☆'}</button>
          <button data-copy-light="${s.id}">Duplicate</button>
          <button data-delete-light="${s.id}">Delete</button>
        </div>
      </div>`).join('')||'<div class="muted">No scenes match this filter.</div>'}
    </div>
  </section>`);

  document.getElementById('lighting-search').oninput=e=>{lightingSearch=e.target.value;lightingPage()};
  document.getElementById('lighting-category').onchange=e=>{lightingCategory=e.target.value;lightingPage()};

  document.getElementById('add-lighting').onclick=async()=>{
    const name=prompt('Scene name','New Lighting Scene');
    if(!name)return;
    state.lightingScenes.push({id:`light-${Date.now()}`,name,category:'Custom',favorite:false,platform:75,fill:35,room:'Warm Amber',ceiling:20,house:30,fade:3});
    state=await window.trinity.saveState(state);render();
  };

  document.querySelectorAll('[data-preview-light]').forEach(b=>b.onclick=async()=>{
    state=await window.trinity.lightingOverride(b.dataset.previewLight);page='live';render();
  });

  document.querySelectorAll('[data-favorite-light]').forEach(b=>b.onclick=async()=>{
    const scene=byId(state.lightingScenes,b.dataset.favoriteLight);
    scene.favorite=!scene.favorite;
    state=await window.trinity.saveState(state);render();
  });

  document.querySelectorAll('[data-copy-light]').forEach(b=>b.onclick=async()=>{
    const scene=byId(state.lightingScenes,b.dataset.copyLight);
    state.lightingScenes.push({...scene,id:`light-${Date.now()}`,name:`${scene.name} Copy`,category:'Custom',favorite:false});
    state=await window.trinity.saveState(state);render();
  });

  document.querySelectorAll('[data-delete-light]').forEach(b=>b.onclick=async()=>{
    const id=b.dataset.deleteLight;
    if(state.productionLooks.some(l=>l.lightingSceneId===id)){
      alert('This scene is used by a Production Look and cannot be deleted.');
      return;
    }
    if(confirm('Delete this lighting scene?')){
      state.lightingScenes=state.lightingScenes.filter(s=>s.id!==id);
      state=await window.trinity.saveState(state);render();
    }
  });
}
let cameraSearch="",cameraCategory="All";
function camerasPage(){const categories=["All","Favorites",...[...new Set(state.cameraLayouts.map(c=>c.category||"Custom"))]];const visible=state.cameraLayouts.filter(c=>(cameraCategory==="All"||cameraCategory==="Favorites"&&c.favorite||c.category===cameraCategory)&&(!cameraSearch||`${c.name} ${c.category} ${c.programPreset} ${c.previewPreset}`.toLowerCase().includes(cameraSearch.toLowerCase())));shell(`<section class="card"><h2>Camera Layout Library <span class="badge">${state.cameraLayouts.length} layouts</span></h2><div class="camera-toolbar"><input id="camera-search" placeholder="Search camera layouts…" value="${esc(cameraSearch)}"><select id="camera-category">${categories.map(c=>`<option ${c===cameraCategory?'selected':''}>${esc(c)}</option>`).join('')}</select><button id="add-layout">+ Add Layout</button></div><div class="editor-grid">${visible.map(c=>`<div class="editor camera-card ${c.favorite?'favorite':''}"><div class="kicker">${esc(c.category||'Custom')} ${c.favorite?'<span class="star">★ FAVORITE</span>':''}</div><h3>${esc(c.name)}</h3><div class="metric"><span>Program</span><strong>${esc(byId(state.cameras,c.programCamera)?.name||c.programCamera)} · ${esc(c.programPreset)}</strong></div><div class="metric"><span>Preview</span><strong>${esc(byId(state.cameras,c.previewCamera)?.name||c.previewCamera)} · ${esc(c.previewPreset)}</strong></div><div class="metric"><span>Tracking</span><strong>${c.tracking?'ON':'OFF'}</strong></div><div class="camera-actions"><button data-favorite="${c.id}">${c.favorite?'★':'☆'}</button><button data-rename="${c.id}">Rename</button><button data-copy="${c.id}">Duplicate</button><button data-delete-layout="${c.id}">Delete</button></div></div>`).join('')||'<div class="muted">No layouts match this filter.</div>'}</div></section>`);document.getElementById('camera-search').oninput=e=>{cameraSearch=e.target.value;camerasPage()};document.getElementById('camera-category').onchange=e=>{cameraCategory=e.target.value;camerasPage()};document.getElementById('add-layout').onclick=async()=>{const name=prompt('Layout name','New Camera Layout');if(!name)return;state.cameraLayouts.push({id:`cam-${Date.now()}`,name,category:'Custom',favorite:false,programCamera:'main',programPreset:'Stage Wide',previewCamera:'left',previewPreset:'Stage Left',tracking:false});state=await window.trinity.saveState(state);render()};document.querySelectorAll('[data-favorite]').forEach(b=>b.onclick=async()=>{const c=byId(state.cameraLayouts,b.dataset.favorite);c.favorite=!c.favorite;state=await window.trinity.saveState(state);render()});document.querySelectorAll('[data-rename]').forEach(b=>b.onclick=async()=>{const c=byId(state.cameraLayouts,b.dataset.rename);const name=prompt('Rename layout',c.name);if(name){c.name=name;state=await window.trinity.saveState(state);render()}});document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{const c=byId(state.cameraLayouts,b.dataset.copy);state.cameraLayouts.push({...c,id:`cam-${Date.now()}`,name:`${c.name} Copy`,favorite:false,category:'Custom'});state=await window.trinity.saveState(state);render()});document.querySelectorAll('[data-delete-layout]').forEach(b=>b.onclick=async()=>{const id=b.dataset.deleteLayout;if(state.productionLooks.some(l=>l.cameraLayoutId===id)){alert('This layout is used by a Production Look and cannot be deleted.');return}if(confirm('Delete this camera layout?')){state.cameraLayouts=state.cameraLayouts.filter(c=>c.id!==id);state=await window.trinity.saveState(state);render()}})}
function render(){if(page==='live')livePage();if(page==='service')servicePage();if(page==='looks')looksPage();if(page==='lighting')lightingPage();if(page==='cameras')camerasPage()}
(async()=>{state=await window.trinity.getState();render()})();
