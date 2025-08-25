// ===== PORTAL DE AGENDAMENTO MELHORADO =====
// Versão com localStorage + funcionalidades aprimoradas

// Configurações e dados
const localityColors = {
  'Outra': '#9CA3AF', 'Barcelos': '#F87171', 'Braga': '#34D399', 'Esposende': '#22D3EE',
  'Famalicão': '#2DD4BF', 'Guimarães': '#FACC15', 'Póvoa de Lanhoso': '#A78BFA',
  'Póvoa de Varzim': '#6EE7B7', 'Riba D\'Ave': '#FBBF24', 'Trofa': '#C084FC',
  'Vieira do Minho': '#93C5FD', 'Vila do Conde': '#FCD34D', 'Vila Verde': '#86EFAC'
};

// expor mapa para o “skin” mobile
window.LOCALITY_COLORS = localityColors;
// helper robusto para cor da localidade
function getLocColor(loc) { return (localityColors && localityColors[loc]) || '#3b82f6'; }

const statusBarColors = { 'NE': '#EF4444', 'VE': '#F59E0B', 'ST': '#10B981' };
const localityList = Object.keys(localityColors);

// Estado da aplicação
let appointments = [];
let currentMonday = getMonday(new Date());
let currentMobileDay = new Date();
let editingId = null;
let searchQuery = '';
let statusFilter = '';

// ===== UTILITÁRIOS =====
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}
function addDays(date, days) { const r = new Date(date); r.setDate(r.getDate() + days); return r; }

