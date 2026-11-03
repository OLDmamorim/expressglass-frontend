// stock-report.js - v2
// Botão "📦 Stock" nos cartões do agendamento (todas as agendas, menos a
// Recalibra): abre um modal para reportar um
// problema com o vidro — errado, danificado, com defeito ou partido — com o
// Eurocode do serviço já preenchido, observações e fotografia. O reporte vai
// para o PoweringEG, para o menu Stock do Portal da loja PRINCIPAL do SM
// (Braga SM → Braga, Viana do Castelo SM → Viana): lá a loja e o gestor
// recebem logo um email, e lembretes até alguém marcar como tratado.
//
// No topo da agenda, o botão "📋 Stock" mostra os reportes deste portal e o
// estado de cada um (por tratar / tratado), com um filtro.
// A ligação ao PoweringEG é feita pela função stock-reports (portal → loja).

(function () {
  var PROBLEMAS = [
    { id: 'errado', nome: 'Errado' },
    { id: 'danificado', nome: 'Danificado' },
    { id: 'defeito', nome: 'Com defeito' },
    { id: 'partido', nome: 'Partido' },
  ];

  // ---- puro (testado em tests/stock-report.test.js) ----

  function nomeProblema(id) {
    var p = PROBLEMAS.find(function (x) { return x.id === id; });
    return p ? p.nome : String(id || '');
  }

  // Os Eurocodes do serviço: a agenda pode ter vários ("8547AGN;8547ASMS")
  // e o asterisco do fornecedor (*3595LYPR5RQZ).
  function eurocodesDoServico(texto) {
    var vistos = {};
    return String(texto || '')
      .split(/[;,|/\n]+/)
      .map(function (s) { return s.replace(/^[\s*#•:]+/, '').toUpperCase().replace(/[\s.\-_]+/g, ''); })
      .filter(function (s) {
        if (!/^\d[A-Z0-9]{3,29}$/.test(s) || vistos[s]) return false;
        vistos[s] = true;
        return true;
      });
  }

  // O estado do serviço no Stock: o reporte mais recente desse agendamento.
  function estadoDoServico(reportes, appointmentId) {
    var doServico = (reportes || []).filter(function (r) { return String(r.agendaServicoId) === String(appointmentId); });
    if (!doServico.length) return null;
    if (doServico.some(function (r) { return r.estado === 'pendente'; })) return 'pendente';
    return 'tratado';
  }

  function filtrar(reportes, filtro) {
    return (reportes || []).filter(function (r) {
      if (filtro === 'todos') return true;
      return filtro === 'pendente' ? r.estado === 'pendente' : r.estado !== 'pendente';
    });
  }

  var api = { PROBLEMAS: PROBLEMAS, nomeProblema: nomeProblema, eurocodesDoServico: eurocodesDoServico, estadoDoServico: estadoDoServico, filtrar: filtrar };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // ---- browser ----

  var _porPortal = {};      // portalId → { ligado: bool, reportes: [] }
  var _aCarregar = {};
  var _alvo = null;         // o agendamento do modal
  var _foto = null;         // { base64, mimeType, preview }
  var _filtro = 'pendente';

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getActivePortalId() {
    var sel = document.getElementById('portalSwitcherSelect');
    if (sel && sel.value) return sel.value;
    if (window.portalConfig && window.portalConfig.id) return window.portalConfig.id;
    var u = window.authClient && window.authClient.getUser && window.authClient.getUser();
    return window.currentPortalId || (u && u.portal_id) || null;
  }

  // Todas as agendas (SM, pesados e lojas); a Recalibra não trabalha com vidro.
  // Numa loja, o reporte fica no Portal da própria loja.
  function portalUsaStock() {
    var t = window.portalConfig && window.portalConfig.portalType;
    return t !== 'recalibra';
  }

  function toast(msg, tipo) {
    if (typeof window.showToast === 'function') window.showToast(msg, tipo || 'info');
    else alert(msg);
  }

  async function carregar(portalId, forcar) {
    if (!portalId || _aCarregar[portalId]) return;
    if (!forcar && _porPortal[portalId]) return;
    if (!(window.authClient && window.authClient.authenticatedFetch)) return;
    _aCarregar[portalId] = true;
    try {
      var r = await window.authClient.authenticatedFetch('/.netlify/functions/stock-reports?portal_id=' + encodeURIComponent(portalId));
      var d = await r.json();
      if (d && d.success) _porPortal[portalId] = { ligado: true, reportes: d.reportes || [] };
      else if (d && d.reason === 'sem_portal') _porPortal[portalId] = { ligado: false, reportes: [] };
      // Outro erro (PoweringEG em baixo…): sem botão até à próxima volta de 2 minutos
      else if (!_porPortal[portalId]) _porPortal[portalId] = { ligado: false, reportes: [] };
    } catch (e) {
      console.warn('[Stock] Não foi possível ler os reportes:', e.message);
      if (!_porPortal[portalId]) _porPortal[portalId] = { ligado: false, reportes: [] };
    } finally {
      delete _aCarregar[portalId];
      atualizarTudo();
    }
  }

  function dadosDoPortal() {
    var pid = getActivePortalId();
    return pid ? _porPortal[pid] : null;
  }

  // ── Estilos e modais ─────────────────────────────────────────────────────
  function garantirEstilo() {
    if (document.getElementById('stockReportStyle')) return;
    var st = document.createElement('style');
    st.id = 'stockReportStyle';
    st.textContent = [
      // O botão no cartão, no lugar e com o formato do antigo "Venda compl."
      // Em destaque sobre o cartão colorido: branco, letra azul-marinho e sombra
      '.desk-card .sr-card-btn,.m-card .sr-card-btn,.sr-card-btn{display:inline-flex;align-items:center;gap:6px;background:#fff;border:2px solid #fff;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:800;letter-spacing:.2px;cursor:pointer;color:#0b2d64!important;-webkit-text-fill-color:#0b2d64!important;font-family:inherit;box-shadow:0 2px 8px rgba(0,0,0,.25);}',
      '.desk-card .sr-card-btn:hover,.m-card .sr-card-btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.3);}',
      '.desk-card .sr-card-btn.sr-pendente,.m-card .sr-card-btn.sr-pendente{background:#f59e0b;border-color:#fff;color:#fff!important;-webkit-text-fill-color:#fff!important;}',
      '.desk-card .sr-card-btn.sr-tratado,.m-card .sr-card-btn.sr-tratado{background:#059669;border-color:#fff;color:#fff!important;-webkit-text-fill-color:#fff!important;}',
      '.sr-overlay{display:none;position:fixed;inset:0;z-index:9999;background:rgba(7,30,69,.55);align-items:center;justify-content:center;padding:12px;}',
      '.sr-overlay.open{display:flex;}',
      '.sr-modal{background:#fff;border-radius:10px;max-width:460px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:Figtree,system-ui,sans-serif;color:#1f2a3d;}',
      '.sr-modal header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #e3e8ef;border-top:4px solid #0b2d64;border-radius:10px 10px 0 0;}',
      '.sr-modal h3{margin:0;font-size:17px;font-weight:700;color:#0b2d64;font-family:Poppins,Figtree,sans-serif;}',
      '.sr-close{background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;}',
      '.sr-body{padding:16px 18px;display:flex;flex-direction:column;gap:12px;}',
      '.sr-label{font-size:13px;font-weight:600;display:block;margin-bottom:6px;}',
      '.sr-input,.sr-text{width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid #d6dde7;border-radius:6px;font-size:15px;font-family:inherit;}',
      '.sr-input{font-weight:700;letter-spacing:1px;text-transform:uppercase;}',
      '.sr-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}',
      '.sr-chip{border:1.5px solid #d6dde7;background:#fff;border-radius:6px;padding:6px 10px;font-size:13px;font-weight:700;cursor:pointer;}',
      '.sr-chip.on{background:#0b2d64;border-color:#0b2d64;color:#fff;}',
      '.sr-problemas{display:grid;grid-template-columns:1fr 1fr;gap:8px;}',
      '.sr-prob{border:2px solid #e3e8ef;background:#fff;border-radius:8px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;color:#1f2a3d;}',
      '.sr-prob.on{border-color:#dc2626;background:#fef2f2;color:#b91c1c;}',
      '.sr-foto-btn{border:1.5px dashed #9db3d9;background:#f4f6f9;border-radius:8px;padding:12px;font-size:14px;font-weight:600;cursor:pointer;color:#0b2d64;}',
      '.sr-preview{max-height:160px;width:100%;object-fit:contain;border-radius:6px;border:1px solid #e3e8ef;background:#f4f6f9;}',
      '.sr-enviar{background:#0b2d64;color:#fff;border:none;border-radius:6px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;}',
      '.sr-enviar:disabled{opacity:.5;cursor:not-allowed;}',
      '.sr-nota{font-size:12px;color:#5d6b80;margin:0;}',
      '.sr-filtros{display:flex;gap:6px;flex-wrap:wrap;}',
      '.sr-item{border:1px solid #e3e8ef;border-radius:8px;padding:10px 12px;}',
      '.sr-item.tratado{background:#f4f6f9;}',
      '.sr-tag{display:inline-block;font-size:11px;font-weight:800;border-radius:999px;padding:2px 8px;margin-right:6px;}',
      '.sr-tag.prob{background:#fee2e2;color:#b91c1c;}',
      '.sr-tag.pendente{background:#fef3c7;color:#92400e;}',
      '.sr-tag.tratado{background:#dcfce7;color:#166534;}',
      '#stockListBtn{position:relative;}',
      '#stockListBtn .sr-badge{position:absolute;top:-6px;right:-6px;background:#e1251b;color:#fff;border-radius:999px;font-size:11px;font-weight:800;min-width:18px;height:18px;line-height:18px;padding:0 4px;text-align:center;}',
      '@media (max-width:600px){#stockListBtn .sr-label-txt{display:none}}',
    ].join('\n');
    document.head.appendChild(st);
  }

  function garantirModais() {
    if (document.getElementById('srReportModal')) return;
    garantirEstilo();
    document.body.insertAdjacentHTML('beforeend',
      '<div class="sr-overlay" id="srReportModal" onclick="if(event.target===this)window._srFechar()">' +
      '  <div class="sr-modal" role="dialog" aria-modal="true" aria-labelledby="srTitulo">' +
      '    <header><h3 id="srTitulo">📦 Stock — problema com o vidro</h3><button class="sr-close" onclick="window._srFechar()" aria-label="Fechar">×</button></header>' +
      '    <div class="sr-body">' +
      '      <p class="sr-nota" id="srServico"></p>' +
      '      <div><label class="sr-label" for="srEurocode">Eurocode</label><input id="srEurocode" class="sr-input" autocomplete="off" placeholder="Ex.: 2488AGNMVZ1R"><div class="sr-chips" id="srEurocodes"></div></div>' +
      '      <div><span class="sr-label">Problema</span><div class="sr-problemas" id="srProblemas"></div></div>' +
      '      <div><label class="sr-label" for="srObs">Observações <span style="font-weight:400;color:#5d6b80">(opcional)</span></label><textarea id="srObs" class="sr-text" rows="2" placeholder="Ex.: chegou com um risco no canto"></textarea></div>' +
      '      <div><input type="file" id="srFotoInput" accept="image/*" capture="environment" style="display:none">' +
      '        <button type="button" class="sr-foto-btn" style="width:100%" onclick="document.getElementById(\'srFotoInput\').click()">📷 Tirar / anexar fotografia <span style="font-weight:400">(opcional)</span></button>' +
      '        <img id="srPreview" class="sr-preview" style="display:none;margin-top:8px" alt="Fotografia do vidro"></div>' +
      '      <button type="button" class="sr-enviar" id="srEnviar" onclick="window._srEnviar()">Reportar ao Stock da loja</button>' +
      '      <p class="sr-nota">Vai para o menu Stock do Portal da loja. A loja e o gestor recebem logo um email e lembretes até ficar tratado.</p>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div class="sr-overlay" id="srListModal" onclick="if(event.target===this)window._srFecharLista()">' +
      '  <div class="sr-modal" role="dialog" aria-modal="true" aria-labelledby="srListaTitulo">' +
      '    <header><h3 id="srListaTitulo">📋 Reportes de stock</h3><button class="sr-close" onclick="window._srFecharLista()" aria-label="Fechar">×</button></header>' +
      '    <div class="sr-body"><div class="sr-filtros" id="srFiltros"></div><div id="srLista" style="display:flex;flex-direction:column;gap:8px"></div></div>' +
      '  </div>' +
      '</div>');

    document.getElementById('srProblemas').innerHTML = PROBLEMAS.map(function (p) {
      return '<button type="button" class="sr-prob" data-prob="' + p.id + '">' + esc(p.nome) + '</button>';
    }).join('');
    document.getElementById('srProblemas').addEventListener('click', function (e) {
      var b = e.target.closest('[data-prob]');
      if (!b) return;
      document.querySelectorAll('#srProblemas .sr-prob').forEach(function (x) { x.classList.toggle('on', x === b); });
      validar();
    });
    document.getElementById('srEurocode').addEventListener('input', validar);
    document.getElementById('srFotoInput').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) prepararFoto(f);
    });
  }

  function problemaEscolhido() {
    var b = document.querySelector('#srProblemas .sr-prob.on');
    return b ? b.getAttribute('data-prob') : null;
  }

  function validar() {
    var ok = eurocodesDoServico(document.getElementById('srEurocode').value).length > 0 && !!problemaEscolhido();
    document.getElementById('srEnviar').disabled = !ok;
  }

  // Reduz a fotografia (lado maior 1600px, JPEG) antes de a enviar.
  function prepararFoto(ficheiro) {
    var leitor = new FileReader();
    leitor.onload = function () {
      var img = new Image();
      img.onload = function () {
        var escala = Math.min(1, 1600 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * escala);
        c.height = Math.round(img.height * escala);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var jpeg = c.toDataURL('image/jpeg', 0.85);
        _foto = { base64: jpeg.split(',')[1], mimeType: 'image/jpeg', preview: jpeg };
        var p = document.getElementById('srPreview');
        p.src = jpeg; p.style.display = '';
      };
      img.onerror = function () { toast('Não foi possível usar a fotografia.', 'error'); };
      img.src = String(leitor.result);
    };
    leitor.readAsDataURL(ficheiro);
  }

  function eurocodeDoAgendamento(a) {
    var raw = a.glass_eurocode || '';
    if (!raw && a.extra) {
      try { var p = typeof a.extra === 'string' ? JSON.parse(a.extra) : a.extra; raw = (p && typeof p === 'object') ? (p.eurocode || '') : String(p || ''); }
      catch (e) { raw = String(a.extra || ''); }
    }
    return window.cleanEurocode ? window.cleanEurocode(raw) : raw;
  }

  window._srAbrir = function (id) {
    garantirModais();
    var a = (window.appointments || []).find(function (x) { return String(x.id) === String(id); });
    if (!a) return;
    _alvo = a;
    _foto = null;
    var codigos = eurocodesDoServico(eurocodeDoAgendamento(a));
    var input = document.getElementById('srEurocode');
    input.value = codigos[0] || '';
    document.getElementById('srEurocodes').innerHTML = codigos.length > 1 ? codigos.map(function (c, i) {
      return '<button type="button" class="sr-chip' + (i === 0 ? ' on' : '') + '" data-ec="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('') : '';
    document.querySelectorAll('#srEurocodes .sr-chip').forEach(function (b) {
      b.onclick = function () {
        input.value = b.getAttribute('data-ec');
        document.querySelectorAll('#srEurocodes .sr-chip').forEach(function (x) { x.classList.toggle('on', x === b); });
        validar();
      };
    });
    document.querySelectorAll('#srProblemas .sr-prob').forEach(function (x) { x.classList.remove('on'); });
    document.getElementById('srObs').value = '';
    var p = document.getElementById('srPreview'); p.removeAttribute('src'); p.style.display = 'none';
    document.getElementById('srServico').textContent = [(a.plate || '').toUpperCase(), a.car, a.date ? 'Agendado para ' + a.date.split('-').reverse().join('/') : null].filter(Boolean).join(' · ');
    validar();
    document.getElementById('srReportModal').classList.add('open');
  };

  window._srFechar = function () {
    var m = document.getElementById('srReportModal');
    if (m) m.classList.remove('open');
    _alvo = null;
    _foto = null;
  };

  window._srEnviar = async function () {
    if (!_alvo) return;
    var eurocode = eurocodesDoServico(document.getElementById('srEurocode').value)[0];
    var problema = problemaEscolhido();
    if (!eurocode || !problema) return;
    var btn = document.getElementById('srEnviar');
    btn.disabled = true;
    btn.textContent = 'A enviar…';
    var portalId = getActivePortalId();
    try {
      var r = await window.authClient.authenticatedFetch('/.netlify/functions/stock-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portal_id: portalId,
          appointment_id: _alvo.id,
          matricula: _alvo.plate || null,
          eurocode: eurocode,
          problema: problema,
          observacoes: document.getElementById('srObs').value.trim() || null,
          foto: _foto ? { base64: _foto.base64, mimeType: _foto.mimeType } : null,
        }),
      });
      var d = await r.json();
      if (!d || !d.success) throw new Error((d && d.error) || 'Não foi possível reportar');
      toast('📦 Reportado ao Stock de ' + (d.lojaNome || 'loja') + (d.emailEnviado ? '. Email enviado.' : '. (O email não foi enviado.)'), d.emailEnviado ? 'success' : 'info');
      window._srFechar();
      carregar(portalId, true);
    } catch (e) {
      toast('❌ ' + e.message, 'error');
    } finally {
      btn.textContent = 'Reportar ao Stock da loja';
      validar();
    }
  };

  // ── Lista dos reportes (ícone no topo) ───────────────────────────────────
  function desenharLista() {
    var dados = dadosDoPortal();
    var reportes = (dados && dados.reportes) || [];
    var nPend = reportes.filter(function (r) { return r.estado === 'pendente'; }).length;
    var filtros = [['pendente', 'Por tratar (' + nPend + ')'], ['tratado', 'Tratados (' + (reportes.length - nPend) + ')'], ['todos', 'Todos']];
    document.getElementById('srFiltros').innerHTML = filtros.map(function (f) {
      return '<button type="button" class="sr-chip' + (_filtro === f[0] ? ' on' : '') + '" data-filtro="' + f[0] + '">' + f[1] + '</button>';
    }).join('');
    document.querySelectorAll('#srFiltros [data-filtro]').forEach(function (b) {
      b.onclick = function () { _filtro = b.getAttribute('data-filtro'); desenharLista(); };
    });
    var lista = filtrar(reportes, _filtro);
    var dt = function (d) { return d ? new Date(d).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''; };
    document.getElementById('srLista').innerHTML = lista.length ? lista.map(function (r) {
      var tratado = r.estado !== 'pendente';
      return '<div class="sr-item' + (tratado ? ' tratado' : '') + '">' +
        '<div><span class="sr-tag prob">' + esc(nomeProblema(r.problema)) + '</span>' +
        '<span class="sr-tag ' + (tratado ? 'tratado' : 'pendente') + '">' + (tratado ? '✓ Tratado' : '⏳ Por tratar') + '</span></div>' +
        '<div style="font-size:16px;font-weight:800;letter-spacing:1px;margin-top:4px">' + esc(r.eurocode) + '</div>' +
        '<div style="font-size:12px;color:#5d6b80">' + [r.matricula, 'Reportado a ' + dt(r.createdAt), r.lojaNome ? 'Stock de ' + r.lojaNome : null].filter(Boolean).map(esc).join(' · ') + '</div>' +
        (tratado && r.tratadoEm ? '<div style="font-size:12px;color:#166534">Tratado a ' + esc(dt(r.tratadoEm)) + (r.tratadoPor ? ' por ' + esc(r.tratadoPor) : '') + '</div>' : '') +
        (r.observacoes ? '<div style="font-size:13px;margin-top:4px">' + esc(r.observacoes) + '</div>' : '') +
        (r.fotoUrl ? '<a href="' + esc(r.fotoUrl) + '" target="_blank" rel="noopener" style="font-size:12px">Ver fotografia</a>' : '') +
        '</div>';
    }).join('') : '<p class="sr-nota">' + (_filtro === 'pendente' ? 'Não há reportes por tratar. 👍' : 'Ainda não há reportes.') + '</p>';
  }

  window._srAbrirLista = function () {
    garantirModais();
    desenharLista();
    document.getElementById('srListModal').classList.add('open');
    carregar(getActivePortalId(), true);
  };
  window._srFecharLista = function () {
    var m = document.getElementById('srListModal');
    if (m) m.classList.remove('open');
  };

  // ── Botões ──────────────────────────────────────────────────────────────
  function garantirBotaoTopo() {
    var btn = document.getElementById('stockListBtn');
    if (!btn) {
      var actions = document.querySelector('.page-header .header-actions');
      if (!actions) return null;
      garantirEstilo();
      btn = document.createElement('button');
      btn.id = 'stockListBtn';
      btn.type = 'button';
      btn.className = 'header-btn';
      btn.style.display = 'none';
      btn.title = 'Reportes de stock (vidros com problema)';
      btn.setAttribute('aria-label', 'Reportes de stock');
      btn.innerHTML = '📋 <span class="sr-label-txt">Stock</span><span class="sr-badge" style="display:none"></span>';
      btn.addEventListener('click', window._srAbrirLista);
      var antes = document.getElementById('glassAlertBtn');
      if (antes && antes.parentNode === actions) actions.insertBefore(btn, antes);
      else actions.appendChild(btn);
    }
    return btn;
  }

  function textoBotao(estado) {
    return estado === 'pendente' ? '📦 Stock reportado' : estado === 'tratado' ? '📦 Stock tratado' : '📦 Stock';
  }

  // O botão vai para o lugar que era do "Venda compl." (o espaço data-sr-slot
  // que o cartão já traz, no computador e no telemóvel).
  function injetarNosCartoes() {
    var dados = dadosDoPortal();
    var ativo = !!(dados && dados.ligado && portalUsaStock());
    if (ativo) garantirEstilo();
    var appts = window.appointments || [];
    var usaVidro = function (a) { return !window.agendamentoUsaVidro || window.agendamentoUsaVidro(a); };

    document.querySelectorAll('[data-sr-slot]').forEach(function (slot) {
      var a = ativo && appts.find(function (x) { return String(x.id) === String(slot.getAttribute('data-sr-slot')); });
      if (!a || !usaVidro(a)) { if (slot.firstChild) slot.innerHTML = ''; return; }
      var estado = estadoDoServico(dados.reportes, a.id);
      var b = slot.querySelector('button');
      if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.title = 'Reportar um problema com o vidro (errado, danificado, com defeito, partido)';
        b.onclick = function (e) { e.stopPropagation(); window._srAbrir(a.id); };
        slot.appendChild(b);
      }
      var classe = 'sr-card-btn' + (estado ? ' sr-' + estado : '');
      if (b.className !== classe) b.className = classe;
      var texto = textoBotao(estado);
      if (b.textContent !== texto) b.textContent = texto;
    });
  }

  // No telemóvel o cabeçalho já não cabe; quem tem a fila de botões da agenda
  // (Receção Vidros, Histórico…) fica com o Stock aí, a seguir ao Histórico.
  function garantirBotaoFila() {
    var area = document.getElementById('guiaATUploadArea');
    if (!area || area.style.display === 'none') return null;
    var btn = document.getElementById('stockListBtnMobile');
    if (btn) return btn;
    var historico = document.getElementById('btnHistoricoMobile');
    var fila = historico ? historico.parentNode : area.querySelector('div');
    if (!fila) return null;
    btn = document.createElement('button');
    btn.id = 'stockListBtnMobile';
    btn.type = 'button';
    btn.className = 'guia-at-upload-btn';
    btn.title = 'Reportes de stock (vidros com problema)';
    btn.addEventListener('click', window._srAbrirLista);
    if (historico) historico.insertAdjacentElement('afterend', btn); else fila.appendChild(btn);
    return btn;
  }

  function atualizarTopo() {
    var btn = garantirBotaoTopo();
    if (!btn) return;
    var dados = dadosDoPortal();
    var mostrar = !!(dados && dados.ligado && portalUsaStock());
    var n = mostrar ? dados.reportes.filter(function (r) { return r.estado === 'pendente'; }).length : 0;
    var telemovel = window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
    var fila = mostrar && telemovel ? garantirBotaoFila() : document.getElementById('stockListBtnMobile');
    if (fila) {
      fila.style.display = mostrar && telemovel ? '' : 'none';
      fila.textContent = '📋 Stock' + (n ? ' (' + n + ')' : '');
      fila.style.background = n ? '#e1251b' : '';
      fila.style.borderColor = n ? '#e1251b' : '';
    }
    btn.style.display = mostrar && !(telemovel && fila) ? '' : 'none';
    if (!mostrar) return;
    var badge = btn.querySelector('.sr-badge');
    badge.textContent = n;
    badge.style.display = n ? '' : 'none';
  }

  function atualizarTudo() {
    try { atualizarTopo(); injetarNosCartoes(); } catch (e) { console.warn('[Stock]', e); }
  }

  function tick() {
    var pid = getActivePortalId();
    if (pid && portalUsaStock()) carregar(pid, false);
    atualizarTudo();
  }

  function start() {
    // Depois de cada desenho da agenda, voltar a pôr os botões nos cartões
    var orig = window.renderAll;
    if (typeof orig === 'function' && !orig._srWrapped) {
      window.renderAll = function () {
        var r = orig.apply(this, arguments);
        setTimeout(atualizarTudo, 80);
        return r;
      };
      window.renderAll._srWrapped = true;
    }
    tick();
    setInterval(tick, 3000);
    // O estado dos reportes (tratado no Portal da Loja) atualiza de 2 em 2 minutos
    setInterval(function () { var pid = getActivePortalId(); if (pid && portalUsaStock()) carregar(pid, true); }, 120000);
  }

  window._srAtualizar = atualizarTudo;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 1500); });
  } else {
    setTimeout(start, 1500);
  }
})();
