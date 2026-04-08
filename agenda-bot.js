// ===== AGENDA BOT — Assistente de Agendamento com IA =====

(function() {
  let _botOpen = false;
  let _botHistory = []; // histórico da conversa

  function getBotContext() {
    // Agrupa agendamentos por dia com info relevante
    const today = new Date(); today.setHours(0,0,0,0);
    const next14 = new Date(today); next14.setDate(next14.getDate() + 14);

    const byDay = {};
    (window.appointments || []).forEach(a => {
      if (!a.date) return;
      const d = new Date(a.date); d.setHours(0,0,0,0);
      if (d < today || d > next14) return;
      if (!byDay[a.date]) byDay[a.date] = { date: a.date, services: [], localities: new Set(), totalKm: 0 };
      byDay[a.date].services.push({
        plate: a.plate, car: a.car, locality: a.locality || '—',
        service: a.service, km: a.km || 0
      });
      if (a.locality) byDay[a.date].localities.add(a.locality);
      if (a.km) byDay[a.date].totalKm += (a.km || 0);
    });

    const days = Object.values(byDay).map(d => ({
      date: d.date,
      weekday: new Date(d.date + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'long' }),
      count: d.services.length,
      localities: [...d.localities].join(', '),
      totalKm: d.totalKm,
      services: d.services
    })).sort((a,b) => a.date.localeCompare(b.date));

    const portal = window.portalConfig?.name || 'SM';
    const base = typeof getBasePartida === 'function' ? getBasePartida() : '—';

    return { portal, base, days, today: today.toISOString().slice(0,10) };
  }

  async function askBot(userMsg) {
    const ctx = getBotContext();

    const systemPrompt = `És um assistente especializado em otimização de rotas para a ExpressGlass, empresa de substituição de vidros automóveis em Portugal.
O teu objetivo é ajudar o coordenador a decidir o melhor dia para agendar um novo serviço numa determinada localidade, tendo em conta:
- Os serviços já agendados nos próximos 14 dias
- A proximidade geográfica entre localidades (usa o teu conhecimento sobre Portugal)
- A carga de trabalho por dia (máximo recomendado: 6-7 serviços/dia)
- A eficiência da rota (agrupar serviços próximos no mesmo dia)

Portal: ${ctx.portal}
Base de partida: ${ctx.base}
Data atual: ${ctx.today}

Agenda dos próximos 14 dias:
${ctx.days.length === 0 ? 'Sem serviços agendados.' : ctx.days.map(d =>
  `- ${d.weekday} ${d.date}: ${d.count} serviço(s) — Localidades: ${d.localities || '—'} — KM total estimado: ${d.totalKm}km`
).join('\n')}

Responde sempre em português europeu, de forma concisa e direta. Sugere sempre um dia específico com justificação clara. Se o coordenador perguntar algo fora do âmbito de agendamentos, redireciona educadamente.`;

    _botHistory.push({ role: 'user', content: userMsg });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: _botHistory
      })
    });

    const data = await response.json();
    const reply = data.content?.[0]?.text || 'Erro ao obter resposta.';
    _botHistory.push({ role: 'assistant', content: reply });

    // Limitar histórico a 10 mensagens
    if (_botHistory.length > 10) _botHistory = _botHistory.slice(-10);

    return reply;
  }

  function appendMessage(role, text) {
    const msgs = document.getElementById('botMessages');
    if (!msgs) return;
    const div = document.createElement('div');
    div.style.cssText = `
      display:flex; flex-direction:column; align-items:${role === 'user' ? 'flex-end' : 'flex-start'};
      margin-bottom:8px;
    `;
    div.innerHTML = `
      <div style="
        max-width:85%; padding:10px 13px; border-radius:${role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px'};
        background:${role === 'user' ? '#3b82f6' : '#f1f5f9'};
        color:${role === 'user' ? '#fff' : '#1e293b'};
        font-size:13px; line-height:1.5; white-space:pre-wrap;
      ">${text}</div>
    `;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function appendTyping() {
    const msgs = document.getElementById('botMessages');
    if (!msgs) return;
    const div = document.createElement('div');
    div.id = 'botTyping';
    div.style.cssText = 'display:flex;align-items:flex-start;margin-bottom:8px;';
    div.innerHTML = `
      <div style="padding:10px 14px;background:#f1f5f9;border-radius:14px 14px 14px 4px;font-size:13px;color:#64748b;">
        <span style="display:inline-flex;gap:4px;align-items:center;">
          <span style="width:6px;height:6px;background:#94a3b8;border-radius:50%;animation:botDot 1s infinite 0s"></span>
          <span style="width:6px;height:6px;background:#94a3b8;border-radius:50%;animation:botDot 1s infinite 0.2s"></span>
          <span style="width:6px;height:6px;background:#94a3b8;border-radius:50%;animation:botDot 1s infinite 0.4s"></span>
        </span>
      </div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTyping() {
    document.getElementById('botTyping')?.remove();
  }

  async function handleSend() {
    const input = document.getElementById('botInput');
    const msg = (input?.value || '').trim();
    if (!msg) return;
    input.value = '';
    input.disabled = true;
    document.getElementById('botSendBtn').disabled = true;

    appendMessage('user', msg);
    appendTyping();

    try {
      const reply = await askBot(msg);
      removeTyping();
      appendMessage('bot', reply);
    } catch(e) {
      removeTyping();
      appendMessage('bot', 'Erro ao contactar o assistente. Tenta novamente.');
      console.error('Bot error:', e);
    }

    input.disabled = false;
    input.disabled = false;
    document.getElementById('botSendBtn').disabled = false;
    input.focus();
  }

  function buildBotWidget() {
    if (document.getElementById('agendaBot')) return;

    // CSS animação dot
    const style = document.createElement('style');
    style.textContent = `
      @keyframes botDot { 0%,80%,100%{transform:scale(0.6);opacity:0.4} 40%{transform:scale(1);opacity:1} }
      #agendaBot * { box-sizing:border-box; }
      #botInput:focus { outline:none; border-color:#3b82f6; }
    `;
    document.head.appendChild(style);

    const widget = document.createElement('div');
    widget.id = 'agendaBot';
    widget.style.cssText = `
      position:fixed; bottom:20px; right:20px; z-index:10000;
      display:flex; flex-direction:column; align-items:flex-end; gap:8px;
      font-family:'Figtree',sans-serif;
    `;

    widget.innerHTML = `
      <!-- Botão toggle -->
      <button id="botToggle" onclick="window._toggleBot()" style="
        width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;
        background:linear-gradient(135deg,#3b82f6,#1d4ed8);
        color:#fff;font-size:22px;
        box-shadow:0 4px 16px rgba(59,130,246,0.45);
        display:flex;align-items:center;justify-content:center;
        transition:transform .15s;
      ">🤖</button>

      <!-- Janela do chat -->
      <div id="botWindow" style="
        display:none; flex-direction:column;
        width:320px; height:420px;
        background:#fff; border-radius:16px;
        box-shadow:0 8px 32px rgba(0,0,0,0.18);
        overflow:hidden; border:1px solid #e2e8f0;
      ">
        <!-- Header -->
        <div style="
          background:linear-gradient(135deg,#3b82f6,#1d4ed8);
          padding:12px 16px; display:flex; align-items:center; gap:10px;
        ">
          <div style="font-size:20px;">🤖</div>
          <div>
            <div style="color:#fff;font-weight:800;font-size:14px;">Assistente de Agenda</div>
            <div style="color:rgba(255,255,255,0.75);font-size:11px;">Sugere o melhor dia para agendar</div>
          </div>
          <button onclick="window._toggleBot()" style="
            margin-left:auto;background:rgba(255,255,255,0.15);border:none;
            color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;
          ">✕</button>
        </div>

        <!-- Mensagens -->
        <div id="botMessages" style="
          flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;
          background:#f8fafc;
        "></div>

        <!-- Input -->
        <div style="padding:10px;border-top:1px solid #e2e8f0;display:flex;gap:8px;background:#fff;">
          <input id="botInput" type="text" placeholder="Ex: Guimarães, para-brisas..."
            style="
              flex:1;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:10px;
              font-size:13px;font-family:inherit;
            "
            onkeydown="if(event.key==='Enter')window._botSend()"
          />
          <button id="botSendBtn" onclick="window._botSend()" style="
            padding:9px 14px;background:#3b82f6;color:#fff;border:none;
            border-radius:10px;cursor:pointer;font-size:16px;font-weight:700;
          ">➤</button>
        </div>
      </div>
    `;

    document.body.appendChild(widget);

    // Mensagem inicial
    setTimeout(() => {
      appendMessage('bot', 'Olá! 👋 Diz-me a localidade onde precisas de agendar um serviço e eu sugiro o melhor dia com base na agenda atual.');
    }, 300);
  }

  window._toggleBot = function() {
    const win = document.getElementById('botWindow');
    if (!win) return;
    _botOpen = !_botOpen;
    win.style.display = _botOpen ? 'flex' : 'none';
    if (_botOpen) document.getElementById('botInput')?.focus();
  };

  window._botSend = handleSend;

  // Inicializar apenas para coordenador e admin
  function init() {
    const role = window.authClient?.getUser?.()?.role;
    if (role === 'coordenador' || role === 'admin') {
      buildBotWidget();
    }
  }

  // Aguardar autenticação
  if (window.authClient?.getUser?.()?.role) {
    init();
  } else {
    window.addEventListener('authReady', init);
    setTimeout(init, 2000); // fallback
  }
})();
