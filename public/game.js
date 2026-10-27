const { T, COLS, ROWS, LEVELS, buildGrid } = GAME;
const W = COLS * T;
const H = ROWS * T;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

// ---------- Física ----------
const GRAVITY = 2000;
const RUN = 250;
const JUMP = 760;
const SPRING = 1300;
const PW = 26; // largura do Tubby
const PH = 34; // altura do Tubby

const COLORS = {
  fundo: '#15111f', bloco: '#2f2748', borda: '#f2e6c9', espinho: '#ff6b6b',
  porta: '#ffd166', chave: '#ffd166', mola: '#7bdff2', inversor: '#b388ff', texto: '#f2e6c9',
};

let myId = null;
let me = null; // { name, color, ant }
let lvl = 0;
let world = null; // estado da fase atual
let others = []; // jogadores vindos do servidor
let startedAt = 0;
let clockOffset = 0;
let finished = false;
let myDeaths = 0;
const shown = new Map();
const deathMarks = []; // onde outros jogadores morreram na minha fase
const revealed = new Set(); // blocos invisíveis já descobertos ("lvl:x:y")
const keys = {};

// ---------- Som (sintetizado, sem arquivos) ----------
let muted = false;
try { muted = localStorage.getItem('tubby-mudo') === '1'; } catch {}
let audio = null;
function sfx(name) {
  if (muted) return;
  try {
    audio = audio || new AudioContext();
    if (audio.state === 'suspended') audio.resume();
  } catch { return; }
  const now = audio.currentTime;
  const tone = (type, f1, f2, dur, vol = 0.15, at = 0) => {
    const o = audio.createOscillator();
    const v = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, now + at);
    o.frequency.exponentialRampToValueAtTime(f2, now + at + dur);
    v.gain.setValueAtTime(vol, now + at);
    v.gain.exponentialRampToValueAtTime(0.001, now + at + dur);
    o.connect(v).connect(audio.destination);
    o.start(now + at);
    o.stop(now + at + dur);
  };
  const noise = (dur, vol, freq) => {
    const buf = audio.createBuffer(1, audio.sampleRate * dur, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = audio.createBufferSource();
    const f = audio.createBiquadFilter();
    const v = audio.createGain();
    src.buffer = buf;
    f.type = 'lowpass';
    f.frequency.value = freq;
    v.gain.setValueAtTime(vol, now);
    v.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(f).connect(v).connect(audio.destination);
    src.start(now);
  };
  if (name === 'pulo') tone('triangle', 500, 900, 0.09, 0.08);
  if (name === 'mola') tone('sine', 260, 1100, 0.25, 0.18);
  if (name === 'morte') { tone('triangle', 600, 120, 0.35, 0.12); tone('sine', 300, 80, 0.35, 0.08, 0.05); }
  if (name === 'espinho') tone('triangle', 1400, 900, 0.07, 0.06);
  if (name === 'desaba') noise(0.35, 0.25, 400);
  if (name === 'tiro') { noise(0.25, 0.35, 700); tone('sine', 120, 40, 0.25, 0.25); }
  if (name === 'fase') [523, 659, 784].forEach((f, i) => tone('triangle', f, f, 0.14, 0.12, i * 0.09));
  if (name === 'zerou') [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.22, 0.14, i * 0.12));
}

// Musiquinha de fundo: caixinha de música em Dó maior, em loop
// (números = semitons acima do Dó; null = pausa)
const MELODY = [
  0, null, 4, null, 7, null, 4, null, 9, null, 7, null, 4, null, 2, null,
  0, null, 4, null, 7, null, 12, null, 11, null, 7, null, 9, null, null, null,
  5, null, 9, null, 12, null, 9, null, 7, null, 4, null, 2, null, 4, null,
  0, null, 2, null, 4, null, 7, null, 4, null, 2, null, 0, null, null, null,
];
const BASS = [0, -3, 0, 7, 5, 0, 7, 0]; // um acorde a cada 8 passos
const STEP = 0.14;
let musicTimer = null;
let musicStep = 0;
let musicNext = 0;

function startMusic() {
  if (muted || musicTimer || !me) return;
  try {
    audio = audio || new AudioContext();
    if (audio.state === 'suspended') audio.resume();
  } catch { return; }
  musicNext = audio.currentTime + 0.05;
  musicTimer = setInterval(scheduleMusic, 50);
}

function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
}

