'use strict';

const REPLY_PREFIX = /^\s*(?:(?:re|res|fw|fwd|enc|rv|wg|aw)\s*:\s*)+/i;
const RESPONSE_PREFIX = /^\s*(?:(?:re|res|aw)\s*:\s*)+/i;
const MYCAR_SENDER = /(?:@(?:mycarcenter|carby)\.pt\b|\bmy\s*car\s*center\b|\bmycarcenter\b)/i;
const SENDER_LINE = /^\s*(?:De|From):\s*(.+)$/gim;

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

function isMyCarSender(value) {
  return MYCAR_SENDER.test(String(value || ''));
}

// Retira apenas cabeçalhos/avisos do bloco para perceber se uma camada interna
// da ExpressGlass tem conteúdo próprio ou se é só mais um reencaminhamento.
function stripRoutingNoise(value) {
  return String(value || '')
    .split(/\r?\n/)
    .filter(line => {
      const text = line.trim();
      if (!text) return false;
      if (/^(?:De|From|Enviado|Sent|Data|Date|Para|To|Cc|Assunto|Subject):/i.test(text)) return false;
      if (/^-{3,}\s*(?:Forwarded message|Mensagem encaminhada|Original Message)?\s*-*$/i.test(text)) return false;
      if (/^_{5,}$/.test(text)) return false;
      if (/seguran[cç]a.*email|email.*nossa.*organiza[cç][aã]o|email externo|confirme a identidade/i.test(text)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

function senderSections(body) {
  const text = String(body || '');
  const matches = [...text.matchAll(SENDER_LINE)];
  return matches.map((match, index) => ({
    sender: match[1] || '',
    text: text.slice(match.index, matches[index + 1]?.index ?? text.length)
  }));
}

// Devolve apenas a mensagem nova atribuída à MyCar. Há emails que chegam com
// duas camadas de reencaminhamento ExpressGlass antes do bloco real da MyCar.
// Atravessamos essas camadas quando estão vazias, mas paramos se uma mensagem
// interna tiver texto próprio para não interpretar como nova uma citação antiga.
function extractMyCarMessageBody(email = {}) {
  const body = String(email.text || '');
  const envelopeSender = String(email.from?.text || '');

  if (isMyCarSender(envelopeSender)) {
    const firstQuotedSender = body.search(/^\s*(?:De|From):\s*.+$/im);
    const newestBody = firstQuotedSender > 0 ? body.slice(0, firstQuotedSender) : body;
    return stripRoutingNoise(newestBody) || stripRoutingNoise(body) || body.trim() || null;
  }

  let internalContentSeen = false;
  for (const section of senderSections(body)) {
    const content = stripRoutingNoise(section.text);
    if (isMyCarSender(section.sender)) {
      return internalContentSeen ? null : (content || section.text.trim() || null);
    }
    if (content) internalContentSeen = true;
  }

  return null;
}

function isMyCarMessage(email = {}) {
  return extractMyCarMessageBody(email) !== null;
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
  extractMyCarMessageBody,
  isMyCarMessage,
  classifyExplicitAdvanceInstruction,
  hasExplicitAdvanceAuthorization,
  latestExplicitAdvanceInstruction,
  isAuthorizationActive,
  shouldAnalyzeAsFollowup
};
