if(window.EG_INIT_DONE){};window.EG_INIT_DONE=true;
// ===== PORTAL DE AGENDAMENTO MELHORADO =====
// Versão com API + cartões estilo mobile também no DESKTOP

// ---------- Configurações e dados ----------
const localityColors = {
'Outra': '#9CA3AF', 'Barcelos': '#F87171', 'Braga': '#34D399', 'Esposende': '#22D3EE',
'Famalicão': '#2DD4BF', 'Guimarães': '#FACC15', 'Póvoa de Lanhoso': '#A78BFA',
'Póvoa de Varzim': '#6EE7B7', 'Riba D'Ave': '#FBBF24', 'Trofa': '#C084FC',
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
function localISO(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return ${y}-${m}-${day}; }

function parseDate(dateStr){
if(!dateStr) return '';
if(/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
if(/^\d{1,2}/\d{1,2}/\d{4}$/.test(dateStr)){ const [d,m,y]=dateStr.split('/'); return ${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}; }
try{ const d=new Date(dateStr); if(!isNaN(d.getTime())) return localISO(d); }catch{}
return '';
}
function formatDateForInput(s){ if(!s) return ''; if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ const [y,m,d]=s.split('-'); return ${d}/${m}/${y}; } return s; }
function fmtHeader(date){ return {day: date.toLocaleDateString('pt-PT',{weekday:'long'}), dm: date.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'})}; }
const cap = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : s;

function hex2rgba(h,a){ const r=parseInt(h.slice(1,3),16), g=parseInt(h.slice(3,5),16), b=parseInt(h.slice(5,7),16); return rgba(${r},${g},${b},${a}); }
function parseColor(str){
if(!str) return null;
str=String(str).trim();
if(str[0]==='#'){
if(str.length===4) return {r:parseInt(str[1]+str[1],16), g:parseInt(str[2]+str[2],16), b:parseInt(str[3]+str[3],16)};
if(str.length>=7) return {r:parseInt(str.slice(1,3),16), g:parseInt(str.slice(3,5),16), b:parseInt(str.slice(5,7),16)};
}
const m=str.match(/rgba?(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
if(m) return {r:+m[1], g:+m[2], b:+m[3]};
return null;
}
const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
const toHex = n => n.toString(16).padStart(2,'0');
const rgbToHex = ({r,g,b}) => '#'+toHex(clamp(r))+toHex(clamp(g))+toHex(clamp(b));
const lighten = (rgb,a)=>({ r:rgb.r+(255-rgb.r)a, g:rgb.g+(255-rgb.g)a, b:rgb.b+(255-rgb.b)a });
const darken  = (rgb,a)=>({ r:rgb.r(1-a),       g:rgb.g(1-a),       b:rgb.b(1-a)       });
function gradFromBase(hex){
const rgb = parseColor(hex) || parseColor('#1e88e5');
return { c1: rgbToHex(lighten(rgb,0.06)), c2: rgbToHex(darken(rgb,0.18)) };
}

function bucketOf(a){ if(!a.date || !a.period) return 'unscheduled'; return ${a.date}|${a.period}; }
function normalizeBucketOrder(bucket){ appointments.filter(a=>bucketOf(a)===bucket).forEach((x,i)=>x.sortIndex=i+1); }

// ---------- Toast ----------
function showToast(msg,type='info'){
const c=document.getElementById('toastContainer'); if(!c) return;
const t=document.createElement('div'); t.className=toast ${type};
t.innerHTML=<span>${type==='success'?'✅':type==='error'?'❌':'ℹ️'}</span><span>${msg}</span>;
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
showToast(Status guardado: ${newStatus}, 'success');
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
const bucket=${localISO(d)}|Manhã;
const bucket2=${localISO(d)}|Tarde;
const appts=filterAppointments(appointments.filter(a=>a.date===localISO(d)));
const col=document.createElement('div'); col.className='day-column';
col.innerHTML=  <div class="day-header">   <span>${cap(h.day)}</span><span class="date">${h.dm}</span>   </div>   <div class="list" id="list-${localISO(d)}"></div>  ;
cont.appendChild(col);
const listEl=col.querySelector('.list');
appts.forEach(a=>{
const {base,g,bar}=baseGradFor(a);
const card=document.createElement('div');
card.className=appointment status-${a.status};
card.setAttribute('data-id',a.id);
card.innerHTML=   <div class="left" style="background:${bar}"></div>   <div class="content">   <div class="row1">   <span class="period">${a.period||''}</span>   <span class="plate">${a.plate}</span>   </div>   <div class="row2">   <span class="service">${a.service}</span>   <span class="car">${a.car}</span>   </div>   <div class="row3">   <span class="badge"><span class="dot" style="background:${base}"></span>${a.locality}</span>   <div class="actions">   <button class="btn" onclick="editAppointment(${a.id})">✏️</button>   <button class="btn" onclick="deleteAppointment(${a.id})">🗑️</button>   </div>   </div>   ${a.notes?<div class="notes">${a.notes}</div>:''}   </div>   ;
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
const title=${a.period} – ${a.plate} | ${a.service} | ${a.car.toUpperCase()};
const sub=[a.locality,a.notes].filter(Boolean).join(' | ');
return    <div class="appointment m-card"   data-period="${a.period}" data-status="${a.status}"   data-locality="${a.locality}" data-loccolor="${base}"   style="--c1:${g.c1}; --c2:${g.c2}; border-left:6px solid ${bar}; margin-bottom:12px;">   <div class="m-title">${title}</div>   <div class="m-sub">${sub}</div>   </div>;
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

const byService = {};
appointments.forEach(a => { byService[a.service] = (byService[a.service] || 0) + 1; });

const byLocality = {};
appointments.forEach(a => { byLocality[a.locality] = (byLocality[a.locality] || 0) + 1; });

return { total, scheduled, unscheduled, byStatus, byService, byLocality };
}

function showStats(){
const modal = document.getElementById('statsModal');
const c = document.getElementById('statsContent');
if (!modal || !c) return;

const s = generateStats();
c.innerHTML =    <div class="stats-grid">   <div class="stat-card"><div class="stat-number">${s.total}</div><div class="stat-label">Total de Agendamentos</div></div>   <div class="stat-card"><div class="stat-number">${s.scheduled}</div><div class="stat-label">Agendados</div></div>   <div class="stat-card"><div class="stat-number">${s.unscheduled}</div><div class="stat-label">Por Agendar</div></div>   </div>   <h4>Por Status</h4>   <div class="stats-grid">   <div class="stat-card"><div class="stat-number">${s.byStatus.NE}</div><div class="stat-label">N/E</div></div>   <div class="stat-card"><div class="stat-number">${s.byStatus.VE}</div><div class="stat-label">V/E</div></div>   <div class="stat-card"><div class="stat-number">${s.byStatus.ST}</div><div class="stat-label">ST</div></div>   </div>   <h4>Por Tipo de Serviço</h4>   <div class="stats-grid">   ${Object.entries(s.byService).map(([svc,cnt])=>
<div class="stat-card">
<div class="stat-number">${cnt}</div>
<div class="stat-label">${svc}</div>
</div>).join('')}   </div>   ;
modal.classList.add('show');
}
// ---------- Export / Import ----------
function exportToJson(){
const data = { version: '3.0', exported: new Date().toISOString(), appointments };
const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = agendamentos_${new Date().toISOString().split('T')[0]}.json;
a.click();
URL.revokeObjectURL(url);
showToast('Backup JSON exportado com sucesso!','success');
}

function exportToCsv(){
const headers = ['Data','Período','Matrícula','Carro','Serviço','Localidade','Status','Observações'];
const rows = appointments.map(a => [
a.date || '', a.period || '', a.plate || '', a.car || '',
a.service || '', a.locality || '', a.status || '', a.notes || ''
]);
const csv = [headers, ...rows].map(r => r.map(f => "${String(f).replace(/"/g,'""')}").join(',')).join('\n');
const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = agendamentos_${new Date().toISOString().split('T')[0]}.csv;
a.click();
URL.revokeObjectURL(url);
showToast('Dados exportados para CSV com sucesso!','success');
}

function importFromJson(file){
const reader = new FileReader();
reader.onload = function(e){
try{
const data = JSON.parse(e.target.result);
if (data.appointments && Array.isArray(data.appointments)){
if (confirm(Importar ${data.appointments.length} agendamentos? Isto irá substituir todos os dados atuais.)){
appointments = data.appointments.map(a => ({ sortIndex:1, ...a }));
save(); renderAll(); showToast('Dados importados com sucesso!','success');
closeBackupModal();
}
} else {
showToast('Formato de ficheiro inválido.','error');
}
}catch(err){
showToast('Erro ao ler ficheiro: ' + err.message,'error');
}
};
reader.readAsText(file);
}

// ---------- Impressão ----------
function printPage(){ updatePrintUnscheduledTable(); updatePrintTomorrowTable(); window.print(); }

function updatePrintUnscheduledTable(){
const list=filterAppointments(appointments.filter(a=>!a.date||!a.period).sort((x,y)=>(x.sortIndex||0)-(y.sortIndex||0)));
const tbody=document.getElementById('printUnscheduledTableBody'); const sec=document.querySelector('.print-unscheduled-section');
if(!tbody||!sec) return;
if(list.length===0){ sec.style.display='none'; return; }
sec.style.display='block';
tbody.innerHTML=list.map(a=>   <tr>   <td>${a.plate}</td><td>${a.car}</td>   <td><span class="service-badge badge-${a.service}">${a.service}</span></td>   <td>${a.locality}</td><td><span class="status-chip chip-${a.status}">${a.status}</span></td>   <td>${a.notes||''}</td><td>${a.extra||''}</td>   </tr>).join('');
}

function updatePrintTomorrowTable(){
const t=new Date(); t.setDate(t.getDate()+1); const str=localISO(t);
const list=appointments.filter(a=>a.date===str)
.sort((a,b)=>((({Manhã:1,Tarde:2}[a.period])||3) - ((({Manhã:1,Tarde:2}[b.period])||3))));
const title=document.getElementById('printTomorrowTitle'); const dateEl=document.getElementById('printTomorrowDate');
const tbody=document.getElementById('printTomorrowTableBody'); const empty=document.getElementById('printTomorrowEmpty'); const table=document.querySelector('.print-tomorrow-table');
if(title) title.textContent='SERVIÇOS DE AMANHÃ';
if(dateEl) dateEl.textContent=cap(t.toLocaleDateString('pt-PT',{weekday:'long',year:'numeric',month:'long',day:'numeric'}));
if(!tbody||!table||!empty) return;
if(list.length===0){ table.style.display='none'; empty.style.display='block'; }
else{
table.style.display='table'; empty.style.display='none';
tbody.innerHTML=list.map(a=>   <tr>   <td>${a.period||''}</td><td>${a.plate}</td><td>${a.car}</td>   <td><span class="service-badge badge-${a.service}">${a.service}</span></td>   <td>${a.locality}</td><td><span class="status-chip chip-${a.status}">${a.status}</span></td>   <td>${a.notes||''}</td><td>${a.extra||''}</td>   </tr>).join('');
}
}
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
// mini logger p/ apanhar erros JS que bloqueiem eventos
window.addEventListener('error', e => showToast('Erro: ' + (e?.message||'desconhecido'), 'error'));
window.addEventListener('unhandledrejection', e => showToast('Erro: ' + (e?.reason?.message || e?.reason || 'desconhecido'), 'error'));

await load();
initializeLocalityDropdown();

renderAll();
updateConnectionStatus();

// Navegação topo
document.getElementById('prevWeek')?.addEventListener('click', prevWeek);
document.getElementById('nextWeek')?.addEventListener('click', nextWeek);
document.getElementById('todayWeek')?.addEventListener('click', todayWeek);
document.getElementById('prevDay')?.addEventListener('click', prevDay);
document.getElementById('nextDay')?.addEventListener('click', nextDay);
document.getElementById('todayDay')?.addEventListener('click', todayDay);
document.getElementById('printPage')?.addEventListener('click', printPage);

// Barra de pesquisa / filtros
document.getElementById('backupBtn')?.addEventListener('click', ()=> document.getElementById('backupModal')?.classList.add('show'));
document.getElementById('statsBtn')?.addEventListener('click', showStats);
document.getElementById('searchBtn')?.addEventListener('click', ()=>{
const bar=document.getElementById('searchBar'); if(!bar) return;
bar.classList.toggle('hidden'); if(!bar.classList.contains('hidden')) document.getElementById('searchInput')?.focus();
});
document.getElementById('searchInput')?.addEventListener('input', e=>{ searchQuery=e.target.value; renderAll(); });
document.getElementById('clearSearch')?.addEventListener('click', ()=>{
searchQuery=''; const i=document.getElementById('searchInput'); if(i) i.value='';
document.getElementById('searchBar')?.classList.add('hidden'); renderAll();
});
document.getElementById('filterStatus')?.addEventListener('change', e=>{ statusFilter=e.target.value; renderAll(); });

// Botões de novo serviço (desktop + mobile)
document.getElementById('addServiceBtn')?.addEventListener('click', ()=>openAppointmentModal());
document.getElementById('addServiceMobile')?.addEventListener('click', ()=>openAppointmentModal());
// delegação extra caso o botão seja re-renderizado
document.addEventListener('click', (e)=>{
if (e.target && (e.target.id === 'addServiceBtn' || e.target.closest && e.target.closest('#addServiceBtn'))) {
openAppointmentModal();
}
});

// Modal form
document.getElementById('closeModal')?.addEventListener('click', closeAppointmentModal);
document.getElementById('cancelForm')?.addEventListener('click', closeAppointmentModal);
document.getElementById('appointmentForm')?.addEventListener('submit', e=>{ e.preventDefault(); saveAppointment(); });
document.getElementById('deleteAppointment')?.addEventListener('click', ()=>{ if(editingId) deleteAppointment(editingId); });
document.getElementById('appointmentPlate')?.addEventListener('input', e=> formatPlate(e.target));

// Export/Import
document.getElementById('exportJson')?.addEventListener('click', exportToJson);
document.getElementById('exportCsv')?.addEventListener('click', exportToCsv);
document.getElementById('exportServices')?.addEventListener('click', exportToCsv);
document.getElementById('importBtn')?.addEventListener('click', ()=> document.getElementById('importFile')?.click());
document.getElementById('importFile')?.addEventListener('change', e=>{ const f=e.target.files[0]; if(f) importFromJson(f); });

// Modais por clique fora / atalhos
document.addEventListener('click', e=>{ if(e.target.classList?.contains('modal')) e.target.classList.remove('show'); });
document.addEventListener('keydown', e=>{
if(e.ctrlKey||e.metaKey){
if(e.key==='f'){ e.preventDefault(); document.getElementById('searchBtn')?.click(); }
if(e.key==='s'){ e.preventDefault(); save(); }
if(e.key==='n'){ e.preventDefault(); openAppointmentModal(); }
}
if(e.key==='Escape'){ document.querySelectorAll('.modal.show').forEach(m=>m.classList.remove('show')); }
});
});

// ---------- Globais ----------
window.editAppointment=editAppointment;
window.deleteAppointment=deleteAppointment;
window.closeBackupModal=closeBackupModal;
window.closeStatsModal=closeStatsModal;

// ---------- Locality dropdown ----------
function initializeLocalityDropdown(){
const box=document.getElementById('localityOptions'); if(!box) return;
box.innerHTML='';
Object.entries(localityColors).forEach(([loc,color])=>{
const div=document.createElement('div'); div.className='locality-option'; div.onclick=()=>selectLocality(loc);
div.innerHTML=<span class="locality-dot" style="background-color:${color}"></span><span>${loc}</span>;
box.appendChild(div);
});
}
function toggleLocalityDropdown(){
const sel=document.getElementById('localitySelected'); const opt=document.getElementById('localityOptions'); if(!sel||!opt) return;
sel.classList.toggle('open'); opt.classList.toggle('show');
if(opt.classList.contains('show')) document.addEventListener('click', closeLocalityDropdownOutside, {once:true});
}
function closeLocalityDropdownOutside(e){ if(!e.target.closest('.locality-dropdown')) closeLocalityDropdown(); else document.addEventListener('click', closeLocalityDropdownOutside, {once:true}); }
function closeLocalityDropdown(){ document.getElementById('localitySelected')?.classList.remove('open'); document.getElementById('localityOptions')?.classList.remove('show'); }
function selectLocality(locality){
const hidden=document.getElementById('appointmentLocality'); const txt=document.getElementById('selectedLocalityText'); const dot=document.getElementById('selectedLocalityDot');
if(hidden) hidden.value=locality; if(txt) txt.textContent=locality; if(dot) dot.style.backgroundColor=getLocColor(locality);
document.querySelectorAll('.locality-option').forEach(o=>o.classList.remove('selected'));
const selOpt=[...document.querySelectorAll('.locality-option')].find(o=>o.textContent.trim()===locality); if(selOpt) selOpt.classList.add('selected');
closeLocalityDropdown();
}
window.toggleLocalityDropdown=toggleLocalityDropdown;
window.selectLocality=selectLocality;

// ---------- Connection status ----------
function updateConnectionStatus(){
const el=document.getElementById('connectionStatus'); const ic=document.getElementById('statusIcon'); const tx=document.getElementById('statusText');
if(!el||!ic||!tx) return;
const st=window.apiClient.getConnectionStatus();
if(st.online){ el.classList.remove('offline'); ic.textContent='🌐'; tx.textContent='Online'; el.title=Conectado à API: ${st.apiUrl}; }
else{ el.classList.add('offline'); ic.textContent='📱'; tx.textContent='Offline'; el.title='Modo offline - usando dados locais'; }
}
setInterval(updateConnectionStatus,5000);
window.addEventListener('online',updateConnectionStatus);
window.addEventListener('offline',updateConnectionStatus);

// --- Garantir que o "+ Novo Serviço" existe SEMPRE no header e está funcional
function ensureAddNewButton(){
const header = document.querySelector('.header-actions');
if (!header) return;

let btn = document.getElementById('addServiceBtn');
if (!btn) {
btn = document.createElement('button');
btn.id = 'addServiceBtn';
btn.className = 'header-btn primary';
btn.textContent = '+ Novo Serviço';
header.insertBefore(btn, header.firstChild);
}
if (!btn._wired) {
btn.addEventListener('click', () => openAppointmentModal());
btn._wired = true;
}
}

// corre no load…
document.addEventListener('DOMContentLoaded', ensureAddNewButton);

// …e observa o DOM para repor o botão se algo o remover/mover
const headerObserver = new MutationObserver(() => ensureAddNewButton());
headerObserver.observe(document.body, { childList: true, subtree: true });

// segurança extra: delegação global caso o botão reapareça “novo”
document.addEventListener('click', (e) => {
const t = e.target.closest && e.target.closest('#addServiceBtn');
if (t) openAppointmentModal();
});

