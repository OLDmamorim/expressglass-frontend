// RESTAURAÇÃO COMPLETA - Script original + apenas correção dos ícones
// Versão estabilizada com patches: IDs estáveis, DnD throttle, semana Seg-Sáb, impressão segura, etc.

// ---------- Configurações e dados ----------
const localityColors = {
  'Outra': '#9CA3AF', 'Barcelos': '#F87171', 'Braga': '#34D399', 'Esposende': '#22D3EE',
  'Famalicão': '#2DD4BF', 'Guimarães': '#FACC15', 'Póvoa de Lanhoso': '#A78BFA',
  'Póvoa de Varzim': '#6EE7B7', "Riba D'Ave": '#FBBF24', 'Trofa': '#C084FC',
  'Vieira do Minho': '#93C5FD', 'Vila do Conde': '#FCD34D', 'Vila Verde': '#86EFAC'
};
window.LOCALITY_COLORS = localityColors;
const getLocColor = loc => (localityColors && localityColors[loc]) || '#3b82f6';

const statusBarColors = { NE:'#EF4444', VE:'#F59E0B', ST:'#10B981' };
const localityList = Object.keys(localityColors);

// ---------- Estado ----------
let appointments = [];
let currentMonday = getMonday(new Date());
let currentMobileDay = new Date();
let editingId = null;
let searchQuery = '';
let statusFilter = '';

// ---------- Utils ----------
function getMonday(date){ const d=new Date(date); const day=d.getDay(); const diff=d.getDate()-day+(day===0?-6:1); d.setDate(diff); d.setHours(0,0,0,0); return d; }
function addDays(date,days){ const r=new Date(date); r.setDate(r.getDate()+days); r.setHours(0,0,0,0); return r; }
function localISO(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function parseDate(dateStr){
  if(!dateStr) return null;
  const s=String(dateStr).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)){ const [d,m,y]=s.split('/'); return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  try{ const d=new Date(s); if(!isNaN(d.getTime())) return localISO(d); }catch{}
  return null;
}
function formatDateForInput(s){ if(!s) return ''; if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ const [y,m,d]=s.split('-'); return `${d}/${m}/${y}`; } return s; }
function fmtHeader(date){ return {day: date.toLocaleDateString('pt-PT',{weekday:'long'}), dm: date.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'})}; }
const cap = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : s;
function parseColor(str){
  if(!str) return null; str=String(str).trim();
  if(str[0]==='#'){ if(str.length===4) return {r:parseInt(str[1]+str[1],16), g:parseInt(str[2]+str[2],16), b:parseInt(str[3]+str[3],16)};
                    if(str.length>=7) return {r:parseInt(str.slice(1,3),16), g:parseInt(str.slice(3,5),16), b:parseInt(str.slice(5,7),16)};}
  const m=str.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i); if(m) return {r:+m[1], g:+m[2], b:+m[3]}; return null;
}
const clamp=n=>Math.max(0,Math.min(255,Math.round(n))); const toHex=n=>n.toString(16).padStart(2,'0');
const rgbToHex=({r,g,b})=>'#'+toHex(clamp(r))+toHex(clamp(g))+toHex(clamp(b));
const lighten=(rgb,a)=>({ r:rgb.r+(255-rgb.r)*a, g:rgb.g+(255-rgb.g)*a, b:rgb.b+(255-rgb.b)*a });
const darken=(rgb,a)=>({ r:rgb.r*(1-a), g:rgb.g*(1-a), b:rgb.b*(1-a) });
function gradFromBase(hex){ const rgb=parseColor(hex)||parseColor('#1e88e5'); return { c1: rgbToHex(lighten(rgb,0.06)), c2: rgbToHex(darken(rgb,0.18)) }; }
function bucketOf(a){ if(!a.date || !a.period) return 'unscheduled'; return `${a.date}|${a.period}`; }
function getBucketList(bucket){ return appointments.filter(x=>bucketOf(x)===bucket).sort((a,b)=>(a.sortIndex||0)-(b.sortIndex||0)); }
function normalizeBucketOrder(bucket){ appointments.filter(a=>bucketOf(a)===bucket).forEach((x,i)=>x.sortIndex=i+1); }

// ---------- Toast ----------
function showToast(msg,type='info'){
  const c=document.getElementById('toastContainer'); if(!c) return;
  const t=document.createElement('div'); t.className=`toast ${type}`;
  t.innerHTML=`<span>${type==='success'?'✅':type==='error'?'❌':'ℹ️'}</span><span>${msg}</span>`;
  c.appendChild(t); setTimeout(()=>t.remove(),4000);
}

// ---------- Matrícula ----------
function formatPlate(input){
  let v=input.value.replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  if(v.length>2) v=v.slice(0,2)+'-'+v.slice(2);
  if(v.length>5) v=v.slice(0,5)+'-'+v.slice(5,7);
  input.value=v;
}

// ---------- API load ----------
async function load(){
  try{
    showToast('Carregando dados...','info');
    appointments = await window.apiClient.getAppointments();
    // IDs e ordem estáveis
    appointments.forEach(a=>{ if(!a.id) a.id=Date.now()+Math.random(); if(!a.sortIndex) a.sortIndex=1; });
    // 🔁 Normalização de morada (compatibilidade com dados antigos)
    appointments = appointments.map(a => ({
      ...a,
      address: a.address || a.morada || a.addr || null
    }));
    const locs=await window.apiClient.getLocalities();
    if(locs && typeof locs==='object'){ Object.assign(localityColors,locs); window.LOCALITY_COLORS=localityColors;
      for (const [k,v] of Object.entries(localityColors)) {
        if (!/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v)) localityColors[k] = '#3b82f6';
      }
    }
    const st=window.apiClient.getConnectionStatus();
    showToast(st.online?'Dados carregados da cloud!':'Dados carregados localmente (offline)', st.online?'success':'info');
  }catch(e){
    appointments=[]; showToast('Erro ao carregar dados: '+e.message,'error');
  } finally {
    updateConnBadge();
  }
}

