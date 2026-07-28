(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PitStopCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 'pit-stop-v2';
  const TOTAL_MS = 75000;
  const MAX_JOBS = 10;
  const MIN_JOB_MS = 4500;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function integer(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  }

  function normalizeJobs(rawJobs) {
    if (!Array.isArray(rawJobs)) return [];
    return rawJobs.slice(0, MAX_JOBS).map(function (job) {
      return {
        quality: clamp(integer(job && job.quality, 0), 0, 100),
        durationMs: clamp(integer(job && job.durationMs, 0), 0, 180000),
        mistakes: clamp(integer(job && job.mistakes, 0), 0, 30)
      };
    });
  }

  function calculateJobPoints(job, index) {
    const quality = clamp(integer(job.quality, 0), 0, 100);
    const durationMs = clamp(integer(job.durationMs, 0), 0, 180000);
    const mistakes = clamp(integer(job.mistakes, 0), 0, 30);
    const base = 700;
    const qualityPoints = quality * 14;
    const speedBonus = clamp(Math.round((19000 - durationMs) / 18), 0, 650);
    const cleanBonus = mistakes === 0 ? 250 : 0;
    const comboBonus = clamp(index, 0, 5) * 180;
    return Math.max(100, base + qualityPoints + speedBonus + cleanBonus + comboBonus - mistakes * 90);
  }

  function calculateScore(rawJobs, multiplier) {
    const jobs = normalizeJobs(rawJobs);
    const safeMultiplier = multiplier === 2 ? 2 : 1;
    const subtotal = jobs.reduce(function (total, job, index) {
      return total + calculateJobPoints(job, index);
    }, 0);
    return subtotal * safeMultiplier;
  }

  function averageQuality(rawJobs) {
    const jobs = normalizeJobs(rawJobs);
    if (!jobs.length) return 0;
    return Math.round(jobs.reduce(function (total, job) {
      return total + job.quality;
    }, 0) / jobs.length);
  }

  function qualityLabel(value) {
    const quality = clamp(integer(value, 0), 0, 100);
    if (quality >= 96) return 'Serviço perfeito';
    if (quality >= 88) return 'Excelente trabalho';
    if (quality >= 76) return 'Bom serviço';
    if (quality >= 60) return 'Serviço concluído';
    return 'Precisa de afinação';
  }

  function validateRun(rawJobs, durationMs, wallElapsedMs) {
    if (!Array.isArray(rawJobs)) return 'Dados da partida inválidos';
    if (rawJobs.length > MAX_JOBS) return 'Número de serviços inválido';

    const jobs = normalizeJobs(rawJobs);
    const duration = integer(durationMs, -1);
    const wallElapsed = integer(wallElapsedMs, -1);

    if (duration < 3000 || duration > 120000) return 'Duração da partida inválida';
    if (wallElapsed >= 0 && duration > wallElapsed + 3000) return 'Duração inconsistente';
    if (jobs.length > Math.floor((duration + 2500) / MIN_JOB_MS)) return 'Ritmo de jogo inválido';

    let jobTime = 0;
    for (const job of jobs) {
      if (job.durationMs < MIN_JOB_MS || job.durationMs > 60000) return 'Duração de serviço inválida';
      jobTime += job.durationMs;
    }
    if (jobTime > duration + jobs.length * 1200) return 'Tempos de serviço inconsistentes';
    return null;
  }

  return Object.freeze({
    VERSION,
    TOTAL_MS,
    MAX_JOBS,
    MIN_JOB_MS,
    clamp,
    normalizeJobs,
    calculateJobPoints,
    calculateScore,
    averageQuality,
    qualityLabel,
    validateRun
  });
});
