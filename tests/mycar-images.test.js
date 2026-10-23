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

// Base de dados a fingir: `known` são as assinaturas já conhecidas e
// `elsewhere` as imagens que já existem noutra matrícula.
function fakeClient({ known = [], elsewhere = [], repeated = [] } = {}) {
  const inserts = [], signatures = [], deletes = [];
  return {
    inserts, signatures, deletes,
    async query(sql, params) {
      if (/FROM mycar_signature_images WHERE checksum/.test(sql)) {
        return { rows: known.includes(params[0]) ? [{}] : [] };
      }
      if (/other_img\.checksum = \$1/.test(sql)) {
        return { rows: elsewhere.includes(params[0]) ? [{}] : [] };
      }
      if (/INSERT INTO mycar_signature_images/.test(sql)) { signatures.push(params[0]); return { rows: [] }; }
      if (/DELETE FROM mycar_service_images/.test(sql)) { deletes.push(params[0]); return { rowCount: 2 }; }
      if (/INSERT INTO mycar_service_images/.test(sql)) {
        inserts.push(params);
        return { rowCount: repeated.includes(params[4]) ? 0 : 1 };
      }
      throw new Error('consulta inesperada: ' + sql);
    }
  };
}

test('saveServiceImages grava cada imagem e conta só as novas', async () => {
  const client = fakeClient({ repeated: ['repetida'] });
  const email = {
    date: new Date('2026-10-20T10:00:00Z'),
    attachments: [attachment(40 * 1024, { checksum: 'nova' }), attachment(40 * 1024, { checksum: 'repetida' })]
  };
  const saved = await saveServiceImages(client, 42, email, { messageId: '<abc@mycar>' });
  assert.equal(saved, 1);
  assert.equal(client.inserts.length, 2);
  assert.equal(client.inserts[0][0], 42);
  assert.equal(client.inserts[0][2], 'image/jpeg');
  assert.equal(client.inserts[0][7], '<abc@mycar>');
});

test('uma assinatura já conhecida (logótipo MyCar) não é guardada', async () => {
  const client = fakeClient({ known: ['logo-mycar'] });
  const email = { attachments: [
    attachment(91547, { filename: 'image001.png', cid: 'image001.png@01DC', checksum: 'logo-mycar' }),
    attachment(4 * 1024 * 1024, { filename: 'dano.png', checksum: 'dano' })
  ] };
  assert.equal(await saveServiceImages(client, 7, email), 1);
  assert.deepEqual(client.inserts.map(p => p[4]), ['dano']);
});

test('a mesma imagem noutra matrícula passa a assinatura e sai das guardadas', async () => {
  const client = fakeClient({ elsewhere: ['selo-premio'] });
  const email = { attachments: [attachment(40915, { filename: 'image003.png', checksum: 'selo-premio' })] };
  assert.equal(await saveServiceImages(client, 7, email), 0);
  assert.deepEqual(client.signatures, ['selo-premio']);
  assert.deepEqual(client.deletes, ['selo-premio']);
  assert.equal(client.inserts.length, 0);
});

test('saveServiceImages sem serviço não grava nada', async () => {
  const client = { async query() { throw new Error('não devia gravar'); } };
  assert.equal(await saveServiceImages(client, null, { attachments: [attachment(40 * 1024)] }), 0);
});