// ---------- Filtros ----------
function filterAppointments(list){
  let f=[...list];
  if(searchQuery){
    const q=searchQuery.toLowerCase();
    f=f.filter(a=>[a.plate,a.car,a.notes,a.locality,a.address].some(x=>(x||'').toLowerCase().includes(q)));
  }
  if(statusFilter) f=f.filter(a=>a.status===statusFilter);
  return f;
}

// ---------- Pesquisa ----------
function highlightSearchResults(){
  if(!searchQuery) return;
  const q=searchQuery.toLowerCase();
  document.querySelectorAll('.appointment').forEach(el=>{
    const text=el.textContent.toLowerCase();
    el.classList.toggle('search-match', text.includes(q));
  });
}

// ---------- Conexão ----------
function updateConnBadge(){
  const badge=document.getElementById('connectionBadge'); if(!badge) return;
  const st=window.apiClient.getConnectionStatus();
  badge.className=`conn-badge ${st.online?'online':'offline'}`;
  badge.textContent=st.online?'ONLINE':'OFFLINE';
  badge.title=st.online?'Conectado à cloud':'Modo offline - dados locais';
}

// ---------- Persistência ----------
async function persistBuckets(buckets){
  const promises=[];
  for(const bucket of buckets){
    const items=getBucketList(bucket);
    for(const item of items){
      if(editingId && String(item.id)===String(editingId)) continue;
      promises.push(window.apiClient.updateAppointment(item.id,item).catch(e=>console.warn('Persist error:',e)));
    }
  }
  await Promise.allSettled(promises);
}

