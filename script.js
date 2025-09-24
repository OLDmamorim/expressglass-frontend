// Versão estabilizada com patches: IDs estáveis, DnD throttle, semana Seg-Sáb, impressão segura, etc.

// ==================
// SCRIPT PRINCIPAL
// ==================

// ===== BASES DE PARTIDA POR EQUIPA/LOJA =====
const BASES_PARTIDA = {
  SM_BRAGA: "Avenida Robert Smith 59, 4715-249 Braga",
};

// Por agora usamos sempre a base do SM Braga
let basePartidaDoDia = BASES_PARTIDA.SM_BRAGA;

// ---- Seletores ----
const fileInput  = document.getElementById('fileInput');
const btnUpload  = document.getElementById('btnUpload');

// Pega a API key que já está no script do Google Maps
function getGoogleApiKey() {
  const scripts = document.getElementsByTagName("script");
  for (let s of scripts) {
    if (s.src.includes("maps.googleapis.com/maps/api/js")) {
      const urlParams = new URLSearchParams(s.src.split("?")[1]);
      return urlParams.get("key");
    }
  }
  return null;
}

// ===== FUNÇÃO PARA CALCULAR DISTÂNCIA (versão Google JS API – sem CORS) =====
function getDistance(from, to) {
  return new Promise((resolve) => {
    try {
      if (!window.google || !google.maps || !google.maps.DistanceMatrixService) {
        console.warn("Google Maps JS API não carregada.");
        resolve(Infinity);
        return;
      }
      const svc = new google.maps.DistanceMatrixService();
      svc.getDistanceMatrix(
        {
          origins: [from],
          destinations: [to],
          travelMode: google.maps.TravelMode.DRIVING,
          unitSystem: google.maps.UnitSystem.METRIC,
        },
        (res, status) => {
          if (
            status === "OK" &&
            res?.rows?.[0]?.elements?.[0]?.status === "OK" &&
            res.rows[0].elements[0].distance?.value != null
          ) {
            resolve(res.rows[0].elements[0].distance.value); // metros
          } else {
            console.warn("DistanceMatrix falhou:", status, res?.rows?.[0]?.elements?.[0]?.status);
            resolve(Infinity);
          }
        }
      );
    } catch (err) {
      console.error("Erro a calcular distância:", err);
      resolve(Infinity);
    }
  });
}
  

// ===== NORMALIZAR CAMPO MORADA =====
// Usa 'address' se existir; senão tenta 'morada' (para compatibilidade com dados antigos)
function getAddressFromItem(item) {
  const addr = item.address?.trim?.() || item.morada?.trim?.() || "";
  if (addr) return addr;
  return item.locality ? `${item.locality}, Portugal` : "";
}

// ===== ORDENAR EM CADEIA: MAIS LONGE PRIMEIRO =====
// Recebe um array de agendamentos do dia e devolve NOVA lista ordenada
async function ordenarAgendamentosCadeiaMaisLongePrimeiro(agendamentos, origemInicial = basePartidaDoDia) {
  // Clonar para não mutar o array original
  const restantes = agendamentos.filter(a => getAddressFromItem(a));
  const resultado = [];
  let origem = origemInicial;

  while (restantes.length) {
    // calcular distâncias da 'origem' a todos os restantes (em paralelo)
    const distancias = await Promise.all(
      restantes.map(async (item) => {
        const to = getAddressFromItem(item);
        const d = await getDistance(origem, to);
        return { item, d };
      })
    );

    // escolher o MAIS LONGE (maior distância)
    distancias.sort((a, b) => b.d - a.d);
    const escolhido = distancias[0];

    // colocar no resultado e remover dos 'restantes'
    resultado.push({ ...escolhido.item, _kmFromPrev: Math.round(escolhido.d / 1000) });
    const idx = restantes.indexOf(escolhido.item);
    restantes.splice(idx, 1);

    // próxima origem passa a ser a morada do serviço escolhido
    origem = getAddressFromItem(escolhido.item);
  }

  return resultado;
}

// ===== CONTROLO (apenas staging, SM Braga) =====
const ORDER_ROUTE_SM_BRAGA = true;

