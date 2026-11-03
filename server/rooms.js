import { randomBytes } from 'node:crypto';
import { generateCourse, cityById, COURSE_LENGTH, MAX_SPEED } from '../shared/course.js';
import { POINTS, placeBonus } from '../shared/scoring.js';
import { Arena } from './arena.js';
import { validCharacter } from '../shared/characters.js';

const MAX_PLAYERS = 8;
const COUNTDOWN_MS = 4000;
const FINISH_GRACE_MS = 25000;
const RACE_HARD_CAP_MS = 6 * 60 * 1000;
const INTERMISSION_MS = 5000;
const TICK_MS = 40;
const RACE_BROADCAST_MS = 100;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  const b = randomBytes(5);
  return [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

export function createRooms({ onMultiResult = () => {}, now = () => Date.now() } = {}) {
  const rooms = new Map(); // code -> room
  const byUser = new Map(); // userId -> room

  const send = (ws, msg) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };
  const broadcast = (room, msg) => {
    const data = JSON.stringify(msg);
    for (const p of room.players.values()) if (p.ws.readyState === 1) p.ws.send(data);
  };
  const lobbyView = (room) => ({
    t: 'room',
    code: room.code,
    city: room.city,
    phase: room.phase,
    hostId: room.hostId,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, char: p.char })),
  });

  function clearTimers(room) {
    for (const k of ['raceTimer', 'graceTimer', 'arenaTimer', 'nextTimer', 'capTimer']) {
      clearInterval(room[k]);
      clearTimeout(room[k]);
      room[k] = null;
    }
  }

  function destroy(room) {
    clearTimers(room);
    rooms.delete(room.code);
    for (const p of room.players.values()) if (byUser.get(p.id) === room) byUser.delete(p.id);
  }

  function leave(userId) {
    const room = byUser.get(userId);
    if (!room) return;
    byUser.delete(userId);
    room.players.delete(userId);
    if (room.arena) room.arena.remove(userId);
    if (room.players.size === 0) return destroy(room);
    if (room.hostId === userId) room.hostId = room.players.keys().next().value;
    broadcast(room, lobbyView(room));
    if (room.phase === 'race') {
      if (room.players.size < 2) return backToLobby(room);
      maybeEndRace(room);
    }
    if (room.phase === 'arena' && room.players.size < 2) finishArena(room);
  }

  function backToLobby(room) {
    clearTimers(room);
    room.phase = 'lobby';
    room.arena = null;
    broadcast(room, lobbyView(room));
  }

  function startRace(room) {
    room.phase = 'race';
    room.seed = randomBytes(4).readUInt32BE(0);
    room.course = generateCourse(room.seed);
    room.startAt = now() + COUNTDOWN_MS;
    room.finishCount = 0;
    for (const p of room.players.values()) {
      Object.assign(p, { s: 0, l: 0, y: 0, coins: 0, ammo: 0, finished: false, place: 0, lastPos: room.startAt });
    }
    broadcast(room, { t: 'race', city: room.city, seed: room.seed, countdownMs: COUNTDOWN_MS, players: lobbyView(room).players });
    room.raceTimer = setInterval(() => {
      broadcast(room, {
        t: 'state',
        players: [...room.players.values()].map((p) => ({
          id: p.id, s: +p.s.toFixed(1), l: +p.l.toFixed(2), y: +p.y.toFixed(2), coins: p.coins, fin: p.finished,
        })),
      });
    }, RACE_BROADCAST_MS);
    room.capTimer = setTimeout(() => endRace(room), COUNTDOWN_MS + RACE_HARD_CAP_MS);
  }

  function maybeEndRace(room) {
    if (room.phase !== 'race') return;
    if ([...room.players.values()].every((p) => p.finished)) endRace(room);
  }

  function endRace(room) {
    if (room.phase !== 'race') return;
    clearTimers(room);
    room.phase = 'intermission';
    broadcast(room, { t: 'raceEnd', players: [...room.players.values()].map((p) => ({ id: p.id, coins: p.coins, ammo: p.ammo, place: p.place })) });
    room.nextTimer = setTimeout(() => startArena(room), INTERMISSION_MS);
  }

  function startArena(room) {
    if (room.players.size < 2) return backToLobby(room);
    room.phase = 'arena';
    const arena = new Arena(
      [...room.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        ammo: p.ammo,
        coinPoints: p.coins * POINTS.coin,
        placeBonus: p.place ? placeBonus(p.place) : 0,
        baseScore: p.coins * POINTS.coin + (p.place ? placeBonus(p.place) : 0),
      })),
      now,
    );
    room.arena = arena;
    broadcast(room, { t: 'arena', city: room.city, countdownMs: 3000, players: [...arena.players.values()].map((p) => ({ id: p.id, name: p.name, char: room.players.get(p.id)?.char ?? 0 })) });
    room.arenaStart = now() + 3000;
    let last = now();
    room.arenaTimer = setInterval(() => {
      if (now() < room.arenaStart) { last = now(); return; }
      const t = now();
      arena.tick(Math.min(0.1, (t - last) / 1000));
      last = t;
      broadcast(room, { t: 'snap', ...arena.snapshot() });
      if (arena.isOver()) finishArena(room);
    }, TICK_MS);
  }

  function finishArena(room) {
    if (room.phase !== 'arena') return;
    clearTimers(room);
    room.phase = 'done';
    const res = room.arena.results();
    broadcast(room, { t: 'results', ...res });
    try { onMultiResult(room, res); } catch { /* persistence must not break the game */ }
    room.nextTimer = setTimeout(() => backToLobby(room), 20000);
  }

  function handlePos(room, p, m) {
    if (room.phase !== 'race' || p.finished) return;
    const t = now();
    if (t < room.startAt) return;
    const dt = Math.max(0.02, (t - p.lastPos) / 1000);
    p.lastPos = t;
    const num = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);
    // Reject teleporting: forward progress is bounded by top speed (+30% jitter allowance).
    const maxS = p.s + MAX_SPEED * 1.3 * dt + 1;
    p.s = Math.max(p.s, Math.min(num(m.s, 0, COURSE_LENGTH), maxS));
    p.l = num(m.l, -3, 3);
    p.y = num(m.y, 0, 6);
    p.coins = Math.max(p.coins, Math.min(Math.floor(num(m.coins, 0, 1e4)), room.course.coinsUpTo(p.s + 3)));
    p.ammo = Math.max(p.ammo, Math.min(Math.floor(num(m.ammo, 0, 1e4)), room.course.ammoUpTo(p.s + 3)));
    if (p.s >= COURSE_LENGTH - 0.01) {
      p.finished = true;
      p.place = ++room.finishCount;
      send(p.ws, { t: 'finished', place: p.place });
      if (room.finishCount === 1 && room.players.size > 1) {
        room.graceTimer = setTimeout(() => endRace(room), FINISH_GRACE_MS);
        broadcast(room, { t: 'grace', ms: FINISH_GRACE_MS });
      }
      maybeEndRace(room);
    }
  }

  function handle(user, ws, m) {
    if (!m || typeof m.t !== 'string') return;
    const room = byUser.get(user.id);
    switch (m.t) {
      case 'create': {
        if (room) return send(ws, { t: 'error', msg: 'Already in a room.' });
        if (!cityById(m.city)) return send(ws, { t: 'error', msg: 'Unknown city.' });
        let code = makeCode();
        while (rooms.has(code)) code = makeCode();
        const r = { code, city: m.city, hostId: user.id, phase: 'lobby', players: new Map() };
        r.players.set(user.id, { id: user.id, name: user.username, ws, char: validCharacter(m.char) ? m.char : 0 });
        rooms.set(code, r);
        byUser.set(user.id, r);
        return broadcast(r, lobbyView(r));
      }
      case 'join': {
        if (room) return send(ws, { t: 'error', msg: 'Already in a room.' });
        const r = rooms.get(String(m.code || '').toUpperCase());
        if (!r) return send(ws, { t: 'error', msg: 'Room not found.' });
        if (r.phase !== 'lobby') return send(ws, { t: 'error', msg: 'Match already in progress.' });
        if (r.players.size >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'Room is full.' });
        r.players.set(user.id, { id: user.id, name: user.username, ws, char: validCharacter(m.char) ? m.char : 0 });
        byUser.set(user.id, r);
        return broadcast(r, lobbyView(r));
      }
      case 'char':
        if (room && room.phase === 'lobby' && validCharacter(m.char)) {
          room.players.get(user.id).char = m.char;
          broadcast(room, lobbyView(room));
        }
        return;
      case 'leave':
        return leave(user.id);
      case 'city':
        if (room && room.hostId === user.id && room.phase === 'lobby' && cityById(m.city)) {
          room.city = m.city;
          broadcast(room, lobbyView(room));
        }
        return;
      case 'start':
        if (!room || room.hostId !== user.id || room.phase !== 'lobby') return;
        if (room.players.size < 2) return send(ws, { t: 'error', msg: 'Need at least 2 players.' });
        return startRace(room);
      case 'pos':
        if (room && room.players.get(user.id)) handlePos(room, room.players.get(user.id), m);
        return;
      case 'input':
        if (room && room.phase === 'arena' && room.arena && now() >= room.arenaStart) room.arena.setInput(user.id, m);
        return;
      default:
    }
  }

  return {
    handle,
    leave,
    rooms,
    roomOf: (id) => byUser.get(id),
    closeAll() { for (const r of [...rooms.values()]) destroy(r); },
    // exposed for tests
    _lobbyView: lobbyView,
  };
}
