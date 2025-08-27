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
function parseDate(dateStr){
  if(!dateStr) return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)){ const [d,m,y]=dateStr.split('/'); return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  try{ const d=new Date(dateStr); if(!isNaN(d.getTime())) return localISO(d); }catch{}
  return '';
}
function formatDateForInput(s){ if(!s) return ''; if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ const [y,m,d]=s.split('-'); return `${d}/${m}/${y}`; } return s; }
function localISO(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function fmtHeader(date){ return {day: date.toLocaleDateString('pt-PT',{weekday:'long'}), dm: date.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'})}; }
const cap = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : s;
function hex2rgba(h,a){ const r=parseInt(h.slice(1,3),16), g=parseInt(h.slice(3,5),16), b=parseInt(h.slice(5,7),16); return `rgba(${r},${g},${b},${a})`; }
function bucketOf(a){ if(!a.date || !a.period) return 'unscheduled'; return `${a.date}|${a.period}`; }
function normalizeBucketOrder(bucket){ appointments.filter(a=>bucketOf(a)===bucket).forEach((x,i)=>x.sortIndex=i+1); }

// ------ Helpers de cor p/ gradiente ------
const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
const toHex = n => n.toString(16).padStart(2,'0');
const rgbToHex = ({r,g,b}) => '#'+toHex(clamp(r))+toHex(clamp(g))+toHex(clamp(b));
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
const lighten = (rgb,a)=>({ r:rgb.r+(255-rgb.r)*a, g:rgb.g+(255-rgb.g)*a, b:rgb.b+(255-rgb.b)*a });
const darken  = (rgb,a)=>({ r:rgb.r*(1-a),       g:rgb.g*(1-a),       b:rgb.b*(1-a)       });
function gradFromBase(hex){
  const rgb = parseColor(hex) || parseColor('#1e88e5');
  return { c1: rgbToHex(lighten(rgb,0.06)), c2: rgbToHex(darken(rgb,0.18)) };
}

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

// ---------- API ----------
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

// ---------- Filtros ----------
function filterAppointments(list){
  let f=[...list];
  if(searchQuery){
    const q=searchQuery.toLowerCase();
    f=f.filter(a=>
      a.plate.toLowerCase().includes(q) ||
      a.car.toLowerCase().includes(q) ||
      a.locality.toLowerCase().includes(q) ||
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

// ---------- Persistência de STATUS ----------
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

// ---------- Drag & Drop / renderizações (omitido para foco no botão) ----------
// … (todo o teu código de render mantém-se inalterado) …

// ---------- Print ----------
function printPage(){ updatePrintUnscheduledTable(); updatePrintTomorrowTable(); window.print(); }
/* ... resto das funções de impressão ... */

// ---------- Colocar “+ Novo Serviço” no topo (barra azul) ----------
function placeAddNewButtonInHeader(){
  const btn = document.getElementById('addServiceBtn');
  if(!btn) return;
  const header = document.querySelector('.header-actions') || (()=> {
    const ph = document.querySelector('.page-header');
    if(!ph) return null;
    const c = document.createElement('div'); c.className='header-actions'; ph.appendChild(c); return c;
  })();
  if(!header) return;
  btn.classList.add('header-btn','primary');
  btn.textContent = '+ Novo Serviço';
  header.prepend(btn); // coloca o botão no topo
}

// ---------- Modais & navegação ----------
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
  await load();
  initializeLocalityDropdown();

  // >>>> mover o botão para o header e ligar o clique
  placeAddNewButtonInHeader();

  // cabeçalho da tabela com “Ações” (mantém-se)
  ensureServicesHeader();

  renderAll();
  updateConnectionStatus();

  // Navegação / pesquisa / filtros
  document.getElementById('prevWeek')?.addEventListener('click', prevWeek);
  document.getElementById('nextWeek')?.addEventListener('click', nextWeek);
  document.getElementById('todayWeek')?.addEventListener('click', todayWeek);
  document.getElementById('prevDay')?.addEventListener('click', prevDay);
  document.getElementById('nextDay')?.addEventListener('click', nextDay);
  document.getElementById('todayDay')?.addEventListener('click', todayDay);
  document.getElementById('printPage')?.addEventListener('click', printPage);

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

  // >>>> clique do botão (desktop + mobile)
  document.getElementById('addServiceBtn')?.addEventListener('click', ()=>openAppointmentModal());
  document.getElementById('addServiceMobile')?.addEventListener('click', ()=>openAppointmentModal());

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

  // Fechar modais ao clicar fora + atalhos
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
    div.innerHTML=`<span class="locality-dot" style="background-color:${color}"></span><span>${loc}</span>`;
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
  if(st.online){ el.classList.remove('offline'); ic.textContent='🌐'; tx.textContent='Online'; el.title=`Conectado à API: ${st.apiUrl}`; }
  else{ el.classList.add('offline'); ic.textContent='📱'; tx.textContent='Offline'; el.title='Modo offline - usando dados locais'; }
}
setInterval(updateConnectionStatus,5000);
window.addEventListener('online',updateConnectionStatus);
window.addEventListener('offline',updateConnectionStatus);