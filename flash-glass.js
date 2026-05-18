// flash-glass.js — Frontend module for the Flash Glass weekly photo contest
(function () {
  'use strict';

  let currentContest = null;
  let cameraStream = null;
  let capturedPhoto = null;

  const API = '/.netlify/functions/flash-glass';

  async function api(method, qs = {}, body = null) {
    const token = window.authClient?.getToken();
    const url = new URL(API, window.location.origin);
    Object.entries(qs).forEach(([k, v]) => url.searchParams.set(k, v));
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    return res.json();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    if (!window.authClient?.isAuthenticated()) return;
    await loadCurrentContest();
  }

  async function loadCurrentContest() {
    try {
      const data = await api('GET', { action: 'current' });
      if (data.success) {
        currentContest = data.contest;
        updateBanners();
      }
    } catch (e) {
      console.error('Flash Glass init:', e);
    }
  }

  function updateBanners() {
    const hasContest = !!currentContest;
    const submitted = hasContest && !!currentContest.mySubmission;

    // ── Desktop banner ──
    const banner = document.getElementById('fgContestBanner');
    if (banner) {
      banner.style.display = hasContest ? '' : 'none';
      if (hasContest) {
        const themeEl = document.getElementById('fgBannerTheme');
        const btn = document.getElementById('fgBannerBtn');
        const status = document.getElementById('fgBannerStatus');
        if (themeEl) themeEl.textContent = currentContest.theme;
        if (btn) {
          btn.classList.toggle('fg-submitted', submitted);
          btn.innerHTML = submitted
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ENVIADA`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> PARTICIPAR`;
        }
        if (status) {
          if (submitted) {
            const d = new Date(currentContest.mySubmission.updated_at);
            status.textContent = `✓ ${d.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })}`;
          } else {
            status.textContent = '';
          }
        }
      }
    }

    // ── Mobile banner ──
    const bannerM = document.getElementById('fgContestBannerMobile');
    if (bannerM) {
      bannerM.style.display = hasContest ? '' : 'none';
      if (hasContest) {
        const themeM = document.getElementById('fgBannerThemeMobile');
        const btnM = document.getElementById('fgBannerBtnMobile');
        if (themeM) themeM.textContent = currentContest.theme;
        if (btnM) {
          btnM.classList.toggle('fg-submitted', submitted);
          btnM.textContent = submitted ? '✓ ENVIADA' : 'PARTICIPAR';
        }
      }
    }
  }

  // ── Main Modal ────────────────────────────────────────────────────────────

  async function openMainModal() {
    if (!currentContest) {
      showToast('Não há concurso ativo esta semana.', 'info');
      return;
    }
    const el = id => document.getElementById(id);
    const theme = el('fgTheme');
    const desc = el('fgDescription');
    const status = el('fgStatus');
    const muralBtn = el('fgMuralBtn');

    if (theme) theme.textContent = currentContest.theme;
    if (desc) {
      desc.textContent = currentContest.description || '';
      desc.style.display = currentContest.description ? '' : 'none';
    }
    if (status) {
      if (currentContest.mySubmission) {
        const d = new Date(currentContest.mySubmission.updated_at);
        const ds = d.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' });
        status.innerHTML = `<span class="fg-status-ok">✓ Foto enviada — ${ds}</span>`;
      } else {
        status.innerHTML = `<span class="fg-status-pending">Ainda não participaste esta semana</span>`;
      }
    }

    // Show mural btn only if there's a published mural
    if (muralBtn) {
      const d = await api('GET', { action: 'mural' });
      muralBtn.style.display = (d.success && d.murals?.length) ? '' : 'none';
    }

    document.getElementById('flashGlassModal').classList.add('show');
  }

  function closeMainModal() {
    document.getElementById('flashGlassModal')?.classList.remove('show');
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  async function openCamera() {
    closeMainModal();
    const modal = document.getElementById('flashCameraModal');
    modal.classList.add('show');
    showCameraStep('camera');

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      const video = document.getElementById('fgCameraVideo');
      video.srcObject = cameraStream;
      await video.play();
    } catch (e) {
      stopCamera();
      modal.classList.remove('show');
      showToast('Não foi possível aceder à câmara. Verifique as permissões.', 'error');
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
  }

  function capturePhoto() {
    const video = document.getElementById('fgCameraVideo');
    const raw = document.createElement('canvas');
    raw.width = video.videoWidth;
    raw.height = video.videoHeight;
    raw.getContext('2d').drawImage(video, 0, 0);
    stopCamera();

    const maxDim = 1200;
    const scale = Math.min(maxDim / raw.width, maxDim / raw.height, 1);
    const out = document.createElement('canvas');
    out.width = Math.round(raw.width * scale);
    out.height = Math.round(raw.height * scale);
    out.getContext('2d').drawImage(raw, 0, 0, out.width, out.height);
    capturedPhoto = out.toDataURL('image/jpeg', 0.75);

    document.getElementById('fgPreviewImg').src = capturedPhoto;
    showCameraStep('preview');
  }

  function retakePhoto() {
    capturedPhoto = null;
    showCameraStep('camera');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(stream => {
        cameraStream = stream;
        const video = document.getElementById('fgCameraVideo');
        video.srcObject = stream;
        video.play();
      })
      .catch(() => {
        closeCameraModal();
        showToast('Não foi possível aceder à câmara.', 'error');
      });
  }

  async function confirmPhoto() {
    if (!capturedPhoto || !currentContest) return;
    const btn = document.getElementById('fgConfirmBtn');
    btn.disabled = true;
    const origText = btn.innerHTML;
    btn.innerHTML = '⏳';

    try {
      const data = await api('POST', {}, {
        action: 'submit',
        contest_id: currentContest.id,
        photo_data: capturedPhoto
      });
      if (data.success) {
        closeCameraModal();
        await loadCurrentContest();
        updateBanners();
        showToast('🎉 Foto enviada com sucesso!', 'success');
      } else {
        showToast(data.error || 'Erro ao enviar foto.', 'error');
        btn.innerHTML = origText;
        btn.disabled = false;
      }
    } catch {
      showToast('Erro ao enviar foto.', 'error');
      btn.innerHTML = origText;
      btn.disabled = false;
    }
  }

  function showCameraStep(step) {
    const camera = document.getElementById('fgCameraStep');
    const preview = document.getElementById('fgPreviewStep');
    if (camera) camera.style.display = step === 'camera' ? 'flex' : 'none';
    if (preview) preview.style.display = step === 'preview' ? 'flex' : 'none';
  }

  function closeCameraModal() {
    stopCamera();
    capturedPhoto = null;
    document.getElementById('flashCameraModal')?.classList.remove('show');
  }

  // ── Mural ─────────────────────────────────────────────────────────────────

  async function openMural() {
    closeMainModal();
    const modal = document.getElementById('flashMuralModal');
    const container = document.getElementById('fgMuralContainer');
    container.innerHTML = '<div class="fg-loading">⏳ A carregar mural...</div>';
    modal.classList.add('show');

    try {
      const data = await api('GET', { action: 'mural' });
      if (!data.success || !data.murals?.length) {
        container.innerHTML = '<div class="fg-empty">Nenhum mural publicado ainda.</div>';
        return;
      }
      container.innerHTML = data.murals.map(renderMuralCard).join('');

      container.querySelectorAll('.fg-vote-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const contestId = parseInt(btn.dataset.contestId);
          const subId = parseInt(btn.dataset.subId);
          btn.disabled = true;
          const result = await api('POST', {}, { action: 'vote', contest_id: contestId, submission_id: subId });
          if (result.success) {
            await openMural(); // refresh
          } else {
            showToast(result.error || 'Erro ao votar.', 'error');
            btn.disabled = false;
          }
        });
      });
    } catch {
      container.innerHTML = '<div class="fg-empty">Erro ao carregar mural.</div>';
    }
  }

  function renderMuralCard(mural) {
    const ws = new Date(String(mural.week_start).substring(0, 10) + 'T12:00:00');
    const we = new Date(ws); we.setDate(we.getDate() + 6);
    const fmt = d => d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
    const medals = ['🥇', '🥈', '🥉'];

    const photosHtml = mural.submissions.length
      ? mural.submissions.slice(0, 9).map(s => `
        <div class="fg-photo-card ${s.medal === 1 ? 'fg-gold' : s.medal === 2 ? 'fg-silver' : s.medal === 3 ? 'fg-bronze' : ''}">
          ${s.medal >= 1 && s.medal <= 3 ? `<div class="fg-medal-badge">${medals[s.medal - 1]}</div>` : ''}
          <img src="${s.photo_data}" class="fg-photo-img" loading="lazy" alt="Foto de ${escHtml(s.username)}">
          <div class="fg-photo-overlay">
            <span class="fg-photo-author">${escHtml(s.username)}</span>
            <button class="fg-vote-btn ${mural.myVote === s.id ? 'fg-voted' : ''}"
              data-contest-id="${mural.id}" data-sub-id="${s.id}">⭐ ${s.vote_count}</button>
          </div>
        </div>
      `).join('')
      : '<div class="fg-empty-photos">Sem fotos nesta semana</div>';

    return `
      <div class="fg-mural-card">
        <div class="fg-mural-card-header">
          <div class="fg-mural-week-label">Semana</div>
          <div class="fg-mural-theme-name">📷 ${escHtml(mural.theme)}</div>
          <div class="fg-mural-date-range">${fmt(ws)} – ${fmt(we)}</div>
          ${mural.description ? `<div style="font-size:12px;color:#bfdbfe;margin-top:4px;">${escHtml(mural.description)}</div>` : ''}
        </div>
        <div class="fg-photos-grid">${photosHtml}</div>
      </div>
    `;
  }

  function closeMuralModal() {
    document.getElementById('flashMuralModal')?.classList.remove('show');
  }

  // ── Ranking ───────────────────────────────────────────────────────────────

  async function openRanking() {
    closeMainModal();
    const modal = document.getElementById('flashRankingModal');
    const container = document.getElementById('fgRankingContainer');
    container.innerHTML = '<div class="fg-loading">⏳ A carregar ranking...</div>';
    modal.classList.add('show');

    try {
      const data = await api('GET', { action: 'ranking' });
      if (!data.success || !data.ranking?.length) {
        container.innerHTML = '<div class="fg-empty">Sem dados de ranking ainda.</div>';
        return;
      }
      const medals = ['🥇', '🥈', '🥉'];
      container.innerHTML = `
        <table class="fg-ranking-table">
          <thead>
            <tr><th>#</th><th>Técnico</th><th>⭐ Votos</th><th>Fotos</th><th>Medalhas</th></tr>
          </thead>
          <tbody>
            ${data.ranking.map((r, i) => `
              <tr class="${i < 3 ? 'fg-rank-top' : ''}">
                <td>${i < 3 ? medals[i] : i + 1}</td>
                <td>${escHtml(r.username)}</td>
                <td>${r.total_votes}</td>
                <td>${r.participations}</td>
                <td>${'🥇'.repeat(Number(r.gold))}${'🥈'.repeat(Number(r.silver))}${'🥉'.repeat(Number(r.bronze))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch {
      container.innerHTML = '<div class="fg-empty">Erro ao carregar ranking.</div>';
    }
  }

  function closeRankingModal() {
    document.getElementById('flashRankingModal')?.classList.remove('show');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showToast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
    const t = Object.assign(document.createElement('div'), { textContent: msg });
    Object.assign(t.style, {
      position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
      background: '#1e293b', color: '#fff', padding: '12px 20px',
      borderRadius: '10px', zIndex: '9999', fontSize: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // ── Expose ────────────────────────────────────────────────────────────────

  window.flashGlass = {
    openMainModal, closeMainModal,
    openCamera, closeCameraModal, capturePhoto, retakePhoto, confirmPhoto,
    openMural, closeMuralModal,
    openRanking, closeRankingModal
  };

  // Boot after authClient is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 600));
  } else {
    setTimeout(init, 600);
  }
})();