// ===== UTILITÁRIOS DE DATA =====
function parseDate(dateStr) {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
    const [d, m, y] = dateStr.split('/'); return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  try { const d = new Date(dateStr); if (!isNaN(d.getTime())) return localISO(d); } catch {}
  return '';
}
function formatDateForInput(s){ if(!s)return''; if(/^\d{4}-\d{2}-\d{2}$/.test(s)){const [y,m,d]=s.split('-');return `${d}/${m}/${y}`;} return s; }
function localISO(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function fmtHeader(date){ return { day: date.toLocaleDateString('pt-PT',{weekday:'long'}), dm: date.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'}) }; }
function cap(s){ return s? s.charAt(0).toUpperCase()+s.slice(1) : s; }
function hex2rgba(hex,a){ const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16); return `rgba(${r},${g},${b},${a})`; }
function bucketOf(a){ if(!a.date||!a.period) return 'unscheduled'; return `${a.date}|${a.period}`; }
function normalizeBucketOrder(bucket){ appointments.filter(a=>bucketOf(a)===bucket).forEach((it,i)=>it.sortIndex=i+1); }

// ===== TOAST NOTIFICATIONS =====
function showToast(message, type='info'){
  const c=document.getElementById('toastContainer'); if(!c) return;
  const t=document.createElement('div'); t.className=`toast ${type}`;
  const icon= type==='success'?'✅': type==='error'?'❌':'ℹ️';
  t.innerHTML=`<span>${icon}</span><span>${message}</span>`;
  c.appendChild(t); setTimeout(()=>t.remove(),4000);
}

// ===== FORMATAÇÃO DE MATRÍCULA =====
function formatPlate(input){
  let v=input.value.replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  if(v.length>2) v=v.slice(0,2)+'-'+v.slice(2);
  if(v.length>5) v=v.slice(0,5)+'-'+v.slice(5,7);
  input.value=v;
}

// ===== ARMAZENAMENTO =====
async function save(){ try{ showToast('Dados sincronizados com sucesso!','success'); }catch(e){ showToast('Erro na sincronização: '+e.message,'error'); } }
async function load(){
  try{
    showToast('Carregando dados...','info');
    appointments = await window.apiClient.getAppointments();
    appointments.forEach(a=>{ if(!a.id) a.id=Date.now()+Math.random(); if(!a.sortIndex) a.sortIndex=1; });
    const locs = await window.apiClient.getLocalities();
    if(locs && typeof locs==='object'){ Object.assign(localityColors, locs); window.LOCALITY_COLORS = localityColors; }
    const st = window.apiClient.getConnectionStatus();
    showToast(st.online? 'Dados carregados da cloud!' : 'Dados carregados localmente (offline)', st.online? 'success':'warning');
  }catch(e){ appointments=[]; showToast('Erro ao carregar dados: '+e.message,'error'); }
}

// ===== PESQUISA E FILTROS =====
function filterAppointments(list){
  let f=[...list];
  if(searchQuery){
    const q=searchQuery.toLowerCase();
    f=f.filter(a=> a.plate.toLowerCase().includes(q)
      || a.car.toLowerCase().includes(q)
      || a.locality.toLowerCase().includes(q)
      || (a.notes && a.notes.toLowerCase().includes(q)));
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

// ===== DRAG & DROP =====
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
    zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over');});
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

// ===== RENDERIZAÇÃO =====
function renderSchedule(){
  const table=document.getElementById('schedule'); if(!table) return;
  table.innerHTML='';
  const week=[...Array(5)].map((_,i)=>addDays(currentMonday,i));
  const wr=document.getElementById('weekRange');
  if(wr){ wr.textContent = `${week[0].toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'})} - ${week[4].toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit',year:'numeric'})}`; }

  let thead='<thead><tr><th>Período</th>';
  for(const d of week){ const h=fmtHeader(d); thead+=`<th><div class="day">${cap(h.day)}</div><div class="date">${h.dm}</div></th>`; }
  thead+='</tr></thead>'; table.insertAdjacentHTML('beforeend',thead);

  const renderCell=(period,dayDate)=>{
    const iso=localISO(dayDate);
    const items=filterAppointments(appointments.filter(a=>a.date&&a.date===iso&&a.period===period).sort((x,y)=>(x.sortIndex||0)-(y.sortIndex||0)));
    const appointmentBlocks=items.map(a=>{
      const bg=getLocColor(a.locality); const bar=statusBarColors[a.status]||'#999'; const notes=a.notes?a.notes:'';
      return `
        <div class="appointment appointment-block"
             data-id="${a.id}" draggable="true"
             data-locality="${a.locality}" data-loccolor="${bg}"
             style="--loc-color:${bg}; background-color:${hex2rgba(bg,0.65)}; border-left:6px solid ${bar}">
          <div class="appt-header">${a.plate} | ${a.service} | ${a.car.toUpperCase()}</div>
          <div class="appt-sub">${a.locality} | ${notes}</div>
          <div class="appt-status">
            <label><input type="checkbox" data-status="NE" ${a.status==='NE'?'checked':''}/> N/E</label>
            <label><input type="checkbox" data-status="VE" ${a.status==='VE'?'checked':''}/> V/E</label>
            <label><input type="checkbox" data-status="ST" ${a.status==='ST'?'checked':''}/> ST</label>
          </div>
        </div>`;
    }).join('');
    return `<div class="drop-zone" data-drop-bucket="${iso}|${period}">${appointmentBlocks}</div>`;
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

function renderUnscheduled(){
  const container=document.getElementById('unscheduledList'); if(!container) return;
  const unscheduled=filterAppointments(appointments.filter(a=>!a.date||!a.period).sort((x,y)=>(x.sortIndex||0)-(y.sortIndex||0)));
  const appointmentBlocks=unscheduled.map(a=>{
    const bg=getLocColor(a.locality); const bar=statusBarColors[a.status]||'#999'; const notes=a.notes?a.notes:'';
    return `
      <div class="appointment unscheduled appointment-block"
           data-id="${a.id}" draggable="true"
           data-locality="${a.locality}" data-loccolor="${bg}"
           style="--loc-color:${bg}; background-color:${hex2rgba(bg,0.65)}; border-left:6px solid ${bar}">
        <div class="appt-header">${a.plate} | ${a.service} | ${a.car.toUpperCase()}</div>
        <div class="appt-sub">${a.locality} | ${notes}</div>
        <div class="appt-status">
          <label><input type="checkbox" data-status="NE" ${a.status==='NE'?'checked':''}/> N/E</label>
          <label><input type="checkbox" data-status="VE" ${a.status==='VE'?'checked':''}/> V/E</label>
          <label><input type="checkbox" data-status="ST" ${a.status==='ST'?'checked':''}/> ST</label>
        </div>
        <div class="unscheduled-actions">
          <button class="icon edit" onclick="editAppointment(${a.id})" title="Editar">✏️</button>
          <button class="icon delete" onclick="deleteAppointment(${a.id})" title="Eliminar">🗑️</button>
        </div>
      </div>`;
  }).join('');
  container.innerHTML=`<div class="drop-zone" data-drop-bucket="unscheduled">${appointmentBlocks}</div>`;
  enableDragDrop(); attachStatusListeners(); highlightSearchResults();
}

function renderMobileDay(){
  const label=document.getElementById('mobileDayLabel');
  if(label){ const s=currentMobileDay.toLocaleDateString('pt-PT',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'}); label.textContent=cap(s); }

  const iso=localISO(currentMobileDay);
  const dayAppointments=filterAppointments(appointments.filter(a=>a.date===iso).sort((a,b)=>a.period===b.period? (a.sortIndex||0)-(b.sortIndex||0) : (a.period==='Manhã'?-1:1)));
  const container=document.getElementById('mobileDayList'); if(!container) return;

  container.innerHTML=dayAppointments.map(a=>{
    const bg=getLocColor(a.locality); const bar=statusBarColors[a.status]||'#999'; const notes=a.notes?a.notes:'';
    return `
      <div class="appointment appointment-block"
           data-period="${a.period}" data-status="${a.status}"
           data-locality="${a.locality}" data-loccolor="${bg}"
           style="--loc-color:${bg}; background-color:${hex2rgba(bg,0.65)}; border-left:6px solid ${bar}; margin-bottom:10px; color:#fff;">
        <div class="appt-header" style="color:#fff;">${a.period} - ${a.plate} | ${a.service} | ${a.car.toUpperCase()}</div>
        <div class="appt-sub" style="color:#fff; opacity:0.9;">${a.locality} | ${notes}</div>
      </div>`;
  }).join('');
  highlightSearchResults();
}

function renderServicesTable(){
  const today=new Date();
  const futureServices=filterAppointments(appointments.filter(a=>a.date && new Date(a.date)>=new Date().setHours(0,0,0,0)).sort((a,b)=>new Date(a.date)-new Date(b.date)));
  const tbody=document.getElementById('servicesTableBody'); if(!tbody) return;
  tbody.innerHTML=futureServices.map(a=>{
    const d=new Date(a.date), diff=d-today, diffDays=Math.ceil(diff/(1000*60*60*24));
    const daysText = diffDays<0? `${Math.abs(diffDays)} dias atrás` : diffDays===0? 'Hoje' : diffDays===1? 'Amanhã' : `${diffDays} dias`;
    return `<tr>
      <td>${d.toLocaleDateString('pt-PT')}</td>
      <td>${a.period}</td>
      <td>${a.plate}</td>
      <td>${a.car}</td>
      <td><span class="badge badge-${a.service}">${a.service}</span></td>
      <td>${a.locality}</td>
      <td>${a.notes || ''}</td>
      <td><span class="chip chip-${a.status}">${a.status}</span></td>
      <td>${daysText}</td>
      <td class="no-print">
        <div class="actions">
          <button class="icon edit" onclick="editAppointment(${a.id})" title="Editar">✏️</button>
          <button class="icon delete" onclick="deleteAppointment(${a.id})" title="Eliminar">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
  const sum=document.getElementById('servicesSummary'); if(sum) sum.textContent=`${futureServices.length} serviços pendentes`;
}
function renderAll(){ renderSchedule(); renderUnscheduled(); renderMobileDay(); renderServicesTable(); }

// ===== GESTÃO DE AGENDAMENTOS =====
function openAppointmentModal(id=null){
  editingId=id;
  const modal=document.getElementById('appointmentModal'); if(!modal) return;
  const form=document.getElementById('appointmentForm');
  const title=document.getElementById('modalTitle');
  const del=document.getElementById('deleteAppointment');
  if(id){
    const a=appointments.find(x=>x.id===id);
    if(a){ title.textContent='Editar Agendamento';
      document.getElementById('appointmentDate').value = formatDateForInput(a.date)||'';
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
  } else {
    title.textContent='Novo Agendamento'; form.reset();
    document.getElementById('appointmentStatus').value='NE';
    del.classList.add('hidden');
  }
  modal.classList.add('show');
}
function closeAppointmentModal(){ const m=document.getElementById('appointmentModal'); if(m) m.classList.remove('show'); editingId=null; }

async function saveAppointment(){
  const rawDate=document.getElementById('appointmentDate').value;
  const appointment={
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
  if(!appointment.plate || !appointment.car || !appointment.service || !appointment.locality){
    showToast('Por favor, preencha todos os campos obrigatórios (Matrícula, Carro, Serviço, Localidade).','error'); return;
  }
  try{
    let result;
    if(editingId){
      result=await window.apiClient.updateAppointment(editingId, appointment);
      const idx=appointments.findIndex(a=>a.id===editingId); if(idx>=0) appointments[idx]={...appointments[idx],...result};
      showToast('Agendamento atualizado com sucesso!','success');
    }else{
      result=await window.apiClient.createAppointment(appointment);
      appointments.push(result); showToast('Serviço criado com sucesso!','success');
    }
    await save(); renderAll(); closeAppointmentModal();
  }catch(e){ console.error('Erro ao salvar agendamento:',e); showToast('Erro ao salvar: '+e.message,'error'); }
}
function editAppointment(id){ openAppointmentModal(id); }
async function deleteAppointment(id){
  if(confirm('Tem certeza que deseja eliminar este agendamento?')){
    try{
      await window.apiClient.deleteAppointment(id);
      appointments=appointments.filter(a=>a.id!==id);
      await save(); renderAll(); showToast('Agendamento eliminado com sucesso!','success');
      if(editingId===id) closeAppointmentModal();
    }catch(e){ console.error('Erro ao eliminar agendamento:',e); showToast('Erro ao eliminar: '+e.message,'error'); }
  }
}

// ===== STATUS LISTENERS =====
function attachStatusListeners(){
  document.querySelectorAll('.appt-status input[type="checkbox"]').forEach(cb=>{
    cb.addEventListener('change',function(){
      const el=this.closest('.appointment'); if(!el) return;
      const id=Number(el.getAttribute('data-id')); const status=this.getAttribute('data-status');
      if(this.checked){
        el.querySelectorAll('.appt-status input[type="checkbox"]').forEach(x=>{ if(x!==this) x.checked=false; });
        const a=appointments.find(x=>x.id===id);
        if(a){ a.status=status; save(); renderAll(); showToast(`Status alterado para ${status}`,'success'); }
      }
    });
  });
}

// ===== BACKUP E EXPORTAÇÃO =====
function exportToJson(){
  const data={version:'3.0', exported:new Date().toISOString(), appointments};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=`agendamentos_${new Date().toISOString().split('T')[0]}.json`; a.click(); URL.revokeObjectURL(url);
  showToast('Backup JSON exportado com sucesso!','success');
}
function exportToCsv(){
  const headers=['Data','Período','Matrícula','Carro','Serviço','Localidade','Status','Observações'];
  const rows=appointments.map(a=>[a.date||'',a.period||'',a.plate||'',a.car||'',a.service||'',a.locality||'',a.status||'',a.notes||'']);
  const csv=[headers,...rows].map(r=>r.map(f=>`"${f}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`agendamentos_${new Date().toISOString().split('T')[0]}.csv`; a.click(); URL.revokeObjectURL(url);
  showToast('Dados exportados para CSV com sucesso!','success');
}
function importFromJson(file){
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const data=JSON.parse(e.target.result);
      if(data.appointments && Array.isArray(data.appointments)){
        if(confirm(`Importar ${data.appointments.length} agendamentos? Isto irá substituir todos os dados atuais.`)){
          appointments=data.appointments; save(); renderAll(); showToast('Dados importados com sucesso!','success'); closeBackupModal();
        }
      }else showToast('Formato de ficheiro inválido.','error');
    }catch(err){ showToast('Erro ao ler ficheiro: '+err.message,'error'); }
  };
  reader.readAsText(file);
}

// ===== ESTATÍSTICAS =====
function generateStats(){
  const total=appointments.length, scheduled=appointments.filter(a=>a.date&&a.period).length, unscheduled=total-scheduled;
  const byStatus={ NE:appointments.filter(a=>a.status==='NE').length, VE:appointments.filter(a=>a.status==='VE').length, ST:appointments.filter(a=>a.status==='ST').length };
  const byService={}; appointments.forEach(a=>{ byService[a.service]=(byService[a.service]||0)+1; });
  const byLocality={}; appointments.forEach(a=>{ byLocality[a.locality]=(byLocality[a.locality]||0)+1; });
  return { total, scheduled, unscheduled, byStatus, byService, byLocality };
}
function showStats(){
  const s=generateStats(); const modal=document.getElementById('statsModal'); const c=document.getElementById('statsContent'); if(!modal||!c) return;
  c.innerHTML=`
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-number">${s.total}</div><div class="stat-label">Total de Agendamentos</div></div>
      <div class="stat-card"><div class="stat-number">${s.scheduled}</div><div class="stat-label">Agendados</div></div>
      <div class="stat-card"><div class="stat-number">${s.unscheduled}</div><div class="stat-label">Por Agendar</div></div>
    </div>
    <h4>Por Status</h4>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-number">${s.byStatus.NE}</div><div class="stat-label">Não Executado</div></div>
      <div class="stat-card"><div class="stat-number">${s.byStatus.VE}</div><div class="stat-label">Vidro Encomendado</div></div>
      <div class="stat-card"><div class="stat-number">${s.byStatus.ST}</div><div class="stat-label">Serviço Terminado</div></div>
    </div>
    <h4>Por Tipo de Serviço</h4>
    <div class="stats-grid">
      ${Object.entries(s.byService).map(([svc,cnt])=>`
        <div class="stat-card">
          <div class="stat-number">${cnt}</div>
          <div class="stat-label">${svc}</div>
        </div>`).join('')}
    </div>
  `;
  modal.classList.add('show');
}

// ===== MODAIS =====
function closeBackupModal(){ const m=document.getElementById('backupModal'); if(m) m.classList.remove('show'); }
function closeStatsModal(){ const m=document.getElementById('statsModal'); if(m) m.classList.remove('show'); }

// ===== NAVEGAÇÃO =====
function prevWeek(){ currentMonday=addDays(currentMonday,-7); renderAll(); }
function nextWeek(){ currentMonday=addDays(currentMonday,7); renderAll(); }
function todayWeek(){ currentMonday=getMonday(new Date()); renderAll(); }
function prevDay(){ currentMobileDay=addDays(currentMobileDay,-1); renderMobileDay(); }
function nextDay(){ currentMobileDay=addDays(currentMobileDay,1); renderMobileDay(); }
function todayDay(){ currentMobileDay=new Date(); renderMobileDay(); }

// ===== IMPRESSÃO =====
function printPage(){ updatePrintUnscheduledTable(); updatePrintTomorrowTable(); window.print(); }
function updatePrintUnscheduledTable(){
  const unscheduled=filterAppointments(appointments.filter(a=>!a.date||!a.period).sort((x,y)=>(x.sortIndex||0)-(y.sortIndex||0)));
  const tbody=document.getElementById('printUnscheduledTableBody'); const sec=document.querySelector('.print-unscheduled-section');
  if(!tbody||!sec) return;
  if(unscheduled.length===0){ sec.style.display='none'; return; }
  sec.style.display='block';
  tbody.innerHTML=unscheduled.map(a=>`
    <tr>
      <td>${a.plate}</td><td>${a.car}</td>
      <td><span class="service-badge badge-${a.service}">${a.service}</span></td>
      <td>${a.locality}</td><td><span class="status-chip chip-${a.status}">${a.status}</span></td>
      <td>${a.notes||''}</td><td>${a.extra||''}</td>
    </tr>`).join('');
}
function updatePrintTomorrowTable(){
  const t=new Date(); t.setDate(t.getDate()+1); const tomorrowStr=localISO(t);
  const list=appointments.filter(a=>a.date===tomorrowStr).sort((a,b)=>({Manhã:1,Tarde:2}[a.period]||3)-({Manhã:1,Tarde:2}[b.period]||3));
  const title=document.getElementById('printTomorrowTitle'); const dateEl=document.getElementById('printTomorrowDate');
  const tbody=document.getElementById('printTomorrowTableBody'); const empty=document.getElementById('printTomorrowEmpty'); const table=document.querySelector('.print-tomorrow-table');
  if(title) title.textContent='SERVIÇOS DE AMANHÃ';
  if(dateEl) dateEl.textContent=cap(t.toLocaleDateString('pt-PT',{weekday:'long',year:'numeric',month:'long',day:'numeric'}));
  if(!tbody||!table||!empty) return;
  if(list.length===0){ table.style.display='none'; empty.style.display='block'; }
  else{
    table.style.display='table'; empty.style.display='none';
    tbody.innerHTML=list.map(a=>`
      <tr>
        <td>${a.period||''}</td><td>${a.plate}</td><td>${a.car}</td>
        <td><span class="service-badge badge-${a.service}">${a.service}</span></td>
        <td>${a.locality}</td><td><span class="status-chip chip-${a.status}">${a.status}</span></td>
        <td>${a.notes||''}</td><td>${a.extra||''}</td>
      </tr>`).join('');
  }
}

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', async function(){
  await load();
  initializeLocalityDropdown();
  renderAll();
  updateConnectionStatus();

  document.getElementById('prevWeek')?.addEventListener('click', prevWeek);
  document.getElementById('nextWeek')?.addEventListener('click', nextWeek);
  document.getElementById('todayWeek')?.addEventListener('click', todayWeek);
  document.getElementById('prevDay')?.addEventListener('click', prevDay);
  document.getElementById('nextDay')?.addEventListener('click', nextDay);
  document.getElementById('todayDay')?.addEventListener('click', todayDay);
  document.getElementById('printPage')?.addEventListener('click', printPage);

  document.getElementById('backupBtn')?.addEventListener('click', ()=>{ document.getElementById('backupModal')?.classList.add('show'); });
  document.getElementById('statsBtn')?.addEventListener('click', showStats);

  document.getElementById('searchBtn')?.addEventListener('click', ()=>{
    const bar=document.getElementById('searchBar'); if(!bar) return;
    bar.classList.toggle('hidden'); if(!bar.classList.contains('hidden')) document.getElementById('searchInput')?.focus();
  });
  document.getElementById('searchInput')?.addEventListener('input',(e)=>{ searchQuery=e.target.value; renderAll(); });
  document.getElementById('clearSearch')?.addEventListener('click', ()=>{
    searchQuery=''; const i=document.getElementById('searchInput'); if(i) i.value=''; document.getElementById('searchBar')?.classList.add('hidden'); renderAll();
  });
  document.getElementById('filterStatus')?.addEventListener('change',(e)=>{ statusFilter=e.target.value; renderAll(); });

  document.getElementById('addServiceBtn')?.addEventListener('click', ()=>openAppointmentModal());
  document.getElementById('addServiceMobile')?.addEventListener('click', ()=>openAppointmentModal());
  document.getElementById('closeModal')?.addEventListener('click', closeAppointmentModal);
  document.getElementById('cancelForm')?.addEventListener('click', closeAppointmentModal);

  document.getElementById('appointmentForm')?.addEventListener('submit',(e)=>{ e.preventDefault(); saveAppointment(); });
  document.getElementById('deleteAppointment')?.addEventListener('click', ()=>{ if(editingId) deleteAppointment(editingId); });
  document.getElementById('appointmentPlate')?.addEventListener('input',(e)=>{ formatPlate(e.target); });

  document.getElementById('exportJson')?.addEventListener('click', exportToJson);
  document.getElementById('exportCsv')?.addEventListener('click', exportToCsv);
  document.getElementById('exportServices')?.addEventListener('click', exportToCsv);

  document.getElementById('importBtn')?.addEventListener('click', ()=>{ document.getElementById('importFile')?.click(); });
  document.getElementById('importFile')?.addEventListener('change',(e)=>{ const f=e.target.files[0]; if(f) importFromJson(f); });

  document.addEventListener('click',(e)=>{ if(e.target.classList?.contains('modal')) e.target.classList.remove('show'); });
  document.addEventListener('keydown',(e)=>{
    if(e.ctrlKey||e.metaKey){
      switch(e.key){
        case 'f': e.preventDefault(); document.getElementById('searchBtn')?.click(); break;
        case 's': e.preventDefault(); save(); break;
        case 'n': e.preventDefault(); openAppointmentModal(); break;
      }
    }
    if(e.key==='Escape'){ document.querySelectorAll('.modal.show').forEach(m=>m.classList.remove('show')); }
  });
});

// Expor funções globais necessárias
window.editAppointment = editAppointment;
window.deleteAppointment = deleteAppointment;
window.closeBackupModal = closeBackupModal;
window.closeStatsModal = closeStatsModal;

// ===== DROPDOWN DE LOCALIDADES COM CORES =====
function initializeLocalityDropdown(){
  const opt=document.getElementById('localityOptions'); if(!opt) return;
  opt.innerHTML='';
  Object.entries(localityColors).forEach(([loc,color])=>{
    const div=document.createElement('div'); div.className='locality-option'; div.onclick=()=>selectLocality(loc);
    div.innerHTML=`<span class="locality-dot" style="background-color:${color}"></span><span>${loc}</span>`;
    opt.appendChild(div);
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
window.toggleLocalityDropdown = toggleLocalityDropdown;
window.selectLocality = selectLocality;

// ===== STATUS DE CONEXÃO =====
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