// Ordena só os serviços com morada, mantendo os restantes no fim
async function ordenarSeNecessario(lista) {
  if (!ORDER_ROUTE_SM_BRAGA) return lista;

  // tenta detectar SM Braga (ajusta se usares outro campo para equipa)
  const comMorada = lista.filter(i => getAddressFromItem(i));
  if (!comMorada.length) return lista;

  const ordenados = await ordenarAgendamentosCadeiaMaisLongePrimeiro(comMorada, basePartidaDoDia);
  const idsOrdenados = new Set(ordenados.map(x => x.id));
  const restantes = lista.filter(i => !idsOrdenados.has(i.id));
  return [...ordenados, ...restantes];
}

// ---------- Configurações e dados ----------
const localityColors = {
  'Outra': '#9CA3AF', 'Barcelos': '#F87171', 'Braga': '#34D399', 'Esposende': '#22D3EE',
  'Famalicão': '#7E22CE', 'Guimarães': '#FACC15', 'Póvoa de Lanhoso': '#A78BFA',
  'Póvoa de Varzim': '#6EE7B7', "Riba D'Ave": '#FBBF24', 'Trofa': '#C084FC',
  'Vieira do Minho': '#93C5FD', 'Vila do Conde': '#1E3A8A', 'Vila Verde': '#86EFAC'
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
function bucketOf(a){ if(!a.date || !a.period) return 'unscheduled'; return `${a.date}|${a.period}`; }
function getBucketList(bucket){ return appointments.filter(x=>bucketOf(x)===bucket).sort((a,b)=>(a.sortIndex||0)-(b.sortIndex||0)); }
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

// ---------- Connection Badge ----------
function updateConnBadge(){
  const status = document.getElementById('connectionStatus');
  const icon = document.getElementById('statusIcon');
  const text = document.getElementById('statusText');
  
  if (!status || !icon || !text) return;
  
  const connStatus = window.apiClient?.getConnectionStatus() || { online: navigator.onLine };
  
  if (connStatus.online) {
    status.className = 'connection-status online';
    icon.textContent = '🌐';
    text.textContent = 'Online';
  } else {
    status.className = 'connection-status offline';
    icon.textContent = '📱';
    text.textContent = 'Offline';
  }
}

// ---------- API load ----------
async function load(){
  try{
    showToast('Carregando dados...','info');
   appointments = window.apiClient?.getAppointments
  ? await window.apiClient.getAppointments()
  : [];

    appointments.forEach(a => {
      if (a.date) {
        a.date = String(a.date).slice(0, 10); // fica só "YYYY-MM-DD"
      }
    });

    // IDs e ordem estáveis
    appointments.forEach(a=>{ if(!a.id) a.id=Date.now()+Math.random(); if(!a.sortIndex) a.sortIndex=1; });
    // 🔁 Normalização de morada (compatibilidade com dados antigos)
    appointments = appointments.map(a => ({
      ...a,
      address: a.address || a.morada || a.addr || null
    }));
    const locs=await window.apiClient.getLocalities();
    if(locs && typeof locs==='object'){ Object.assign(localityColors,locs); window.LOCALITY_COLORS=localityColors;
      for (const [k,v] of Object.entries(localityColors)) {
        if (!/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v)) localityColors[k] = '#3b82f6';
      }
    }
    const st=window.apiClient.getConnectionStatus();
    showToast(st.online?'Dados carregados da cloud!':'Dados carregados localmente (offline)', st.online?'success':'info');
  }catch(e){
    appointments=[]; showToast('Erro ao carregar dados: '+e.message,'error');
  } finally {
    updateConnBadge();
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
  document.querySelectorAll('.appointment').forEach(el=>el.classList.remove('highlight'));
  if(!searchQuery) return;
  document.querySelectorAll('.appointment').forEach(el=>{
    if(el.textContent.toLowerCase().includes(searchQuery.toLowerCase())) el.classList.add('highlight');
  });
}

// ---------- Persistência de STATUS (exclusivo) ----------
async function persistStatus(id, newStatus) {
  const idx = appointments.findIndex(a => String(a.id) === String(id));
  if (idx < 0) return;
  const valid = ['NE','VE','ST']; if(!valid.includes(newStatus)) return;
  const prev = appointments[idx].status;
  appointments[idx].status = newStatus; // exclusivo
  try {
    const payload = { ...appointments[idx], status: newStatus };
    const res = await window.apiClient.updateAppointment(id, payload);
    if (res && typeof res === 'object') appointments[idx] = { ...appointments[idx], ...res };
    showToast(`Status guardado: ${newStatus}`, 'success');
  } catch (err) {
    appointments[idx] = { ...appointments[idx], status: prev };
    showToast('Falha ao gravar status: ' + err.message, 'error');
  } finally {
    renderAll();
  }
}

// ---------- Status Listeners ----------
function attachStatusListeners(){
  document.querySelectorAll('.appt-status input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', async function(e) {
      if (!this.checked) return;
      
      const appointmentEl = this.closest('.appointment');
      const id = appointmentEl?.getAttribute('data-id');
      const newStatus = this.getAttribute('data-status');
      
      if (!id || !newStatus) return;
      
      // Desmarcar outros checkboxes do mesmo agendamento
      appointmentEl.querySelectorAll('.appt-status input[type="checkbox"]').forEach(cb => {
        if (cb !== this) cb.checked = false;
      });
      
      await persistStatus(id, newStatus);
    });
  });
}

