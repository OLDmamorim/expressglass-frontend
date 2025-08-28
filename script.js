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
  if(!dateStr) return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)){ const [d,m,y]=dateStr.split('/'); return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  try{ const d=new Date(dateStr); if(!isNaN(d.getTime())) return localISO(d); }catch{}
  return null;
}
function formatDateForInput(s){ if(!s) return ''; if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ const [y,m,d]=s.split('-'); return `${d}/${m}/${y}`; } return s; }
function localISO(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function fmtHeader(date){ return {day: date.toLocaleDateString('pt-PT',{weekday:'long'}), dm: date.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'})}; }
const cap = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : s;

// … (mantém-se todo o resto: gradientes, toasts, API, filtros, drag & drop, renderSchedule, renderMobileDay, CRUD, etc.)

// ---------- Print ----------
function printPage(){
  updatePrintTodayTable();
  updatePrintTomorrowTable();
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));
}

// === HOJE ===
function updatePrintTodayTable(){
  const t = new Date(); // hoje
  const str = localISO(t);

  const order = { Manhã: 1, Tarde: 2 };
  const list = appointments
    .filter(a => a.date === str)
    .sort((a,b) => (order[a.period]||3) - (order[b.period]||3));

  const title = document.getElementById('printTodayTitle');
  const dateEl = document.getElementById('printTodayDate');
  const tbody = document.getElementById('printTodayTableBody');
  const empty = document.getElementById('printTodayEmpty');
  const table = document.querySelector('.print-today-table');

  if (title) title.textContent = 'SERVIÇOS DE HOJE';
  if (dateEl) dateEl.textContent = cap(t.toLocaleDateString('pt-PT',{weekday:'long',year:'numeric',month:'long',day:'numeric'}));

  if (!tbody || !table || !empty) return;

  if (list.length === 0){
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  table.style.display = 'table';
  empty.style.display = 'none';
  tbody.innerHTML = list.map(a => `
    <tr>
      <td>${a.period || ''}</td>
      <td>${a.plate  || ''}</td>
      <td>${a.car    || ''}</td>
      <td><span class="service-badge badge-${a.service}">${a.service || ''}</span></td>
      <td>${a.locality || ''}</td>
      <td><span class="status-chip chip-${a.status}">${a.status || ''}</span></td>
      <td>${a.notes || ''}</td>
      <td>${a.extra || ''}</td>
    </tr>`).join('');
}

// === AMANHÃ ===
function updatePrintTomorrowTable(){
  const t = new Date(); t.setDate(t.getDate()+1);
  const str = localISO(t);

  const order = { Manhã: 1, Tarde: 2 };
  const list = appointments
    .filter(a => a.date === str)
    .sort((a,b) => (order[a.period]||3) - (order[b.period]||3));

  const title = document.getElementById('printTomorrowTitle');
  const dateEl = document.getElementById('printTomorrowDate');
  const tbody  = document.getElementById('printTomorrowTableBody');
  const empty  = document.getElementById('printTomorrowEmpty');
  const table  = document.querySelector('.print-tomorrow-table');

  if (title) title.textContent = 'SERVIÇOS DE AMANHÃ';
  if (dateEl) dateEl.textContent = cap(t.toLocaleDateString('pt-PT',{weekday:'long',year:'numeric',month:'long',day:'numeric'}));

  if (!tbody || !table || !empty) return;

  if (list.length === 0){
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  table.style.display = 'table';
  empty.style.display = 'none';
  tbody.innerHTML = list.map(a => `
    <tr>
      <td>${a.period || ''}</td>
      <td>${a.plate  || ''}</td>
      <td>${a.car    || ''}</td>
      <td><span class="service-badge badge-${a.service}">${a.service || ''}</span></td>
      <td>${a.locality || ''}</td>
      <td><span class="status-chip chip-${a.status}">${a.status || ''}</span></td>
      <td>${a.notes || ''}</td>
      <td>${a.extra || ''}</td>
    </tr>`).join('');
}
