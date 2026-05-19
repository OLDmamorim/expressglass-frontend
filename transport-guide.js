(function () {
  'use strict';

  const API = '/.netlify/functions/transport-guide';
  let todayGuide = null;
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
    try { return (JSON.parse(appt.extra).eurocode || '').trim().toUpperCase(); } catch (e) { return appt.extra.trim().toUpperCase(); }
  }

  // ── Badge injection ──────────────────────────────────────

  function injectBadges() {
    if (!todayGuide?.eurocodes?.length) return;
    const eurocodes = todayGuide.eurocodes.map(e => e.toUpperCase());
    const appts = window.appointments || [];

    document.querySelectorAll('.guia-at-badge').forEach(b => b.remove());

    document.querySelectorAll('.m-card[data-id], .desk-card[data-id]').forEach(card => {
      const appt = appts.find(a => String(a.id) === card.dataset.id);
      if (!appt) return;
      const ec = getEurocode(appt);
      if (!ec || !eurocodes.includes(ec)) return;

      const badge = document.createElement('button');
      badge.className = 'guia-at-badge';
      badge.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Guia AT';
      badge.onclick = (e) => { e.stopPropagation(); openViewer(); };
      card.style.position = 'relative';
      card.appendChild(badge);
    });
  }

  function scheduleInject() {
    clearTimeout(injectTimer);
    injectTimer = setTimeout(injectBadges, 150);
  }

  // ── PDF Viewer ───────────────────────────────────────────

  function openViewer() {
    if (!todayGuide?.pdf_data) return;
    const modal = document.getElementById('guiaATModal');
    if (!modal) return;

    // Create blob URL for better cross-browser support
    const bytes = atob(todayGuide.pdf_data);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    const iframe = document.getElementById('guiaATIframe');
    if (iframe) iframe.src = url;

    // Fallback link for iOS
    const link = document.getElementById('guiaATDownload');
    if (link) { link.href = url; link.download = 'guia-AT.pdf'; }

    modal.classList.add('show');
  }

  function closeViewer() {
    const modal = document.getElementById('guiaATModal');
    const iframe = document.getElementById('guiaATIframe');
    modal?.classList.remove('show');
    if (iframe) { URL.revokeObjectURL(iframe.src); iframe.src = ''; }
  }

  // ── Upload ───────────────────────────────────────────────

  function triggerUpload() {
    const deskInput = document.getElementById('guiaATFileInputDesk');
    const mobileInput = document.getElementById('guiaATFileInput');
    const input = (deskInput && document.getElementById('guiaATUploadAreaDesk')?.style.display !== 'none') ? deskInput : mobileInput;
    if (input) input.click();
  }

  function getManualCodes() {
    const field = document.getElementById('guiaATManualCodesDesk') || document.getElementById('guiaATManualCodes');
    if (!field || !field.value.trim()) return [];
    return field.value.split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  }

  async function handleFileSelected(input) {
    const file = input.files[0];
    if (!file) return;
    const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/tiff', 'image/webp'];
    if (!allowed.includes(file.type)) { alert('Por favor seleciona um ficheiro PDF ou imagem (JPG, PNG, TIFF).'); return; }

    const btns = [document.getElementById('guiaATUploadBtn'), document.getElementById('guiaATUploadBtnDesk')];
    btns.forEach(b => { if (b) { b.disabled = true; b.textContent = '⏳'; } });

    try {
      const base64 = await fileToBase64(file);
      const manual_eurocodes = getManualCodes();
      const payload = { pdf_data: base64, file_type: file.type, manual_eurocodes };
      if (window.activePortalId) payload._portalId = window.activePortalId;
      const res = await authFetch(API, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        todayGuide = data.guide;
        injectBadges();
        updateUploadBtn();
        const n = data.eurocodes_found.length;
        if (n === 0) {
          showToast('⚠️ Guia carregada mas 0 Eurocodes encontrados — introduz os códigos manualmente no campo ao lado.', 'error');
        } else {
          showToast(`✅ Guia AT carregada — ${n} Eurocode(s): ${data.eurocodes_found.join(', ')}`, 'success');
        }
      } else {
        showToast(data.error || 'Erro ao carregar PDF.', 'error');
      }
    } catch (e) {
      showToast('Erro: ' + e.message, 'error');
    } finally {
      btns.forEach(b => { if (b) b.disabled = false; });
      updateUploadBtn();
      input.value = '';
    }
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
    const btns = [document.getElementById('guiaATUploadBtn'), document.getElementById('guiaATUploadBtnDesk')];
    btns.forEach(btn => {
      if (!btn) return;
      if (todayGuide) {
        btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Guia AT ✓';
        btn.classList.add('guia-at-loaded');
      } else {
        btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Guia AT';
        btn.classList.remove('guia-at-loaded');
      }
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

    // Load today's guide
    try {
      const portalParam = window.activePortalId ? `?portal_id=${window.activePortalId}` : '';
      const res = await authFetch(API + portalParam);
      const data = await res.json();
      if (data.success && data.guide) {
        todayGuide = data.guide;
        updateUploadBtn();
        scheduleInject();
      }
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

  window.guiaAT = { init, openViewer, closeViewer, triggerUpload, handleFileSelected, injectBadges };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 700));
  } else {
    setTimeout(init, 700);
  }
})();
