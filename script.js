if(window.__EG_INIT_DONE__){}; window.__EG_INIT_DONE__=true;

// ===== PORTAL DE AGENDAMENTO (compat v2) =====

// ---------- Cores / dados ----------
const localityColors = {
  'Outra': '#9CA3AF','Barcelos': '#F87171','Braga': '#34D399','Esposende': '#22D3EE',
  'Famalicão': '#2DD4BF','Guimarães': '#FACC15','Póvoa de Lanhoso': '#A78BFA',
  'Póvoa de Varzim': '#6EE7B7','Riba D\'Ave': '#FBBF24','Trofa': '#C084FC',
  'Vieira do Minho': '#93C5FD','Vila do Conde': '#FCD34D','Vila Verde': '#86EFAC'
};
window.LOCALITY_COLORS = localityColors;
const getLocColor = loc => (localityColors && localityColors[loc]) || '#3b82f6';
const statusBarColors = { NE:'#EF4444', VE:'#F59E0B', ST:'#10B981' };

// ---------- Estado ----------
let appointments = [];
let currentMonday = getMonday(new Date());
let currentMobileDay = new Date();
let editingId = null;
let searchQuery = '';
let statusFilter = '';

// ---------- Utils ----------
const cap = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : s;
function getMonday(date){ const d=new Date(date); const day=d.getDay(); const diff=d.getDate()-day+(day===0?-6:1); return new Date(d.setDate(diff)); }
function addDays(date,days){ const r=new Date(date); r.setDate(r.getDate()+days); return r; }
function localISO(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function fmtHeader(date){ return {day: date.toLocaleDateString('pt-PT',{weekday:'long'}), dm: date.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'})}; }
function parseDate(dateStr){
  if(!dateStr) return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)){ const [d,m,y]=dateStr.split('/'); return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  try{ const d=new Date(dateStr); if(!isNaN(d.getTime())) return localISO(d);}catch{}
  return '';
}
function formatDateForInput(s){ if(!s) return ''; if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ const [y,m,d]=s.split('-'); return `${d}/${m}/${y}`;} return s; }

// helpers de compatibilidade de IDs
const gid=(...ids)=> ids.map(id=>document.getElementById(id)).find(el=>!!el) || null;
const val=(...ids)=>{ const el=gid(...ids); return el ? el.value : ''; };
const setVal=(v,...ids)=>{ const el=gid(...ids); if(el){ el.value=v; return true;} return false; };

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

// ---------- API (mock ligações externas) ----------
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
  }catch(e){ appointments=[]; showToast('Erro ao carregar dados: '+e.message,'error'); }
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

// ---------- Render helpers ----------
function gradFromBase(hex){
  const parseColor=(str)=>{
    if(!str) return null;
    str=String(str).trim();
    if(str[0]==='#'){
      if(str.length===4) return {r:parseInt(str[1]+str[1],16), g:parseInt(str[2]+str[2],16), b:parseInt(str[3]+str[3],16)};
      if(str.length>=7) return {r:parseInt(str.slice(1,3),16), g:parseInt(str.slice(3,5),16), b:parseInt(str.slice(5,7),16)};
    }
    const m=str.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if(m) return {r:+m[1], g:+m[2], b:+m[3]};
    return {r:30,g:136,b:229};
  };
  const clamp=n=>Math.max(0,Math.min(255,Math.round(n)));
  const toHex=n=>n.toString(16).padStart(2,'0');
  const rgbToHex=({r,g,b})=>'#'+toHex(clamp(r))+toHex(clamp(g))+toHex(clamp(b));
  const lighten=(rgb,a)=>({ r:rgb.r+(255-rgb.r)*a, g:rgb.g+(255-rgb.g)*a, b:rgb.b+(255-rgb.b)*a });
  const darken =(rgb,a)=>({ r:rgb.r*(1-a), g:rgb.g*(1-a), b:rgb.b*(1-a) });
  const rgb = parseColor(hex);
  return { c1: rgbToHex(lighten(rgb,0.06)), c2: rgbToHex(darken(rgb,0.18)) };
}
function baseGradFor(a){
  const base=getLocColor(a.locality);
  const g=gradFromBase(base);
  const bar=statusBarColors[a.status]||'#94a3b8';
  return {base, g, bar};
}
function cardHTML(a){
  const {base,g,bar}=baseGradFor(a);
  return `
    <div class="appointment ${a.status?'status-'+a.status:''}" data-id="${a.id}"
         style="--c1:${g.c1}; --c2:${g.c2}; border-left:6px solid ${bar};">
      <div class="content">
        <div class="row1"><span class="period">${a.period||''}</span><span class="plate">${a.plate||''}</span></div>
        <div class="row2"><span class="service">${a.service||''}</span><span class="car">${a.car||''}</span></div>
        <div class="row3">
          <span class="badge"><span class="dot" style="background:${base}"></span>${a.locality||''}</span>
          <div class="actions">
            <button class="btn" onclick="editAppointment(${a.id})">✏️</button>
            <button class="btn" onclick="deleteAppointment(${a.id})">🗑️</button>
          </div>
        </div>
        ${a.notes?`<div class="notes">${a.notes}</div>`:''}
      </div>
    </div>`;
}

