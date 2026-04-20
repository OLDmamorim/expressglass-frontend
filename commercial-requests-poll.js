// commercial-requests-poll.js — banner pedidos comerciais

(function () {
  'use strict';


// ── Sugestão de data para pedido de comercial ─────────────────────────
const PROX = {
  "Abrantes": ['Santarém', 'Tomar', 'Torres Novas', 'Entroncamento'],
  "Albufeira": ['Loulé', 'Silves', 'Lagoa', 'Portimão'],
  "Alcobaça": ['Leiria', 'Batalha', 'Nazaré', 'Caldas da Rainha', 'Porto de Mós'],
  "Alcochete": ['Montijo', 'Benavente', 'Palmela'],
  "Alcácer do Sal": ['Setúbal', 'Grândola', 'Santiago do Cacém', 'Évora'],
  "Almada": ['Lisboa', 'Seixal', 'Sesimbra', 'Palmela'],
  "Almeirim": ['Santarém', 'Cartaxo', 'Alpiarça'],
  "Amadora": ['Lisboa', 'Odivelas', 'Sintra', 'Cascais', 'Oeiras'],
  "Amarante": ['Felgueiras', 'Lousada', 'Penafiel', 'Celorico de Basto', 'Marco de Canaveses'],
  "Amares": ['Braga', 'Barcelos', 'Póvoa de Lanhoso', 'Terras de Bouro', 'Vila Verde'],
  "Anadia": ['Aveiro', 'Oliveira do Bairro', 'Mealhada', 'Cantanhede', 'Coimbra'],
  "Arcos de Valdevez": ['Ponte de Lima', 'Viana do Castelo', 'Ponte da Barca', 'Monção', 'Terras de Bouro'],
  "Arouca": ['Vale de Cambra', 'Sever do Vouga', 'Santa Maria da Feira'],
  "Aveiro": ['Ílhavo', 'Estarreja', 'Vagos', 'Murtosa', 'Oliveira do Bairro', 'Águeda'],
  "Azambuja": ['Vila Franca de Xira', 'Cartaxo', 'Rio Maior'],
  "Barcelos": ['Braga', 'Famalicão', 'Póvoa de Varzim', 'Esposende', 'Amares', 'Vila Verde'],
  "Barreiro": ['Seixal', 'Moita', 'Montijo', 'Palmela'],
  "Batalha": ['Leiria', 'Porto de Mós', 'Alcobaça'],
  "Beja": ['Cuba', 'Serpa', 'Vidigueira', 'Ferreira do Alentejo', 'Alvito'],
  "Benavente": ['Montijo', 'Alcochete', 'Vila Franca de Xira', 'Santarém'],
  "Borba": ['Estremoz', 'Vila Viçosa', 'Reguengos de Monsaraz'],
  "Braga": ['Barcelos', 'Famalicão', 'Guimarães', 'Póvoa de Lanhoso', 'Amares', 'Vila Verde', 'Esposende', 'Póvoa de Varzim'],
  "Bragança": ['Vinhais', 'Macedo de Cavaleiros', 'Miranda do Douro', 'Vimioso'],
  "Cabeceiras de Basto": ['Fafe', 'Celorico de Basto', 'Amarante', 'Mondim de Basto'],
  "Caldas da Rainha": ['Leiria', 'Alcobaça', 'Nazaré', 'Óbidos', 'Torres Vedras'],
  "Caminha": ['Viana do Castelo', 'Vila Nova de Cerveira', 'Ponte de Lima'],
  "Campo Maior": ['Elvas', 'Portalegre'],
  "Cantanhede": ['Coimbra', 'Vagos', 'Mira', 'Montemor-o-Velho', 'Figueira da Foz', 'Anadia'],
  "Cartaxo": ['Santarém', 'Almeirim', 'Vila Franca de Xira', 'Azambuja'],
  "Cascais": ['Sintra', 'Oeiras', 'Lisboa'],
  "Castelo Branco": ['Covilhã', 'Fundão', 'Proença-a-Nova', 'Idanha-a-Nova', 'Oleiros'],
  "Celorico de Basto": ['Cabeceiras de Basto', 'Amarante', 'Felgueiras'],
  "Chaves": ['Valpaços', 'Montalegre', 'Boticas', 'Vinhais'],
  "Coimbra": ['Condeixa-a-Nova', 'Montemor-o-Velho', 'Mealhada', 'Anadia', 'Cantanhede', 'Miranda do Corvo', 'Penacova', 'Soure'],
  "Covilhã": ['Castelo Branco', 'Fundão', 'Belmonte', 'Guarda', 'Seia'],
  "Elvas": ['Portalegre', 'Campo Maior', 'Estremoz'],
  "Entroncamento": ['Torres Novas', 'Abrantes', 'Tomar'],
  "Espinho": ['Gaia', 'Santa Maria da Feira', 'Ovar'],
  "Esposende": ['Barcelos', 'Braga', 'Viana do Castelo', 'Póvoa de Varzim'],
  "Estarreja": ['Aveiro', 'Murtosa', 'Ovar', 'Oliveira de Azeméis', 'Albergaria-a-Velha'],
  "Estremoz": ['Évora', 'Arraiolos', 'Borba', 'Vila Viçosa', 'Elvas'],
  "Fafe": ['Guimarães', 'Braga', 'Póvoa de Lanhoso', 'Cabeceiras de Basto', 'Vieira do Minho'],
  "Famalicão": ['Braga', 'Barcelos', 'Trofa', 'Santo Tirso', 'Póvoa de Varzim', 'Vila do Conde', 'Guimarães'],
  "Faro": ['Loulé', 'Olhão', 'São Brás de Alportel', 'Tavira'],
  "Felgueiras": ['Guimarães', 'Paços de Ferreira', 'Lousada', 'Amarante', 'Celorico de Basto'],
  "Figueira da Foz": ['Cantanhede', 'Mira', 'Montemor-o-Velho', 'Soure'],
  "Fundão": ['Castelo Branco', 'Covilhã', 'Belmonte'],
  "Gaia": ['Porto', 'Gondomar', 'Santa Maria da Feira', 'Espinho', 'Matosinhos'],
  "Gondomar": ['Porto', 'Gaia', 'Valongo', 'Penafiel', 'Santa Maria da Feira'],
  "Gouveia": ['Seia', 'Guarda', 'Mangualde', 'Celorico da Beira'],
  "Grândola": ['Setúbal', 'Alcácer do Sal', 'Santiago do Cacém', 'Sines'],
  "Guarda": ['Covilhã', 'Manteigas', 'Seia', 'Sabugal', 'Pinhel', 'Trancoso', 'Celorico da Beira'],
  "Guimarães": ['Braga', 'Famalicão', 'Felgueiras', 'Fafe', 'Vizela', 'Santo Tirso', 'Paços de Ferreira'],
  "Lagoa": ['Portimão', 'Silves', 'Albufeira'],
  "Lagos": ['Portimão', 'Aljezur', 'Vila do Bispo'],
  "Lamego": ['Peso da Régua', 'Resende', 'Castro Daire', 'Tarouca'],
  "Leiria": ['Batalha', 'Marinha Grande', 'Porto de Mós', 'Alcobaça', 'Pombal', 'Ourém'],
  "Lisboa": ['Loures', 'Odivelas', 'Amadora', 'Sintra', 'Oeiras', 'Cascais', 'Almada'],
  "Loulé": ['Faro', 'Albufeira', 'São Brás de Alportel', 'Silves', 'Tavira'],
  "Loures": ['Lisboa', 'Odivelas', 'Vila Franca de Xira', 'Mafra', 'Sintra'],
  "Lousada": ['Felgueiras', 'Paços de Ferreira', 'Penafiel', 'Amarante'],
  "Lousã": ['Miranda do Corvo', 'Coimbra', 'Góis', 'Oliveira do Hospital'],
  "Macedo de Cavaleiros": ['Bragança', 'Mirandela', 'Vinhais', 'Alfândega da Fé'],
  "Mafra": ['Sintra', 'Loures', 'Torres Vedras'],
  "Maia": ['Porto', 'Matosinhos', 'Trofa', 'Vila do Conde', 'Valongo', 'Gondomar'],
  "Mangualde": ['Viseu', 'Nelas', 'Penalva do Castelo', 'Gouveia'],
  "Marco de Canaveses": ['Amarante', 'Penafiel', 'Baião', 'Resende'],
  "Marinha Grande": ['Leiria', 'Pombal', 'Alcobaça'],
  "Matosinhos": ['Porto', 'Maia', 'Póvoa de Varzim', 'Vila do Conde', 'Gondomar'],
  "Mealhada": ['Aveiro', 'Águeda', 'Anadia', 'Coimbra'],
  "Melgaço": ['Monção', 'Arcos de Valdevez'],
  "Miranda do Corvo": ['Coimbra', 'Condeixa-a-Nova', 'Lousã', 'Góis'],
  "Mirandela": ['Macedo de Cavaleiros', 'Chaves', 'Valpaços', 'Murça'],
  "Moita": ['Barreiro', 'Montijo', 'Palmela'],
  "Montalegre": ['Chaves', 'Boticas', 'Vieira do Minho', 'Terras de Bouro'],
  "Montijo": ['Barreiro', 'Moita', 'Alcochete', 'Benavente'],
  "Monção": ['Valença', 'Melgaço', 'Arcos de Valdevez', 'Paredes de Coura'],
  "Moura": ['Serpa', 'Beja', 'Barrancos', 'Mourão'],
  "Murtosa": ['Aveiro', 'Estarreja', 'Ovar'],
  "Mértola": ['Serpa', 'Beja', 'Castro Verde'],
  "Nazaré": ['Alcobaça', 'Caldas da Rainha'],
  "Nelas": ['Viseu', 'Mangualde', 'Anadia', 'Santa Comba Dão'],
  "Odivelas": ['Lisboa', 'Loures', 'Amadora', 'Sintra'],
  "Oeiras": ['Lisboa', 'Amadora', 'Cascais', 'Sintra'],
  "Olhão": ['Faro', 'Tavira', 'São Brás de Alportel'],
  "Oliveira de Azeméis": ['Santa Maria da Feira', 'Estarreja', 'São João da Madeira', 'Vale de Cambra', 'Albergaria-a-Velha'],
  "Oliveira do Bairro": ['Aveiro', 'Águeda', 'Mealhada', 'Anadia'],
  "Oliveira do Hospital": ['Lousã', 'Góis', 'Arganil', 'Seia', 'Nelas'],
  "Ourém": ['Tomar', 'Leiria', 'Batalha'],
  "Ovar": ['Espinho', 'Estarreja', 'Santa Maria da Feira', 'Murtosa'],
  "Palmela": ['Setúbal', 'Seixal', 'Barreiro', 'Almada', 'Alcochete'],
  "Paredes": ['Valongo', 'Gondomar', 'Penafiel', 'Santo Tirso', 'Paços de Ferreira'],
  "Paredes de Coura": ['Vila Nova de Cerveira', 'Valença', 'Monção', 'Ponte de Lima'],
  "Paços de Ferreira": ['Guimarães', 'Felgueiras', 'Lousada', 'Santo Tirso', 'Paredes'],
  "Penafiel": ['Gondomar', 'Valongo', 'Paredes', 'Lousada', 'Amarante'],
  "Peniche": ['Óbidos', 'Caldas da Rainha'],
  "Peso da Régua": ['Vila Real', 'Lamego', 'Mesão Frio'],
  "Pombal": ['Leiria', 'Marinha Grande', 'Coimbra', 'Soure'],
  "Ponte da Barca": ['Arcos de Valdevez', 'Ponte de Lima', 'Terras de Bouro'],
  "Ponte de Lima": ['Viana do Castelo', 'Braga', 'Arcos de Valdevez', 'Barcelos', 'Ponte da Barca'],
  "Portalegre": ['Elvas', 'Campo Maior', 'Alter do Chão', 'Arronches', 'Marvão', 'Crato'],
  "Portimão": ['Lagoa', 'Silves', 'Lagos', 'Monchique'],
  "Porto": ['Gaia', 'Matosinhos', 'Maia', 'Gondomar', 'Valongo'],
  "Porto de Mós": ['Leiria', 'Batalha', 'Alcobaça', 'Torres Novas'],
  "Póvoa de Lanhoso": ['Braga', 'Amares', 'Fafe', 'Vieira do Minho', 'Guimarães'],
  "Póvoa de Varzim": ['Vila do Conde', 'Barcelos', 'Famalicão', 'Esposende', 'Maia', 'Matosinhos'],
  "Rio Maior": ['Santarém', 'Caldas da Rainha', 'Alcobaça', 'Azambuja'],
  "Santa Maria da Feira": ['Gaia', 'Gondomar', 'Espinho', 'Ovar', 'Oliveira de Azeméis', 'São João da Madeira'],
  "Santarém": ['Torres Novas', 'Almeirim', 'Cartaxo', 'Rio Maior', 'Benavente', 'Abrantes'],
  "Santiago do Cacém": ['Grândola', 'Sines', 'Alcácer do Sal', 'Odemira'],
  "Santo Tirso": ['Guimarães', 'Famalicão', 'Trofa', 'Maia', 'Paredes', 'Paços de Ferreira'],
  "Seia": ['Guarda', 'Gouveia', 'Oliveira do Hospital', 'Covilhã'],
  "Seixal": ['Almada', 'Barreiro', 'Palmela', 'Setúbal'],
  "Serpa": ['Beja', 'Moura', 'Mértola', 'Vidigueira'],
  "Sesimbra": ['Almada', 'Setúbal', 'Palmela'],
  "Setúbal": ['Palmela', 'Seixal', 'Almada', 'Alcácer do Sal', 'Grândola'],
  "Sever do Vouga": ['Albergaria-a-Velha', 'Águeda', 'Vale de Cambra', 'Arouca'],
  "Silves": ['Loulé', 'Albufeira', 'Portimão', 'Lagoa'],
  "Sines": ['Santiago do Cacém', 'Grândola', 'Odemira'],
  "Sintra": ['Lisboa', 'Amadora', 'Cascais', 'Mafra', 'Loures', 'Oeiras'],
  "São João da Madeira": ['Santa Maria da Feira', 'Oliveira de Azeméis', 'Vale de Cambra'],
  "Tavira": ['Faro', 'Loulé', 'Olhão', 'Castro Marim', 'Vila Real de Santo António'],
  "Terras de Bouro": ['Amares', 'Braga', 'Ponte da Barca', 'Arcos de Valdevez'],
  "Tomar": ['Entroncamento', 'Ourém', 'Torres Novas', 'Ferreira do Zêzere'],
  "Tondela": ['Viseu', 'Águeda', 'Santa Comba Dão', 'Sátão'],
  "Torres Novas": ['Santarém', 'Porto de Mós', 'Entroncamento', 'Tomar'],
  "Torres Vedras": ['Mafra', 'Caldas da Rainha', 'Óbidos', 'Lisboa'],
  "Trofa": ['Famalicão', 'Santo Tirso', 'Vila do Conde', 'Maia'],
  "Vagos": ['Aveiro', 'Ílhavo', 'Cantanhede', 'Mira'],
  "Vale de Cambra": ['São João da Madeira', 'Oliveira de Azeméis', 'Sever do Vouga', 'Arouca'],
  "Valença": ['Vila Nova de Cerveira', 'Monção', 'Paredes de Coura'],
  "Valongo": ['Porto', 'Maia', 'Gondomar', 'Penafiel', 'Paredes'],
  "Viana do Castelo": ['Esposende', 'Barcelos', 'Ponte de Lima', 'Caminha', 'Arcos de Valdevez', 'Vila Nova de Cerveira'],
  "Vieira do Minho": ['Braga', 'Póvoa de Lanhoso', 'Fafe', 'Cabeceiras de Basto', 'Montalegre'],
  "Vila Franca de Xira": ['Loures', 'Cartaxo', 'Benavente', 'Azambuja'],
  "Vila Nova de Cerveira": ['Caminha', 'Viana do Castelo', 'Valença', 'Paredes de Coura'],
  "Vila Real": ['Peso da Régua', 'Alijó', 'Murça', 'Mondim de Basto', 'Sabrosa'],
  "Vila Real de Santo António": ['Tavira', 'Castro Marim'],
  "Vila Verde": ['Braga', 'Barcelos', 'Amares', 'Ponte de Lima'],
  "Vila Viçosa": ['Borba', 'Estremoz', 'Elvas'],
  "Vila do Conde": ['Póvoa de Varzim', 'Barcelos', 'Famalicão', 'Trofa', 'Maia', 'Matosinhos'],
  "Viseu": ['Mangualde', 'Tondela', 'Nelas', 'Santa Comba Dão', 'Penalva do Castelo', 'Sátão'],
  "Vizela": ['Guimarães', 'Felgueiras', 'Santo Tirso', 'Paços de Ferreira'],
};

function getProximas(loc) {
  if (!loc) return [];
  const key = Object.keys(PROX).find(k => k.toLowerCase() === loc.toLowerCase());
  return key ? [key, ...PROX[key]] : [loc];
}

function sugerirDataParaLocalidade(locality) {
  if (!locality || !window.appointments) return null;

  const proximas = getProximas(locality);
  const hoje = new Date();
  hoje.setHours(0,0,0,0);
  const MAX_DIAS = 21; // procurar nas próximas 3 semanas
  const MAX_SERVICOS = 5;

  // Agrupar appointments por data
  const porDia = {};
  window.appointments.forEach(function(a) {
    if (!a.date) return;
    const d = a.date.slice(0,10);
    if (!porDia[d]) porDia[d] = { count: 0, localidades: [] };
    porDia[d].count++;
    if (a.locality) porDia[d].localidades.push(a.locality);
  });

  const candidatos = [];

  for (var i = 1; i <= MAX_DIAS; i++) {
    var d = new Date();
    d.setHours(12,0,0,0);
    d.setDate(d.getDate() + i);
    var dow = d.getDay(); // 0=dom, 6=sab
    if (dow === 0 || dow === 6) continue; // ignorar fim de semana

    var iso = d.getFullYear() + '-' +
      String(d.getMonth()+1).padStart(2,'0') + '-' +
      String(d.getDate()).padStart(2,'0');
    var dia = porDia[iso] || { count: 0, localidades: [] };

    if (dia.count >= MAX_SERVICOS) continue; // dia cheio

    // Verificar proximidade
    var temMesma = dia.localidades.some(function(l) {
      return l && l.toLowerCase() === locality.toLowerCase();
    });
    var temProxima = !temMesma && dia.localidades.some(function(l) {
      return l && proximas.some(function(p) {
        return p.toLowerCase() === l.toLowerCase();
      });
    });

    candidatos.push({
      date: iso,
      count: dia.count,
      localidades: dia.localidades,
      score: temMesma ? 100 : temProxima ? 50 : 0,
      temMesma: temMesma,
      temProxima: temProxima
    });
  }

  if (!candidatos.length) return null;

  // Ordenar: mesma localidade primeiro, depois proxima, depois menos serviços
  candidatos.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.count - b.count;
  });

  return candidatos[0];
}

  const POLL_INTERVAL = 30000;
  const SEEN_KEY = 'eg_seen_cr';
  const BANNER_ID = 'crBannerContainer';

  function shouldRun() {
    var role = window.authClient && window.authClient.getUser && window.authClient.getUser() && window.authClient.getUser().role;
    return role === 'coordenador' || role === 'admin';
  }

  function isSeen(id) { return false; } // sempre mostrar

  function markSeen(id) {
    // marcar no DOM apenas — não guardar em localStorage
    var card = document.getElementById('crCard-' + id);
    if (card) card.dataset.dismissed = '1';
  }

  function isDismissed(id) {
    var card = document.getElementById('crCard-' + id);
    return card && card.dataset.dismissed === '1';
  }

  function getPortalId() {
    var sel = document.getElementById('portalSwitcherSelect');
    if (sel && sel.value) return sel.value;
    if (window.currentPortalId) return window.currentPortalId;
    if (window.activePortalId) return window.activePortalId;
    if (window.portalConfig && window.portalConfig.id) return window.portalConfig.id;
    var u = window.authClient && window.authClient.getUser && window.authClient.getUser();
    if (u && u.portal_id) return u.portal_id;
    return null;
  }

  async function fetchPendingRequests() {
    var portalId = getPortalId();
    try {
      var url = portalId
        ? '/.netlify/functions/commercial-request?portal_id=' + portalId
        : '/.netlify/functions/commercial-request?all=1';
      var r = await window.authClient.authenticatedFetch(url);
      var d = await r.json();
      return d.success ? (d.requests || []) : [];
    } catch (_) { return []; }
  }

  function ensureStyles() {
    if (document.getElementById('crBannerStyle')) return;
    var s = document.createElement('style');
    s.id = 'crBannerStyle';
    s.textContent = [
      '@keyframes crPulse{0%,100%{background:#fef3c7}50%{background:#fde68a}}',
      '@keyframes crDot{0%,100%{opacity:1}50%{opacity:0.3}}',
      '#crBannerContainer{display:none;flex-direction:column;gap:6px;padding:8px 14px;background:#fef3c7;border-bottom:2px solid #f59e0b;z-index:50;}',
      '#crBannerContainer.cr-pulsing{animation:crPulse 1.5s ease-in-out 3;}',
      '.cr-header{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;}',
      '.cr-dot{width:8px;height:8px;border-radius:50%;background:#f59e0b;animation:crDot 1s ease-in-out infinite;}',
      '.cr-grid{display:flex;flex-wrap:wrap;gap:6px;}',
      '@keyframes crPulseCard{0%,100%{border-color:currentColor;box-shadow:0 2px 6px rgba(245,158,11,.15)}50%{box-shadow:0 0 12px 3px rgba(245,158,11,.5)}}',
      '@keyframes crPulseOrange{0%,100%{border-color:#f97316;box-shadow:0 2px 6px rgba(249,115,22,.15)}50%{box-shadow:0 0 12px 3px rgba(249,115,22,.6)}}',
      '@keyframes crPulseRed{0%,100%{border-color:#ef4444;box-shadow:0 2px 6px rgba(239,68,68,.15)}50%{box-shadow:0 0 12px 3px rgba(239,68,68,.7)}}',
      '.cr-card{background:#fff;border:2px solid #f59e0b;border-radius:10px;padding:8px 10px;font-family:Figtree,system-ui,sans-serif;box-shadow:0 2px 6px rgba(245,158,11,.15);min-width:140px;flex:1;max-width:200px;display:flex;flex-direction:column;gap:3px;animation:crPulseCard 1.5s ease-in-out infinite;}',
      '.cr-card.cr-orange{border-color:#f97316;animation:crPulseOrange 1.2s ease-in-out infinite;}',
      '.cr-card.cr-red{border-color:#ef4444;animation:crPulseRed 1s ease-in-out infinite;}',
      '.cr-card-top{display:flex;justify-content:space-between;align-items:center;}',
      '.cr-card-plate{font-family:Rajdhani,monospace;font-size:14px;font-weight:900;color:#92400e;letter-spacing:0.5px;}',
      '.cr-card-loc{font-size:11px;color:#78350f;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.cr-card-meta{font-size:10px;color:#a16207;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.cr-btn-agenda{background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;width:100%;margin-top:2px;}',
      '.cr-btn-agenda:hover{background:#d97706;}',
      '.cr-x{background:none;border:none;color:#d97706;font-size:13px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;}'
    ].join('');
    document.head.appendChild(s);
  }

  function ensureContainer() {
    var el = document.getElementById(BANNER_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = BANNER_ID;
    var switcher = document.getElementById('portalSwitcher');
    if (switcher && switcher.parentNode) {
      switcher.parentNode.insertBefore(el, switcher.nextSibling);
    } else {
      var nav = document.querySelector('.nav-bar');
      if (nav && nav.parentNode) nav.parentNode.insertBefore(el, nav);
      else document.body.prepend(el);
    }
    return el;
  }

  function buildCard(req) {
    var now = Date.now();
    var created = new Date(req.created_at).getTime();
    var diffMin = Math.floor((now - created) / 60000);
    var time;
    if (diffMin < 1) time = 'agora';
    else if (diffMin < 60) time = diffMin + ' min';
    else if (diffMin < 1440) { var h = Math.floor(diffMin/60); var m = diffMin%60; time = h + 'h' + (m > 0 ? String(m).padStart(2,'0') : ''); }
    else { var dias = Math.floor(diffMin/1440); var horas = Math.floor((diffMin%1440)/60); time = dias + 'd ' + horas + 'h'; }
    var name = (req.commercial_name || 'Comercial').split(' ')[0];
    var meta = name + (req.service_file ? ' · ' + req.service_file : '') + ' · ' + time;

    // Calcular urgência
    var ageMin = (Date.now() - new Date(req.created_at).getTime()) / 60000;
    var urgClass = ageMin > 60 ? 'cr-red' : ageMin > 30 ? 'cr-orange' : '';

    var card = document.createElement('div');
    card.className = 'cr-card' + (urgClass ? ' ' + urgClass : '');
    card.id = 'crCard-' + req.id;

    var top = document.createElement('div');
    top.className = 'cr-card-top';

    var plate = document.createElement('div');
    plate.className = 'cr-card-plate';
    plate.style.color = ageMin > 60 ? '#991b1b' : ageMin > 30 ? '#9a3412' : '#92400e';
    plate.textContent = req.plate;

    var xBtn = document.createElement('button');
    xBtn.className = 'cr-x';
    xBtn.textContent = '✕';
    xBtn.onclick = function() { crDismiss(req.id); };

    top.appendChild(plate);
    top.appendChild(xBtn);

    var loc = document.createElement('div');
    loc.className = 'cr-card-loc';
    loc.textContent = '📍 ' + req.locality;

    var metaEl = document.createElement('div');
    metaEl.className = 'cr-card-meta';
    metaEl.textContent = '👤 ' + meta;

    var agBtn = document.createElement('button');
    agBtn.className = 'cr-btn-agenda';
    agBtn.style.background = ageMin > 60 ? '#ef4444' : ageMin > 30 ? '#f97316' : '#f59e0b';
    agBtn.textContent = '📅 Agendar';
    agBtn.dataset.req = JSON.stringify(req);
    agBtn.onclick = function() { crViewInAgenda(JSON.parse(this.dataset.req)); };

    card.appendChild(top);
    card.appendChild(loc);
    card.appendChild(metaEl);
    card.appendChild(agBtn);

    return card;
  }

  function renderBanner(requests) {
    ensureStyles();
    var container = ensureContainer();
    var newOnes = requests.filter(function(r) { return !isDismissed(r.id); });
    if (newOnes.length === 0) { container.style.display = 'none'; return; }

    container.style.display = 'flex';
    // sem animação no container

    // Limpar e reconstruir
    container.innerHTML = '';

    var header = document.createElement('div');
    header.className = 'cr-header';
    var dot = document.createElement('div');
    dot.className = 'cr-dot';
    header.appendChild(dot);
    header.appendChild(document.createTextNode(
      newOnes.length === 1 ? '1 pedido pendente' : newOnes.length + ' pedidos pendentes'
    ));
    container.appendChild(header);

    var grid = document.createElement('div');
    grid.className = 'cr-grid';
    newOnes.forEach(function(req) {
      grid.appendChild(buildCard(req));
    });
    container.appendChild(grid);
  }

  window.crAplicarData = function(date) {
    var el = document.getElementById('appointmentDate');
    if (el) {
      el.value = date;
      el.dispatchEvent(new Event('change'));
    }
    var badge = document.getElementById('crDateSuggestion');
    if (badge) badge.style.border = '1.5px solid #16a34a';
  };

  window.crViewInAgenda = function(req) {
    var plate = req.plate; var id = req.id;
    document.getElementById('crCard-' + id) && document.getElementById('crCard-' + id).style.setProperty('border-color', '#2563eb');

    var addBtn = document.getElementById('addServiceBtn') || document.getElementById('addAppointmentNavBtn');
    if (addBtn) {
      addBtn.click();
      setTimeout(function() {
        // Pré-preencher todos os campos do modal
        var r = req;
        var f = function(id, val) {
          var el = document.getElementById(id);
          if (el && val) {
            el.value = val;
            el.dispatchEvent(new Event('input'));
            el.dispatchEvent(new Event('change'));
          }
        };
        f('appointmentPlate', plate);
        if (r.car)          f('appointmentCar', r.car);
        if (r.service_type) f('appointmentService', r.service_type);

        // Activar "Encaminhado por comercial" e seleccionar o comercial
        if (r.commercial_id && typeof window.loadComerciais === 'function') {
          window.loadComerciais().then(function() {
            var hasCb = document.getElementById('hasCommercial');
            var wrap  = document.getElementById('commercialSelectWrap');
            var sel   = document.getElementById('appointmentCommercial');
            if (hasCb && !hasCb.checked) {
              hasCb.checked = true;
              if (wrap) wrap.style.display = 'block';
            }
            if (sel) sel.value = r.commercial_id;
          });
        }

        // Sugestão de data com base na localidade
        var sug = sugerirDataParaLocalidade(r.locality);
        if (sug) {
          // Remover badge anterior
          var oldBadge = document.getElementById('crDateSuggestion');
          if (oldBadge) oldBadge.remove();

          var badge = document.createElement('div');
          badge.id = 'crDateSuggestion';
          var d = new Date(sug.date + 'T12:00:00');
          var dateStr = d.toLocaleDateString('pt-PT', { weekday:'long', day:'numeric', month:'long' });
          var motivo = sug.temMesma
            ? '📍 Já tem serviços em ' + r.locality + ' nesse dia'
            : sug.temProxima
            ? '🗺️ Localidades próximas nesse dia: ' + [...new Set(sug.localidades)].slice(0,3).join(', ')
            : '📅 Dia com menos serviços (' + sug.count + '/' + 5 + ')';

          badge.style.cssText = 'background:#eff6ff;border:1.5px solid #3b82f6;border-radius:10px;padding:10px 14px;margin:12px 0;font-size:13px;';
          badge.innerHTML = '<div style="font-weight:700;color:#1d4ed8;margin-bottom:2px;">💡 Sugestão de data</div>' +
            '<div style="color:#1e40af;font-size:14px;font-weight:600;">' + dateStr + ' (' + sug.count + ' serviços)</div>' +
            '<div style="color:#64748b;font-size:11px;margin-top:2px;">' + motivo + '</div>' +
            '<button onclick="crAplicarData(\'' + sug.date + '\')" style="margin-top:8px;background:#3b82f6;color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">✓ Usar esta data</button>';

          // Inserir no topo do form do modal
          setTimeout(function() {
            var existing = document.getElementById('crDateSuggestion');
            if (existing) existing.remove();
            var form = document.getElementById('appointmentForm') ||
                       document.querySelector('#appointmentModal form');
            if (form) form.insertBefore(badge, form.firstChild);
          }, 100);
        }
        if (r.phone)        f('appointmentPhone', r.phone);
        if (r.entity)       f('appointmentClientName', r.entity);
        // Localidade via selectLocality do script.js
        if (r.locality && typeof window.selectLocality === 'function') {
          window.selectLocality(r.locality);
        }
        // Notas
        if (r.service_file || r.notes) {
          var notesEl = document.getElementById('appointmentNotes');
          if (notesEl) notesEl.value = [r.service_file ? 'Ficha: '+r.service_file : '', r.notes || ''].filter(Boolean).join(' | ');
        }
      }, 300);
    }

    // Só remover ao GUARDAR (submit) — cancelar/fechar mantém o card
    var container = document.getElementById(BANNER_ID);
    var onSave = function() {
      // Marcar como done na DB
      if (window.authClient && window.authClient.authenticatedFetch) {
        window.authClient.authenticatedFetch('/.netlify/functions/commercial-request', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, status: 'done' })
        }).catch(function(){});
      }
      var card2 = document.getElementById('crCard-' + id);
      if (card2) card2.remove();
      if (container && !container.querySelector('.cr-card')) container.style.display = 'none';
    };
    var form = document.getElementById('appointmentForm');
    if (form) form.addEventListener('submit', onSave, { once: true });
  };

  window.crDismiss = function(id) {
    // Modal de confirmação
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:#fff;border-radius:16px;padding:24px;max-width:300px;width:90%;text-align:center;">' +
      '<div style="font-size:28px;margin-bottom:10px;">🗑️</div>' +
      '<div style="font-weight:700;font-size:15px;margin-bottom:6px;">Cancelar este pedido?</div>' +
      '<div style="font-size:12px;color:#64748b;margin-bottom:18px;">O comercial ficará com o registo como cancelado.</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button id="crDNo" style="flex:1;background:#f1f5f9;color:#475569;border:none;padding:10px;border-radius:8px;font-weight:700;cursor:pointer;">Não</button>' +
        '<button id="crDYes" style="flex:1;background:#ef4444;color:#fff;border:none;padding:10px;border-radius:8px;font-weight:700;cursor:pointer;">Cancelar Pedido</button>' +
      '</div></div>';
    document.body.appendChild(overlay);

    overlay.querySelector('#crDNo').onclick = function() { document.body.removeChild(overlay); };
    overlay.querySelector('#crDYes').onclick = async function() {
      document.body.removeChild(overlay);

      // Marcar como cancelled na DB
      try {
        await window.authClient.authenticatedFetch('/.netlify/functions/commercial-request', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, status: 'cancelled' })
        });
      } catch(_) {}

      // Remover card
      var card = document.getElementById('crCard-' + id);
      if (card) card.remove();
      var container = document.getElementById(BANNER_ID);
      if (container && !container.querySelector('.cr-card')) container.style.display = 'none';
    };
  };

  async function poll() {
    if (!shouldRun()) return;
    var requests = await fetchPendingRequests();
    if (requests.length > 0) renderBanner(requests);
  }

  function start() {
    if (!shouldRun()) return;
    poll();
    setInterval(poll, POLL_INTERVAL);
  }

  // Expor para ser chamado pelo script.js após load()
  window.crStartPolling = start;
  window.addEventListener('portalReady', function() { setTimeout(start, 50); });
  window.addEventListener('portalChanged', poll);

  // Verificar a cada 200ms se portal está pronto (portalConfig existe)
  var _started = false;
  var _t = 0;
  var _iv = setInterval(function() {
    _t += 200;
    if (_started) { clearInterval(_iv); return; }
    var u = window.authClient && window.authClient.getUser && window.authClient.getUser();
    var ready = window.portalConfig || (u && u.role);
    if (u && ready && (u.role === 'coordenador' || u.role === 'admin')) {
      _started = true;
      clearInterval(_iv);
      start();
    }
    if (_t > 20000) clearInterval(_iv);
  }, 200);

  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && _started) poll();
  });

})();
