'use strict';

function asText(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeEurocode(value) {
  let raw = asText(value);
  if (!raw) return '';

  // Some legacy rows contain the whole internal JSON instead of the value.
  for (let i = 0; i < 5 && raw; i++) {
    if (raw[0] !== '{' && raw[0] !== '"') break;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        raw = asText(parsed.eurocode);
        continue;
      }
      if (typeof parsed === 'string') {
        raw = parsed.trim();
        continue;
      }
    } catch (_) {
      break;
    }
    break;
  }

  const prefix = raw[0] === '#' || raw[0] === '*' ? raw[0] : '';
  const body = (prefix ? raw.slice(1) : raw)
    .toUpperCase()
    .replace(/I/g, '1')
    .replace(/O/g, '0')
    .replace(/[^A-Z0-9]/g, '');

  return body ? prefix + body : '';
}

function normalizeOrderRef(value) {
  let key = asText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  for (const prefix of ['encomendaaxial', 'encaxial', 'encomenda', 'enc']) {
    if (key.startsWith(prefix) && key.length > prefix.length) {
      key = key.slice(prefix.length);
      break;
    }
  }

  return key;
}

function normalizePlate(value) {
  return asText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function eurocodesInText(value) {
  const text = asText(value);
  if (!text) return [];

  const matches = text.match(/[#*]?\d{4}[A-Z0-9]{2,}/gi) || [];
  return [...new Set(matches.map(normalizeEurocode).filter(Boolean))];
}

function appointmentEurocodes(appointment) {
  const values = [];
  const direct = normalizeEurocode(appointment.glass_eurocode);
  if (direct) values.push(direct);

  const extra = asText(appointment.extra);
  if (extra) {
    try {
      const parsed = JSON.parse(extra);
      const parsedValue = normalizeEurocode(parsed && typeof parsed === 'object' ? parsed.eurocode : parsed);
      if (parsedValue) values.push(parsedValue);
    } catch (_) {
      const plainValue = normalizeEurocode(extra);
      if (plainValue && /^\D?\d{4}[A-Z0-9]{2,}$/i.test(plainValue)) values.push(plainValue);
    }
    values.push(...eurocodesInText(extra));
  }

  values.push(...eurocodesInText(appointment.notes));
  return [...new Set(values)];
}

function appointmentOrderRefs(appointment) {
  const values = [
    normalizeOrderRef(appointment.order_ref),
    normalizeOrderRef(appointment.n_obra)
  ].filter(Boolean);

  for (const raw of [appointment.notes, appointment.extra]) {
    const tokens = asText(raw).match(/[A-Z0-9]+/gi) || [];
    for (const token of tokens) {
      const normalized = normalizeOrderRef(token);
      if (normalized.length >= 4) values.push(normalized);
    }
  }

  return [...new Set(values)];
}

function prepareAppointment(appointment) {
  if (appointment && appointment._match_eurocodes && appointment._match_order_refs) return appointment;
  return {
    ...appointment,
    _match_eurocodes: appointmentEurocodes(appointment),
    _match_order_refs: appointmentOrderRefs(appointment)
  };
}

function createCandidateIndex(appointments) {
  const prepared = (appointments || []).map(prepareAppointment);
  const byEurocode = new Map();
  const byOrder = new Map();

  for (const appointment of prepared) {
    for (const eurocode of appointment._match_eurocodes) {
      if (!byEurocode.has(eurocode)) byEurocode.set(eurocode, []);
      byEurocode.get(eurocode).push(appointment);
    }
    for (const orderRef of appointment._match_order_refs) {
      if (!byOrder.has(orderRef)) byOrder.set(orderRef, []);
      byOrder.get(orderRef).push(appointment);
    }
  }

  return { _glass_reception_match_index: true, prepared, byEurocode, byOrder };
}

function containsOrderRef(value, expected) {
  const key = normalizeOrderRef(expected);
  if (!key) return false;

  const text = asText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!text) return false;

  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^a-z0-9])(?:enc(?:omenda)?[.\\s-]*axial[.\\s-]*)?${escaped}(?=$|[^a-z0-9])`, 'i');
  return pattern.test(text);
}

function appointmentMatchesOrder(appointment, orderRef) {
  const expected = normalizeOrderRef(orderRef);
  if (!expected) return false;

  if (appointment._match_order_refs) return appointment._match_order_refs.includes(expected);

  return normalizeOrderRef(appointment.order_ref) === expected
    || normalizeOrderRef(appointment.n_obra) === expected
    || containsOrderRef(appointment.notes, expected)
    || containsOrderRef(appointment.extra, expected);
}

function appointmentMatchesEurocode(appointment, eurocode) {
  const expected = normalizeEurocode(eurocode);
  const values = appointment._match_eurocodes || appointmentEurocodes(appointment);
  return !!expected && values.includes(expected);
}

function dateDistance(reception, appointment) {
  const received = Date.parse(reception.created_at || '');
  const scheduled = Date.parse(appointment.date || '');
  if (!Number.isFinite(received) || !Number.isFinite(scheduled)) return Number.MAX_SAFE_INTEGER;
  return Math.abs(received - scheduled);
}

function candidateSummary(reception, appointment) {
  const eurocodeMatch = appointmentMatchesEurocode(appointment, reception.eurocode);
  const orderMatch = appointmentMatchesOrder(appointment, reception.order_ref);
  return {
    ...appointment,
    eurocode_match: eurocodeMatch,
    order_match: orderMatch,
    match_score: (orderMatch ? 2 : 0) + (eurocodeMatch ? 1 : 0),
    _date_distance: dateDistance(reception, appointment)
  };
}

function findCandidates(reception, appointments) {
  const eurocodeKey = normalizeEurocode(reception.eurocode);
  const orderKey = normalizeOrderRef(reception.order_ref);
  const hasEurocode = !!eurocodeKey;
  const hasOrder = !!orderKey;
  if (!hasEurocode && !hasOrder) return [];

  let candidatePool = appointments || [];
  if (appointments?._glass_reception_match_index) {
    const indexed = [
      ...(hasEurocode ? (appointments.byEurocode.get(eurocodeKey) || []) : []),
      ...(hasOrder ? (appointments.byOrder.get(orderKey) || []) : [])
    ];
    const seen = new Set();
    candidatePool = indexed.filter(appointment => {
      const key = String(appointment.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const matched = candidatePool
    .map(appointment => candidateSummary(reception, prepareAppointment(appointment)))
    .filter(candidate => candidate.eurocode_match || candidate.order_match);

  let candidates = matched;
  if (hasEurocode && hasOrder) {
    const both = matched.filter(candidate => candidate.eurocode_match && candidate.order_match);
    const byOrder = matched.filter(candidate => candidate.order_match);
    candidates = both.length ? both : (byOrder.length ? byOrder : matched.filter(candidate => candidate.eurocode_match));
  } else if (hasOrder) {
    candidates = matched.filter(candidate => candidate.order_match);
  } else {
    candidates = matched.filter(candidate => candidate.eurocode_match);
  }

  return candidates
    .sort((a, b) => b.match_score - a.match_score
      || a._date_distance - b._date_distance
      || String(b.date || '').localeCompare(String(a.date || ''))
      || Number(b.id || 0) - Number(a.id || 0))
    .map(({ _date_distance, ...candidate }) => candidate);
}

module.exports = {
  appointmentEurocodes,
  appointmentOrderRefs,
  appointmentMatchesEurocode,
  appointmentMatchesOrder,
  containsOrderRef,
  createCandidateIndex,
  findCandidates,
  normalizeEurocode,
  normalizeOrderRef,
  normalizePlate
};
