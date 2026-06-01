// incomplete-services-alert.js
// Alert for technicians: appointments from previous days without a final service status.
// Shows a blocking popup (similar to glass-alert-urgent.js) once per day on first open.

(function () {
  const DISMISS_PREFIX = 'incompleteServicesDismissed_';

  function todayKey() {
    return DISMISS_PREFIX + new Date().toDateString();
  }

  function isDismissed() {
    return !!localStorage.getItem(todayKey());
  }

  function dismiss() {
    localStorage.setItem(todayKey(), '1');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', weekday: 'short' });
  }

  async function fetchPending() {
    try {
      const token = window.authClient?.getToken?.() || localStorage.getItem('eg_auth_token');
      if (!token) { console.warn('[IncServ] sem token'); return []; }
      const user = window.authClient?.getUser?.();
      // userData stores portal as user.portal.id (not user.portalId)
      const portalId = user?.portal?.id || window.portalConfig?.id;
      console.log('[IncServ] role=' + user?.role + ' portalId=' + portalId + ' dismissed=' + isDismissed());
      if (!portalId) { console.warn('[IncServ] sem portalId'); return []; }
      const resp = await fetch(
        `/.netlify/functions/appointments?portal_id=${portalId}&pending_conclusion=true`,
        { headers: { Authorization: 'Bearer ' + token } }
      );
      const data = await resp.json();
      console.log('[IncServ] API resposta: success=' + data.success + ' count=' + (data.data?.length ?? 'N/A'));
      if (!data.success || !Array.isArray(data.data)) return [];
      return data.data;
    } catch (e) {
      console.warn('[IncServ] Fetch error:', e);
      return [];
    }
  }

  function injectStyles() {
    if (document.getElementById('incServStyles')) return;
    const s = document.createElement('style');
    s.id = 'incServStyles';
    s.textContent = `
      @keyframes incServPulse {
        0%,100% { color:#b45309; transform:scale(1); }
        50%      { color:#f59e0b; transform:scale(1.04); }
      }
      @keyframes incServFade { from{opacity:0} to{opacity:1} }
      #incServOverlay {
        position:fixed; inset:0;
        background:rgba(0,0,0,.85);
        z-index:999999;
        display:flex; align-items:center; justify-content:center;
        padding:20px;
        animation:incServFade .25s ease-in;
      }
      #incServBox {
        background:#fff;
        border:6px solid #d97706;
        border-radius:18px;
        max-width:540px; width:100%;
        text-align:center;
        padding:36px 24px 28px;
        box-shadow:0 25px 80px rgba(217,119,6,.45);
        max-height:90vh; overflow-y:auto;
      }
      #incServBox .is-icon  { font-size:54px; margin-bottom:6px; }
      #incServBox .is-title {
        font-size:24px; font-weight:900;
        text-transform:uppercase; line-height:1.2;
        animation:incServPulse .75s infinite;
        margin:0 0 8px;
      }
      #incServBox .is-sub {
        font-size:15px; font-weight:600; color:#1e293b;
        margin:0 0 18px; line-height:1.4;
      }
      #incServList {
        text-align:left;
        background:#fffbeb;
        border:1.5px solid #fde68a;
        border-radius:10px;
        padding:10px 14px;
        margin-bottom:20px;
        max-height:210px; overflow-y:auto;
      }
      .inc-item {
        display:flex; align-items:center; gap:8px; flex-wrap:wrap;
        padding:7px 0;
        border-bottom:1px solid #fde68a;
        font-size:13px; font-weight:600; color:#1e293b;
      }
      .inc-item:last-child { border-bottom:none; }
      .inc-date {
        font-size:11px; color:#92400e; font-weight:700;
        background:#fef3c7; border-radius:6px;
        padding:2px 7px; white-space:nowrap;
      }
      .inc-svc {
        font-size:11px; color:#92400e;
        margin-left:auto; white-space:nowrap;
      }
      #incServBox .is-btns { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; }
      #incServBox button {
        border:none; border-radius:12px; cursor:pointer;
        font-size:15px; font-weight:800;
        padding:12px 26px; transition:background .15s;
      }
      #incServBtnVer { background:#d97706; color:#fff; }
      #incServBtnVer:hover { background:#b45309; }
      #incServBtnOk  { background:#16a34a; color:#fff; }
      #incServBtnOk:hover  { background:#15803d; }
      @media(max-width:480px){
        #incServBox .is-title { font-size:19px; }
        #incServBox .is-sub   { font-size:13px; }
        #incServBox button    { padding:11px 18px; font-size:14px; }
      }
    `;
    document.head.appendChild(s);
  }

  function showPopup(services) {
    if (document.getElementById('incServOverlay')) return;
    injectStyles();

    const listHTML = services.map(a => `
      <div class="inc-item">
        <span class="inc-date">${fmtDate(a.date)}</span>
        <strong>${a.plate || '—'}</strong>
        <span style="color:#64748b;font-weight:400;">${a.car || ''}</span>
        ${a.service ? `<span class="inc-svc">${a.service}</span>` : ''}
      </div>`).join('');

    const n = services.length;
    const overlay = document.createElement('div');
    overlay.id = 'incServOverlay';
    overlay.innerHTML = `
      <div id="incServBox">
        <div class="is-icon">⚠️</div>
        <h1 class="is-title">Falta concluir ${n} serviço${n > 1 ? 's' : ''}!</h1>
        <p class="is-sub">
          Os seguintes serviços de véspera ainda não têm estado marcado<br>
          (Realizado / Não Realizado). Por favor actualiza antes de continuar.
        </p>
        <div id="incServList">${listHTML}</div>
        <div class="is-btns">
          <button id="incServBtnVer">📋 Ver serviços</button>
          <button id="incServBtnOk">✅ Já tratei</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('incServBtnVer').onclick = () => {
      overlay.remove();
      // Navigate calendar to the week of the first unresolved appointment
      const firstDate = services[0]?.date;
      if (firstDate && typeof getMonday === 'function' && typeof renderAll === 'function') {
        currentMonday = getMonday(new Date(firstDate + 'T00:00:00'));
        renderAll();
      }
    };

    document.getElementById('incServBtnOk').onclick = () => {
      dismiss();
      overlay.remove();
    };
  }

  // Management roles that should NOT see this alert
  const SKIP_ROLES = new Set(['admin', 'coordenador', 'coordinator', 'comercial', 'pesados_coord']);

  async function check() {
    const role = window.authClient?.getUser?.()?.role;
    const portalId = window.authClient?.getUser?.()?.portal?.id || window.portalConfig?.id;
    console.log('[IncServ] check: role=' + role + ' portalId=' + portalId + ' dismissed=' + isDismissed());
    if (!role) return;
    if (SKIP_ROLES.has(role)) return;
    if (isDismissed()) return;

    const pending = await fetchPending();
    if (pending.length > 0) showPopup(pending);
  }

  function init() {
    // Try at 4s, 8s, 15s to handle slow auth init, then every 5 minutes
    setTimeout(check, 4000);
    setTimeout(check, 8000);
    setTimeout(check, 15000);
    setInterval(check, 5 * 60 * 1000);
  }

  console.log('[IncServ] script carregado v2026-06-01c');

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