// ---------- Drag & Drop (com persistência throttle) ----------
let persistQueue = [];
let persistTimer = null;

async function persistBuckets(buckets){
  const payload = [];
  for (const bucket of buckets){
    const list = getBucketList(bucket);
    for (const item of list) payload.push({ ...item });
  }
  persistQueue = payload;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(runPersistFlush, 350);
}

async function runPersistFlush(){
  const queue = [...persistQueue];
  persistQueue = [];
  try{
    for (const item of queue) {
      let ok=false, attempts=0;
      while(!ok && attempts<2){
        attempts++;
        try { await window.apiClient.updateAppointment(item.id, item); ok=true; }
        catch(e){ if(attempts>=2) throw e; }
      }
    }
    showToast('Alterações gravadas.', 'success');
  }catch(e){
    showToast('Falha a gravar alguns itens.', 'error');
  }
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
      const zone = e.target.closest('[data-drop-bucket]'); if(!zone) return;
      e.preventDefault(); zone.classList.add('drag-over');
    });
    document.addEventListener('dragleave', (e)=>{
      const zone = e.target.closest('[data-drop-bucket]'); if(zone) zone.classList.remove('drag-over');
    });
    document.addEventListener('drop', async (e)=>{
      const zone = e.target.closest('[data-drop-bucket]'); if(!zone) return;
      e.preventDefault(); zone.classList.remove('drag-over');
      const id    = e.dataTransfer.getData('text/plain');
      const bucket= zone.getAttribute('data-drop-bucket');
      const idxIn = zone.querySelectorAll('.appointment').length;
      await onDropAppointment(id, bucket, idxIn);
    });
    enableDragDrop._bound = true;
  }
}

