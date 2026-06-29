// recusados-alert.js
// Aviso diário (a partir das 9h) com a listagem dos serviços RECUSADOS de cada
// loja. Para um coordenador que trata de várias lojas, mostra um popup por loja.
// Botões: Imprimir (lista) e Já tratei (só fecha o popup, não altera dados).
(function () {
  'use strict';

  const DISMISS_PREFIX = 'recusadosDismissed_';
  const ALERT_HOUR = 9; // a partir das 9h

  function dayStr() { return new Date().toDateString(); }
  function dismissKey(portalId) { return DISMISS_PREFIX + portalId + '_' + dayStr(); }
  function isDismissed(portalId) { return !!localStorage.getItem(dismissKey(portalId)); }
  function markDismissed(portalId) { try { localStorage.setItem(dismissKey(portalId), '1'); } catch (e) {} }

  function isDebug() {
    return new URLSearchParams(window.location.search).get('debugRecusados') === '1';
  }

  function diasAberto(dataObra) {
    if (!dataObra) return null;
    const s = String(dataObra).slice(0, 10);
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d)) return null;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor((hoje - d) / 86400000));
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const s = String(iso).slice(0, 10);
    const d = new Date(s + 'T12:00:00');
    return isNaN(d) ? s : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  // Lojas que o utilizador trata (próprias). Coordenador → todas as que gere.
  // Inclui sempre a loja ativa (cobre admin e a loja onde se está a importar).
  function getManagedPortals() {
    const u = window.authClient?.getUser?.();
    if (!u) return [];
    const list = []; const seen = new Set();
    const add = (p) => { if (p && p.id && !seen.has(p.id)) { seen.add(p.id); list.push({ id: p.id, name: p.name || ('Loja ' + p.id) }); } };
    if (Array.isArray(u.portals)) u.portals.forEach(add);
    add(u.portal);
    // Loja atualmente ativa (importante para admin e para a loja em uso)
    if (window.activePortalId) add({ id: window.activePortalId, name: window.portalConfig?.name });
    return list;
  }

  async function fetchRecusados(portalId) {
    try {
      const token = window.authClient?.getToken?.() || localStorage.getItem('eg_auth_token');
      if (!token) return [];
      const resp = await fetch('/.netlify/functions/recusados?portal_id=' + portalId, {
        headers: { Authorization: 'Bearer ' + token }
      });
      const data = await resp.json();
      return (data.success && Array.isArray(data.data)) ? data.data : [];
    } catch (e) { console.warn('[Recusados] fetch erro:', e); return []; }
  }

  function injectStyles() {
    if (document.getElementById('recusadosStyles')) return;
    const s = document.createElement('style');
    s.id = 'recusadosStyles';
    s.textContent = `
      @keyframes recusPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
      @keyframes recusFade { from{opacity:0} to{opacity:1} }
      #recusadosOverlay { position:fixed; inset:0; background:rgba(0,0,0,.88); z-index:1000000;
        display:flex; align-items:center; justify-content:center; padding:18px; animation:recusFade .25s ease-in; }
      #recusadosBox { background:#fff; border:7px solid #dc2626; border-radius:18px; max-width:600px; width:100%;
        text-align:center; padding:30px 22px 24px; box-shadow:0 25px 80px rgba(220,38,38,.5); max-height:92vh; overflow-y:auto; }
      #recusadosBox .rc-icon { font-size:56px; margin-bottom:4px; }
      #recusadosBox .rc-title { font-size:30px; font-weight:900; text-transform:uppercase; color:#dc2626;
        line-height:1.1; margin:0 0 4px; animation:recusPulse .8s infinite; }
      #recusadosBox .rc-loja { font-size:18px; font-weight:800; color:#1e293b; margin:0 0 14px; }
      #recusadosList { text-align:left; background:#fef2f2; border:1.5px solid #fecaca; border-radius:10px;
        padding:6px 10px; margin-bottom:18px; max-height:320px; overflow-y:auto; }
      .rc-item { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:9px 4px;
        border-bottom:1px solid #fecaca; }
      .rc-item:last-child { border-bottom:none; }
      .rc-plate { font-weight:900; font-size:16px; color:#0f172a; letter-spacing:.5px; }
      .rc-car { font-size:13px; color:#475569; font-weight:600; }
      .rc-obs { font-size:11px; color:#94a3b8; width:100%; }
      .rc-dias { margin-left:auto; background:#dc2626; color:#fff; font-weight:900; font-size:15px;
        padding:4px 12px; border-radius:20px; white-space:nowrap; }
      .rc-dias.amber { background:#f59e0b; } .rc-dias.blue { background:#2563eb; }
      #recusadosBox .rc-btns { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; }
      #recusadosBox .rc-btns button { border:none; border-radius:12px; cursor:pointer; font-size:16px;
        font-weight:800; padding:13px 28px; }
      #recusBtnPrint { background:#1e40af; color:#fff; } #recusBtnPrint:hover { background:#1e3a8a; }
      #recusBtnOk { background:#16a34a; color:#fff; } #recusBtnOk:hover { background:#15803d; }
      @media(max-width:480px){ #recusadosBox .rc-title{font-size:23px} #recusadosBox .rc-loja{font-size:15px}
        #recusadosBox .rc-btns button{padding:12px 18px;font-size:14px} }
    `;
    document.head.appendChild(s);
  }

  function buildListHTML(items) {
    return items.map(r => {
      const d = diasAberto(r.data_obra);
      const cls = d === null ? 'blue' : d >= 14 ? '' : d >= 7 ? 'amber' : 'blue';
      const diasLabel = d === null ? '? dias' : d + (d === 1 ? ' dia' : ' dias');
      return `<div class="rc-item">
        <span class="rc-plate">${(r.plate || '—').toUpperCase()}</span>
        <span class="rc-car">${(r.car || '').toUpperCase()}</span>
        <span class="rc-dias ${cls}" title="Aberto em ${fmtDate(r.data_obra)}">⏱ ${diasLabel}</span>
        ${r.obs ? `<span class="rc-obs">📝 ${r.obs}</span>` : ''}
      </div>`;
    }).join('');
  }

  function printList(lojaName, items) {
    const rows = items.map(r => {
      const d = diasAberto(r.data_obra);
      return `<tr>
        <td style="font-weight:700;">${(r.plate || '—').toUpperCase()}</td>
        <td>${(r.car || '').toUpperCase()}</td>
        <td>${r.client_name || ''}</td>
        <td style="text-align:center;">${fmtDate(r.data_obra)}</td>
        <td style="text-align:center;font-weight:700;">${d === null ? '—' : d}</td>
        <td>${r.obs || ''}</td>
      </tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html lang="pt-PT"><head><meta charset="UTF-8">
      <title>Recusados — ${lojaName}</title>
      <style>@page{margin:14mm;size:A4 portrait;}
        body{font-family:Arial,sans-serif;color:#111;}
        h1{font-size:20px;margin:0 0 2px;color:#dc2626;}
        .meta{font-size:12px;color:#555;margin-bottom:14px;}
        table{width:100%;border-collapse:collapse;font-size:12px;}
        th{background:#dc2626;color:#fff;padding:7px 8px;text-align:left;}
        td{padding:6px 8px;border-bottom:1px solid #e5e7eb;}</style>
      </head><body>
      <h1>🚫 Serviços Recusados — ${lojaName}</h1>
      <div class="meta">${new Date().toLocaleDateString('pt-PT',{day:'2-digit',month:'long',year:'numeric'})} · ${items.length} recusado(s)</div>
      <table><thead><tr><th>Matrícula</th><th>Carro</th><th>Cliente</th><th>Aberto em</th><th>Dias</th><th>Observações</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <script>window.onload=function(){window.print();}<\/script>
      </body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  }

  // Mostra os popups em fila (um por loja)
  function showQueue(queue) {
    if (!queue.length) return;
    injectStyles();
    const { portalId, lojaName, items } = queue[0];

    if (document.getElementById('recusadosOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'recusadosOverlay';
    overlay.innerHTML = `
      <div id="recusadosBox">
        <div class="rc-icon">🚫</div>
        <h1 class="rc-title">Recusados Pendentes</h1>
        <div class="rc-loja">📍 ${lojaName} · ${items.length} recusado${items.length > 1 ? 's' : ''}</div>
        <div id="recusadosList">${buildListHTML(items)}</div>
        <div class="rc-btns">
          <button id="recusBtnPrint">🖨️ Imprimir</button>
          <button id="recusBtnOk">✅ Já tratei</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('recusBtnPrint').onclick = () => printList(lojaName, items);
    document.getElementById('recusBtnOk').onclick = () => {
      markDismissed(portalId);
      overlay.remove();
      showQueue(queue.slice(1)); // próxima loja
    };
  }

  async function check(force) {
    if (!window.authClient?.getUser?.()) return;
    const now = new Date();
    if (!force && !isDebug() && now.getHours() < ALERT_HOUR) return; // só a partir das 9h

    const portais = getManagedPortals();
    if (!portais.length) return;

    const queue = [];
    for (const p of portais) {
      if (!force && !isDebug() && isDismissed(p.id)) continue;
      const items = await fetchRecusados(p.id);
      if (items.length > 0) queue.push({ portalId: p.id, lojaName: p.name, items });
    }
    if (queue.length) showQueue(queue);
  }

  function waitForData(fn, tries) {
    tries = tries || 0;
    if (window.authClient?.getUser?.()) { fn(); return; }
    if (tries < 20) setTimeout(() => waitForData(fn, tries + 1), 800);
  }

  function init() {
    waitForData(check);
    // Reverificar de hora a hora (apanha a transição das 9h se a app ficar aberta)
    setInterval(() => waitForData(check), 60 * 60 * 1000);
    document.addEventListener('portalReady', () => setTimeout(() => waitForData(check), 1200));
  }

  // Exposto para re-verificar imediatamente após uma importação (força mostrar)
  window._recusadosCheck = function () { waitForData(() => check(true)); };

  console.log('[Recusados] script carregado');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
