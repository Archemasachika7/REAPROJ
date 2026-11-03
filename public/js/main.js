import { World } from './world.js';
import { Runner } from './runner.js';
import { ArenaView } from './arena.js';
import { CharacterPreview } from './character.js';
import { CHARACTERS } from '/shared/characters.js';
import { CITIES, cityById, generateCourse, COURSE_LENGTH } from '/shared/course.js';
import { POINTS } from '/shared/scoring.js';

const $ = (id) => document.getElementById(id);
const world = new World($('c'));
const savedChar = (() => { try { const n = Number(localStorage.getItem('ds_char')); return Number.isInteger(n) && n >= 0 && n < CHARACTERS.length ? n : 0; } catch { return 0; } })();
const state = { charId: savedChar, user: null, cityId: CITIES[0].id, ws: null, room: null, runner: null, arena: null, myId: null, singleRun: null, orbit: 0, lastFallbackNote: false };

// ---------- helpers ----------
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) (k === 'class' ? (e.className = v) : (e[k] = v));
  for (const k of kids) e.append(k);
  return e;
}
function show(name) {
  for (const id of ['auth', 'menu', 'lobby']) $(id).classList.toggle('hidden', id !== name);
}
function banner(text) {
  const b = $('banner');
  b.textContent = text || '';
  b.classList.toggle('hidden', !text);
}
function overlay(title, bodyNodes, btnText, onBtn, cls = '') {
  $('ov-title').textContent = title;
  $('ov-title').className = cls;
  const body = $('ov-body');
  body.replaceChildren(...bodyNodes);
  $('ov-btn').textContent = btnText;
  $('ov-btn').onclick = () => { $('overlay').classList.add('hidden'); onBtn(); };
  $('overlay').classList.remove('hidden');
}
function feed(text, cls = '') {
  const li = el('li', { class: cls, textContent: text });
  $('feed').append(li);
  setTimeout(() => li.remove(), 5000);
  while ($('feed').children.length > 6) $('feed').firstChild.remove();
}
const p = (text) => el('p', { textContent: text });

// ---------- auth ----------
let registering = false;
function setAuthMode(reg) {
  registering = reg;
  $('tab-login').classList.toggle('on', !reg);
  $('tab-register').classList.toggle('on', reg);
  $('auth-submit').textContent = reg ? 'Create account' : 'Sign in';
  $('password').autocomplete = reg ? 'new-password' : 'current-password';
  $('auth-error').textContent = '';
}
$('tab-login').onclick = () => setAuthMode(false);
$('tab-register').onclick = () => setAuthMode(true);
$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('auth-error').textContent = '';
  try {
    const u = await api(registering ? '/api/register' : '/api/login', { username: $('username').value.trim(), password: $('password').value });
    $('password').value = '';
    enterMenu(u);
  } catch (err) { $('auth-error').textContent = err.message; }
});
$('logout').onclick = async () => {
  await api('/api/logout', {}).catch(() => {});
  state.ws?.close();
  state.user = null;
  show('auth');
};

// ---------- menu ----------
function enterMenu(user) {
  state.user = user;
  $('who').textContent = user.username;
  $('hud').classList.add('hidden');
  renderCities();
  renderChars();
  show('menu');
  loadLeaderboard();
}
function renderCities() {
  const box = $('cities');
  box.replaceChildren(...CITIES.map((c) => {
    const b = el('button', { class: 'city' + (c.id === state.cityId ? ' on' : ''), type: 'button' }, c.name, el('small', { textContent: `${c.lat.toFixed(2)}°, ${c.lon.toFixed(2)}°` }));
    b.onclick = () => { state.cityId = c.id; renderCities(); loadLeaderboard(); };
    return b;
  }));
  world.setCity(cityById(state.cityId));
  $('lb-city').textContent = cityById(state.cityId).name;
}
async function loadLeaderboard() {
  const ol = $('leaderboard');
  try {
    const rows = await api(`/api/leaderboard?city=${state.cityId}`);
    ol.replaceChildren(...(rows.length ? rows.map((r) => el('li', {}, el('b', { textContent: r.username }), ` · ${r.score}`)) : [el('li', { textContent: 'No runs yet — be the first.' })]));
  } catch { ol.replaceChildren(); }
}

// ---------- character picker ----------
const preview = new CharacterPreview($('preview'));
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
function renderChars() {
  $('chars').replaceChildren(...CHARACTERS.map((c) => {
    const b = el('button', { class: 'chip' + (c.id === state.charId ? ' on' : ''), type: 'button', role: 'radio', ariaChecked: String(c.id === state.charId) },
      el('i', { style: `background:${hex(c.top)}` }), c.name);
    b.onclick = () => {
      state.charId = c.id;
      try { localStorage.setItem('ds_char', String(c.id)); } catch { /* storage unavailable */ }
      send({ t: 'char', char: c.id });
      renderChars();
    };
    return b;
  }));
  $('char-name').textContent = CHARACTERS[state.charId].name;
  preview.set(state.charId);
}