function playNote(freq, at, type, vol, dur) {
  const o = audio.createOscillator();
  const v = audio.createGain();
  o.type = type;
  o.frequency.value = freq;
  v.gain.setValueAtTime(0.0001, at);
  v.gain.exponentialRampToValueAtTime(vol, at + 0.01);
  v.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(v).connect(audio.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

function scheduleMusic() {
  while (musicNext < audio.currentTime + 0.25) {
    const i = musicStep % MELODY.length;
    const n = MELODY[i];
    if (n !== null) playNote(523.25 * 2 ** (n / 12), musicNext, 'triangle', 0.035, 0.22);
    if (i % 4 === 0) playNote(130.81 * 2 ** (BASS[Math.floor(i / 8) % BASS.length] / 12), musicNext, 'sine', 0.05, 0.3);
    musicNext += STEP;
    musicStep++;
  }
}

function syncMute() {
  const b = document.getElementById('mute');
  b.textContent = muted ? '🔇 Som desligado' : '🔊 Som ligado';
  b.setAttribute('aria-pressed', String(muted));
}
function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('tubby-mudo', muted ? '1' : '0'); } catch {}
  syncMute();
  if (muted) stopMusic(); else startMusic();
}

// ---------- Montagem da fase ----------
function loadLevel(n) {
  const level = LEVELS[n];
  const grid = buildGrid(level);
  const ents = [];
  let spawn = { x: 1, y: 13 };
  const add = (e) => ents.push({
    w: 1, h: 1, ...e,
    x: e.x * T, y: e.y * T, w: (e.w || 1) * T, h: (e.h || 1) * T,
    vy: 0, state: 'idle', timer: 0,
  });
  const fixSpring = () => ents.forEach((e) => { if (e.k === 'spring' && e.h === T) { e.y += T - 14; e.h = 14; } });

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const ch = grid[y][x];
      if (ch === 'S') spawn = { x, y };
      else if (ch === '^') add({ k: 'spike', dir: 'up', x, y });
      else if (ch === 'v') add({ k: 'spike', dir: 'down', x, y });
      else if (ch === 'D') add({ k: 'door', x, y: y - 1, h: 2 });
      else if (ch === 'K') add({ k: 'key', x, y });
      else if (ch === 'J') add({ k: 'spring', x, y });
      else if (ch === 'C') add({ k: 'crumble', x, y });
      else if (ch === '?') add({ k: 'secret', x, y, seen: revealed.has(`${n}:${x}:${y}`) });
      else if (ch === 'B') add({ k: 'secret', x, y, breaks: 1, seen: revealed.has(`${n}:${x}:${y}`) });
      else if (ch === 'F') add({ k: 'fake', x, y });
      else if (ch === 'G') add({ k: 'flip', x, y });
      if (ch !== '#') grid[y][x] = '.';
    }
  }
  for (const e of level.ents) add({ ...e });
  fixSpring();

  const hasKey = ents.some((e) => e.k === 'key');
  world = {
    n, grid, ents, hasKey, gotKey: false,
    triggers: level.triggers.map((t) => ({ ...t, fired: false, wait: -1 })),
    p: {
      x: spawn.x * T + (T - PW) / 2, y: (spawn.y + 1) * T - PH,
      vx: 0, vy: 0, g: 1, ground: false, face: 1, coyote: 0, buffer: 0, inFlip: false,
      dead: 0, walk: 0,
    },
    banner: 1.8,
  };
}

function tileSolid(tx, ty) {
  if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) return false;
  return world.grid[ty][tx] === '#';
}

function isSolid(e) {
  if (e.hidden) return false;
  if (e.k === 'block') return true;
  if (e.k === 'secret') return e.state !== 'falling';
  if (e.k === 'crumble') return e.state !== 'falling';
  if (e.k === 'crusher') return e.state !== 'falling';
  return false;
}

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Retângulos sólidos perto do jogador: blocos do mapa + objetos sólidos
function solidsNear(box) {
  const out = [];
  const x1 = Math.floor(box.x / T) - 1, x2 = Math.floor((box.x + box.w) / T) + 1;
  const y1 = Math.floor(box.y / T) - 1, y2 = Math.floor((box.y + box.h) / T) + 1;
  for (let ty = y1; ty <= y2; ty++) {
    for (let tx = x1; tx <= x2; tx++) if (tileSolid(tx, ty)) out.push({ x: tx * T, y: ty * T, w: T, h: T });
  }
  for (const e of world.ents) if (isSolid(e)) out.push(e);
  return out;
}

// ---------- Armadilhas ----------
function runTriggers(dt) {
  const p = world.p;
  const cx = (p.x + PW / 2) / T;
  const cy = (p.y + PH / 2) / T;
  world.triggers.forEach((t) => {
    if (t.fired) return;
    if (t.req !== undefined && !world.triggers[t.req].fired) return;
    const [x1, y1, x2, y2] = t.zone;
    if (t.wait < 0 && cx >= x1 && cx < x2 + 1 && cy >= y1 && cy < y2 + 1) t.wait = t.delay || 0;
    if (t.wait >= 0) {
      t.wait -= dt;
      if (t.wait <= 0) { t.fired = true; fire(t); }
    }
  });
}

