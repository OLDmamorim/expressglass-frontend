'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MIN_IMAGE_BYTES,
  MIN_INLINE_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_EMAIL,
  extractEmailImages,
  saveServiceImages
} = require('../netlify/functions/lib/mycar-images');

function attachment(size, extra = {}) {
  const content = Buffer.alloc(size, extra.fill ?? 1);
  return { contentType: 'image/jpeg', filename: 'foto.jpg', size, content, ...extra };
}

test('guarda fotos anexadas e embebidas grandes', () => {
  const images = extractEmailImages({
    attachments: [
      attachment(200 * 1024, { filename: 'dano.jpg', checksum: 'a' }),
      attachment(120 * 1024, { cid: 'image001.jpg@01DA', contentDisposition: 'inline', checksum: 'b' })
    ]
  });
  assert.equal(images.length, 2);
  assert.equal(images[0].filename, 'dano.jpg');
  assert.equal(images[0].inline, false);
  assert.equal(images[1].inline, true);
  assert.equal(images[0].data, Buffer.alloc(200 * 1024, 1).toString('base64'));
});

test('ignora ícones, logótipos de assinatura e o que não é imagem', () => {
  const images = extractEmailImages({
    attachments: [
      attachment(MIN_IMAGE_BYTES - 1, { checksum: 'icone' }),
      attachment(MIN_INLINE_IMAGE_BYTES - 1, { cid: 'logo@x', related: true, checksum: 'logo' }),
      attachment(MAX_IMAGE_BYTES + 1, { checksum: 'enorme' }),
      attachment(50 * 1024, { contentType: 'application/pdf', filename: 'cotacao.pdf', checksum: 'pdf' })
    ]
  });
  assert.deepEqual(images, []);
});

test('um anexo pequeno (não embebido) acima do mínimo fica', () => {
  const images = extractEmailImages({
    attachments: [attachment(MIN_IMAGE_BYTES + 10, { checksum: 'print' })]
  });
  assert.equal(images.length, 1);
});

test('a mesma imagem repetida no email fica uma vez', () => {
  const images = extractEmailImages({
    attachments: [
      attachment(40 * 1024, { checksum: 'x' }),
      attachment(40 * 1024, { checksum: 'x', filename: 'copia.jpg' })
    ]
  });
  assert.equal(images.length, 1);
});

test('sem checksum do mailparser, calcula-o a partir do conteúdo', () => {
  const images = extractEmailImages({
    attachments: [attachment(40 * 1024, { fill: 7 }), attachment(40 * 1024, { fill: 7 })]
  });
  assert.equal(images.length, 1);
  assert.match(images[0].checksum, /^[0-9a-f]{32}$/);
});

test('limita o número de imagens por email', () => {
  const attachments = Array.from({ length: MAX_IMAGES_PER_EMAIL + 5 }, (_, i) =>
    attachment(40 * 1024, { checksum: `img${i}` }));
  assert.equal(extractEmailImages({ attachments }).length, MAX_IMAGES_PER_EMAIL);
});

test('email sem anexos não dá imagens', () => {
  assert.deepEqual(extractEmailImages({}), []);
  assert.deepEqual(extractEmailImages({ attachments: [null, { contentType: 'image/png' }] }), []);
});

test('saveServiceImages grava cada imagem e conta só as novas', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push(params);
      return { rowCount: params[4] === 'repetida' ? 0 : 1 };
    }
  };
  const email = {
    date: new Date('2026-10-20T10:00:00Z'),
    attachments: [attachment(40 * 1024, { checksum: 'nova' }), attachment(40 * 1024, { checksum: 'repetida' })]
  };
  const saved = await saveServiceImages(client, 42, email, { messageId: '<abc@mycar>' });
  assert.equal(saved, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 42);
  assert.equal(calls[0][2], 'image/jpeg');
  assert.equal(calls[0][7], '<abc@mycar>');
});

test('saveServiceImages sem serviço não grava nada', async () => {
  const client = { async query() { throw new Error('não devia gravar'); } };
  assert.equal(await saveServiceImages(client, null, { attachments: [attachment(40 * 1024)] }), 0);
});
