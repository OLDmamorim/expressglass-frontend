// flash-glass-admin.js — Admin panel for Flash Glass photo contest
(function () {
  'use strict';

  let activeContestId = null;
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

  async function loadContests() {
    const list = document.getElementById('fgContestsList');
    if (!list) return;
    list.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:32px;">A carregar...</div>';
    try {
      const data = await api('GET', { action: 'all-contests' });
      if (!data.success) { list.innerHTML = '<div style="color:#dc2626;padding:20px;">Erro ao carregar concursos.</div>'; return; }
      if (!data.contests.length) {
        list.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:32px;">Nenhum concurso criado ainda. Clique em "+ Novo Concurso" para começar.</div>';
        return;
      }
      list.innerHTML = data.contests.map(c => renderContestRow(c)).join('');
    } catch (e) {
      list.innerHTML = `<div style="color:#dc2626;padding:20px;">Erro: ${e.message}</div>`;
    }
  }

  function renderContestRow(c) {
    const rawDate = String(c.week_start).substring(0, 10);
    const ws = new Date(rawDate + 'T12:00:00');
    const we = new Date(ws); we.setDate(we.getDate() + 6);
    const fmt = d => d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' });
    const badge = c.published
      ? '<span class="fg-contest-badge fg-badge-published">✓ Publicado</span>'
      : '<span class="fg-contest-badge fg-badge-pending">⏳ Pendente</span>';
    return `
      <div class="fg-contest-row">
        <div class="fg-contest-info">
          <div class="fg-contest-week">${fmt(ws)} – ${fmt(we)}</div>
          <div class="fg-contest-theme">${escHtml(c.theme)}</div>
          <div class="fg-contest-meta">${c.submission_count} submissões${c.description ? ' · ' + escHtml(c.description) : ''}</div>
        </div>
        ${badge}
        <div style="display:flex;gap:8px;">
          <button class="fg-btn-view" onclick="fgAdmin.viewSubmissions('${c.week_start}', ${c.id}, ${c.published})">👁 Ver Fotos</button>
          ${!c.published ? `<button onclick="fgAdmin.editContest(${c.id}, '${c.week_start}', '${escHtml(c.theme)}', '${escHtml(c.description || '')}')" style="padding:7px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;">✏️ Editar</button>` : ''}
        </div>
      </div>
    `;
  }

  async function viewSubmissions(weekStart, contestId, published) {
    activeContestId = contestId;
    const panel = document.getElementById('fgAdminSubmissionsPanel');
    const grid = document.getElementById('fgAdminSubsGrid');
    const titleEl = document.getElementById('fgSubmissionsPanelTitle');
    const publishBtn = document.getElementById('fgPublishBtn');

    const ws = new Date(weekStart + 'T12:00:00');
    const we = new Date(ws); we.setDate(we.getDate() + 6);
    const fmt = d => d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
    if (titleEl) titleEl.textContent = `Submissões — ${fmt(ws)} a ${fmt(we)}`;
    if (publishBtn) publishBtn.style.display = published ? 'none' : '';

    panel.style.display = 'block';
    grid.innerHTML = '<div style="color:#94a3b8;padding:20px;">A carregar...</div>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const data = await api('GET', { action: 'week-submissions', week_start: weekStart });
      if (!data.success) { grid.innerHTML = '<div style="color:#dc2626;">Erro ao carregar.</div>'; return; }
      if (!data.submissions.length) {
        grid.innerHTML = '<div style="color:#94a3b8;padding:20px;">Sem submissões ainda nesta semana.</div>';
        return;
      }
      const medals = ['', '🥇', '🥈', '🥉'];
      grid.innerHTML = data.submissions.map(s => `
        <div class="fg-admin-sub-card">
          <img src="${s.photo_data}" alt="${escHtml(s.username)}" loading="lazy">
          <div class="fg-admin-sub-info">
            ${medals[s.medal] || ''} ${escHtml(s.username)}
            <small>⭐ ${s.vote_count} votos</small>
            <small>${new Date(s.submitted_at).toLocaleDateString('pt-PT')}</small>
          </div>
        </div>
      `).join('');
    } catch (e) {
      grid.innerHTML = `<div style="color:#dc2626;">Erro: ${e.message}</div>`;
    }
  }

  function closeSubmissions() {
    document.getElementById('fgAdminSubmissionsPanel').style.display = 'none';
    activeContestId = null;
  }

  async function publishMural() {
    if (!activeContestId) return;
    if (!confirm('Publicar o mural desta semana? Esta ação atribui as medalhas com base nos votos atuais.')) return;
    try {
      const data = await api('POST', {}, { action: 'publish-mural', contest_id: activeContestId });
      if (data.success) {
        showAdminToast('✅ Mural publicado com sucesso!', 'success');
        closeSubmissions();
        loadContests();
      } else {
        showAdminToast(data.error || 'Erro ao publicar.', 'error');
      }
    } catch (e) {
      showAdminToast('Erro: ' + e.message, 'error');
    }
  }

  function openCreateForm() {
    const form = document.getElementById('fgCreateForm');
    form.style.display = 'block';
    // Default to current week's Monday
    const today = new Date();
    const day = today.getDay();
    const daysToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - daysToMonday);
    document.getElementById('fgWeekStart').value = monday.toISOString().split('T')[0];
    document.getElementById('fgThemeInput').value = '';
    document.getElementById('fgDescInput').value = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeCreateForm() {
    document.getElementById('fgCreateForm').style.display = 'none';
  }

  function editContest(id, weekStart, theme, desc) {
    openCreateForm();
    document.getElementById('fgWeekStart').value = weekStart;
    document.getElementById('fgThemeInput').value = theme;
    document.getElementById('fgDescInput').value = desc;
  }

  async function saveContest() {
    const weekStart = document.getElementById('fgWeekStart').value;
    const theme = document.getElementById('fgThemeInput').value.trim();
    const desc = document.getElementById('fgDescInput').value.trim();
    if (!weekStart || !theme) { showAdminToast('Preenche a semana e o tema.', 'error'); return; }

    // Ensure it's a Monday
    const d = new Date(weekStart + 'T12:00:00');
    if (d.getDay() !== 1) { showAdminToast('A data deve ser uma segunda-feira.', 'error'); return; }

    try {
      const data = await api('POST', {}, { action: 'create-contest', week_start: weekStart, theme, description: desc });
      if (data.success) {
        showAdminToast('✅ Concurso guardado!', 'success');
        closeCreateForm();
        loadContests();
      } else {
        showAdminToast(data.error || 'Erro ao guardar.', 'error');
      }
    } catch (e) {
      showAdminToast('Erro: ' + e.message, 'error');
    }
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showAdminToast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
    const el = Object.assign(document.createElement('div'), { textContent: msg });
    Object.assign(el.style, {
      position: 'fixed', bottom: '30px', right: '30px',
      background: type === 'error' ? '#dc2626' : '#16a34a',
      color: '#fff', padding: '12px 20px', borderRadius: '10px',
      zIndex: '9999', fontSize: '14px', fontWeight: '600',
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // Hook into admin tab switching
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.dataset.tab === 'flashglass') loadContests();
      });
    });
  });

  window.fgAdmin = { openCreateForm, closeCreateForm, saveContest, editContest, viewSubmissions, closeSubmissions, publishMural, loadContests };
})();