function fire(t) {
  const e = world.ents.find((en) => en.id === t.target);
  if (!e) return;
  if (t.do === 'fall') { e.state = 'falling'; e.vy = 0; }
  if (t.do === 'show') { e.hidden = false; e.pop = 0; if (e.k === 'cannon') e.timer = e.first || 0; else if (e.k === 'spike') sfx('espinho'); }
  if (t.do === 'hide') { e.hidden = true; sfx('desaba'); }
  if (t.do === 'fall') sfx('desaba');
  if (t.do === 'move') { e.state = 'moving'; e.tx = t.to[0] * T; e.ty = t.to[1] * T; e.speed = t.speed; }
}

function updateEntities(dt) {
  for (const e of [...world.ents]) {
    if (e.pop !== undefined && e.pop < 1) e.pop = Math.min(1, e.pop + dt * 8);
    if (e.k === 'cannon' && !e.hidden) {
      e.timer -= dt;
      if (e.timer <= 0) {
        e.timer = e.every || 1.4;
        const dir = e.dir || 1;
        world.ents.push({ k: 'ball', x: dir < 0 ? e.x - 24 : e.x + e.w, y: e.y + T / 2 - 12, w: 24, h: 24, vx: dir * (e.speed || 650), state: 'ball' });
        sfx('tiro');
      }
    }
    if (e.k === 'ball') {
      e.x += e.vx * dt;
      if (e.x > W + 40 || e.x < -40) e.hidden = true;
      continue;
    }
    if (e.state === 'falling') {
      e.vy += GRAVITY * dt;
      e.y += e.vy * dt;
      if (e.k === 'crusher') {
        const row = Math.floor((e.y + e.h) / T);
        for (let tx = Math.floor(e.x / T); tx < Math.ceil((e.x + e.w) / T); tx++) {
          if (tileSolid(tx, row)) { e.y = row * T - e.h; e.state = 'landed'; break; }
        }
        for (const o of world.ents) {
          if (e.state !== 'falling' || o === e || !isSolid(o) || !overlap(e, o)) continue;
          e.y = o.y - e.h; e.state = 'landed';
        }
      }
      if (e.y > H + 200) e.hidden = true;
    } else if (e.state === 'moving') {
      const dx = e.tx - e.x, dy = e.ty - e.y;
      const dist = Math.hypot(dx, dy);
      const step = e.speed * dt;
      if (dist <= step) { e.x = e.tx; e.y = e.ty; e.state = 'idle'; } else { e.x += (dx / dist) * step; e.y += (dy / dist) * step; }
    } else if (e.state === 'crumbling') {
      e.timer -= dt;
      if (e.timer <= 0) { e.state = 'falling'; e.vy = 0; }
    }
  }
}

// ---------- Jogador ----------
function hitbox(e) {
  // Espinhos têm caixa menor que o desenho, pra ser justo
  if (e.k === 'spike') {
    return e.dir === 'down'
      ? { x: e.x + 7, y: e.y, w: e.w - 14, h: e.h - 16 }
      : { x: e.x + 7, y: e.y + 16, w: e.w - 14, h: e.h - 16 };
  }
  if (e.k === 'saw') return { x: e.x + 8, y: e.y, w: e.w - 8, h: e.h };
  if (e.k === 'ball') return { x: e.x + 4, y: e.y + 4, w: e.w - 8, h: e.h - 8 };
  return e;
}