// ---------- Status ----------
function attachStatusListeners(){
  document.querySelectorAll('.appt-status input[type="checkbox"]').forEach(cb=>{
    cb.addEventListener('change', async function(){
      if(!this.checked) return;
      const card=this.closest('.appointment');
      const id=card?.dataset.id;
      if(!id) return;
      const newStatus=this.dataset.status;
      card.querySelectorAll('.appt-status input[type="checkbox"]').forEach(x=>x.checked=false);
      this.checked=true;
      const idx=appointments.findIndex(a=>String(a.id)===String(id));
      if(idx>=0){
        appointments[idx].status=newStatus;
        try{ await window.apiClient.updateAppointment(id,{status:newStatus}); }
        catch(e){ console.warn('Status update error:',e); }
      }
      renderAll();
    });
  });
}

// ---------- Drag & Drop ----------
let dragThrottle=false;
function enableDragDrop(){
  if(enableDragDrop._bound) return;
  document.addEventListener('dragstart',e=>{
    if(!e.target.classList.contains('appointment')) return;
    e.dataTransfer.setData('text/plain',e.target.dataset.id);
    e.target.classList.add('dragging');
  });
  document.addEventListener('dragend',e=>{
    if(!e.target.classList.contains('appointment')) return;
    e.target.classList.remove('dragging');
  });
  document.addEventListener('dragover',e=>{
    const zone=e.target.closest('.drop-zone');
    if(!zone) return;
    e.preventDefault();
    document.querySelectorAll('.drop-zone').forEach(z=>z.classList.remove('drag-over'));
    zone.classList.add('drag-over');
  });
  document.addEventListener('dragleave',e=>{
    if(!e.target.closest('.drop-zone')) document.querySelectorAll('.drop-zone').forEach(z=>z.classList.remove('drag-over'));
  });
  document.addEventListener('drop',async e=>{
    const zone=e.target.closest('.drop-zone');
    if(!zone || dragThrottle) return;
    e.preventDefault();
    dragThrottle=true; setTimeout(()=>dragThrottle=false,300);
    const id=e.dataTransfer.getData('text/plain');
    const bucket=zone.dataset.dropBucket;
    const cards=[...zone.querySelectorAll('.appointment:not(.dragging)')];
    const rect=zone.getBoundingClientRect();
    const y=e.clientY-rect.top;
    let targetIndex=0;
    for(let i=0;i<cards.length;i++){
      const cardRect=cards[i].getBoundingClientRect();
      const cardY=cardRect.top-rect.top+cardRect.height/2;
      if(y>cardY) targetIndex=i+1;
    }
    document.querySelectorAll('.drop-zone').forEach(z=>z.classList.remove('drag-over'));
    await onDropAppointment(id,bucket,targetIndex);
  });
  if(!enableDragDrop._bound){
    enableDragDrop._bound = true;
  }
}

async function onDropAppointment(id, targetBucket, targetIndex){
  const i = appointments.findIndex(a => String(a.id) === String(id));
  if (i < 0) return;
  const a = appointments[i];
  const oldBucket = bucketOf(a);

  if(targetBucket === 'unscheduled'){ a.date=null; a.period=null; }
  else { const [d,p] = targetBucket.split('|'); a.date=d; a.period=p||'Manhã'; }

  const dest = getBucketList(targetBucket).filter(x=>String(x.id)!==String(a.id));
  dest.splice(Math.min(targetIndex, dest.length), 0, a);
  dest.forEach((x,idx)=> x.sortIndex = idx+1);

  if (oldBucket !== targetBucket){
    const orig = getBucketList(oldBucket);
    orig.forEach((x,idx)=> x.sortIndex = idx+1);
  }

  renderAll();
  const bucketsToPersist = new Set([targetBucket, oldBucket]);
  await persistBuckets(bucketsToPersist);
}

