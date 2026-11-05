// vehicle-lookup.js - v1
// Botão "🚗 Identificar veículo" no topo da agenda (todas as agendas): abre um
// modal com um campo com aspeto de matrícula portuguesa (faixa azul com o P,
// traços postos ao escrever) e devolve os dados da viatura — marca, modelo,
// ano do modelo, VIN, motor, potência e os pormenores da versão.
// Os dados vêm do PoweringEG pela função vehicle-lookup.

(function () {
  // ---- puro (testado em tests/vehicle-lookup.test.js) ----

  function normalizar(texto) {
    return String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /** bc30rq → BC-30-RQ enquanto se escreve (no máximo 6 caracteres). */
  function comTracos(texto) {
    return (normalizar(texto).slice(0, 6).match(/.{1,2}/g) || []).join('-');
  }

  /** 3 pares de letras ou algarismos (AA-00-AA, 00-AA-00, 00-00-AA…). */
  function matriculaValida(texto) {
    return /^([A-Z]{2}|\d{2}){3}$/.test(normalizar(texto));
  }

  /** O ano do modelo pelo 10.º carácter do VIN (A=2010 … Y=2030, 1–9 = 2001–2009). */
  function anoModeloDoVin(vin, agora) {
    var c = normalizar(vin)[9];
    if (!c) return null;
    var letras = 'ABCDEFGHJKLMNPRSTVWXY';
    var base;
    if (/[1-9]/.test(c)) base = 2000 + Number(c);
    else if (letras.indexOf(c) >= 0) base = 2010 + letras.indexOf(c);
    else return null;
    var limite = (agora || new Date()).getFullYear() + 1;
    while (base > limite) base -= 30;
    return base;
  }

  // Na Europa o ano no VIN não é obrigatório: a Renault usa aquele carácter
  // para outra coisa (um Clio de 2023 dava "2007"). Só nestas marcas se mostra.
  var MARCAS_ANO_NO_VIN = ['VOLKSWAGEN', 'VW', 'AUDI', 'SEAT', 'SKODA', 'CUPRA', 'PORSCHE',
    'PEUGEOT', 'CITROEN', 'DS', 'OPEL', 'VAUXHALL', 'FIAT', 'ALFA ROMEO', 'LANCIA', 'JEEP', 'ABARTH',
    'TOYOTA', 'LEXUS', 'HYUNDAI', 'KIA', 'FORD', 'HONDA', 'MAZDA', 'TESLA'];

  function marcaPoeAnoNoVin(marca) {
    var m = String(marca || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    return MARCAS_ANO_NO_VIN.some(function (x) { return m.indexOf(x) === 0; });
  }

  /** O que o formato da matrícula garante: AA-00-AA desde 2020, 00-AA-00 2005–2020, 00-00-AA 1992–2005. */
  function periodoDaMatricula(matricula) {
    var m = normalizar(matricula);
    if (/^[A-Z]{2}\d{2}[A-Z]{2}$/.test(m)) return '2020 ou posterior';
    if (/^\d{2}[A-Z]{2}\d{2}$/.test(m)) return 'entre 2005 e 2020';
    if (/^\d{4}[A-Z]{2}$/.test(m)) return 'entre 1992 e 2005';
    if (/^[A-Z]{2}\d{4}$/.test(m)) return 'antes de 1992';
    return null;
  }

  /** As linhas a mostrar (rótulo, valor), sem as vazias. */
  function linhasDaViatura(v, agora, matricula) {
    if (!v) return [];
    var ano = marcaPoeAnoNoVin(v.marca) ? anoModeloDoVin(v.vin, agora) : null;
    var periodo = ano ? null : periodoDaMatricula(matricula);
    var linhas = [
      ['Marca', v.marca], ['Modelo', v.modelo],
      ano ? ['Ano do modelo', String(ano)] : ['Matrícula', periodo || ''],
      ['VIN', v.vin], ['Motor', v.motor], ['Potência', v.potencia], ['Transmissão', v.transmissao],
    ];
    (v.detalhes || []).forEach(function (d) { linhas.push([d.rotulo, d.valor]); });
    return linhas.filter(function (l) { return l[1]; });
  }

  var api = { comTracos: comTracos, matriculaValida: matriculaValida, anoModeloDoVin: anoModeloDoVin, periodoDaMatricula: periodoDaMatricula, linhasDaViatura: linhasDaViatura };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // ---- browser ----

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function garantirEstilo() {
    if (document.getElementById('vehicleLookupStyle')) return;
    var st = document.createElement('style');
    st.id = 'vehicleLookupStyle';
    st.textContent = [
      '.vl-overlay{display:none;position:fixed;inset:0;z-index:9999;background:rgba(7,30,69,.55);align-items:center;justify-content:center;padding:12px;}',
      '.vl-overlay.open{display:flex;}',
      '.vl-modal{background:#fff;border-radius:10px;max-width:520px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:Figtree,system-ui,sans-serif;color:#1f2a3d;}',
      '.vl-modal header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #e3e8ef;border-top:4px solid #0b2d64;border-radius:10px 10px 0 0;}',
      '.vl-modal h3{margin:0;font-size:17px;font-weight:700;color:#0b2d64;font-family:Poppins,Figtree,sans-serif;}',
      '.vl-close{background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;}',
      '.vl-body{padding:16px 18px;display:flex;flex-direction:column;gap:14px;}',
      '.vl-linha{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}',
      '.vl-placa{display:flex;height:56px;width:270px;max-width:100%;border:2px solid #1f2937;border-radius:6px;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.15);}',
      '.vl-placa:focus-within{outline:2px solid #3b82f6;outline-offset:1px;}',
      '.vl-ue{width:42px;flex-shrink:0;background:#003399;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;}',
      '.vl-ue b{font-size:18px;line-height:1;}',
      '.vl-placa input{flex:1;min-width:0;border:none;outline:none;text-align:center;font:700 26px/1 "Courier New",monospace;letter-spacing:2px;text-transform:uppercase;color:#111;background:#fff;}',
      '.vl-placa input::placeholder{color:#cbd5e1;}',
      '.vl-procurar{background:#0b2d64;color:#fff;border:none;border-radius:6px;height:56px;padding:0 18px;font-size:15px;font-weight:700;cursor:pointer;}',
      '.vl-procurar:disabled{opacity:.5;cursor:not-allowed;}',
      '.vl-nota{font-size:12px;color:#5d6b80;margin:0;}',
      '.vl-erro{background:#fef2f2;color:#991b1b;border-radius:6px;padding:10px 12px;font-size:14px;}',
      '.vl-titulo{font-size:16px;font-weight:800;color:#0b2d64;margin:0;}',
      '.vl-dados{display:grid;grid-template-columns:1fr;gap:0;margin:0;}',
      '.vl-dados div{display:flex;gap:10px;border-bottom:1px dashed #e3e8ef;padding:6px 0;font-size:14px;}',
      '.vl-dados dt{width:150px;flex-shrink:0;color:#5d6b80;}',
      '.vl-dados dd{margin:0;font-weight:600;word-break:break-word;}',
      '.vl-atualizar{background:none;border:none;color:#0b2d64;font-weight:700;cursor:pointer;font-size:13px;padding:0;}',
      '@media (max-width:600px){#vehicleLookupBtn .vl-label-txt{display:none}}',
    ].join('\n');
    document.head.appendChild(st);
  }

  function estrelasUE() {
    var s = '';
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * 2 * Math.PI;
      s += '<circle cx="' + (10 + 6.5 * Math.cos(a)).toFixed(2) + '" cy="' + (10 + 6.5 * Math.sin(a)).toFixed(2) + '" r="1.1" fill="#ffcc00"/>';
    }
    return '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">' + s + '</svg>';
  }

  function garantirModal() {
    if (document.getElementById('vlModal')) return;
    garantirEstilo();
    document.body.insertAdjacentHTML('beforeend',
      '<div class="vl-overlay" id="vlModal" onclick="if(event.target===this)window._vlFechar()">' +
      '  <div class="vl-modal" role="dialog" aria-modal="true" aria-labelledby="vlTitulo">' +
      '    <header><h3 id="vlTitulo">🚗 Identificar veículo</h3><button class="vl-close" onclick="window._vlFechar()" aria-label="Fechar">×</button></header>' +
      '    <div class="vl-body">' +
      '      <form class="vl-linha" id="vlForm" onsubmit="event.preventDefault();window._vlProcurar()">' +
      '        <div class="vl-placa"><div class="vl-ue">' + estrelasUE() + '<b>P</b></div>' +
      '          <input id="vlMatricula" placeholder="AA-00-AA" aria-label="Matrícula" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>' +
      '        <button type="submit" class="vl-procurar" id="vlProcurar" disabled>Procurar</button>' +
      '      </form>' +
      '      <p class="vl-nota">Escreva a matrícula: devolve marca, modelo, ano, VIN, motor, potência e os dados da versão.</p>' +
      '      <div id="vlResultado"></div>' +
      '    </div>' +
      '  </div>' +
      '</div>');
    var input = document.getElementById('vlMatricula');
    input.addEventListener('input', function () {
      var f = comTracos(input.value);
      if (input.value !== f) input.value = f;
      document.getElementById('vlProcurar').disabled = !matriculaValida(f);
    });
  }

  var _aProcurar = false;

  window._vlProcurar = async function (novamente) {
    var input = document.getElementById('vlMatricula');
    var matricula = input.value;
    if (!matriculaValida(matricula) || _aProcurar) return;
    var btn = document.getElementById('vlProcurar');
    var out = document.getElementById('vlResultado');
    _aProcurar = true;
    btn.disabled = true;
    btn.textContent = 'A procurar…';
    out.innerHTML = '<p class="vl-nota">A consultar a viatura… (a primeira vez pode demorar uns segundos)</p>';
    try {
      var r = await window.authClient.authenticatedFetch('/.netlify/functions/vehicle-lookup?matricula=' +
        encodeURIComponent(matricula) + (novamente ? '&novamente=1' : ''));
      var d = await r.json();
      if (!d || !d.success || !d.viatura) throw new Error((d && d.error) || 'Não encontrámos dados para esta matrícula.');
      var v = d.viatura;
      var linhas = linhasDaViatura(v, null, d.matricula);
      out.innerHTML =
        '<div class="vl-linha" style="justify-content:space-between"><p class="vl-titulo">' + esc(comTracos(d.matricula)) + ' · ' + esc(v.marca) + ' ' + esc(v.modelo) + '</p>' +
        '<button type="button" class="vl-atualizar" onclick="window._vlProcurar(true)">↻ Atualizar</button></div>' +
        '<dl class="vl-dados">' + linhas.map(function (l) {
          return '<div><dt>' + esc(l[0]) + '</dt><dd>' + esc(l[1]) + '</dd></div>';
        }).join('') + '</dl>';
    } catch (e) {
      out.innerHTML = '<div class="vl-erro">' + esc(e.message || 'Não foi possível consultar a matrícula neste momento.') + '</div>';
    } finally {
      _aProcurar = false;
      btn.textContent = 'Procurar';
      btn.disabled = !matriculaValida(input.value);
    }
  };

  window._vlAbrir = function () {
    garantirModal();
    document.getElementById('vlModal').classList.add('open');
    setTimeout(function () { var i = document.getElementById('vlMatricula'); if (i) i.focus(); }, 50);
  };

  window._vlFechar = function () {
    var m = document.getElementById('vlModal');
    if (m) m.classList.remove('open');
  };

  // ── Botões: no cabeçalho (computador) e na fila de botões (telemóvel) ────
  function garantirBotaoTopo() {
    if (document.getElementById('vehicleLookupBtn')) return;
    var actions = document.querySelector('.page-header .header-actions');
    if (!actions) return;
    garantirEstilo();
    var btn = document.createElement('button');
    btn.id = 'vehicleLookupBtn';
    btn.type = 'button';
    btn.className = 'header-btn';
    btn.title = 'Identificar veículo pela matrícula';
    btn.setAttribute('aria-label', 'Identificar veículo');
    btn.innerHTML = '🚗 <span class="vl-label-txt">Identificar veículo</span>';
    btn.addEventListener('click', window._vlAbrir);
    actions.insertBefore(btn, actions.firstChild);
  }

  function garantirBotaoFila() {
    var area = document.getElementById('guiaATUploadArea');
    if (!area || area.style.display === 'none') return;
    if (document.getElementById('vehicleLookupBtnMobile')) return;
    var historico = document.getElementById('btnHistoricoMobile');
    var fila = historico ? historico.parentNode : area.querySelector('div');
    if (!fila) return;
    var btn = document.createElement('button');
    btn.id = 'vehicleLookupBtnMobile';
    btn.type = 'button';
    btn.className = 'guia-at-upload-btn';
    btn.textContent = '🚗 Identificar veículo';
    btn.addEventListener('click', window._vlAbrir);
    fila.appendChild(btn);
  }

  function tick() {
    try {
      garantirBotaoTopo();
      var telemovel = window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
      if (telemovel) garantirBotaoFila();
      var topo = document.getElementById('vehicleLookupBtn');
      var fila = document.getElementById('vehicleLookupBtnMobile');
      if (topo) topo.style.display = telemovel && fila ? 'none' : '';
      if (fila) fila.style.display = telemovel ? '' : 'none';
    } catch (e) { console.warn('[Identificar veículo]', e); }
  }

  function start() {
    tick();
    setInterval(tick, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 1500); });
  } else {
    setTimeout(start, 1500);
  }
})();
