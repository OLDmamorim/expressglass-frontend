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

// ---------- Variáveis globais ----------
let appointments = [];
let currentWeekStart = startOfWeek(new Date());
let currentMobileDay = new Date();

// ---------- Funções utilitárias ----------
function startOfWeek(d){
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}
function endOfWeek(d){
  const start = startOfWeek(d);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate()+6);
}
function localISO(d){
  const tzOff = d.getTimezoneOffset()*60000;
  const local = new Date(d - tzOff);
  return local.toISOString().split("T")[0];
}
function filterAppointments(list){ return list; }
function gradFromBase(base){
  return {
    c1: base,
    c2: base
  };
}

// ---------- Render SEMANA ----------
function renderSchedule(){
  const table=document.getElementById('schedule');
  if(!table) return;
  table.innerHTML='';
  const start=currentWeekStart;
  const end=endOfWeek(start);
  const header=document.createElement('tr');
  for(let i=0;i<7;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    const th=document.createElement('th');
    th.textContent=d.toLocaleDateString('pt-PT',{weekday:'short',day:'2-digit'});
    header.appendChild(th);
  }
  table.appendChild(header);
  // ... aqui manterias o resto do render semanal
}

// ---------- Render TABELA ----------
function renderServicesTable(){
  const tbody=document.getElementById('servicesTableBody');
  if(!tbody) return;
  tbody.innerHTML='';
  appointments.forEach(a=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${a.date||''}</td>
      <td>${a.period||''}</td>
      <td>${a.plate||''}</td>
      <td>${a.car||''}</td>
      <td>${a.service||''}</td>
      <td>${a.locality||''}</td>
      <td>${a.notes||''}</td>
      <td>${a.status||''}</td>
      <td></td>
      <td class="no-print">—</td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------- Render PENDENTES ----------
function renderUnscheduled(){
  const container=document.getElementById('unscheduledList'); if(!container) return;
  const unscheduled=filterAppointments(
    appointments.filter(a=>!a.date||!a.period)
                 .sort((x,y)=>(x.sortIndex||0)-(y.sortIndex||0))
  );
  const blocks=unscheduled.map(a=>{
    const base=getLocColor(a.locality);
    const g=gradFromBase(base);
    const bar=statusBarColors[a.status]||'#999';
    const title=`${a.plate} | ${a.service} | ${(a.car||'').toUpperCase()}`;
    const sub=[a.locality,a.notes].filter(Boolean).join(' | ');
    return `
      <div class="appointment desk-card unscheduled"
           data-id="${a.id}" draggable="true"
           data-locality="${a.locality||''}" data-loccolor="${base}"
           style="--c1:${g.c1}; --c2:${g.c2}; border-left:6px solid ${bar}">
        <div class="appt-header">${title}</div>
        <div class="appt-sub">${sub}</div>
      </div>`;
  }).join('');
  container.innerHTML=blocks;
}

// ---------- Render DIÁRIO (MOBILE) ----------
function renderMobileDay(){
  const list  = document.getElementById('mobileDayList');
  const label = document.getElementById('mobileDayLabel');
  if (!list || !label) return;

  const d = new Date(currentMobileDay);
  d.setHours(0,0,0,0);

  label.textContent = d.toLocaleDateString('pt-PT', {
    weekday:'long', day:'2-digit', month:'2-digit', year:'numeric'
  });

  const iso = localISO(d);
  const order = { 'Manhã': 1, 'Tarde': 2 };
  const dayItems = filterAppointments(
    appointments
      .filter(a => a.date === iso)
      .sort((a,b) => (order[a.period]||99) - (order[b.period]||99) || (a.sortIndex||0) - (b.sortIndex||0))
  );

  list.innerHTML = dayItems.map(a => {
    const title = `${a.period||''} - ${a.plate||''} | ${a.service||''} | ${(a.car||'').toUpperCase()}`;
    const sub   = [a.locality, a.notes].filter(Boolean).join(' | ');
    const base  = (window.LOCALITY_COLORS && window.LOCALITY_COLORS[a.locality]) || '#1e88e5';
    return `
      <div class="appointment mobile-card"
           data-id="${a.id}"
           data-locality="${a.locality||''}"
           data-loccolor="${base}">
        <div class="appt-header">${title}</div>
        <div class="appt-sub">${sub}</div>
      </div>`;
  }).join('');
}

// ---------- INIT ----------
function renderAll(){
  renderSchedule();
  renderServicesTable();
  renderUnscheduled();
  renderMobileDay();
}

// Simulação inicial
document.addEventListener('DOMContentLoaded', ()=>{
  // Aqui podes puxar dados via API
  appointments=[
    {id:1,date:localISO(new Date()),period:'Manhã',plate:'11-AA-11',car:'BMW',service:'PB',locality:'Braga',notes:'Teste',status:'NE'},
    {id:2,date:localISO(new Date()),period:'Tarde',plate:'22-BB-22',car:'Audi',service:'LT',locality:'Guimarães',notes:'Obs',status:'VE'}
  ];
  renderAll();

  // Liga botões de navegação semanal
  document.getElementById('prevWeek')?.addEventListener('click',()=>{
    currentWeekStart.setDate(currentWeekStart.getDate()-7);
    renderAll();
  });
  document.getElementById('nextWeek')?.addEventListener('click',()=>{
    currentWeekStart.setDate(currentWeekStart.getDate()+7);
    renderAll();
  });
  document.getElementById('todayWeek')?.addEventListener('click',()=>{
    currentWeekStart=startOfWeek(new Date());
    renderAll();
  });

  // Liga botões de navegação diária
  document.getElementById('prevDay')?.addEventListener('click',()=>{
    currentMobileDay.setDate(currentMobileDay.getDate()-1);
    renderMobileDay();
  });
  document.getElementById('nextDay')?.addEventListener('click',()=>{
    currentMobileDay.setDate(currentMobileDay.getDate()+1);
    renderMobileDay();
  });
  document.getElementById('todayDay')?.addEventListener('click',()=>{
    currentMobileDay=new Date();
    renderMobileDay();
  });
});
