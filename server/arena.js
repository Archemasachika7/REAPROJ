import { POINTS, registerKill, decideWinner } from '../shared/scoring.js';

export const ARENA = {
  radius: 55,
  minRadius: 2,
  stormStartS: 20,
  stormEndS: 110,
  stormDps: 9,
  speed: 9,
  maxHp: 100,
  damage: 34,
  fireCooldown: 0.35,
  bulletSpeed: 70,
  bulletLife: 1.2,
  hitRadius: 0.9,
};

/**
 * Server-authoritative arena. `players`: [{id, name, ammo, baseScore, breakdown}]
 * `baseScore` is what they banked in the race (coins + place bonus).
 */
export class Arena {
  constructor(players, now = () => Date.now()) {
    this.now = now;
    this.t = 0;
    this.nextBullet = 1;
    this.bullets = [];
    this.events = [];
    this.players = new Map();
    const n = players.length;
    players.forEach((p, i) => {
      const a = (i / n) * Math.PI * 2;
      this.players.set(p.id, {
        id: p.id,
        name: p.name,
        x: Math.cos(a) * ARENA.radius * 0.72,
        z: Math.sin(a) * ARENA.radius * 0.72,
        aim: a + Math.PI,
        hp: ARENA.maxHp,
        ammo: p.ammo,
        alive: true,
        baseScore: p.baseScore,
        coinPoints: p.coinPoints || 0,
        placeBonus: p.placeBonus || 0,
        killPoints: 0,
        bonusPoints: 0,
        kills: 0,
        killTimes: [],
        cooldown: 0,
        input: { mx: 0, mz: 0, aim: a + Math.PI, fire: false },
      });
    });
  }

  radius() {
    if (this.t < ARENA.stormStartS) return ARENA.radius;
    const k = Math.min(1, (this.t - ARENA.stormStartS) / (ARENA.stormEndS - ARENA.stormStartS));
    return ARENA.radius + (ARENA.minRadius - ARENA.radius) * k;
  }

  setInput(id, inp) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    const clamp = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
    p.input = {
      mx: clamp(inp.mx),
      mz: clamp(inp.mz),
      aim: Number.isFinite(inp.aim) ? inp.aim : p.input.aim,
      fire: !!inp.fire,
    };
  }

  remove(id) {
    const p = this.players.get(id);
    if (p && p.alive) this.#kill(p, null);
  }

  total(p) {
    return p.baseScore + p.killPoints + p.bonusPoints;
  }

  #kill(victim, killer) {
    victim.alive = false;
    victim.hp = 0;
    const ev = { type: 'kill', victim: victim.id, killer: killer ? killer.id : null, bonuses: [] };
    if (killer && killer.alive) {
      const r = registerKill(killer, this.t * 1000);
      killer.killPoints += POINTS.kill;
      killer.bonusPoints += r.points - POINTS.kill;
      ev.bonuses = r.bonuses;
      ev.points = r.points;
    }
    this.events.push(ev);
  }

  tick(dt) {
    this.t += dt;
    const R = this.radius();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const { mx, mz, aim, fire } = p.input;
      const len = Math.hypot(mx, mz) || 1;
      const k = Math.min(1, len) / len;
      p.x += mx * k * ARENA.speed * dt;
      p.z += mz * k * ARENA.speed * dt;
      const d = Math.hypot(p.x, p.z);
      const lim = ARENA.radius; // walls stay at the original edge; the storm does the shrinking
      if (d > lim) {
        p.x = (p.x / d) * lim;
        p.z = (p.z / d) * lim;
      }
      p.aim = aim;
      p.cooldown = Math.max(0, p.cooldown - dt);
      if (fire && p.cooldown === 0 && p.ammo > 0) {
        p.ammo -= 1;
        p.cooldown = ARENA.fireCooldown;
        this.bullets.push({
          id: this.nextBullet++,
          owner: p.id,
          x: p.x + Math.cos(p.aim) * 1.1,
          z: p.z + Math.sin(p.aim) * 1.1,
          vx: Math.cos(p.aim) * ARENA.bulletSpeed,
          vz: Math.sin(p.aim) * ARENA.bulletSpeed,
          life: ARENA.bulletLife,
        });
      }
      if (Math.hypot(p.x, p.z) > R) {
        p.hp -= ARENA.stormDps * dt * (this.t > ARENA.stormEndS ? 3 : 1);
        if (p.hp <= 0) this.#kill(p, null);
      }
    }
    // Bullets move in two half-steps so fast bullets can't tunnel through players.
    this.bullets = this.bullets.filter((b) => {
      for (let step = 0; step < 2; step++) {
        b.x += (b.vx * dt) / 2;
        b.z += (b.vz * dt) / 2;
        for (const p of this.players.values()) {
          if (!p.alive || p.id === b.owner) continue;
          if (Math.hypot(p.x - b.x, p.z - b.z) < ARENA.hitRadius) {
            p.hp -= ARENA.damage;
            if (p.hp <= 0) this.#kill(p, this.players.get(b.owner));
            else this.events.push({ type: 'hit', victim: p.id, killer: b.owner });
            return false;
          }
        }
      }
      b.life -= dt;
      return b.life > 0;
    });
  }

  aliveCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.alive) n++;
    return n;
  }

  isOver() {
    return this.players.size > 1 ? this.aliveCount() <= 1 : this.aliveCount() === 0;
  }

  snapshot() {
    const events = this.events;
    this.events = [];
    return {
      t: Math.round(this.t * 10) / 10,
      r: Math.round(this.radius() * 10) / 10,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        x: +p.x.toFixed(2),
        z: +p.z.toFixed(2),
        a: +p.aim.toFixed(3),
        hp: Math.max(0, Math.round(p.hp)),
        ammo: p.ammo,
        alive: p.alive,
        kills: p.kills,
        score: this.total(p),
      })),
      bullets: this.bullets.map((b) => ({ id: b.id, x: +b.x.toFixed(2), z: +b.z.toFixed(2) })),
      events,
    };
  }

  results() {
    const rows = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      kills: p.kills,
      coinPoints: p.coinPoints,
      placeBonus: p.placeBonus,
      killPoints: p.killPoints,
      bonusPoints: p.bonusPoints,
      total: this.total(p),
    }));
    return { rows, ...decideWinner(rows) };
  }
}
