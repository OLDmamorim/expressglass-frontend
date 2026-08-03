'use strict';

function monthKey(value) {
  const month = Number(value && value.mes);
  const year = Number(value && value.ano);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) return null;
  return (year * 12) + month;
}

function serviceCount(value) {
  const count = Number(value && value.totalServicos);
  return Number.isFinite(count) ? count : -1;
}

function mostComplete(results) {
  return results.reduce(
    (best, current) => (!best || serviceCount(current) >= serviceCount(best) ? current : best),
    null
  );
}

/**
 * Escolhe o resultado do mes pedido. Se esse mes ainda nao existir, recua para
 * o mes cronologicamente mais recente disponivel (nunca para o maior total do
 * historico). Havendo duplicados no mes escolhido, usa o registo mais completo.
 */
function selectPoweringResult(results, requestedMonth, requestedYear) {
  const datedResults = (Array.isArray(results) ? results : [])
    .filter(result => monthKey(result) !== null);

  if (!datedResults.length) return null;

  const requestedKey = (Number(requestedYear) * 12) + Number(requestedMonth);
  const exact = datedResults.filter(result => monthKey(result) === requestedKey);
  if (exact.length) return mostComplete(exact);

  const previous = datedResults.filter(result => monthKey(result) < requestedKey);
  const fallbackPool = previous.length ? previous : datedResults;
  const latestKey = Math.max(...fallbackPool.map(monthKey));

  return mostComplete(fallbackPool.filter(result => monthKey(result) === latestKey));
}

module.exports = { selectPoweringResult };