function updatePlayer(dt) {
  const p = world.p;
  if (p.dead > 0) {
    p.dead -= dt;
    if (p.dead <= 0) loadLevel(lvl);
    return;
  }

  const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  p.vx = dir * RUN;
  if (dir) p.face = dir;
  p.walk = dir && p.ground ? p.walk + dt * 12 : 0;

  p.coyote = p.ground ? 0.08 : p.coyote - dt;
  p.buffer -= dt;
  if (keys.jumpPressed) { p.buffer = 0.12; keys.jumpPressed = false; }
  if (p.buffer > 0 && p.coyote > 0) { p.vy = -JUMP * p.g; p.buffer = 0; p.coyote = 0; p.jumping = true; sfx('pulo'); }
  if (p.vy * p.g >= 0) p.jumping = false;
  if (p.jumping && !keys.jump && p.vy * p.g < -200) p.vy = -200 * p.g; // pulo curto se soltar o botão

  p.vy += GRAVITY * p.g * dt;
  p.vy = Math.max(-1400, Math.min(1400, p.vy));

  // eixo X
  p.x += p.vx * dt;
  p.x = Math.max(0, Math.min(W - PW, p.x));
  let box = { x: p.x, y: p.y, w: PW, h: PH };
  for (const s of solidsNear(box)) {
    if (!overlap(box, s)) continue;
    touch(s);
    p.x = p.vx > 0 ? s.x - PW : s.x + s.w;
    box.x = p.x;
  }

  // eixo Y
  p.y += p.vy * dt;
  p.ground = false;
  box = { x: p.x, y: p.y, w: PW, h: PH };
  for (const s of solidsNear(box)) {
    if (!overlap(box, s)) continue;
    touch(s);
    const towardFloor = p.vy * p.g > 0;
    p.y = p.vy > 0 ? s.y - PH : s.y + s.h;
    box.y = p.y;
    if (towardFloor) {
      p.ground = true;
      if (s.k === 'crumble' && s.state === 'idle') { s.state = 'crumbling'; s.timer = s.time ?? 0.15; }
    }
    p.vy = 0;
  }

  // objetos sem colisão: espinhos, portas, chave, gravidade
  box = { x: p.x, y: p.y, w: PW, h: PH };
  let inFlip = false;
  for (const e of world.ents) {
    if (e.hidden) continue;
    const deadly = e.k === 'spike' || e.k === 'saw' || e.k === 'ball' || (e.k === 'crusher' && e.state === 'falling');
    if (deadly && overlap(box, hitbox(e))) return die();
    if (!overlap(box, e)) continue;
    if (e.k === 'key') { e.hidden = true; world.gotKey = true; }
    if (e.k === 'spring' && p.vy * p.g >= 0) { p.vy = -SPRING * p.g; p.ground = false; p.jumping = false; e.boing = 0.25; sfx('mola'); }
    if (e.k === 'flip') inFlip = true;
    if (e.k === 'door' && !e.fake && (!world.hasKey || world.gotKey)) return nextLevel();
  }
  if (inFlip && !p.inFlip) { p.g *= -1; p.vy = 0; }
  p.inFlip = inFlip;

  if (p.y > H + 40 || p.y < -PH - 40) die();
}

function touch(s) {
  if (s.k === 'secret' && !s.seen) {
    s.seen = true;
    revealed.add(`${lvl}:${s.x / T}:${s.y / T}`);
  }
  if (s.k === 'secret' && s.breaks && s.state === 'idle') { s.state = 'crumbling'; s.timer = s.breaks; }
}

function die() {
  const p = world.p;
  if (p.dead > 0) return;
  p.dead = 0.6;
  myDeaths++;
  sfx('morte');
  burst(p.x + PW / 2, p.y + PH / 2, me.color);
  socket.emit('death', { lvl, x: p.x + PW / 2, y: p.y + PH / 2 });
}

function nextLevel() {
  socket.emit('level', { from: lvl });
  sfx(lvl + 1 >= LEVELS.length ? 'zerou' : 'fase');
  if (lvl + 1 >= LEVELS.length) {
    finished = true;
    return;
  }
  lvl++;
  loadLevel(lvl);
}

// ---------- Partículas ----------
const particles = [];
function burst(x, y, color) {
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 80 + Math.random() * 220;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, life: 0.7, color });
  }
}

