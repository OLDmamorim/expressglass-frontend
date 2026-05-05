// glass-alert-urgent.js
// Pop-up bloqueante para coordenadores: aparece ≥09:30 e ≥14:30
// com aviso urgente para encomendar vidros pendentes.
// "Já tratei" → guarda dia no localStorage → não volta a aparecer hoje.

(function() {
  const HORAS_ALVO = [
    { h: 9,  m: 30, slot: 'manha' },
    { h: 14, m: 30, slot: 'tarde' }
  ];

  function getSlotAtual() {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    let slot = null;
    for (const t of HORAS_ALVO) {
      if (minutes >= t.h * 60 + t.m) slot = t.slot;
    }
    return slot;
  }

  function jaFoiTratadoHoje(slot) {
    if (!slot) return true;
    const key = `glassUrgentTreated_${slot}`;
    const lastTreated = localStorage.getItem(key);
    if (!lastTreated) return false;
    // Comparar só dia/mês/ano
    const last = new Date(lastTreated);
    const hoje = new Date();
    return last.toDateString() === hoje.toDateString();
  }

  function marcarTratado(slot) {
    if (!slot) return;
    localStorage.setItem(`glassUrgentTreated_${slot}`, new Date().toISOString());
  }

  async function contarVidrosPendentes() {
    // Replicar lógica do glass-alert.js: contar pedidos NE/VE para próximos 3 dias
    try {
      const portalId = window.portalConfig?.id;
      if (!portalId) return 0;
      const token = window.authClient?.getToken?.() || localStorage.getItem('authToken');
      const resp = await fetch(`/.netlify/functions/appointments?portal_id=${portalId}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await resp.json();
      if (!data.success || !Array.isArray(data.data)) return 0;

      const hoje = new Date(); hoje.setHours(0,0,0,0);
      const limite = new Date(hoje); limite.setDate(limite.getDate() + 3);

      const pendentes = data.data.filter(a => {
        if (!a.date) return false;
        const d = new Date(a.date);
        if (isNaN(d)) return false;
        d.setHours(0,0,0,0);
        if (d < hoje || d > limite) return false;
        return a.status === 'NE' || a.status === 'V/E' || a.status === 'VE' || a.status === 'N/E';
      });
      return pendentes.length;
    } catch(e) {
      console.warn('Erro a contar vidros pendentes:', e);
      return 0;
    }
  }

  function injectStyles() {
    if (document.getElementById('glassUrgentStyles')) return;
    const style = document.createElement('style');
    style.id = 'glassUrgentStyles';
    style.textContent = `
      @keyframes glassUrgentPulse {
        0%, 100% { color: #dc2626; transform: scale(1); }
        50%      { color: #fbbf24; transform: scale(1.05); }
      }
      #glassUrgentOverlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.85);
        z-index: 999999;
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        animation: glassUrgentFade .25s ease-in;
      }
      @keyframes glassUrgentFade { from { opacity: 0; } to { opacity: 1; } }
      #glassUrgentBox {
        background: #fff;
        border: 6px solid #dc2626;
        border-radius: 18px;
        max-width: 560px; width: 100%;
        text-align: center;
        padding: 40px 24px 28px;
        box-shadow: 0 25px 80px rgba(220,38,38,0.45);
      }
      #glassUrgentBox .icon { font-size: 64px; margin-bottom: 8px; }
      #glassUrgentBox .title {
        font-size: 28px; font-weight: 900;
        line-height: 1.15;
        animation: glassUrgentPulse 0.7s infinite;
        margin: 0 0 12px;
        text-transform: uppercase;
      }
      #glassUrgentBox .sub {
        font-size: 17px; font-weight: 700;
        color: #1e293b;
        margin: 0 0 24px;
        line-height: 1.4;
      }
      #glassUrgentBox button {
        background: #16a34a; color: #fff; border: none;
        font-size: 18px; font-weight: 800;
        padding: 14px 36px; border-radius: 12px;
        cursor: pointer;
        transition: background .15s;
      }
      #glassUrgentBox button:hover { background: #15803d; }
      #glassUrgentBox .imprimir {
        background: #2563eb;
        margin-right: 10px;
      }
      #glassUrgentBox .imprimir:hover { background: #1d4ed8; }
      @media (max-width: 480px) {
        #glassUrgentBox .title { font-size: 22px; }
        #glassUrgentBox .sub   { font-size: 15px; }
        #glassUrgentBox button { padding: 12px 22px; font-size: 16px; }
      }
    `;
    document.head.appendChild(style);
  }

  function mostrarPopup(numVidros, slot) {
    if (document.getElementById('glassUrgentOverlay')) return;
    injectStyles();

    const overlay = document.createElement('div');
    overlay.id = 'glassUrgentOverlay';
    overlay.innerHTML = `
      <div id="glassUrgentBox">
        <div class="icon">⚠️</div>
        <h1 class="title">Existem ${numVidros} vidros para encomendar!</h1>
        <p class="sub">Imprime a listagem e encomenda os vidros antes de continuar.</p>
        <button class="imprimir" id="glassUrgentVer">📋 Ver e imprimir</button>
        <button id="glassUrgentTratado">✅ Já tratei</button>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('glassUrgentVer').onclick = () => {
      // Abre o modal existente sem fechar este popup
      if (typeof openGlassAlertModal === 'function') openGlassAlertModal();
    };

    document.getElementById('glassUrgentTratado').onclick = () => {
      marcarTratado(slot);
      overlay.remove();
    };
  }

  async function verificar() {
    // Só para coordenadores
    const role = window.authClient?.getUser?.()?.role;
    if (role !== 'coordenador') return;

    const slot = getSlotAtual();
    if (!slot) return;
    if (jaFoiTratadoHoje(slot)) return;

    const num = await contarVidrosPendentes();
    if (num > 0) mostrarPopup(num, slot);
  }

  function init() {
    // Verificar 3 segundos depois de carregar (espera authClient e portalConfig)
    setTimeout(verificar, 3000);
    // Re-verificar a cada 5 minutos (caso o utilizador deixe a página aberta)
    setInterval(verificar, 5 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
