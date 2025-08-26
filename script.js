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
