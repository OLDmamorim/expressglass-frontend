// netlify/functions/mycar-poller-cron.js
// Função agendada (a cada 15 min via Netlify Scheduled Functions).
// Reutiliza a MESMA lógica eficiente (por lotes/cursor) do mycar-gmail-poller,
// em vez de descarregar todos os emails dos últimos 3 dias de uma vez — era
// isso que estourava o tempo quando o volume de emails cresceu.

// Polyfill: mailparser (via undici) usa o global File, disponível só no Node 20+
if (typeof File === 'undefined') {
  try { global.File = require('buffer').File; } catch (_) {
    global.File = class File extends Blob {
      constructor(bits, name, opts = {}) { super(bits, opts); this.name = name; this.lastModified = opts.lastModified ?? Date.now(); }
    };
  }
}

const { runPoller } = require('./mycar-gmail-poller');

exports.handler = async () => {
  console.log('⏰ mycar-poller-cron: início');
  try {
    const result = await runPoller();
    console.log('⏰ mycar-poller-cron: fim', JSON.stringify(result));
    return { statusCode: 200, body: JSON.stringify({ success: true, ...result }) };
  } catch (error) {
    console.error('❌ mycar-poller-cron:', error.message);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
