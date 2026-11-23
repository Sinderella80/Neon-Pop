/* ==========================================================
   NEON POP — Game engine
   © 2026 by Rama. All rights reserved.
   ========================================================== */
(() => {
  'use strict';

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');

  const ui = {
    hud: $('hud'), score: $('score'), level: $('level'), lives: $('lives'), best: $('best'),
    progress: $('progress'),
    combo: $('combo'), comboMult: $('comboMult'), comboChain: $('comboChain'),
    status: $('status'), toast: $('toast'),
    menu: $('menu'), pause: $('pause'), over: $('over'),
    menuBest: $('menuBest'), howto: $('howto'),
    finalScore: $('finalScore'), finalLevel: $('finalLevel'), finalBest: $('finalBest'),
    finalPops: $('finalPops'), finalChain: $('finalChain'), newBest: $('newBest'),
    btnMute: $('btnMute'),
  };

  /* ---------- Constants ---------- */
  const TAU = Math.PI * 2;
  const MAX_LIVES = 5;
  const START_LIVES = 3;
  const FREEZE_TIME = 3;
  const COMBO_WINDOW = 1.3;
  const STORAGE_KEY = 'neonpop.best.rama';

  /* ---------- Helpers ---------- */
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = (n) => n.toLocaleString('en-US');

  function loadBest() {
    try { return parseInt(localStorage.getItem(STORAGE_KEY), 10) || 0; } catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(STORAGE_KEY, String(v)); } catch (e) { /* storage unavailable */ }
  }

  /* ---------- Canvas ---------- */
  let W = 0, H = 0, dpr = 1;
  let stars = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = Array.from({ length: Math.round((W * H) / 9000) + 40 }, () => ({
      x: rand(0, W), y: rand(0, H), r: rand(0.4, 1.8), s: rand(4, 22), t: rand(0, TAU),
    }));
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---------- Audio (WebAudio synth, no files needed) ---------- */
  let actx = null;
  let muted = false;

  function audio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
    }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }

  function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0, delay = 0) {
    if (muted) return;
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  const sfx = {
    pop(combo)  { tone(420 + Math.min(combo, 20) * 38, 0.14, 'sine', 0.14, 260); tone(900, 0.05, 'triangle', 0.05); },
    gold()      { [660, 880, 1100, 1320].forEach((f, i) => tone(f, 0.18, 'triangle', 0.1, 0, i * 0.06)); },
    bomb()      { tone(160, 0.45, 'sawtooth', 0.18, -110); tone(90, 0.5, 'square', 0.1, -50); },
    ice()       { [1400, 1100, 800].forEach((f, i) => tone(f, 0.25, 'sine', 0.09, 0, i * 0.07)); },
    heart()     { [523, 659, 784].forEach((f, i) => tone(f, 0.22, 'sine', 0.12, 0, i * 0.08)); },
    bad()       { tone(140, 0.3, 'sawtooth', 0.16, -60); },
    miss()      { tone(220, 0.22, 'square', 0.08, -120); },
    level()     { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.12, 0, i * 0.09)); },
    over()      { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.35, 'sawtooth', 0.12, -20, i * 0.18)); },
    click()     { tone(600, 0.06, 'triangle', 0.08); },
  };

  /* ---------- Bubble types ---------- */
  const TYPE_STYLE = {
    normal: { sat: 100, light: 60, icon: '' },
    golden: { hue: 46,  sat: 100, light: 58, icon: '★' },
    bomb:   { hue: 18,  sat: 100, light: 55, icon: '✹' },
    ice:    { hue: 190, sat: 100, light: 62, icon: '❄' },
    heart:  { hue: 345, sat: 100, light: 62, icon: '♥' },
    toxic:  { hue: 275, sat: 55,  light: 28, icon: '☠' },
  };

  /* ---------- Game state ---------- */
  let state = 'menu';            // 'menu' | 'playing' | 'paused' | 'over'
  let score = 0, level = 1, lives = START_LIVES;
  let best = loadBest();
  let pops = 0, popsInLevel = 0, topChain = 0;
  let combo = 0, comboTimer = 0;
  let spawnTimer = 0, frozen = 0, shake = 0, flash = 0, flashHue = 0;
  let time = 0;

  let bubbles = [], particles = [], rings = [], floaters = [];

  const popsNeeded = () => 10 + level * 3;
  const comboMult = () => Math.min(8, 1 + Math.floor(combo / 4));
  const speedMul = () => Math.min(3, 1 + (level - 1) * 0.12);
  const spawnEvery = () => Math.max(0.3, 1.0 - (level - 1) * 0.07);

  /* ---------- UI helpers ---------- */
  function renderLives() {
    ui.lives.textContent = '♥'.repeat(lives) + '♡'.repeat(Math.max(0, MAX_LIVES - lives));
  }
  function renderHud() {
    ui.score.textContent = fmt(score);
    ui.level.textContent = level;
    ui.best.textContent = fmt(Math.max(best, score));
    ui.progress.style.width = Math.min(100, (popsInLevel / popsNeeded()) * 100) + '%';
    renderLives();
  }
  function renderCombo() {
    const show = combo >= 2 && state === 'playing';
    ui.combo.hidden = !show;
    if (!show) return;
    ui.comboMult.textContent = 'x' + comboMult();
    ui.comboChain.textContent = combo + ' chain';
  }
  function bumpCombo() {
    ui.comboMult.classList.remove('bump');
    void ui.comboMult.offsetWidth;
    ui.comboMult.classList.add('bump');
  }
  let toastTimer = 0;
  function toast(text) {
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    ui.toast.classList.remove('show');
    void ui.toast.offsetWidth;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 1400);
  }
  function showScreen(name) {
    ['menu', 'pause', 'over'].forEach((n) => { ui[n].hidden = n !== name; });
  }
  function updateMuteIcon() { ui.btnMute.textContent = muted ? '🔇' : '🔊'; }

  /* ---------- Effects ---------- */
  function burst(x, y, hue, count, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(80, 340) * power;
      particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, max: rand(0.45, 0.95), size: rand(2, 5.5), hue: hue + rand(-25, 25),
      });
    }
  }
  function ring(x, y, hue, maxR) { rings.push({ x, y, r: 6, maxR, life: 0, hue }); }
  function floatText(x, y, text, hue = 50, big = false) {
    floaters.push({ x, y, text, hue, life: 0, big });
  }
  function doShake(v) { shake = Math.max(shake, v); }
  function doFlash(hue, v = 0.35) { flash = v; flashHue = hue; }

  /* ---------- Spawning ---------- */
  function pickType() {
    if (state === 'menu') return 'normal';
    const r = Math.random();
    let acc = 0;
    const table = [
      ['golden', 0.05],
      ['bomb',   level >= 2 ? 0.05 : 0],
      ['ice',    level >= 2 ? 0.04 : 0],
      ['heart',  lives < MAX_LIVES ? 0.03 : 0],
      ['toxic',  level >= 3 ? Math.min(0.14, 0.06 + level * 0.01) : 0],
    ];
    for (const [t, p] of table) {
      acc += p;
      if (r < acc) return t;
    }
    return 'normal';
  }

  function spawn() {
    const small = Math.min(W, H) < 600;
    const r = rand(26, 54) * (small ? 0.78 : 1);
    const type = pickType();
    const st = TYPE_STYLE[type];
    bubbles.push({
      type, r,
      baseX: rand(r + 10, W - r - 10),
      x: 0, y: H + r + 4,
      vy: rand(70, 125) * speedMul() * (type === 'golden' ? 1.25 : 1),
      wob: rand(0, TAU), wobAmp: rand(8, 34), wobSpd: rand(1, 2.4),
      hue: st.hue !== undefined ? st.hue : rand(0, 360),
      age: 0,
    });
  }

  /* ---------- Core actions ---------- */
  function addScore(base, x, y, hue) {
    const mult = comboMult();
    const gained = base * mult;
    score += gained;
    floatText(x, y, '+' + gained, hue, mult >= 4);
    if (score > best) best = score;
  }

  function loseLife(x, y) {
    lives -= 1;
    combo = 0; comboTimer = 0;
    doFlash(350, 0.4);
    doShake(14);
    sfx.bad();
    if (x !== undefined) floatText(x, y, '−1 ♥', 350, true);
    renderHud(); renderCombo();
    if (lives <= 0) gameOver();
  }

  function levelUp() {
    level += 1;
    popsInLevel = 0;
    if (lives < MAX_LIVES && level % 3 === 0) { lives += 1; }
    toast('Level ' + level);
    sfx.level();
    doFlash(180, 0.25);
    ring(W / 2, H / 2, 180, Math.max(W, H) * 0.6);
    renderHud();
  }

  function registerPop(b, countsForLevel = true) {
    pops += 1;
    if (countsForLevel) {
      popsInLevel += 1;
      if (popsInLevel >= popsNeeded()) levelUp();
    }
  }

  function bumpChain() {
    combo += 1;
    comboTimer = COMBO_WINDOW;
    if (combo > topChain) topChain = combo;
    if (combo % 4 === 0) bumpCombo();
  }

  function popBubble(b, viaBlast = false) {
    const i = bubbles.indexOf(b);
    if (i === -1) return;
    bubbles.splice(i, 1);

    const hue = b.hue;
    burst(b.x, b.y, hue, 22, 1);
    ring(b.x, b.y, hue, b.r * 2.2);

    switch (b.type) {
      case 'normal':
        bumpChain();
        addScore(10, b.x, b.y, hue);
        sfx.pop(combo);
        registerPop(b);
        break;

      case 'golden':
        bumpChain();
        addScore(50, b.x, b.y, 46);
        burst(b.x, b.y, 46, 40, 1.3);
        sfx.gold();
        registerPop(b);
        break;

      case 'bomb': {
        bumpChain();
        const radius = 170;
        sfx.bomb();
        doShake(18);
        doFlash(25, 0.3);
        ring(b.x, b.y, 25, radius);
        burst(b.x, b.y, 25, 60, 1.6);
        const victims = bubbles.filter((o) =>
          Math.hypot(o.x - b.x, o.y - b.y) <= radius + o.r && o.type !== 'toxic');
        victims.forEach((o) => {
          if (o.type === 'normal' || o.type === 'golden') {
            bumpChain();
            addScore(o.type === 'golden' ? 50 : 10, o.x, o.y, o.hue);
            registerPop(o);
          }
          // Power-ups caught in a blast are simply consumed.
          const idx = bubbles.indexOf(o);
          if (idx !== -1) bubbles.splice(idx, 1);
          burst(o.x, o.y, o.hue, 14, 1);
          ring(o.x, o.y, o.hue, o.r * 1.8);
        });
        addScore(20, b.x, b.y, 25);
        registerPop(b);
        break;
      }

      case 'ice':
        frozen = FREEZE_TIME;
        ui.status.hidden = false;
        sfx.ice();
        doFlash(190, 0.3);
        ring(b.x, b.y, 190, Math.max(W, H) * 0.5);
        floatText(b.x, b.y, 'FREEZE!', 190, true);
        break;

      case 'heart':
        if (lives < MAX_LIVES) lives += 1;
        sfx.heart();
        floatText(b.x, b.y, '+1 ♥', 345, true);
        doFlash(345, 0.25);
        break;

      case 'toxic':
        burst(b.x, b.y, 275, 40, 1.3);
        loseLife(b.x, b.y);
        break;
    }
    renderHud();
    renderCombo();
  }

  function hitTest(x, y) {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (Math.hypot(x - b.x, y - b.y) <= b.r + 8) return b;
    }
    return null;
  }

  /* ---------- Game flow ---------- */
  function resetWorld() {
    bubbles = []; particles = []; rings = []; floaters = [];
    score = 0; level = 1; lives = START_LIVES;
    pops = 0; popsInLevel = 0; topChain = 0;
    combo = 0; comboTimer = 0;
    spawnTimer = 0; frozen = 0; shake = 0; flash = 0;
    ui.status.hidden = true;
    ui.combo.hidden = true;
  }

  function startGame() {
    audio();
    resetWorld();
    state = 'playing';
    ui.hud.hidden = false;
    showScreen(null);
    renderHud();
    sfx.click();
    toast('Go!');
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    showScreen('pause');
    ui.combo.hidden = true;
  }
  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    showScreen(null);
    lastTs = performance.now();
    renderCombo();
  }
  function toMenu() {
    resetWorld();
    state = 'menu';
    ui.hud.hidden = true;
    ui.menuBest.textContent = fmt(best);
    showScreen('menu');
  }

  function gameOver() {
    state = 'over';
    const isNew = score > 0 && score >= best && score > loadBest();
    if (isNew) saveBest(score);
    best = Math.max(best, score);
    ui.finalScore.textContent = fmt(score);
    ui.finalLevel.textContent = level;
    ui.finalBest.textContent = fmt(best);
    ui.finalPops.textContent = fmt(pops);
    ui.finalChain.textContent = topChain;
    ui.newBest.hidden = !isNew;
    ui.combo.hidden = true;
    ui.status.hidden = true;
    sfx.over();
    setTimeout(() => { if (state === 'over') showScreen('over'); }, 700);
  }

  /* ---------- Update ---------- */
  function update(dt) {
    time += dt;
    const playing = state === 'playing';
    const slow = frozen > 0 ? 0.18 : 1;

    // Spawning
    spawnTimer -= dt * slow;
    const interval = playing ? spawnEvery() : 0.9;
    if (spawnTimer <= 0) {
      spawn();
      spawnTimer = interval * rand(0.7, 1.3);
    }

    // Timers
    if (playing) {
      if (frozen > 0) {
        frozen -= dt;
        if (frozen <= 0) { frozen = 0; ui.status.hidden = true; }
      }
      if (combo > 0) {
        comboTimer -= dt;
        if (comboTimer <= 0) { combo = 0; renderCombo(); }
      }
    }

    // Bubbles
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.age += dt;
      b.y -= b.vy * dt * slow;
      b.wob += b.wobSpd * dt * slow;
      b.x = clamp(b.baseX + Math.sin(b.wob) * b.wobAmp, b.r, W - b.r);

      if (b.y < -b.r - 6) {
        bubbles.splice(i, 1);
        if (playing && (b.type === 'normal' || b.type === 'golden')) {
          sfx.miss();
          loseLife(clamp(b.x, 40, W - 40), 90);
        }
      }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.max) { particles.splice(i, 1); continue; }
      p.vx *= 0.985; p.vy = p.vy * 0.985 + 220 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life += dt;
      if (r.life >= 0.6) { rings.splice(i, 1); continue; }
      r.r = 6 + (r.maxR - 6) * (r.life / 0.6);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life += dt;
      if (f.life >= 1) floaters.splice(i, 1);
    }

    shake = Math.max(0, shake - dt * 40);
    flash = Math.max(0, flash - dt * 1.2);
  }

  /* ---------- Render ---------- */
  function drawBackground() {
    const h1 = (time * 6) % 360;
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, `hsl(${(260 + h1) % 360}, 80%, 8%)`);
    g.addColorStop(0.55, `hsl(${(285 + h1) % 360}, 75%, 11%)`);
    g.addColorStop(1, `hsl(${(215 + h1) % 360}, 80%, 7%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Aurora blobs
    for (let i = 0; i < 3; i++) {
      const cx = W * (0.2 + 0.3 * i) + Math.sin(time * 0.3 + i * 2) * W * 0.12;
      const cy = H * (0.3 + 0.2 * i) + Math.cos(time * 0.25 + i) * H * 0.1;
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.45);
      rg.addColorStop(0, `hsla(${(300 + i * 70 + h1) % 360}, 100%, 55%, 0.10)`);
      rg.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }

    // Stars (drift upward, twinkle)
    const slow = frozen > 0 ? 0.2 : 1;
    for (const s of stars) {
      s.y -= s.s * 0.016 * slow;
      if (s.y < -2) { s.y = H + 2; s.x = rand(0, W); }
      const tw = 0.5 + 0.5 * Math.sin(time * 2 + s.t);
      ctx.fillStyle = `rgba(255,255,255,${0.25 + tw * 0.6})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
  }

  function drawBubble(b) {
    const st = TYPE_STYLE[b.type];
    const pulse = b.type === 'golden' ? 1 + Math.sin(b.age * 8) * 0.06 : 1;
    const r = b.r * pulse;
    const h = b.hue, s = st.sat, l = st.light;

    ctx.save();
    ctx.shadowColor = `hsla(${h}, 100%, 60%, 0.9)`;
    ctx.shadowBlur = b.type === 'toxic' ? 14 : 24;

    const g = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.35, r * 0.1, b.x, b.y, r);
    g.addColorStop(0, `hsla(${h}, 100%, 88%, 0.95)`);
    g.addColorStop(0.55, `hsla(${h}, ${s}%, ${l}%, 0.55)`);
    g.addColorStop(1, `hsla(${h}, ${s}%, ${Math.max(10, l - 18)}%, 0.88)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, TAU);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = frozen > 0 ? 'rgba(160, 245, 255, 0.95)' : `hsla(${h}, 100%, 80%, 0.9)`;
    ctx.stroke();

    // Glossy highlight
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(b.x - r * 0.36, b.y - r * 0.4, r * 0.22, r * 0.12, -0.6, 0, TAU);
    ctx.fill();

    // Special icon
    if (st.icon) {
      ctx.font = `${Math.round(r * 0.95)}px "Segoe UI Symbol", "Apple Symbols", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = b.type === 'toxic' ? '#e6c8ff' : 'rgba(255,255,255,0.95)';
      ctx.shadowColor = `hsla(${h}, 100%, 60%, 1)`;
      ctx.shadowBlur = 10;
      ctx.fillText(st.icon, b.x, b.y + r * 0.04);
    }
    ctx.restore();
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake) * 0.5, rand(-shake, shake) * 0.5);

    drawBackground();

    // Rings
    for (const r of rings) {
      const a = 1 - r.life / 0.6;
      ctx.strokeStyle = `hsla(${r.hue}, 100%, 70%, ${a * 0.8})`;
      ctx.lineWidth = 3 * a + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.stroke();
    }

    for (const b of bubbles) drawBubble(b);

    // Particles (additive glow)
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      const a = 1 - p.life / p.max;
      ctx.fillStyle = `hsla(${p.hue}, 100%, 62%, ${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Floating texts
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floaters) {
      const a = 1 - f.life;
      const size = f.big ? 30 : 22;
      ctx.font = `800 ${size}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = `hsla(${f.hue}, 100%, 70%, ${a})`;
      ctx.shadowColor = `hsla(${f.hue}, 100%, 60%, ${a})`;
      ctx.shadowBlur = 14;
      ctx.fillText(f.text, f.x, f.y - f.life * 70);
    }
    ctx.shadowBlur = 0;

    // Freeze tint
    if (frozen > 0) {
      ctx.fillStyle = `rgba(80, 220, 255, ${0.08 + Math.sin(time * 6) * 0.02})`;
      ctx.fillRect(0, 0, W, H);
    }
    // Hit flash
    if (flash > 0) {
      ctx.fillStyle = `hsla(${flashHue}, 100%, 60%, ${flash * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  /* ---------- Main loop ---------- */
  let lastTs = performance.now();
  function frame(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (state === 'playing' || state === 'menu' || state === 'over') update(dt);
    render();
    requestAnimationFrame(frame);
  }

  /* ---------- Input ---------- */
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    e.preventDefault();
    const b = hitTest(e.clientX, e.clientY);
    if (b) {
      popBubble(b);
    } else {
      // Tiny feedback for a miss-tap
      ring(e.clientX, e.clientY, 220, 26);
    }
  });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'm') { muted = !muted; updateMuteIcon(); return; }
    if (k === 'p' || k === 'escape') {
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
      return;
    }
    if (k === 'enter' || k === ' ') {
      if (state === 'menu' || state === 'over') { e.preventDefault(); startGame(); }
      else if (state === 'paused') { e.preventDefault(); resumeGame(); }
    }
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  window.addEventListener('blur', pauseGame);

  $('btnPlay').addEventListener('click', startGame);
  $('btnAgain').addEventListener('click', startGame);
  $('btnHow').addEventListener('click', () => { ui.howto.hidden = !ui.howto.hidden; sfx.click(); });
  $('btnPause').addEventListener('click', pauseGame);
  $('btnResume').addEventListener('click', resumeGame);
  $('btnRestart').addEventListener('click', startGame);
  $('btnQuit').addEventListener('click', toMenu);
  $('btnMenu').addEventListener('click', toMenu);
  ui.btnMute.addEventListener('click', () => { muted = !muted; updateMuteIcon(); });

  /* ---------- Boot ---------- */
  ui.menuBest.textContent = fmt(best);
  updateMuteIcon();
  console.log('%cNEON POP%c © 2026 by Rama', 'color:#ff2fd6;font-weight:900;font-size:18px', 'color:#19f0ff');
  requestAnimationFrame(frame);
})();