// ---------- Render Desktop (compat #desktopView ou #schedule) ----------
function renderDesktop(){
  const cont=document.getElementById('desktopView');
  const schedTable=document.getElementById('schedule');

  // modo antigo (columns)
  if(cont){
    cont.innerHTML='';
    for(let i=0;i<7;i++){
      const d=addDays(currentMonday,i);
      const h=fmtHeader(d);
      const list=filterAppointments(appointments.filter(a=>a.date===localISO(d)));
      const col=document.createElement('div'); col.className='day-column';
      col.innerHTML=`
        <div class="day-header"><span>${cap(h.day)}</span><span class="date">${h.dm}</span></div>
        <div class="list" id="list-${localISO(d)}">${list.map(cardHTML).join('')}</div>`;
      cont.appendChild(col);
    }
    highlightSearchResults();
    return;
  }

  // modo atual (tabela #schedule)
  if(schedTable){
    const days=[...Array(7)].map((_,i)=>addDays(currentMonday,i));
    const header=`<tr><th>Período</th>${days.map(d=>`<th>${cap(fmtHeader(d).day)}<div class="date">${fmtHeader(d).dm}</div></th>`).join('')}</tr>`;
    const rowFor=(period)=>`<tr>
      <td class="period-col">${period==='morning'?'Manhã':'Tarde'}</td>
      ${days.map(d=>{
        const str=localISO(d);
        const list=filterAppointments(appointments.filter(a=>a.date===str && (a.period||'').toLowerCase()===period));
        return `<td class="cell">${list.map(cardHTML).join('')}</td>`;
      }).join('')}
    </tr>`;
    schedTable.innerHTML = header + rowFor('morning') + rowFor('afternoon');
    highlightSearchResults();
  }
}

// ---------- Render Mobile ----------
function renderMobileDay(){
  const wrap=document.getElementById('mobileDay'); // se existir o layout antigo
  const nameEl=gid('mobileDayName'); const dateEl=gid('mobileDayDate');
  const listEl=gid('mobileDayList');
  if(!nameEl || !dateEl || !listEl) return;

  const h=fmtHeader(currentMobileDay);
  nameEl.textContent=cap(h.day);
  dateEl.textContent=h.dm;
  const str=localISO(currentMobileDay);
  const list=filterAppointments(appointments.filter(a=>a.date===str));
  listEl.innerHTML=list.map(cardHTML).join('');
  highlightSearchResults();
}

// ---------- CRUD ----------
function openAppointmentModal(id=null){
  editingId=id;
  const modal=gid('appointmentModal'); if(!modal) return;

  const title=gid('modalTitle');
  const delBtn=gid('deleteAppointment');

  if(id){
    const a=appointments.find(x=>x.id===id);
    if(a){
      if(title) title.textContent='Editar Agendamento';
      setVal(formatDateForInput(a.date),'appointmentDate','date');
      setVal(a.period,'appointmentPeriod','period');
      setVal(a.plate,'appointmentPlate','plate');
      setVal(a.car,'appointmentCar','car');
      setVal(a.service,'appointmentService','service');
      setVal(a.locality,'appointmentLocality','locality');
      setVal(a.status||'NE','appointmentStatus','status');
      setVal(a.notes||'','appointmentNotes','subline','notes');
      setVal(a.extra||'','appointmentExtra');
      if(delBtn) delBtn.classList.remove('hidden');
    }
  }else{
    if(title) title.textContent='Novo Agendamento';
    const form=gid('appointmentForm'); if(form) form.reset();
    setVal('NE','appointmentStatus','status');
    if(delBtn) delBtn.classList.add('hidden');
  }
  modal.classList.add('show');
}
function closeAppointmentModal(){ gid('appointmentModal')?.classList.remove('show'); editingId=null; }

