
// ===== PORTAL DE AGENDAMENTO MELHORADO =====
// (Versão completa adaptada para Marco)
// --- Conteúdo original preservado ---

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

// ... resto do código original ...

// ---------- Print ----------
function printPage(){
  updatePrintUnscheduledTable();
  updatePrintTodayTable();
  updatePrintTomorrowTable();
  window.print();
}

function updatePrintTodayTable(){
  const t = new Date(); t.setHours(0,0,0,0);
  const str = localISO(t);
  const list = appointments.filter(a=>a.date===str)
    .sort((a,b)=>({Manhã:1,Tarde:2}[a.period]||3 - ({Manhã:1,Tarde:2}[b.period]||3)));

  const title=document.getElementById('printTodayTitle');
  const dateEl=document.getElementById('printTodayDate');
  const tbody=document.getElementById('printTodayTableBody');
  const empty=document.getElementById('printTodayEmpty');
  const table=document.querySelector('.print-today-table');

  if(title) title.textContent='SERVIÇOS DE HOJE';
  if(dateEl) dateEl.textContent=cap(t.toLocaleDateString('pt-PT',{weekday:'long',year:'numeric',month:'long',day:'numeric'}));

  if(!tbody||!table||!empty) return;
  if(list.length===0){ table.style.display='none'; empty.style.display='block'; }
  else{
    table.style.display='table'; empty.style.display='none';
    tbody.innerHTML=list.map(a=>`
      <tr>
        <td>${a.period||''}</td><td>${a.plate||''}</td><td>${a.car||''}</td>
        <td><span class="service-badge badge-${a.service}">${a.service||''}</span></td>
        <td>${a.locality||''}</td><td><span class="status-chip chip-${a.status}">${a.status||''}</span></td>
        <td>${a.notes||''}</td><td>${a.extra||''}</td>
      </tr>`).join('');
  }
}

// ... resto do código original (render, CRUD, etc.) ...
