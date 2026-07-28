(function () {
  'use strict';

  const Core = window.PitStopCore;
  if (!Core) throw new Error('Motor do jogo indisponível');

  const query = new URLSearchParams(location.search);
  const demoMode = query.get('demo') === '1';
  const token = localStorage.getItem('eg_auth_token');
  if (!token && !demoMode) {
    location.replace('login.html');
    return;
  }

  let currentUser = null;
  try {
    currentUser = JSON.parse(localStorage.getItem('eg_auth_user') || 'null');
  } catch (_) {
    currentUser = null;
  }

  const API = '/.netlify/functions/game-scores';
  const CAR_COLORS = [
    ['#315b9b', '#172e58'],
    ['#a6acb5', '#535c6b'],
    ['#b82a3e', '#641629'],
    ['#1d887d', '#0b4949'],
    ['#d3d8df', '#6d7787'],
    ['#8153b4', '#3a285f']
  ];
  const DAMAGE_CASES = [
    { diameterMm: 18, edgeDistanceMm: 92, driverField: false, type: 'Impacto em estrela', origin: { x: .38, y: .47 } },
    { diameterMm: 23, edgeDistanceMm: 68, driverField: false, type: 'Olho de boi', origin: { x: .66, y: .56 } },
    { diameterMm: 34, edgeDistanceMm: 88, driverField: false, type: 'Impacto com ramificação', origin: { x: .42, y: .42 } },
    { diameterMm: 16, edgeDistanceMm: 104, driverField: true, type: 'Impacto no campo de visão', origin: { x: .55, y: .42 } },
    { diameterMm: 20, edgeDistanceMm: 41, driverField: false, type: 'Impacto junto ao bordo', origin: { x: .18, y: .57 } },
    { diameterMm: 39, edgeDistanceMm: 32, driverField: true, type: 'Fissura aberta', origin: { x: .69, y: .4 } }
  ];
  const GLASS_CONFIGS = [
    { camera: true, rainSensor: true, heated: false, hud: false },
    { camera: false, rainSensor: true, heated: true, hud: false },
    { camera: true, rainSensor: true, heated: true, hud: true },
    { camera: false, rainSensor: false, heated: true, hud: false }
  ];
  const FEATURE_LABELS = {
    camera: 'Câmara ADAS',
    rainSensor: 'Sensor de chuva',
    heated: 'Aquecido',
    hud: 'HUD'
  };
  const STAGE_COPY = {
    DIAGNOSIS: {
      slot: 0,
      icon: '01',
      kicker: 'Triagem técnica',
      title: 'Reparar ou substituir?',
      text: 'Cruza diâmetro, distância ao bordo e campo de visão. Uma decisão errada custa qualidade.',
      canvas: 'LÊ AS MEDIDAS E DECIDE A INTERVENÇÃO'
    },
    GLASS_PICK: {
      slot: 1,
      icon: '02',
      kicker: 'Referência correta',
      title: 'Escolhe o para-brisas',
      text: 'Compara o equipamento da ordem de serviço com cada referência disponível.',
      canvas: 'ESCOLHE A REFERÊNCIA QUE CUMPRE A ORDEM'
    },
    INJECT: {
      slot: 1,
      icon: '02',
      kicker: 'Preparação da reparação',
      title: 'Posiciona o injetor',
      text: 'Agarra o injetor e centra-o exatamente sobre o ponto de impacto.',
      canvas: 'ARRASTA O INJETOR PARA O CENTRO DO IMPACTO'
    },
    FIT: {
      slot: 2,
      icon: '03',
      kicker: 'Montagem de precisão',
      title: 'Alinha posição e ângulo',
      text: 'Roda o vidro, arrasta pelas ventosas e larga devagar dentro da moldura.',
      canvas: 'RODA, ARRASTA E POUSA SEM IMPACTO'
    },
    PRESSURE: {
      slot: 2,
      icon: '03',
      kicker: 'Injeção de resina',
      title: 'Controla a pressão',
      text: 'Dá três impulsos quando o ponteiro atravessar a zona verde.',
      canvas: 'TOCA NA ZONA VERDE · 3 DOSES'
    },
    ADAS: {
      slot: 3,
      icon: '04',
      kicker: 'Calibração dinâmica',
      title: 'Sincroniza o scanner',
      text: 'Toca no alvo quando a linha de leitura passar exatamente pelo centro.',
      canvas: 'ACERTA O ALVO NO MOMENTO DA PASSAGEM'
    },
    SEAL: {
      slot: 3,
      icon: '04',
      kicker: 'Teste de estanquidade',
      title: 'Bloqueia as infiltrações',
      text: 'Localiza e toca em cada fuga antes que a água atravesse a vedação.',
      canvas: 'FECHA AS FUGAS ANTES DO LIMITE'
    },
    CURE: {
      slot: 3,
      icon: '04',
      kicker: 'Cura e acabamento',
      title: 'Expulsa as microbolhas',
      text: 'Elimina as bolhas pela ordem em que surgem antes de a resina endurecer.',
      canvas: 'TOCA NA BOLHA ATIVA ANTES QUE ENDUREÇA'
    }
  };

  const els = {};
  [
    'gameCanvas', 'canvasShell', 'startOverlay', 'pauseOverlay', 'endOverlay',
    'startBtn', 'startBtnText', 'pauseBtn', 'resumeBtn', 'againBtn', 'rankBtn',
    'endRankBtn', 'soundBtn', 'score', 'combo', 'comboPill', 'timer', 'mobileTimer',
    'timerRing', 'timerCard', 'timeMessage', 'jobNumber', 'jobsDone', 'averageQuality',
    'personalBest', 'briefIcon', 'briefKicker', 'briefTitle', 'briefText',
    'stageProgress', 'liveQuality', 'stageFlash', 'stageFlashKicker',
    'stageFlashTitle', 'countdown', 'finalScore', 'finalJobs', 'finalQuality',
    'finalCombo', 'endTitle', 'endKicker', 'saveStatus', 'rankModal', 'closeRankBtn',
    'periodTabs', 'viewTabs', 'rankList', 'myBest', 'toastLayer', 'tournamentCard',
    'tournamentText', 'multiplierBadge', 'decisionPanel', 'decisionKicker',
    'decisionTitle', 'decisionText', 'decisionFacts', 'decisionChoices',
    'fitControls', 'rotateLeftBtn', 'rotateRightBtn', 'fitAngle'
  ].forEach(function (id) {
    els[id] = document.getElementById(id);
  });

  const canvas = els.gameCanvas;
  const ctx = canvas.getContext('2d', { alpha: false });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointer = {
    x: 0,
    y: 0,
    down: false,
    id: null,
    lastX: 0,
    lastY: 0,
    lastAt: 0
  };
  const particles = [];
  let viewW = 1;
  let viewH = 1;
  let dpr = 1;
  let lastFrame = performance.now();
  let lastPaint = 0;
  let hudStamp = 0;
  let flashAlpha = 0;
  let shake = 0;
  let rankPeriod = 'today';
  let rankView = 'players';
  let rankData = null;
  let pausedForRanking = false;
  let soundEnabled = localStorage.getItem('eg_pitstop_sound') !== '0';
  let lastFrameError = null;

  const game = {
    status: 'idle',
    paused: false,
    activeMs: 0,
    remainingMs: Core.TOTAL_MS,
    stage: 'IDLE',
    stageStartedAt: 0,
    stageProgress: 0,
    stageLocked: false,
    jobs: [],
    job: null,
    score: 0,
    shownScore: 0,
    combo: 0,
    maxCombo: 0,
    sessionToken: null,
    multiplier: 1,
    ranked: false,
    transition: null,
    lastActionAt: -9999,
    lastCountdownSecond: null
  };

  class SoundEngine {
    constructor() {
      this.context = null;
      this.gain = null;
    }

    unlock() {
      if (!soundEnabled) return;
      try {
        if (!this.context) {
          this.context = new (window.AudioContext || window.webkitAudioContext)();
          this.gain = this.context.createGain();
          this.gain.gain.value = .17;
          this.gain.connect(this.context.destination);
        }
        if (this.context.state === 'suspended') this.context.resume();
      } catch (_) {
        soundEnabled = false;
        syncSoundButton();
      }
    }

    tone(frequency, duration, type, volume, delay, endFrequency) {
      if (!soundEnabled) return;
      this.unlock();
      if (!this.context || !this.gain) return;
      const start = this.context.currentTime + (delay || 0);
      const oscillator = this.context.createOscillator();
      const envelope = this.context.createGain();
      oscillator.type = type || 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
      envelope.gain.setValueAtTime(.0001, start);
      envelope.gain.exponentialRampToValueAtTime(volume || .2, start + .012);
      envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
      oscillator.connect(envelope);
      envelope.connect(this.gain);
      oscillator.start(start);
      oscillator.stop(start + duration + .03);
    }

    play(name) {
      if (!soundEnabled) return;
      if (name === 'count') this.tone(330, .11, 'square', .19);
      if (name === 'go') {
        this.tone(440, .14, 'triangle', .22);
        this.tone(660, .2, 'triangle', .2, .09);
      }
      if (name === 'error') this.tone(125, .14, 'sawtooth', .13, 0, 82);
      if (name === 'click') this.tone(510, .055, 'sine', .09, 0, 680);
      if (name === 'pressure') {
        this.tone(230, .09, 'triangle', .16);
        this.tone(720, .12, 'sine', .1, .05);
      }
      if (name === 'glass') {
        this.tone(175, .11, 'sine', .2, 0, 95);
        this.tone(650, .17, 'triangle', .12, .09);
      }
      if (name === 'stage') {
        this.tone(560, .11, 'triangle', .15);
        this.tone(790, .17, 'triangle', .13, .075);
      }
      if (name === 'car') {
        this.tone(410, .12, 'triangle', .16);
        this.tone(620, .16, 'triangle', .16, .08);
        this.tone(910, .28, 'triangle', .13, .17);
      }
      if (name === 'last') this.tone(190, .09, 'square', .16);
      if (name === 'finish') {
        this.tone(350, .18, 'triangle', .15);
        this.tone(520, .2, 'triangle', .14, .12);
        this.tone(760, .4, 'triangle', .13, .24);
      }
    }
  }

  const sound = new SoundEngine();

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function easeOutCubic(value) {
    return 1 - Math.pow(1 - clamp(value, 0, 1), 3);
  }

  function formatNumber(value) {
    return Math.round(value || 0).toLocaleString('pt-PT');
  }

  function formatTime(milliseconds) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
      String(seconds % 60).padStart(2, '0');
  }

  function wait(milliseconds) {
    return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
  }

  function authHeaders(withJson) {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (withJson) headers['Content-Type'] = 'application/json';
    return headers;
  }

  function toast(message, type) {
    const node = document.createElement('div');
    node.className = 'toast' + (type ? ' is-' + type : '');
    node.textContent = message;
    els.toastLayer.appendChild(node);
    setTimeout(function () {
      node.style.opacity = '0';
      node.style.transform = 'translateX(22px)';
      setTimeout(function () { node.remove(); }, 250);
    }, 2600);
  }

  function syncSoundButton() {
    document.body.classList.toggle('is-muted', !soundEnabled);
    els.soundBtn.setAttribute('aria-label', soundEnabled ? 'Desativar o som' : 'Ativar o som');
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = Math.max(1, rect.width);
    viewH = Math.max(1, rect.height);
    const width = Math.round(viewW * dpr);
    const height = Math.round(viewH * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function getGeometry() {
    const portrait = viewW < 620;
    const carW = Math.min(viewW * (portrait ? 1.12 : .69), viewH * (portrait ? .78 : 1.05), 830);
    const carH = carW * (portrait ? .59 : .53);
    const cx = viewW * .5;
    const carTop = portrait ? viewH * .29 : viewH * .32;
    const glassW = carW * .56;
    const glassH = carH * .43;
    const glassCx = cx;
    const glassCy = carTop + carH * .2;
    const topHalf = glassW * .39;
    const bottomHalf = glassW * .5;
    return {
      portrait,
      cx,
      carW,
      carH,
      carTop,
      glassW,
      glassH,
      glassCx,
      glassCy,
      glassPoly: [
        { x: glassCx - topHalf, y: glassCy - glassH * .5 },
        { x: glassCx + topHalf, y: glassCy - glassH * .5 },
        { x: glassCx + bottomHalf, y: glassCy + glassH * .5 },
        { x: glassCx - bottomHalf, y: glassCy + glassH * .5 }
      ]
    };
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      if (((a.y > point.y) !== (b.y > point.y)) &&
          point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || .00001) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  function transformedGlassPolygon(geometry, cx, cy, angle) {
    const cosine = Math.cos(angle || 0);
    const sine = Math.sin(angle || 0);
    return geometry.glassPoly.map(function (point) {
      const localX = point.x - geometry.glassCx;
      const localY = point.y - geometry.glassCy;
      return {
        x: cx + localX * cosine - localY * sine,
        y: cy + localX * sine + localY * cosine
      };
    });
  }

  function pathPolygon(context, polygon) {
    context.beginPath();
    context.moveTo(polygon[0].x, polygon[0].y);
    for (let index = 1; index < polygon.length; index++) {
      context.lineTo(polygon[index].x, polygon[index].y);
    }
    context.closePath();
  }

  function seededRandom(seed) {
    let value = seed % 2147483647;
    if (value <= 0) value += 2147483646;
    return function () {
      value = value * 16807 % 2147483647;
      return (value - 1) / 2147483646;
    };
  }

  function createCracks(damage, seed) {
    const random = seededRandom(seed);
    const rays = [];
    const rayCount = 7 + Math.floor(damage.diameterMm / 5);
    for (let ray = 0; ray < rayCount; ray++) {
      rays.push({
        angle: random() * Math.PI * 2,
        length: .07 + damage.diameterMm / 150 + random() * .08,
        bend: (random() - .5) * .16
      });
    }
    return [{ origin: damage.origin, rays }];
  }

  function shuffle(items, seed) {
    const random = seededRandom(seed);
    const result = items.slice();
    for (let index = result.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      const value = result[index];
      result[index] = result[other];
      result[other] = value;
    }
    return result;
  }

  function makeGlassCandidates(required, seed) {
    const correct = Object.assign({ code: 'EG-' + (410 + seed % 70) }, required);
    const keys = Object.keys(FEATURE_LABELS);
    const wrongA = Object.assign({}, required, {
      code: 'EG-' + (520 + seed % 60)
    });
    wrongA[keys[seed % keys.length]] = !wrongA[keys[seed % keys.length]];
    const wrongB = Object.assign({}, required, {
      code: 'EG-' + (630 + seed % 50)
    });
    wrongB[keys[(seed + 1) % keys.length]] = !wrongB[keys[(seed + 1) % keys.length]];
    if (Core.glassMatches(required, wrongB)) wrongB.camera = !wrongB.camera;
    return shuffle([correct, wrongA, wrongB], seed + 31);
  }

  function createJob() {
    if (game.jobs.length >= Core.MAX_JOBS) {
      endGame();
      return;
    }
    const index = game.jobs.length;
    const repairTurn = index % 2 === 1;
    const pool = DAMAGE_CASES.filter(function (damage) {
      return Core.isRepairable(damage) === repairTurn;
    });
    const damage = Object.assign({}, pool[index % pool.length]);
    const requiredGlass = Object.assign({},
      GLASS_CONFIGS[Math.floor(index / 2) % GLASS_CONFIGS.length]);
    game.job = {
      number: index + 1,
      startedAt: game.activeMs,
      accuracy: 100,
      mistakes: 0,
      colors: CAR_COLORS[index % CAR_COLORS.length],
      damage,
      cracks: createCracks(damage, 9317 + index * 137),
      route: null,
      requiredGlass,
      candidates: makeGlassCandidates(requiredGlass, index + 17),
      oldRemoved: false,
      selectedGlass: null,
      arrivalStart: game.activeMs,
      deliveryStart: 0,
      fit: null,
      injector: null,
      pressure: { doses: 0, target: .64, tolerance: .12 },
      timed: null,
      adas: null,
      repaired: false,
      crackGrowth: 0
    };
    game.stage = 'ARRIVAL';
    game.stageProgress = 0;
    game.stageLocked = true;
    game.stageStartedAt = game.activeMs;
    game.transition = {
      at: game.activeMs + (reducedMotion ? 120 : 760),
      action: function () { setStage('DIAGNOSIS'); }
    };
    els.jobNumber.textContent = '#' + String(index + 1).padStart(2, '0');
    hideDecisionPanel();
    els.fitControls.classList.remove('is-visible');
    configureStageTrack();
    updateHud(true);
  }

  function setStage(stage) {
    game.stage = stage;
    game.stageStartedAt = game.activeMs;
    game.stageProgress = 0;
    game.stageLocked = false;
    game.lastActionAt = -9999;
    pointer.down = false;
    hideDecisionPanel();
    els.fitControls.classList.remove('is-visible');

    if (stage === 'DIAGNOSIS') renderDiagnosis();
    if (stage === 'GLASS_PICK') renderGlassChoice();
    if (stage === 'INJECT') initInjector();
    if (stage === 'FIT') initFit();
    if (stage === 'CURE') initTimedTargets('cure');
    if (stage === 'SEAL') initTimedTargets('seal');
    if (stage === 'ADAS') initAdas();

    const copy = STAGE_COPY[stage];
    if (copy) {
      els.briefIcon.textContent = copy.icon;
      els.briefKicker.textContent = copy.kicker;
      els.briefTitle.textContent = copy.title;
      els.briefText.textContent = copy.text;
    }
    configureStageTrack();
    updateHud(true);
  }

  function configureStageTrack() {
    let labels = ['Diagnóstico', 'Decisão', 'Técnica', 'Controlo'];
    if (game.job && game.job.route === 'repair') labels = ['Diagnóstico', 'Injetor', 'Pressão', 'Cura'];
    if (game.job && game.job.route === 'replace') {
      labels = ['Diagnóstico', 'Vidro', 'Montagem',
        game.job.requiredGlass.camera ? 'ADAS' : 'Estanque'];
    }
    const copy = STAGE_COPY[game.stage];
    const activeSlot = copy ? copy.slot : -1;
    document.querySelectorAll('.stage-track li').forEach(function (node, index) {
      node.querySelector('span').textContent = labels[index];
      node.classList.toggle('is-active', index === activeSlot);
      node.classList.toggle('is-done',
        activeSlot > index || game.stage === 'DELIVERY' || game.stage === 'COMPLETE');
    });
  }

  function showDecisionPanel(mode) {
    els.decisionPanel.dataset.mode = mode;
    els.decisionPanel.classList.add('is-visible');
  }

  function hideDecisionPanel() {
    els.decisionPanel.classList.remove('is-visible', 'is-error', 'is-success');
    delete els.decisionPanel.dataset.mode;
  }

  function appendFact(label, value, emphasis) {
    const item = document.createElement('div');
    if (emphasis) item.classList.add('is-alert');
    const small = document.createElement('small');
    const strong = document.createElement('strong');
    small.textContent = label;
    strong.textContent = value;
    item.append(small, strong);
    els.decisionFacts.appendChild(item);
  }

  function renderDiagnosis() {
    const damage = game.job.damage;
    els.decisionKicker.textContent = damage.type;
    els.decisionTitle.textContent = 'Qual é a intervenção correta?';
    els.decisionText.textContent =
      'Repara apenas até 25 mm, a 60 mm ou mais do bordo e fora do campo de visão do condutor.';
    els.decisionFacts.replaceChildren();
    appendFact('Diâmetro', 'Ø ' + damage.diameterMm + ' mm', damage.diameterMm > 25);
    appendFact('Distância ao bordo', damage.edgeDistanceMm + ' mm', damage.edgeDistanceMm < 60);
    appendFact('Campo de visão', damage.driverField ? 'Dentro' : 'Fora', damage.driverField);
    els.decisionChoices.innerHTML =
      '<button class="decision-btn decision-btn--repair" type="button" data-route="repair">' +
        '<span>Reparar</span><small>Injetar resina</small></button>' +
      '<button class="decision-btn decision-btn--replace" type="button" data-route="replace">' +
        '<span>Substituir</span><small>Montar novo vidro</small></button>';
    showDecisionPanel('diagnosis');
  }

  function featureChips(config) {
    return Object.keys(FEATURE_LABELS).filter(function (key) {
      return config[key];
    }).map(function (key) {
      return '<span>' + FEATURE_LABELS[key] + '</span>';
    }).join('') || '<span>Vidro standard</span>';
  }

  function renderGlassChoice() {
    els.decisionKicker.textContent = 'Ordem de serviço';
    els.decisionTitle.textContent = 'Que referência vai para esta viatura?';
    els.decisionText.textContent = 'Equipamento obrigatório:';
    els.decisionFacts.innerHTML =
      '<div class="required-features">' + featureChips(game.job.requiredGlass) + '</div>';
    els.decisionChoices.replaceChildren();
    game.job.candidates.forEach(function (candidate) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'glass-option';
      button.dataset.glassCode = candidate.code;
      button.innerHTML = '<b>' + candidate.code + '</b><div>' + featureChips(candidate) + '</div>';
      els.decisionChoices.appendChild(button);
    });
    showDecisionPanel('glass');
  }

  function chooseRoute(route, button) {
    if (game.stage !== 'DIAGNOSIS' || game.stageLocked) return;
    const correct = Core.isRepairable(game.job.damage) ? 'repair' : 'replace';
    if (route !== correct) {
      registerMistake(12);
      button.classList.add('is-wrong');
      button.disabled = true;
      els.decisionPanel.classList.add('is-error');
      els.decisionText.textContent = route === 'repair'
        ? 'Risco de segurança: este dano ultrapassa pelo menos um limite de reparação.'
        : 'Substituição desnecessária: este impacto cumpre os três critérios de reparação.';
      return;
    }

    game.job.route = correct;
    button.classList.add('is-correct');
    els.decisionChoices.querySelectorAll('button').forEach(function (choice) {
      choice.disabled = true;
    });
    els.decisionPanel.classList.remove('is-error');
    els.decisionPanel.classList.add('is-success');
    game.stageLocked = true;
    sound.play('stage');
    showStageFlash(correct === 'repair' ? 'Reparação aprovada' : 'Substituição aprovada',
      'Diagnóstico correto');
    if (correct === 'replace') {
      game.job.oldRemoved = true;
      spawnGlassShards(34, '#9beaff');
      flashAlpha = .28;
    }
    configureStageTrack();
    game.transition = {
      at: game.activeMs + (reducedMotion ? 80 : 520),
      action: function () { setStage(correct === 'repair' ? 'INJECT' : 'GLASS_PICK'); }
    };
  }

  function chooseGlass(code, button) {
    if (game.stage !== 'GLASS_PICK' || game.stageLocked) return;
    const candidate = game.job.candidates.find(function (item) { return item.code === code; });
    if (!candidate) return;
    if (!Core.glassMatches(game.job.requiredGlass, candidate)) {
      registerMistake(8);
      button.classList.add('is-wrong');
      button.disabled = true;
      els.decisionPanel.classList.add('is-error');
      els.decisionText.textContent = 'Referência incompatível. Confirma todos os sensores e funções.';
      return;
    }
    game.job.selectedGlass = candidate;
    game.stageLocked = true;
    button.classList.add('is-correct');
    els.decisionChoices.querySelectorAll('button').forEach(function (choice) {
      choice.disabled = true;
    });
    sound.play('stage');
    showStageFlash(candidate.code + ' confirmada', 'Referência correta');
    game.transition = {
      at: game.activeMs + (reducedMotion ? 80 : 480),
      action: function () { setStage('FIT'); }
    };
  }

  function initInjector() {
    const geometry = getGeometry();
    const startX = geometry.portrait ? geometry.glassCx : geometry.glassCx + geometry.glassW * .78;
    const startY = geometry.portrait
      ? geometry.glassCy + geometry.glassH * 1.35
      : geometry.glassCy + geometry.glassH * .42;
    game.job.injector = {
      x: startX,
      y: startY,
      startX,
      startY,
      dragging: false,
      dragX: 0,
      dragY: 0
    };
  }

  function initFit() {
    const geometry = getGeometry();
    const above = geometry.portrait;
    const angle = (game.job.number % 2 ? 13 : -14) * Math.PI / 180;
    const startX = above
      ? geometry.glassCx
      : clamp(geometry.glassCx + geometry.glassW * .84, geometry.glassCx, viewW - geometry.glassW * .28);
    const startY = above
      ? Math.max(92, geometry.glassCy - geometry.glassH * 1.48)
      : geometry.glassCy - geometry.glassH * .03;
    game.job.fit = {
      x: startX,
      y: startY,
      startX,
      startY,
      angle,
      dragging: false,
      dragX: 0,
      dragY: 0,
      speed: 0
    };
    syncFitAngle();
    els.fitControls.classList.add('is-visible');
  }

  function rotateFit(direction) {
    if (game.stage !== 'FIT' || game.stageLocked || !game.job.fit) return;
    game.job.fit.angle = clamp(
      game.job.fit.angle + direction * 3 * Math.PI / 180,
      -28 * Math.PI / 180,
      28 * Math.PI / 180
    );
    sound.play('click');
    syncFitAngle();
    updateFitProgress();
  }

  function syncFitAngle() {
    if (!game.job || !game.job.fit) return;
    els.fitAngle.textContent = Math.round(game.job.fit.angle * 180 / Math.PI) + '°';
  }

  function updateFitProgress() {
    if (!game.job || !game.job.fit) return;
    const geometry = getGeometry();
    const fit = game.job.fit;
    const distance = Math.hypot(fit.x - geometry.glassCx, fit.y - geometry.glassCy);
    const positionScore = clamp(1 - distance / Math.max(1, geometry.glassW * .85), 0, 1);
    const angleScore = clamp(1 - Math.abs(fit.angle) / (.27), 0, 1);
    game.stageProgress = positionScore * .72 + angleScore * .28;
  }

  function initTimedTargets(type) {
    const points = type === 'cure'
      ? [
          { x: .43, y: .46 }, { x: .57, y: .54 }, { x: .49, y: .39 }, { x: .62, y: .45 }
        ]
      : [
          { x: .16, y: .58 }, { x: .46, y: .08 }, { x: .82, y: .55 }, { x: .63, y: .91 }
        ];
    game.job.timed = {
      type,
      index: 0,
      points: shuffle(points, game.job.number * 47 + (type === 'seal' ? 9 : 2)),
      deadline: game.activeMs + (type === 'seal' ? 2300 : 2100)
    };
  }

  function initAdas() {
    game.job.adas = {
      index: 0,
      targets: [
        { x: .29, y: .48 },
        { x: .67, y: .41 },
        { x: .48, y: .62 }
      ]
    };
  }

  function currentTimedPoint(geometry) {
    const timed = game.job && game.job.timed;
    if (!timed || timed.index >= timed.points.length) return null;
    const point = timed.points[timed.index];
    return {
      x: geometry.glassCx - geometry.glassW / 2 + point.x * geometry.glassW,
      y: geometry.glassCy - geometry.glassH / 2 + point.y * geometry.glassH
    };
  }

  function pressureValue() {
    const phase = ((game.activeMs - game.stageStartedAt) / 920) % 2;
    return phase <= 1 ? phase : 2 - phase;
  }

  function adasScannerX(geometry) {
    const phase = ((game.activeMs - game.stageStartedAt) / 1450) % 2;
    const amount = phase <= 1 ? phase : 2 - phase;
    return geometry.glassCx - geometry.glassW * .43 + amount * geometry.glassW * .86;
  }

  function adasTarget(geometry) {
    const adas = game.job && game.job.adas;
    if (!adas || adas.index >= adas.targets.length) return null;
    const target = adas.targets[adas.index];
    return {
      x: geometry.glassCx - geometry.glassW / 2 + target.x * geometry.glassW,
      y: geometry.glassCy - geometry.glassH / 2 + target.y * geometry.glassH
    };
  }

  function registerMistake(penalty) {
    if (!game.job) return;
    game.job.accuracy = clamp(game.job.accuracy - penalty, 0, 100);
    game.job.mistakes += 1;
    shake = Math.max(shake, 4);
    sound.play('error');
    if (navigator.vibrate) navigator.vibrate(28);
    updateHud(true);
  }

  function showStageFlash(title, kicker) {
    els.stageFlashTitle.textContent = title;
    els.stageFlashKicker.textContent = kicker || 'Etapa concluída';
    els.stageFlash.classList.remove('is-visible');
    void els.stageFlash.offsetWidth;
    els.stageFlash.classList.add('is-visible');
  }

  function queueStage(stage, title, kicker, delay) {
    game.stageLocked = true;
    showStageFlash(title, kicker);
    game.transition = {
      at: game.activeMs + (reducedMotion ? 80 : delay),
      action: function () { setStage(stage); }
    };
  }

  function completeInjector() {
    game.stageProgress = 1;
    sound.play('stage');
    queueStage('PRESSURE', 'Injetor bloqueado', 'Centro do impacto confirmado', 480);
  }

  function handlePressureTap() {
    if (game.stage !== 'PRESSURE' || game.stageLocked ||
        game.activeMs - game.lastActionAt < 260) return;
    game.lastActionAt = game.activeMs;
    const pressure = pressureValue();
    const target = game.job.pressure.target;
    if (Math.abs(pressure - target) <= game.job.pressure.tolerance) {
      game.job.pressure.doses += 1;
      game.stageProgress = game.job.pressure.doses / 3;
      sound.play('pressure');
      flashAlpha = .12;
      spawnAtImpact(12, '#7ff3bb');
      if (game.job.pressure.doses >= 3) {
        queueStage('CURE', 'Resina estabilizada', 'Pressão perfeita · 3/3', 520);
      } else {
        showStageFlash('Dose ' + game.job.pressure.doses + '/3', 'Pressão controlada');
      }
    } else {
      registerMistake(6);
      game.job.crackGrowth = clamp(game.job.crackGrowth + .07, 0, .28);
      showStageFlash('Pressão fora da zona', pressure < target ? 'Impulso insuficiente' : 'Excesso de pressão');
    }
  }

  function handleTimedTap(position) {
    if ((game.stage !== 'CURE' && game.stage !== 'SEAL') || game.stageLocked) return;
    const geometry = getGeometry();
    const target = currentTimedPoint(geometry);
    if (!target) return;
    const radius = geometry.portrait ? 31 : 35;
    if (Math.hypot(position.x - target.x, position.y - target.y) <= radius) {
      sound.play('click');
      spawnAt(target.x, target.y, 16, game.stage === 'SEAL' ? '#73ddff' : '#a6f4ff');
      advanceTimedTarget(true);
    } else if (game.activeMs - game.lastActionAt > 420) {
      game.lastActionAt = game.activeMs;
      registerMistake(3);
    }
  }

  function advanceTimedTarget(hit) {
    const timed = game.job.timed;
    if (!hit) registerMistake(timed.type === 'seal' ? 5 : 4);
    timed.index += 1;
    game.stageProgress = timed.index / timed.points.length;
    if (timed.index >= timed.points.length) {
      sound.play('stage');
      completeJob();
      return;
    }
    const base = timed.type === 'seal' ? 2150 : 1950;
    timed.deadline = game.activeMs + Math.max(1250, base - game.jobs.length * 90);
  }

  function handleAdasTap(position) {
    if (game.stage !== 'ADAS' || game.stageLocked ||
        game.activeMs - game.lastActionAt < 260) return;
    game.lastActionAt = game.activeMs;
    const geometry = getGeometry();
    const target = adasTarget(geometry);
    const scannerX = adasScannerX(geometry);
    const aimed = target && Math.hypot(position.x - target.x, position.y - target.y) <=
      (geometry.portrait ? 38 : 42);
    const synced = target && Math.abs(scannerX - target.x) <= geometry.glassW * .075;
    if (aimed && synced) {
      game.job.adas.index += 1;
      game.stageProgress = game.job.adas.index / game.job.adas.targets.length;
      sound.play('pressure');
      spawnAt(target.x, target.y, 20, '#79f2b3');
      showStageFlash('Alvo ' + game.job.adas.index + '/3', 'Sincronização confirmada');
      if (game.job.adas.index >= game.job.adas.targets.length) completeJob();
    } else {
      registerMistake(5);
      showStageFlash(aimed ? 'Fora de sincronismo' : 'Falhaste o alvo',
        aimed ? 'Espera pela linha de leitura' : 'Aponta ao centro do retículo');
    }
  }

  function completeFit() {
    if (game.stageLocked) return;
    const fit = game.job.fit;
    const geometry = getGeometry();
    fit.x = geometry.glassCx;
    fit.y = geometry.glassCy;
    fit.angle = 0;
    game.stageProgress = 1;
    game.stageLocked = true;
    game.job.oldRemoved = false;
    els.fitControls.classList.remove('is-visible');
    flashAlpha = .3;
    shake = 5;
    spawnGlassShards(24, '#b4f3ff');
    sound.play('glass');
    if (navigator.vibrate) navigator.vibrate([20, 30, 35]);
    queueStage(game.job.requiredGlass.camera ? 'ADAS' : 'SEAL',
      'Vidro montado sem tensão', 'Posição e ângulo confirmados', 650);
  }

  function completeJob() {
    if (!game.job || game.stageLocked) return;
    game.stageLocked = true;
    game.stageProgress = 1;
    const durationMs = Math.max(Core.MIN_JOB_MS, Math.round(game.activeMs - game.job.startedAt));
    const slownessPenalty = Math.max(0, Math.round((durationMs - 27000) / 1000) * 2);
    const quality = clamp(Math.round(game.job.accuracy - slownessPenalty), 0, 100);
    if (game.job.route === 'repair') game.job.repaired = true;
    game.jobs.push({
      quality,
      durationMs,
      mistakes: game.job.mistakes
    });
    game.combo = quality >= 78 ? game.combo + 1 : 0;
    game.maxCombo = Math.max(game.maxCombo, game.combo);
    game.score = Core.calculateScore(game.jobs, game.multiplier);
    game.stage = 'DELIVERY';
    game.job.deliveryStart = game.activeMs;
    game.transition = {
      at: game.activeMs + (reducedMotion ? 200 : 1120),
      action: createJob
    };
    flashAlpha = .52;
    shake = 9;
    spawnCelebration(quality);
    sound.play('car');
    if (navigator.vibrate) navigator.vibrate([35, 35, 60]);
    showStageFlash(Core.qualityLabel(quality),
      (game.job.route === 'repair' ? 'Reparação' : 'Substituição') + ' entregue · ' + quality + '%');
    hideDecisionPanel();
    els.fitControls.classList.remove('is-visible');
    configureStageTrack();
    updateHud(true);
  }

  function updateTimedStage() {
    if (!game.job || !game.job.timed || game.stageLocked) return;
    const timed = game.job.timed;
    const windowMs = timed.type === 'seal' ? 2150 : 1950;
    game.stageProgress = clamp(
      (timed.index + clamp((timed.deadline - game.activeMs) / windowMs, 0, 1) * .15) /
      timed.points.length,
      0,
      1
    );
    if (game.activeMs >= timed.deadline) advanceTimedTarget(false);
  }

  function updateGame(dt) {
    if (game.status !== 'playing' || game.paused) return;
    game.activeMs += dt;
    game.remainingMs = Math.max(0, Core.TOTAL_MS - game.activeMs);

    if (game.transition && game.activeMs >= game.transition.at) {
      const action = game.transition.action;
      game.transition = null;
      action();
    }

    if (game.stage === 'FIT' && !game.stageLocked) updateFitProgress();
    if (game.stage === 'CURE' || game.stage === 'SEAL') updateTimedStage();

    const seconds = Math.ceil(game.remainingMs / 1000);
    if (seconds <= 10 && seconds !== game.lastCountdownSecond) {
      game.lastCountdownSecond = seconds;
      sound.play('last');
      if (navigator.vibrate && seconds <= 5) navigator.vibrate(18);
    }
    if (game.remainingMs <= 0) endGame();
  }

  function spawnParticle(options) {
    particles.push({
      x: options.x,
      y: options.y,
      vx: options.vx || 0,
      vy: options.vy || 0,
      gravity: options.gravity == null ? .1 : options.gravity,
      rotation: options.rotation || 0,
      spin: options.spin || 0,
      size: options.size || 5,
      color: options.color || '#a7ecff',
      life: 1,
      duration: options.duration || 800,
      shape: options.shape || 'shard'
    });
  }

  function updateParticles(dt) {
    for (let index = particles.length - 1; index >= 0; index--) {
      const particle = particles[index];
      particle.life -= dt / particle.duration;
      if (particle.life <= 0) {
        particles.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * dt / 16.67;
      particle.y += particle.vy * dt / 16.67;
      particle.vy += particle.gravity * dt / 16.67;
      particle.rotation += particle.spin * dt / 16.67;
    }
  }

  function spawnAt(x, y, count, color) {
    if (reducedMotion) count = Math.min(count, 7);
    for (let index = 0; index < count; index++) {
      spawnParticle({
        x,
        y,
        vx: (Math.random() - .5) * 5,
        vy: -1 - Math.random() * 4,
        gravity: .12,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - .5) * .25,
        size: 2 + Math.random() * 6,
        color,
        duration: 450 + Math.random() * 480,
        shape: index % 3 ? 'spark' : 'shard'
      });
    }
  }

  function spawnAtImpact(count, color) {
    const geometry = getGeometry();
    const damage = game.job.damage;
    spawnAt(
      geometry.glassCx - geometry.glassW / 2 + damage.origin.x * geometry.glassW,
      geometry.glassCy - geometry.glassH / 2 + damage.origin.y * geometry.glassH,
      count,
      color
    );
  }

  function spawnGlassShards(count, color) {
    const geometry = getGeometry();
    if (reducedMotion) count = Math.min(count, 8);
    for (let index = 0; index < count; index++) {
      spawnParticle({
        x: geometry.glassCx + (Math.random() - .5) * geometry.glassW * .7,
        y: geometry.glassCy + (Math.random() - .5) * geometry.glassH * .5,
        vx: (Math.random() - .5) * 7,
        vy: -1 - Math.random() * 6,
        gravity: .14,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - .5) * .25,
        size: 3 + Math.random() * 9,
        color,
        duration: 700 + Math.random() * 650
      });
    }
  }

  function spawnCelebration(quality) {
    const geometry = getGeometry();
    const count = reducedMotion ? 10 : 48;
    const colors = ['#78e2ff', '#f22842', '#ffffff', quality >= 90 ? '#ffc857' : '#315a9a'];
    for (let index = 0; index < count; index++) {
      spawnParticle({
        x: geometry.glassCx + (Math.random() - .5) * geometry.glassW,
        y: geometry.glassCy + geometry.glassH * .35,
        vx: (Math.random() - .5) * 9,
        vy: -2 - Math.random() * 8,
        gravity: .16,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - .5) * .3,
        size: 3 + Math.random() * 9,
        color: colors[index % colors.length],
        duration: 900 + Math.random() * 900
      });
    }
  }

  function drawWorkshop(time) {
    const background = ctx.createLinearGradient(0, 0, 0, viewH);
    background.addColorStop(0, '#111f36');
    background.addColorStop(.61, '#091426');
    background.addColorStop(.62, '#101b2b');
    background.addColorStop(1, '#040912');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.save();
    ctx.globalAlpha = .22;
    ctx.strokeStyle = '#7891b2';
    ctx.lineWidth = 1;
    const panel = Math.max(110, viewW / 7);
    for (let x = 0; x < viewW; x += panel) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, viewH * .65);
      ctx.stroke();
    }
    for (let y = 90; y < viewH * .66; y += 90) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(viewW, y);
      ctx.stroke();
    }
    ctx.restore();

    const floorY = viewH * .66;
    ctx.fillStyle = 'rgba(2,7,14,.5)';
    ctx.fillRect(0, floorY, viewW, viewH - floorY);
    ctx.strokeStyle = 'rgba(113,140,178,.12)';
    for (let index = -4; index <= 4; index++) {
      ctx.beginPath();
      ctx.moveTo(viewW * .5, floorY);
      ctx.lineTo(viewW * .5 + index * viewW * .22, viewH);
      ctx.stroke();
    }
    for (let row = 1; row <= 4; row++) {
      const amount = row / 4;
      const y = floorY + Math.pow(amount, 1.7) * (viewH - floorY);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(viewW, y);
      ctx.stroke();
    }

    for (const center of [viewW * .25, viewW * .75]) {
      const lightWidth = Math.min(240, viewW * .25);
      const glow = ctx.createRadialGradient(center, 35, 0, center, 35, lightWidth);
      glow.addColorStop(0, 'rgba(179,235,255,.18)');
      glow.addColorStop(1, 'rgba(94,183,227,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(center - lightWidth, 0, lightWidth * 2, lightWidth);
      ctx.fillStyle = 'rgba(211,246,255,.8)';
      ctx.fillRect(center - lightWidth * .26, 25, lightWidth * .52, 3);
    }

    drawLift();
    drawGlassRack();
    drawWallSign();
    ctx.save();
    ctx.globalAlpha = .22;
    for (let index = 0; index < 18; index++) {
      const x = (index * 79 + time * .006 * (index % 3 + 1)) % viewW;
      const y = 50 + ((index * 113 + time * .004) % Math.max(100, viewH * .55));
      ctx.fillStyle = index % 4 ? '#bdeeff' : '#ffffff';
      ctx.fillRect(x, y, 1.2, 1.2);
    }
    ctx.restore();
  }

  function drawLift() {
    const geometry = getGeometry();
    const y = geometry.carTop + geometry.carH * .82;
    const left = geometry.cx - geometry.carW * .56;
    const right = geometry.cx + geometry.carW * .56;
    const top = Math.max(55, geometry.carTop - geometry.carH * .54);
    ctx.fillStyle = '#253958';
    ctx.fillRect(left, top, 13, Math.max(0, y - top + 35));
    ctx.fillRect(right - 13, top, 13, Math.max(0, y - top + 35));
    ctx.fillStyle = '#3b5275';
    ctx.fillRect(left - 8, y + 30, 30, 8);
    ctx.fillRect(right - 22, y + 30, 30, 8);
    ctx.fillStyle = '#304766';
    ctx.fillRect(left + 12, y - 7, geometry.carW * .27, 8);
    ctx.fillRect(right - geometry.carW * .27 - 12, y - 7, geometry.carW * .27, 8);
    ctx.fillStyle = '#f22842';
    ctx.fillRect(left + 3, top + 18, 7, 28);
  }

  function drawGlassRack() {
    if (viewW < 660) return;
    const x = viewW - 118;
    const y = viewH * .29;
    ctx.save();
    ctx.strokeStyle = 'rgba(123,153,191,.38)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - 45, y + 160);
    ctx.lineTo(x - 27, y);
    ctx.moveTo(x + 45, y + 160);
    ctx.lineTo(x + 27, y);
    ctx.moveTo(x - 60, y + 160);
    ctx.lineTo(x + 60, y + 160);
    ctx.stroke();
    for (let index = 0; index < 3; index++) {
      const offset = index * 13;
      const glass = [
        { x: x - 42 + offset, y: y + 18 },
        { x: x + 33 + offset, y: y + 18 },
        { x: x + 42 + offset, y: y + 126 },
        { x: x - 51 + offset, y: y + 126 }
      ];
      pathPolygon(ctx, glass);
      ctx.fillStyle = 'rgba(95,193,229,.08)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(130,221,249,.28)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWallSign() {
    if (viewW < 500) return;
    const width = Math.min(230, viewW * .22);
    const x = 24;
    const y = viewH * .18;
    ctx.save();
    ctx.fillStyle = 'rgba(5,13,26,.7)';
    ctx.strokeStyle = 'rgba(139,177,223,.13)';
    ctx.beginPath();
    ctx.roundRect(x, y, width, 54, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f22842';
    ctx.font = '900 ' + Math.max(8, width * .052) + 'px system-ui';
    ctx.fillText('EXPRESSGLASS', x + 13, y + 23);
    ctx.fillStyle = '#748bab';
    ctx.font = '700 ' + Math.max(6, width * .034) + 'px system-ui';
    ctx.fillText('DECISION BAY', x + 13, y + 40);
    ctx.restore();
  }

  function currentCarOffset() {
    if (!game.job || game.status === 'idle') return 0;
    if (game.stage === 'ARRIVAL') {
      return (1 - easeOutCubic((game.activeMs - game.job.arrivalStart) /
        (reducedMotion ? 120 : 760))) * viewW * .95;
    }
    if (game.stage === 'DELIVERY') {
      return -easeOutCubic((game.activeMs - game.job.deliveryStart) /
        (reducedMotion ? 200 : 1120)) * viewW * 1.15;
    }
    return 0;
  }

  function drawCar(geometry, time) {
    if (!game.job) return;
    const offsetX = currentCarOffset();
    const center = geometry.cx;
    const top = geometry.carTop;
    const width = geometry.carW;
    const height = geometry.carH;
    const left = center - width / 2;
    const right = center + width / 2;
    const colors = game.job.colors;
    ctx.save();
    ctx.translate(offsetX, 0);

    const shadow = ctx.createRadialGradient(center, top + height * .92, 0, center, top + height * .92, width * .55);
    shadow.addColorStop(0, 'rgba(0,0,0,.66)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(center, top + height * .94, width * .56, height * .18, 0, 0, Math.PI * 2);
    ctx.fill();

    const body = ctx.createLinearGradient(0, top, 0, top + height);
    body.addColorStop(0, colors[0]);
    body.addColorStop(.62, colors[1]);
    body.addColorStop(1, '#07101c');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(left + width * .13, top + height * .48);
    ctx.bezierCurveTo(left + width * .18, top + height * .18, left + width * .29, top + height * .06, left + width * .38, top + height * .02);
    ctx.bezierCurveTo(left + width * .44, top - height * .01, right - width * .44, top - height * .01, right - width * .38, top + height * .02);
    ctx.bezierCurveTo(right - width * .29, top + height * .06, right - width * .18, top + height * .18, right - width * .13, top + height * .48);
    ctx.bezierCurveTo(right - width * .02, top + height * .55, right, top + height * .67, right - width * .045, top + height * .85);
    ctx.bezierCurveTo(right - width * .14, top + height, left + width * .14, top + height, left + width * .045, top + height * .85);
    ctx.bezierCurveTo(left, top + height * .67, left + width * .02, top + height * .55, left + width * .13, top + height * .48);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.globalAlpha = .3;
    const hood = ctx.createLinearGradient(left, top, right, top + height);
    hood.addColorStop(0, '#ffffff');
    hood.addColorStop(.4, 'rgba(255,255,255,0)');
    hood.addColorStop(1, '#000000');
    ctx.fillStyle = hood;
    ctx.beginPath();
    ctx.moveTo(left + width * .12, top + height * .55);
    ctx.quadraticCurveTo(center, top + height * .4, right - width * .12, top + height * .55);
    ctx.lineTo(right - width * .2, top + height * .87);
    ctx.quadraticCurveTo(center, top + height * .94, left + width * .2, top + height * .87);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    drawHeadlight(left + width * .145, top + height * .63, width * .12, false, time);
    drawHeadlight(right - width * .145, top + height * .63, width * .12, true, time);
    ctx.fillStyle = '#07101b';
    ctx.beginPath();
    ctx.roundRect(center - width * .14, top + height * .78, width * .28, height * .085, 5);
    ctx.fill();
    ctx.fillStyle = '#f1f5f9';
    ctx.beginPath();
    ctx.roundRect(center - width * .105, top + height * .805, width * .21, height * .092, 3);
    ctx.fill();
    ctx.fillStyle = '#1e3565';
    ctx.font = '900 ' + Math.max(7, width * .018) + 'px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('EXPRESSGLASS', center, top + height * .865);
    ctx.fillStyle = '#080d14';
    ctx.beginPath();
    ctx.ellipse(left + width * .15, top + height * .9, width * .085, height * .15, 0, 0, Math.PI * 2);
    ctx.ellipse(right - width * .15, top + height * .9, width * .085, height * .15, 0, 0, Math.PI * 2);
    ctx.fill();
    drawWindshield(geometry, time);
    ctx.restore();
  }

  function drawHeadlight(x, y, radius, mirrored, time) {
    ctx.save();
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.2);
    glow.addColorStop(0, 'rgba(227,250,255,.52)');
    glow.addColorStop(1, 'rgba(151,226,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius * 2.2, y - radius * 2.2, radius * 4.4, radius * 4.4);
    ctx.fillStyle = '#d9f6ff';
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * .34, mirrored ? -.12 : .12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = .24 + Math.sin(time * .003) * .04;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(x, y, radius * .63, radius * .16, mirrored ? -.12 : .12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawWindshield(geometry, time) {
    const empty = game.job.oldRemoved && game.stage !== 'ADAS' &&
      game.stage !== 'SEAL' && game.stage !== 'DELIVERY';
    ctx.save();
    pathPolygon(ctx, geometry.glassPoly);
    ctx.fillStyle = empty ? '#030811' : 'rgba(70,150,190,.27)';
    ctx.fill();
    ctx.lineWidth = Math.max(5, geometry.glassW * .025);
    ctx.strokeStyle = '#050a12';
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(171,228,249,.36)';
    ctx.stroke();

    if (!empty) {
      ctx.save();
      pathPolygon(ctx, geometry.glassPoly);
      ctx.clip();
      const glass = ctx.createLinearGradient(
        geometry.glassCx - geometry.glassW / 2,
        geometry.glassCy - geometry.glassH / 2,
        geometry.glassCx + geometry.glassW / 2,
        geometry.glassCy + geometry.glassH / 2
      );
      glass.addColorStop(0, 'rgba(122,221,247,.3)');
      glass.addColorStop(.38, 'rgba(24,71,106,.25)');
      glass.addColorStop(.7, 'rgba(7,23,43,.5)');
      glass.addColorStop(1, 'rgba(105,203,231,.2)');
      ctx.fillStyle = glass;
      ctx.fillRect(geometry.glassCx - geometry.glassW, geometry.glassCy - geometry.glassH,
        geometry.glassW * 2, geometry.glassH * 2);
      const shineX = geometry.glassCx - geometry.glassW +
        ((time * .045) % (geometry.glassW * 2.3));
      ctx.fillStyle = 'rgba(255,255,255,.075)';
      ctx.save();
      ctx.translate(shineX, geometry.glassCy);
      ctx.rotate(-.42);
      ctx.fillRect(-geometry.glassW * .05, -geometry.glassH,
        geometry.glassW * .1, geometry.glassH * 2);
      ctx.restore();
      ctx.restore();
    }

    if (!game.job.repaired && (game.stage === 'ARRIVAL' || game.stage === 'DIAGNOSIS' ||
        game.job.route === 'repair')) drawCracks(geometry);
    if (game.stage === 'DIAGNOSIS') drawDiagnosticMarks(geometry);
    if (game.stage === 'INJECT') drawInjector(geometry);
    if (game.stage === 'PRESSURE') drawPressureGauge(geometry);
    if (game.stage === 'CURE') drawTimedTarget(geometry, 'cure');
    if (game.stage === 'FIT') drawFittingGlass(geometry);
    if (game.stage === 'ADAS') drawAdas(geometry);
    if (game.stage === 'SEAL') drawTimedTarget(geometry, 'seal');
    if (game.stage === 'DELIVERY') drawInstalledDetails(geometry);
    ctx.restore();
  }

  function impactPoint(geometry) {
    return {
      x: geometry.glassCx - geometry.glassW / 2 + game.job.damage.origin.x * geometry.glassW,
      y: geometry.glassCy - geometry.glassH / 2 + game.job.damage.origin.y * geometry.glassH
    };
  }

  function drawCracks(geometry) {
    if (!game.job || game.job.oldRemoved) return;
    ctx.save();
    pathPolygon(ctx, geometry.glassPoly);
    ctx.clip();
    ctx.lineCap = 'round';
    for (const crack of game.job.cracks) {
      const ox = geometry.glassCx - geometry.glassW / 2 + crack.origin.x * geometry.glassW;
      const oy = geometry.glassCy - geometry.glassH / 2 + crack.origin.y * geometry.glassH;
      const impact = ctx.createRadialGradient(ox, oy, 0, ox, oy, 15);
      impact.addColorStop(0, 'rgba(245,252,255,.95)');
      impact.addColorStop(.24, 'rgba(220,246,255,.46)');
      impact.addColorStop(1, 'rgba(173,230,248,0)');
      ctx.fillStyle = impact;
      ctx.beginPath();
      ctx.arc(ox, oy, 15, 0, Math.PI * 2);
      ctx.fill();
      for (const ray of crack.rays) {
        const length = (ray.length + game.job.crackGrowth) * geometry.glassW;
        const midX = ox + Math.cos(ray.angle + ray.bend) * length * .55;
        const midY = oy + Math.sin(ray.angle + ray.bend) * length * .28;
        const endX = ox + Math.cos(ray.angle) * length;
        const endY = oy + Math.sin(ray.angle) * length * .48;
        ctx.strokeStyle = 'rgba(224,248,255,.8)';
        ctx.lineWidth = 1.05;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(midX, midY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawDiagnosticMarks(geometry) {
    const point = impactPoint(geometry);
    const diameter = clamp(20 + game.job.damage.diameterMm * .55, 28, 46);
    ctx.save();
    ctx.strokeStyle = game.job.damage.diameterMm > 25 ? '#ff6478' : '#77f2b1';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(point.x, point.y, diameter, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(point.x - diameter, point.y - diameter - 5);
    ctx.lineTo(point.x + diameter, point.y - diameter - 5);
    ctx.stroke();
    ctx.fillStyle = '#e8f7ff';
    ctx.font = '900 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Ø ' + game.job.damage.diameterMm + ' mm', point.x, point.y - diameter - 12);
    ctx.restore();
  }

  function drawInjector(geometry) {
    const injector = game.job.injector;
    if (!injector) return;
    const target = impactPoint(geometry);
    const distance = Math.hypot(injector.x - target.x, injector.y - target.y);
    const near = distance <= clamp(geometry.glassW * .07, 22, 34);
    ctx.save();
    ctx.strokeStyle = near ? '#77f2b1' : 'rgba(124,225,255,.72)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(target.x, target.y, clamp(geometry.glassW * .07, 22, 34), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.translate(injector.x, injector.y);
    ctx.fillStyle = '#111b28';
    ctx.strokeStyle = near ? '#77f2b1' : '#8bdfff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, clamp(geometry.glassW * .055, 18, 28), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f22842';
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d8e7f5';
    ctx.beginPath();
    ctx.roundRect(-7, -52, 14, 35, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(116,223,255,.55)';
    ctx.fillRect(-4, -45, 8, 20);
    ctx.restore();
    const initial = Math.hypot(injector.startX - target.x, injector.startY - target.y) || 1;
    game.stageProgress = clamp(1 - distance / initial, 0, 1);
  }

  function drawPressureGauge(geometry) {
    const width = clamp(geometry.glassW * .72, 180, 330);
    const height = 54;
    const x = geometry.glassCx - width / 2;
    const y = geometry.glassCy + geometry.glassH * .72;
    const value = pressureValue();
    const target = game.job.pressure.target;
    const tolerance = game.job.pressure.tolerance;
    ctx.save();
    ctx.fillStyle = 'rgba(3,10,20,.9)';
    ctx.strokeStyle = 'rgba(142,195,229,.3)';
    ctx.beginPath();
    ctx.roundRect(x - 14, y - 24, width + 28, height + 35, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,80,101,.4)';
    ctx.beginPath();
    ctx.roundRect(x, y, width, 12, 6);
    ctx.fill();
    ctx.fillStyle = '#77f2b1';
    ctx.beginPath();
    ctx.roundRect(x + width * (target - tolerance), y, width * tolerance * 2, 12, 6);
    ctx.fill();
    const needleX = x + width * value;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.moveTo(needleX, y - 12);
    ctx.lineTo(needleX, y + 24);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#9ab0cc';
    ctx.font = '800 10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('PRESSÃO', x, y - 8);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#dfffee';
    ctx.fillText(game.job.pressure.doses + '/3 DOSES', x + width, y - 8);
    ctx.restore();
  }

  function drawTimedTarget(geometry, type) {
    const point = currentTimedPoint(geometry);
    if (!point) return;
    const timed = game.job.timed;
    const duration = type === 'seal' ? 2150 : 1950;
    const ratio = clamp((timed.deadline - game.activeMs) / duration, 0, 1);
    const radius = type === 'seal' ? 16 : 12;
    ctx.save();
    ctx.strokeStyle = ratio < .32 ? '#ff536b' : type === 'seal' ? '#7cddff' : '#b9f5ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius + 18 * ratio, -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * ratio);
    ctx.stroke();
    const bubble = ctx.createRadialGradient(point.x - 4, point.y - 5, 1, point.x, point.y, radius);
    bubble.addColorStop(0, '#fff');
    bubble.addColorStop(.25, type === 'seal' ? '#77dcff' : '#d7fbff');
    bubble.addColorStop(1, type === 'seal' ? 'rgba(28,134,194,.24)' : 'rgba(153,237,255,.08)');
    ctx.fillStyle = bubble;
    ctx.beginPath();
    if (type === 'seal') {
      ctx.moveTo(point.x, point.y - radius);
      ctx.bezierCurveTo(point.x + radius, point.y, point.x + radius * .7,
        point.y + radius, point.x, point.y + radius * 1.15);
      ctx.bezierCurveTo(point.x - radius * .7, point.y + radius,
        point.x - radius, point.y, point.x, point.y - radius);
    } else {
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '900 10px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(timed.index + 1), point.x, point.y + (type === 'seal' ? 2 : 0));
    ctx.restore();
  }

  function drawFittingGlass(geometry) {
    const fit = game.job.fit;
    if (!fit) return;
    const angleOk = Math.abs(fit.angle) <= 4.5 * Math.PI / 180;
    const distance = Math.hypot(fit.x - geometry.glassCx, fit.y - geometry.glassCy);
    const positionOk = distance <= clamp(geometry.glassW * .09, 22, 38);
    ctx.save();
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = angleOk && positionOk ? '#77f2b1' : 'rgba(128,218,248,.62)';
    ctx.lineWidth = 2;
    pathPolygon(ctx, geometry.glassPoly);
    ctx.stroke();
    ctx.setLineDash([]);
    const polygon = transformedGlassPolygon(geometry, fit.x, fit.y, fit.angle);
    pathPolygon(ctx, polygon);
    const glass = ctx.createLinearGradient(fit.x - geometry.glassW / 2, fit.y,
      fit.x + geometry.glassW / 2, fit.y);
    glass.addColorStop(0, 'rgba(102,213,246,.34)');
    glass.addColorStop(.5, 'rgba(199,246,255,.2)');
    glass.addColorStop(1, 'rgba(69,160,201,.36)');
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.strokeStyle = angleOk && positionOk ? '#99ffd0' : '#a2eaff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#6fdcff';
    ctx.shadowBlur = fit.dragging ? 18 : 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (const side of [-1, 1]) {
      const cosine = Math.cos(fit.angle);
      const sine = Math.sin(fit.angle);
      const offset = side * geometry.glassW * .18;
      const cupX = fit.x + offset * cosine;
      const cupY = fit.y + offset * sine;
      ctx.fillStyle = '#ed2943';
      ctx.beginPath();
      ctx.arc(cupX, cupY, clamp(geometry.glassW * .035, 8, 14), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffd0d6';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.strokeStyle = angleOk ? '#77f2b1' : '#ffc857';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(geometry.glassCx, geometry.glassCy, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawAdas(geometry) {
    const target = adasTarget(geometry);
    if (!target) return;
    const scannerX = adasScannerX(geometry);
    const synced = Math.abs(scannerX - target.x) <= geometry.glassW * .075;
    ctx.save();
    pathPolygon(ctx, geometry.glassPoly);
    ctx.clip();
    const scan = ctx.createLinearGradient(scannerX - 24, 0, scannerX + 24, 0);
    scan.addColorStop(0, 'rgba(72,216,255,0)');
    scan.addColorStop(.5, synced ? 'rgba(119,242,177,.55)' : 'rgba(72,216,255,.38)');
    scan.addColorStop(1, 'rgba(72,216,255,0)');
    ctx.fillStyle = scan;
    ctx.fillRect(scannerX - 24, geometry.glassCy - geometry.glassH,
      48, geometry.glassH * 2);
    ctx.strokeStyle = synced ? '#77f2b1' : '#57d5ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(scannerX, geometry.glassCy - geometry.glassH);
    ctx.lineTo(scannerX, geometry.glassCy + geometry.glassH);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = synced ? '#77f2b1' : '#7ee2ff';
    ctx.fillStyle = synced ? 'rgba(119,242,177,.16)' : 'rgba(126,226,255,.09)';
    ctx.lineWidth = 2;
    ctx.shadowColor = synced ? '#77f2b1' : '#7ee2ff';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(target.x, target.y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(target.x - 33, target.y);
    ctx.lineTo(target.x - 11, target.y);
    ctx.moveTo(target.x + 11, target.y);
    ctx.lineTo(target.x + 33, target.y);
    ctx.moveTo(target.x, target.y - 33);
    ctx.lineTo(target.x, target.y - 11);
    ctx.moveTo(target.x, target.y + 11);
    ctx.lineTo(target.x, target.y + 33);
    ctx.stroke();
    const cameraW = clamp(geometry.glassW * .12, 25, 46);
    ctx.fillStyle = '#05090f';
    ctx.beginPath();
    ctx.roundRect(geometry.glassCx - cameraW / 2,
      geometry.glassCy - geometry.glassH * .56, cameraW, cameraW * .62, 4);
    ctx.fill();
    ctx.fillStyle = synced ? '#77f2b1' : '#4bc5ef';
    ctx.beginPath();
    ctx.arc(geometry.glassCx, geometry.glassCy - geometry.glassH * .43, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawInstalledDetails(geometry) {
    ctx.save();
    ctx.fillStyle = 'rgba(199,240,253,.66)';
    ctx.font = '800 ' + clamp(geometry.glassW * .022, 6, 10) + 'px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(game.job.route === 'repair' ? 'REPARAÇÃO CERTIFICADA' :
      (game.job.selectedGlass ? game.job.selectedGlass.code : 'E43 DOT AS1'),
    geometry.glassPoly[2].x - 10, geometry.glassPoly[2].y - 10);
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    for (const particle of particles) {
      ctx.globalAlpha = clamp(particle.life, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.strokeStyle = particle.color;
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      if (particle.shape === 'spark') {
        ctx.lineWidth = Math.max(1, particle.size * .32);
        ctx.beginPath();
        ctx.moveTo(-particle.size, 0);
        ctx.lineTo(particle.size, 0);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(-particle.size * .55, -particle.size * .28);
        ctx.lineTo(particle.size * .6, 0);
        ctx.lineTo(-particle.size * .32, particle.size * .48);
        ctx.closePath();
        ctx.fill();
      }
      ctx.rotate(-particle.rotation);
      ctx.translate(-particle.x, -particle.y);
    }
    ctx.restore();
  }

  function drawCanvasInstruction() {
    const copy = STAGE_COPY[game.stage];
    if (!copy || game.status !== 'playing' ||
        game.stage === 'DIAGNOSIS' || game.stage === 'GLASS_PICK') return;
    ctx.save();
    ctx.font = '800 ' + (viewW < 430 ? 9 : 11) + 'px system-ui';
    const width = Math.min(viewW - 24, Math.max(270, ctx.measureText(copy.canvas).width + 72));
    const height = 48;
    const x = (viewW - width) / 2;
    const y = viewH - height - 15;
    ctx.fillStyle = 'rgba(4,12,24,.8)';
    ctx.strokeStyle = 'rgba(133,190,229,.22)';
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 13);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d9e7f7';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(copy.canvas, viewW / 2, y + 18);
    ctx.fillStyle = 'rgba(103,137,175,.25)';
    ctx.beginPath();
    ctx.roundRect(x + 20, y + 33, width - 40, 4, 2);
    ctx.fill();
    ctx.fillStyle = game.stage === 'PRESSURE' ? '#77f2b1' : '#78dfff';
    ctx.beginPath();
    ctx.roundRect(x + 20, y + 33, (width - 40) * game.stageProgress, 4, 2);
    ctx.fill();
    ctx.restore();
  }

  function drawIdleCar(time) {
    if (!game.job) {
      const damage = DAMAGE_CASES[2];
      game.job = {
        colors: CAR_COLORS[0],
        damage,
        cracks: createCracks(damage, 9321),
        oldRemoved: false,
        route: null,
        crackGrowth: 0
      };
      game.stage = 'ARRIVAL';
    }
    const previous = game.stage;
    game.stage = 'ARRIVAL';
    drawCar(getGeometry(), time);
    game.stage = previous;
  }

  function drawFrame(time) {
    resizeCanvas();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);
    const shakeX = shake > .1 && !reducedMotion ? (Math.random() - .5) * shake : 0;
    const shakeY = shake > .1 && !reducedMotion ? (Math.random() - .5) * shake * .55 : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawWorkshop(time);
    if (game.status === 'idle') drawIdleCar(time);
    else if (game.job) drawCar(getGeometry(), time);
    drawParticles();
    drawCanvasInstruction();
    ctx.restore();
    if (flashAlpha > .01) {
      ctx.fillStyle = 'rgba(188,241,255,' + flashAlpha + ')';
      ctx.fillRect(0, 0, viewW, viewH);
    }
  }

  function updateHud(force) {
    const now = performance.now();
    if (!force && now - hudStamp < 80) return;
    hudStamp = now;
    game.shownScore += (game.score - game.shownScore) * .22;
    if (Math.abs(game.score - game.shownScore) < 1) game.shownScore = game.score;
    els.score.textContent = formatNumber(game.shownScore);
    els.jobsDone.textContent = String(game.jobs.length);
    const average = Core.averageQuality(game.jobs);
    els.averageQuality.textContent = game.jobs.length ? average + '%' : '—';
    els.stageProgress.style.width = Math.round(game.stageProgress * 100) + '%';
    const liveQuality = game.job ? Math.round(game.job.accuracy || 100) : 100;
    els.liveQuality.textContent = liveQuality + '%';
    els.liveQuality.classList.toggle('is-mid', liveQuality < 86 && liveQuality >= 70);
    els.liveQuality.classList.toggle('is-low', liveQuality < 70);
    const timeText = formatTime(game.remainingMs);
    els.timer.textContent = timeText;
    els.mobileTimer.textContent = timeText;
    const ratio = clamp(game.remainingMs / Core.TOTAL_MS, 0, 1);
    els.timerRing.style.setProperty('--time-progress', ratio + 'turn');
    const danger = game.status === 'playing' && game.remainingMs <= 10000;
    els.timerCard.classList.toggle('is-danger', danger);
    document.body.classList.toggle('is-last-seconds', danger);
    els.timeMessage.textContent = danger ? 'Últimos segundos. Decide e executa!' : 'Cada decisão conta.';
    els.combo.textContent = '×' + Math.max(1, game.combo);
    els.comboPill.classList.toggle('is-visible', game.combo >= 2);
  }

  function animationFrame(time) {
    try {
      const dt = Math.min(50, Math.max(0, time - lastFrame));
      lastFrame = time;
      updateGame(dt);
      updateParticles(dt);
      flashAlpha *= Math.pow(.9, dt / 16.67);
      shake *= Math.pow(.82, dt / 16.67);
      updateHud(false);
      const frameInterval = game.status === 'playing' && !game.paused ? 16 :
        (document.hidden ? 500 : 50);
      if (time - lastPaint >= frameInterval) {
        drawFrame(time);
        lastPaint = time;
      }
    } catch (error) {
      lastFrame = time;
      const message = error && error.message ? error.message : String(error);
      if (lastFrameError !== message) console.error('Falha num fotograma do jogo:', error);
      lastFrameError = message;
    }
    requestAnimationFrame(animationFrame);
  }

  async function createServerSession() {
    const controller = new AbortController();
    const timeout = setTimeout(function () { controller.abort(); }, 4500);
    try {
      const response = await fetch(API, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ action: 'start', version: Core.VERSION }),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.sessionToken) {
        throw new Error(data.error || 'Não foi possível abrir a sessão');
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  function applyTournament(multiplier) {
    game.multiplier = multiplier === 2 ? 2 : 1;
    const active = game.multiplier === 2;
    els.tournamentCard.classList.toggle('is-inactive', !active);
    els.multiplierBadge.textContent = active ? '×2' : '×1';
    els.tournamentText.textContent = active
      ? 'Torneio ativo: cada ponto desta partida vale a dobrar.'
      : 'Entre as 12:00 e as 14:00, cada ponto vale a dobrar.';
  }

  async function startGame() {
    if (els.startBtn.disabled) return;
    sound.unlock();
    els.startBtn.disabled = true;
    els.startBtnText.textContent = 'A abrir a oficina…';
    if (demoMode) {
      game.sessionToken = null;
      game.ranked = false;
      applyTournament(1);
    } else {
      try {
        const session = await createServerSession();
        game.sessionToken = session.sessionToken;
        game.ranked = true;
        applyTournament(session.multiplier);
      } catch (_) {
        game.sessionToken = null;
        game.ranked = false;
        applyTournament(1);
        toast('Sem ligação ao ranking. Esta partida fica em modo treino.', 'warning');
      }
    }
    resetRun();
    els.startOverlay.classList.remove('is-visible');
    els.endOverlay.classList.remove('is-visible');
    document.body.classList.add('is-playing');
    await runCountdown();
    game.status = 'playing';
    game.activeMs = 0;
    game.remainingMs = Core.TOTAL_MS;
    createJob();
    sound.play('go');
    updateHud(true);
    els.startBtn.disabled = false;
    els.startBtnText.textContent = 'Entrar na oficina';
  }

  function resetRun() {
    game.status = 'countdown';
    game.paused = false;
    game.activeMs = 0;
    game.remainingMs = Core.TOTAL_MS;
    game.stage = 'IDLE';
    game.stageStartedAt = 0;
    game.stageProgress = 0;
    game.stageLocked = false;
    game.jobs = [];
    game.job = null;
    game.score = 0;
    game.shownScore = 0;
    game.combo = 0;
    game.maxCombo = 0;
    game.transition = null;
    game.lastCountdownSecond = null;
    particles.length = 0;
    hideDecisionPanel();
    els.fitControls.classList.remove('is-visible');
    els.pauseOverlay.classList.remove('is-visible');
    els.endOverlay.classList.remove('is-visible');
    configureStageTrack();
    updateHud(true);
  }

  async function runCountdown() {
    els.countdown.classList.add('is-visible');
    for (const value of ['3', '2', '1', 'JÁ!']) {
      els.countdown.textContent = value;
      els.countdown.classList.remove('is-popping');
      void els.countdown.offsetWidth;
      els.countdown.classList.add('is-popping');
      sound.play(value === 'JÁ!' ? 'go' : 'count');
      await wait(value === 'JÁ!' ? 480 : 580);
    }
    els.countdown.classList.remove('is-visible', 'is-popping');
  }

  function togglePause(force) {
    if (game.status !== 'playing') return;
    const next = typeof force === 'boolean' ? force : !game.paused;
    if (next === game.paused) return;
    game.paused = next;
    pointer.down = false;
    els.pauseOverlay.classList.toggle('is-visible', next);
    els.pauseBtn.setAttribute('aria-label', next ? 'Retomar o jogo' : 'Colocar em pausa');
  }

  async function endGame() {
    if (game.status !== 'playing') return;
    game.status = 'ended';
    game.paused = false;
    pointer.down = false;
    document.body.classList.remove('is-playing', 'is-last-seconds');
    hideDecisionPanel();
    els.fitControls.classList.remove('is-visible');
    els.pauseOverlay.classList.remove('is-visible');
    sound.play('finish');
    const quality = Core.averageQuality(game.jobs);
    els.finalScore.textContent = formatNumber(game.score);
    els.finalJobs.textContent = String(game.jobs.length);
    els.finalQuality.textContent = quality + '%';
    els.finalCombo.textContent = '×' + game.maxCombo;
    els.endKicker.textContent = game.jobs.length ? 'Turno terminado' : 'O relógio venceu';
    els.endTitle.textContent = game.jobs.length ? Core.qualityLabel(quality) : 'Quase! Tenta novamente.';
    els.saveStatus.textContent = game.ranked ? 'A validar resultado…' :
      'Partida de treino · resultado não guardado';
    els.saveStatus.className = game.ranked ? '' : 'is-error';
    els.endOverlay.classList.add('is-visible');
    if (game.ranked && game.sessionToken) await saveResult();
  }

  async function saveResult() {
    try {
      const response = await fetch(API, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          action: 'finish',
          sessionToken: game.sessionToken,
          durationMs: Math.round(game.activeMs),
          jobs: game.jobs,
          version: Core.VERSION
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Resultado recusado');
      if (typeof data.score === 'number' && data.score !== game.score) {
        game.score = data.score;
        game.shownScore = data.score;
        els.finalScore.textContent = formatNumber(data.score);
        els.score.textContent = formatNumber(data.score);
      }
      if (!data.saved) {
        els.saveStatus.textContent = 'Sem serviço completo · resultado não registado';
        els.saveStatus.className = 'is-error';
      } else if (data.isNewBest) {
        els.saveStatus.textContent = 'Novo recorde pessoal!';
        els.saveStatus.className = 'is-saved';
        els.personalBest.textContent = formatNumber(data.personalBest);
        showStageFlash('Novo recorde!', 'Resultado confirmado');
      } else {
        els.saveStatus.textContent = 'Resultado confirmado no ranking';
        els.saveStatus.className = 'is-saved';
        els.personalBest.textContent = formatNumber(data.personalBest);
      }
    } catch (_) {
      els.saveStatus.textContent = 'Não foi possível guardar este resultado';
      els.saveStatus.className = 'is-error';
    }
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (viewW / rect.width),
      y: (event.clientY - rect.top) * (viewH / rect.height)
    };
  }

  function handlePointerDown(event) {
    if (game.status !== 'playing' || game.paused || game.stageLocked) return;
    event.preventDefault();
    sound.unlock();
    const position = pointerPosition(event);
    pointer.x = position.x;
    pointer.y = position.y;
    pointer.lastX = position.x;
    pointer.lastY = position.y;
    pointer.lastAt = performance.now();
    pointer.down = true;
    pointer.id = event.pointerId;
    canvas.setPointerCapture(event.pointerId);

    if (game.stage === 'PRESSURE') {
      handlePressureTap();
      pointer.down = false;
      return;
    }
    if (game.stage === 'CURE' || game.stage === 'SEAL') {
      handleTimedTap(position);
      pointer.down = false;
      return;
    }
    if (game.stage === 'ADAS') {
      handleAdasTap(position);
      pointer.down = false;
      return;
    }
    if (game.stage === 'INJECT' && game.job.injector) {
      const injector = game.job.injector;
      if (Math.hypot(position.x - injector.x, position.y - injector.y) <= 42) {
        injector.dragging = true;
        injector.dragX = position.x - injector.x;
        injector.dragY = position.y - injector.y;
      } else {
        pointer.down = false;
      }
    }
    if (game.stage === 'FIT' && game.job.fit) {
      const fit = game.job.fit;
      const polygon = transformedGlassPolygon(getGeometry(), fit.x, fit.y, fit.angle);
      if (pointInPolygon(position, polygon)) {
        fit.dragging = true;
        fit.dragX = position.x - fit.x;
        fit.dragY = position.y - fit.y;
        fit.speed = 0;
      } else {
        pointer.down = false;
      }
    }
  }

  function handlePointerMove(event) {
    const position = pointerPosition(event);
    pointer.x = position.x;
    pointer.y = position.y;
    if (!pointer.down || !game.job) return;
    const now = performance.now();
    const dt = Math.max(8, now - pointer.lastAt);
    const speed = Math.hypot(position.x - pointer.lastX, position.y - pointer.lastY) / dt;
    pointer.lastX = position.x;
    pointer.lastY = position.y;
    pointer.lastAt = now;

    if (game.stage === 'INJECT' && game.job.injector && game.job.injector.dragging) {
      event.preventDefault();
      const injector = game.job.injector;
      injector.x = clamp(position.x - injector.dragX, 20, viewW - 20);
      injector.y = clamp(position.y - injector.dragY, 45, viewH - 70);
    }
    if (game.stage === 'FIT' && game.job.fit && game.job.fit.dragging) {
      event.preventDefault();
      const fit = game.job.fit;
      fit.x = clamp(position.x - fit.dragX, -viewW * .1, viewW * 1.1);
      fit.y = clamp(position.y - fit.dragY, 45, viewH - 70);
      fit.speed = fit.speed * .72 + speed * .28;
    }
  }

  function handlePointerUp(event) {
    if (pointer.id != null && event.pointerId !== pointer.id) return;
    const position = pointerPosition(event);
    pointer.x = position.x;
    pointer.y = position.y;
    if (game.status === 'playing' && !game.paused && !game.stageLocked && game.job) {
      if (game.stage === 'INJECT' && game.job.injector && game.job.injector.dragging) {
        const geometry = getGeometry();
        const injector = game.job.injector;
        const target = impactPoint(geometry);
        injector.dragging = false;
        if (Math.hypot(injector.x - target.x, injector.y - target.y) <=
            clamp(geometry.glassW * .07, 22, 34)) {
          injector.x = target.x;
          injector.y = target.y;
          completeInjector();
        } else {
          registerMistake(5);
          injector.x = injector.startX;
          injector.y = injector.startY;
          showStageFlash('Injetor desalinhado', 'Centra no ponto de impacto');
        }
      }
      if (game.stage === 'FIT' && game.job.fit && game.job.fit.dragging) {
        const geometry = getGeometry();
        const fit = game.job.fit;
        fit.dragging = false;
        const distance = Math.hypot(fit.x - geometry.glassCx, fit.y - geometry.glassCy);
        const positionThreshold = clamp(geometry.glassW * .09, 22, 38);
        const angleThreshold = 4.5 * Math.PI / 180;
        if (distance <= positionThreshold && Math.abs(fit.angle) <= angleThreshold &&
            fit.speed <= 2.6) {
          const precisionPenalty = Math.round(
            distance / positionThreshold * 3 + Math.abs(fit.angle) / angleThreshold * 2
          );
          game.job.accuracy = clamp(game.job.accuracy - precisionPenalty, 0, 100);
          completeFit();
        } else {
          const hardDrop = fit.speed > 2.6;
          registerMistake(hardDrop ? 10 : 6);
          if (hardDrop) {
            spawnGlassShards(38, '#c5f5ff');
            flashAlpha = .35;
            shake = 10;
          }
          showStageFlash(
            hardDrop ? 'Impacto demasiado forte' :
              (Math.abs(fit.angle) > angleThreshold ? 'Ângulo incorreto' : 'Fora da moldura'),
            hardDrop ? 'Pousa o vidro mais devagar' : 'Corrige e tenta novamente'
          );
          fit.x = fit.startX;
          fit.y = fit.startY;
          fit.speed = 0;
        }
      }
    }
    pointer.down = false;
    pointer.id = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
  }

  async function loadRanking(period, silent) {
    if (!silent) {
      els.rankList.innerHTML = '<div class="rank-empty">A carregar classificação…</div>';
    }
    try {
      const response = await fetch(API + '?period=' + encodeURIComponent(period), {
        headers: authHeaders(false)
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Ranking indisponível');
      rankData = data;
      if (data.me) {
        els.personalBest.textContent = data.me.allTimeBest ?
          formatNumber(data.me.allTimeBest) : '—';
        els.myBest.querySelector('strong').textContent = data.me.periodBest ?
          formatNumber(data.me.periodBest) : '—';
      }
      if (!silent) renderRanking();
    } catch (_) {
      if (!silent) {
        els.rankList.innerHTML =
          '<div class="rank-empty">Não foi possível carregar o ranking.<br>Tenta novamente dentro de instantes.</div>';
      }
    }
  }

  function renderRanking() {
    els.rankList.replaceChildren();
    if (!rankData) return;
    const rows = rankView === 'players' ? rankData.players : rankData.stores;
    if (!rows || !rows.length) {
      const empty = document.createElement('div');
      empty.className = 'rank-empty';
      empty.textContent = 'Ainda não existem resultados. Sê o primeiro a abrir a oficina!';
      els.rankList.appendChild(empty);
      return;
    }
    rows.forEach(function (row, index) {
      const item = document.createElement('div');
      item.className = 'rank-row';
      if (rankView === 'players' && currentUser && row.username === currentUser.username) {
        item.classList.add('is-me');
      }
      const position = document.createElement('div');
      position.className = 'rank-row__pos';
      position.textContent = String(index + 1).padStart(2, '0');
      const person = document.createElement('div');
      person.className = 'rank-row__person';
      const name = document.createElement('strong');
      const sub = document.createElement('span');
      if (rankView === 'players') {
        name.textContent = row.username || 'Utilizador';
        sub.textContent = (row.portal_name || 'Sem unidade') + ' · ' + row.games + ' turno(s)';
      } else {
        name.textContent = row.portal_name || 'Unidade';
        sub.textContent = row.players + ' jogador(es) · melhor ' + formatNumber(row.top);
      }
      person.append(name, sub);
      const score = document.createElement('div');
      score.className = 'rank-row__score';
      score.textContent = formatNumber(rankView === 'players' ? row.best : row.total);
      item.append(position, person, score);
      els.rankList.appendChild(item);
    });
  }

  function openRanking() {
    pausedForRanking = game.status === 'playing' && !game.paused;
    if (pausedForRanking) togglePause(true);
    els.rankModal.classList.add('is-visible');
    loadRanking(rankPeriod, false);
  }

  function closeRanking() {
    els.rankModal.classList.remove('is-visible');
    if (pausedForRanking && game.status === 'playing') togglePause(false);
    pausedForRanking = false;
  }

  function setActiveTab(container, target) {
    container.querySelectorAll('button').forEach(function (button) {
      button.classList.toggle('is-active', button === target);
    });
  }

  els.startBtn.addEventListener('click', startGame);
  els.againBtn.addEventListener('click', startGame);
  els.pauseBtn.addEventListener('click', function () { togglePause(); });
  els.resumeBtn.addEventListener('click', function () { togglePause(false); });
  els.rankBtn.addEventListener('click', openRanking);
  els.endRankBtn.addEventListener('click', openRanking);
  els.closeRankBtn.addEventListener('click', closeRanking);
  els.rankModal.addEventListener('click', function (event) {
    if (event.target === els.rankModal) closeRanking();
  });
  els.soundBtn.addEventListener('click', function () {
    soundEnabled = !soundEnabled;
    localStorage.setItem('eg_pitstop_sound', soundEnabled ? '1' : '0');
    syncSoundButton();
    if (soundEnabled) {
      sound.unlock();
      sound.play('stage');
    }
  });
  els.decisionPanel.addEventListener('click', function (event) {
    const routeButton = event.target.closest('[data-route]');
    if (routeButton) chooseRoute(routeButton.dataset.route, routeButton);
    const glassButton = event.target.closest('[data-glass-code]');
    if (glassButton) chooseGlass(glassButton.dataset.glassCode, glassButton);
  });
  els.rotateLeftBtn.addEventListener('click', function () { rotateFit(-1); });
  els.rotateRightBtn.addEventListener('click', function () { rotateFit(1); });
  els.periodTabs.addEventListener('click', function (event) {
    const button = event.target.closest('[data-period]');
    if (!button) return;
    rankPeriod = button.dataset.period;
    setActiveTab(els.periodTabs, button);
    loadRanking(rankPeriod, false);
  });
  els.viewTabs.addEventListener('click', function (event) {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    rankView = button.dataset.view;
    setActiveTab(els.viewTabs, button);
    renderRanking();
  });
  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);
  canvas.addEventListener('contextmenu', function (event) { event.preventDefault(); });
  canvas.addEventListener('wheel', function (event) {
    if (game.stage !== 'FIT' || game.stageLocked) return;
    event.preventDefault();
    rotateFit(event.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && game.status === 'playing' && !game.paused) togglePause(true);
  });
  document.addEventListener('keydown', function (event) {
    const key = event.key.toLowerCase();
    if (key === 'p' && game.status === 'playing') {
      event.preventDefault();
      togglePause();
    }
    if ((key === 'a' || event.key === 'ArrowLeft') && game.stage === 'FIT') {
      event.preventDefault();
      rotateFit(-1);
    }
    if ((key === 'd' || event.key === 'ArrowRight') && game.stage === 'FIT') {
      event.preventDefault();
      rotateFit(1);
    }
    if (event.key === 'Escape') {
      if (els.rankModal.classList.contains('is-visible')) closeRanking();
      else if (game.status === 'playing') togglePause();
    }
  });
  window.addEventListener('resize', resizeCanvas);

  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.__oficinaTest = {
      advance: function (milliseconds) {
        updateGame(clamp(Number(milliseconds) || 0, 0, 50));
      },
      state: function () {
        return {
          status: game.status,
          paused: game.paused,
          activeMs: game.activeMs,
          lastFrameError,
          stage: game.stage,
          route: game.job && game.job.route,
          damage: game.job && game.job.damage,
          requiredGlass: game.job && game.job.requiredGlass,
          candidates: game.job && game.job.candidates,
          geometry: getGeometry(),
          pressure: game.stage === 'PRESSURE' ? pressureValue() : null,
          timedPoint: game.job && game.job.timed ? currentTimedPoint(getGeometry()) : null,
          timedIndex: game.job && game.job.timed ? game.job.timed.index : null,
          adasTarget: game.job && game.job.adas ? adasTarget(getGeometry()) : null,
          adasIndex: game.job && game.job.adas ? game.job.adas.index : null,
          scannerX: game.stage === 'ADAS' ? adasScannerX(getGeometry()) : null,
          fit: game.job && game.job.fit,
          injector: game.job && game.job.injector,
          pressureDoses: game.job && game.job.pressure ? game.job.pressure.doses : null
        };
      }
    };
  }

  if (demoMode) {
    const liveLabel = els.liveBadge.querySelector('span:last-child');
    if (liveLabel) liveLabel.textContent = 'Teste V3 · 90s';
  }

  syncSoundButton();
  applyTournament(1);
  resizeCanvas();
  updateHud(true);
  if (!demoMode) loadRanking('all', true);
  requestAnimationFrame(animationFrame);
})();
