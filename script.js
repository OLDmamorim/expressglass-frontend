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
  return null; // <— importante: null (não string vazia) para "sem data"
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
      (a.plate||'').toLowerCase().includes(q) ||
      (a.car||'').toLowerCase().includes(q) ||
      (a.locality||'').toLowerCase().includes(q) ||
      ((a.notes||'').toLowerCase().includes(q))
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

// ---------- Drag & Drop (com persistência total) ----------
function getBucketList(bucket){
  return appointments
    .filter(x => bucketOf(x) === bucket)
    .sort((a,b) => (a.sortIndex||0) - (b.sortIndex||0));
}

async function persistBuckets(buckets){
  for (const bucket of buckets){
    const list = getBucketList(bucket);
    for (const item of list){
      try{ await window.apiClient.updateAppointment(item.id, { ...item }); }
      catch(e){ console.warn('Falha a gravar', item.id, e); showToast('Falha a gravar alguns itens.', 'error'); }
    }
  }
  showToast('Alterações gravadas.', 'success');
}

function enableDragDrop(scope){
  (scope||document).querySelectorAll('.appointment[data-id]').forEach(card=>{
    card.draggable=true;
    card.addEventListener('dragstart',e=>{
      e.dataTransfer.setData('text/plain',card.getAttribute('data-id'));
      e.dataTransfer.effectAllowed='move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
  });

  if (!enableDragDrop._bound){
    document.addEventListener('dragover', (e)=>{
      const zone = e.target.closest('[data-drop-bucket]');
      if(!zone) return;
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    document.addEventListener('dragleave', (e)=>{
      const zone = e.target.closest('[data-drop-bucket]');
      if(zone) zone.classList.remove('drag-over');
    });
    document.addEventListener('drop', async (e)=>{
      const zone = e.target.closest('[data-drop-bucket]');
      if(!zone) return;
      e.preventDefault();
      zone.classList.remove('drag-over');
      const id    = Number(e.dataTransfer.getData('text/plain'));
      const bucket= zone.getAttribute('data-drop-bucket');
      const idxIn = zone.querySelectorAll('.appointment').length;
      await onDropAppointment(id, bucket, idxIn);
    });
    enableDragDrop._bound = true;
  }
}

async function onDropAppointment(id, targetBucket, targetIndex){
  const i = appointments.findIndex(a => a.id === id);
  if (i < 0) return;

  const a         = appointments[i];
  const oldBucket = bucketOf(a);

  if(targetBucket === 'unscheduled'){ a.date=null; a.period=null; }
  else { const [d,p] = targetBucket.split('|'); a.date=d; a.period=p||'Manhã'; }

  const dest = getBucketList(targetBucket).filter(x=>x.id!==a.id);
  dest.splice(Math.min(targetIndex, dest.length), 0, a);
  dest.forEach((x,idx)=> x.sortIndex = idx+1);

  if (oldBucket !== targetBucket){
    const orig = getBucketList(oldBucket);
    orig.forEach((x,idx)=> x.sortIndex = idx+1);
  }

  renderAll();

  const bucketsToPersist = new Set([targetBucket, oldBucket]);
  await persistBuckets(bucketsToPersist);
}

// ---------- Render DESKTOP (cartões estilo mobile) ----------
function buildDesktopCard(a){
  const base = getLocColor(a.locality);
  const g = gradFromBase(base);
  const bar = statusBarColors[a.status] || '#999';
  const title = `${a.plate} | ${a.service} | ${(a.car||'').toUpperCase()}`;
  const sub   = [a.locality, a.notes].filter(Boolean).join(' | ');

  return `
    <div class="appointment desk-card"
         data-id="${a.id}" draggable="true"
         data-locality="${a.locality||''}" data-loccolor="${base}"
         style="--c1:${g.c1}; --c2:${g.c2}; border-left:6px solid ${bar}">
      <div class="dc-title">${title}</div>
      <div class="dc-sub">${sub}</div>
      <div class="appt-status dc-status">
        <label><input type="checkbox" data-status="NE" ${a.status==='NE'?'checked':''}/> N/E</label>
        <label><input type="checkbox" data-status="VE" ${a.status==='VE'?'checked':''}/> V/E</label>
        <label><input type="checkbox" data-status="ST" ${a.status==='ST'?'checked':''}/> ST</label>
      </div>
    </div>`;
}

function renderSchedule(){
  const table=document.getElementById('schedule'); if(!table) return;
  table.innerHTML='';
  // ✅ CORREÇÃO: Mudado de Array(5) para Array(6) para incluir sábado
  const week=[...Array(6)].map((_,i)=>addDays(currentMonday,i));
  const wr=document.getElementById('weekRange');
  // ✅ CORREÇÃO: Mudado de week[4] para week[5] para mostrar até sábado
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
  enableDragDrop(); attachStatusListeners(); highlightSearchResults();
}

// ---------- Render PENDENTES ----------
function renderUnscheduled(){
  const container=document.getElementById('unscheduledList'); if(!container) return;
  const unscheduled=filterAppointments(
    appointments.filter(a=>!a.date||!a.period)
                .sort((x,y)=>(x.sortIndex||0)-(y.sortIndex||0))
  );
  const blocks = unscheduled.map(a=>{
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
        <div class="dc-title">${title}</div>
        <div class="dc-sub">${sub}</div>
        <div class="appt-status dc-status">
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
  container.innerHTML=`<div class="drop-zone" data-drop-bucket="unscheduled">${blocks}</div>`;
  enableDragDrop(); attachStatusListeners(); highlightSearchResults();
}

// ---------- Header da tabela (garante coluna Ações) ----------
function ensureServicesHeader(){
  const table = document.querySelector('.services-table');
  if(!table) return;
  let thead = table.querySelector('thead');
  if(!thead){
    thead = document.createElement('thead');
    table.prepend(thead);
  }
  // Alinhado com o index.html
  const headers = ['Data','Período','Matrícula','Carro','Serviço','Localidade','Observações','Estado','Dias','Ações'];
  thead.innerHTML = `<tr>${
    headers.map(h => h==='Ações'
      ? `<th class="no-print actions-col" style="width:100px;text-align:left">Ações</th>`
      : `<th>${h}</th>`
    ).join('')
  }</tr>`;
}

// ---------- Render TABELA FUTURA ----------
function renderServicesTable(){
  const tbody=document.getElementById('servicesTableBody'); if(!tbody) return;

  ensureServicesHeader();

  // início de hoje
  const startToday = new Date(); startToday.setHours(0,0,0,0);

  const future = filterAppointments(
    appointments
      .filter(a => a.date && new Date(a.date) >= startToday)
      .sort((a,b) => new Date(a.date) - new Date(b.date))
  );

  const today = new Date(); today.setHours(0,0,0,0);

  tbody.innerHTML=future.map(a=>{
    const d=new Date(a.date);
    const diff=Math.ceil((d - today)/(1000*60*60*24));
    const when = diff<0? `${Math.abs(diff)} dias atrás` : diff===0? 'Hoje' : diff===1? 'Amanhã' : `${diff} dias`;
    return `<tr>
      <td>${d.toLocaleDateString('pt-PT')}</td>
      <td>${a.period||''}</td>
      <td>${a.plate||''}</td>
      <td>${a.car||''}</td>
      <td><span class="badge badge-${a.service}">${a.service||''}</span></td>
      <td>${a.locality||''}</td>
      <td>${a.notes||''}</td>
      <td><span class="chip chip-${a.status}">${a.status||''}</span></td>
      <td>${when}</td>
      <td class="no-print">
        <div class="actions">
          <button class="icon edit" onclick="editAppointment(${a.id})" title="Editar" aria-label="Editar">✏️</button>
          <button class="icon delete" onclick="deleteAppointment(${a.id})" title="Eliminar" aria-label="Eliminar">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  const sum=document.getElementById('servicesSummary'); if(sum) sum.textContent=`${future.length} serviços pendentes`;
}

function renderAll(){ renderSchedule(); renderUnscheduled(); renderMobileDay(); renderServicesTable(); }

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
      // UI do dropdown
      const txt=document.getElementById('selectedLocalityText'); const dot=document.getElementById('selectedLocalityDot');
      if(txt) txt.textContent=a.locality||'Selecione a localidade';
      if(dot) dot.style.backgroundColor=getLocColor(a.locality);
      document.getElementById('appointmentStatus').value = a.status||'NE';
      document.getElementById('appointmentNotes').value = a.notes||'';
      document.getElementById('appointmentExtra').value = a.extra||'';
      del.classList.remove('hidden');
    }
  }else{
    title.textContent='Novo Agendamento';
    if(form) form.reset();
    document.getElementById('appointmentStatus').value='NE';
    const txt=document.getElementById('selectedLocalityText'); const dot=document.getElementById('selectedLocalityDot');
    if(txt) txt.textContent='Selecione a localidade';
    if(dot) dot.style.backgroundColor='#ccc';
    del.classList.add('hidden');
  }
  modal.classList.add('show');
}

function closeAppointmentModal(){
  const modal=document.getElementById('appointmentModal'); if(modal) modal.classList.remove('show');
  editingId=null;
}

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
    extra: document.getElementById('appointmentExtra').value.trim()||null
  };
  if(!data.plate){ showToast('Matrícula é obrigatória','error'); return; }
  if(!data.car){ showToast('Modelo do carro é obrigatório','error'); return; }
  if(!data.service){ showToast('Tipo de serviço é obrigatório','error'); return; }
  if(!data.locality){ showToast('Localidade é obrigatória','error'); return; }

  try{
    if(editingId){
      const res=await window.apiClient.updateAppointment(editingId,data);
      const idx=appointments.findIndex(a=>a.id===editingId);
      if(idx>=0) appointments[idx]={...appointments[idx],...(res||data)};
      showToast('Agendamento atualizado!','success');
    }else{
      const res=await window.apiClient.createAppointment(data);
      const newAppt={id:Date.now()+Math.random(),sortIndex:1,...data,...(res||{})};
      appointments.push(newAppt);
      showToast('Agendamento criado!','success');
    }
    closeAppointmentModal(); renderAll();
  }catch(e){
    showToast('Erro: '+e.message,'error');
  }
}

function editAppointment(id){ openAppointmentModal(id); }

async function deleteAppointment(id){
  if(!confirm('Eliminar este agendamento?')) return;
  try{
    await window.apiClient.deleteAppointment(id);
    appointments=appointments.filter(a=>a.id!==id);
    showToast('Agendamento eliminado!','success');
    closeAppointmentModal(); renderAll();
  }catch(e){
    showToast('Erro ao eliminar: '+e.message,'error');
  }
}

// ---------- Status listeners ----------
function attachStatusListeners(){
  document.querySelectorAll('.appt-status input[type="checkbox"]').forEach(cb=>{
    cb.addEventListener('change',async e=>{
      if(!e.target.checked) return;
      const card=e.target.closest('.appointment');
      if(!card) return;
      const id=Number(card.getAttribute('data-id'));
      const status=e.target.getAttribute('data-status');
      if(!id||!status) return;
      card.querySelectorAll('.appt-status input[type="checkbox"]').forEach(x=>{
        if(x!==e.target) x.checked=false;
      });
      await persistStatus(id,status);
    });
  });
}

// ---------- Exportação ----------
function exportToJson(){
  const data=JSON.stringify(appointments,null,2);
  const blob=new Blob([data],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='agendamentos.json'; a.click();
  URL.revokeObjectURL(url);
}

function exportToCsv(){
  const headers=['Data','Período','Matrícula','Carro','Serviço','Localidade','Status','Observações','Extra'];
  const rows=appointments.map(a=>[
    a.date||'',a.period||'',a.plate||'',a.car||'',a.service||'',a.locality||'',a.status||'',a.notes||'',a.extra||''
  ]);
  const csv=[headers,...rows].map(row=>row.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='agendamentos.csv'; a.click();
  URL.revokeObjectURL(url);
}

async function importFromJson(file){
  try{
    const text=await file.text();
    const data=JSON.parse(text);
    if(!Array.isArray(data)){ showToast('Formato inválido','error'); return; }
    appointments=data.map(a=>({...a,id:a.id||Date.now()+Math.random(),sortIndex:a.sortIndex||1}));
    renderAll(); showToast('Dados importados!','success');
  }catch(e){
    showToast('Erro na importação: '+e.message,'error');
  }
}

// ---------- Estatísticas ----------
function showStats(){
  const modal=document.getElementById('statsModal'); if(!modal) return;
  const total=appointments.length;
  const scheduled=appointments.filter(a=>a.date&&a.period).length;
  const unscheduled=total-scheduled;
  const byStatus=appointments.reduce((acc,a)=>{acc[a.status]=(acc[a.status]||0)+1;return acc;},{});
  const byLocality=appointments.reduce((acc,a)=>{acc[a.locality]=(acc[a.locality]||0)+1;return acc;},{});

  document.getElementById('totalAppointments').textContent=total;
  document.getElementById('scheduledCount').textContent=scheduled;
  document.getElementById('unscheduledCount').textContent=unscheduled;

  const statusList=document.getElementById('statusBreakdown');
  statusList.innerHTML=Object.entries(byStatus).map(([s,c])=>`<li>${s}: ${c}</li>`).join('');

  const localityList=document.getElementById('localityBreakdown');
  localityList.innerHTML=Object.entries(byLocality).map(([l,c])=>`<li>${l}: ${c}</li>`).join('');

  modal.classList.add('show');
}

// ---------- Impressão ----------
function printPage(){
  updatePrintTodayTable(); updatePrintTomorrowTable();
  window.print();
}

// ===== INÍCIO DA CORREÇÃO =====
function updatePrintTodayTable(){
  const today=new Date(); const str=localISO(today);
  const list=appointments.filter(a=>a.date===str).sort((a,b)=>({Manhã:1,Tarde:2}[a.period]||3 - ({Manhã:1,Tarde:2}[b.period]||3)));
  const title=document.getElementById('printTodayTitle'); const dateEl=document.getElementById('printTodayDate');
  const tbody=document.getElementById('printTodayTableBody'); const empty=document.getElementById('printTodayEmpty'); const table=document.querySelector('.print-today-table');
  if(title) title.textContent='SERVIÇOS DE HOJE';
  if(dateEl) dateEl.textContent=cap(today.toLocaleDateString('pt-PT',{weekday:'long',year:'numeric',month:'long',day:'numeric'}));
  if(!tbody||!table||!empty) return;
  if(list.length===0){ table.style.display='none'; empty.style.display='block'; }
  else{
    table.style.display='table'; empty.style.display='none';
    tbody.innerHTML=list.map(a=>`
      <tr>
        <td>${a.period||''}</td><td>${a.plate||''}</td><td>${a.car||''}</td>
        <td><span class="service-badge badge-${a.service}">${a.service||''}</span></td>
        <td>${a.locality||''}</td><td><span class="status-chip chip-${a.status}">${a.status||''}</span></td>
        <td>${a.notes||''}</td>
        <td>${a.extra||''}</td>
      </tr>`).join('');
  }
}

function updatePrintTomorrowTable(){
  const t=new Date(); t.setDate(t.getDate()+1); const str=localISO(t);
  const list=appointments.filter(a=>a.date===str).sort((a,b)=>({Manhã:1,Tarde:2}[a.period]||3 - ({Manhã:1,Tarde:2}[b.period]||3)));
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
        <td>${a.period||''}</td><td>${a.
