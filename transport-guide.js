(function () {
  'use strict';

  const API = '/.netlify/functions/transport-guide';
  let guides = { today: null, tomorrow: null }; // guides indexed by target date
  let todayGuide = null; // kept for viewer (today's guide)
  let uploadDate = 'today'; // 'today' | 'tomorrow'
  let injectTimer = null;

  async function authFetch(url, opts) {
    const token = window.authClient?.getToken();
    return fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts?.headers || {}) }
    });
  }

  function isCoordinator() {
    const role = window.authClient?.getUser?.()?.role || '';
    return ['admin', 'coordinator', 'coordenador'].includes(role);
  }

  function getEurocode(appt) {
    if (!appt.extra) return '';
    try { return (JSON.parse(appt.extra).eurocode || '').trim().toUpperCase(); } catch (e) {
      const m = appt.extra.match(/"eurocode"\s*:\s*"([^"]+)"/);
      return m ? m[1].trim().toUpperCase() : '';
    }
  }

  // ── Badge injection ──────────────────────────────────────

  function allEurocodes() {
    const set = new Set();
    ['today', 'tomorrow'].forEach(k => {
      (guides[k]?.eurocodes || []).forEach(e => set.add(e.toUpperCase()));
    });
    return [...set];
  }

  function injectBadges() {
    const eurocodes = allEurocodes();
    if (!eurocodes.length) return;
    const appts = window.appointments || [];

    document.querySelectorAll('.guia-at-badge').forEach(b => b.remove());

    document.querySelectorAll('.m-card[data-id], .desk-card[data-id]').forEach(card => {
      const appt = appts.find(a => String(a.id) === card.dataset.id);
      if (!appt) return;
      const ec = getEurocode(appt);
      // Guide codes may have extra suffix (e.g. "6564AGNVZPBL" from pdf-parse table concat)
      if (!ec || !eurocodes.some(g => g === ec || g.startsWith(ec) || ec.startsWith(g))) return;

      const badge = document.createElement('button');
      badge.className = 'guia-at-badge';
      badge.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1V2l-2 1-2-1-2 1-2-1-2 1-2-1z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg> Guia AT';
      badge.onclick = (e) => { e.stopPropagation(); openViewer(); };
      const kmRow = card.querySelector('[data-km-row]');
      if (kmRow) {
        badge.classList.add('guia-at-badge--inline');
        kmRow.appendChild(badge);
      } else {
        badge.classList.add('guia-at-badge--abs');
        card.style.position = 'relative';
        card.appendChild(badge);
      }
    });
  }

  function scheduleInject() {
    clearTimeout(injectTimer);
    injectTimer = setTimeout(injectBadges, 150);
  }

  // ── PDF / Image Viewer ───────────────────────────────────

  function isMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  function makeGuideUrl() {
    const ft = todayGuide.file_type || 'application/pdf';
    const bytes = atob(todayGuide.pdf_data);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return { url: URL.createObjectURL(new Blob([arr], { type: ft })), type: ft };
  }

  function openViewer() {
    // Prefer today's guide for viewing; fall back to tomorrow's
    todayGuide = guides.today || guides.tomorrow;
    if (!todayGuide?.pdf_data) return;
    const { url, type } = makeGuideUrl();

    if (isMobile()) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return;
    }

    const modal = document.getElementById('guiaATModal');
    if (!modal) return;

    const iframe = document.getElementById('guiaATIframe');
    const imgViewer = document.getElementById('guiaATImage');

    if (type.startsWith('image/')) {
      // Show image, hide iframe
      if (iframe) iframe.style.display = 'none';
      if (imgViewer) {
        imgViewer.src = url;
        imgViewer.style.display = 'block';
        imgViewer._blobUrl = url;
      }
    } else {
      // Show PDF in iframe, hide image
      if (imgViewer) { imgViewer.style.display = 'none'; imgViewer.src = ''; }
      if (iframe) { iframe.style.display = 'block'; iframe.src = url; }
    }

    const ext = type.startsWith('image/') ? type.split('/')[1] || 'png' : 'pdf';
    const link = document.getElementById('guiaATDownload');
    if (link) { link.href = url; link.download = `guia-AT.${ext}`; }

    modal.classList.add('show');
  }

  function closeViewer() {
    const modal = document.getElementById('guiaATModal');
    const iframe = document.getElementById('guiaATIframe');
    const imgViewer = document.getElementById('guiaATImage');
    modal?.classList.remove('show');
    if (iframe) { URL.revokeObjectURL(iframe.src); iframe.src = ''; }
    if (imgViewer?._blobUrl) { URL.revokeObjectURL(imgViewer._blobUrl); imgViewer.src = ''; imgViewer._blobUrl = null; }
  }

  // ── Upload menu ──────────────────────────────────────────

  function setUploadDate(val) {
    uploadDate = val;
    ['hoje', 'amanha'].forEach(id => {
      const el = document.getElementById('guiaATDate_' + id);
      if (el) el.classList.toggle('active', (id === 'hoje') === (val === 'today'));
    });
  }

  let _menuBtn = null;

  function toggleMenu(btn) {
    const menu = document.getElementById('guiaATMenu');
    if (!menu) return;
    if (menu.style.display !== 'none') { closeMenu(); return; }

    _menuBtn = btn;
    const rect = btn.getBoundingClientRect();
    // Prefer positioning below the button; if near bottom, flip above
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 130) {
      menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
      menu.style.top = 'auto';
    } else {
      menu.style.top = (rect.bottom + window.scrollY + 6) + 'px';
      menu.style.bottom = 'auto';
    }
    menu.style.left = Math.min(rect.left, window.innerWidth - 216) + 'px';
    menu.style.display = 'block';

    setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
  }

  function closeMenu() {
    const menu = document.getElementById('guiaATMenu');
    if (menu) menu.style.display = 'none';
    _menuBtn = null;
  }

  function triggerFileInput() {
    closeMenu();
    const deskInput = document.getElementById('guiaATFileInputDesk');
    const mobileInput = document.getElementById('guiaATFileInput');
    const input = (deskInput && document.getElementById('guiaATUploadAreaDesk')?.style.display !== 'none') ? deskInput : mobileInput;
    if (input) input.click();
  }

  function handlePasteZone(event) {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) {
          closeMenu();
          showToast('📋 A processar imagem colada…', 'success');
          uploadFile(file);
        }
        return;
      }
    }
  }

  async function uploadFile(file) {
    const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/tiff', 'image/webp'];
    if (!allowed.includes(file.type)) { alert('Por favor seleciona um ficheiro PDF ou imagem (JPG, PNG, TIFF).'); return; }

    const btns = [document.getElementById('guiaATUploadBtn'), document.getElementById('guiaATUploadBtnDesk')];
    btns.forEach(b => { if (b) { b.disabled = true; b.textContent = '⏳'; } });

    try {
      const base64 = await fileToBase64(file);
      const payload = { pdf_data: base64, file_type: file.type, guide_date: uploadDate };
      if (window.activePortalId) payload._portalId = window.activePortalId;
      const res = await authFetch(API, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) {
        guides[uploadDate === 'tomorrow' ? 'tomorrow' : 'today'] = data.guide;
        todayGuide = guides.today || guides.tomorrow;
        injectBadges();
        updateUploadBtn();
        const n = data.eurocodes_found.length;
        if (n === 0) {
          showToast('⚠️ Guia carregada mas 0 Eurocodes encontrados — introduz os códigos manualmente no campo ao lado.', 'error');
        } else {
          showToast(`✅ Guia AT carregada — ${n} Eurocode(s): ${data.eurocodes_found.join(', ')}`, 'success');
        }
      } else {
        showToast(data.error || 'Erro ao carregar ficheiro.', 'error');
      }
    } catch (e) {
      showToast('Erro: ' + e.message, 'error');
    } finally {
      btns.forEach(b => { if (b) b.disabled = false; });
      updateUploadBtn();
    }
  }

  async function handleFileSelected(input) {
    const file = input.files[0];
    if (!file) return;
    await uploadFile(file);
    input.value = '';
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function updateUploadBtn() {
    const hasToday = !!guides.today;
    const hasTomorrow = !!guides.tomorrow;
    const loaded = hasToday || hasTomorrow;
    const label = hasToday && hasTomorrow ? 'Guia AT ✓✓'
                : hasToday ? 'Guia AT ✓'
                : hasTomorrow ? 'Guia AT +1 ✓'
                : 'Guia AT';
    const icon = loaded
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
    const btns = [document.getElementById('guiaATUploadBtn'), document.getElementById('guiaATUploadBtnDesk')];
    btns.forEach(btn => {
      if (!btn) return;
      btn.innerHTML = `${icon} ${label}`;
      btn.classList.toggle('guia-at-loaded', loaded);
    });
  }

  // ── Init ─────────────────────────────────────────────────

  async function init() {
    if (!window.authClient?.isAuthenticated()) return;

    // Show upload button only for coordinators/admins
    if (isCoordinator()) {
      const uploadArea = document.getElementById('guiaATUploadArea');
      if (uploadArea) uploadArea.style.display = 'flex';
      const uploadAreaDesk = document.getElementById('guiaATUploadAreaDesk');
      if (uploadAreaDesk) uploadAreaDesk.style.display = 'flex';
    }

    // Set up observers BEFORE the async fetch so we never miss a render
    const target = document.getElementById('mobileDayList');
    if (target) {
      new MutationObserver(scheduleInject).observe(target, { childList: true, subtree: false });
    }
    const scheduleEl = document.getElementById('schedule');
    if (scheduleEl) {
      new MutationObserver(scheduleInject).observe(scheduleEl, { childList: true, subtree: false });
    }

    // Load today's and tomorrow's guides
    try {
      const portalParam = window.activePortalId ? `&portal_id=${window.activePortalId}` : '';
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowIso = tomorrow.toISOString().split('T')[0];
      const [resToday, resTomorrow] = await Promise.all([
        authFetch(`${API}?date=${new Date().toISOString().split('T')[0]}${portalParam}`),
        authFetch(`${API}?date=${tomorrowIso}${portalParam}`)
      ]);
      const [dToday, dTomorrow] = await Promise.all([resToday.json(), resTomorrow.json()]);
      if (dToday.success && dToday.guide) guides.today = dToday.guide;
      if (dTomorrow.success && dTomorrow.guide) guides.tomorrow = dTomorrow.guide;
      todayGuide = guides.today || guides.tomorrow;
      if (guides.today || guides.tomorrow) { updateUploadBtn(); scheduleInject(); }
    } catch (e) { console.error('Transport guide init:', e); }

    // Safety-net inject for slow connections
    setTimeout(injectBadges, 1500);
    setTimeout(injectBadges, 3000);
  }

  function showToast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
    const t = Object.assign(document.createElement('div'), { textContent: msg });
    Object.assign(t.style, {
      position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
      background: type === 'error' ? '#dc2626' : '#16a34a',
      color: '#fff', padding: '12px 20px', borderRadius: '10px',
      zIndex: '9999', fontSize: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  window.guiaAT = { init, openViewer, closeViewer, toggleMenu, closeMenu, triggerFileInput, handleFileSelected, handlePasteZone, injectBadges, setUploadDate };

  let _initDone = false;
  function _runInit() {
    if (_initDone) return;
    _initDone = true;
    init();
  }

  function _waitForPortal() {
    if (window._portalReadyFired) {
      _runInit();
    } else {
      window.addEventListener('portalReady', _runInit, { once: true });
      // Fallback: if portalReady never fires (e.g. single-portal user path), run after 3s
      setTimeout(_runInit, 3000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _waitForPortal);
  } else {
    _waitForPortal();
  }
})();
