'use strict';

const REPLY_PREFIX = /^\s*(?:(?:re|res|fw|fwd|enc|rv|wg|aw)\s*:\s*)+/i;
const RESPONSE_PREFIX = /^\s*(?:(?:re|res|aw)\s*:\s*)+/i;

function normalizeSubject(subject) {
  return String(subject || '')
    .replace(/^\s*(?:\[(?:external|externo|email externo)\]\s*)+/i, '')
    .replace(REPLY_PREFIX, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-PT');
}

function normalizeMessageId(value) {
  if (Array.isArray(value)) value = value[0];
  return String(value || '')
    .trim()
    .replace(/^<|>$/g, '')
    .toLowerCase() || null;
}

function normalizeReferences(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/\s+/);
  return [...new Set(values.map(normalizeMessageId).filter(Boolean))];
}

function isReplySubject(subject) {
  return RESPONSE_PREFIX.test(String(subject || ''));
}

function extractThreadMeta(email = {}, attrs = {}, uid = null) {
  const gmailThreadId = attrs['x-gm-thrid'] == null ? null : String(attrs['x-gm-thrid']);
  const gmailMessageId = attrs['x-gm-msgid'] == null ? null : String(attrs['x-gm-msgid']);
  const messageId = normalizeMessageId(email.messageId);
  const references = normalizeReferences([
    ...normalizeReferences(email.references),
    ...normalizeReferences(email.inReplyTo)
  ]);

  return {
    gmailThreadId,
    gmailMessageId,
    messageId,
    references,
    uid: uid == null ? null : String(uid),
    normalizedSubject: normalizeSubject(email.subject)
  };
}

function buildMessageKey(meta = {}) {
  if (meta.gmailMessageId) return `gmail:${meta.gmailMessageId}`;
  if (meta.messageId) return `rfc:${meta.messageId}`;
  if (meta.uid) return `imap:${meta.uid}`;
  return null;
}

// Os emails chegam muitas vezes reencaminhados por uma conta ExpressGlass.
// Nesse caso, o remetente real da mensagem nova é o primeiro cabeçalho
// "De:"/"From:" existente no corpo reencaminhado, não o remetente exterior.
function isMyCarMessage(email = {}) {
  const body = String(email.text || '');
  const forwardedFrom = body.match(/^\s*(?:De|From):\s*(.+)$/im)?.[1] || '';
  const sender = String(email.from?.text || '');
  const myCarSender = /(?:@(?:mycarcenter|carby)\.pt\b|\bmy\s*car\s*center\b|\bmycarcenter\b)/i;
  return myCarSender.test(sender) || myCarSender.test(forwardedFrom);
}

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Decisão determinística para mensagens curtas e inequívocas. A recusa/espera
// tem prioridade para que texto como "não podem avançar" nunca fique verde.
function classifyExplicitAdvanceInstruction(body) {
  const text = stripAccents(body).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const blocked = [
    /\bnao\s+(?:podem?|devem?|e\s+para)\s+(?:ja\s+)?(?:avancar|proceder|executar)\b/,
    /\bnao\s+avanc(?:ar|em)\b/,
    /\bnao\s+autorizad[oa]s?\b/,
    /\bsem\s+autorizacao\b/,
    /\b(?:aguardar|aguardem|pendente)\s+(?:(?:a|de)\s+)?autorizacao\b/
  ];
  if (blocked.some(rx => rx.test(text))) return 'bloquear';

  const positive = [
    /\bpodem?\s+(?:ja\s+)?(?:avancar|proceder|executar)\b/,
    /\be\s+para\s+(?:avancar|proceder|executar)\b/,
    /\bavancem\b/,
    /\b(?:servico|orcamento|intervencao)\s+(?:esta\s+)?(?:autorizad[oa]|aprova[do])\b/,
    /\bautorizamos\s+(?:o\s+)?(?:servico|orcamento|a\s+intervencao|a\s+reparacao|a\s+substituicao)\b/,
    /\bautorizad[oa]s?\s+(?:a\s+)?(?:avancar|proceder|executar)\b/
  ];
  return positive.some(rx => rx.test(text)) ? 'autorizar' : null;
}

// Fallback conservador para quando a IA estiver temporariamente indisponível.
// Só aceita ordens explícitas; frases como "aguardar autorização" não contam.
function hasExplicitAdvanceAuthorization(body) {
  return classifyExplicitAdvanceInstruction(body) === 'autorizar';
}

// Escolhe a instrução explícita mais recente depois do email que originou o
// processo. É usada pela recuperação dirigida aos processos ainda pendentes.
function latestExplicitAdvanceInstruction(messages = [], afterDate = null) {
  const afterMs = afterDate ? new Date(afterDate).getTime() : NaN;

  return messages
    .map(message => {
      const timestamp = new Date(message?.date).getTime();
      return {
        action: classifyExplicitAdvanceInstruction(message?.body),
        date: message?.date,
        body: message?.body || null,
        timestamp,
        meta: message?.meta || null
      };
    })
    .filter(item =>
      item.action &&
      Number.isFinite(item.timestamp) &&
      (!Number.isFinite(afterMs) || item.timestamp > afterMs + 60_000)
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .at(-1) || null;
}

function isAuthorizationActive(service = {}) {
  return Boolean(
    service.advance_authorized_at &&
    !['realizado', 'faturado', 'rejeitado'].includes(service.status)
  );
}

function shouldAnalyzeAsFollowup(existing = {}, incoming = {}) {
  const meta = incoming.meta || {};
  const previousDate = existing.email_received_at ? new Date(existing.email_received_at).getTime() : NaN;
  const incomingDate = incoming.date ? new Date(incoming.date).getTime() : NaN;

  return Boolean(
    isReplySubject(incoming.subject) ||
    (meta.references || []).length > 0 ||
    (existing.email_subject && incoming.subject && existing.email_subject !== incoming.subject) ||
    (existing.email_thread_id && String(existing.email_thread_id) === String(meta.gmailThreadId || '') &&
      existing.email_message_id && meta.messageId && existing.email_message_id !== meta.messageId) ||
    (Number.isFinite(previousDate) && Number.isFinite(incomingDate) &&
      Math.abs(incomingDate - previousDate) > 60_000)
  );
}

module.exports = {
  normalizeSubject,
  normalizeMessageId,
  normalizeReferences,
  isReplySubject,
  extractThreadMeta,
  buildMessageKey,
  isMyCarMessage,
  classifyExplicitAdvanceInstruction,
  hasExplicitAdvanceAuthorization,
  latestExplicitAdvanceInstruction,
  isAuthorizationActive,
  shouldAnalyzeAsFollowup
};
