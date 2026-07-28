(function () {
  'use strict';

  const Core = window.PitStopCore;
  if (!Core) throw new Error('Motor do jogo indisponível');

  const token = localStorage.getItem('eg_auth_token');
  if (!token) {
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
  const STAGE_ORDER = ['CUT', 'GLUE', 'FIT', 'CALIBRATE'];
  const STAGE_COPY = {
    CUT: {
      icon: '01',
      kicker: 'Remoção segura',
      title: 'Segue o fio de corte',
      text: 'Mantém pressionado e acompanha o ponto luminoso à volta do para-brisas.',
      canvas: 'SEGUE O PONTO PARA REMOVER O VIDRO'
    },
    GLUE: {
      icon: '02',
      kicker: 'Preparação da moldura',
      title: 'Aplica o cordão de cola',
      text: 'Mantém a pressão e conduz o bico vermelho por todo o perímetro.',
      canvas: 'APLICA UM CORDÃO CONTÍNUO'
    },
    FIT: {
      icon: '03',
      kicker: 'Precisão milimétrica',
      title: 'Encaixa o novo vidro',
      text: 'Agarra o para-brisas pelas ventosas, arrasta-o e larga-o dentro da mira.',
      canvas: 'ARRASTA E LARGA NO CENTRO DA MOLDURA'
    },
    CALIBRATE: {
      icon: '04',
      kicker: 'Segurança ADAS',
      title: 'Calibra a câmara',
      text: 'Mantém pressionado o retículo sobre o alvo até concluir a calibração.',
      canvas: 'MANTÉM O RETÍCULO SOBRE O ALVO'
    }
  };

  const CAR_COLORS = [
    ['#315b9b', '#172e58'],
    ['#a6acb5', '#535c6b'],
    ['#b82a3e', '#641629'],
    ['#1d887d', '#0b4949'],
    ['#d3d8df', '#6d7787'],
    ['#8153b4', '#3a285f']
  ];

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
    'tournamentText', 'multiplierBadge'
  ].forEach(function (id) {
    els[id] = document.getElementById(id);
  });

  const canvas = els.gameCanvas;
  const ctx = canvas.getContext('2d', { alpha: false });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointer = { x: 0, y: 0, down: false, id: null };
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

  const game = {
    status: 'idle',
    paused: false,
    activeMs: 0,
    remainingMs: Core.TOTAL_MS,
    stage: 'IDLE',
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
    lastTraceTick: 0,
    lastErrorAt: -9999,
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
      envelope.gain.exponentialRampToValueAtTime(volume || .25, start + .012);
      envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
      oscillator.connect(envelope);
      envelope.connect(this.gain);
      oscillator.start(start);
      oscillator.stop(start + duration + .02);
    }

    play(name) {
      if (!soundEnabled) return;
      if (name === 'count') this.tone(330, .11, 'square', .19);
      if (name === 'go') {
        this.tone(440, .14, 'triangle', .22);
        this.tone(660, .2, 'triangle', .2, .09);
      }
      if (name === 'trace') this.tone(540, .035, 'sine', .09, 0, 700);
      if (name === 'error') this.tone(125, .12, 'sawtooth', .12, 0, 90);
      if (name === 'stage') {
        this.tone(560, .11, 'triangle', .15);
        this.tone(780, .16, 'triangle', .13, .075);
      }
      if (name === 'fit') {
        this.tone(180, .1, 'sine', .22, 0, 95);
        this.tone(620, .15, 'triangle', .13, .08);
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
    const minutes = Math.floor(seconds / 60);
    return String(minutes).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }

  function wait(milliseconds) {
    return new Promise(function (resolve) {
      setTimeout(resolve, milliseconds);
    });
  }

  function authHeaders(withJson) {
    const headers = { Authorization: 'Bearer ' + token };
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
    }, 3200);
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
    const glassPoly = [
      { x: glassCx - topHalf, y: glassCy - glassH * .5 },
      { x: glassCx + topHalf, y: glassCy - glassH * .5 },
      { x: glassCx + bottomHalf, y: glassCy + glassH * .5 },
      { x: glassCx - bottomHalf, y: glassCy + glassH * .5 }
    ];
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
      glassPoly
    };
  }

  function insetPolygon(poly, amount) {
    const center = poly.reduce(function (acc, point) {
      acc.x += point.x / poly.length;
      acc.y += point.y / poly.length;
      return acc;
    }, { x: 0, y: 0 });
    return poly.map(function (point) {
      const distance = Math.hypot(point.x - center.x, point.y - center.y) || 1;
      return {
        x: point.x + (center.x - point.x) * amount / distance,
        y: point.y + (center.y - point.y) * amount / distance
      };
    });
  }

  function pointOnPolygon(poly, progress) {
    const lengths = [];
    let total = 0;
    for (let index = 0; index < poly.length; index++) {
      const a = poly[index];
      const b = poly[(index + 1) % poly.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      lengths.push(length);
      total += length;
    }
    let target = ((((progress % 1) + 1) % 1) * total);
    for (let index = 0; index < lengths.length; index++) {
      if (target <= lengths[index]) {
        const a = poly[index];
        const b = poly[(index + 1) % poly.length];
        const amount = lengths[index] ? target / lengths[index] : 0;
        return { x: lerp(a.x, b.x, amount), y: lerp(a.y, b.y, amount) };
      }
      target -= lengths[index];
    }
    return { x: poly[0].x, y: poly[0].y };
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersects = ((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || .00001) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function transformedGlassPolygon(geometry, cx, cy, scale, angle) {
    const cosine = Math.cos(angle || 0);
    const sine = Math.sin(angle || 0);
    return geometry.glassPoly.map(function (point) {
      const localX = (point.x - geometry.glassCx) * scale;
      const localY = (point.y - geometry.glassCy) * scale;
      return {
        x: cx + localX * cosine - localY * sine,
        y: cy + localX * sine + localY * cosine
      };
    });
  }

  function seededRandom(seed) {
    let value = seed % 2147483647;
    if (value <= 0) value += 2147483646;
    return function () {
      value = value * 16807 % 2147483647;
      return (value - 1) / 2147483646;
    };
  }

  function createCracks(seed) {
    const random = seededRandom(seed);
    const cracks = [];
    const impactCount = 2 + Math.floor(random() * 2);
    for (let impact = 0; impact < impactCount; impact++) {
      const origin = {
        x: .27 + random() * .46,
        y: .24 + random() * .48
      };
      const rays = [];
      const rayCount = 7 + Math.floor(random() * 5);
      for (let ray = 0; ray < rayCount; ray++) {
        rays.push({
          angle: random() * Math.PI * 2,
          length: .12 + random() * .22,
          bend: (random() - .5) * .14
        });
      }
      cracks.push({ origin, rays });
    }
    return cracks;
  }

  function createJob() {
    const index = game.jobs.length;
    const colors = CAR_COLORS[index % CAR_COLORS.length];
    game.job = {
      number: index + 1,
      startedAt: game.activeMs,
      accuracy: 100,
      mistakes: 0,
      clean: true,
      colors,
      cracks: createCracks(Date.now() % 100000 + index * 131),
      arrivalStart: game.activeMs,
      deliveryStart: 0,
      fit: null,
      calibrateHeld: 0
    };
    game.stage = 'ARRIVAL';
    game.stageProgress = 0;
    game.stageLocked = true;
    game.transition = {
      at: game.activeMs + (reducedMotion ? 150 : 850),
      action: function () { setStage('CUT'); }
    };
    els.jobNumber.textContent = '#' + String(index + 1).padStart(2, '0');
    updateStageTrack();
    updateHud(true);
  }

  function setStage(stage) {
    game.stage = stage;
    game.stageProgress = 0;
    game.stageLocked = false;
    game.lastTraceTick = 0;
    pointer.down = false;

    if (stage === 'FIT') initFit();
    if (stage === 'CALIBRATE' && game.job) game.job.calibrateHeld = 0;

    const copy = STAGE_COPY[stage];
    if (copy) {
      els.briefIcon.textContent = copy.icon;
      els.briefKicker.textContent = copy.kicker;
      els.briefTitle.textContent = copy.title;
      els.briefText.textContent = copy.text;
    }
    updateStageTrack();
    updateHud(true);
  }

  function updateStageTrack() {
    const activeIndex = STAGE_ORDER.indexOf(game.stage);
    document.querySelectorAll('.stage-track li').forEach(function (node, index) {
      node.classList.toggle('is-active', index === activeIndex);
      node.classList.toggle('is-done', activeIndex > index ||
        game.stage === 'DELIVERY' || game.stage === 'COMPLETE');
    });
  }

  function initFit() {
    const geometry = getGeometry();
    const above = geometry.portrait;
    const startX = above ? geometry.glassCx : clamp(
      geometry.glassCx + geometry.glassW * .83,
      geometry.glassCx + geometry.glassW * .55,
      viewW - geometry.glassW * .28
    );
    const startY = above
      ? Math.max(85, geometry.glassCy - geometry.glassH * 1.55)
      : geometry.glassCy - geometry.glassH * .08;
    game.job.fit = {
      x: startX,
      y: startY,
      startX,
      startY,
      angle: above ? -.08 : -.14,
      dragging: false,
      dragX: 0,
      dragY: 0
    };
  }

  function queueStage(stage, message, kicker, delay) {
    game.stageLocked = true;
    showStageFlash(message, kicker);
    game.transition = {
      at: game.activeMs + (reducedMotion ? 80 : delay),
      action: function () { setStage(stage); }
    };
  }

  function showStageFlash(title, kicker) {
    els.stageFlashTitle.textContent = title;
    els.stageFlashKicker.textContent = kicker || 'Etapa concluída';
    els.stageFlash.classList.remove('is-visible');
    void els.stageFlash.offsetWidth;
    els.stageFlash.classList.add('is-visible');
  }

  function registerMistake(penalty) {
    if (!game.job) return;
    game.job.accuracy = clamp(game.job.accuracy - penalty, 0, 100);
    game.job.mistakes += 1;
    game.job.clean = false;
    shake = Math.max(shake, 3);
    sound.play('error');
    if (navigator.vibrate) navigator.vibrate(25);
    updateHud(true);
  }

  function finishTraceStage() {
    if (game.stageLocked) return;
    if (game.stage === 'CUT') {
      spawnGlassShards(42, '#8ee6ff');
      flashAlpha = .42;
      shake = 7;
      sound.play('stage');
      queueStage('GLUE', 'Vidro removido', 'Remoção concluída', 650);
    } else if (game.stage === 'GLUE') {
      spawnGlassShards(15, '#ff465d');
      sound.play('stage');
      queueStage('FIT', 'Cordão perfeito', 'Moldura preparada', 650);
    }
  }

  function completeFit() {
    if (game.stageLocked) return;
    game.stageProgress = 1;
    game.stageLocked = true;
    flashAlpha = .3;
    shake = 5;
    spawnGlassShards(28, '#a8efff');
    sound.play('fit');
    if (navigator.vibrate) navigator.vibrate([20, 30, 35]);
    queueStage('CALIBRATE', 'Vidro encaixado', 'Precisão confirmada', 700);
  }

  function completeJob() {
    if (!game.job || game.stageLocked) return;
    game.stageLocked = true;
    game.stageProgress = 1;
    const durationMs = Math.max(Core.MIN_JOB_MS, Math.round(game.activeMs - game.job.startedAt));
    const slownessPenalty = Math.max(0, Math.round((durationMs - 22000) / 1000) * 2);
    const quality = clamp(Math.round(game.job.accuracy - slownessPenalty), 0, 100);
    const result = {
      quality,
      durationMs,
      mistakes: game.job.mistakes
    };
    game.jobs.push(result);
    game.combo = quality >= 78 ? game.combo + 1 : 0;
    game.maxCombo = Math.max(game.maxCombo, game.combo);
    game.score = Core.calculateScore(game.jobs, game.multiplier);
    game.stage = 'DELIVERY';
    game.job.deliveryStart = game.activeMs;
    game.transition = {
      at: game.activeMs + (reducedMotion ? 220 : 1250),
      action: createJob
    };

    flashAlpha = .58;
    shake = 10;
    spawnCelebration(quality);
    sound.play('car');
    if (navigator.vibrate) navigator.vibrate([35, 35, 60]);
    showStageFlash(Core.qualityLabel(quality), 'Viatura entregue · ' + quality + '%');
    updateStageTrack();
    updateHud(true);
  }

  function updateTrace(dt) {
    const geometry = getGeometry();
    const path = game.stage === 'GLUE' ? insetPolygon(geometry.glassPoly, 8) : geometry.glassPoly;
    const directionProgress = game.stage === 'GLUE' ? 1 - game.stageProgress : game.stageProgress;
    const target = pointOnPolygon(path, directionProgress);
    const radius = geometry.portrait ? 31 : 36;
    const distance = Math.hypot(pointer.x - target.x, pointer.y - target.y);
    const near = pointer.down && distance <= radius;
    const duration = Math.max(3600, (game.stage === 'CUT' ? 5200 : 4700) - game.jobs.length * 140);

    if (near) {
      game.stageProgress = clamp(game.stageProgress + dt / duration, 0, 1);
      const tick = Math.floor(game.stageProgress * 12);
      if (tick > game.lastTraceTick) {
        game.lastTraceTick = tick;
        sound.play('trace');
        spawnToolSparks(target.x, target.y, game.stage === 'GLUE' ? '#ff4b62' : '#8fe8ff');
      }
    } else if (pointer.down && game.activeMs - game.lastErrorAt > 850) {
      game.lastErrorAt = game.activeMs;
      registerMistake(2);
    }

    if (game.stageProgress >= 1) finishTraceStage();
  }

  function calibrationTarget(geometry) {
    const time = game.activeMs / 1000;
    return {
      x: geometry.glassCx + Math.sin(time * 1.42) * geometry.glassW * .105,
      y: geometry.glassCy + Math.cos(time * 1.08) * geometry.glassH * .12
    };
  }

  function updateCalibration(dt) {
    const geometry = getGeometry();
    const target = calibrationTarget(geometry);
    const radius = geometry.portrait ? 32 : 38;
    const distance = Math.hypot(pointer.x - target.x, pointer.y - target.y);
    const locked = pointer.down && distance <= radius;

    if (locked) {
      game.job.calibrateHeld += dt;
      game.stageProgress = clamp(game.job.calibrateHeld / 1900, 0, 1);
      if (Math.floor(game.job.calibrateHeld / 260) > game.lastTraceTick) {
        game.lastTraceTick += 1;
        sound.play('trace');
      }
    } else {
      game.job.calibrateHeld = Math.max(0, game.job.calibrateHeld - dt * .25);
      game.stageProgress = clamp(game.job.calibrateHeld / 1900, 0, 1);
      if (pointer.down && game.activeMs - game.lastErrorAt > 900) {
        game.lastErrorAt = game.activeMs;
        registerMistake(2);
      }
    }

    if (game.stageProgress >= 1) {
      sound.play('stage');
      completeJob();
    }
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

    if (!game.stageLocked && (game.stage === 'CUT' || game.stage === 'GLUE')) updateTrace(dt);
    if (!game.stageLocked && game.stage === 'CALIBRATE') updateCalibration(dt);

    const seconds = Math.ceil(game.remainingMs / 1000);
    if (seconds <= 10 && seconds !== game.lastCountdownSecond) {
      game.lastCountdownSecond = seconds;
      sound.play('last');
      if (navigator.vibrate && seconds <= 5) navigator.vibrate(18);
    }

    if (game.remainingMs <= 0) endGame();
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

  function spawnToolSparks(x, y, color) {
    if (reducedMotion) return;
    for (let index = 0; index < 4; index++) {
      spawnParticle({
        x,
        y,
        vx: (Math.random() - .5) * 3.6,
        vy: -Math.random() * 2.4,
        gravity: .08,
        size: 1.5 + Math.random() * 3,
        color,
        duration: 350 + Math.random() * 280,
        shape: 'spark'
      });
    }
  }

  function spawnGlassShards(count, color) {
    if (reducedMotion) count = Math.min(count, 8);
    const geometry = getGeometry();
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
    const count = reducedMotion ? 10 : 54;
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
        duration: 900 + Math.random() * 900,
        shape: index % 4 === 0 ? 'spark' : 'shard'
      });
    }
  }

  function pathPolygon(context, polygon) {
    context.beginPath();
    context.moveTo(polygon[0].x, polygon[0].y);
    for (let index = 1; index < polygon.length; index++) {
      context.lineTo(polygon[index].x, polygon[index].y);
    }
    context.closePath();
  }

  function strokePolygonProgress(context, polygon, progress, reverse) {
    const samples = 100;
    context.beginPath();
    for (let index = 0; index <= Math.floor(samples * progress); index++) {
      const amount = index / samples;
      const point = pointOnPolygon(polygon, reverse ? 1 - amount : amount);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.stroke();
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
    ctx.globalAlpha = .24;
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
    ctx.lineWidth = 1;
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

    const lightWidth = Math.min(240, viewW * .25);
    for (const center of [viewW * .25, viewW * .75]) {
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
    ctx.globalAlpha = .25;
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
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, width, 54, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f22842';
    ctx.font = '900 ' + Math.max(8, width * .052) + 'px system-ui';
    ctx.letterSpacing = '2px';
    ctx.fillText('EXPRESSGLASS', x + 13, y + 23);
    ctx.fillStyle = '#748bab';
    ctx.font = '700 ' + Math.max(6, width * .034) + 'px system-ui';
    ctx.fillText('PERFORMANCE BAY', x + 13, y + 40);
    ctx.restore();
  }

  function currentCarOffset() {
    if (!game.job) return 0;
    if (game.status === 'idle') return 0;
    if (game.stage === 'ARRIVAL') {
      if (!Number.isFinite(game.job.arrivalStart)) return 0;
      const amount = (game.activeMs - game.job.arrivalStart) / (reducedMotion ? 150 : 850);
      return (1 - easeOutCubic(amount)) * viewW * .95;
    }
    if (game.stage === 'DELIVERY') {
      if (!Number.isFinite(game.job.deliveryStart)) return 0;
      const amount = (game.activeMs - game.job.deliveryStart) / (reducedMotion ? 220 : 1250);
      return -easeOutCubic(amount) * viewW * 1.15;
    }
    return 0;
  }

  function drawCar(geometry, time) {
    if (!game.job) return;
    const offsetX = currentCarOffset();
    const center = geometry.cx + offsetX;
    const top = geometry.carTop;
    const width = geometry.carW;
    const height = geometry.carH;
    const left = center - width / 2;
    const right = center + width / 2;
    const colors = game.job.colors;

    ctx.save();
    ctx.translate(offsetX, 0);

    const shadow = ctx.createRadialGradient(geometry.cx, top + height * .92, 0, geometry.cx, top + height * .92, width * .55);
    shadow.addColorStop(0, 'rgba(0,0,0,.66)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(geometry.cx, top + height * .94, width * .56, height * .18, 0, 0, Math.PI * 2);
    ctx.fill();

    const bodyGradient = ctx.createLinearGradient(0, top, 0, top + height);
    bodyGradient.addColorStop(0, colors[0]);
    bodyGradient.addColorStop(.62, colors[1]);
    bodyGradient.addColorStop(1, '#07101c');
    ctx.fillStyle = bodyGradient;
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
    ctx.globalAlpha = .32;
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
    ctx.ellipse(x, y, radius, radius * .34, mirrored ? -.12 : .12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = .24 + Math.sin(time * .003) * .04;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x, y, radius * .63, radius * .16, mirrored ? -.12 : .12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawWindshield(geometry, time) {
    const polygon = geometry.glassPoly;
    const empty = game.stage === 'GLUE' || game.stage === 'FIT';
    const isFitting = game.stage === 'FIT';

    ctx.save();
    pathPolygon(ctx, polygon);
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
      pathPolygon(ctx, polygon);
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
      ctx.fillRect(
        geometry.glassCx - geometry.glassW,
        geometry.glassCy - geometry.glassH,
        geometry.glassW * 2,
        geometry.glassH * 2
      );
      const shineX = geometry.glassCx - geometry.glassW + ((time * .045) % (geometry.glassW * 2.3));
      ctx.fillStyle = 'rgba(255,255,255,.075)';
      ctx.save();
      ctx.translate(shineX, geometry.glassCy);
      ctx.rotate(-.42);
      ctx.fillRect(-geometry.glassW * .05, -geometry.glassH, geometry.glassW * .1, geometry.glassH * 2);
      ctx.restore();
      ctx.restore();
    }

    if (game.stage === 'CUT' || game.stage === 'ARRIVAL') drawCracks(geometry);
    if (game.stage === 'CUT') drawTraceTool(geometry, false);
    if (game.stage === 'GLUE') drawTraceTool(geometry, true);
    if (isFitting) drawFittingGlass(geometry);
    if (game.stage === 'CALIBRATE') drawCalibration(geometry, time);
    if (game.stage === 'DELIVERY') drawInstalledDetails(geometry);
    ctx.restore();
  }

  function drawCracks(geometry) {
    if (!game.job) return;
    ctx.save();
    pathPolygon(ctx, geometry.glassPoly);
    ctx.clip();
    ctx.lineCap = 'round';
    for (const crack of game.job.cracks) {
      const ox = geometry.glassCx - geometry.glassW / 2 + crack.origin.x * geometry.glassW;
      const oy = geometry.glassCy - geometry.glassH / 2 + crack.origin.y * geometry.glassH;
      const impact = ctx.createRadialGradient(ox, oy, 0, ox, oy, 14);
      impact.addColorStop(0, 'rgba(245,252,255,.9)');
      impact.addColorStop(.2, 'rgba(220,246,255,.45)');
      impact.addColorStop(1, 'rgba(173,230,248,0)');
      ctx.fillStyle = impact;
      ctx.beginPath();
      ctx.arc(ox, oy, 14, 0, Math.PI * 2);
      ctx.fill();
      for (const ray of crack.rays) {
        const length = ray.length * geometry.glassW;
        const midX = ox + Math.cos(ray.angle + ray.bend) * length * .55;
        const midY = oy + Math.sin(ray.angle + ray.bend) * length * .28;
        const endX = ox + Math.cos(ray.angle) * length;
        const endY = oy + Math.sin(ray.angle) * length * .48;
        ctx.strokeStyle = 'rgba(224,248,255,.78)';
        ctx.lineWidth = 1.05;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(midX, midY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(34,90,119,.62)';
        ctx.lineWidth = .45;
        ctx.beginPath();
        ctx.moveTo(ox + 1, oy + 1);
        ctx.lineTo(midX + 1, midY + 1);
        ctx.lineTo(endX + 1, endY + 1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawTraceTool(geometry, glue) {
    const path = glue ? insetPolygon(geometry.glassPoly, 8) : geometry.glassPoly;
    const reverse = glue;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = glue ? 'rgba(255,51,76,.16)' : 'rgba(130,225,253,.16)';
    ctx.lineWidth = glue ? 7 : 5;
    pathPolygon(ctx, path);
    ctx.stroke();
    ctx.strokeStyle = glue ? '#f22842' : '#7de2ff';
    ctx.lineWidth = glue ? 4 : 2.5;
    ctx.shadowColor = glue ? '#f22842' : '#7de2ff';
    ctx.shadowBlur = 12;
    strokePolygonProgress(ctx, path, game.stageProgress, reverse);
    ctx.shadowBlur = 0;

    const target = pointOnPolygon(path, reverse ? 1 - game.stageProgress : game.stageProgress);
    const pulse = 1 + Math.sin(performance.now() * .009) * .13;
    ctx.strokeStyle = glue ? '#ff8090' : '#d7f8ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(target.x, target.y, (geometry.portrait ? 20 : 23) * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = glue ? '#f22842' : '#e5fbff';
    ctx.beginPath();
    ctx.arc(target.x, target.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = glue ? '#f22842' : '#8ce9ff';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(target.x, target.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (pointer.down) {
      ctx.strokeStyle = 'rgba(255,255,255,.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFittingGlass(geometry) {
    const fit = game.job && game.job.fit;
    if (!fit) return;
    const distance = Math.hypot(fit.x - geometry.glassCx, fit.y - geometry.glassCy);
    const startDistance = Math.max(1, Math.hypot(fit.startX - geometry.glassCx, fit.startY - geometry.glassCy));
    const closeness = clamp(1 - distance / startDistance, 0, 1);
    fit.angle = lerp(fit.angle, (-.14) * (1 - closeness), .15);
    game.stageProgress = closeness;

    ctx.save();
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = closeness > .82 ? '#77f2b1' : 'rgba(128,218,248,.62)';
    ctx.lineWidth = 2;
    pathPolygon(ctx, geometry.glassPoly);
    ctx.stroke();
    ctx.setLineDash([]);

    const polygon = transformedGlassPolygon(geometry, fit.x, fit.y, 1, fit.angle);
    pathPolygon(ctx, polygon);
    const glass = ctx.createLinearGradient(fit.x - geometry.glassW / 2, fit.y, fit.x + geometry.glassW / 2, fit.y);
    glass.addColorStop(0, 'rgba(102,213,246,.32)');
    glass.addColorStop(.5, 'rgba(199,246,255,.2)');
    glass.addColorStop(1, 'rgba(69,160,201,.34)');
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.strokeStyle = closeness > .82 ? '#99ffd0' : '#a2eaff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#6fdcff';
    ctx.shadowBlur = fit.dragging ? 18 : 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    for (const side of [-1, 1]) {
      const cupX = fit.x + side * geometry.glassW * .18;
      const cupY = fit.y;
      ctx.fillStyle = '#ed2943';
      ctx.beginPath();
      ctx.arc(cupX, cupY, clamp(geometry.glassW * .035, 8, 14), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffd0d6';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.strokeStyle = '#3a1720';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cupX, cupY - 3);
      ctx.lineTo(cupX - side * 2, cupY - clamp(geometry.glassH * .22, 13, 24));
      ctx.stroke();
    }

    ctx.strokeStyle = closeness > .82 ? 'rgba(119,242,177,.85)' : 'rgba(125,226,255,.46)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(geometry.glassCx, geometry.glassCy, clamp(32 - closeness * 10, 20, 32), 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(geometry.glassCx - 8, geometry.glassCy);
    ctx.lineTo(geometry.glassCx + 8, geometry.glassCy);
    ctx.moveTo(geometry.glassCx, geometry.glassCy - 8);
    ctx.lineTo(geometry.glassCx, geometry.glassCy + 8);
    ctx.stroke();
    ctx.restore();
  }

  function drawCalibration(geometry, time) {
    const target = calibrationTarget(geometry);
    const locked = pointer.down && Math.hypot(pointer.x - target.x, pointer.y - target.y) <= (geometry.portrait ? 32 : 38);

    ctx.save();
    pathPolygon(ctx, geometry.glassPoly);
    ctx.clip();
    ctx.globalAlpha = .7;
    ctx.strokeStyle = 'rgba(127,225,255,.35)';
    ctx.lineWidth = 1.3;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(geometry.glassCx + side * geometry.glassW * .08, geometry.glassCy - geometry.glassH * .04);
      ctx.lineTo(geometry.glassCx + side * geometry.glassW * .35, geometry.glassCy + geometry.glassH * .54);
      ctx.stroke();
    }
    const scanY = geometry.glassCy - geometry.glassH * .5 + ((time * .08) % geometry.glassH);
    const scan = ctx.createLinearGradient(0, scanY - 15, 0, scanY + 15);
    scan.addColorStop(0, 'rgba(76,214,255,0)');
    scan.addColorStop(.5, 'rgba(76,214,255,.23)');
    scan.addColorStop(1, 'rgba(76,214,255,0)');
    ctx.fillStyle = scan;
    ctx.fillRect(geometry.glassCx - geometry.glassW / 2, scanY - 15, geometry.glassW, 30);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = locked ? '#77f2b1' : '#79dcff';
    ctx.fillStyle = locked ? 'rgba(119,242,177,.12)' : 'rgba(121,220,255,.09)';
    ctx.lineWidth = 2;
    ctx.shadowColor = locked ? '#77f2b1' : '#79dcff';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(target.x, target.y, geometry.portrait ? 20 : 23, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(target.x - 31, target.y);
    ctx.lineTo(target.x - 12, target.y);
    ctx.moveTo(target.x + 12, target.y);
    ctx.lineTo(target.x + 31, target.y);
    ctx.moveTo(target.x, target.y - 31);
    ctx.lineTo(target.x, target.y - 12);
    ctx.moveTo(target.x, target.y + 12);
    ctx.lineTo(target.x, target.y + 31);
    ctx.stroke();

    if (pointer.down) {
      ctx.strokeStyle = locked ? '#c7ffe0' : '#ff7184';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pointer.x - 18, pointer.y);
      ctx.lineTo(pointer.x + 18, pointer.y);
      ctx.moveTo(pointer.x, pointer.y - 18);
      ctx.lineTo(pointer.x, pointer.y + 18);
      ctx.stroke();
    }

    const cameraW = clamp(geometry.glassW * .12, 25, 46);
    ctx.fillStyle = '#05090f';
    ctx.beginPath();
    ctx.roundRect(geometry.glassCx - cameraW / 2, geometry.glassCy - geometry.glassH * .56, cameraW, cameraW * .62, 4);
    ctx.fill();
    ctx.fillStyle = locked ? '#77f2b1' : '#4bc5ef';
    ctx.beginPath();
    ctx.arc(geometry.glassCx, geometry.glassCy - geometry.glassH * .47, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawInstalledDetails(geometry) {
    ctx.save();
    const inner = insetPolygon(geometry.glassPoly, 8);
    ctx.setLineDash([1, 7]);
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(11,22,34,.72)';
    pathPolygon(ctx, inner);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(228,250,255,.52)';
    ctx.font = '700 ' + clamp(geometry.glassW * .022, 6, 10) + 'px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('E43  DOT  AS1', geometry.glassPoly[2].x - 10, geometry.glassPoly[2].y - 10);
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
    if (!STAGE_COPY[game.stage] || game.status !== 'playing') return;
    const text = STAGE_COPY[game.stage].canvas;
    const width = Math.min(viewW - 24, Math.max(260, ctx.measureText(text).width + 74));
    const height = 48;
    const x = (viewW - width) / 2;
    const y = viewH - height - 15;
    ctx.save();
    ctx.fillStyle = 'rgba(4,12,24,.78)';
    ctx.strokeStyle = 'rgba(133,190,229,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 13);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d9e7f7';
    ctx.font = '800 ' + (viewW < 430 ? 9 : 11) + 'px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, viewW / 2, y + 18);
    ctx.fillStyle = 'rgba(103,137,175,.25)';
    ctx.beginPath();
    ctx.roundRect(x + 20, y + 33, width - 40, 4, 2);
    ctx.fill();
    ctx.fillStyle = game.stage === 'GLUE' ? '#f22842' : '#78dfff';
    ctx.beginPath();
    ctx.roundRect(x + 20, y + 33, (width - 40) * game.stageProgress, 4, 2);
    ctx.fill();
    ctx.restore();
  }

  function drawIdleCar(time) {
    if (!game.job) {
      game.job = {
        colors: CAR_COLORS[0],
        cracks: createCracks(9321)
      };
      game.stage = 'ARRIVAL';
    }
    const previousStage = game.stage;
    game.stage = 'ARRIVAL';
    drawCar(getGeometry(), time);
    game.stage = previousStage;
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

    const targetScore = game.score;
    game.shownScore += (targetScore - game.shownScore) * .22;
    if (Math.abs(targetScore - game.shownScore) < 1) game.shownScore = targetScore;
    els.score.textContent = formatNumber(game.shownScore);
    els.jobsDone.textContent = String(game.jobs.length);
    const average = Core.averageQuality(game.jobs);
    els.averageQuality.textContent = game.jobs.length ? average + '%' : '—';
    els.stageProgress.style.width = Math.round(game.stageProgress * 100) + '%';

    const liveQuality = game.job ? Math.round(game.job.accuracy) : 100;
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
    els.timeMessage.textContent = danger ? 'Últimos segundos. Não pares!' : 'Cada segundo conta.';

    els.combo.textContent = '×' + Math.max(1, game.combo);
    els.comboPill.classList.toggle('is-visible', game.combo >= 2);
  }

  function animationFrame(time) {
    const dt = Math.min(50, Math.max(0, time - lastFrame));
    lastFrame = time;
    updateGame(dt);
    updateParticles(dt);
    flashAlpha *= Math.pow(.9, dt / 16.67);
    shake *= Math.pow(.82, dt / 16.67);
    updateHud(false);

    const frameInterval = game.status === 'playing' && !game.paused ? 16 : (document.hidden ? 500 : 50);
    if (time - lastPaint >= frameInterval) {
      drawFrame(time);
      lastPaint = time;
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

    try {
      const session = await createServerSession();
      game.sessionToken = session.sessionToken;
      game.ranked = true;
      applyTournament(session.multiplier);
    } catch (_) {
      game.sessionToken = null;
      game.ranked = false;
      applyTournament(1);
      toast('Sem ligação ao ranking. Esta partida ficará em modo treino.', 'warning');
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
    els.pauseOverlay.classList.remove('is-visible');
    els.endOverlay.classList.remove('is-visible');
    updateStageTrack();
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
      await wait(value === 'JÁ!' ? 520 : 620);
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
    els.pauseOverlay.classList.remove('is-visible');
    sound.play('finish');

    const quality = Core.averageQuality(game.jobs);
    els.finalScore.textContent = formatNumber(game.score);
    els.finalJobs.textContent = String(game.jobs.length);
    els.finalQuality.textContent = quality + '%';
    els.finalCombo.textContent = '×' + game.maxCombo;
    els.endKicker.textContent = game.jobs.length ? 'Turno terminado' : 'O relógio venceu';
    els.endTitle.textContent = game.jobs.length ? Core.qualityLabel(quality) : 'Quase! Tenta novamente.';
    els.saveStatus.textContent = game.ranked ? 'A validar resultado…' : 'Partida de treino · resultado não guardado';
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
    pointer.down = true;
    pointer.id = event.pointerId;
    canvas.setPointerCapture(event.pointerId);

    if (game.stage === 'FIT' && game.job && game.job.fit) {
      const geometry = getGeometry();
      const fit = game.job.fit;
      const polygon = transformedGlassPolygon(geometry, fit.x, fit.y, 1, fit.angle);
      if (pointInPolygon(position, polygon)) {
        fit.dragging = true;
        fit.dragX = position.x - fit.x;
        fit.dragY = position.y - fit.y;
      } else {
        pointer.down = false;
      }
    }
  }

  function handlePointerMove(event) {
    const position = pointerPosition(event);
    pointer.x = position.x;
    pointer.y = position.y;

    if (game.stage === 'FIT' && game.job && game.job.fit && game.job.fit.dragging && pointer.down) {
      event.preventDefault();
      const fit = game.job.fit;
      fit.x = clamp(position.x - fit.dragX, -viewW * .1, viewW * 1.1);
      fit.y = clamp(position.y - fit.dragY, 40, viewH - 70);
    }
  }

  function handlePointerUp(event) {
    if (pointer.id != null && event.pointerId !== pointer.id) return;
    const position = pointerPosition(event);
    pointer.x = position.x;
    pointer.y = position.y;

    if (game.status === 'playing' && !game.paused && game.stage === 'FIT' &&
        game.job && game.job.fit && game.job.fit.dragging) {
      const geometry = getGeometry();
      const fit = game.job.fit;
      fit.dragging = false;
      const distance = Math.hypot(fit.x - geometry.glassCx, fit.y - geometry.glassCy);
      const threshold = clamp(geometry.glassW * .105, 22, 42);
      if (distance <= threshold) {
        const precisionPenalty = Math.round((distance / threshold) * 5);
        game.job.accuracy = clamp(game.job.accuracy - precisionPenalty, 0, 100);
        fit.x = geometry.glassCx;
        fit.y = geometry.glassCy;
        fit.angle = 0;
        completeFit();
      } else {
        registerMistake(6);
        fit.x = fit.startX;
        fit.y = fit.startY;
        fit.angle = geometry.portrait ? -.08 : -.14;
      }
    }

    pointer.down = false;
    pointer.id = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
  }

  async function loadRanking(period, silent) {
    if (!silent) els.rankList.innerHTML = '<div class="rank-empty">A carregar classificação…</div>';
    try {
      const response = await fetch(API + '?period=' + encodeURIComponent(period), {
        headers: authHeaders(false)
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Ranking indisponível');
      rankData = data;
      if (data.me) {
        els.personalBest.textContent = data.me.allTimeBest ? formatNumber(data.me.allTimeBest) : '—';
        els.myBest.querySelector('strong').textContent = data.me.periodBest ? formatNumber(data.me.periodBest) : '—';
      }
      if (!silent) renderRanking();
    } catch (_) {
      if (!silent) els.rankList.innerHTML = '<div class="rank-empty">Não foi possível carregar o ranking.<br>Tenta novamente dentro de instantes.</div>';
    }
  }

  function renderRanking() {
    els.rankList.replaceChildren();
    if (!rankData) return;
    const rows = rankView === 'players' ? rankData.players : rankData.stores;
    if (!rows || !rows.length) {
      const empty = document.createElement('div');
      empty.className = 'rank-empty';
      empty.textContent = 'Ainda não existem resultados neste período. Sê o primeiro a entrar na oficina!';
      els.rankList.appendChild(empty);
      return;
    }

    rows.forEach(function (row, index) {
      const item = document.createElement('div');
      item.className = 'rank-row';
      const isMe = rankView === 'players' && currentUser && row.username === currentUser.username;
      if (isMe) item.classList.add('is-me');

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

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && game.status === 'playing' && !game.paused) togglePause(true);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key.toLowerCase() === 'p' && game.status === 'playing') {
      event.preventDefault();
      togglePause();
    }
    if (event.key === 'Escape') {
      if (els.rankModal.classList.contains('is-visible')) closeRanking();
      else if (game.status === 'playing') togglePause();
    }
  });
  window.addEventListener('resize', resizeCanvas);

  syncSoundButton();
  applyTournament(1);
  resizeCanvas();
  updateHud(true);
  loadRanking('all', true);
  requestAnimationFrame(animationFrame);
})();
