// ===== PORTAL DE AGENDAMENTO (DB only) =====

// ---------- Configurações e dados ----------
const localityColors = {
  'Outra': '#9CA3AF', 'Barcelos': '#F87171', 'Braga': '#34D399', 'Esposende': '#22D3EE',
  'Famalicão': '#2DD4BF', 'Guimarães': '#FACC15', 'Póvoa de Lanhoso': '#A78BFA',
  'Póvoa de Varzim': '#6EE7B7', 'Riba D\'Ave': '#FBBF24', 'Trofa': '#C084FC',
  'Vieira do Minho': '#93C5FD', 'Vila do Conde': '#FCD34D', 'Vila Verde': '#86EFAC'
};
window.LOCALITY_COLORS = localityColors;
const getLocColor = (loc) => (localityColors && localityColors[loc]) || '#3b82f6';

const statusBarColors = { NE: '#EF4444', VE: '#F59E0B', ST: '#10B981' };
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
function cap(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }
function hex2rgba(h,a){ const r=parseInt(h.slice(1,3),16), g=parseInt(h.slice(3,5),16), b=parseInt(h.slice(5,7),16); return `rgba(${r},${g},${b},${a})`; }
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

// ---------- API (sempre DB) ----------
async function save(){
  try{
    // A sincronização é responsabilidade do apiClient (já chama a API ao criar/editar/apagar)
    showToast('Dados sincronizados com sucesso!','success');
  }catch(e){
    showToast('Erro na sincronização: '+e.message,'error');
  }
}

async function load(){
  try{
    showToast('A carregar dados…','info');

    if(!window.apiClient || typeof window.apiClient.getAppointments!=='function'){
      throw new Error('apiClient não disponível');
    }

    const res = await window.apiClient.getAppointments();
    appointments = Array.isArray(res) ? res : [];

    // Normalização
    appointments.forEach(a=>{
      if(!a.id) a.id = Date.now()+Math.random();
      if(!a.sortIndex) a.sortIndex = 1;
    });

    // Localidades dinâmicas (se existirem)
    try{
      const locs = await window.apiClient.getLocalities?.();
      if(locs && typeof locs==='object'){
        Object.assign(localityColors, locs);
        window.LOCALITY_COLORS = localityColors;
      }
    }catch{}

    const st = window.apiClient.getConnectionStatus?.() || {online:false};
    showToast(st.online ? 'Dados carregados da cloud!' : 'Sem ligação à API.', st.online ? 'success' : 'error');

  }catch(e){
    appointments = []; // sem fallback
    showToast('Erro ao carregar dados: '+e.message,'error');
    console.error('load() error:', e);
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

// ---------- Drag & Drop ----------
function enableDragDrop(scope){
  (scope||document).querySelectorAll('.appointment[data-id]').forEach(card=>{
    card.draggable=true;
    card.addEventListener('dragstart',e=>{
      e.dataTransfer.setData('text/plain',card.getAttribute('data-id'));
      e.dataTransfer.effectAllowed='move'; card.classList.add('dragging');
    });
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
  });
  (scope||document).querySelectorAll('[data-drop-bucket]').forEach(zone=>{
    zone.addEventListener('dragover',e=>{e.preventDefault(); zone.classList.add('drag-over');});
    zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
    zone.addEventListener('drop',e=>{
      e.preventDefault(); zone.classList.remove('drag-over');
      const id=Number(e.dataTransfer.getData('text/plain'));
      const bucket=zone.getAttribute('data-drop-bucket');
      const idx=zone.querySelectorAll('.appointment').length;
      onDropAppointment(id,bucket,idx);
    });
  });
}
function onDropAppointment(id,targetBucket,targetIndex){
  const i=appointments.findIndex(a=>a.id===id); if(i<0) return;
  const a=appointments[i];
  if(targetBucket==='unscheduled'){ a.date=''; a.period=''; }
  else { const [d,p]=targetBucket.split('|'); a.date=d; a.period=p||a.period||'Manhã'; }
  normalizeBucketOrder(targetBucket);
  const list=appointments.filter(x=>bucketOf(x)===targetBucket).sort((x,y)=>(x.sortIndex||0)-(y.sortIndex||0));
  list.forEach((x,idx)=>x.sortIndex=idx+1);
  if(targetIndex>=list.length) a.sortIndex=list.length+1;
  else { list.splice(targetIndex,0,a); list.forEach((x,idx)=>x.sortIndex=idx+1); }
  save(); renderAll(); showToast('Agendamento movido com sucesso!','success');
}

// ---------- Render: calendário desktop ----------
function renderSchedule(){
  const table=document.getElementById('schedule'); if(!table) return;