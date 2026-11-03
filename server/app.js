import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, resolve, sep } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { openDb } from './db.js';
import { createAuth, validateCredentials, parseCookies, createLimiter } from './auth.js';
import { createRooms } from './rooms.js';
import { CITIES, cityById, generateCourse, COURSE_LENGTH, MAX_SPEED, GUN_AMMO } from '../shared/course.js';
import { POINTS } from '../shared/scoring.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};
const COOKIE = 'ds_session';
const TILE_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

export function createApp({
  dbPath = join(ROOT, 'data', 'dream.db'),
  tilesDir = join(ROOT, 'data', 'tiles'),
  fetchTile = async (z, x, y) => {
    const r = await fetch(TILE_URL(z, x, y), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`tile ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  },
  secureCookies = process.env.COOKIE_SECURE === '1',
} = {}) {
  const db = openDb(dbPath);
  const auth = createAuth(db);
  const authLimit = createLimiter(15, 5 * 60 * 1000);
  const insertScore = db.prepare('INSERT INTO scores(user_id, city, mode, score, coins, time_ms, created_at) VALUES (?,?,?,?,?,?,?)');
  const insertRun = db.prepare('INSERT INTO runs(id, user_id, city, seed, started_at) VALUES (?,?,?,?,?)');
  const getRun = db.prepare('SELECT * FROM runs WHERE id = ? AND user_id = ?');
  const finishRun = db.prepare('UPDATE runs SET finished = 1 WHERE id = ? AND finished = 0');

  const rooms = createRooms({
    onMultiResult(room, res) {
      for (const r of res.rows) {
        insertScore.run(r.id, room.city, r.id === res.winnerId ? 'multi-win' : 'multi', r.total, Math.round(r.coinPoints / POINTS.coin), 0, Date.now());
      }
    },
  });

  const json = (res, status, body, headers = {}) => {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
    res.end(data);
  };
  const readBody = (req) =>
    new Promise((resolveBody, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 8192) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c);
      });
      req.on('end', () => {
        try { resolveBody(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  const sessionCookie = (token, maxAge) =>
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;
  const userFrom = (req) => auth.verify(parseCookies(req.headers.cookie)[COOKIE]);
  const clientIp = (req) => req.socket.remoteAddress || 'unknown';
  const sameOrigin = (req) => !req.headers.origin || new URL(req.headers.origin).host === req.headers.host;

  async function api(req, res, url) {
    const path = url.pathname;
    if (req.method === 'GET' && path === '/api/cities') return json(res, 200, CITIES);
    if (req.method !== 'GET' && (!sameOrigin(req) || !String(req.headers['content-type'] || '').startsWith('application/json'))) {
      return json(res, 403, { error: 'Forbidden' });
    }

    if (req.method === 'POST' && (path === '/api/register' || path === '/api/login')) {
      if (!authLimit(clientIp(req))) return json(res, 429, { error: 'Too many attempts. Try again later.' });
      const body = await readBody(req);
      const err = validateCredentials(body.username, body.password);
      if (err) return json(res, 400, { error: err });
      const u = path === '/api/register' ? auth.register(body.username, body.password) : auth.login(body.username, body.password);
      if (!u) {
        return path === '/api/register'
          ? json(res, 409, { error: 'That username is taken.' })
          : json(res, 401, { error: 'Invalid username or password.' });
      }
      return json(res, 200, { id: u.id, username: u.username }, { 'Set-Cookie': sessionCookie(u.token, auth.ttlSeconds) });
    }
    if (req.method === 'POST' && path === '/api/logout') {
      auth.logout(parseCookies(req.headers.cookie)[COOKIE]);
      return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }

    const user = userFrom(req);
    if (!user) return json(res, 401, { error: 'Not signed in.' });

    if (req.method === 'GET' && path === '/api/me') return json(res, 200, user);

    if (req.method === 'GET' && path === '/api/leaderboard') {
      const city = url.searchParams.get('city');
      if (!cityById(city)) return json(res, 400, { error: 'Unknown city.' });
      const rows = db
        .prepare(
          `SELECT u.username AS username, MAX(s.score) AS score FROM scores s JOIN users u ON u.id = s.user_id
           WHERE s.city = ? AND s.mode = 'single' GROUP BY s.user_id ORDER BY score DESC LIMIT 10`,
        )
        .all(city);
      return json(res, 200, rows);
    }

    if (req.method === 'POST' && path === '/api/run/start') {
      const body = await readBody(req);
      if (!cityById(body.city)) return json(res, 400, { error: 'Unknown city.' });
      const id = randomUUID();
      const seed = randomBytes(4).readUInt32BE(0);
      insertRun.run(id, user.id, body.city, seed, Date.now());
      return json(res, 200, { runId: id, seed });
    }

    if (req.method === 'POST' && path === '/api/run/finish') {
      const b = await readBody(req);
      const run = typeof b.runId === 'string' ? getRun.get(b.runId, user.id) : null;
      if (!run || run.finished) return json(res, 400, { error: 'Unknown or already finished run.' });
      const course = generateCourse(run.seed);
      const elapsed = Date.now() - run.started_at;
      const coins = Math.floor(Number(b.coins));
      const hits = Math.floor(Number(b.policeHits));
      const minMs = (COURSE_LENGTH / MAX_SPEED) * 1000 * 0.9;
      if (![coins, hits].every(Number.isFinite) || coins < 0 || hits < 0) return json(res, 400, { error: 'Invalid run.' });
      if (b.won !== true) { finishRun.run(run.id); return json(res, 200, { score: 0, saved: false }); }
      if (elapsed < minMs || coins > course.totalCoins || hits > course.totalGuns * GUN_AMMO) {
        return json(res, 422, { error: 'Run rejected.' });
      }
      const score = coins * POINTS.coin + hits * POINTS.policeHit + POINTS.singleFinish;
      finishRun.run(run.id);
      insertScore.run(user.id, run.city, 'single', score, coins, elapsed, Date.now());
      return json(res, 200, { score, saved: true });
    }
    return json(res, 404, { error: 'Not found' });
  }

  async function tile(req, res, url) {
    if (!userFrom(req)) return json(res, 401, { error: 'Not signed in.' });
    const m = /^\/tiles\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.jpg$/.exec(url.pathname);
    if (!m) return json(res, 404, { error: 'Not found' });
    const [z, x, y] = m.slice(1).map(Number);
    if (z < 14 || z > 18 || x >= 2 ** z || y >= 2 ** z) return json(res, 400, { error: 'Bad tile' });
    const file = join(tilesDir, String(z), String(x), `${y}.jpg`);
    let data;
    try {
      data = await readFile(file);
    } catch {
      try {
        data = await fetchTile(z, x, y);
        await mkdir(join(tilesDir, String(z), String(x)), { recursive: true });
        await writeFile(file, data);
      } catch {
        return json(res, 502, { error: 'Tile unavailable' });
      }
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', ...SECURITY_HEADERS });
    res.end(data);
  }

  async function staticFile(res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    let base = join(ROOT, 'public');
    if (rel.startsWith('/vendor/three/')) { base = join(ROOT, 'node_modules', 'three', 'build'); rel = rel.slice('/vendor/three'.length); }
    else if (rel.startsWith('/shared/')) { base = join(ROOT, 'shared'); rel = rel.slice('/shared'.length); }
    const full = normalize(join(base, rel));
    if (!full.startsWith(base + sep) || !existsSync(full)) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
    const data = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(data);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (url.pathname.startsWith('/tiles/')) return await tile(req, res, url);
      return await staticFile(res, url);
    } catch (e) {
      if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    const user = url.pathname === '/ws' && sameOrigin(req) ? userFrom(req) : null;
    if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // One live connection per account.
      for (const c of wss.clients) if (c !== ws && c.userId === user.id) c.close(4000, 'Signed in elsewhere');
      ws.userId = user.id;
      ws.send(JSON.stringify({ t: 'hello', id: user.id, name: user.username }));
      let budget = 60; // simple message-rate cap (refilled each second)
      const refill = setInterval(() => { budget = 60; }, 1000);
      ws.on('message', (raw) => {
        if (budget-- <= 0) return;
        let m;
        try { m = JSON.parse(raw.toString()); } catch { return; }
        rooms.handle(user, ws, m);
      });
      ws.on('close', () => { clearInterval(refill); rooms.leave(user.id); });
      ws.on('error', () => {});
    });
  });

  const purgeTimer = setInterval(() => auth.purgeExpired(), 3600 * 1000);
  purgeTimer.unref();

  return {
    server,
    db,
    rooms,
    close() {
      rooms.closeAll();
      clearInterval(purgeTimer);
      for (const c of wss.clients) c.terminate();
      return new Promise((r) => server.close(() => { db.close(); r(); }));
    },
  };
}