// ---------- Desenho ----------
function drawTubby(c, x, y, color, ant, face, g, alpha, walk, name) {
  c.save();
  c.globalAlpha = alpha;
  c.translate(x + PW / 2, y + PH / 2);
  if (g < 0) c.scale(1, -1);
  const bob = Math.sin(walk) * 1.5;

  // pernas
  c.fillStyle = color;
  c.fillRect(-10, 10, 8, 7 + bob);
  c.fillRect(2, 10, 8, 7 - bob);
  // corpo
  c.beginPath();
  c.ellipse(0, 3, 15, 14, 0, 0, Math.PI * 2);
  c.fill();
  // braços
  c.beginPath();
  c.ellipse(-15, 4 + bob, 4, 6, 0.4, 0, Math.PI * 2);
  c.ellipse(15, 4 - bob, 4, 6, -0.4, 0, Math.PI * 2);
  c.fill();
  // cabeça
  c.beginPath();
  c.arc(0, -11, 11, 0, Math.PI * 2);
  c.fill();
  // antena
  c.strokeStyle = color;
  c.lineWidth = 3;
  c.lineCap = 'round';
  c.beginPath();
  if (ant === 'triangulo') {
    c.moveTo(0, -21); c.lineTo(0, -26); c.stroke();
    c.beginPath(); c.moveTo(-5, -26); c.lineTo(5, -26); c.lineTo(0, -34); c.closePath(); c.stroke();
  } else if (ant === 'circulo') {
    c.moveTo(0, -21); c.lineTo(0, -26); c.stroke();
    c.beginPath(); c.arc(0, -30, 4.5, 0, Math.PI * 2); c.stroke();
  } else if (ant === 'espiral') {
    c.moveTo(0, -21);
    c.bezierCurveTo(-8, -28, 6, -36, 3, -28);
    c.stroke();
  } else {
    c.moveTo(0, -21); c.lineTo(0, -33); c.stroke();
  }
  // rosto
  c.fillStyle = '#f6dcc4';
  c.beginPath();
  c.ellipse(face * 1.5, -10, 7.5, 6.5, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#2a1f2d';
  c.beginPath();
  c.arc(face * 1.5 - 3, -11, 1.4, 0, Math.PI * 2);
  c.arc(face * 1.5 + 3, -11, 1.4, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#2a1f2d';
  c.lineWidth = 1.2;
  c.beginPath();
  c.arc(face * 1.5, -8.5, 2.2, 0.15 * Math.PI, 0.85 * Math.PI);
  c.stroke();
  // telinha na barriga
  c.fillStyle = '#cfd6e4';
  c.strokeStyle = '#ffffff99';
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect(-6, 1, 12, 9, 2);
  c.fill();
  c.stroke();
  c.restore();

  if (name) {
    c.save();
    c.globalAlpha = alpha;
    c.font = '700 12px Nunito, system-ui';
    c.textAlign = 'center';
    c.fillStyle = COLORS.texto;
    c.fillText(name, x + PW / 2, g < 0 ? y + PH + 24 : y - 16);
    c.restore();
  }
}

function drawSpikes(e) {
  const scale = e.pop === undefined ? 1 : e.pop;
  ctx.fillStyle = COLORS.espinho;
  const n = Math.round(e.w / T) * 2;
  const sw = e.w / n;
  for (let i = 0; i < n; i++) {
    const x = e.x + i * sw;
    ctx.beginPath();
    if (e.dir === 'down') {
      ctx.moveTo(x, e.y); ctx.lineTo(x + sw, e.y); ctx.lineTo(x + sw / 2, e.y + e.h * 0.8 * scale);
    } else {
      ctx.moveTo(x, e.y + e.h); ctx.lineTo(x + sw, e.y + e.h); ctx.lineTo(x + sw / 2, e.y + e.h - e.h * 0.8 * scale);
    }
    ctx.fill();
  }
}

function drawBlock(x, y, w, h) {
  ctx.fillStyle = COLORS.bloco;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = COLORS.borda;
  ctx.fillRect(x, y, w, 4);
}

function drawWorld(time) {
  ctx.fillStyle = COLORS.fundo;
  ctx.fillRect(0, 0, W, H);

  // estrelinhas de fundo
  ctx.fillStyle = '#ffffff14';
  for (let i = 0; i < 60; i++) ctx.fillRect((i * 211) % W, (i * 97) % H, 2, 2);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (world.grid[y][x] !== '#') continue;
      ctx.fillStyle = COLORS.bloco;
      ctx.fillRect(x * T, y * T, T, T);
      if (!tileSolid(x, y - 1)) { ctx.fillStyle = COLORS.borda; ctx.fillRect(x * T, y * T, T, 4); }
    }
  }

  const ordered = [...world.ents.filter((e) => e.k !== 'fake'), ...world.ents.filter((e) => e.k === 'fake')];
  for (const e of ordered) {
    if (e.hidden) continue;
    if (e.k === 'crusher' && e.state === 'idle') {
      // parado no teto ele é idêntico ao teto: sem borda, sem dica
      ctx.fillStyle = COLORS.bloco;
      ctx.fillRect(e.x, e.y, e.w, e.h);
    } else if (e.k === 'block' || e.k === 'crusher' || e.k === 'fake') drawBlock(e.x, e.y, e.w, e.h);
    else if (e.k === 'crumble') {
      // igual ao chão normal; só treme quando já vai cair
      const shake = e.state === 'crumbling' ? (Math.random() - 0.5) * 4 : 0;
      drawBlock(e.x + shake, e.y, e.w, e.h);
    } else if (e.k === 'secret') {
      if (e.seen) {
        const shake = e.state === 'crumbling' ? (Math.random() - 0.5) * 4 : 0;
        drawBlock(e.x + shake, e.y, e.w, e.h);
        if (e.breaks && e.state !== 'idle') {
          ctx.strokeStyle = COLORS.fundo;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(e.x + 8 + shake, e.y + 6); ctx.lineTo(e.x + 20 + shake, e.y + 22); ctx.lineTo(e.x + 14 + shake, e.y + 34);
          ctx.moveTo(e.x + 20 + shake, e.y + 22); ctx.lineTo(e.x + 32 + shake, e.y + 16);
          ctx.stroke();
        }
      }
      else {
        // brilho sutil: dá a dica sem entregar
        const a = Math.max(0, Math.sin(time / 600 + e.x)) * 0.12;
        ctx.strokeStyle = `rgba(242, 230, 201, ${a})`;
        ctx.strokeRect(e.x + 4, e.y + 4, e.w - 8, e.h - 8);
      }
    } else if (e.k === 'spike') drawSpikes(e);
    else if (e.k === 'saw') {
      ctx.fillStyle = COLORS.espinho;
      ctx.fillRect(e.x - 400, e.y, 400 + e.w * 0.4, e.h);
      for (let y = e.y; y < e.y + e.h; y += 20) {
        ctx.beginPath(); ctx.moveTo(e.x + e.w * 0.4, y); ctx.lineTo(e.x + e.w, y + 10); ctx.lineTo(e.x + e.w * 0.4, y + 20); ctx.fill();
      }
    } else if (e.k === 'door') {
      const locked = world.hasKey && !world.gotKey;
      ctx.fillStyle = COLORS.porta;
      ctx.beginPath();
      ctx.roundRect(e.x + 4, e.y, e.w - 8, e.h, [14, 14, 0, 0]);
      ctx.fill();
      ctx.fillStyle = COLORS.fundo;
      ctx.beginPath();
      ctx.roundRect(e.x + 10, e.y + 8, e.w - 20, e.h - 8, [9, 9, 0, 0]);
      ctx.fill();
      if (locked) { ctx.fillStyle = COLORS.porta; ctx.fillRect(e.x + 15, e.y + 40, 10, 10); }
    } else if (e.k === 'key') {
      ctx.strokeStyle = COLORS.chave; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(e.x + 14, e.y + 20, 7, 0, Math.PI * 2); ctx.moveTo(e.x + 21, e.y + 20); ctx.lineTo(e.x + 34, e.y + 20); ctx.lineTo(e.x + 34, e.y + 27); ctx.stroke();
    } else if (e.k === 'spring') {
      const up = e.boing > 0 ? (e.boing -= 1 / 60, 8) : 0;
      ctx.fillStyle = COLORS.mola;
      ctx.fillRect(e.x + 2, e.y + e.h - 4, e.w - 4, 4);
      ctx.fillRect(e.x + 4, e.y - up, e.w - 8, 5);
      ctx.strokeStyle = COLORS.mola; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(e.x + 12, e.y + 5 - up); ctx.lineTo(e.x + 28, e.y + 8 - up / 2); ctx.lineTo(e.x + 12, e.y + e.h - 4); ctx.stroke();
    } else if (e.k === 'cannon') {
      ctx.fillStyle = '#4a4063';
      ctx.fillRect(e.x, e.y + 8, e.w, e.h - 16);
      ctx.fillStyle = '#0b0912';
      ctx.fillRect((e.dir || 1) < 0 ? e.x : e.x + e.w - 6, e.y + 12, 6, e.h - 24);
    } else if (e.k === 'ball') {
      ctx.fillStyle = '#0b0912';
      ctx.strokeStyle = COLORS.espinho;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x + 12, e.y + 12, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (e.k === 'flip') {
      ctx.fillStyle = `rgba(179, 136, 255, ${0.25 + Math.sin(time / 200) * 0.1})`;
      ctx.fillRect(e.x + 8, e.y, e.w - 16, e.h);
      ctx.fillStyle = COLORS.inversor;
      ctx.font = '700 20px Nunito, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('⇅', e.x + e.w / 2, e.y + 27);
    }
  }

  // onde os outros morreram nesta fase
  for (let i = deathMarks.length - 1; i >= 0; i--) {
    const m = deathMarks[i];
    m.life -= 1 / 60;
    if (m.life <= 0 || m.lvl !== lvl) { deathMarks.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, m.life);
    ctx.strokeStyle = m.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(m.x - 6, m.y - 6); ctx.lineTo(m.x + 6, m.y + 6); ctx.moveTo(m.x + 6, m.y - 6); ctx.lineTo(m.x - 6, m.y + 6); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;

  if (world && me) {
    if (!finished) {
      runTriggers(dt);
      updateEntities(dt);
      updatePlayer(dt);
    }
    drawWorld(now);

    for (const o of others) {
      if (o.id === myId || o.lvl !== lvl || o.done) continue;
      let s = shown.get(o.id);
      if (!s) shown.set(o.id, (s = { x: o.x, y: o.y }));
      s.x += (o.x - s.x) * 0.35;
      s.y += (o.y - s.y) * 0.35;
      drawTubby(ctx, s.x, s.y, o.color, o.ant, o.f, o.g, 0.45, 0, o.name);
    }

    const p = world.p;
    if (p.dead <= 0 && !finished) drawTubby(ctx, p.x, p.y, me.color, me.ant, p.face, p.g, 1, p.walk, null);

    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.life -= dt;
      if (q.life <= 0) { particles.splice(i, 1); continue; }
      q.vy += 900 * dt; q.x += q.vx * dt; q.y += q.vy * dt;
      ctx.globalAlpha = q.life / 0.7;
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x, q.y, 6, 6);
    }
    ctx.globalAlpha = 1;

    if (world.banner > 0) {
      world.banner -= dt;
      ctx.globalAlpha = Math.min(1, world.banner);
      ctx.fillStyle = COLORS.texto;
      ctx.textAlign = 'center';
      ctx.font = '400 22px "Rubik Mono One", system-ui';
      ctx.fillText(`FASE ${lvl + 1}`, W / 2, 110);
      ctx.font = '800 30px Nunito, system-ui';
      ctx.fillText(LEVELS[lvl].name, W / 2, 150);
      ctx.globalAlpha = 1;
    }
    renderHud();
  } else {
    ctx.fillStyle = COLORS.fundo;
    ctx.fillRect(0, 0, W, H);
  }
  requestAnimationFrame(frame);
}

