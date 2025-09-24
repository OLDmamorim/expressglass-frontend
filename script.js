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

// ---------- Filtros ----------
function filterAppointments(list){ return list.filter(a=>(!searchQuery||matchesSearch(a))&&(!statusFilter||a.status===statusFilter)); }
function matchesSearch(a){ const q=searchQuery.toLowerCase(); return [a.plate,a.car,a.locality,a.notes].some(f=>f&&f.toLowerCase().includes(q)); }

// ---------- Toasts ----------
function showToast(msg,type='info'){ const c=document.getElementById('toastContainer'); if(!c) return; const t=document.createElement('div'); t.className=`toast toast-${type}`; t.textContent=msg; c.appendChild(t); setTimeout(()=>t.classList.add('show'),10); setTimeout(()=>{t.classList.remove('show'); setTimeout(()=>c.removeChild(t),300);},3000); }

// ---------- Drag & Drop ----------
let draggedElement = null;
let dragThrottle = false;

function setupDragAndDrop(scope){
  (scope||document).querySelectorAll('.appointment[data-id]').forEach(card=>{
    card.addEventListener('dragstart', (e)=>{
      draggedElement = card;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', card.outerHTML);
      card.style.opacity = '0.5';
    });
    card.addEventListener('dragend', ()=>{
      if(draggedElement) draggedElement.style.opacity = '';
      draggedElement = null;
    });
  });

  (scope||document).querySelectorAll('.drop-zone').forEach(zone=>{
    zone.addEventListener('dragover', (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    zone.addEventListener('drop', (e)=>{
      e.preventDefault();
      if(!draggedElement || dragThrottle) return;
      dragThrottle = true;
      setTimeout(()=>{ dragThrottle = false; }, 300);

      const appointmentId = draggedElement.dataset.id;
      const bucket = zone.dataset.dropBucket;
      if(appointmentId && bucket) moveAppointment(appointmentId, bucket);
    });
  });
}

async function moveAppointment(id, bucket){
  const appointment = appointments.find(a => a.id === id);
  if(!appointment) return;

  let newDate = null, newPeriod = null;
  if(bucket === 'unscheduled'){
    newDate = null; newPeriod = null;
  } else if(bucket.includes('|')){
    [newDate, newPeriod] = bucket.split('|');
  }

  const oldData = { date: appointment.date, period: appointment.period };
  appointment.date = newDate; appointment.period = newPeriod;

  try{
    await window.apiClient.updateAppointment(id, { date: newDate, period: newPeriod });
    showToast('Agendamento movido com sucesso', 'success');
    renderAll();
  } catch(error){
    appointment.date = oldData.date; appointment.period = oldData.period;
    showToast('Erro ao mover agendamento', 'error');
    console.error('Erro ao mover:', error);
  }
}

// ---------- Render Desktop Cards ----------
function buildDesktopCard(a){
  const title = `${a.plate||''} - ${a.service||''} - ${a.car||''}`.replace(/^-\s*|-\s*$/g,'').trim();
  const sub = a.locality || '';
  const base = getLocColor(a.locality);
  const g = gradFromBase(base);
  const bar = statusBarColors[a.status] || '#ccc';

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
      ${(a.calculatedKilometers || a.kilometers) ? `<div class="appointment-kilometers">
        <span class="km-icon">🚗</span>
        <span class="km-arrow">→</span>
        <span>${a.calculatedKilometers || a.kilometers} km</span>
      </div>` : ''}
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
  setupDragAndDrop(table);
}

function renderUnscheduled(){
  const list=document.getElementById('unscheduledList'); if(!list) return;
  const items=filterAppointments(appointments.filter(a=>!a.date||!a.period));
  if(items.length===0){ list.innerHTML='<div class="no-items">Sem serviços por agendar</div>'; return; }
  list.innerHTML = items.map(buildDesktopCard).join('');
  setupDragAndDrop(list);
}

// ---------- Render Mobile Cards ----------
function buildMobileCard(a){
  const title = `${a.plate||''} - ${a.service||''} - ${a.car||''}`.replace(/^-\s*|-\s*$/g,'').trim();
  const base = getLocColor(a.locality);
  const g = gradFromBase(base);

  const wazeBtn = a.address ? `
    <a href="https://waze.com/ul?q=${encodeURIComponent(a.address)}" target="_blank" class="icon-btn" title="Abrir no Waze">
      🗺️
    </a>` : '';
  const mapsBtn = a.address ? `
    <a href="https://maps.google.com?q=${encodeURIComponent(a.address)}" target="_blank" class="icon-btn" title="Abrir no Google Maps">
      📍
    </a>` : '';

  const chips = [
    a.locality ? `<span class="m-chip">${a.locality}</span>` : '',
    a.period ? `<span class="m-chip">${a.period}</span>` : '',
    a.locality ? `<span class="m-chip">${a.locality}</span>` : ''
  ].join('');
  const notes = a.notes ? `<div class="m-info">${a.notes}</div>` : '';

  return `
    <div class="appointment m-card" data-id="${a.id}"
         style="--c1:${g.c1}; --c2:${g.c2}; position:relative;">
      <div class="map-icons">
        ${wazeBtn}${mapsBtn}
        ${a.phone ? `
    <a href="tel:${a.phone}" class="icon-btn" title="Ligar">
      📞
    </a>` : ''}
      </div>
      <div class="m-title">${title}</div>
      <div class="m-chips">${chips}</div>
      ${notes}
      ${(a.calculatedKilometers || a.kilometers) ? `<div class="m-kilometers">
        <span class="km-icon">🚗</span>
        <span class="km-arrow">→</span>
        <span>${a.calculatedKilometers || a.kilometers} km</span>
      </div>` : ''}
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

  list.innerHTML = items.map(buildMobileCard).join('');
}

// ---------- Modal ----------
function openAppointmentModal(id=null){
  editingId=id; const modal=document.getElementById('appointmentModal'); if(!modal) return;
  const form=document.getElementById('appointmentForm');
  const title=document.getElementById('modalTitle'); const del=document.getElementById('deleteAppointment');
  if(!id){
    if(form) form.reset();
    title.textContent='Novo Agendamento';
    if(form) form.reset();
    document.getElementById('appointmentStatus').value='NE';
    const txt=document.getElementById('selectedLocalityText'); const dot=document.getElementById('selectedLocalityDot');
    if(txt) txt.textContent='Selecione a localidade';
    if(dot) dot.style.backgroundColor='#ccc';
    del.classList.add('hidden');
  } else {
    const a=appointments.find(x=>x.id===id);
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
     // Preencher contacto
const phoneInput = document.getElementById('appointmentPhone');
if (phoneInput) {
  let phone = (a && a.phone) || "";
  if (!phone && a?.extra) {
    const m = String(a.extra).match(/([+()\s\d-]{6,})/);
    if (m) phone = m[1].trim();
  }
  phoneInput.value = phone || "";
}

      del.classList.remove('hidden');
    }
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
    address: document.getElementById('appointmentAddress').value.trim() || null,
    extra: document.getElementById('appointmentExtra').value.trim()||null,
    phone: document.getElementById('appointmentPhone').value.trim() || null
  };
  if(!data.plate){ showToast('Matrícula é obrigatória','error'); return; }
  if(!data.car){ showToast('Modelo do carro é obrigatório','error'); return; }
  if(!data.service){ showToast('Tipo de serviço é obrigatório','error'); return; }
  if(!data.locality){ showToast('Localidade é obrigatória','error'); return; }

  try{
    if(editingId){
      const res=await window.apiClient.updateAppointment(editingId,data);
      if(res.success){ const idx=appointments.findIndex(a=>a.id===editingId); if(idx>=0) appointments[idx]={...appointments[idx],...data}; showToast('Agendamento atualizado','success'); }
      else{ showToast(res.error||'Erro ao atualizar','error'); return; }
    } else {
      const res=await window.apiClient.createAppointment(data);
      if(res.success){ appointments.push({id:res.id,...data}); showToast('Agendamento criado','success'); }
      else{ showToast(res.error||'Erro ao criar','error'); return; }
    }
    closeAppointmentModal(); renderAll();
  } catch(error){ showToast('Erro de conexão','error'); console.error(error); }
}

async function deleteAppointment(){
  if(!editingId||!confirm('Tem certeza que deseja eliminar este agendamento?')) return;
  try{
    const res=await window.apiClient.deleteAppointment(editingId);
    if(res.success){ appointments=appointments.filter(a=>a.id!==editingId); showToast('Agendamento eliminado','success'); closeAppointmentModal(); renderAll(); }
    else{ showToast(res.error||'Erro ao eliminar','error'); }
  } catch(error){ showToast('Erro de conexão','error'); console.error(error); }
}

// ---------- Status checkboxes ----------
function setupStatusCheckboxes(scope){
  (scope||document).querySelectorAll('.appt-status input[type="checkbox"]').forEach(cb=>{
    cb.addEventListener('change', async (e)=>{
      if(!e.target.checked) return;
      const card=e.target.closest('.appointment'); if(!card) return;
      const id=card.dataset.id; const status=e.target.dataset.status;
      if(!id||!status) return;
      const appointment=appointments.find(a=>a.id===id); if(!appointment) return;
      const oldStatus=appointment.status; appointment.status=status;
      card.querySelectorAll('.appt-status input[type="checkbox"]').forEach(other=>{ if(other!==e.target) other.checked=false; });
      try{
        const res=await window.apiClient.updateAppointment(id,{status});
        if(res.success){ showToast('Status atualizado','success'); renderAll(); }
        else{ appointment.status=oldStatus; showToast(res.error||'Erro ao atualizar status','error'); }
      } catch(error){ appointment.status=oldStatus; showToast('Erro de conexão','error'); console.error(error); }
    });
  });
}

// ---------- Render All ----------
function renderAll(){
  renderSchedule(); renderUnscheduled(); renderMobileDay(); renderServicesTable(); setupStatusCheckboxes();
}

// ---------- Tabela de serviços ----------
function renderServicesTable(){
  const tbody=document.getElementById('servicesTableBody'); if(!tbody) return;
  const today=localISO(new Date());
  const items=filterAppointments(appointments.filter(a=>a.date&&a.date>=today)).sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.period||'').localeCompare(b.period||''));
  if(items.length===0){ tbody.innerHTML='<tr><td colspan="10">Sem serviços agendados</td></tr>'; return; }
  tbody.innerHTML=items.map(a=>{
    const daysDiff=a.date?Math.ceil((new Date(a.date)-new Date(today))/(1000*60*60*24)):null;
    const daysText=daysDiff===null?'—':daysDiff===0?'Hoje':daysDiff===1?'Amanhã':`${daysDiff}d`;
    return `<tr data-id="${a.id}">
      <td>${a.date?new Date(a.date).toLocaleDateString('pt-PT'):''}</td>
      <td>${a.period||''}</td>
      <td>${a.plate||''}</td>
      <td>${a.car||''}</td>
      <td>${a.service||''}</td>
      <td>${a.locality||''}</td>
      <td title="${a.notes||''}">${(a.notes||'').substring(0,50)}</td>
      <td><span class="status-badge status-${a.status||'NE'}">${a.status||'NE'}</span></td>
      <td>${daysText}</td>
      <td class="no-print"><button onclick="openAppointmentModal('${a.id}')" class="btn-edit">✏️</button></td>
    </tr>`;
  }).join('');
}

// ---------- Localidades dropdown ----------
function setupLocalityDropdown(){
  const options=document.getElementById('localityOptions'); if(!options) return;
  options.innerHTML=localityList.map(loc=>`<div class="locality-option" data-value="${loc}"><span class="locality-dot" style="background-color:${getLocColor(loc)}"></span>${loc}</div>`).join('');
  options.addEventListener('click', (e)=>{
    const opt=e.target.closest('.locality-option'); if(!opt) return;
    const value=opt.dataset.value; const text=opt.textContent.trim();
    document.getElementById('appointmentLocality').value=value;
    document.getElementById('selectedLocalityText').textContent=text;
    document.getElementById('selectedLocalityDot').style.backgroundColor=getLocColor(value);
    options.style.display='none';
  });
}
function toggleLocalityDropdown(){ const options=document.getElementById('localityOptions'); if(options) options.style.display=options.style.display==='block'?'none':'block'; }

// ---------- Navegação ----------
function navigateWeek(direction){
  currentMonday.setDate(currentMonday.getDate() + direction * 7);
  renderAll();
}
function goToToday(){
  currentMonday = getMonday(new Date());
  renderAll();
}
function navigateMobileDay(direction){
  currentMobileDay.setDate(currentMobileDay.getDate() + direction);
  renderMobileDay();
}
function goToTodayMobile(){
  currentMobileDay = new Date();
  renderMobileDay();
}

// ---------- Pesquisa ----------
function highlightSearchResults(){
  if(!searchQuery) return;
  document.querySelectorAll('.appointment').forEach(card=>{
    const id=card.dataset.id; const appointment=appointments.find(a=>a.id===id);
    if(appointment && matchesSearch(appointment)){ card.classList.add('search-highlight'); }
    else{ card.classList.remove('search-highlight'); }
  });
}

// ---------- Impressão ----------
function preparePrintData(){
  const today=localISO(new Date()); const tomorrow=localISO(addDays(new Date(),1));
  const unscheduled=appointments.filter(a=>!a.date||!a.period);
  const todayItems=appointments.filter(a=>a.date===today);
  const tomorrowItems=appointments.filter(a=>a.date===tomorrow);

  document.getElementById('printUnscheduledBody').innerHTML=unscheduled.map(a=>`<tr><td>${a.plate||''}</td><td>${a.car||''}</td><td>${a.service||''}</td><td>${a.locality||''}</td><td>${a.status||''}</td><td>${a.notes||''}</td></tr>`).join('');
  document.getElementById('printTodayBody').innerHTML=todayItems.map(a=>`<tr><td>${a.period||''}</td><td>${a.plate||''}</td><td>${a.car||''}</td><td>${a.service||''}</td><td>${a.locality||''}</td><td>${a.status||''}</td><td>${a.notes||''}</td><td>${a.extra||''}</td></tr>`).join('');
  document.getElementById('printTomorrowBody').innerHTML=tomorrowItems.map(a=>`<tr><td>${a.period||''}</td><td>${a.plate||''}</td><td>${a.car||''}</td><td>${a.service||''}</td><td>${a.locality||''}</td><td>${a.status||''}</td><td>${a.notes||''}</td><td>${a.extra||''}</td></tr>`).join('');
}

// ---------- Event Listeners ----------
document.addEventListener('DOMContentLoaded', async ()=>{
  // navegação
  document.getElementById('prevWeek')?.addEventListener('click', ()=>navigateWeek(-1));
  document.getElementById('nextWeek')?.addEventListener('click', ()=>navigateWeek(1));
  document.getElementById('todayWeek')?.addEventListener('click', goToToday);
  document.getElementById('prevDay')?.addEventListener('click', ()=>navigateMobileDay(-1));
  document.getElementById('nextDay')?.addEventListener('click', ()=>navigateMobileDay(1));
  document.getElementById('todayDay')?.addEventListener('click', goToTodayMobile);

  // modais
  document.getElementById('addServiceBtn')?.addEventListener('click', ()=>openAppointmentModal());
  document.getElementById('addServiceMobile')?.addEventListener('click', ()=>openAppointmentModal());
  document.getElementById('closeModal')?.addEventListener('click', closeAppointmentModal);
  document.getElementById('cancelForm')?.addEventListener('click', closeAppointmentModal);
  document.getElementById('deleteAppointment')?.addEventListener('click', deleteAppointment);
  document.getElementById('appointmentForm')?.addEventListener('submit', (e)=>{ e.preventDefault(); saveAppointment(); });

  // search
  const searchBtn=document.getElementById('searchBtn');
  const searchBar=document.getElementById('searchBar');
  const searchInput=document.getElementById('searchInput');
  document.getElementById('clearSearch')?.addEventListener('click', ()=>{ searchInput.value=''; searchQuery=''; renderAll(); });
  searchBtn?.addEventListener('click', ()=> searchBar.classList.toggle('hidden'));
  searchInput?.addEventListener('input', (e)=>{ searchQuery=e.target.value; highlightSearchResults(); });

  // filtros
  document.getElementById('filterStatus')?.addEventListener('change', (e)=>{ statusFilter=e.target.value; renderAll(); });

  // impressão
  document.getElementById('printPage')?.addEventListener('click', ()=>{ preparePrintData(); window.print(); });

  // localidades
  setupLocalityDropdown();

  // Google Places Autocomplete para campo de morada (moradas + empresas/POIs)
const addressInput = document.getElementById('appointmentAddress');
if (addressInput && window.google?.maps?.places) {
  const autocomplete = new google.maps.places.Autocomplete(addressInput, {
    types: ['geocode', 'establishment'],
    componentRestrictions: { country: 'pt' },
    fields: ['place_id', 'name', 'formatted_address', 'geometry']
  });

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (place) {
      addressInput.value = place.formatted_address || place.name || '';
      addressInput.dataset.lat = place.geometry.location.lat();
      addressInput.dataset.lng = place.geometry.location.lng();
    }
  });
}

  await load();
  renderAll();
  
  // Inicializar cálculo de quilómetros após carregar dados
  setTimeout(() => {
    if (window.distanceCalculator && appointments.length > 0) {
      window.distanceCalculator.calculateAllDistances(appointments);
    }
  }, 2000);
});

// ===== CÁLCULO AUTOMÁTICO DE QUILÓMETROS =====
class DistanceCalculator {
  constructor() {
    this.storeAddress = "Avenida Robert Smith 59, 4715-249 Braga, Portugal";
    this.cache = new Map();
    this.isCalculating = false;
  }

  async calculateAllDistances(appointmentsList) {
    if (this.isCalculating || !appointmentsList) return;
    this.isCalculating = true;

    try {
      const validAppointments = appointmentsList
        .filter(apt => apt.date && apt.address && apt.address.trim())
        .sort((a, b) => {
          const dateCompare = (a.date || '').localeCompare(b.date || '');
          if (dateCompare !== 0) return dateCompare;
          
          const periodOrder = { 'Manhã': 1, 'Tarde': 2, '': 3 };
          return (periodOrder[a.period] || 3) - (periodOrder[b.period] || 3);
        });

      if (validAppointments.length === 0) {
        this.isCalculating = false;
        return;
      }

      await this.calculateSequentialDistances(validAppointments);
      renderAll();
      
    } catch (error) {
      console.error('Erro ao calcular distâncias:', error);
    } finally {
      this.isCalculating = false;
    }
  }

  async calculateSequentialDistances(sortedAppointments) {
    let previousAddress = this.storeAddress;

    for (let i = 0; i < sortedAppointments.length; i++) {
      const appointment = sortedAppointments[i];
      const currentAddress = appointment.address.trim();

      try {
        const cacheKey = `${previousAddress}|${currentAddress}`;
        let distance = this.cache.get(cacheKey);

        if (!distance) {
          distance = await this.getDistanceFromAPI(previousAddress, currentAddress);
          
          if (distance !== null) {
            this.cache.set(cacheKey, distance);
          }
        }

        if (distance !== null) {
          appointment.calculatedKilometers = Math.round(distance);
        }

        previousAddress = currentAddress;

      } catch (error) {
        console.error(`Erro ao calcular distância para agendamento ${appointment.id}:`, error);
        appointment.calculatedKilometers = null;
      }
    }
  }

  async getDistanceFromAPI(origin, destination) {
    return new Promise((resolve) => {
      if (!window.google || !window.google.maps) {
        resolve(null);
        return;
      }

      const service = new google.maps.DistanceMatrixService();
      
      service.getDistanceMatrix({
        origins: [origin],
        destinations: [destination],
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.METRIC,
        avoidHighways: false,
        avoidTolls: false
      }, (response, status) => {
        if (status === google.maps.DistanceMatrixStatus.OK) {
          const element = response.rows[0]?.elements[0];
          
          if (element && element.status === 'OK') {
            const distanceKm = element.distance.value / 1000;
            resolve(distanceKm);
          } else {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
  }

  clearCache() {
    this.cache.clear();
  }
}

// Instância global do calculador
window.distanceCalculator = new DistanceCalculator();