// ---------- single player ----------
$('play-single').onclick = async () => {
  $('menu-error').textContent = '';
  try {
    const run = await api('/api/run/start', { city: state.cityId });
    state.singleRun = run;
    const city = cityById(state.cityId);
    world.setCity(city);
    beginRunner({ mode: 'single', course: generateCourse(run.seed), countdownMs: 3000 });
  } catch (err) { $('menu-error').textContent = err.message; }
};

function beginRunner({ mode, course, countdownMs }) {
  cleanupGame();
  show(null);
  $('hud').classList.remove('hidden');
  $('police').classList.toggle('hidden', mode !== 'single');
  $('h-board').classList.toggle('hidden', mode !== 'race');
  $('arena-hud').classList.add('hidden');
  state.runner = new Runner({
    world, course, mode, myId: state.myId, charId: state.charId,
    callbacks: {
      onStumble: () => feed('Stumbled!'),
      onPos: (s) => send({ t: 'pos', ...s }),
      onEnd: (r) => (mode === 'single' ? endSingle(r) : banner('FINISHED — waiting for the others…')),
    },
  });
  state.runner.start(countdownMs);
}

async function endSingle(r) {
  banner('');
  const rows = [p(`Coins: ${r.coins}`), p(`Police shot back: ${r.policeHits}`), p(`Time: ${(r.timeMs / 1000).toFixed(1)} s`)];
  let title = r.won ? 'YOU ESCAPED!' : 'BUSTED!';
  try {
    const res = await api('/api/run/finish', { runId: state.singleRun.runId, won: r.won, coins: r.coins, policeHits: r.policeHits });
    if (r.won) rows.push(p(`Score: ${res.score}`));
  } catch (err) { rows.push(p(`Score not saved: ${err.message}`)); }
  overlay(title, rows, 'Back to menu', backToMenu, r.won ? 'win' : 'lose');
}

function backToMenu() { cleanupGame(); enterMenu(state.user); }
function cleanupGame() {
  state.runner?.dispose(); state.runner = null;
  state.arena?.dispose(); state.arena = null;
  world.track.clear();
  banner('');
  $('feed').replaceChildren();
}

// ---------- multiplayer ----------
function send(msg) { if (state.ws?.readyState === 1) state.ws.send(JSON.stringify(msg)); }

function connect() {
  if (state.ws && state.ws.readyState <= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    state.ws = ws;
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('Could not connect to multiplayer.'));
    ws.onmessage = (e) => onNet(JSON.parse(e.data));
    ws.onclose = () => {
      if (state.room && state.user) { state.room = null; cleanupGame(); enterMenu(state.user); $('menu-error').textContent = 'Disconnected from the server.'; }
    };
  });
}
async function mpAction(msg) {
  $('menu-error').textContent = '';
  try { await connect(); send(msg); } catch (err) { $('menu-error').textContent = err.message; }
}
$('mp-create').onclick = () => mpAction({ t: 'create', city: state.cityId, char: state.charId });
$('mp-join').onclick = () => mpAction({ t: 'join', code: $('join-code').value.trim(), char: state.charId });
$('room-leave').onclick = () => { send({ t: 'leave' }); state.room = null; enterMenu(state.user); };
$('room-start').onclick = () => send({ t: 'start' });
$('room-city').onchange = (e) => send({ t: 'city', city: e.target.value });
$('room-city').replaceChildren(...CITIES.map((c) => el('option', { value: c.id, textContent: c.name })));

function renderLobby() {
  const r = state.room;
  $('room-code').textContent = r.code;
  $('room-city').value = r.city;
  $('room-city').disabled = r.hostId !== state.myId;
  $('room-start').classList.toggle('hidden', r.hostId !== state.myId);
  $('room-players').replaceChildren(...r.players.map((pl) => el('li', {}, pl.name, el('small', { textContent: `${CHARACTERS[pl.char ?? 0]?.name || ''}${pl.id === r.hostId ? ' · host' : ''}` }))));
  $('lobby-error').textContent = '';
  world.setCity(cityById(r.city));
}
const nameOf = (id) => state.room?.players.find((x) => x.id === id)?.name || '?';

