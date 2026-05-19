(function () {
  'use strict';

  const API = '/.netlify/functions/tomorrow-eurocodes';
  const SHOW_HOUR = 17; // 17:00

  function isCoordinator() {
    const role = window.authClient?.getUser?.()?.role || '';
    return ['admin', 'coordinator', 'coordenador'].includes(role);
  }

  function authFetch(url) {
    const token = window.authClient?.getToken();
    return fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  }

  function todayKey() {
    return 'ecReminder_' + new Date().toISOString().split('T')[0];
  }

  function alreadyShown() {
    return localStorage.getItem(todayKey()) === '1';
  }

  function markShown() {
    localStorage.setItem(todayKey(), '1');
  }

  function apiUrl() {
    const portalId = window.activePortalId;
    return API + (portalId ? `?portal_id=${portalId}` : '');
  }

  async function checkAndShow() {
    if (!isCoordinator() || alreadyShown()) return;
    const h = new Date().getHours();
    if (h < SHOW_HOUR || h >= 18) return; // janela 17:00–17:59
    markShown();
    try {
      const res = await authFetch(apiUrl());
      const data = await res.json();
      if (data.success) renderPopup(data.portals, data.date);
    } catch (e) {
      console.error('Eurocode reminder:', e);
    }
  }

  function fmtDate(iso) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function renderPopup(portals, date) {
    document.getElementById('ecReminderModal')?.remove();

    const empty = !portals.length || portals.every(p => !p.eurocodes.length);
    const multiPortal = portals.length > 1;

    let bodyHtml = '';
    if (empty) {
      bodyHtml = '<p class="ec-rem-empty">Sem serviços com Eurocode para amanhã.</p>';
    } else {
      for (const portal of portals) {
        if (!portal.eurocodes.length) continue;
        bodyHtml += `
          ${multiPortal ? `<div class="ec-rem-portal">${portal.portal_name}</div>` : ''}
          <div class="ec-rem-codes">
            ${portal.eurocodes.map(ec => `
              <button class="ec-rem-code" onclick="ecReminder.copy(this,'${ec}')" title="Copiar ${ec}">
                ${ec}
                <svg class="ec-rem-copy" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>`).join('')}
          </div>`;
      }
    }

    const modal = document.createElement('div');
    modal.id = 'ecReminderModal';
    modal.className = 'ec-rem-overlay';
    modal.innerHTML = `
      <div class="ec-rem-box">
        <div class="ec-rem-header">
          <span class="ec-rem-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            Guia AT — Amanhã ${fmtDate(date)}
          </span>
          <button class="ec-rem-close" onclick="document.getElementById('ecReminderModal').remove()">✕</button>
        </div>
        <div class="ec-rem-body" id="ecReminderBody">${bodyHtml}</div>
        <div class="ec-rem-footer">
          ${!empty ? `<button class="ec-rem-print" onclick="ecReminder.print()">🖨 Imprimir</button>` : ''}
          <button class="ec-rem-dismiss" onclick="document.getElementById('ecReminderModal').remove()">Fechar</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('show'));
  }

  function copyCode(btn, code) {
    const doMark = () => { btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1600); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(doMark).catch(doMark);
    } else {
      const ta = Object.assign(document.createElement('textarea'), { value: code });
      Object.assign(ta.style, { position: 'fixed', opacity: '0' });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      doMark();
    }
  }

  function printCodes() {
    const body = document.getElementById('ecReminderBody');
    if (!body) return;
    const win = window.open('', '_blank', 'width=600,height=500');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Guia AT — Eurocodes Amanhã</title>
      <style>
        body{font-family:Arial,sans-serif;padding:28px;color:#000}
        h2{font-size:17px;margin:0 0 18px}
        .ec-rem-portal{font-weight:700;font-size:13px;margin:14px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
        .ec-rem-codes{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px}
        .ec-rem-code{border:1.5px solid #333;border-radius:6px;padding:6px 14px;font-size:13px;font-weight:700;font-family:monospace;background:none;cursor:default}
        .ec-rem-copy,.ec-rem-header,.ec-rem-footer{display:none}
      </style></head><body>
      <h2>Guia AT — Eurocodes para amanhã</h2>
      ${body.innerHTML}
      </body></html>`);
    win.document.close();
    win.print();
  }

  // Inject CSS
  const css = document.createElement('style');
  css.textContent = `
    .ec-rem-overlay{position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);opacity:0;transition:opacity .2s}
    .ec-rem-overlay.show{opacity:1}
    .ec-rem-box{background:#1e293b;border:1px solid rgba(255,255,255,.12);border-radius:16px;width:min(460px,94vw);max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.6);transform:translateY(14px);transition:transform .2s}
    .ec-rem-overlay.show .ec-rem-box{transform:translateY(0)}
    .ec-rem-header{display:flex;align-items:center;justify-content:space-between;padding:15px 18px 12px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0}
    .ec-rem-title{display:flex;align-items:center;gap:8px;color:#fbbf24;font-size:14px;font-weight:700}
    .ec-rem-close{background:none;border:none;color:#64748b;font-size:20px;cursor:pointer;padding:0;line-height:1}
    .ec-rem-close:hover{color:#fff}
    .ec-rem-body{padding:16px 18px;overflow-y:auto;flex:1}
    .ec-rem-empty{color:#64748b;font-size:13px;text-align:center;padding:20px 0}
    .ec-rem-portal{color:#93c5fd;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px;padding-bottom:4px;border-bottom:1px solid rgba(147,197,253,.2)}
    .ec-rem-portal:first-child{margin-top:0}
    .ec-rem-codes{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px}
    .ec-rem-code{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.15);border-radius:8px;color:#e2e8f0;font-size:13px;font-weight:700;font-family:monospace;cursor:pointer;transition:background .12s,border-color .12s}
    .ec-rem-code:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.3)}
    .ec-rem-code.copied{background:rgba(34,197,94,.15);border-color:#22c55e;color:#86efac}
    .ec-rem-copy{opacity:.45;flex-shrink:0}
    .ec-rem-footer{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 18px 15px;border-top:1px solid rgba(255,255,255,.08);flex-shrink:0}
    .ec-rem-print{padding:7px 15px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#cbd5e1;font-size:13px;font-weight:600;cursor:pointer;transition:background .12s}
    .ec-rem-print:hover{background:rgba(255,255,255,.14)}
    .ec-rem-dismiss{padding:7px 20px;background:#1e40af;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;transition:background .12s}
    .ec-rem-dismiss:hover{background:#1d4ed8}
  `;
  document.head.appendChild(css);

  async function showNow() {
    try {
      const res = await authFetch(apiUrl());
      const data = await res.json();
      if (data.success) renderPopup(data.portals, data.date);
    } catch (e) {
      console.error('Eurocode reminder:', e);
    }
  }

  window.ecReminder = { copy: copyCode, print: printCodes, showNow };

  // Start after portal is ready
  let _started = false;
  function start() {
    if (_started || !window.authClient?.isAuthenticated()) return;
    _started = true;
    checkAndShow();
    setInterval(checkAndShow, 60000);
  }

  if (window._portalReadyFired) {
    start();
  } else {
    window.addEventListener('portalReady', start, { once: true });
    setTimeout(start, 4000);
  }
})();