async function onDropAppointment(id, targetBucket, targetIndex){
  const i = appointments.findIndex(a => String(a.id) === String(id));
  if (i < 0) return;
  const a = appointments[i];
  const oldBucket = bucketOf(a);

  if(targetBucket === 'unscheduled'){ a.date=null; a.period=null; }
  else { const [d,p] = targetBucket.split('|'); a.date=d; a.period=p||'Manhã'; }

  const dest = getBucketList(targetBucket).filter(x=>String(x.id)!==String(a.id));
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

// ===== FUNÇÕES DE EDIÇÃO E ELIMINAÇÃO =====

function editAppointment(id) {
  const appointment = appointments.find(a => String(a.id) === String(id));
  if (!appointment) {
    showToast('Agendamento não encontrado', 'error');
    return;
  }

  editingId = id;
  
  // Preencher formulário
  document.getElementById('appointmentDate').value = appointment.date || '';
  document.getElementById('appointmentPeriod').value = appointment.period || '';
  document.getElementById('appointmentPlate').value = appointment.plate || '';
  document.getElementById('appointmentCar').value = appointment.car || '';
  document.getElementById('appointmentService').value = appointment.service || '';
  document.getElementById('appointmentLocality').value = appointment.locality || '';
  document.getElementById('appointmentNotes').value = appointment.notes || '';
  document.getElementById('appointmentAddress').value = appointment.address || '';
  document.getElementById('appointmentPhone').value = appointment.phone || '';
  document.getElementById('appointmentExtra').value = appointment.extra || '';

  // Atualizar dropdown de localidade
  if (appointment.locality) {
    const selectedText = document.getElementById('selectedLocalityText');
    const selectedDot = document.getElementById('selectedLocalityDot');
    if (selectedText && selectedDot) {
      selectedText.textContent = appointment.locality;
      selectedDot.style.backgroundColor = getLocColor(appointment.locality);
    }
  }

  // Alterar modal para modo edição
  document.getElementById('modalTitle').textContent = 'Editar Agendamento';
  document.getElementById('deleteAppointment').classList.remove('hidden');
  document.getElementById('appointmentModal').classList.add('show');
}

async function deleteAppointment(id) {
  if (!confirm('Tem a certeza que pretende eliminar este agendamento?')) {
    return;
  }

  try {
    await window.apiClient.deleteAppointment(id);
    const index = appointments.findIndex(a => String(a.id) === String(id));
    if (index > -1) {
      appointments.splice(index, 1);
    }
    
    showToast('Agendamento eliminado com sucesso', 'success');
    renderAll();
    document.getElementById('appointmentModal').classList.remove('show');
    
  } catch (error) {
    showToast('Erro ao eliminar agendamento: ' + error.message, 'error');
  }
}

function cancelEdit() {
  editingId = null;
  document.getElementById('appointmentForm').reset();
  document.getElementById('modalTitle').textContent = 'Novo Agendamento';
  document.getElementById('deleteAppointment').classList.add('hidden');
  
  const selectedText = document.getElementById('selectedLocalityText');
  const selectedDot = document.getElementById('selectedLocalityDot');
  if (selectedText && selectedDot) {
    selectedText.textContent = 'Selecione a localidade';
    selectedDot.style.backgroundColor = '';
  }
  
  document.getElementById('appointmentModal').classList.remove('show');
}

// ---------- Render DESKTOP (cartões) ----------

// ===== KM helpers =====
function getKmValue(ag) {
  const v = ag.km ?? ag.kms ?? ag.kilometers ?? ag.kilometros ?? ag.quilometros ?? ag.kilómetros ?? ag.km_total ?? ag.distancia;
  if (v == null) return null;
  const n = String(v).match(/[\d,.]+/);
  if (!n) return null;
  const parsed = parseFloat(n[0].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function buildKmRow(ag) {
  const km = getKmValue(ag);
  if (km == null) return '';
  const kmFmt = Math.round(km);
  return `
    <div class="card-km" data-km-row>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 13l2-6a2 2 0 0 1 2-1h8a2 2 0 0 1 2 1l2 6" />
        <path d="M5 13h14" />
        <circle cx="7.5" cy="17" r="1.5" />
        <circle cx="16.5" cy="17" r="1.5" />
      </svg>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12h14" />
        <path d="M13 6l6 6-6 6" />
      </svg>
      <span>${kmFmt} km</span>
    </div>
  `;
}
function buildDesktopCard(a){
  const base = getLocColor(a.locality);
  const g = gradFromBase(base);
  const bar = statusBarColors[a.status] || '#999';
  const title = `${a.plate} | ${a.service} | ${(a.car||'').toUpperCase()}`;
  const sub   = [a.locality, a.notes].filter(Boolean).join(' | ');
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
      <div class="card-actions">
        <button class="icon edit" onclick="editAppointment('${a.id}')" title="Editar" aria-label="Editar">✏️</button>
        <button class="icon delete" onclick="deleteAppointment('${a.id}')" title="Eliminar" aria-label="Eliminar">🗑️</button>
      </div>
    ${buildKmRow(a)}</div>`;
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
                 .sort((a,b)=>(a.sortIndex||0)-(b.sortIndex||0))
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
    appointments.filter(a=>!a.date||!a.period).sort((x,y)=>(x.sortIndex||0)-(y.sortIndex||0))
  );
  const blocks = unscheduled.map(a=>{
    const base=getLocColor(a.locality);
    const g=gradFromBase(base);
    const bar=statusBarColors[a.status]||'#999';
    const title=`${a.plate} | ${a.service} | ${(a.car||'').toUpperCase()}`;
    const sub=[a.locality,a.notes].filter(Boolean).join(' | ');
    return `
      <div class="appointment desk-card unscheduled" data-id="${a.id}" draggable="true"
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
          <button class="icon edit" onclick="editAppointment('${a.id}')" title="Editar">✏️</button>
          <button class="icon delete" onclick="deleteAppointment('${a.id}')" title="Eliminar">🗑️</button>
        </div>
      </div>`;
  }).join('');
  container.innerHTML=`<div class="drop-zone" data-drop-bucket="unscheduled">${blocks}</div>`;
  enableDragDrop(); attachStatusListeners(); highlightSearchResults();
}

// ---------- Header da tabela ----------
function ensureServicesHeader(){
  const table = document.querySelector('.services-table'); if(!table) return;
  let thead = table.querySelector('thead'); if(!thead){ thead = document.createElement('thead'); table.prepend(thead); }
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
  const today = new Date(); today.setHours(0,0,0,0);
  const future = filterAppointments(
    appointments.filter(a => a.date && new Date(a.date) >= today)
               .sort((a,b) => new Date(a.date) - new Date(b.date))
  );
  tbody.innerHTML=future.map(a=>{
    const d=new Date(a.date); d.setHours(0,0,0,0);
    const diff=Math.ceil((d - today)/(1000*60*60*24));
    const when = diff<0? `${Math.abs(diff)} dias atrás` : diff===0? 'Hoje' : diff===1? 'Amanhã' : `${diff} dias`;
    const notes = (a.notes||'').replace(/"/g,'&quot;');
    return `<tr>
      <td>${d.toLocaleDateString('pt-PT')}</td>
      <td>${a.period||''}</td>
      <td>${a.plate||''}</td>
      <td>${a.car||''}</td>
      <td><span class="badge badge-${a.service}">${a.service||''}</span></td>
      <td>${a.locality||''}</td>
      <td title="${notes}">${a.notes||''}</td>
      <td><span class="chip chip-${a.status}">${a.status||''}</span></td>
      <td>${when}</td>
      <td class="no-print">
        <div class="actions">
          <button class="icon edit" onclick="editAppointment('${a.id}')" title="Editar" aria-label="Editar">✏️</button>
          <button class="icon delete" onclick="deleteAppointment('${a.id}')" title="Eliminar" aria-label="Eliminar">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
  const sum=document.getElementById('servicesSummary'); if(sum) sum.textContent=`${future.length} serviços pendentes`;
}

// Helper: tenta apanhar nº de telefone dentro de texto
function extractPhoneFromText(txt){
  if(!txt) return '';
  const m = String(txt).match(/(\+?\d[\d\s()-]{6,})/); // 9+ dígitos
  return m ? m[1].trim() : '';
}

// ---------- Render MOBILE (lista do dia) ----------
function buildMobileCard(a){
  // Ícones oficiais (fallback para emoji se falhar)
  const mapsBtn = a.address ? `
    <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.address)}"
       target="_blank" rel="noopener noreferrer" class="icon-btn" title="Abrir no Google Maps">
      <img src="https://cdn.simpleicons.org/googlemaps/ffffff" alt="Google Maps" width="18" height="18"
           onerror="this.src=''; this.parentElement.textContent='🌍';"/>
    </a>` : '';

  // Botão telefone (se houver número) — único e com classe para forçar branco
  // Botão telefone (agora com SVG inline branco)
const phone = a.phone || extractPhoneFromText(a.extra) || extractPhoneFromText(a.notes);
const telBtn = phone ? `
  <a href="tel:${phone.replace(/\s+/g,'')}" class="icon-btn" title="Telefonar" aria-label="Telefonar">
    <svg viewBox="0 0 24 24" width="18" height="18" role="img" aria-hidden="true">
      <path fill="#fff"
        d="M2.003 5.884l3.065-.611a1 1 0 011.023.51l1.5 2.598a1 1 0 01-.091 1.09l-1.2 1.6a12.044 12.044 0 005.516 5.516l1.6-1.2a1 1 0 011.09-.091l2.598 1.5a1 1 0 01.51 1.023l-.611 3.065A1 1 0 0114 21C7.94 21 3 16.06 3 10a1 1 0 01.815-.985z"/>
    </svg>
  </a>
` : '';

  const wazeBtn = a.address ? `
    <a href="https://waze.com/ul?q=${encodeURIComponent(a.address)}"
       target="_blank" rel="noopener noreferrer" class="icon-btn" title="Abrir no Waze">
      <img src="https://cdn.simpleicons.org/waze/ffffff" alt="Waze" width="18" height="18"
           onerror="this.src=''; this.parentElement.textContent='🗺️';"/>
    </a>` : '';

  const base = getLocColor(a.locality);
  const g = gradFromBase(base);
  const title = `${a.plate} • ${(a.car||'').toUpperCase()}`;
  const chips = [
    a.period ? `<span class="m-chip">${a.period}</span>` : '',
    a.service ? `<span class="m-chip">${a.service}</span>` : '',
    a.locality ? `<span class="m-chip">${a.locality}</span>` : ''
  ].join('');
  const notes = a.notes ? `<div class="m-info">${a.notes}</div>` : '';

  return `
    <div class="appointment m-card" data-id="${a.id}"
         style="--c1:${g.c1}; --c2:${g.c2}; position:relative;">
      <div class="map-icons">
        ${wazeBtn}${mapsBtn}${telBtn}
      </div>
      <div class="m-title">${title}</div>
      <div class="m-chips">${chips}</div>
      ${notes}
    ${buildKmRow(a)}</div>
  `;
}

// ===== [PATCH FINAL] — bootstrap + mobile render =====

// Lista (mobile) do dia — com ordenação por distância
async function renderMobileDay(){
  const list  = document.getElementById('mobileDayList');
  const label = document.getElementById('mobileDayLabel');
  if(!list || !label) return;

  const iso = localISO(currentMobileDay);
  const weekday = currentMobileDay.toLocaleDateString('pt-PT',{ weekday:'long' });
  const dm = currentMobileDay.toLocaleDateString('pt-PT',{ day:'2-digit', month:'2-digit' });
  label.textContent = `${cap(weekday)} • ${dm}`;

  // Itens do dia (base)
  const itemsRaw = filterAppointments(
    appointments
      .filter(a => a.date === iso)
      .sort((a,b)=> (a.period||'').localeCompare(b.period||'') || (a.sortIndex||0)-(b.sortIndex||0))
  );

  // Ordenação em cadeia (loja -> mais longe -> a partir do último)
  const items = await ordenarSeNecessario(itemsRaw);

  if(items.length === 0){
    list.innerHTML = `<div class="m-card" style="--c1:#9ca3af;--c2:#6b7280;">Sem serviços para este dia.</div>`;
    return;
  }

  const morning   = items.filter(a=>a.period==='Manhã').map(buildMobileCard).join('');
  const afternoon = items.filter(a=>a.period==='Tarde').map(buildMobileCard).join('');
  const others    = items.filter(a=>!a.period).map(buildMobileCard).join('');

  list.innerHTML = `
    ${morning? `<h4 style="margin:4px 0 6px 8px;">Manhã</h4>${morning}`:''}
    ${afternoon? `<h4 style="margin:12px 0 6px 8px;">Tarde</h4>${afternoon}`:''}
    ${others? `<h4 style="margin:12px 0 6px 8px;">Sem período</h4>${others}`:''}
  `;
  highlightSearchResults();
}

// Render global
function renderAll(){
  try { renderSchedule(); } catch(e){ console.error('Erro renderSchedule:', e); }
  try { renderUnscheduled(); } catch(e){ console.error('Erro renderUnscheduled:', e); }
  try { renderServicesTable(); } catch(e){ console.error('Erro renderServicesTable:', e); }
  try { renderMobileDay(); } catch(e){ console.error('Erro renderMobileDay:', e); }
}

// Bootstrap da app (carrega BD e desenha)
document.addEventListener('DOMContentLoaded', async ()=>{
  try { await load(); } catch(e){ console.error('load() falhou', e); }
  try { buildLocalityOptions?.(); } catch(e){}
  renderAll();

  // Navegação mínima (se existirem botões)
  document.getElementById('todayWeek')?.addEventListener('click', ()=>{ currentMonday = getMonday(new Date()); renderAll(); });
  document.getElementById('prevWeek')?.addEventListener('click', ()=>{ currentMonday = addDays(currentMonday, -7); renderAll(); });
  document.getElementById('nextWeek')?.addEventListener('click', ()=>{ currentMonday = addDays(currentMonday,  7); renderAll(); });

  document.getElementById('prevDay')?.addEventListener('click', ()=>{ currentMobileDay = addDays(currentMobileDay, -1); renderMobileDay(); });
  document.getElementById('todayDay')?.addEventListener('click', ()=>{ currentMobileDay = new Date(); currentMobileDay.setHours(0,0,0,0); renderMobileDay(); });
  document.getElementById('nextDay')?.addEventListener('click', ()=>{ currentMobileDay = addDays(currentMobileDay, 1); renderMobileDay(); });

  // Event listeners para edição
  document.getElementById('cancelForm')?.addEventListener('click', cancelEdit);
  document.getElementById('closeModal')?.addEventListener('click', cancelEdit);
  document.getElementById('deleteAppointment')?.addEventListener('click', function() {
    if (editingId) deleteAppointment(editingId);
  });

  // --- Novo Serviço (desktop) ---
  document.getElementById('addServiceBtn')?.addEventListener('click', () => {
    editingId = null;
    document.getElementById('appointmentForm').reset();
    document.getElementById('modalTitle').textContent = 'Novo Agendamento';
    document.getElementById('deleteAppointment').classList.add('hidden');

    // Reset dropdown da localidade
    const selectedText = document.getElementById('selectedLocalityText');
    const selectedDot = document.getElementById('selectedLocalityDot');
    if (selectedText && selectedDot) {
      selectedText.textContent = 'Selecione a localidade';
      selectedDot.style.backgroundColor = '';
    }

    document.getElementById('appointmentModal').classList.add('show');
  });

  // --- Novo Serviço (mobile) ---
  document.getElementById('addServiceMobile')?.addEventListener('click', () => {
    editingId = null;
    document.getElementById('appointmentForm').reset();
    document.getElementById('modalTitle').textContent = 'Novo Agendamento';
    document.getElementById('deleteAppointment').classList.add('hidden');

    const selectedText = document.getElementById('selectedLocalityText');
    const selectedDot = document.getElementById('selectedLocalityDot');
    if (selectedText && selectedDot) {
      selectedText.textContent = 'Selecione a localidade';
      selectedDot.style.backgroundColor = '';
    }

    document.getElementById('appointmentModal').classList.add('show');
  });
}); // 👈 FECHO DO DOMContentLoaded

// === PRINT: Preenche secções de impressão (Hoje, Amanhã, Por Agendar) ===
(function(){
  if (window.fillPrintFromAppointments) return; // evitar duplicar
  function toISO(d){
    if (!(d instanceof Date)) d = new Date(d);
    d.setHours(0,0,0,0);
    const z = new Date(d.getTime() - d.getTimezoneOffset()*60000);
    return z.toISOString().slice(0,10);
  }
  function cap(s){ return (s||'').toString().charAt(0).toUpperCase()+ (s||'').toString().slice(1); }
  function normPeriod(p){
    if(!p) return '';
    const t = String(p).toLowerCase();
    if (t.startsWith('m')) return 'Manhã';
    if (t.startsWith('t')) return 'Tarde';
    if (t.startsWith('n')) return 'Noite';
    if (t==='m') return 'Manhã';
    if (t==='t') return 'Tarde';
    if (t==='n') return 'Noite';
    return p;
  }
  function row(a){
    const periodo = normPeriod(a.period || a.time || '');
    const outros  = a.address || a.extra || '';
    return `<tr>
      <td>${periodo||''}</td>
      <td>${a.plate||''}</td>
      <td>${(a.car||'').toUpperCase()}</td>
      <td>${a.service||''}</td>
      <td>${a.locality||''}</td>
      <td>${a.status||''}</td>
      <td>${a.notes || a.extra || ''}</td>
      <td>${outros}</td>
    </tr>`;
  }
  function buildTable(title, dateLabel, list){
    const headDate = dateLabel ? `<div class="print-date">${dateLabel}</div>` : '';
    const empty = list.length===0 ? `<div class="print-empty">Sem registos</div>` : '';
    return `<section class="print-section">
      <h2 class="print-title">${title}</h2>
      ${headDate}
      <table class="print-table">
        <thead><tr>
          <th>Período</th><th>Matrícula</th><th>Modelo do Carro</th><th>Serviço</th><th>Localidade</th><th>Estado</th><th>Observações</th><th>Outros Dados</th>
        </tr></thead>
        <tbody>${list.map(row).join('')}</tbody>
      </table>
      ${empty}
    </section>`;
  }
  window.fillPrintFromAppointments = function(){
    try{
      const contOld = document.getElementById('print-container-temp');
      if (contOld) contOld.remove();
      const cont = document.createElement('div');
      cont.id = 'print-container-temp';
      document.body.appendChild(cont);

      const today = new Date(); today.setHours(0,0,0,0);
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);

      const isoToday = toISO(today);
      const isoTomorrow = toISO(tomorrow);

      const list = (Array.isArray(window.appointments)? window.appointments : []).slice();

      const unscheduled = list.filter(a => !a.date || !a.period)
                              .sort((a,b)=>(a.sortIndex||0)-(b.sortIndex||0));

      const todayList = list.filter(a => a.date === isoToday)
                            .sort((a,b)=> (a.period||'').localeCompare(b.period||'') || (a.sortIndex||0)-(b.sortIndex||0));

      const tomorrowList = list.filter(a => a.date === isoTomorrow)
                               .sort((a,b)=> (a.period||'').localeCompare(b.period||'') || (a.sortIndex||0)-(b.sortIndex||0));

      const dm = d => new Date(d).toLocaleDateString('pt-PT', { weekday:'long', day:'2-digit', month:'2-digit', year:'numeric' });
      const titleToday = `SERVIÇOS DE HOJE`;
      const titleTomorrow = `SERVIÇOS DE AMANHÃ`;
      const titleUnscheduled = `SERVIÇOS POR AGENDAR`;

      cont.innerHTML = [
        buildTable(titleToday, cap(dm(today)), todayList),
        buildTable(titleTomorrow, cap(dm(tomorrow)), tomorrowList),
        buildTable(titleUnscheduled, '', unscheduled),
      ].join('');

    }catch(e){
      console.error('fillPrintFromAppointments falhou:', e);
    }
  })();
// === Máscara da matrícula ===
(function initPlateMask(){
  const el = document.getElementById('appointmentPlate');
  if (!el) return;

  el.addEventListener('input', (e) => {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const parts = [raw.slice(0, 2), raw.slice(2, 4), raw.slice(4, 6)].filter(Boolean);
    e.target.value = parts.join('-');
  });

  el.addEventListener('blur', (e) => {
    const ok = /^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$/.test(e.target.value);
    e.target.setCustomValidity(ok ? '' : 'Use o formato XX-XX-XX');
  });
  })();
// === Autocomplete de Morada (Google Places) ===
(function initAddressAutocomplete(){
  const input = document.getElementById('appointmentAddress');
  if (!input) return;

  function setup() {
    if (!(window.google && google.maps && google.maps.places)) {
      console.warn('Google Places API ainda não disponível.');
      return;
    }
    const ac = new google.maps.places.Autocomplete(input, {
      types: ['geocode'],
      componentRestrictions: { country: 'pt' }
    });

    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (place && place.formatted_address) {
        input.value = place.formatted_address;
      }
    });

    window._addressAutocomplete = ac; // debug
  }

  if (document.readyState === 'complete') {
    setup();
  } else {
    window.addEventListener('load', setup);
  }
})();

