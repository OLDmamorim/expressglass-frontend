(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PitStopCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 'expressglass-impacto-v4';
  const MIN_RUN_MS = 3000;
  const MAX_RUN_MS = 30 * 60 * 1000;
  const REPAIR_COST = 45;
  const REPAIR_POWER = 30;
  const REPAIR_LIMIT = 75;
  const REPLACE_COST = 150;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function integer(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  }

  function normalizeRun(rawRun) {
    const run = rawRun && typeof rawRun === 'object' ? rawRun : {};
    return {
      durationMs: clamp(integer(run.durationMs, 0), 0, MAX_RUN_MS),
      distanceM: clamp(integer(run.distanceM, 0), 0, 1000000),
      dodged: clamp(integer(run.dodged, 0), 0, 100000),
      hits: clamp(integer(run.hits, 0), 0, 10000),
      repairs: clamp(integer(run.repairs, 0), 0, 1000),
      replacements: clamp(integer(run.replacements, 0), 0, 1000),
      bonuses: clamp(integer(run.bonuses, 0), 0, 10000),
      maxCombo: clamp(integer(run.maxCombo, 0), 0, 100000),
      endingDamage: clamp(integer(run.endingDamage, 0), 0, 100)
    };
  }

  function dodgeCredits(size, combo, doubled) {
    const base = size === 'large' ? 18 : size === 'medium' ? 12 : 8;
    const safeCombo = clamp(integer(combo, 0), 0, 1000);
    const comboFactor = 1 + Math.min(1.5, Math.floor(safeCombo / 5) * 0.15);
    return Math.round(base * comboFactor * (doubled ? 2 : 1));
  }

  function dragLane(startLane, deltaX, viewportWidth) {
    const safeStart = Number.isFinite(Number(startLane)) ? Number(startLane) : 0;
    const safeDelta = Number.isFinite(Number(deltaX)) ? Number(deltaX) : 0;
    const safeWidth = clamp(Number(viewportWidth) || 1, 1, 10000);
    const laneTravel = clamp(safeWidth * .18, 54, 96);
    return clamp(safeStart + safeDelta / laneTravel, -1, 1);
  }

  function serviceQuote(type, damage) {
    const safeDamage = clamp(integer(damage, 0), 0, 100);
    if (type === 'repair') {
      return {
        type,
        cost: REPAIR_COST,
        restore: REPAIR_POWER,
        allowed: safeDamage > 0 && safeDamage < REPAIR_LIMIT,
        reason: safeDamage >= REPAIR_LIMIT
          ? 'O vidro está demasiado danificado para reparar'
          : safeDamage === 0
            ? 'O vidro não tem danos'
            : ''
      };
    }
    if (type === 'replace') {
      return {
        type,
        cost: REPLACE_COST,
        restore: 100,
        allowed: safeDamage > 0,
        reason: safeDamage === 0 ? 'O vidro já está novo' : ''
      };
    }
    return { type, cost: 0, restore: 0, allowed: false, reason: 'Serviço inválido' };
  }

  function applyService(state, type, free) {
    const current = state && typeof state === 'object' ? state : {};
    const damage = clamp(integer(current.damage, 0), 0, 100);
    const credits = Math.max(0, integer(current.credits, 0));
    const quote = serviceQuote(type, damage);
    const cost = free ? 0 : quote.cost;

    if (!quote.allowed) {
      return { ok: false, damage, credits, reason: quote.reason };
    }
    if (credits < cost) {
      return { ok: false, damage, credits, reason: 'Pontos insuficientes' };
    }

    return {
      ok: true,
      damage: type === 'replace' ? 0 : Math.max(0, damage - quote.restore),
      credits: credits - cost,
      cost
    };
  }

  // O ranking é decidido pelo tempo sobrevivido. Os pontos recolhidos são
  // moeda de oficina e nunca conseguem ultrapassar artificialmente o tempo.
  function calculateScore(rawRun) {
    return normalizeRun(rawRun).durationMs;
  }

  function validateRun(rawRun, wallElapsedMs) {
    if (!rawRun || typeof rawRun !== 'object' || Array.isArray(rawRun)) {
      return 'Dados da partida inválidos';
    }

    const run = normalizeRun(rawRun);
    const wallElapsed = integer(wallElapsedMs, -1);
    const seconds = run.durationMs / 1000;

    if (run.durationMs < MIN_RUN_MS || run.durationMs > MAX_RUN_MS) {
      return 'Duração da partida inválida';
    }
    if (wallElapsed >= 0 && run.durationMs > wallElapsed + 3500) {
      return 'Duração inconsistente';
    }
    if (run.dodged > seconds * 4.5 + 14) return 'Número de desvios inválido';
    if (run.hits > seconds * 1.25 + 6) return 'Número de impactos inválido';
    if (run.bonuses > seconds / 2.5 + 5) return 'Número de bónus inválido';
    if (run.repairs + run.replacements > seconds / 8 + 4) {
      return 'Número de paragens inválido';
    }
    if (run.maxCombo > run.dodged) return 'Combo inválido';

    const minDistance = Math.max(0, seconds * 10);
    const maxDistance = seconds * 65 + 300;
    if (run.distanceM < minDistance || run.distanceM > maxDistance) {
      return 'Distância inconsistente';
    }
    return null;
  }

  return Object.freeze({
    VERSION,
    MIN_RUN_MS,
    MAX_RUN_MS,
    REPAIR_COST,
    REPAIR_POWER,
    REPAIR_LIMIT,
    REPLACE_COST,
    clamp,
    normalizeRun,
    dodgeCredits,
    dragLane,
    serviceQuote,
    applyService,
    calculateScore,
    validateRun
  });
});
