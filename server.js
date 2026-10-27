const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const { LEVELS } = require('./public/levels.js');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 30;
const ANTENNAS = ['reta', 'triangulo', 'circulo', 'espiral'];

// ---------- Banco de dados (Neon / Postgres) ----------
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5, enableChannelBinding: true })
  : null;

async function initDb() {
  if (!pool) {
    console.warn('DATABASE_URL não definida: o jogo roda, mas não salva o ranking.');
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campeoes (
      id         SERIAL PRIMARY KEY,
      nome       TEXT        NOT NULL,
      cor        TEXT        NOT NULL,
      mortes     INTEGER     NOT NULL,
      tempo_ms   INTEGER     NOT NULL,
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  console.log('Banco conectado e tabela "campeoes" pronta.');
}

async function saveChampion(p) {
  if (!pool) return;
  try {
    await pool.query(
      'INSERT INTO campeoes (nome, cor, mortes, tempo_ms) VALUES ($1, $2, $3, $4)',
      [p.name, p.color, p.deaths, p.time]
    );
  } catch (err) {
    console.error('Erro ao salvar campeão:', err.message);
  }
}

// ---------- HTTP ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Melhor partida de cada nome: menos mortes, depois menor tempo
app.get('/api/ranking', async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const { rows } = await pool.query(`
      SELECT nome, cor, mortes, tempo_ms FROM (
        SELECT DISTINCT ON (nome) nome, cor, mortes, tempo_ms
          FROM campeoes
         ORDER BY nome, mortes, tempo_ms
      ) melhores
      ORDER BY mortes, tempo_ms
      LIMIT 10
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/health', async (req, res) => {
  let db = 'desativado';
  if (pool) {
    try { await pool.query('SELECT 1'); db = 'ok'; } catch { db = 'erro'; }
  }
  res.json({ status: 'ok', db, jogadores: players.size });
});

const server = http.createServer(app);
const io = new Server(server);

// ---------- Jogadores ----------
// Cada um joga no seu ritmo; o servidor só guarda onde cada um está e conta mortes.
const players = new Map();
let nextId = 1; // id curto (número) em vez do socket.id de 20 caracteres: mensagens menores

// Nome, cor e antena só mudam quando alguém entra ou sai, então vão num evento separado
// em vez de seguir junto em toda atualização de posição
function roster() {
  return [...players.values()].map((p) => [p.id, p.name, p.color, p.ant]);
}

io.on('connection', (socket) => {
  socket.emit('roster', roster());

  socket.on('join', (data = {}) => {
    if (!players.has(socket.id) && players.size >= MAX_PLAYERS) return;
    const name = String(data.name || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Tubby';
    const color = /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : '#9b59d0';
    const ant = ANTENNAS.includes(data.ant) ? data.ant : 'reta';
    // "lvl" e "deaths" só vêm quando o navegador reconecta no meio da partida
    const lvl = Number.isInteger(data.lvl) ? Math.max(0, Math.min(LEVELS.length - 1, data.lvl)) : 0;
    const deaths = Number.isInteger(data.deaths) ? Math.max(0, data.deaths) : 0;
    const now = Date.now();
    const id = players.get(socket.id)?.id ?? nextId++;
    players.set(socket.id, {
      id, name, color, ant, lvl, deaths,
      x: 0, y: 0, f: 1, g: 1, done: false, time: null, startedAt: now,
    });
    socket.emit('joined', { id, startedAt: now, now });
    io.emit('roster', roster());
  });

  socket.on('pos', (d = {}) => {
    const p = players.get(socket.id);
    if (!p || p.done || d.lvl !== p.lvl) return;
    if (![d.x, d.y].every(Number.isFinite)) return;
    p.x = Math.round(d.x); p.y = Math.round(d.y);
    p.f = d.f === -1 ? -1 : 1;
    p.g = d.g === -1 ? -1 : 1;
  });

  socket.on('death', (d = {}) => {
    const p = players.get(socket.id);
    if (!p || p.done) return;
    p.deaths++;
    if (Number.isFinite(d.x) && Number.isFinite(d.y)) {
      io.emit('death', { id: p.id, lvl: p.lvl, x: d.x, y: d.y, color: p.color });
    }
  });

  socket.on('level', ({ from } = {}) => {
    const p = players.get(socket.id);
    if (!p || p.done || from !== p.lvl) return;
    if (p.lvl + 1 < LEVELS.length) {
      p.lvl++;
      return;
    }
    p.done = true;
    p.time = Date.now() - p.startedAt;
    saveChampion(p).then(() => {
      io.emit('champion', { id: p.id, name: p.name, deaths: p.deaths, time: p.time });
    });
  });

  socket.on('restart', () => {
    const p = players.get(socket.id);
    if (!p) return;
    Object.assign(p, { lvl: 0, deaths: 0, done: false, time: null, startedAt: Date.now() });
    socket.emit('joined', { id: p.id, startedAt: p.startedAt, now: Date.now() });
  });

  socket.on('leave', () => {
    if (players.delete(socket.id)) io.emit('roster', roster());
  });

  socket.on('disconnect', () => {
    if (players.delete(socket.id)) io.emit('roster', roster());
  });
});

// Envia a posição de todo mundo ~15x por segundo, em formato compacto:
// [id, fase, x, y, direção, gravidade, mortes, zerou (0/1), tempo]
setInterval(() => {
  io.volatile.emit('state', {
    now: Date.now(),
    p: [...players.values()].map((p) => [p.id, p.lvl, p.x, p.y, p.f, p.g, p.deaths, p.done ? 1 : 0, p.time || 0]),
  });
}, 66);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`A porta ${PORT} já está em uso (o jogo já está rodando em outro terminal ou no Docker?).`);
    console.error('Feche o outro processo ou troque a porta no arquivo .env (ex.: PORT=3001).');
    process.exit(1);
  }
  throw err;
});

initDb()
  .catch((err) => console.error('Falha ao iniciar banco:', err.message))
  .finally(() => server.listen(PORT, () => console.log(`Tubby Troll rodando em http://localhost:${PORT}`)));