// ---------- Controles ----------
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
};
addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === 'INPUT') return;
  const k = KEYMAP[e.code];
  if (k) {
    if (k === 'jump' && !keys.jump) keys.jumpPressed = true;
    keys[k] = true;
    e.preventDefault();
  }
  if (e.code === 'KeyR' && world && !finished) die();
  if (e.code === 'KeyM') toggleMute();
});
addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });

// ---------- Rede ----------
const socket = io();

socket.on('connect', () => { $('status').textContent = 'online'; $('status').classList.add('online'); });
socket.on('disconnect', () => { $('status').textContent = 'reconectando…'; $('status').classList.remove('online'); });
socket.on('connect', () => { if (me) socket.emit('join', { ...me, lvl, deaths: myDeaths }); });

socket.on('joined', (data) => {
  myId = data.id;
  startedAt = data.startedAt;
  clockOffset = data.now - Date.now();
});

// nome/cor/antena chegam só quando alguém entra ou sai
let roster = new Map();
socket.on('roster', (list) => {
  roster = new Map(list.map(([id, name, color, ant]) => [id, { name, color, ant }]));
});

// posições chegam compactas: [id, fase, x, y, direção, gravidade, mortes, zerou, tempo]
socket.on('state', (s) => {
  others = s.p.filter(([id]) => roster.has(id)).map(([id, lvl, x, y, f, g, deaths, done, time]) => ({
    id, ...roster.get(id), lvl, x, y, f, g, deaths, done: done === 1, time: done ? time : null,
  }));
  clockOffset = s.now - Date.now();
  renderPlayers();
});

