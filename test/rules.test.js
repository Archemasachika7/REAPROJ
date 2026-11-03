import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCourse, COURSE_LENGTH, GUN_AMMO } from '../shared/course.js';
import { POINTS, registerKill, decideWinner } from '../shared/scoring.js';
import { Arena, ARENA } from '../server/arena.js';

test('course is deterministic and never blocks all three lanes', () => {
  const a = generateCourse(1234);
  const b = generateCourse(1234);
  assert.deepEqual(a.items, b.items);
  assert.notDeepEqual(a.items, generateCourse(999).items);
  const rows = new Map();
  for (const i of a.items) if (['low', 'high', 'block'].includes(i.type)) rows.set(i.s, (rows.get(i.s) || 0) + 1);
  assert.ok([...rows.values()].every((n) => n <= 2));
  assert.ok(a.items.every((i) => i.s < COURSE_LENGTH));
});

test('guns appear at least every ~340 m so arena ammo is obtainable', () => {
  for (const seed of [1, 2, 3, 42, 99999]) {
    const c = generateCourse(seed);
    const guns = c.items.filter((i) => i.type === 'gun').map((i) => i.s);
    assert.ok(guns.length >= 12, `seed ${seed}: ${guns.length}`);
    assert.equal(c.ammoUpTo(COURSE_LENGTH), guns.length * GUN_AMMO);
    for (let i = 1; i < guns.length; i++) assert.ok(guns[i] - guns[i - 1] < 400);
  }
});

test('prefix counts cap claims', () => {
  const c = generateCourse(7);
  assert.equal(c.coinsUpTo(0), 0);
  assert.equal(c.coinsUpTo(COURSE_LENGTH), c.totalCoins);
  assert.ok(c.coinsUpTo(2500) < c.totalCoins);
});

test('kill scoring: RAVE within 5s, KILL MONGER on third kill', () => {
  const p = { kills: 0, killTimes: [] };
  assert.deepEqual(registerKill(p, 1000), { points: POINTS.kill, bonuses: [] });
  const second = registerKill(p, 3000);
  assert.deepEqual(second.bonuses.map((b) => b.name), ['RAVE']);
  const third = registerKill(p, 20000); // slow third kill: monger only
  assert.deepEqual(third.bonuses.map((b) => b.name), ['KILL MONGER']);
  assert.equal(third.points, POINTS.kill + POINTS.killMonger);
  const fourth = registerKill(p, 21000);
  assert.deepEqual(fourth.bonuses.map((b) => b.name), ['RAVE']);
});

test('last survivor with fewer points than someone else LOSES', () => {
  const r = decideWinner([
    { id: 1, total: 100, alive: true },
    { id: 2, total: 900, alive: false },
    { id: 3, total: 300, alive: false },
  ]);
  assert.deepEqual(r, { winnerId: 2, survivorId: 1, survivorLost: true });
});

test('last survivor with top (or tied) score wins; no survivor -> top scorer', () => {
  assert.equal(decideWinner([{ id: 1, total: 500, alive: true }, { id: 2, total: 500, alive: false }]).winnerId, 1);
  assert.equal(decideWinner([{ id: 1, total: 5, alive: false }, { id: 2, total: 50, alive: false }]).winnerId, 2);
});

test('arena: bullets kill after 3 hits, killer is credited, ammo is consumed', () => {
  const arena = new Arena([
    { id: 1, name: 'a', ammo: 10, baseScore: 0 },
    { id: 2, name: 'b', ammo: 0, baseScore: 0 },
  ]);
  const a = arena.players.get(1);
  const b = arena.players.get(2);
  a.x = 0; a.z = 0; b.x = 10; b.z = 0;
  arena.setInput(1, { mx: 0, mz: 0, aim: 0, fire: true });
  for (let i = 0; i < 80 && arena.players.get(2).alive; i++) arena.tick(0.05);
  assert.equal(b.alive, false);
  assert.equal(a.kills, 1);
  assert.equal(a.ammo, 7);
  assert.equal(arena.isOver(), true);
  const res = arena.results();
  assert.equal(res.winnerId, 1);
  assert.equal(res.rows.find((r) => r.id === 1).killPoints, POINTS.kill);
});

test('arena: a player with no ammo cannot shoot; storm eventually kills campers', () => {
  const arena = new Arena([
    { id: 1, name: 'a', ammo: 0, baseScore: 0 },
    { id: 2, name: 'b', ammo: 0, baseScore: 0 },
  ]);
  arena.setInput(1, { mx: 0, mz: 0, aim: 0, fire: true });
  for (let i = 0; i < 10; i++) arena.tick(0.05);
  assert.equal(arena.bullets.length, 0);
  for (let i = 0; i < (ARENA.stormEndS + 40) / 0.1 && !arena.isOver(); i++) arena.tick(0.1);
  assert.equal(arena.isOver(), true);
});
