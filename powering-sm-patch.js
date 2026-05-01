// powering-sm-patch.js
// Corrige loadPoweringKpis para funcionar em todos os portais (Loja, SM, Pesados)
// usando portal_id em vez de poweringLojaId que não está em window.portalConfig.
// Carregar DEPOIS do script.js no index.html.

(function() {
  function aplicarPatch() {
    if (typeof loadPoweringKpis !== 'function') {
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
          window._poweringKpis = data.kpis;
          window._poweringKpisLoaded = true;
          if (typeof renderPoweringBanner === 'function') renderPoweringBanner();
        }
      } catch(e) {
        console.warn('PoweringEG KPIs não disponíveis:', e.message);
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
