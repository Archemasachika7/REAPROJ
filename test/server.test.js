import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApp } from '../server/app.js';
import { generateCourse, COURSE_LENGTH } from '../shared/course.js';

let app;
let base;
before(async () => {
  app = createApp({ dbPath: ':memory:', tilesDir: '/tmp/ds-test-tiles', fetchTile: async () => { throw new Error('offline'); } });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => app.close());

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0], headers: res.headers };
}

test('auth: register, duplicate, bad password, login, logout', async () => {
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/register', { method: 'POST', body: { username: 'ab', password: 'longenough' } })).status, 400);
  assert.equal((await call('/api/register', { method: 'POST', body: { username: 'alice', password: 'short' } })).status, 400);
  const reg = await call('/api/register', { method: 'POST', body: { username: 'alice', password: 'correct horse' } });
  assert.equal(reg.status, 200);
  assert.match(reg.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await call('/api/register', { method: 'POST', body: { username: 'ALICE', password: 'correct horse' } })).status, 409);
  assert.equal((await call('/api/login', { method: 'POST', body: { username: 'alice', password: 'wrong password' } })).status, 401);
  const login = await call('/api/login', { method: 'POST', body: { username: 'alice', password: 'correct horse' } });
  assert.equal((await call('/api/me', { cookie: login.cookie })).data.username, 'alice');
  await call('/api/logout', { method: 'POST', body: {}, cookie: login.cookie });
  assert.equal((await call('/api/me', { cookie: login.cookie })).status, 401);
});

test('security: cross-origin POST and non-JSON are rejected; headers present; no path traversal', async () => {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: '{}' });
  assert.equal(r.status, 403);
  const r2 = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(r2.status, 403);
  const page = await fetch(base + '/');
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  const trav = await fetch(base + '/%2e%2e/package.json');
  assert.equal(trav.status, 404);
  const trav2 = await fetch(base + '/shared/..%2f..%2fpackage.json');
  assert.equal(trav2.status, 404);
});

test('tiles require auth and validate range', async () => {
  assert.equal((await call('/tiles/17/1/1.jpg')).status, 401);
  const u = await call('/api/register', { method: 'POST', body: { username: 'bob_t', password: 'correct horse' } });
  assert.equal((await call('/tiles/3/1/1.jpg', { cookie: u.cookie })).status, 400);
  assert.equal((await call('/tiles/17/1/1.jpg', { cookie: u.cookie })).status, 502); // offline fetcher
});

test('single run: instant finish is rejected as too fast', async () => {
  const u = await call('/api/register', { method: 'POST', body: { username: 'runner1', password: 'correct horse' } });
  const start = await call('/api/run/start', { method: 'POST', body: { city: 'paris' }, cookie: u.cookie });
  assert.equal(start.status, 200);
  const course = generateCourse(start.data.seed);
  // Instant finish is too fast.
  const fast = await call('/api/run/finish', { method: 'POST', cookie: u.cookie, body: { runId: start.data.runId, won: true, coins: 1, policeHits: 0 } });
  assert.equal(fast.status, 422);
  assert.ok(course.totalCoins > 0 && COURSE_LENGTH === 5000);
});

test('single run: coin count above course maximum is rejected', async () => {
  const u = await call('/api/register', { method: 'POST', body: { username: 'cheater', password: 'correct horse' } });
  const start = await call('/api/run/start', { method: 'POST', body: { city: 'nyc' }, cookie: u.cookie });
  const r = await call('/api/run/finish', { method: 'POST', cookie: u.cookie, body: { runId: start.data.runId, won: true, coins: 999999, policeHits: 0 } });
  assert.equal(r.status, 422);
  assert.equal((await call('/api/run/finish', { method: 'POST', cookie: u.cookie, body: { runId: 'nope', won: true, coins: 1, policeHits: 0 } })).status, 400);
});

test('websocket: needs session; two players can create/join a room; start needs host', async () => {
  const bad = new WebSocket(base.replace('http', 'ws') + '/ws');
  await new Promise((r) => { bad.on('error', r); bad.on('unexpected-response', r); });
  const mk = async (name) => {
    const u = await call('/api/register', { method: 'POST', body: { username: name, password: 'correct horse' } });
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { Cookie: u.cookie } });
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    await new Promise((r) => ws.on('open', r));
    return { ws, msgs };
  };
  const wait = async (fn) => { for (let i = 0; i < 100; i++) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timeout'); };
  const a = await mk('hosty');
  const b = await mk('guesty');
  a.ws.send(JSON.stringify({ t: 'create', city: 'dubai' }));
  const room = await wait(() => a.msgs.find((m) => m.t === 'room'));
  b.ws.send(JSON.stringify({ t: 'join', code: room.code }));
  await wait(() => b.msgs.find((m) => m.t === 'room' && m.players.length === 2));
  b.ws.send(JSON.stringify({ t: 'start' })); // guest: ignored
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(a.msgs.some((m) => m.t === 'race'), false);
  a.ws.send(JSON.stringify({ t: 'start' }));
  const race = await wait(() => b.msgs.find((m) => m.t === 'race'));
  assert.equal(race.city, 'dubai');
  assert.equal(typeof race.seed, 'number');
  a.ws.close(); b.ws.close();
});