socket.on('death', (d) => {
  if (d.id !== myId) deathMarks.push({ ...d, life: 3 });
});

socket.on('champion', (c) => {
  loadRanking();
  if (c.id === myId) showWin(c);
  else toast(`${c.name} zerou com ${c.deaths} morte${c.deaths === 1 ? '' : 's'}!`);
});

setInterval(() => {
  if (!world || finished || !myId) return;
  const p = world.p;
  socket.emit('pos', { lvl, x: Math.round(p.x), y: Math.round(p.y), f: p.face, g: p.g });
}, 66);

// ---------- Tela inicial ----------
const PALETTE = ['#9b59d0', '#7ac943', '#ffd23f', '#ff5a5f', '#4ec3f7', '#ff9f43', '#f78fb3', '#e8e8e8'];
const ANTENNAS = { reta: 'Reta', triangulo: 'Triângulo', circulo: 'Bolinha', espiral: 'Espiral' };
let pickColor = PALETTE[0];
let pickAnt = 'reta';

try {
  const saved = JSON.parse(localStorage.getItem('tubby') || 'null');
  if (saved) { $('name').value = saved.name; pickColor = saved.color; pickAnt = saved.ant; }
} catch {}

$('swatches').innerHTML = PALETTE.map((c) => `<button type="button" class="swatch" data-color="${c}" style="--c:${c}" aria-label="Cor ${c}"></button>`).join('')
  + '<label class="swatch custom" aria-label="Escolher qualquer cor"><input type="color" id="custom-color"></label>';
$('antennas').innerHTML = Object.entries(ANTENNAS).map(([k, v]) => `<button type="button" class="chip" data-ant="${k}">${v}</button>`).join('');

function syncPicker() {
  document.querySelectorAll('.swatch[data-color]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.color === pickColor));
  document.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', b.dataset.ant === pickAnt));
  $('custom-color').value = pickColor;
  drawPreview();
}
$('swatches').addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (b) { pickColor = b.dataset.color; syncPicker(); } });
$('custom-color').addEventListener('input', (e) => { pickColor = e.target.value; syncPicker(); });
$('antennas').addEventListener('click', (e) => { const b = e.target.closest('[data-ant]'); if (b) { pickAnt = b.dataset.ant; syncPicker(); } });

function drawPreview() {
  const c = $('preview').getContext('2d');
  c.clearRect(0, 0, 120, 120);
  c.save();
  c.scale(2.1, 2.1);
  drawTubby(c, 15.5, 19, pickColor, pickAnt, 1, 1, 1, 0, null);
  c.restore();
}

