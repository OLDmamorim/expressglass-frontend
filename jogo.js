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
  const ROCKS = {
    small: { damage: 12, radius: 18, color: '#737985' },
    medium: { damage: 19, radius: 25, color: '#5a606b' },
    large: { damage: 28, radius: 33, color: '#434852' }
  };
  const BONUS_LABELS = {
    glass: 'VIDRO',
    resin: 'RESINA',
    shield: 'ESCUDO',
    double: '×2',
    slow: 'SLOW'
  };
  const BONUS_COLORS = {
    glass: '#6de1ff',
    resin: '#ff526b',
    shield: '#7899ff',
    double: '#ffe08a',
    slow: '#73efc2'
  };
  const LANES = [-1, 0, 1];

  const els = {};
  [
    'gameCanvas', 'canvasShell', 'liveBadge', 'mobileTimer', 'pauseBtn', 'soundBtn',
    'rankBtn', 'distance', 'speed', 'credits', 'combo', 'effectPills', 'shieldPill',
    'doublePill', 'slowPill', 'useGlassBonusBtn', 'glassBonusCount', 'shopPrompt',
    'damageWarning', 'stageFlash', 'stageFlashKicker', 'stageFlashTitle', 'countdown',
    'leftBtn', 'rightBtn', 'startOverlay', 'startBtn', 'startBtnText', 'pauseOverlay',
    'resumeBtn', 'shopOverlay', 'shopDamageText', 'repairBtn', 'replaceBtn',
    'continueBtn', 'endOverlay', 'endKicker', 'endTitle', 'finalTime', 'saveStatus',
    'finalDistance', 'finalDodged', 'finalCombo', 'againBtn', 'endRankBtn',
    'glassCard', 'damageLabel', 'damagePercent', 'damageBar', 'damageText',
    'impactDots', 'dodged', 'hits', 'personalBest', 'rankModal', 'closeRankBtn',
    'periodTabs', 'viewTabs', 'myBest', 'rankList', 'toastLayer'
  ].forEach(function (id) {
    els[id] = document.getElementById(id);
  });

  const canvas = els.gameCanvas;
  const ctx = canvas.getContext('2d', { alpha: false });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let viewW = 1;
  let viewH = 1;
  let dpr = 1;
  let lastFrame = performance.now();
  let lastPaint = 0;
  let lastHud = 0;
  let lastFrameError = '';
  let rankPeriod = 'today';
  let rankView = 'players';
  let rankData = null;
  let flashTimer = null;
  let objectSequence = 0;

  const pointer = {
    down: false,
    id: null,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0
  };

  const particles = [];

  function freshGame() {
    return {
      status: 'idle',
      paused: false,
      activeMs: 0,
      lane: 0,
      laneVisual: 0,
      objects: [],
      spawnTimer: 1300,
      bonusTimer: 7200,
      shopTimer: 20500,
      shopAvailable: false,
      shopObjectId: null,
      shopBusy: false,
      damage: 0,
      impacts: [],
      credits: 0,
      combo: 0,
      maxCombo: 0,
      dodged: 0,
      hits: 0,
      repairs: 0,
      replacements: 0,
      bonuses: 0,
      glassBonuses: 0,
      shield: 0,
      doubleUntil: 0,
      slowUntil: 0,
      distanceM: 0,
      speedKph: 88,
      shake: 0,
      impactFlash: 0,
      glassSwap: 0,
      shatter: 0,
      sessionToken: null,
      ranked: false,
      lastSafeLane: 0
    };
  }

  let game = freshGame();

  class SoundEngine {
    constructor() {
      this.context = null;
      this.enabled = localStorage.getItem('eg_impacto_sound') !== 'off';
    }

    unlock() {
      if (!this.enabled) return;
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.context = new AudioContext();
      }
      if (this.context && this.context.state === 'suspended') this.context.resume();
    }

    setEnabled(enabled) {
      this.enabled = enabled;
      localStorage.setItem('eg_impacto_sound', enabled ? 'on' : 'off');
      if (enabled) this.unlock();
    }

    tone(frequency, duration, type, volume, slide) {
      if (!this.enabled) return;
      this.unlock();
      if (!this.context) return;
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type || 'sine';
      oscillator.frequency.setValueAtTime(frequency, now);
      if (slide) oscillator.frequency.exponentialRampToValueAtTime(slide, now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume || .035, now + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + .03);
    }

    play(name) {
      if (name === 'lane') this.tone(185, .09, 'sine', .024, 255);
      else if (name === 'dodge') this.tone(580, .08, 'triangle', .026, 760);
      else if (name === 'hit') {
        this.tone(115, .28, 'sawtooth', .075, 52);
        setTimeout(() => this.tone(930, .18, 'square', .025, 260), 25);
      } else if (name === 'shield') this.tone(360, .24, 'sine', .04, 950);
      else if (name === 'bonus') {
        this.tone(440, .12, 'triangle', .034, 660);
        setTimeout(() => this.tone(660, .18, 'triangle', .03, 990), 80);
      } else if (name === 'shop') {
        this.tone(330, .14, 'sine', .035, 440);
        setTimeout(() => this.tone(520, .2, 'sine', .03, 690), 95);
      } else if (name === 'glass') {
        this.tone(420, .28, 'triangle', .04, 1150);
        setTimeout(() => this.tone(780, .26, 'sine', .035, 1450), 90);
      } else if (name === 'count') this.tone(280, .1, 'square', .022, 220);
      else if (name === 'go') this.tone(520, .28, 'triangle', .045, 960);
      else if (name === 'finish') this.tone(180, .65, 'sawtooth', .04, 55);
    }
  }

  const sound = new SoundEngine();

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function choice(values) {
    return values[Math.floor(Math.random() * values.length)];
  }

  function formatNumber(value) {
    return Math.round(value || 0).toLocaleString('pt-PT');
  }

  function formatDuration(milliseconds, precise) {
    const total = Math.max(0, Number(milliseconds) || 0);
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor(total / 1000) % 60;
    const tenths = Math.floor(total / 100) % 10;
    return String(minutes).padStart(2, '0') + ':' +
      String(seconds).padStart(2, '0') + (precise === false ? '' : '.' + tenths);
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

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function toast(message, type) {
    const node = document.createElement('div');
    node.className = 'toast' + (type ? ' is-' + type : '');
    node.textContent = message;
    els.toastLayer.appendChild(node);
    setTimeout(function () {
      node.style.opacity = '0';
      node.style.transform = 'translateX(20px)';
      setTimeout(function () { node.remove(); }, 260);
    }, 2500);
  }

  function showFlash(kicker, title, danger) {
    clearTimeout(flashTimer);
    els.stageFlashKicker.textContent = kicker;
    els.stageFlashTitle.textContent = title;
    els.stageFlash.classList.remove('is-visible', 'is-danger');
    if (danger) els.stageFlash.classList.add('is-danger');
    void els.stageFlash.offsetWidth;
    els.stageFlash.classList.add('is-visible');
    flashTimer = setTimeout(function () {
      els.stageFlash.classList.remove('is-visible', 'is-danger');
    }, 1200);
  }

  function syncSoundButton() {
    document.body.classList.toggle('is-muted', !sound.enabled);
    els.soundBtn.setAttribute('aria-label', sound.enabled ? 'Desativar o som' : 'Ativar o som');
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    viewW = Math.max(1, rect.width);
    viewH = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function horizonY() {
    return viewH * (viewW < 600 ? .245 : .29);
  }

  function roadCenter() {
    const visualTime = game.status === 'idle' ? performance.now() : game.activeMs;
    return viewW * .5 -
      game.laneVisual * viewW * .035 +
      Math.sin(visualTime / 6500) * viewW * .012;
  }

  function project(z, lane) {
    const safeZ = clamp(z, 0, 1.15);
    const perspective = Math.pow(safeZ, 2.18);
    const horizon = horizonY();
    const nearHalf = viewW * (viewW < 600 ? .82 : .65);
    const halfRoad = lerp(viewW * .055, nearHalf, perspective);
    return {
      x: roadCenter() + lane * halfRoad * .47,
      y: horizon + perspective * (viewH - horizon) * .77,
      scale: lerp(.045, 1.28, perspective),
      halfRoad,
      perspective
    };
  }

  function difficulty() {
    return 1 + game.activeMs / 42000;
  }

  function worldSpeed() {
    const base = .43 + Math.min(.43, game.activeMs / 210000 * .43);
    return base * (game.activeMs < game.slowUntil ? .62 : 1);
  }

  function rockSize() {
    const roll = Math.random();
    const hard = clamp((difficulty() - 1) / 3.2, 0, 1);
    if (roll < .12 + hard * .14) return 'large';
    if (roll < .46 + hard * .12) return 'medium';
    return 'small';
  }

  function createRock(lane, size, z) {
    return {
      id: ++objectSequence,
      kind: 'rock',
      lane,
      size: size || rockSize(),
      z: typeof z === 'number' ? z : -.02,
      rotation: random(0, Math.PI * 2),
      spin: random(-2.6, 2.6),
      wobble: random(0, Math.PI * 2),
      resolved: false
    };
  }

  function spawnHazardRow() {
    const level = difficulty();
    const pairChance = game.activeMs > 18000 ? clamp(.12 + (level - 1) * .09, .12, .48) : 0;
    const pair = Math.random() < pairChance;

    if (pair) {
      let safeLane = choice(LANES);
      if (safeLane === game.lastSafeLane && Math.random() < .45) {
        safeLane = choice(LANES.filter(function (lane) { return lane !== safeLane; }));
      }
      game.lastSafeLane = safeLane;
      LANES.forEach(function (lane) {
        if (lane !== safeLane) game.objects.push(createRock(lane));
      });
    } else {
      const lane = choice(LANES);
      game.lastSafeLane = choice(LANES.filter(function (candidate) { return candidate !== lane; }));
      game.objects.push(createRock(lane));
    }
  }

  function weightedBonus() {
    const roll = Math.random();
    if (roll < .12) return 'glass';
    if (roll < .37) return 'resin';
    if (roll < .59) return 'shield';
    if (roll < .82) return 'double';
    return 'slow';
  }

  function createBonus(type, lane, z) {
    return {
      id: ++objectSequence,
      kind: 'bonus',
      bonus: type || weightedBonus(),
      lane: typeof lane === 'number' ? lane : choice(LANES),
      z: typeof z === 'number' ? z : -.02,
      rotation: random(0, Math.PI * 2),
      spin: random(-1.5, 1.5),
      bob: random(0, Math.PI * 2),
      resolved: false
    };
  }

  function spawnBonus() {
    let lane = choice(LANES);
    const conflict = game.objects.find(function (object) {
      return object.kind === 'rock' && object.lane === lane && object.z < .18;
    });
    if (conflict) lane = choice(LANES.filter(function (candidate) { return candidate !== lane; }));
    game.objects.push(createBonus(weightedBonus(), lane));
  }

  function spawnShop() {
    const shop = {
      id: ++objectSequence,
      kind: 'shop',
      lane: 1.92,
      z: -.03,
      resolved: false
    };
    game.shopObjectId = shop.id;
    game.objects.push(shop);
  }

  function addParticles(x, y, color, count, power) {
    if (reducedMotion) count = Math.min(count, 5);
    for (let index = 0; index < count; index += 1) {
      const angle = random(0, Math.PI * 2);
      const velocity = random(.35, 1) * (power || 1);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - random(.1, .45),
        life: random(380, 850),
        maxLife: 850,
        size: random(1.5, 5),
        color
      });
    }
  }

  function dodgeRock(object) {
    object.resolved = true;
    game.dodged += 1;
    game.combo += 1;
    game.maxCombo = Math.max(game.maxCombo, game.combo);
    const doubled = game.activeMs < game.doubleUntil;
    const earned = Core.dodgeCredits(object.size, game.combo, doubled);
    game.credits += earned;
    const point = project(.93, object.lane);
    addParticles(point.x, point.y, doubled ? '#ffe08a' : '#6de1ff', 7, .7);
    sound.play('dodge');
    if (object.size === 'large' || game.combo === 5 || game.combo % 10 === 0) {
      showFlash(
        game.combo >= 5 ? 'Combo ×' + game.combo : 'Desvio perfeito',
        '+' + earned + ' pontos EG'
      );
    }
  }

  function impactPosition(lane) {
    return {
      x: clamp(.5 + lane * .19 + random(-.07, .07), .14, .86),
      y: random(.25, .63)
    };
  }

  function hitRock(object) {
    object.resolved = true;
    const point = project(.93, object.lane);

    if (game.shield > 0) {
      game.shield -= 1;
      game.combo += 1;
      game.maxCombo = Math.max(game.maxCombo, game.combo);
      const earned = Core.dodgeCredits(object.size, game.combo, game.activeMs < game.doubleUntil);
      game.credits += earned;
      addParticles(point.x, point.y, '#7899ff', 22, 1.6);
      game.impactFlash = .65;
      sound.play('shield');
      showFlash('Proteção EG ativada', 'Impacto absorvido');
      return;
    }

    const rock = ROCKS[object.size];
    const position = impactPosition(object.lane);
    game.hits += 1;
    game.combo = 0;
    game.damage = clamp(game.damage + rock.damage, 0, 100);
    game.impacts.push({
      id: object.id,
      x: position.x,
      y: position.y,
      severity: rock.damage,
      bornAt: game.activeMs,
      seed: random(1, 999)
    });
    game.shake = object.size === 'large' ? 18 : object.size === 'medium' ? 13 : 9;
    game.impactFlash = 1;
    addParticles(position.x * viewW, position.y * viewH, '#e9f7ff', 28, 2);
    sound.play('hit');
    showFlash(
      object.size === 'large' ? 'Impacto violento' : 'Pedra no para-brisas',
      '+' + rock.damage + '% de danos',
      true
    );

    if (game.damage >= 100) beginShatter();
  }

  function collectBonus(object) {
    object.resolved = true;
    game.bonuses += 1;
    const type = object.bonus;
    const color = BONUS_COLORS[type];
    const point = project(.92, object.lane);
    addParticles(point.x, point.y, color, 24, 1.5);
    sound.play('bonus');

    if (type === 'glass') {
      if (game.glassBonuses < 2) {
        game.glassBonuses += 1;
        showFlash('Bónus raro guardado', 'Vidro Novo disponível');
      } else {
        game.credits += 50;
        showFlash('Inventário cheio', '+50 pontos EG');
      }
    } else if (type === 'resin') {
      if (game.damage > 0) {
        game.damage = Math.max(0, game.damage - 18);
        softenCracks(.7);
        showFlash('Resina Express', '−18% de danos');
      } else {
        game.credits += 25;
        showFlash('Vidro impecável', '+25 pontos EG');
      }
    } else if (type === 'shield') {
      game.shield = 1;
      showFlash('Proteção EG', 'Próximo impacto bloqueado');
    } else if (type === 'double') {
      game.doubleUntil = Math.max(game.doubleUntil, game.activeMs) + 8000;
      showFlash('Pontos ×2', 'Oito segundos de vantagem');
    } else if (type === 'slow') {
      game.slowUntil = Math.max(game.slowUntil, game.activeMs) + 6500;
      showFlash('Câmara lenta', 'A estrada abrandou');
    }
  }

  function resolveObject(object) {
    if (object.resolved) return;
    if (object.kind === 'rock') {
      if (Math.round(game.laneVisual) === object.lane) hitRock(object);
      else dodgeRock(object);
    } else if (object.kind === 'bonus') {
      if (Math.round(game.laneVisual) === object.lane) collectBonus(object);
      else object.resolved = true;
    }
  }

  function softenCracks(factor) {
    game.impacts.forEach(function (impact) {
      impact.severity *= factor;
    });
    game.impacts = game.impacts.filter(function (impact) { return impact.severity >= 5; });
  }

  function clearGlass() {
    game.damage = 0;
    game.impacts = [];
    game.glassSwap = 1;
    game.impactFlash = .35;
    addParticles(viewW * .5, viewH * .46, '#6de1ff', 34, 2.2);
    sound.play('glass');
  }

  function useGlassBonus() {
    if (game.status !== 'playing' && game.status !== 'shop') return;
    if (game.glassBonuses < 1) {
      toast('Ainda não apanhaste um bónus Vidro Novo.', 'warning');
      return;
    }
    if (game.damage <= 0) {
      toast('Guarda o bónus: o para-brisas está impecável.', 'warning');
      return;
    }
    const result = Core.applyService({
      damage: game.damage,
      credits: game.credits
    }, 'replace', true);
    if (!result.ok) return;
    game.glassBonuses -= 1;
    game.replacements += 1;
    clearGlass();
    showFlash('Bónus Vidro Novo', 'Para-brisas substituído');
    if (game.status === 'shop') refreshShop();
  }

  function changeLane(direction) {
    if (game.status !== 'playing' || game.paused) return;
    const next = clamp(game.lane + direction, -1, 1);
    if (next === game.lane) {
      if (direction > 0 && game.shopAvailable) enterShop();
      return;
    }
    game.lane = next;
    sound.play('lane');
  }

  function updateGame(dt) {
    if (game.status !== 'playing' || game.paused) return;

    game.activeMs += dt;
    const slow = game.activeMs < game.slowUntil;
    game.speedKph = (88 + Math.min(78, game.activeMs / 2100)) * (slow ? .72 : 1);
    game.distanceM += dt / 1000 * (game.speedKph / 3.6);
    game.laneVisual += (game.lane - game.laneVisual) * (1 - Math.pow(.002, dt / 1000));
    game.spawnTimer -= dt;
    game.bonusTimer -= dt;
    game.shopTimer -= dt;

    if (game.spawnTimer <= 0) {
      spawnHazardRow();
      const base = Math.max(520, 1220 - game.activeMs / 270);
      game.spawnTimer = base + random(40, 270);
    }
    if (game.bonusTimer <= 0) {
      spawnBonus();
      game.bonusTimer = random(7800, 12500);
    }
    if (game.shopTimer <= 0 && game.shopObjectId == null) {
      spawnShop();
      game.shopTimer = random(28500, 38500);
    }

    const speed = worldSpeed();
    game.shopAvailable = false;
    for (const object of game.objects) {
      object.z += speed * dt / 1000;
      if (object.rotation != null) object.rotation += object.spin * dt / 1000;

      if ((object.kind === 'rock' || object.kind === 'bonus') &&
          !object.resolved && object.z >= .92) {
        resolveObject(object);
      }

      if (object.kind === 'shop' && !object.resolved) {
        if (object.z >= .28 && object.z <= 1.02) {
          game.shopAvailable = true;
        }
        if (object.z > 1.02) {
          object.resolved = true;
          game.shopObjectId = null;
        }
      }
    }

    game.objects = game.objects.filter(function (object) {
      return object.z < 1.16;
    });

    game.shake *= Math.pow(.07, dt / 1000);
    game.impactFlash *= Math.pow(.09, dt / 1000);
    game.glassSwap *= Math.pow(.035, dt / 1000);
  }

  function updateParticles(dt) {
    for (const particle of particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += .0015 * dt;
      particle.vx *= Math.pow(.55, dt / 1000);
    }
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      if (particles[index].life <= 0) particles.splice(index, 1);
    }
  }

  function beginShatter() {
    if (game.status !== 'playing') return;
    game.status = 'shattering';
    game.shatter = 1;
    game.shopAvailable = false;
    pointer.down = false;
    document.body.classList.remove('is-playing');
    sound.play('finish');
    addParticles(viewW * .5, viewH * .42, '#e9f7ff', 80, 3.6);
    setTimeout(endGame, reducedMotion ? 250 : 900);
  }

  function drawSky(time) {
    const horizon = horizonY();
    const sky = ctx.createLinearGradient(0, 0, 0, horizon * 1.3);
    sky.addColorStop(0, '#65a7d4');
    sky.addColorStop(.45, '#a7d1e5');
    sky.addColorStop(1, '#e6d9bf');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, viewW, horizon * 1.35);

    const sunX = viewW * .78;
    const sunY = horizon * .38;
    const glow = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, viewW * .17);
    glow.addColorStop(0, 'rgba(255,248,213,.92)');
    glow.addColorStop(.16, 'rgba(255,225,156,.42)');
    glow.addColorStop(1, 'rgba(255,219,145,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, viewW, horizon * 1.2);

    ctx.fillStyle = '#8797a0';
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (let index = 0; index <= 12; index += 1) {
      const x = index / 12 * viewW;
      const y = horizon - (18 + Math.sin(index * 2.2 + time / 9000) * 12 +
        (index % 3) * 9) * (viewW < 600 ? .6 : 1);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(viewW, horizon + 25);
    ctx.lineTo(0, horizon + 25);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#617a6a';
    ctx.beginPath();
    ctx.moveTo(0, horizon + 5);
    for (let index = 0; index <= 18; index += 1) {
      const x = index / 18 * viewW;
      const y = horizon - 4 - Math.abs(Math.sin(index * 3.17)) * 20;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(viewW, horizon + 40);
    ctx.lineTo(0, horizon + 40);
    ctx.closePath();
    ctx.fill();
  }

  function drawRoad(time) {
    const horizon = horizonY();
    const center = roadCenter();
    const nearHalf = viewW * (viewW < 600 ? .82 : .65);
    const farHalf = viewW * .055;

    const ground = ctx.createLinearGradient(0, horizon, 0, viewH);
    ground.addColorStop(0, '#637d54');
    ground.addColorStop(.5, '#4c6843');
    ground.addColorStop(1, '#314c35');
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, viewW, viewH - horizon);

    ctx.fillStyle = '#a1a197';
    ctx.beginPath();
    ctx.moveTo(center - farHalf - 5, horizon);
    ctx.lineTo(center - nearHalf - 35, viewH);
    ctx.lineTo(center + nearHalf + 35, viewH);
    ctx.lineTo(center + farHalf + 5, horizon);
    ctx.closePath();
    ctx.fill();

    const asphalt = ctx.createLinearGradient(0, horizon, 0, viewH);
    asphalt.addColorStop(0, '#51545a');
    asphalt.addColorStop(.58, '#34383f');
    asphalt.addColorStop(1, '#22262d');
    ctx.fillStyle = asphalt;
    ctx.beginPath();
    ctx.moveTo(center - farHalf, horizon);
    ctx.lineTo(center - nearHalf, viewH);
    ctx.lineTo(center + nearHalf, viewH);
    ctx.lineTo(center + farHalf, horizon);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(247,244,223,.84)';
    ctx.lineWidth = viewW < 600 ? 2 : 3;
    ctx.beginPath();
    ctx.moveTo(center - farHalf * .96, horizon);
    ctx.lineTo(center - nearHalf * .96, viewH);
    ctx.moveTo(center + farHalf * .96, horizon);
    ctx.lineTo(center + nearHalf * .96, viewH);
    ctx.stroke();

    const offset = ((game.status === 'idle' ? time * .00017 : game.distanceM * .012) % 1);
    for (let laneIndex = -1; laneIndex <= 0; laneIndex += 1) {
      for (let index = 0; index < 14; index += 1) {
        const z1 = ((index / 14 + offset) % 1);
        const z2 = Math.min(1, z1 + .035 + z1 * .025);
        const divider = laneIndex + .5;
        const p1 = project(z1, divider);
        const p2 = project(z2, divider);
        ctx.strokeStyle = 'rgba(246,245,230,.78)';
        ctx.lineWidth = lerp(.5, 7, p2.perspective);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }

    drawRoadside(time);
  }

  function drawRoadside(time) {
    const offset = ((game.status === 'idle' ? time * .00011 : game.distanceM * .007) % 1);
    for (let index = 0; index < 12; index += 1) {
      const z = (index / 12 + offset) % 1;
      const left = project(z, -2.15);
      const right = project((z + .045) % 1, 2.15);
      drawTree(left.x, left.y, left.scale);
      drawTree(right.x, right.y, right.scale * .92);
    }

    for (let index = 0; index < 9; index += 1) {
      const z = (index / 9 + offset * 1.4) % 1;
      const left = project(z, -1.75);
      const right = project(z, 1.75);
      ctx.strokeStyle = `rgba(205,215,217,${.18 + z * .45})`;
      ctx.lineWidth = Math.max(.5, left.scale * 2);
      ctx.beginPath();
      ctx.moveTo(left.x, left.y - 18 * left.scale);
      ctx.lineTo(left.x, left.y + 5 * left.scale);
      ctx.moveTo(right.x, right.y - 18 * right.scale);
      ctx.lineTo(right.x, right.y + 5 * right.scale);
      ctx.stroke();
    }
  }

  function drawTree(x, y, scale) {
    const size = 42 * scale;
    if (size < .8) return;
    ctx.fillStyle = '#354b32';
    ctx.fillRect(x - 2 * scale, y - size * .3, 4 * scale, size * .34);
    ctx.fillStyle = '#31583d';
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x - size * .42, y - size * .12);
    ctx.lineTo(x + size * .42, y - size * .12);
    ctx.closePath();
    ctx.fill();
  }

  function drawRock(object) {
    const point = project(object.z, object.lane);
    const config = ROCKS[object.size];
    const radius = config.radius * point.scale;
    if (radius < .6) return;
    const bob = Math.sin(object.wobble + object.z * 15) * radius * .12;

    ctx.save();
    ctx.translate(point.x, point.y - radius * .8 + bob);
    ctx.rotate(object.rotation);
    ctx.fillStyle = `rgba(0,0,0,${.12 + object.z * .22})`;
    ctx.beginPath();
    ctx.ellipse(0, radius * .9, radius * .9, radius * .3, 0, 0, Math.PI * 2);
    ctx.fill();

    const rockGradient = ctx.createRadialGradient(-radius * .3, -radius * .35, 1, 0, 0, radius);
    rockGradient.addColorStop(0, '#a1a6ad');
    rockGradient.addColorStop(.35, config.color);
    rockGradient.addColorStop(1, '#252a31');
    ctx.fillStyle = rockGradient;
    ctx.strokeStyle = 'rgba(20,23,28,.65)';
    ctx.lineWidth = Math.max(.5, radius * .06);
    ctx.beginPath();
    const points = 9;
    for (let index = 0; index < points; index += 1) {
      const angle = index / points * Math.PI * 2;
      const variance = .74 + Math.sin(object.id * 2.17 + index * 4.3) * .12;
      const x = Math.cos(angle) * radius * variance;
      const y = Math.sin(angle) * radius * (.7 + variance * .2);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = Math.max(.4, radius * .035);
    ctx.beginPath();
    ctx.moveTo(-radius * .45, -radius * .2);
    ctx.lineTo(-radius * .08, -radius * .52);
    ctx.lineTo(radius * .25, -radius * .28);
    ctx.stroke();
    ctx.restore();
  }

  function drawBonus(object, time) {
    const point = project(object.z, object.lane);
    const radius = 25 * point.scale;
    if (radius < .8) return;
    const color = BONUS_COLORS[object.bonus];
    const bob = Math.sin(time / 180 + object.bob) * 8 * point.scale;

    ctx.save();
    ctx.translate(point.x, point.y - radius * 1.25 + bob);
    ctx.rotate(object.rotation * .35);
    const aura = ctx.createRadialGradient(0, 0, 1, 0, 0, radius * 2.1);
    aura.addColorStop(0, color + 'aa');
    aura.addColorStop(.42, color + '35');
    aura.addColorStop(1, color + '00');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 2.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(5,18,34,.88)';
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, radius * .1);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.rotate(-object.rotation * .35);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.max(5, radius * (object.bonus === 'double' ? .72 : .42))}px Inter, sans-serif`;
    ctx.fillText(BONUS_LABELS[object.bonus], 0, 0);
    ctx.restore();
  }

  function drawShop(object) {
    const point = project(object.z, 1.83);
    const scale = point.scale;
    if (scale < .04) return;
    const width = 92 * scale;
    const height = 60 * scale;
    const x = point.x - width * .5;
    const y = point.y - height;

    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, width * .65, height * .13, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f1f3f5';
    ctx.strokeStyle = '#17345e';
    ctx.lineWidth = Math.max(.5, 3 * scale);
    roundedRect(ctx, x, y, width, height, 5 * scale);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ef263f';
    ctx.fillRect(x, y, width, height * .2);
    ctx.fillStyle = '#152f57';
    ctx.fillRect(x + width * .08, y + height * .67, width * .84, height * .25);

    ctx.fillStyle = '#102a50';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `950 ${Math.max(3, 10 * scale)}px Inter, sans-serif`;
    ctx.fillText('EXPRESS', point.x, y + height * .42);
    ctx.fillStyle = '#ef263f';
    ctx.fillText('GLASS', point.x, y + height * .55);

    if (object.z > .35 && object.z < .95) {
      const signY = y - 27 * scale;
      ctx.fillStyle = '#ef263f';
      roundedRect(ctx, point.x - 51 * scale, signY, 102 * scale, 20 * scale, 4 * scale);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.max(3, 7.5 * scale)}px Inter, sans-serif`;
      ctx.fillText('REPARAÇÃO NA PRÓXIMA SAÍDA', point.x, signY + 10 * scale);
    }
  }

  function drawObjects(time) {
    const ordered = game.objects.slice().sort(function (a, b) { return a.z - b.z; });
    for (const object of ordered) {
      if (object.resolved && object.kind !== 'shop') continue;
      if (object.kind === 'rock') drawRock(object);
      else if (object.kind === 'bonus') drawBonus(object, time);
      else if (object.kind === 'shop') drawShop(object);
    }
  }

  function crackPoint(impact, length, angle) {
    return {
      x: impact.x * viewW + Math.cos(angle) * length,
      y: impact.y * viewH + Math.sin(angle) * length
    };
  }

  function drawCrack(impact, time) {
    const x = impact.x * viewW;
    const y = impact.y * viewH;
    const age = clamp((game.activeMs - impact.bornAt) / 260, 0, 1);
    const severity = impact.severity;
    const branchCount = Math.round(5 + severity / 4);
    const maxLength = (20 + severity * 2.15) * age * (viewW < 600 ? .7 : 1);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255,255,255,.36)';
    ctx.shadowBlur = 3;
    for (let branch = 0; branch < branchCount; branch += 1) {
      const baseAngle = branch / branchCount * Math.PI * 2 +
        Math.sin(impact.seed * 1.7 + branch * 4.1) * .24;
      const length = maxLength * (.48 + Math.abs(Math.sin(impact.seed + branch * 2.7)) * .55);
      const segments = 4 + Math.floor(severity / 10);
      let previousX = x;
      let previousY = y;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let segment = 1; segment <= segments; segment += 1) {
        const progress = segment / segments;
        const wobble = Math.sin(impact.seed * 3.2 + branch * 6 + segment * 2.3) * .16;
        const point = crackPoint(impact, length * progress, baseAngle + wobble);
        ctx.lineTo(point.x, point.y);

        if (segment > 1 && segment < segments && (segment + branch) % 3 === 0) {
          const side = .35 * (branch % 2 ? 1 : -1);
          ctx.moveTo(point.x, point.y);
          ctx.lineTo(
            point.x + Math.cos(baseAngle + side) * length * .14,
            point.y + Math.sin(baseAngle + side) * length * .14
          );
          ctx.moveTo(point.x, point.y);
        }
        previousX = point.x;
        previousY = point.y;
      }
      const gradient = ctx.createLinearGradient(x, y, previousX, previousY);
      gradient.addColorStop(0, 'rgba(255,255,255,.94)');
      gradient.addColorStop(.62, 'rgba(220,239,249,.78)');
      gradient.addColorStop(1, 'rgba(190,220,235,.08)');
      ctx.strokeStyle = gradient;
      ctx.lineWidth = branch % 3 === 0 ? 1.25 : .72;
      ctx.stroke();
    }

    ctx.shadowBlur = 7;
    ctx.fillStyle = 'rgba(238,248,255,.93)';
    ctx.beginPath();
    ctx.arc(x, y, 2.2 + severity * .045, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawGlass(time) {
    const reflection = ctx.createLinearGradient(0, 0, viewW, viewH);
    reflection.addColorStop(0, 'rgba(255,255,255,.04)');
    reflection.addColorStop(.35, 'rgba(255,255,255,0)');
    reflection.addColorStop(.7, 'rgba(135,210,238,.035)');
    reflection.addColorStop(1, 'rgba(255,255,255,.02)');
    ctx.fillStyle = reflection;
    ctx.fillRect(0, 0, viewW, viewH * .82);

    for (const impact of game.impacts) drawCrack(impact, time);

    if (game.shield > 0) {
      ctx.strokeStyle = 'rgba(120,153,255,.5)';
      ctx.lineWidth = 5;
      ctx.shadowColor = '#7899ff';
      ctx.shadowBlur = 16;
      roundedRect(ctx, 12, 10, viewW - 24, viewH * .78, 28);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (game.damage > 55) {
      const alpha = clamp((game.damage - 55) / 55, 0, .72);
      const vignette = ctx.createRadialGradient(
        viewW * .5, viewH * .38, viewW * .12,
        viewW * .5, viewH * .38, viewW * .72
      );
      vignette.addColorStop(0, 'rgba(80,0,12,0)');
      vignette.addColorStop(1, `rgba(105,0,18,${alpha})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    if (game.impactFlash > .01) {
      ctx.fillStyle = `rgba(255,244,235,${game.impactFlash * .32})`;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    if (game.glassSwap > .01) {
      const sweepX = lerp(-viewW * .3, viewW * 1.25, 1 - game.glassSwap);
      const sweep = ctx.createLinearGradient(sweepX - viewW * .18, 0, sweepX + viewW * .18, 0);
      sweep.addColorStop(0, 'rgba(109,225,255,0)');
      sweep.addColorStop(.5, `rgba(210,249,255,${game.glassSwap * .68})`);
      sweep.addColorStop(1, 'rgba(109,225,255,0)');
      ctx.fillStyle = sweep;
      ctx.fillRect(0, 0, viewW, viewH * .83);
    }
  }

  function drawCockpit(time) {
    const mobile = viewW < 600;
    const dashboardTop = viewH * (mobile ? .82 : .79);

    const leftPillar = ctx.createLinearGradient(0, 0, viewW * .16, 0);
    leftPillar.addColorStop(0, '#070b11');
    leftPillar.addColorStop(1, '#1c2631');
    ctx.fillStyle = leftPillar;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(viewW * .075, 0);
    ctx.lineTo(viewW * .2, dashboardTop);
    ctx.lineTo(0, viewH);
    ctx.closePath();
    ctx.fill();

    const rightPillar = ctx.createLinearGradient(viewW, 0, viewW * .84, 0);
    rightPillar.addColorStop(0, '#070b11');
    rightPillar.addColorStop(1, '#1c2631');
    ctx.fillStyle = rightPillar;
    ctx.beginPath();
    ctx.moveTo(viewW, 0);
    ctx.lineTo(viewW * .925, 0);
    ctx.lineTo(viewW * .8, dashboardTop);
    ctx.lineTo(viewW, viewH);
    ctx.closePath();
    ctx.fill();

    const dash = ctx.createLinearGradient(0, dashboardTop, 0, viewH);
    dash.addColorStop(0, '#25313c');
    dash.addColorStop(.16, '#111922');
    dash.addColorStop(1, '#05080d');
    ctx.fillStyle = dash;
    ctx.beginPath();
    ctx.moveTo(0, dashboardTop + viewH * .03);
    ctx.quadraticCurveTo(viewW * .5, dashboardTop - viewH * .055, viewW, dashboardTop + viewH * .03);
    ctx.lineTo(viewW, viewH);
    ctx.lineTo(0, viewH);
    ctx.closePath();
    ctx.fill();

    const mirrorW = viewW * (mobile ? .27 : .19);
    const mirrorH = mirrorW * .25;
    ctx.fillStyle = '#05080c';
    roundedRect(ctx, viewW * .5 - mirrorW * .5, viewH * .04, mirrorW, mirrorH, mirrorH * .22);
    ctx.fill();
    const mirror = ctx.createLinearGradient(0, viewH * .04, 0, viewH * .04 + mirrorH);
    mirror.addColorStop(0, '#6f8796');
    mirror.addColorStop(1, '#314654');
    ctx.fillStyle = mirror;
    roundedRect(ctx, viewW * .5 - mirrorW * .44, viewH * .047, mirrorW * .88, mirrorH * .72, mirrorH * .16);
    ctx.fill();

    const wheelX = viewW * (mobile ? .5 : .34);
    const wheelY = viewH * (mobile ? .94 : .94);
    const wheelR = Math.min(viewW, viewH) * (mobile ? .16 : .18);
    ctx.save();
    ctx.translate(wheelX, wheelY);
    ctx.rotate(-game.laneVisual * .18);
    ctx.strokeStyle = '#080b10';
    ctx.lineWidth = wheelR * .2;
    ctx.beginPath();
    ctx.arc(0, 0, wheelR, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.strokeStyle = '#2d3944';
    ctx.lineWidth = wheelR * .06;
    ctx.beginPath();
    ctx.moveTo(-wheelR * .74, -wheelR * .08);
    ctx.lineTo(0, wheelR * .24);
    ctx.lineTo(wheelR * .74, -wheelR * .08);
    ctx.stroke();
    ctx.fillStyle = '#121a22';
    ctx.beginPath();
    ctx.arc(0, wheelR * .16, wheelR * .28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ef263f';
    ctx.fillRect(-wheelR * .09, wheelR * .1, wheelR * .18, wheelR * .035);
    ctx.restore();

    if (!mobile) {
      const clusterX = viewW * .59;
      const clusterY = dashboardTop + viewH * .09;
      ctx.fillStyle = '#05090e';
      roundedRect(ctx, clusterX - 64, clusterY - 28, 128, 48, 12);
      ctx.fill();
      ctx.fillStyle = '#6de1ff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 17px Inter, sans-serif';
      ctx.fillText(Math.round(game.speedKph) + ' km/h', clusterX, clusterY - 2);
      ctx.fillStyle = '#8299ac';
      ctx.font = '700 8px Inter, sans-serif';
      ctx.fillText(formatDuration(game.activeMs, false), clusterX, clusterY + 13);
    }
  }

  function drawParticles() {
    for (const particle of particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size * .72);
    }
    ctx.globalAlpha = 1;
  }

  function drawShatter(time) {
    if (game.status !== 'shattering') return;
    const pulse = .62 + Math.sin(time / 55) * .12;
    ctx.fillStyle = `rgba(226,245,255,${pulse * .22})`;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
    ctx.lineWidth = 1.2;
    const centerX = viewW * .5;
    const centerY = viewH * .42;
    for (let ring = 0; ring < 4; ring += 1) {
      const radius = (ring + 1) * Math.min(viewW, viewH) * .16;
      for (let index = 0; index < 11; index += 1) {
        const angle = index / 11 * Math.PI * 2 + ring * .18;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(
          centerX + Math.cos(angle) * radius,
          centerY + Math.sin(angle) * radius * .72
        );
        ctx.stroke();
      }
    }
  }

  function drawFrame(time) {
    ctx.save();
    const shakeX = game.shake > .2 ? random(-game.shake, game.shake) : 0;
    const shakeY = game.shake > .2 ? random(-game.shake * .6, game.shake * .6) : 0;
    ctx.translate(shakeX, shakeY);
    drawSky(time);
    drawRoad(time);
    drawObjects(time);
    drawGlass(time);
    drawCockpit(time);
    drawParticles();
    drawShatter(time);
    ctx.restore();
  }

  function damageState() {
    if (game.damage >= 85) {
      return {
        label: 'Crítico',
        text: 'O próximo impacto pode partir o vidro. Procura uma ExpressGlass!'
      };
    }
    if (game.damage >= 60) {
      return {
        label: 'Muito danificado',
        text: 'A visibilidade está comprometida. Não arrisques demasiado.'
      };
    }
    if (game.damage >= 30) {
      return {
        label: 'Danificado',
        text: 'As fissuras estão a acumular. Prepara uma reparação.'
      };
    }
    if (game.damage > 0) {
      return {
        label: 'Impacto ligeiro',
        text: 'Ainda podes continuar, mas uma nova pedra vai agravar o dano.'
      };
    }
    return {
      label: 'Impecável',
      text: 'Sem impactos. Mantém os olhos na estrada.'
    };
  }

  function updateImpactDots() {
    const expected = Math.min(game.hits, 12);
    if (els.impactDots.children.length === expected) return;
    els.impactDots.replaceChildren();
    for (let index = 0; index < expected; index += 1) {
      els.impactDots.appendChild(document.createElement('i'));
    }
  }

  function updateHud(force) {
    const now = performance.now();
    if (!force && now - lastHud < 70) return;
    lastHud = now;

    const state = damageState();
    els.mobileTimer.textContent = formatDuration(game.activeMs);
    els.distance.textContent = game.distanceM < 1000
      ? Math.round(game.distanceM) + ' m'
      : (game.distanceM / 1000).toFixed(2).replace('.', ',') + ' km';
    els.speed.textContent = Math.round(game.speedKph) + ' km/h';
    els.credits.textContent = formatNumber(game.credits);
    els.combo.textContent = '×' + game.combo;
    els.dodged.textContent = formatNumber(game.dodged);
    els.hits.textContent = formatNumber(game.hits);
    els.damageLabel.textContent = state.label;
    els.damagePercent.textContent = Math.round(game.damage) + '%';
    els.damageBar.style.width = game.damage + '%';
    els.damageText.textContent = state.text;
    els.glassCard.classList.toggle('is-warning', game.damage >= 30 && game.damage < 75);
    els.glassCard.classList.toggle('is-danger', game.damage >= 75);
    els.damageWarning.classList.toggle('is-visible', game.damage >= 82 && game.status === 'playing');
    updateImpactDots();

    els.glassBonusCount.textContent = String(game.glassBonuses);
    els.useGlassBonusBtn.classList.toggle('is-ready', game.glassBonuses > 0);
    els.useGlassBonusBtn.disabled = game.glassBonuses < 1;

    els.shopPrompt.classList.toggle(
      'is-visible',
      game.shopAvailable && game.status === 'playing'
    );

    const doubleRemaining = Math.max(0, game.doubleUntil - game.activeMs);
    const slowRemaining = Math.max(0, game.slowUntil - game.activeMs);
    els.shieldPill.classList.toggle('is-visible', game.shield > 0);
    els.doublePill.classList.toggle('is-visible', doubleRemaining > 0);
    els.slowPill.classList.toggle('is-visible', slowRemaining > 0);
    els.shieldPill.querySelector('b').textContent = String(game.shield);
    els.doublePill.querySelector('b').textContent = Math.ceil(doubleRemaining / 1000) + 's';
    els.slowPill.querySelector('b').textContent = Math.ceil(slowRemaining / 1000) + 's';
  }

  function animationFrame(time) {
    try {
      const dt = Math.min(50, Math.max(0, time - lastFrame));
      lastFrame = time;
      updateGame(dt);
      updateParticles(dt);
      updateHud(false);
      const paintInterval = document.hidden ? 250 : game.status === 'playing' ? 16 : 33;
      if (time - lastPaint >= paintInterval) {
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

  function resetRun() {
    const sessionToken = game.sessionToken;
    const ranked = game.ranked;
    game = freshGame();
    game.status = 'countdown';
    game.sessionToken = sessionToken;
    game.ranked = ranked;
    particles.length = 0;
    pointer.down = false;
    els.startOverlay.classList.remove('is-visible');
    els.pauseOverlay.classList.remove('is-visible');
    els.shopOverlay.classList.remove('is-visible');
    els.endOverlay.classList.remove('is-visible');
    document.body.classList.remove('is-last-seconds');
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
      await wait(value === 'JÁ!' ? 430 : 560);
    }
    els.countdown.classList.remove('is-visible', 'is-popping');
  }

  async function startGame() {
    if (els.startBtn.disabled) return;
    sound.unlock();
    els.startBtn.disabled = true;
    els.startBtnText.textContent = 'A preparar a estrada…';

    if (demoMode) {
      game.sessionToken = null;
      game.ranked = false;
    } else {
      try {
        const session = await createServerSession();
        game.sessionToken = session.sessionToken;
        game.ranked = true;
      } catch (_) {
        game.sessionToken = null;
        game.ranked = false;
        toast('Sem ligação ao ranking. Esta viagem fica em modo treino.', 'warning');
      }
    }

    resetRun();
    document.body.classList.add('is-playing');
    await runCountdown();
    game.status = 'playing';
    game.activeMs = 0;
    game.spawnTimer = 1150;
    sound.play('go');
    updateHud(true);
    els.startBtn.disabled = false;
    els.startBtnText.textContent = 'Ligar o motor';
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

  function enterShop() {
    if (game.status !== 'playing' || !game.shopAvailable) return;
    game.status = 'shop';
    game.shopBusy = false;
    game.shopAvailable = false;
    const shop = game.objects.find(function (object) { return object.id === game.shopObjectId; });
    if (shop) shop.resolved = true;
    game.shopObjectId = null;
    pointer.down = false;
    sound.play('shop');
    refreshShop();
    els.shopOverlay.classList.add('is-visible');
  }

  function refreshShop() {
    const repair = Core.serviceQuote('repair', game.damage);
    const replace = Core.serviceQuote('replace', game.damage);
    els.shopDamageText.textContent =
      'Danos atuais: ' + Math.round(game.damage) + '% · Saldo: ' + formatNumber(game.credits) + ' EG';
    els.repairBtn.disabled = game.shopBusy || !repair.allowed || game.credits < repair.cost;
    els.replaceBtn.disabled = game.shopBusy || !replace.allowed || game.credits < replace.cost;
    els.repairBtn.title = !repair.allowed ? repair.reason :
      game.credits < repair.cost ? 'Pontos insuficientes' : '';
    els.replaceBtn.title = !replace.allowed ? replace.reason :
      game.credits < replace.cost ? 'Pontos insuficientes' : '';
  }

  function buyService(type) {
    if (game.status !== 'shop' || game.shopBusy) return;
    const result = Core.applyService({
      damage: game.damage,
      credits: game.credits
    }, type, false);
    if (!result.ok) {
      toast(result.reason, 'warning');
      return;
    }

    game.shopBusy = true;
    game.credits = result.credits;
    if (type === 'repair') {
      game.damage = result.damage;
      game.repairs += 1;
      softenCracks(.58);
      game.glassSwap = .38;
      sound.play('glass');
      showFlash('Reparação concluída', '−30% de danos');
    } else {
      game.replacements += 1;
      clearGlass();
      showFlash('Vidro substituído', 'Para-brisas como novo');
    }
    updateHud(true);
    refreshShop();
    setTimeout(exitShop, 520);
  }

  function exitShop() {
    if (game.status !== 'shop') return;
    els.shopOverlay.classList.remove('is-visible');
    game.shopBusy = false;
    game.status = 'playing';
    game.spawnTimer = Math.max(game.spawnTimer, 850);
    updateHud(true);
  }

  function runPayload() {
    return {
      durationMs: Math.round(game.activeMs),
      distanceM: Math.round(game.distanceM),
      dodged: game.dodged,
      hits: game.hits,
      repairs: game.repairs,
      replacements: game.replacements,
      bonuses: game.bonuses,
      maxCombo: game.maxCombo,
      endingDamage: Math.round(game.damage)
    };
  }

  async function endGame() {
    if (game.status === 'ended') return;
    game.status = 'ended';
    game.paused = false;
    pointer.down = false;
    document.body.classList.remove('is-playing', 'is-last-seconds');
    els.pauseOverlay.classList.remove('is-visible');
    els.shopOverlay.classList.remove('is-visible');
    els.finalTime.textContent = formatDuration(game.activeMs);
    els.finalDistance.textContent = game.distanceM < 1000
      ? Math.round(game.distanceM) + ' m'
      : (game.distanceM / 1000).toFixed(2).replace('.', ',') + ' km';
    els.finalDodged.textContent = formatNumber(game.dodged);
    els.finalCombo.textContent = '×' + game.maxCombo;
    els.endKicker.textContent = game.damage >= 100 ? 'O para-brisas cedeu' : 'Viagem terminada';
    els.endTitle.textContent = game.activeMs >= 120000 ? 'Lenda da estrada' :
      game.activeMs >= 60000 ? 'Grande resistência!' : 'Consegues ir mais longe?';
    els.saveStatus.textContent = game.ranked ? 'A validar resultado…' :
      'Modo treino · resultado não guardado';
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
          run: runPayload(),
          version: Core.VERSION
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Resultado recusado');
      if (!data.saved) {
        els.saveStatus.textContent = 'Viagem demasiado curta · resultado não registado';
        els.saveStatus.className = 'is-error';
      } else if (data.isNewBest) {
        els.saveStatus.textContent = 'Novo recorde pessoal!';
        els.saveStatus.className = 'is-saved';
        els.personalBest.textContent = formatDuration(data.personalBest);
        showFlash('Novo recorde!', formatDuration(data.personalBest));
      } else {
        els.saveStatus.textContent = 'Tempo confirmado no ranking';
        els.saveStatus.className = 'is-saved';
        els.personalBest.textContent = formatDuration(data.personalBest);
      }
    } catch (_) {
      els.saveStatus.textContent = 'Não foi possível guardar este resultado';
      els.saveStatus.className = 'is-error';
    }
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
        els.personalBest.textContent = data.me.allTimeBest
          ? formatDuration(data.me.allTimeBest) : '—';
        els.myBest.querySelector('strong').textContent = data.me.periodBest
          ? formatDuration(data.me.periodBest) : '—';
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
      empty.textContent = 'Ainda não existem tempos. Sê o primeiro a enfrentar a estrada!';
      els.rankList.appendChild(empty);
      return;
    }

    rows.forEach(function (row, index) {
      const item = document.createElement('div');
      item.className = 'rank-row';
      if (rankView === 'players' && currentUser && row.username === currentUser.username) {
        item.classList.add('is-me');
      }

      const position = document.createElement('span');
      position.className = 'rank-position';
      position.textContent = String(index + 1).padStart(2, '0');

      const name = document.createElement('span');
      name.className = 'rank-name';
      const strong = document.createElement('strong');
      const small = document.createElement('small');
      if (rankView === 'players') {
        strong.textContent = row.username || 'Condutor';
        small.textContent = row.portal_name || 'ExpressGlass';
      } else {
        strong.textContent = row.portal_name || 'Unidade ExpressGlass';
        small.textContent = (row.players || 0) + ' condutor(es) · melhor ' +
          formatDuration(row.top || 0);
      }
      name.append(strong, small);

      const value = document.createElement('span');
      value.className = 'rank-value';
      value.textContent = formatDuration(
        rankView === 'players' ? row.best : row.total
      );
      item.append(position, name, value);
      els.rankList.appendChild(item);
    });
  }

  function openRanking() {
    els.rankModal.classList.add('is-visible');
    loadRanking(rankPeriod, false);
  }

  function closeRanking() {
    els.rankModal.classList.remove('is-visible');
  }

  function handlePointerDown(event) {
    if (game.status !== 'playing' || game.paused) return;
    pointer.down = true;
    pointer.id = event.pointerId;
    pointer.startX = event.clientX;
    pointer.startY = event.clientY;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
  }

  function handlePointerMove(event) {
    if (!pointer.down || event.pointerId !== pointer.id) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  }

  function handlePointerUp(event) {
    if (!pointer.down || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    const rect = canvas.getBoundingClientRect();
    if (Math.abs(dx) > 34 && Math.abs(dx) > Math.abs(dy) * .7) {
      changeLane(dx > 0 ? 1 : -1);
    } else if (Math.hypot(dx, dy) < 20) {
      const localX = event.clientX - rect.left;
      if (localX < rect.width * .42) changeLane(-1);
      else if (localX > rect.width * .58) changeLane(1);
    }
    pointer.down = false;
    pointer.id = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
  }

  els.startBtn.addEventListener('click', startGame);
  els.againBtn.addEventListener('click', startGame);
  els.pauseBtn.addEventListener('click', function () { togglePause(); });
  els.resumeBtn.addEventListener('click', function () { togglePause(false); });
  els.soundBtn.addEventListener('click', function () {
    sound.setEnabled(!sound.enabled);
    syncSoundButton();
  });
  els.leftBtn.addEventListener('click', function () { changeLane(-1); });
  els.rightBtn.addEventListener('click', function () { changeLane(1); });
  els.useGlassBonusBtn.addEventListener('click', useGlassBonus);
  els.shopPrompt.addEventListener('click', enterShop);
  els.repairBtn.addEventListener('click', function () { buyService('repair'); });
  els.replaceBtn.addEventListener('click', function () { buyService('replace'); });
  els.continueBtn.addEventListener('click', exitShop);
  els.rankBtn.addEventListener('click', openRanking);
  els.endRankBtn.addEventListener('click', openRanking);
  els.closeRankBtn.addEventListener('click', closeRanking);
  els.rankModal.addEventListener('click', function (event) {
    if (event.target === els.rankModal) closeRanking();
  });

  els.periodTabs.addEventListener('click', function (event) {
    const button = event.target.closest('button[data-period]');
    if (!button) return;
    rankPeriod = button.dataset.period;
    els.periodTabs.querySelectorAll('button').forEach(function (node) {
      node.classList.toggle('is-active', node === button);
    });
    loadRanking(rankPeriod, false);
  });

  els.viewTabs.addEventListener('click', function (event) {
    const button = event.target.closest('button[data-view]');
    if (!button) return;
    rankView = button.dataset.view;
    els.viewTabs.querySelectorAll('button').forEach(function (node) {
      node.classList.toggle('is-active', node === button);
    });
    renderRanking();
  });

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);

  window.addEventListener('keydown', function (event) {
    const key = event.key.toLowerCase();
    if (key === 'arrowleft' || key === 'a') {
      event.preventDefault();
      changeLane(-1);
    } else if (key === 'arrowright' || key === 'd') {
      event.preventDefault();
      changeLane(1);
    } else if (event.code === 'Space') {
      event.preventDefault();
      useGlassBonus();
    } else if (key === 'p') {
      event.preventDefault();
      togglePause();
    } else if (event.key === 'Escape') {
      if (els.rankModal.classList.contains('is-visible')) closeRanking();
      else if (game.status === 'shop') exitShop();
      else togglePause();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && game.status === 'playing' && !game.paused) togglePause(true);
  });
  window.addEventListener('resize', resizeCanvas);

  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.__impactoTest = {
      start: function () {
        game = freshGame();
        game.status = 'playing';
        game.ranked = false;
        els.startOverlay.classList.remove('is-visible');
        document.body.classList.add('is-playing');
        updateHud(true);
      },
      advance: function (milliseconds) {
        let remaining = clamp(Number(milliseconds) || 0, 0, 180000);
        while (remaining > 0) {
          const step = Math.min(16, remaining);
          updateGame(step);
          updateParticles(step);
          remaining -= step;
        }
        updateHud(true);
      },
      state: function () {
        return {
          status: game.status,
          lane: game.lane,
          laneVisual: game.laneVisual,
          activeMs: game.activeMs,
          damage: game.damage,
          credits: game.credits,
          dodged: game.dodged,
          hits: game.hits,
          combo: game.combo,
          maxCombo: game.maxCombo,
          distanceM: game.distanceM,
          objects: game.objects.map(function (object) {
            return {
              id: object.id,
              kind: object.kind,
              lane: object.lane,
              size: object.size,
              bonus: object.bonus,
              z: object.z,
              resolved: object.resolved
            };
          }),
          glassBonuses: game.glassBonuses,
          shield: game.shield,
          doubleUntil: game.doubleUntil,
          slowUntil: game.slowUntil,
          shopAvailable: game.shopAvailable,
          frameError: lastFrameError
        };
      },
      lane: function (lane) {
        game.lane = clamp(Math.round(lane), -1, 1);
        game.laneVisual = game.lane;
      },
      rock: function (lane, size, z) {
        const object = createRock(clamp(Math.round(lane), -1, 1), size || 'small',
          typeof z === 'number' ? z : .91);
        game.objects.push(object);
        return object.id;
      },
      bonus: function (type, lane, z) {
        const object = createBonus(type, clamp(Math.round(lane), -1, 1),
          typeof z === 'number' ? z : .91);
        game.objects.push(object);
        return object.id;
      },
      setDamage: function (value) {
        game.damage = clamp(Number(value) || 0, 0, 100);
        updateHud(true);
      },
      setCredits: function (value) {
        game.credits = Math.max(0, Math.round(Number(value) || 0));
        updateHud(true);
      },
      giveGlass: function () {
        game.glassBonuses += 1;
        updateHud(true);
      },
      useGlass: useGlassBonus,
      openShop: function () {
        game.shopAvailable = true;
        enterShop();
      },
      service: buyService,
      payload: runPayload
    };
  }

  if (demoMode) {
    const label = els.liveBadge.querySelector('span:last-child');
    if (label) label.textContent = 'Teste Impacto V4';
  }

  syncSoundButton();
  resizeCanvas();
  updateHud(true);
  if (!demoMode) loadRanking('all', true);
  requestAnimationFrame(animationFrame);
})();
