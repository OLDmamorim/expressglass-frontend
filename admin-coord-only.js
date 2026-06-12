// admin-coord-only.js
// Para coordenadores no admin.html: esconder tabs de admin puro, manter Relatórios/Check-in/Pesquisa/Alertas.

(function() {
  function aplicar() {
    const role = window.authClient?.getUser?.()?.role;
    if (role !== 'coordenador') return;

    // 1) Esconder TUDO no header (logo, vista comercial, agendas, nome user)
    //    excepto o botão Sair
    const header = document.querySelector('.admin-header, header');
    if (header) {
      header.querySelectorAll('a, button, img').forEach(el => {
        if (el.id === 'logoutBtn') return; // manter botão Sair
        if (el.textContent && /sair/i.test(el.textContent)) return; // manter qualquer "Sair"
        el.style.display = 'none';
      });
      // Substituir título do header por um simples
      const h1 = header.querySelector('h1, h2, .header-title');
      if (h1) {
        h1.style.display = '';
        h1.textContent = '📊 Relatórios';
      }
      // Adicionar botão "Voltar à agenda" antes do Sair (se ainda não existir)
      if (!document.getElementById('btnVoltarAgenda')) {
        const btnVoltar = document.createElement('button');
        btnVoltar.id = 'btnVoltarAgenda';
        btnVoltar.textContent = '← Voltar à agenda';
        btnVoltar.style.cssText = 'background:#fff;color:#2563eb;border:none;padding:8px 16px;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;margin-right:8px;';
        btnVoltar.onclick = () => { window.location.href = '/'; };
        const sair = document.getElementById('logoutBtn') ||
                     [...header.querySelectorAll('a,button')].find(el => /sair/i.test(el.textContent));
        if (sair && sair.parentNode) {
          sair.parentNode.insertBefore(btnVoltar, sair);
        } else {
          header.appendChild(btnVoltar);
        }
      }
    }

    // 2) Esconder tabs de admin puro; manter Relatórios, Check-in, Pesquisa, Alertas
    const coordTabs = ['reports', 'checkins', 'search', 'alerts'];
    document.querySelectorAll('.nav-tab').forEach(tab => {
      if (!coordTabs.includes(tab.dataset.tab)) {
        tab.style.display = 'none';
      }
    });

    // 3) Esconder conteúdo de tabs admin puro
    const coordContent = ['reportsTab', 'checkinsTab', 'searchTab', 'alertsTab'];
    document.querySelectorAll('.tab-content').forEach(t => {
      if (!coordContent.includes(t.id)) t.style.display = 'none';
    });

    console.log('✅ Modo coordenador: Relatórios, Check-in, Pesquisa e Alertas visíveis');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(aplicar, 200));
  } else {
    setTimeout(aplicar, 200);
  }
})();
