'use strict';

const BULK_DELETE_STATUSES = new Set(['pending', 'confirmed', 'missing']);
const MAX_BULK_DELETE = 300;

function bulkDeleteError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeReceptionIds(values) {
  if (!Array.isArray(values)) {
    throw bulkDeleteError('Seleciona pelo menos uma receção', 400);
  }

  const ids = [...new Set(values.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) {
    throw bulkDeleteError('Seleciona pelo menos uma receção', 400);
  }
  if (ids.length > MAX_BULK_DELETE) {
    throw bulkDeleteError(`Só é possível eliminar ${MAX_BULK_DELETE} receções de cada vez`, 400);
  }
  return ids;
}

function assertBulkDeleteTargets(ids, rows, allowedPortalIds, isAdmin) {
  const rowsById = new Map((rows || []).map(row => [Number(row.id), row]));
  const missingIds = ids.filter(id => !rowsById.has(id));
  if (missingIds.length) {
    throw bulkDeleteError('Algumas receções já foram alteradas. Atualiza a lista e tenta novamente.', 409);
  }

  const invalid = ids
    .map(id => rowsById.get(id))
    .find(row => row.is_return === true || !BULK_DELETE_STATUSES.has(row.status));
  if (invalid) {
    throw bulkDeleteError('A eliminação em lote só está disponível para receções pendentes.', 409);
  }

  if (!isAdmin) {
    const allowed = new Set((allowedPortalIds || []).map(Number));
    const forbidden = ids
      .map(id => rowsById.get(id))
      .find(row => !allowed.has(Number(row.portal_id)));
    if (forbidden) throw bulkDeleteError('Sem acesso a uma das receções selecionadas', 403);
  }

  return ids;
}

module.exports = {
  BULK_DELETE_STATUSES,
  MAX_BULK_DELETE,
  normalizeReceptionIds,
  assertBulkDeleteTargets
};
