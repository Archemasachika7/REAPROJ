// Scoring rules. Constants are the single source of truth for client and server.
//
// Interpretation of the design brief:
//  - KILL MONGER: a one-time bonus when a player reaches 3 arena kills.
//  - RAVE (rampage): bonus every time a kill lands within 5 s of the previous one.

export const POINTS = {
  coin: 10,
  kill: 100,
  killMonger: 300,
  killMongerAt: 3,
  rave: 150,
  raveWindowMs: 5000,
  finishBonus: [300, 150, 75], // by finishing place in a multiplayer race
  policeHit: 25, // single mode: shot that pushes the police back
  singleFinish: 1000,
};

export function placeBonus(place) {
  return POINTS.finishBonus[place - 1] || 0;
}

/**
 * Registers a kill on `p` ({kills, killTimes[]}) at time `nowMs`.
 * Returns {points, bonuses:[{name, points}]} and mutates p.
 */
export function registerKill(p, nowMs) {
  const bonuses = [];
  const prev = p.killTimes.length ? p.killTimes[p.killTimes.length - 1] : null;
  p.kills += 1;
  p.killTimes.push(nowMs);
  let points = POINTS.kill;
  if (prev !== null && nowMs - prev <= POINTS.raveWindowMs) {
    bonuses.push({ name: 'RAVE', points: POINTS.rave });
  }
  if (p.kills === POINTS.killMongerAt) {
    bonuses.push({ name: 'KILL MONGER', points: POINTS.killMonger });
  }
  for (const b of bonuses) points += b.points;
  return { points, bonuses };
}

/**
 * Last survivor wins ONLY if their total is not beaten by anyone else's.
 * Otherwise the survivor loses and the highest scorer wins.
 * players: [{id, total, alive}]
 */
export function decideWinner(players) {
  if (!players.length) return { winnerId: null, survivorId: null, survivorLost: false };
  const survivors = players.filter((p) => p.alive);
  const top = players.reduce((best, p) => (p.total > best.total ? p : best), players[0]);
  if (survivors.length === 1) {
    const s = survivors[0];
    const beaten = players.some((p) => p.id !== s.id && p.total > s.total);
    return beaten
      ? { winnerId: top.id, survivorId: s.id, survivorLost: true }
      : { winnerId: s.id, survivorId: s.id, survivorLost: false };
  }
  return { winnerId: top.id, survivorId: null, survivorLost: false };
}