$('join').addEventListener('submit', (e) => {
  e.preventDefault();
  me = { name: $('name').value.trim().slice(0, 16) || 'Tubby', color: pickColor, ant: pickAnt };
  try { localStorage.setItem('tubby', JSON.stringify(me)); } catch {}
  socket.emit('join', me);
  $('join').hidden = true;
  startMusic();
  lvl = 0; myDeaths = 0; finished = false;
  loadLevel(0);
  $('leave').hidden = false;
  canvas.focus();
});

// Sair: volta para a tela de montar o Tubby e some da lista dos colegas
$('leave').addEventListener('click', () => {
  socket.emit('leave');
  me = null; myId = null; world = null;
  lvl = 0; myDeaths = 0; finished = false;
  revealed.clear();
  for (const k of Object.keys(keys)) keys[k] = false;
  stopMusic();
  $('win').hidden = true;
  $('hud').hidden = true;
  $('leave').hidden = true;
  $('join').hidden = false;
  $('name').focus();
});

$('again').addEventListener('click', () => {
  $('win').hidden = true;
  socket.emit('restart');
  lvl = 0; myDeaths = 0; finished = false;
  revealed.clear();
  loadLevel(0);
});

// ---------- HUD e painel ----------
function fmt(ms) {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); }

function renderHud() {
  $('hud').hidden = false;
  $('hud-lvl').textContent = `${lvl + 1}/${LEVELS.length}`;
  $('hud-deaths').textContent = myDeaths;
  const self = others.find((o) => o.id === myId);
  const now = Date.now() + clockOffset;
  $('hud-time').textContent = fmt(self && self.done ? self.time : now - startedAt);
}

// No painel só aparece o quanto cada um avançou na fase (sem mapa, pra não entregar as pegadinhas)
const cards = new Map();
function renderPlayers() {
  const list = $('players');
  const sorted = [...others].sort((a, b) => (b.done - a.done) || (b.lvl - a.lvl) || (a.deaths - b.deaths));
  renderTrail();
  if (!sorted.length) { list.innerHTML = '<li class="vazio">Ninguém jogando ainda.</li>'; cards.clear(); return; }
  list.querySelector('.vazio')?.remove();

  for (const [id, el] of cards) if (!sorted.some((o) => o.id === id)) { el.remove(); cards.delete(id); }
  sorted.forEach((o) => {
    let el = cards.get(o.id);
    if (!el) {
      el = document.createElement('li');
      el.innerHTML = '<div><b></b><span></span></div><div class="progresso"><i></i></div>';
      cards.set(o.id, el);
    }
    list.appendChild(el); // mantém a ordem
    el.classList.toggle('me', o.id === myId);
    el.style.setProperty('--c', o.color);
    el.querySelector('b').textContent = o.name;
    el.querySelector('span').textContent = o.done
      ? `zerou · ${o.deaths} morte${o.deaths === 1 ? '' : 's'}`
      : `fase ${o.lvl + 1} · ${o.deaths} morte${o.deaths === 1 ? '' : 's'}`;
    const avanço = o.done ? 1 : Math.max(0, Math.min(1, (o.x + PW / 2) / W));
    el.querySelector('.progresso i').style.width = `${Math.round(avanço * 100)}%`;
  });

}

// trilha das fases no topo: quem está em cada uma
function renderTrail() {
  $('trail').innerHTML = LEVELS.map((level, i) => {
    const here = others.filter((o) => !o.done && o.lvl === i);
    return `<li class="${i === lvl && !finished ? 'aqui' : ''}"><span class="num">${i + 1}</span><span class="heads">${here.map((o) => `<i style="--c:${o.color}" title="${esc(o.name)}"></i>`).join('')}</span></li>`;
  }).join('') + `<li class="fim"><span class="num">★</span><span class="heads">${others.filter((o) => o.done).map((o) => `<i style="--c:${o.color}" title="${esc(o.name)}"></i>`).join('')}</span></li>`;
}

let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}

function showWin(c) {
  $('win-stats').textContent = `${c.deaths} morte${c.deaths === 1 ? '' : 's'} em ${fmt(c.time)}`;
  $('win').hidden = false;
}

async function loadRanking() {
  try {
    const rows = await (await fetch('/api/ranking')).json();
    $('ranking').innerHTML = rows.length
      ? rows.map((r) => `<tr><td><i class="dot" style="--c:${esc(r.cor)}"></i>${esc(r.nome)}</td><td>${r.mortes}</td><td>${fmt(r.tempo_ms)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="hint">Ninguém zerou ainda. As 5 fases esperam por você.</td></tr>';
  } catch {
    $('ranking').innerHTML = '<tr><td colspan="3" class="hint">Ranking fora do ar: confira a DATABASE_URL do servidor.</td></tr>';
  }
}

document.getElementById('mute').addEventListener('click', toggleMute);
syncMute();
loadRanking();
syncPicker();
requestAnimationFrame(frame);
