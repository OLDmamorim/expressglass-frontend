// pwa-install.js
// Mostra um botão/banner "Instalar app" no Android Chrome
// e dispara o prompt nativo de instalação da PWA.

(function() {
  let deferredPrompt = null;

  // O Chrome dispara este evento quando deteta que a PWA é instalável
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    mostrarBanner();
  });

  // Quando o utilizador instala
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    esconderBanner();
    console.log('✅ PWA instalada');
  });

  function mostrarBanner() {
    if (document.getElementById('pwaInstallBanner')) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return; // já instalada

    // Verificar se utilizador já dispensou recentemente (24h)
    const dispensado = localStorage.getItem('pwaInstallDismissed');
    if (dispensado && (Date.now() - parseInt(dispensado)) < 86400000) return;

    const banner = document.createElement('div');
    banner.id = 'pwaInstallBanner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #1e293b;
      color: white;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 99999;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      font-family: 'Figtree', sans-serif;
    `;
    banner.innerHTML = `
      <button id="pwaCloseBtn" style="background:none;border:none;color:#94a3b8;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;">×</button>
      <button id="pwaCollapseBtn" style="background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;padding:0 4px;line-height:1;">⌄</button>
      <div style="flex:1;display:flex;align-items:center;gap:10px;min-width:0;">
        <img src="/icon-192.png" alt="" style="width:36px;height:36px;border-radius:8px;flex-shrink:0;">
        <div style="min-width:0;">
          <div style="font-weight:700;font-size:14px;line-height:1.2;">Agendamentos EG</div>
          <div style="font-size:11px;color:#cbd5e1;line-height:1.2;margin-top:2px;">Instale a aplicação</div>
        </div>
      </div>
      <button id="pwaInstallBtn" style="background:#3b82f6;color:white;border:none;padding:8px 16px;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;">Instalar</button>
    `;
    document.body.prepend(banner);

    // Empurrar o conteúdo para baixo
    document.body.style.paddingTop = banner.offsetHeight + 'px';

    document.getElementById('pwaInstallBtn').onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('Escolha do utilizador:', outcome);
      deferredPrompt = null;
      esconderBanner();
    };

    document.getElementById('pwaCloseBtn').onclick = () => {
      localStorage.setItem('pwaInstallDismissed', String(Date.now()));
      esconderBanner();
    };

    document.getElementById('pwaCollapseBtn').onclick = () => {
      esconderBanner();
    };
  }

  function esconderBanner() {
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.remove();
    document.body.style.paddingTop = '';
  }
})();