// ---------- Render DESKTOP (cartões) ----------
function buildDesktopCard(a){
  const base = getLocColor(a.locality);
  const g = gradFromBase(base);
  const bar = statusBarColors[a.status] || '#999';
  const title = `${a.plate} | ${a.service} | ${(a.car||'').toUpperCase()}`;
  const sub   = [a.locality, a.notes].filter(Boolean).join(' | ');
  return `
    <div class="appointment desk-card" data-id="${a.id}" draggable="true"
         data-locality="${a.locality||''}" data-loccolor="${base}"
         style="--c1:${g.c1}; --c2:${g.c2}; border-left:6px solid ${bar}">
      <div class="dc-title">${title}</div>
      <div class="dc-sub">${sub}</div>
      <div class="appt-status dc-status">
        <label><input type="checkbox" data-status="NE" ${a.status==='NE'?'checked':''}/> N/E</label>
        <label><input type="checkbox" data-status="VE" ${a.status==='VE'?'checked':''}/> V/E</label>
        <label><input type="checkbox" data-status="ST" ${a.status==='ST'?'checked':''}/> ST</label>
      </div>
    </div>`;
}

function renderSchedule(){
  const table=document.getElementById('schedule'); if(!table) return;
  table.innerHTML='';
  const week=[...Array(6)].map((_,i)=>addDays(currentMonday,i)); // Seg-Sáb
  const wr=document.getElementById('weekRange');
  if(wr){ wr.textContent = `${week[0].toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'})} - ${week[5].toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit',year:'numeric'})}`; }

  let thead='<thead><tr><th>Período</th>';
  for(const d of week){ const h=fmtHeader(d); thead+=`<th><div class="day">${cap(h.day)}</div><div class="date">${h.dm}</div></th>`; }
  thead+='</tr></thead>';
  table.insertAdjacentHTML('beforeend', thead);

  const renderCell=(period,dayDate)=>{
    const iso=localISO(dayDate);
    const items=filterAppointments(
      appointments.filter(a=>a.date&&a.date===iso&&a.period===period)
                  .sort((x,y)=>(x.sortIndex||0)-(y.sortIndex||0))
    );
    const blocks = items.map(buildDesktopCard).join('');
    return `<div class="drop-zone" data-drop-bucket="${iso}|${period}">${blocks}</div>`;
  };

  const tbody=document.createElement('tbody');
  ['Manhã','Tarde'].forEach(period=>{
    const row=document.createElement('tr');
    row.innerHTML=`<th>${period}</th>` + week.map(d=>`<td>${renderCell(period,d)}</td>`).join('');
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  enableDragDrop(); attachStatusListeners(); highlightSearchResults();
}

// ---------- Render PENDENTES ----------
function renderUnscheduled(){
  const container=document.getElementById('unscheduledList'); if(!container) return;
  const unscheduled=filterAppointments(
    appointments.filter(a=>!a.date||!a.period).sort((x,y)=>(x.sortIndex||0)-(y.sortIndex||0))
  );
  const blocks = unscheduled.map(a=>{
    const base=getLocColor(a.locality);
    const g=gradFromBase(base);
    const bar=statusBarColors[a.status]||'#999';
    const title=`${a.plate} | ${a.service} | ${(a.car||'').toUpperCase()}`;
    const sub=[a.locality,a.notes].filter(Boolean).join(' | ');
    return `
      <div class="appointment desk-card unscheduled" data-id="${a.id}" draggable="true"
           data-locality="${a.locality||''}" data-loccolor="${base}"
           style="--c1:${g.c1}; --c2:${g.c2}; border-left:6px solid ${bar}">
        <div class="dc-title">${title}</div>
        <div class="dc-sub">${sub}</div>
        <div class="appt-status dc-status">
          <label><input type="checkbox" data-status="NE" ${a.status==='NE'?'checked':''}/> N/E</label>
          <label><input type="checkbox" data-status="VE" ${a.status==='VE'?'checked':''}/> V/E</label>
          <label><input type="checkbox" data-status="ST" ${a.status==='ST'?'checked':''}/> ST</label>
        </div>
        <div class="unscheduled-actions">
          <button class="icon edit" onclick="editAppointment('${a.id}')" title="Editar">✏️</button>
          <button class="icon delete" onclick="deleteAppointment('${a.id}')" title="Eliminar">🗑️</button>
        </div>
      </div>`;
  }).join('');
  container.innerHTML=`<div class="drop-zone" data-drop-bucket="unscheduled">${blocks}</div>`;
  enableDragDrop(); attachStatusListeners(); highlightSearchResults();
}

// ---------- Header da tabela ----------
function ensureServicesHeader(){
  const table = document.querySelector('.services-table'); if(!table) return;
  let thead = table.querySelector('thead'); if(!thead){ thead = document.createElement('thead'); table.prepend(thead); }
  const headers = ['Data','Período','Matrícula','Carro','Serviço','Localidade','Observações','Estado','Dias','Ações'];
  thead.innerHTML = `<tr>${
    headers.map(h => h==='Ações'
      ? `<th class="no-print actions-col" style="width:100px;text-align:left">Ações</th>`
      : `<th>${h}</th>`
    ).join('')
  }</tr>`;
}

// ---------- Render TABELA FUTURA ----------
function renderServicesTable(){
  const tbody=document.getElementById('servicesTableBody'); if(!tbody) return;
  ensureServicesHeader();
  const today = new Date(); today.setHours(0,0,0,0);
  const future = filterAppointments(
    appointments.filter(a => a.date && new Date(a.date) >= today)
               .sort((a,b) => new Date(a.date) - new Date(b.date))
  );
  tbody.innerHTML=future.map(a=>{
    const d=new Date(a.date); d.setHours(0,0,0,0);
    const diff=Math.ceil((d - today)/(1000*60*60*24));
    const when = diff<0? `${Math.abs(diff)} dias atrás` : diff===0? 'Hoje' : diff===1? 'Amanhã' : `${diff} dias`;
    const notes = (a.notes||'').replace(/"/g,'&quot;');
    return `<tr>
      <td>${d.toLocaleDateString('pt-PT')}</td>
      <td>${a.period||''}</td>
      <td>${a.plate||''}</td>
      <td>${a.car||''}</td>
      <td><span class="badge badge-${a.service}">${a.service||''}</span></td>
      <td>${a.locality||''}</td>
      <td title="${notes}">${a.notes||''}</td>
      <td><span class="chip chip-${a.status}">${a.status||''}</span></td>
      <td>${when}</td>
      <td class="no-print">
        <div class="actions">
          <button class="icon edit" onclick="editAppointment('${a.id}')" title="Editar" aria-label="Editar">✏️</button>
          <button class="icon delete" onclick="deleteAppointment('${a.id}')" title="Eliminar" aria-label="Eliminar">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
  const sum=document.getElementById('servicesSummary'); if(sum) sum.textContent=`${future.length} serviços pendentes`;
}

// ---------- Render MOBILE (lista do dia) - APENAS ÍCONES CORRIGIDOS ----------
function buildMobileCard(a){
  // APENAS correção dos ícones - resto mantido igual ao original
  const mapsBtn = a.address ? `
    <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.address)}"
       target="_blank" rel="noopener noreferrer"
       style="position:absolute;top:8px;right:8px;background:#fff;border-radius:50%;padding:4px;box-shadow:0 2px 6px rgba(0,0,0,0.25);width:28px;height:28px;display:flex;align-items:center;justify-content:center;">
      📍
    </a>` : '';

  const wazeBtn = a.address ? `
    <a href="https://waze.com/ul?q=${encodeURIComponent(a.address)}"
       target="_blank" rel="noopener noreferrer"
       style="position:absolute;top:8px;right:40px;background:#fff;border-radius:50%;padding:4px;box-shadow:0 2px 6px rgba(0,0,0,0.25);width:28px;height:28px;display:flex;align-items:center;justify-content:center;">
      🚗
    </a>` : '';

  const base = getLocColor(a.locality);
  const g = gradFromBase(base);
  const title = `${a.plate} • ${(a.car||'').toUpperCase()}`;
  const chips = [
    a.period ? `<span class="m-chip">${a.period}</span>` : '',
    a.service ? `<span class="m-chip">${a.service}</span>` : '',
    a.locality ? `<span class="m-chip">${a.locality}</span>` : ''
  ].join('');
  const notes = a.notes ? `<div class="m-info">${a.notes}</div>` : '';
  return `
    <div class="appointment m-card" data-id="${a.id}"
         style="--c1:${g.c1}; --c2:${g.c2}; position:relative;">
      ${mapsBtn}${wazeBtn}
      <div class="m-title" style="padding-right:${a.address ? '80px' : '10px'};">${title}</div>
      <div class="m-chips">${chips}</div>
      ${notes}
    </div>
  `;
}

function renderMobileDay(){
  const list = document.getElementById('mobileDayList');
  const label = document.getElementById('mobileDayLabel');
  if(!list || !label) return;
  const iso = localISO(currentMobileDay);
  const weekday = currentMobileDay.toLocaleDateString('pt-PT',{ weekday:'long' });
  const dm = currentMobileDay.toLocaleDateString('pt-PT',{ day:'2-digit', month:'2-digit' });
  label.textContent = `${cap(weekday)} • ${dm}`;

  const items = filterAppointments(
    appointments
      .filter(a => a.date === iso)
      .sort((a,b)=> (a.period||'').localeCompare(b.period||'') || (a.sortIndex||0)-(b.sortIndex||0))
  );

  if(items.length === 0){
    list.innerHTML = `<div class="m-card" style="--c1:#9ca3af;--c2:#6b7280;">Sem serviços para este dia.</div>`;
    return;
  }

  // Separar por período para legibilidade
  const morning = items.filter(a=>a.period==='Manhã').map(buildMobileCard).join('');
  const afternoon = items.filter(a=>a.period==='Tarde').map(buildMobileCard).join('');
  const others = items.filter(a=>!a.period).map(buildMobileCard).join('');

  list.innerHTML = `
    ${morning? `<h4 style="margin:4px 0 6px 8px;">Manhã</h4>${morning}`:''}
    ${afternoon? `<h4 style="margin:12px 0 6px 8px;">Tarde</h4>${afternoon}`:''}
    ${others? `<h4 style="margin:12px 0 6px 8px;">Sem período</h4>${others}`:''}
  `;
  highlightSearchResults();
}

function renderAll(){ renderSchedule(); renderUnscheduled(); renderServicesTable(); renderMobileDay(); }

// ---------- CRUD ----------
function openAppointmentModal(id=null){
  editingId=id; const modal=document.getElementById('appointmentModal'); if(!modal) return;
  const form=document.getElementById('appointmentForm');
  const title=document.getElementById('modalTitle');
  const del=document.getElementById('deleteAppointment');
  if(id){
    const a=appointments.find(x=>String(x.id)===String(id));
    if(a){
      title.textContent='Editar Agendamento';
      document.getElementById('appointmentDate').value = formatDateForInput(a.date) || '';
      document.getElementById('appointmentPeriod').value = a.period||'';
      document.getElementById('appointmentPlate').value = a.plate||'';
      document.getElementById('appointmentCar').value = a.car||'';
      document.getElementById('appointmentService').value = a.service||'';
      document.getElementById('appointmentLocality').value = a.locality||'';
      const txt=document.getElementById('selectedLocalityText'); const dot=document.getElementById('selectedLocalityDot');
      if(txt) txt.textContent=a.locality||'Selecione a localidade';
      if(dot) dot.style.backgroundColor=getLocColor(a.locality);
      document.getElementById('appointmentStatus').value = a.status||'NE';
      document.getElementById('appointmentNotes').value = a.notes||'';
      document.getElementById('appointmentAddress').value = a.address || '';
      document.getElementById('appointmentExtra').value = a.extra||'';
      del.classList.remove('hidden');
    }
  }else{
    title.textContent='Novo Agendamento';
    if(form) form.reset();
    document.getElementById('appointmentStatus').value='NE';
    const txt=document.getElementById('selectedLocalityText'); const dot=document.getElementById('selectedLocalityDot');
    if(txt) txt.textContent='Selecione a localidade';
    if(dot) dot.style.backgroundColor='#ccc';
    del.classList.add('hidden');
  }
  modal.classList.add('show');
}
function closeAppointmentModal(){ const modal=document.getElementById('appointmentModal'); if(modal) modal.classList.remove('show'); editingId=null; }
async function saveAppointment(){
  const form=document.getElementById('appointmentForm'); if(!form) return;
  const data={
    date: parseDate(document.getElementById('appointmentDate').value),
    period: document.getElementById('appointmentPeriod').value||null,
    plate: document.getElementById('appointmentPlate').value.trim(),
    car: document.getElementById('appointmentCar').value.trim(),
    service: document.getElementById('appointmentService').value,
    locality: document.getElementById('appointmentLocality').value,
    status: document.getElementById('appointmentStatus').value||'NE',
    notes: document.getElementById('appointmentNotes').value.trim()||null,
    address: document.getElementById('appointmentAddress').value.trim() || null, // ✅ gravar morada
    extra: document.getElementById('appointmentExtra').value.trim()||null
  };
  if(!data.plate){ showToast('Matrícula é obrigatória','error'); return; }
  if(!data.car){ showToast('Modelo do carro é obrigatório','error'); return; }
  if(!data.service){ showToast('Tipo de serviço é obrigatório','error'); return; }
  if(!data.locality){ showToast('Localidade é obrigatória','error'); return; }

  try{
    if(editingId){
      const res=await window.apiClient.updateAppointment(editingId,data);
      const idx=appointments.findIndex(a=>String(a.id)===String(editingId));
      if(idx>=0) appointments[idx]={...appointments[idx],...(res||data)};
      showToast('Agendamento atualizado!','success');
    }else{
      const res=await window.apiClient.createAppointment(data);
      const newId = (res && (res.id || res.clientId)) || (Date.now()+Math.random());
      const newAppt={id:newId,sortIndex:1,...data,...(res||{})};
      appointments.push(newAppt);
      showToast('Agendamento criado!','success');
    }
    closeAppointmentModal(); renderAll();
  }catch(e){
    showToast('Erro: '+e.message,'error');
  }
}
function editAppointment(id){ openAppointmentModal(id); }
async function deleteAppointment(id){
  if(!confirm('Eliminar este agendamento?')) return;
  try{
    await window.apiClient.deleteAppointment(id);
    appointments=appointments.filter(a=>String(a.id)!==String(id));
    showToast('Agendamento eliminado!','success');
    closeAppointmentModal(); renderAll();
  }catch(e){
    showToast('Erro ao eliminar: '+e.message,'error');
  }
}

// ---------- Navegação ----------
function prevWeek(){ currentMonday=addDays(currentMonday,-7); renderSchedule(); }
function nextWeek(){ currentMonday=addDays(currentMonday,7); renderSchedule(); }
function todayWeek(){ currentMonday=getMonday(new Date()); renderSchedule(); }
function prevMobileDay(){ currentMobileDay=addDays(currentMobileDay,-1); renderMobileDay(); }
function nextMobileDay(){ currentMobileDay=addDays(currentMobileDay,1); renderMobileDay(); }
function todayMobileDay(){ currentMobileDay=new Date(); renderMobileDay(); }

// ---------- Localidades ----------
function selectLocality(locality){
  document.getElementById('appointmentLocality').value=locality;
  const txt=document.getElementById('selectedLocalityText'); const dot=document.getElementById('selectedLocalityDot');
  if(txt) txt.textContent=locality;
  if(dot) dot.style.backgroundColor=getLocColor(locality);
  document.getElementById('localityDropdown').classList.remove('show');
}
function toggleLocalityDropdown(){
  document.getElementById('localityDropdown').classList.toggle('show');
}

// ---------- Filtros ----------
function setSearchQuery(query){ searchQuery=query; renderAll(); }
function setStatusFilter(status){ statusFilter=status; renderAll(); }

// ---------- Impressão ----------
function printSchedule(){
  const printStyles=`
    <style>
      @media print {
        body * { visibility: hidden; }
        .schedule-container, .schedule-container * { visibility: visible; }
        .schedule-container { position: absolute; left: 0; top: 0; width: 100%; }
        .no-print { display: none !important; }
        .appointment { break-inside: avoid; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f5f5f5; }
        .desk-card { margin-bottom: 4px; padding: 6px; border: 1px solid #ddd; }
        .dc-title { font-weight: bold; font-size: 12px; }
        .dc-sub { font-size: 10px; color: #666; }
        .dc-status { display: none; }
      }
    </style>
  `;
  const head=document.head.innerHTML;
  const content=document.querySelector('.schedule-container').innerHTML;
  const printWindow=window.open('','_blank');
  printWindow.document.write(`
    <html>
      <head>${head}${printStyles}</head>
      <body>
        <div class="schedule-container">${content}</div>
        <script>window.onload=()=>window.print();</script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function printServices(){
  const printStyles=`
    <style>
      @media print {
        body * { visibility: hidden; }
        .services-container, .services-container * { visibility: visible; }
        .services-container { position: absolute; left: 0; top: 0; width: 100%; }
        .no-print { display: none !important; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
        th { background-color: #f5f5f5; font-weight: bold; }
        .badge, .chip { padding: 2px 6px; border-radius: 3px; font-size: 10px; }
        .badge-PB { background: #dbeafe; color: #1e40af; }
        .badge-VE { background: #fef3c7; color: #92400e; }
        .badge-ST { background: #d1fae5; color: #065f46; }
        .chip-NE { background: #fee2e2; color: #991b1b; }
        .chip-VE { background: #fef3c7; color: #92400e; }
        .chip-ST { background: #d1fae5; color: #065f46; }
      }
    </style>
  `;
  const head=document.head.innerHTML;
  const content=document.querySelector('.services-container').innerHTML;
  const printWindow=window.open('','_blank');
  printWindow.document.write(`
    <html>
      <head>${head}${printStyles}</head>
      <body>
        <div class="services-container">${content}</div>
        <script>window.onload=()=>window.print();</script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// ---------- Exportação ----------
function exportToCSV(){
  const headers=['Data','Período','Matrícula','Carro','Serviço','Localidade','Estado','Observações','Morada'];
  const rows=appointments.map(a=>[
    a.date||'',a.period||'',a.plate||'',a.car||'',a.service||'',a.locality||'',a.status||'',a.notes||'',a.address||''
  ]);
  const csv=[headers,...rows].map(row=>row.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download=`agendamentos_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
}

// ---------- Inicialização ----------
document.addEventListener('DOMContentLoaded',async()=>{
  await load();
  renderAll();
  setInterval(updateConnBadge,30000);
  
  // Event listeners
  document.getElementById('searchInput')?.addEventListener('input',e=>setSearchQuery(e.target.value));
  document.getElementById('statusFilterSelect')?.addEventListener('change',e=>setStatusFilter(e.target.value));
  
  // Fechar dropdown ao clicar fora
  document.addEventListener('click',e=>{
    if(!e.target.closest('.locality-selector')){
      document.getElementById('localityDropdown')?.classList.remove('show');
    }
  });
});

console.log('✅ Portal de Agendamento Expressglass restaurado - versão original com ícones simples!');