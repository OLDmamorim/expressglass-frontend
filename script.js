// ===== Portal de Agendamento — NOVO SERVIÇO funcional =====
// - Botão visível e fixo no header da secção "SERVIÇOS"
// - Botão flutuante no mobile (redundância)
// - Modal com formulário, validação e submissão
// - POST para API Netlify (se existir) com fallback para LocalStorage
// - Render da lista de serviços

(() => {
  const API = '/.netlify/functions/appointments'; // tenta usar; se não existir, fallback LS
  const LS_KEY = 'eg_servicos_cache_v1';

  // ------ Helpers ------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const todayISO = () => new Date().toISOString().slice(0,10);
  const pad = (n) => String(n).padStart(2, '0');

  function toast(msg, type = 'ok') {
    // Usa a notice acima do header se existir; senão, cria temporária
    let holder = document.querySelector('.container header .notice');
    if (!holder) {
      holder = document.createElement('div');
      holder.className = 'notice';
      document.querySelector('.container header').appendChild(holder);
    }
    holder.className = `notice ${type === 'ok' ? 'ok' : 'err'}`;
    holder.textContent = msg;
    setTimeout(() => { holder.className = 'notice'; }, 2500);
  }

  function localGet() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
  }
  function localSet(arr) {
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
  }

  async function apiAvailable() {
    // tentativa head/GET com timeout curto
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2000);
      const r = await fetch(API, { method: 'GET', signal: ctl.signal });
      clearTimeout(t);
      return r.ok;
    } catch {
      return false;
    }
  }

  // ------ UI refs ------
  const btnNovo = $('#novoServicoBtn');
  const btnRefresh = $('#refreshBtn');
  const fabNovo = $('#fabNovo');

  const modal = $('#modalBackdrop');
  const fecharModalBtn = $('#fecharModal');
  const cancelarBtn = $('#cancelar');
  const form = $('#formServico');

  const tbody = $('#servicos-tbody');
  const listaVazia = $('#lista-vazia');

  // Pré-preenche data/hora
  function prefillForm() {
    $('#data').value = todayISO();
    const now = new Date();
    $('#hora').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    $('#cliente').focus();
  }

  function openModal() {
    prefillForm();
    modal.style.display = 'flex';
  }
  function closeModal() {
    modal.style.display = 'none';
    form.reset();
  }

  // Outside click fecha modal
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Botões que abrem/fecham
  btnNovo?.addEventListener('click', openModal);
  fabNovo?.addEventListener('click', openModal);
  fecharModalBtn?.addEventListener('click', closeModal);
  cancelarBtn?.addEventListener('click', closeModal);

  // ------ Render da lista ------
  function estadoChip(estado) {
    const mapBg = { NE: 'estado-NE', VE: 'estado-VE', ST:'estado-ST' };
    const cls = mapBg[estado] || '';
    const dotColor = estado === 'NE' ? '#ef4444' : estado === 'VE' ? '#16a34a' : '#3b82f6';
    return `<span class="chip ${cls}"><span class="chip-dot" style="background:${dotColor}"></span>${estado}</span>`;
  }

  function renderLista(items) {
    tbody.innerHTML = '';
    if (!items?.length) {
      listaVazia.style.display = 'block';
      return;
    }
    listaVazia.style.display = 'none';

    // Ordena por data/hora asc
    items.sort((a,b) => {
      const ad = `${a.data} ${a.hora}`; const bd = `${b.data} ${b.hora}`;
      return ad.localeCompare(bd);
    });

    const rows = items.map(i => `
      <tr>
        <td>${i.data || ''}</td>
        <td>${i.hora || ''}</td>
        <td>${i.cliente || ''}</td>
        <td>${i.matricula || ''}</td>
        <td>${i.localidade || ''}</td>
        <td>${i.tipo || ''}</td>
        <td>${estadoChip(i.estado || 'NE')}</td>
        <td>${(i.obs || '').replace(/\n/g,'<br>')}</td>
      </tr>
    `).join('');
    tbody.innerHTML = rows;
  }

  // ------ Load inicial ------
  async function carregarLista() {
    // Primeiro tenta API; se não, LS
    const hasAPI = await apiAvailable();
    if (hasAPI) {
      try {
        const r = await fetch(API);
        if (r.ok) {
          const data = await r.json(); // espera array de objetos
          renderLista(Array.isArray(data) ? data : (data?.items || []));
          return;
        }
      } catch (e) {
        // cai para LS
      }
    }
    // fallback
    renderLista(localGet());
  }

  btnRefresh?.addEventListener('click', carregarLista);

  // ------ Submissão do formulário ------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      data: $('#data').value,
      hora: $('#hora').value,
      cliente: $('#cliente').value.trim(),
      matricula: $('#matricula').value.trim().toUpperCase(),
      localidade: $('#localidade').value,
      tipo: $('#tipo').value,
      estado: $('#estado').value,
      obs: $('#obs').value.trim()
    };

    // Validações simples
    if (!payload.data || !payload.hora || !payload.cliente || !payload.matricula || !payload.localidade) {
      toast('Preenche os campos obrigatórios.', 'err');
      return;
    }

    // Primeiro tenta API
    let gravadoNaAPI = false;
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'create', item: payload })
      });
      if (r.ok) {
        gravadoNaAPI = true;
      }
    } catch {
      // ignora, vai para LS
    }

    if (!gravadoNaAPI) {
      // Guarda também localmente
      const atual = localGet();
      atual.push(payload);
      localSet(atual);
    }

    // Atualiza UI
    closeModal();
    toast('Serviço guardado com sucesso.');
    carregarLista();
  });

  // ------ Arranque ------
  document.addEventListener('DOMContentLoaded', () => {
    // Garantia: botão está no header certo
    const header = document.getElementById('servicos-header');
    const btn = document.getElementById('novoServicoBtn');
    if (header && btn && btn.parentElement !== header.querySelector('.actions')) {
      header.querySelector('.actions')?.appendChild(btn);
    }
    carregarLista();
  });
})();
/* ===== [DROP-IN] NOVO SERVIÇO — cola no FIM do teu script.js ===== */
(() => {
  const API = '/.netlify/functions/appointments';
  const LS_KEY = 'eg_servicos_cache_v1';

  // ---- CSS isolado (injetado, sem mexer no teu ficheiro de estilos) ----
  const css = `
    .eg-btn{appearance:none;border:0;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;
      background:#2563eb;color:#fff;transition:.15s transform}
    .eg-btn:hover{transform:translateY(-1px)}
    .eg-btn.secondary{background:#11182714;color:#111827;border:1px solid #e5e7eb}
    .eg-fab{position:fixed;right:16px;bottom:16px;border-radius:999px;width:56px;height:56px;
      display:flex;align-items:center;justify-content:center;background:#2563eb;color:#fff;font-size:28px;
      border:none;box-shadow:0 8px 16px rgba(0,0,0,.18);z-index:99998}
    .eg-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.44);display:none;
      align-items:center;justify-content:center;padding:16px;z-index:99999}
    .eg-modal{width:100%;max-width:640px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden}
    .eg-modal-header{padding:14px 16px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center}
    .eg-modal-title{margin:0;font-size:18px}
    .eg-modal-body{padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .eg-full{grid-column:1/-1}
    .eg-modal label{display:block;font-size:12px;color:#374151;margin-bottom:6px}
    .eg-modal input,.eg-modal select,.eg-modal textarea{
      width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;font-size:14px}
    .eg-modal textarea{min-height:80px;resize:vertical}
    .eg-modal-footer{padding:12px 16px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px;background:#fafafa}
    @media (max-width:800px){.eg-modal-body{grid-template-columns:1fr}}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ---- Utils ----
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const pad = n => String(n).padStart(2,'0');
  const todayISO = () => new Date().toISOString().slice(0,10);
  function toast(msg, type='ok'){
    let el = document.getElementById('eg-toast');
    if(!el){ el = Object.assign(document.createElement('div'), { id:'eg-toast' });
      el.style.cssText='position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:10px 14px;border-radius:8px;z-index:999999;box-shadow:0 2px 10px rgba(0,0,0,.2)';
      document.body.appendChild(el);
    }
    el.textContent=msg; el.style.background = (type==='ok')?'#111827':'#b91c1c'; el.style.display='block';
    clearTimeout(el._t); el._t=setTimeout(()=>el.style.display='none',2200);
  }
  const localGet = ()=>{ try{return JSON.parse(localStorage.getItem(LS_KEY)||'[]');}catch{return[]} };
  const localSet = (a)=>localStorage.setItem(LS_KEY, JSON.stringify(a));
  async function apiAvailable(){
    try{ const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),1500);
      const r=await fetch(API,{method:'GET',signal:ctl.signal}); clearTimeout(t); return r.ok;
    }catch{return false;}
  }

  // ---- Onde colocar o botão (sem mexer no HTML) ----
  function findAnchor(){
    const candidates = [
      '#servicos-header .actions','.servicos-header .actions','.acoes-servicos','.header-servicos .actions'
    ].map(sel=>$(sel)).filter(Boolean);
    if (candidates[0]) return { el:candidates[0], mode:'append' };
    const heads = $$('h1,h2,h3').filter(h => /SERVI(C|Ç)O(S)?/i.test(h.textContent) || /HOJE|AMANH(Ã|A)/i.test(h.textContent));
    if (heads[0]) return { el:heads[0].parentElement||heads[0], mode:'prepend' };
    return null; // se nada, fica só o FAB
  }

  function mountButtons(){
    // Botão principal
    const btn = document.createElement('button');
    btn.id='eg-novo-btn'; btn.type='button'; btn.className='eg-btn'; btn.textContent='+ Novo Serviço';
    btn.addEventListener('click', onNovoClick);
    const anchor = findAnchor();
    if (anchor){ anchor.mode==='append' ? anchor.el.appendChild(btn) : anchor.el.insertBefore(btn, anchor.el.firstChild); }

    // FAB (redundância; se não quiseres, comenta este bloco)
    const fab = document.createElement('button');
    fab.className='eg-fab'; fab.setAttribute('aria-label','Novo Serviço'); fab.textContent='＋';
    fab.addEventListener('click', onNovoClick);
    document.body.appendChild(fab);
  }

  // ---- Modal próprio (só se não existir a tua função abrirFormulario) ----
  function ensureModal(){
    if($('#eg-modal-backdrop')) return;
    const back = document.createElement('div');
    back.id='eg-modal-backdrop'; back.className='eg-modal-backdrop';
    back.innerHTML = `
      <div class="eg-modal">
        <div class="eg-modal-header">
          <h3 class="eg-modal-title">Novo Serviço</h3>
          <button type="button" class="eg-btn secondary" id="eg-close">Fechar</button>
        </div>
        <form id="eg-form" class="eg-modal">
          <div class="eg-modal-body">
            <div><label>Data</label><input type="date" id="eg-data" required></div>
            <div><label>Hora</label><input type="time" id="eg-hora" required></div>
            <div><label>Cliente</label><input type="text" id="eg-cliente" required placeholder="Nome do cliente"></div>
            <div><label>Matrícula</label><input type="text" id="eg-matricula" required placeholder="AA-00-00"></div>
            <div><label>Localidade</label>
              <select id="eg-localidade" required>
                <option disabled selected value="">— escolher —</option>
                <option>Barcelos</option><option>Braga</option><option>Famalicão</option>
                <option>Guimarães</option><option>Póvoa de Varzim</option><option>Viana do Castelo</option>
                <option>Vila Verde</option><option>Outra</option>
              </select>
            </div>
            <div><label>Tipo</label>
              <select id="eg-tipo" required>
                <option>Reparação</option><option>Substituição</option><option>Calibração ADAS</option>
              </select>
            </div>
            <div><label>Estado</label>
              <select id="eg-estado" required>
                <option value="NE">NE (Não Entregue)</option>
                <option value="VE">VE (Vidro Entregue)</option>
                <option value="ST">ST (Stand-by)</option>
              </select>
            </div>
            <div class="eg-full"><label>Observações</label><textarea id="eg-obs" placeholder="Notas..."></textarea></div>
          </div>
          <div class="eg-modal-footer">
            <button type="button" class="eg-btn secondary" id="eg-cancel">Cancelar</button>
            <button type="submit" class="eg-btn">Guardar</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(back);
    $('#eg-close').addEventListener('click', closeModal);
    $('#eg-cancel').addEventListener('click', closeModal);
    back.addEventListener('click', (e)=>{ if(e.target===back) closeModal(); });
    document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeModal(); });
    $('#eg-form').addEventListener('submit', onSubmitFallback);
  }
  function openModal(){
    ensureModal();
    $('#eg-data').value = todayISO();
    const n=new Date(); $('#eg-hora').value=`${pad(n.getHours())}:${pad(n.getMinutes())}`;
    $('#eg-cliente').focus();
    $('#eg-modal-backdrop').style.display='flex';
  }
  function closeModal(){ const b=$('#eg-modal-backdrop'); if(b) b.style.display='none'; }

  // ---- Ação do botão ----
  function onNovoClick(){
    if (typeof window.abrirFormulario === 'function') { try{ window.abrirFormulario(); return; }catch{} }
    if (typeof window.openNovoServico === 'function') { try{ window.openNovoServico(); return; }catch{} }
    openModal(); // fallback
  }

  // ---- Submissão (fallback com API + LocalStorage) ----
  async function onSubmitFallback(e){
    e.preventDefault();
    const item = {
      data: $('#eg-data').value, hora: $('#eg-hora').value,
      cliente: $('#eg-cliente').value.trim(),
      matricula: $('#eg-matricula').value.trim().toUpperCase(),
      localidade: $('#eg-localidade').value,
      tipo: $('#eg-tipo').value,
      estado: $('#eg-estado').value,
      obs: $('#eg-obs').value.trim()
    };
    if (!item.data || !item.hora || !item.cliente || !item.matricula || !item.localidade){
      toast('Preenche os campos obrigatórios.', 'err'); return;
    }
    let okAPI=false;
    try{
      if (await apiAvailable()){
        const r = await fetch(API, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ action:'create', item })
        });
        okAPI = r.ok;
      }
    }catch{}
    if(!okAPI){ const arr=localGet(); arr.push(item); localSet(arr); }
    toast('Serviço guardado.');
    closeModal();
    if (typeof window.carregarLista === 'function') window.carregarLista();
  }

  // ---- Start ----
  document.addEventListener('DOMContentLoaded', mountButtons);
})();