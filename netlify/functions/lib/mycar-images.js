'use strict';

const crypto = require('crypto');

// Imagens dos emails MyCar (fotos dos danos, prints da cotação, etc.).
// Vêm como anexos ou imagens embebidas no corpo; guardamo-las junto de cada
// serviço para o mural as mostrar. Logótipos e ícones de assinatura ficam de
// fora pelo tamanho, e a mesma imagem citada em várias respostas só fica uma vez.

const MIN_IMAGE_BYTES = 8 * 1024;          // abaixo disto: ícones, espaçadores
const MIN_INLINE_IMAGE_BYTES = 25 * 1024;  // embebidas pequenas: logótipos de assinatura
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;   // fotos maiores não cabem numa resposta da API
const MAX_IMAGES_PER_EMAIL = 15;

function isInline(att) {
  return att.contentDisposition === 'inline' || Boolean(att.related) || Boolean(att.cid);
}

function imageChecksum(att) {
  if (att.checksum) return String(att.checksum);
  return crypto.createHash('md5').update(att.content).digest('hex');
}

// Escolhe as imagens que interessam de um email já lido pelo mailparser.
function extractEmailImages(email = {}) {
  const seen = new Set();
  const images = [];
  for (const att of email.attachments || []) {
    if (!att || !Buffer.isBuffer(att.content)) continue;
    const type = String(att.contentType || '').toLowerCase();
    if (!type.startsWith('image/')) continue;
    const size = att.size || att.content.length;
    if (size < MIN_IMAGE_BYTES || size > MAX_IMAGE_BYTES) continue;
    if (isInline(att) && size < MIN_INLINE_IMAGE_BYTES) continue;
    const checksum = imageChecksum(att);
    if (seen.has(checksum)) continue;
    seen.add(checksum);
    images.push({
      filename: att.filename || null,
      contentType: type,
      size,
      checksum,
      inline: isInline(att),
      data: att.content.toString('base64')
    });
    if (images.length >= MAX_IMAGES_PER_EMAIL) break;
  }
  return images;
}

async function ensureImagesTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS mycar_service_images (
      id SERIAL PRIMARY KEY,
      service_id INTEGER NOT NULL REFERENCES mycar_services(id) ON DELETE CASCADE,
      filename TEXT,
      content_type VARCHAR(100) NOT NULL,
      size_bytes INTEGER,
      checksum VARCHAR(64) NOT NULL,
      is_inline BOOLEAN DEFAULT FALSE,
      data TEXT NOT NULL,
      email_message_id VARCHAR(500),
      email_date TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (service_id, checksum)
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mycar_images_service ON mycar_service_images(service_id)`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS images_checked_at TIMESTAMP`);
}

// Guarda as imagens do email no serviço. Devolve quantas eram novas.
async function saveServiceImages(client, serviceId, email, meta = {}) {
  if (!serviceId) return 0;
  const images = extractEmailImages(email);
  let saved = 0;
  for (const img of images) {
    const { rowCount } = await client.query(
      `INSERT INTO mycar_service_images
         (service_id, filename, content_type, size_bytes, checksum, is_inline, data, email_message_id, email_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (service_id, checksum) DO NOTHING`,
      [serviceId, img.filename, img.contentType, img.size, img.checksum, img.inline,
       img.data, meta.messageId || null, email.date || null]
    );
    saved += rowCount;
  }
  return saved;
}

module.exports = {
  MIN_IMAGE_BYTES,
  MIN_INLINE_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_EMAIL,
  extractEmailImages,
  ensureImagesTable,
  saveServiceImages
};
