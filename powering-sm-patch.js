// powering-sm-patch.js
// Corrige loadPoweringKpis para funcionar em todos os portais (Loja, SM, Pesados)
// usando portal_id em vez de poweringLojaId que não está em window.portalConfig.
// Carregar DEPOIS do script.js no index.html.

(function() {
  function aplicarPatch() {
    if (typeof loadPoweringKpis !== 'function' || typeof renderPoweringBanner !== 'function') {
      // script.js ainda não carregou — tentar de novo daqui a pouco
      return setTimeout(aplicarPatch, 200);
    }

    window.loadPoweringKpis = async function loadPoweringKpis() {
      const portalId = window.portalConfig?.id;
      if (!portalId) return;

      try {
        const url = `/.netlify/functions/powering-kpis?portal_id=${portalId}`;
        const resp = await window.authClient.authenticatedFetch(url);
        const data = await resp.json();
        if (data.success && data.kpis) {
          // Passar os dados ao renderPoweringBanner através de uma variável global
          // que vamos ler dentro do nosso wrapper de render
          window.__poweringKpisOverride = data.kpis;
          renderPoweringBanner();
        }
      } catch(e) {
        console.warn('PoweringEG KPIs não disponíveis:', e.message);
      }
    };

    // Wrapper do renderPoweringBanner: usa override se existir, senão chama o original
    const renderOriginal = window.renderPoweringBanner;
    window.renderPoweringBanner = function() {
      const k = window.__poweringKpisOverride;
      if (!k) return renderOriginal();

      // Replicar a lógica do banner original mas com os nossos dados
      const existing = document.getElementById('poweringKpiBanner');
      if (existing) existing.remove();

      const desvio = parseFloat(k.desvioPercent ?? k.desvioPct ?? 0);
      const desvioCor = desvio >= 0 ? '#16a34a' : '#dc2626';
      const desvioBg  = desvio >= 0 ? '#f0fdf4' : '#fef2f2';
      const desvioIcon = desvio >= 0 ? '↑' : '↓';

      const now = new Date();
      const mesNome = now.toLocaleDateString('pt-PT', {month:'long', year:'numeric'});

      const banner = document.createElement('div');
      banner.id = 'poweringKpiBanner';
      banner.style.cssText = 'margin:0;background:#fff;border-bottom:1px solid #e5e7eb;padding:8px 16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;';
      banner.innerHTML = `
        <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;">
          📊 ${mesNome}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <div style="background:#eff6ff;border-radius:8px;padding:5px 12px;text-align:center;">
            <div style="font-size:18px;font-weight:800;color:#2563eb;line-height:1;">${k.servicos ?? 0}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:1px;">Serviços</div>
          </div>
          <div style="background:#f5f3ff;border-radius:8px;padding:5px 12px;text-align:center;">
            <div style="font-size:18px;font-weight:800;color:#7c3aed;line-height:1;">${k.objetivo ?? 0}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:1px;">Objetivo</div>
          </div>
          <div style="background:${desvioBg};border-radius:8px;padding:5px 12px;text-align:center;">
            <div style="font-size:18px;font-weight:800;color:${desvioCor};line-height:1;">${desvioIcon}${Math.abs(desvio)}%</div>
            <div style="font-size:10px;color:#6b7280;margin-top:1px;">Desvio diário</div>
          </div>
          <div style="background:#f0fdf4;border-radius:8px;padding:5px 12px;text-align:center;">
            <div style="font-size:18px;font-weight:800;color:#16a34a;line-height:1;">${k.taxa ?? 0}%</div>
            <div style="font-size:10px;color:#6b7280;margin-top:1px;">Taxa rep.</div>
          </div>
        </div>`;

      const schedule = document.getElementById('schedule');
      if (schedule) {
        schedule.parentElement.insertBefore(banner, schedule);
      } else {
        const mobileHeader = document.getElementById('mobileHeader') || document.querySelector('.mobile-day-header');
        if (mobileHeader) mobileHeader.after(banner);
        else (document.querySelector('main') || document.querySelector('#app') || document.body).prepend(banner);
      }
    };

    // Disparar imediatamente para o portal actual
    if (window.portalConfig?.id) {
      window.loadPoweringKpis();
    } else {
      // Esperar pelo evento portalReady caso ainda não esteja carregado
      window.addEventListener('portalReady', () => window.loadPoweringKpis(), { once: true });
    }

    console.log('✅ Patch PoweringEG aplicado (suporta Loja + SM + Pesados)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aplicarPatch);
  } else {
    aplicarPatch();
  }
})();
