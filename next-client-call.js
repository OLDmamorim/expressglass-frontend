(function (root, factory) {
  'use strict';

  const api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.nextClientCall = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  // Só quem anda de cliente em cliente é que tem um cliente seguinte para
  // avisar — o serviço móvel, ligeiros e pesados. Numa loja o cliente vem ter
  // com o técnico: a pergunta não tem destinatário e só atrapalha quem está a
  // fechar o serviço.
  const PORTAIS_COM_CHAMADA = ['sm', 'pesados'];

  // Sem tipo definido é 'sm', o mesmo que applyPortalConfig assume. Se aqui se
  // usasse outro valor por omissão, um portal SM ainda sem configuração lida
  // ficava sem a sugestão e ninguém perceberia porquê.
  function podeSugerirChamada(portalType) {
    const tipo = String(portalType || 'sm').toLowerCase();
    return PORTAIS_COM_CHAMADA.indexOf(tipo) >= 0;
  }

  function normalizeDate(value) {
    return value ? String(value).slice(0, 10) : '';
  }

  function normalizePhone(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const candidates = raw.match(/\+?\d[\d\s().-]*\d/g) || [];
    for (const candidate of candidates) {
      const digits = candidate.replace(/\D/g, '');
      if (digits.length >= 9) return /^\s*\+/.test(candidate) ? `+${digits}` : digits;
    }
    return '';
  }

  function extractPhone(value) {
    if (!value) return '';
    const match = String(value).match(/(?:\+?\d[\d\s().-]{7,}\d)/);
    return match ? match[0].trim() : '';
  }

  function getPhone(appointment) {
    if (!appointment) return '';
    const direct = appointment.phone || appointment.contact || appointment.telefone || '';
    const directNormalized = normalizePhone(direct);
    if (directNormalized) return directNormalized;

    const fallback = extractPhone(appointment.extra) || extractPhone(appointment.notes);
    return normalizePhone(fallback);
  }

  function isHandled(appointment) {
    return !!appointment && (
      appointment.executed === true ||
      (appointment.executed === false && !!appointment.not_done_reason) ||
      appointment.glass_removed === true
    );
  }

  function numberOrDefault(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function periodRank(period) {
    const normalized = String(period || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (normalized === 'manha') return 0;
    if (normalized === 'tarde') return 1;
    return 2;
  }

  function sortDailyAppointments(appointments, options) {
    const opts = options || {};
    const portalType = String(opts.portalType || '').toLowerCase();
    const isStore = !!opts.isStore;

    return (appointments || [])
      .map(function (appointment, originalIndex) {
        return { appointment, originalIndex };
      })
      .sort(function (left, right) {
        const a = left.appointment;
        const b = right.appointment;

        if (portalType === 'recalibra') {
          const byHour = String(a.period || '').localeCompare(String(b.period || ''));
          if (byHour) return byHour;
        } else if (isStore) {
          const byPeriod = periodRank(a.period) - periodRank(b.period);
          if (byPeriod) return byPeriod;
        } else {
          const aPin = a.first_of_day ? 0 : (a.second_of_day ? 1 : 2);
          const bPin = b.first_of_day ? 0 : (b.second_of_day ? 1 : 2);
          if (aPin !== bPin) return aPin - bPin;
        }

        const bySortIndex = numberOrDefault(a.sortIndex ?? a.sortindex, 1) -
          numberOrDefault(b.sortIndex ?? b.sortindex, 1);
        return bySortIndex || (left.originalIndex - right.originalIndex);
      })
      .map(function (entry) { return entry.appointment; });
  }

  function readRenderedOrder(currentId) {
    if (!root.document) return null;
    const isMobile = root.matchMedia
      ? root.matchMedia('(max-width: 820px)').matches
      : numberOrDefault(root.innerWidth, 1024) <= 820;
    if (!isMobile) return null;

    const ids = Array.from(root.document.querySelectorAll('#mobileDayList .appointment[data-id]'))
      .map(function (card) { return String(card.getAttribute('data-id')); });
    return ids.includes(String(currentId)) ? ids : null;
  }

  function buildContext(currentAppointment, appointments, options) {
    if (!currentAppointment || currentAppointment.id == null) return null;
    const date = normalizeDate(currentAppointment.date);
    if (!date) return null;

    const currentId = String(currentAppointment.id);
    const currentSnapshot = { ...currentAppointment, date };
    const dayAppointments = (appointments || [])
      .filter(function (appointment) { return normalizeDate(appointment.date) === date; })
      .map(function (appointment) {
        return String(appointment.id) === currentId ? currentSnapshot : { ...appointment };
      });

    if (!dayAppointments.some(function (appointment) { return String(appointment.id) === currentId; })) {
      dayAppointments.push(currentSnapshot);
    }

    const opts = options || {};
    const sorted = sortDailyAppointments(dayAppointments, opts);
    const snapshotsById = new Map(sorted.map(function (appointment) {
      return [String(appointment.id), appointment];
    }));

    const requestedRenderedIds = Array.isArray(opts.renderedIds) ? opts.renderedIds : null;
    const renderedIds = requestedRenderedIds && requestedRenderedIds.map(String).includes(currentId)
      ? requestedRenderedIds.map(String)
      : null;
    const orderedIds = renderedIds
      ? renderedIds.filter(function (id) { return snapshotsById.has(String(id)); }).map(String)
      : sorted.map(function (appointment) { return String(appointment.id); });

    return {
      currentId,
      date,
      orderedIds,
      snapshots: sorted.map(function (appointment) { return { ...appointment }; })
    };
  }

  function findNext(context, appointments) {
    if (!context || !Array.isArray(context.orderedIds)) return null;
    const currentIndex = context.orderedIds.indexOf(String(context.currentId));
    if (currentIndex < 0) return null;

    const latestById = new Map((appointments || []).map(function (appointment) {
      return [String(appointment.id), appointment];
    }));
    const snapshotsById = new Map((context.snapshots || []).map(function (appointment) {
      return [String(appointment.id), appointment];
    }));

    for (let index = currentIndex + 1; index < context.orderedIds.length; index += 1) {
      const id = String(context.orderedIds[index]);
      const latest = latestById.get(id);
      if (latest && normalizeDate(latest.date) !== context.date) continue;
      const candidate = latest || snapshotsById.get(id);
      if (!candidate || normalizeDate(candidate.date) !== context.date || isHandled(candidate)) continue;
      return candidate;
    }
    return null;
  }

  function getCallTarget(context, appointments) {
    const appointment = findNext(context, appointments);
    if (!appointment) return null;
    const phone = getPhone(appointment);
    return phone ? { appointment, phone } : null;
  }

  function portalAtual() {
    return root.portalConfig && root.portalConfig.portalType;
  }

  function capture(currentAppointment) {
    if (!podeSugerirChamada(portalAtual())) return null;

    let isStore = false;
    try {
      isStore = typeof root.isLoja === 'function' ? !!root.isLoja() : false;
    } catch (error) {}

    return buildContext(currentAppointment, root.appointments || [], {
      portalType: portalAtual(),
      isStore,
      renderedIds: readRenderedOrder(currentAppointment && currentAppointment.id)
    });
  }

  function ensureModal() {
    if (!root.document) return null;
    let modal = root.document.getElementById('nextClientCallModal');
    if (modal) return modal;

    modal = root.document.createElement('div');
    modal.id = 'nextClientCallModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'nextClientCallTitle');
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.68);align-items:center;justify-content:center;padding:18px;box-sizing:border-box;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:18px;padding:24px;max-width:390px;width:100%;box-shadow:0 24px 70px rgba(0,0,0,.35);font-family:Figtree,system-ui,sans-serif;">
        <div style="width:48px;height:48px;border-radius:50%;background:#dcfce7;color:#16a34a;display:flex;align-items:center;justify-content:center;font-size:25px;margin-bottom:14px;">📞</div>
        <h3 id="nextClientCallTitle" style="margin:0 0 7px;font-size:20px;font-weight:850;color:#0f172a;">Ligar ao próximo cliente?</h3>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.45;color:#64748b;">Queres ligar já para o contacto do serviço seguinte?</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin-bottom:18px;">
          <div id="nextClientCallService" style="font-size:15px;font-weight:800;color:#1e293b;"></div>
          <div id="nextClientCallCustomer" style="font-size:13px;color:#64748b;margin-top:3px;"></div>
          <div id="nextClientCallPhone" style="font-size:15px;font-weight:750;color:#16a34a;margin-top:5px;"></div>
        </div>
        <div style="display:flex;gap:10px;">
          <button type="button" data-next-call-no style="flex:1;padding:12px;border:1px solid #dbe2ea;border-radius:10px;background:#f8fafc;color:#475569;font-size:14px;font-weight:750;cursor:pointer;">Agora não</button>
          <button type="button" data-next-call-yes style="flex:1;padding:12px;border:0;border-radius:10px;background:#16a34a;color:#fff;font-size:14px;font-weight:850;cursor:pointer;">Sim, ligar</button>
        </div>
      </div>`;

    const close = function () { modal.style.display = 'none'; };
    modal.addEventListener('click', function (event) { if (event.target === modal) close(); });
    modal.querySelector('[data-next-call-no]').addEventListener('click', close);
    modal.querySelector('[data-next-call-yes]').addEventListener('click', function () {
      const phone = modal.dataset.phone || '';
      close();
      if (phone) root.location.href = `tel:${phone}`;
    });
    root.document.body.appendChild(modal);
    return modal;
  }

  function offer(context) {
    // Segunda barreira: um contexto capturado antes de se trocar de portal não
    // pode fazer aparecer a caixa onde ela não pertence.
    if (!podeSugerirChamada(portalAtual())) return false;

    const target = getCallTarget(context, root.appointments || []);
    if (!target) return false;
    const modal = ensureModal();
    if (!modal) return false;

    const appointment = target.appointment;
    const plate = String(appointment.plate || 'Serviço seguinte').toUpperCase();
    const car = String(appointment.car || '').trim();
    const customer = String(appointment.client_name || '').trim();
    modal.dataset.phone = target.phone;
    modal.querySelector('#nextClientCallService').textContent = car ? `${plate} · ${car}` : plate;
    modal.querySelector('#nextClientCallCustomer').textContent = customer || 'Próximo cliente da agenda';
    modal.querySelector('#nextClientCallPhone').textContent = target.phone;
    modal.style.display = 'flex';
    setTimeout(function () { modal.querySelector('[data-next-call-yes]')?.focus(); }, 0);
    return true;
  }

  function afterAnimation(context, animationPromise) {
    if (!context) return Promise.resolve(false);
    return Promise.resolve(animationPromise)
      .catch(function () {})
      .then(function () { return offer(context); })
      .catch(function (error) {
        console.warn('Não foi possível sugerir a chamada ao próximo cliente:', error);
        return false;
      });
  }

  return {
    afterAnimation,
    buildContext,
    capture,
    findNext,
    getCallTarget,
    getPhone,
    isHandled,
    normalizePhone,
    offer,
    podeSugerirChamada,
    sortDailyAppointments
  };
});
