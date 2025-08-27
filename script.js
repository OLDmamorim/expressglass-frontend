if(window.__EG_INIT_DONE__){};window.__EG_INIT_DONE__=true;
// ===== PORTAL DE AGENDAMENTO MELHORADO =====
// Versão com API + cartões estilo mobile também no DESKTOP

// ---------- Configurações e dados ----------
const localityColors = {
  'Outra': '#9CA3AF', 'Barcelos': '#F87171', 'Braga': '#34D399', 'Esposende': '#22D3EE',
  'Famalicão': '#2DD4BF', 'Guimarães': '#FACC15', 'Póvoa de Lanhoso': '#A78BFA',
  'Póvoa de Varzim': '#6EE7B7', 'Riba D\'Ave': '#FBBF24', 'Trofa': '#C084FC',
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
function getMonday(date){ const d=new Date(date); const day=d.getDay(); const diff=d.getDate()-day+(day===0?-6:1); return new Date(d.setDate(diff)); }
function addDays(date,days){ const r=new Date(date); r.setDate(r.getDate()+days); return r; }
function localISO(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }

function parseDate(dateStr){
  if(!dateStr) return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)){ const [d,m,y]=dateStr.split('/'); return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  try{ const d=new Date(dateStr); if(!isNaN(d.getTime())) return localISO(d); }catch{}
  return '';
}
function formatDateForInput(s){ if(!s) return ''; if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ const [y,m,d]=s.split('-'); return `${d}/${m}/${y}`; } return s; }
function fmtHeader(date){ return {day: date.toLocaleDateString('pt-PT',{weekday:'long'}), dm: date.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'})}; }
const cap = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : s;

function hex2rgba(h,a){ const r=parseInt(h.slice(1,3),16), g=parseInt(h.slice(3,5),16), b=parseInt(h.slice(5,7),16); return `rgba(${r},${g},${b},${a})`; }
function parseColor(str){
  if(!str) return null;
  str=String(str).trim();
  if(str[0]==='#'){
    if(str.length===4) return {r:parseInt(str[1]+str[1],16), g:parseInt(str[2]+str[2],16), b:parseInt(str[3]+str[3],16)};
    if(str.length>=7) return {r:parseInt(str.slice(1,3),16), g:parseInt(str.slice(3,5),16), b:parseInt(str.slice(5,7),16)};
  }
  const m=str.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if(m) return {r:+m[1], g:+m[2], b:+m[3]};
  return null;
}
const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
const toHex = n => n.toString(16).padStart(2,'0');
const rgbToHex = ({r,g,b}) => '#'+toHex(clamp(r))+toHex(clamp(g))+toHex(clamp(b));
const lighten = (rgb,a)=>({ r:rgb.r+(255-rgb.r)*a, g:rgb.g+(255-rgb.g)*a, b:rgb.b+(255-rgb.b)*a });
const darken  = (rgb,a)=>({ r:rgb.r*(1-a),       g:rgb.g*(1-a),       b:rgb.b*(1-a)       });
function gradFromBase(hex){
  const rgb = parseColor(hex) || parseColor('#1e88e5');
  return { c1: rgbToHex(lighten(rgb,0.06)), c2: rgbToHex(darken(rgb,0.18)) };
}

function bucketOf(a){ if(!a.date || !a.period) return 'unscheduled'; return `${a.date}|${a.period}`; }
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

// ---------- API (assíncrona; liga ao teu backend/Netlify) ----------
async function save(){ try{ showToast('Dados sincronizados com sucesso!','success'); }catch(e){ showToast('Erro na sincronização: '+e.message,'error'); } }
async function load(){
  try{
    showToast('Carregando dados...','info');
    appointments = await window.apiClient.getAppointments();
    appointments.forEach(a=>{ if(!a.id) a.id=Date.now()+Math.random(); if(!a.sortIndex) a.sortIndex=1; });
    const locs=await window.apiClient.getLocalities();
    if(locs && typeof locs==='object'){ Object.assign(localityColors,locs); window.LOCALITY_COLORS=localityColors; }
    const st=window.apiClient.getConnectionStatus();
    showToast(st.online?'Dados carregados da cloud!':'Dados carregados localmente (offline)', st.online?'success':'info');
  }catch(e){
    appointments=[]; showToast('Erro ao carregar dados: '+e.message,'error');
  }
}

// ---------- Filtros e pesquisa ----------
function filterAppointments(list){
  let f=[...list];
  if(searchQuery){
    const q=searchQuery.toLowerCase();
    f=f.filter(a=>
      (a.plate||'').toLowerCase().includes(q) ||
      (a.car||'').toLowerCase().includes(q) ||
      (a.locality||'').toLowerCase().includes(q) ||
      (a.notes && a.notes.toLowerCase().includes(q))
    );
  }
  if(statusFilter) f=f.filter(a=>a.status===statusFilter);
  return f;
}
function highlightSearchResults(){
  if(!searchQuery) return;
  document.querySelectorAll('.appointment').forEach(el=>{
    el.classList.remove('highlight');
    if(el.textContent.toLowerCase().includes(searchQuery.toLowerCase())) el.classList.add('highlight');
  });
}

// ---------- Persistência de STATUS (optimista) ----------
async function persistStatus(id, newStatus) {
  const idx = appointments.findIndex(a => a.id === id);
  if (idx < 0) return;
  const prev = appointments[idx].status;
  appointments[idx].status = newStatus; // otimista
  try {
    const payload = { ...appointments[idx], status: newStatus };
    const res = await window.apiClient.updateAppointment(id, payload);
    if (res && typeof res === 'object') appointments[idx] = { ...appointments[idx], ...res };
    showToast(`Status guardado: ${newStatus}`, 'success');
  } catch (err) {
    appointments[idx].status = prev;
    showToast('Falha ao gravar status: ' + err.message, 'error');
  } finally {
    renderAll();
  }
}

// ---------- Geração de cartão (cores dependem da localidade/status) ----------
function baseGradFor(a){
  const base=getLocColor(a.locality);
  const g=gradFromBase(base);
  const bar=statusBarColors[a.status]||'#94a3b8';
  return {base, g, bar};
}

// ---------- Render Desktop ----------
function renderDesktop(){
  const cont=document.getElementById('desktopView');
  if(!cont) return;
  cont.innerHTML='';
  for(let i=0;i<7;i++){
    const d=addDays(currentMonday,i);
    const h=fmtHeader(d);
    const appts=filterAppointments(appointments.filter(a=>a.date===localISO(d)));
    const col=document.createElement('div'); col.className='day-column';
    col.innerHTML=`
      <div class="day-header">
        <span>${cap(h.day)}</span><span class="date">${h.dm}</span>
      </div>
      <div class="list" id="list-${localISO(d)}"></div>
    `;
    cont.appendChild(col);
    const listEl=col.querySelector('.list');
    appts.forEach(a=>{
      const {base,g,bar}=baseGradFor(a);
      const card=document.createElement('div');
      card.className=`appointment status-${a.status}`;
      card.setAttribute('data-id',a.id);
      card.innerHTML=`
        <div class="left" style="background:${bar}"></div>
        <div class="content">
          <div class="row1"><span class="period">${a.period||''}</span><span class="plate">${a.plate}</span></div>
          <div class="row2"><span class="service">${a.service}</span><span class="car">${a.car}</span></div>
          <div class="row3">
            <span class="badge"><span class="dot" style="background:${base}"></span>${a.locality}</span>
            <div class="actions">
              <button class="btn" onclick="editAppointment(${a.id})">✏️</button>
              <button class="btn" onclick="deleteAppointment(${a.id})">🗑️</button>
            </div>
          </div>
          ${a.notes?`<div class="notes">${a.notes}</div>`:''}
        </div>`;
      listEl.appendChild(card);
    });
  }
  highlightSearchResults();
}

// ---------- Render Mobile ----------
function renderMobileDay(){
  const c=document.getElementById('mobileDay');
  if(!c) return;
  const h=fmtHeader(currentMobileDay);
  document.getElementById('mobileDayName').textContent=cap(h.day);
  document.getElementById('mobileDayDate').textContent=h.dm;
  const str=localISO(currentMobileDay);
  const list=filterAppointments(appointments.filter(a=>a.date===str));
  const container=document.getElementById('mobileDayList'); if(!container) return;
  container.innerHTML=list.map(a=>{
    const base=getLocColor(a.locality);
    const g=gradFromBase(base);
    const bar=statusBarColors[a.status]||'#999';
    const title=`${a.period} – ${a.plate} | ${a.service} | ${a.car.toUpperCase()}`;
    const sub=[a.locality,a.notes].filter(Boolean).join(' | ');
    return `
      <div class="appointment m-card"
           data-period="${a.period}" data-status="${a.status}"
           data-locality="${a.locality}" data-loccolor="${base}"
           style="--c1:${g.c1}; --c2:${g.c2}; border-left:6px solid ${bar}; margin-bottom:12px;">
        <div class="m-title">${title}</div>
        <div class="m-sub">${sub}</div>
      </div>`;
  }).join('');
  highlightSearchResults();
}

// ---------- CRUD ----------
function openAppointmentModal(id=null){
  editingId=id; const modal=document.getElementById('appointmentModal'); if(!modal) return;
  const form=document.getElementById('appointmentForm');
  const title=document.getElementById('modalTitle');
  const del=document.getElementById('deleteAppointment');
  if(id){
    const a=appointments.find(x=>x.id===id);
    if(a){
      title.textContent='Editar Agendamento';
      document.getElementById('appointmentDate').value = formatDateForInput(a.date) || '';
      document.getElementById('appointmentPeriod').value = a.period||'';
      document.getElementById('appointmentPlate').value = a.plate||'';
      document.getElementById('appointmentCar').value = a.car||'';
      document.getElementById('appointmentService').value = a.service||'';
      document.getElementById('appointmentLocality').value = a.locality||'';
      document.getElementById('appointmentStatus').value = a.status||'NE';
      document.getElementById('appointmentNotes').value = a.notes||'';
      document.getElementById('appointmentExtra').value = a.extra||'';
      del.classList.remove('hidden');
    }
  }else{
    title.textContent='Novo Agendamento'; form.reset();
    document.getElementById('appointmentStatus').value='NE';
    del.classList.add('hidden');
  }
  modal.classList.add('show');
}
function closeAppointmentModal(){ document.getElementById('appointmentModal')?.classList.remove('show'); editingId=null; }
async function saveAppointment(){
  const rawDate=document.getElementById('appointmentDate').value;
  const a={
    id: editingId || Date.now()+Math.random(),
    date: parseDate(rawDate),
    period: document.getElementById('appointmentPeriod').value,
    plate: document.getElementById('appointmentPlate').value.toUpperCase(),
    car: document.getElementById('appointmentCar').value,
    service: document.getElementById('appointmentService').value,
    locality: document.getElementById('appointmentLocality').value,
    status: document.getElementById('appointmentStatus').value,
    notes: document.getElementById('appointmentNotes').value,
    extra: document.getElementById('appointmentExtra').value,
    sortIndex: 1
  };
  if(!a.plate || !a.car || !a.service || !a.locality){
    showToast('Por favor, preencha todos os campos obrigatórios (Matrícula, Carro, Serviço, Localidade).','error'); return;
  }
  try{
    let res;
    if(editingId){
      res=await window.apiClient.updateAppointment(editingId,a);
      const i=appointments.findIndex(x=>x.id===editingId); if(i>=0) appointments[i]={...appointments[i],...res};
      showToast('Agendamento atualizado com sucesso!','success');
    }else{
      res=await window.apiClient.createAppointment(a);
      appointments.push(res); showToast('Serviço criado com sucesso!','success');
    }
    await save(); renderAll(); closeAppointmentModal();
  }catch(e){ console.error(e); showToast('Erro ao salvar: '+e.message,'error'); }
}
function editAppointment(id){ openAppointmentModal(id); }
async function deleteAppointment(id){
  if(confirm('Tem certeza que deseja eliminar este agendamento?')){
    try{
      await window.apiClient.deleteAppointment(id);
      appointments=appointments.filter(a=>a.id!==id);
      await save(); renderAll(); showToast('Agendamento eliminado com sucesso!','success');
      if(editingId===id) closeAppointmentModal();
    }catch(e){ showToast('Erro ao eliminar: '+e.message,'error'); }
  }
}

// ---------- Status listeners ----------
function attachStatusListeners(){
  document.querySelectorAll('.appt-status input[type="checkbox"]').forEach(cb=>{
    cb.addEventListener('change', async function(){
      if (!this.checked) return;
      const el=this.closest('.appointment'); if(!el) return;
      const id=Number(el.getAttribute('data-id'));
      const st=this.getAttribute('data-status');
      el.querySelectorAll('.appt-status input[type="checkbox"]').forEach(x=>{ if(x!==this) x.checked=false; });
      await persistStatus(id, st);
    });
  });
}

// ---------- Estatísticas ----------
function generateStats(){
  const total = appointments.length;
  const scheduled = appointments.filter(a => a.date && a.period).length;
  const unscheduled = total - scheduled;
  const byStatus = { NE:0, VE:0, ST:0 };
  appointments.forEach(a => { if (byStatus[a.status] != null) byStatus[a.status]++; });
  const byService = {}; appointments.forEach(a => { byService[a.service] = (byService[a.service] || 0) + 1; });
  const byLocality = {}; appointments.forEach(a => { byLocality[a.locality] = (byLocality[a.locality] || 0) + 1; });
  return { total, scheduled, unscheduled, byStatus, byService, byLocality };
}
function showStats(){
  const modal = document.getElementById('statsModal');
  const c = document.getElementById('statsContent');
  if (!modal || !c) return;
  const s = generateStats();
  c.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-number">${s.total