function onNet(m) {
  switch (m.t) {
    case 'hello': state.myId = m.id; break;
    case 'error':
      ($('lobby').classList.contains('hidden') ? $('menu-error') : $('lobby-error')).textContent = m.msg; break;
    case 'room': {
      const wasInMatch = state.runner || state.arena;
      state.room = m;
      if (m.phase === 'lobby') {
        if (wasInMatch) { cleanupGame(); $('overlay').classList.add('hidden'); $('hud').classList.add('hidden'); }
        renderLobby(); show('lobby');
      }
      break;
    }
    case 'race': {
      world.setCity(cityById(m.city));
      state.room.players = m.players;
      beginRunner({ mode: 'race', course: generateCourse(m.seed), countdownMs: m.countdownMs });
      break;
    }
    case 'state': {
      if (!state.runner) break;
      state.runner.setGhosts(m.players.map((q) => ({ ...q, name: nameOf(q.id), char: state.room?.players.find((x) => x.id === q.id)?.char })));
      const rows = [...m.players].sort((a, b) => b.s - a.s);
      $('h-board').replaceChildren(...rows.map((q) => el('li', { textContent: `${nameOf(q.id)}${q.id === state.myId ? ' (you)' : ''} · ${Math.round(q.s)} m${q.fin ? ' ✓' : ''}` })));
      break;
    }
    case 'finished': banner(`FINISHED #${m.place} — waiting…`); break;
    case 'grace': feed(`First finisher! ${Math.round(m.ms / 1000)} s left for everyone else.`); break;
    case 'raceEnd': {
      const mine = m.players.find((q) => q.id === state.myId);
      banner(`ARENA INCOMING · ${mine?.ammo ?? 0} rounds`);
      break;
    }
    case 'arena': {
      state.runner?.dispose(); state.runner = null;
      banner('FIGHT!');
      setTimeout(() => banner(''), 1500);
      $('h-board').classList.add('hidden');
      $('arena-hud').classList.remove('hidden');
      state.arena = new ArenaView({ world, city: cityById(m.city), players: m.players, myId: state.myId, send });
      break;
    }
    case 'snap': {
      if (!state.arena) break;
      state.arena.onSnap(m);
      const me = m.players.find((q) => q.id === state.myId);
      if (me) { $('a-hp').textContent = me.hp; $('a-ammo').textContent = me.ammo; $('a-score').textContent = me.score; }
      $('a-alive').textContent = m.players.filter((q) => q.alive).length;
      for (const ev of m.events) {
        if (ev.type === 'kill') {
          feed(ev.killer ? `${nameOf(ev.killer)} eliminated ${nameOf(ev.victim)}` : `${nameOf(ev.victim)} was lost to the storm`);
          for (const b of ev.bonuses || []) feed(`${nameOf(ev.killer)}: ${b.name} +${b.points}`, 'bonus');
        }
      }
      break;
    }
    case 'results': showResults(m); break;
    default:
  }
}

function showResults(m) {
  const winner = m.rows.find((r) => r.id === m.winnerId);
  const survivor = m.rows.find((r) => r.id === m.survivorId);
  const table = el('table', {}, el('tr', {}, ...['Player', 'Coins', 'Place', 'Kills', 'Bonus', 'Total'].map((h) => el('th', { textContent: h }))));
  for (const r of [...m.rows].sort((a, b) => b.total - a.total)) {
    table.append(el('tr', { class: r.id === m.winnerId ? 'win' : '' },
      el('td', { textContent: `${r.name}${r.alive ? ' ★' : ''}` }),
      ...[r.coinPoints, r.placeBonus, r.killPoints, r.bonusPoints, r.total].map((v) => el('td', { textContent: String(v) }))));
  }
  const notes = [];
  if (m.survivorLost && survivor && winner) notes.push(p(`${survivor.name} was the last one standing but was out-scored — ${winner.name} takes the win!`));
  notes.push(p(`Bonuses: KILL MONGER (${POINTS.killMongerAt} kills) +${POINTS.killMonger} · RAVE (kill within ${POINTS.raveWindowMs / 1000}s of the last) +${POINTS.rave}`));
  banner('');
  overlay(winner ? `${winner.name} WINS` : 'DRAW', [table, ...notes], 'Back to lobby', () => {}, winner?.id === state.myId ? 'win' : 'lose');
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  const r = state.runner;
  if (r) {
    r.update(dt);
    $('h-coins').textContent = r.coins;
    $('h-ammo').textContent = r.ammo;
    $('h-dist').textContent = Math.floor(r.s);
    $('prog').style.width = `${(r.s / COURSE_LENGTH) * 100}%`;
    $('police-bar').style.width = `${Math.max(0, Math.min(100, (r.gap / 14) * 100))}%`;
    if (r.countdown > 0) banner(String(Math.ceil(r.countdown)));
    else if (r.elapsed < 0.7) banner('GO!');
    else if (!r.done) banner('');
  } else if (state.arena) {
    state.arena.update(dt);
  } else if (state.user) {
    // idle: slow orbit over the selected city so the menu shows the satellite map
    const c = world.city;
    if (c && state.user) {
      state.orbit += dt * 0.08;
      const x = Math.cos(state.orbit) * 160, z = Math.sin(state.orbit) * 160;
      world.camera.position.set(x, 120, z);
      world.camera.lookAt(0, 0, 0);
      world.updateTiles(0, 0, 420);
    }
  }
  if (world.usingFallbackImagery && !state.lastFallbackNote && state.user) {
    state.lastFallbackNote = true;
    feed('Satellite imagery unreachable — showing generated terrain.');
  }
  if (!$('menu').classList.contains('hidden')) preview.frame(dt);
  world.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- boot ----------
api('/api/me').then(enterMenu).catch(() => show('auth'));
window.__ds = state; // handy for debugging in devtools