async function saveAppointment(){
  const rawDate = val('appointmentDate','date');
  const a={
    id: editingId || Date.now()+Math.random(),
    date: parseDate(rawDate),
    period: val('appointmentPeriod','period'),
    plate: (val('appointmentPlate','plate')||'').toUpperCase(),
    car: val('appointmentCar','car'),
    service: val('appointmentService','service'),
    locality: val('appointmentLocality','locality'),
    status: val('appointmentStatus','status') || 'NE',
    notes: val('appointmentNotes','subline','notes'),
    extra: val('appointmentExtra'),
    sortIndex: 1
  };
  if(!a.plate || !a.car || !a.service || !a.locality){
    showToast('Preenche Matrícula, Carro, Serviço e Localidade.','error'); return;
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
  if(confirm('Eliminar este agendamento?')){
    try{
      await window.apiClient.deleteAppointment(id);
      appointments=appointments.filter(a=>a.id!==id);
      await save(); renderAll(); showToast('Agendamento eliminado.','success');
      if(editingId===id) closeAppointmentModal();
    }catch(e){ showToast('Erro ao eliminar: '+e.message,'error'); }
  }
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
      <div class="stat-card"><div class="stat-number">${s.total}</div><div class="stat-label">Total</div></div>
      <div class="stat-card"><div class="stat-number">${s.scheduled}</div><div class="stat-label">Agendados</div></div>
      <div class="stat-card"><div class="stat-number">${s.unscheduled}</div><div class="stat-label">Por Agendar</div></div>
    </div>
    <h4>Por Status</h4>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-number">${s.byStatus.NE}</div><div class="stat-label">N/E</div></div>
      <div class="stat-card"><div class="stat-number">${s.byStatus.VE}</div><div class="stat-label">V/E</div></div>
      <div class="stat-card"><div class="stat-number">${s.byStatus.ST}</div><div class="stat-label">ST</div></div>
    </div>`;
  modal.classList.add('show');
}

// ---------- Export / Import ----------
function exportToJson(){
  const data = { version: '3.0', exported: new Date().toISOString(), appointments };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `agendamentos_${new Date().toISOString().split('T')[0]}.json`; a.click();
  URL.revokeObjectURL(url); showToast('Backup JSON exportado!','success');
}
function exportToCsv(){
  const headers = ['Data','Período','Matrícula','Carro','Serviço','Localidade','Status','Observações'];
  const rows = appointments.map(a => [
    a.date || '', a.period || '', a.plate || '', a.car || '',
    a.service || '', a.locality || '', a.status || '', a.notes || ''
  ]);
  const csv = [headers, ...rows].map(r => r.map(f => `"${String(f).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `agendamentos_${new Date().toISOString().split('T')[0]}.csv`; a.click();
  URL.revokeObjectURL(url); showToast('CSV exportado!','success');
}
function importFromJson(file){
  const reader = new FileReader();
  reader.onload = function(e){
    try{
      const data = JSON.parse(e.target.result);
      if (data.appointments && Array.isArray(data.appointments)){
        if (confirm(`Importar ${data.appointments.length} agendamentos?`)){
          appointments = data.appointments.map(a => ({ sortIndex:1, ...a }));
          save(); renderAll(); showToast('Dados importados!','success');
          closeBackupModal();
        }
      } else showToast('Formato inválido.','error');
    }catch(err){ showToast('Erro ao ler ficheiro: ' + err.message,'error'); }
  };
  reader.readAsText(file);
}

// ---------- Impressão ----------
function printPage(){ try{ window.print(); }catch{} }

// ---------- Modais & Navegação ----------
function closeBackupModal(){ document.getElementById('backupModal')?.classList.remove('show'); }
function closeStatsModal(){ document.getElementById('statsModal')?.classList.remove('show'); }
function prevWeek(){ currentMonday=addDays(currentMonday,-7); renderAll(); }
function nextWeek(){ currentMonday=addDays(currentMonday,7); renderAll(); }
function todayWeek(){ currentMonday=getMonday(new Date()); renderAll(); }
function prevDay(){ currentMobileDay=addDays(currentMobileDay,-1); renderMobileDay(); }
function nextDay(){ currentMobileDay=addDays(currentMobileDay,1); renderMobileDay(); }
function todayDay(){ currentMobileDay=new Date(); renderMobileDay(); }

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async ()=>{
  // logger de erros
  window.addEventListener('error', e => showToast('Erro: ' + (e?.message||'desconhecido'), 'error'));
  window.addEventListener('unhandledrejection', e => showToast('Erro: ' + (e?.reason?.message || e?.reason || 'desconhecido'), 'error'));

  await load();
  renderAll();

  // Navegação topo (IDs antigos e novos)
  gid('prevWeek')?.addEventListener('click', prevWeek);
  gid('nextWeek')?.addEventListener('click', nextWeek);
  gid('todayWeek','todayBtn')?.addEventListener('click', todayWeek);

  gid('prevDay')?.addEventListener('click', prevDay);
  gid('nextDay')?.addEventListener('click', nextDay);
  gid('todayDay')?.addEventListener('click', todayDay);

  gid('printPage')?.addEventListener('click', printPage);

  // Pesquisa / filtros
  gid('searchInput')?.addEventListener('input', e=>{ searchQuery=e.target.value; renderAll(); });
  gid('clearSearch')?.addEventListener('click', ()=>{ searchQuery=''; const i=gid('searchInput'); if(i) i.value=''; renderAll(); });
  gid('filterStatus','mobileFilterStatus','mobileFilter','mobileFilterStatus')?.addEventListener('change', e=>{ statusFilter=e.target.value; renderAll(); });

  // Botões de novo serviço (desktop + mobile + fixo)
  gid('addServiceBtn','addServiceBtnFixed')?.addEventListener('click', ()=>openAppointmentModal());
  gid('addServiceMobile')?.addEventListener('click', ()=>openAppointmentModal());
  document.addEventListener('click', (e)=>{ if(e.target.closest('#addServiceBtn, #addServiceBtnFixed, #addServiceMobile')) openAppointmentModal(); });

  // Modal form
  gid('closeModal')?.addEventListener('click', closeAppointmentModal);
  gid('cancelForm')?.addEventListener('click', closeAppointmentModal);
  gid('appointmentForm')?.addEventListener('submit', e=>{ e.preventDefault(); saveAppointment(); });
  gid('appointmentPlate','plate')?.addEventListener('input', e=> formatPlate(e.target));

  // Export/Import
  gid('exportJson')?.addEventListener('click', exportToJson);
  gid('exportCsv','exportServices')?.addEventListener('click', exportToCsv);
  gid('importBtn')?.addEventListener('click', ()=> gid('importFile')?.click());
  gid('importFile')?.addEventListener('change', e=>{ const f=e.target.files[0]; if(f) importFromJson(f); });

  // Fechar modais ao clicar fora
  document.addEventListener('click', e=>{ if(e.target.classList?.contains('modal')) e.target.classList.remove('show'); });

  // Atalhos
  document.addEventListener('keydown', e=>{
    if(e.ctrlKey||e.metaKey){
      if(e.key==='f'){ e.preventDefault(); gid('toggleSearch','searchBtn')?.click?.(); }
      if(e.key==='s'){ e.preventDefault(); save(); }
      if(e.key==='n'){ e.preventDefault(); openAppointmentModal(); }
    }
    if(e.key==='Escape'){ document.querySelectorAll('.modal.show').forEach(m=>m.classList.remove('show')); }
  });
});

// ---------- Connection status ----------
function updateConnectionStatus(){
  const el=document.getElementById('connectionStatus');
  const st=window.apiClient.getConnectionStatus();
  if(!el) return;
  if(st.online){ el.classList.remove('offline'); el.title=`Conectado à API: ${st.apiUrl||''}`; }
  else{ el.classList.add('offline'); el.title='Modo offline - dados locais'; }
}
setInterval(updateConnectionStatus,5000);
window.addEventListener('online',updateConnectionStatus);
window.addEventListener('offline',updateConnectionStatus);

// ---------- Render root ----------
function renderAll(){ renderDesktop(); renderMobileDay(); }

// ---------- Globais (para botões inline) ----------
window.editAppointment=editAppointment;
window.deleteAppointment=deleteAppointment;
window.closeBackupModal=closeBackupModal;
window.closeStatsModal=closeStatsModal;
window.openAppointmentModal=openAppointmentModal;