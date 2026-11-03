import { THREE, LANE_W, COURSE_LENGTH, makeItemMesh } from './world.js';
import { buildCharacter } from './character.js';
import { POLICE } from '/shared/characters.js';
import { baseSpeed, GUN_AMMO } from '/shared/course.js';

const JUMP_V = 11, GRAVITY = 30, ROLL_T = 0.6, STUMBLE_T = 1.2, LANE_SPEED = 14;
const POLICE_START_GAP = 10, POLICE_MAX_GAP = 14, POLICE_FACTOR = 0.95, STUMBLE_SPEED = 0.75;
export const POLICE_MAX = POLICE_MAX_GAP;

export class Runner {
  /**
   * mode: 'single' (police chase) | 'race' (multiplayer, ghosts of other players)
   * callbacks: onEnd({won, reason, coins, ammo, policeHits, timeMs}), onPos(state)
   */
  constructor({ world, course, mode, myId, charId = 0, callbacks }) {
    Object.assign(this, { world, course, mode, myId, cb: callbacks });
    this.s = 0; this.l = 0; this.lane = 0; this.y = 0; this.vy = 0;
    this.roll = 0; this.stumble = 0; this.invuln = 0;
    this.coins = 0; this.ammo = 0; this.policeHits = 0;
    this.gap = POLICE_START_GAP;
    this.done = false; this.elapsed = 0; this.countdown = 0;
    this.nextItem = 0; this.active = [];
    this.ghosts = new Map();
    this.fireCd = 0;
    this.lastPosSent = 0;
    this.shake = 0;

    const track = world.track;
    track.clear();
    this.char = buildCharacter(charId);
    this.mesh = this.char.root;
    track.add(this.mesh);
    this.#buildTrackStrip();
    if (mode === 'single') {
      this.officers = [0, 1].map(() => {
        const o = buildCharacter(POLICE);
        o.setArmed(true);
        o.lane = 0;
        track.add(o.root);
        return o;
      });
      this.siren = new THREE.PointLight(0xff2030, 40, 18);
      track.add(this.siren);
    }
    this.#bindInput();
  }

  #buildTrackStrip() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(15,18,26,0.55)'; g.fillRect(0, 0, 64, 128);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const x of [21, 42]) g.fillRect(x - 1, 0, 2, 64);
    g.fillStyle = '#00e5ff'; g.fillRect(0, 0, 3, 128); g.fillRect(61, 0, 3, 128);
    this.stripTex = new THREE.CanvasTexture(c);
    this.stripTex.wrapT = THREE.RepeatWrapping;
    this.stripTex.repeat.set(1, 260 / 16);
    this.strip = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_W * 3, 260),
      new THREE.MeshBasicMaterial({ map: this.stripTex, transparent: true }),
    );
    this.strip.rotation.x = -Math.PI / 2;
    this.strip.position.y = 0.04;
    this.world.track.add(this.strip);
  }

  #bindInput() {
    this.onKey = (e) => {
      if (this.done || e.repeat) return;
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': this.lane = Math.max(-1, this.lane - 1); break;
        case 'ArrowRight': case 'KeyD': this.lane = Math.min(1, this.lane + 1); break;
        case 'ArrowUp': case 'KeyW': this.#jump(); break;
        case 'ArrowDown': case 'KeyS': this.#roll(); break;
        case 'Space': this.#fire(); e.preventDefault(); break;
        default: return;
      }
      e.preventDefault();
    };
    let t0 = null;
    this.onTouchStart = (e) => { t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
    this.onTouchEnd = (e) => {
      if (!t0 || this.done) return;
      const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
      if (Math.hypot(dx, dy) < 24) this.#fire();
      else if (Math.abs(dx) > Math.abs(dy)) this.lane = Math.max(-1, Math.min(1, this.lane + Math.sign(dx)));
      else if (dy < 0) this.#jump(); else this.#roll();
      t0 = null;
    };
    addEventListener('keydown', this.onKey);
    addEventListener('touchstart', this.onTouchStart, { passive: true });
    addEventListener('touchend', this.onTouchEnd, { passive: true });
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    removeEventListener('touchstart', this.onTouchStart);
    removeEventListener('touchend', this.onTouchEnd);
  }

  #started() { return this.countdown <= 0; }
  #jump() { if (this.#started() && this.y === 0 && this.roll <= 0) this.vy = JUMP_V; }
  #roll() { if (!this.#started()) return; if (this.y > 0) this.vy = -22; else this.roll = ROLL_T; }
  #fire() {
    if (this.mode !== 'single' || !this.#started() || this.ammo <= 0 || this.fireCd > 0 || this.gap >= POLICE_MAX_GAP) return;
    this.ammo--; this.policeHits++; this.fireCd = 0.3;
    this.gap = Math.min(POLICE_MAX_GAP, this.gap + 4);
    this.muzzle = 0.12;
  }

  start(countdownMs) { this.countdown = countdownMs / 1000; }

  setGhosts(list) {
    for (const p of list) {
      if (p.id === this.myId) continue;
      let g = this.ghosts.get(p.id);
      if (!g) {
        const idx = this.ghosts.size + 1;
        const ch = buildCharacter(Number.isInteger(p.char) ? p.char : idx, { name: p.name || '' });
        g = { char: ch, mesh: ch.root, s: p.s, l: p.l, y: p.y };
        this.world.track.add(g.mesh);
        this.ghosts.set(p.id, g);
      }
      Object.assign(g, { ts: p.s, tl: p.l, ty: p.y, fin: p.fin });
    }
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    if (this.countdown > 0) {
      this.countdown -= dt;
    } else if (!this.done) {
      this.elapsed += dt;
      this.#step(dt);
    }
    this.#render(dt);
  }

  #step(dt) {
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.stumble = Math.max(0, this.stumble - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.roll = Math.max(0, this.roll - dt);
    const sp = baseSpeed(this.s) * (this.stumble > 0 ? STUMBLE_SPEED : 1);
    this.speed = sp;
    this.s += sp * dt;

    const target = this.lane * LANE_W;
    const d = target - this.l;
    this.l += Math.sign(d) * Math.min(Math.abs(d), LANE_SPEED * dt);

    if (this.y > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; }
    }

    // activate items entering the window ahead; retire those behind
    const items = this.course.items;
    while (this.nextItem < items.length && items[this.nextItem].s < this.s + 170) {
      const it = items[this.nextItem++];
      const mesh = makeItemMesh(it);
      this.world.track.add(mesh);
      this.active.push({ it, mesh, gone: false });
    }
    this.active = this.active.filter((a) => {
      if (a.gone || a.it.s < this.s - 25) { this.world.track.remove(a.mesh); return false; }
      return true;
    });

    for (const a of this.active) {
      const ds = Math.abs(a.it.s - this.s);
      if (ds > 1.1) continue;
      const dl = Math.abs(a.it.lane * LANE_W - this.l);
      if (dl > 1.2) continue;
      switch (a.it.type) {
        case 'coin': this.coins++; a.gone = true; break;
        case 'gun': this.ammo += GUN_AMMO; a.gone = true; this.gunFlash = 0.6; break;
        case 'low': if (this.y < 1.0) this.#hit(a); break;
        case 'high': if (this.roll <= 0) this.#hit(a); break;
        case 'block': this.#hit(a); break;
        default:
      }
    }

    if (this.mode === 'single') {
      this.gap = Math.min(POLICE_MAX_GAP, this.gap + (sp - baseSpeed(this.s) * POLICE_FACTOR) * dt);
      if (this.gap <= 0) return this.#end(false, 'busted');
    }
    if (this.mode === 'race') {
      this.lastPosSent += dt;
      if (this.lastPosSent >= 0.1) { this.lastPosSent = 0; this.cb.onPos?.(this.state()); }
    }
    if (this.s >= COURSE_LENGTH) {
      this.s = COURSE_LENGTH;
      if (this.mode === 'race') this.cb.onPos?.(this.state());
      this.#end(true, 'finished');
    }
  }

  #hit(a) {
    if (this.invuln > 0) return;
    this.stumble = STUMBLE_T; this.invuln = STUMBLE_T; this.shake = 0.35;
    if (this.mode === 'single') this.gap -= 3;
    a.mesh.visible = false; a.gone = true;
    this.cb.onStumble?.();
  }

  #end(won, reason) {
    if (this.done) return;
    this.done = true;
    this.reason = reason;
    this.cb.onEnd({ won, reason, coins: this.coins, ammo: this.ammo, policeHits: this.policeHits, timeMs: Math.round(this.elapsed * 1000) });
  }

  state() { return { s: this.s, l: this.l, y: this.y, coins: this.coins, ammo: this.ammo }; }

  #render(dt) {
    const w = this.world, t = performance.now() / 1000;
    const started = this.countdown <= 0;
    this.mesh.position.set(this.l, this.y, -this.s);
    this.mesh.rotation.z = (this.lane * LANE_W - this.l) * -0.06;
    this.mesh.rotation.y = (this.lane * LANE_W - this.l) * 0.05;
    this.mesh.visible = this.invuln <= 0 || Math.floor(t * 14) % 2 === 0;
    this.muzzle = Math.max(0, (this.muzzle || 0) - dt);
    this.char.setArmed(this.ammo > 0);
    this.char.update(dt, {
      t, speedK: this.done ? 0 : (this.speed || 18) / 24,
      idle: !started || (this.done && this.reason === 'finished'),
      airborne: this.y > 0.05, rollP: this.roll > 0 ? 1 - this.roll / ROLL_T : 0,
      stumble: this.stumble > 0, dead: this.done && this.reason === 'busted', shootBack: this.muzzle > 0,
    });

    this.strip.position.set(0, 0.04, -(this.s + 100));
    this.stripTex.offset.y = (this.s % 16) / 16;

    for (const a of this.active) if (a.mesh.userData.spin) a.mesh.rotation.y = t * 3;

    if (this.officers) {
      // Visual distance is compressed so the pursuers stay inside the chase camera's view.
      const vd = 3.4 + Math.max(0, this.gap) * 0.25;
      const flash = Math.floor(t * 8) % 2 === 0;
      this.officers.forEach((o, i) => {
        const want = this.l + (i === 0 ? -0.55 : 0.55);
        o.lane += (want - o.lane) * Math.min(1, dt * 3);
        o.root.position.set(o.lane, 0, -(this.s - vd - i * 0.9));
        o.update(dt, { t: t + i * 0.4, speedK: this.done && this.reason === 'busted' ? 0 : 1.15, idle: this.done && this.reason === 'busted' });
      });
      this.siren.color.set(flash ? 0xff2030 : 0x2060ff);
      this.siren.position.set(this.l, 3, -(this.s - vd));
    }

    for (const g of this.ghosts.values()) {
      if (g.ts === undefined) continue;
      const k = Math.min(1, dt * 10);
      g.s += (g.ts - g.s) * k; g.l += (g.tl - g.l) * k; g.y += (g.ty - g.y) * k;
      g.mesh.position.set(g.l, g.y, -g.s);
      g.char.update(dt, { t, speedK: g.fin ? 0 : 1, idle: !!g.fin, airborne: g.y > 0.3 });
      g.mesh.visible = g.s > this.s - 40 && g.s < this.s + 200;
    }

    // chase camera in world space
    this.shake = Math.max(0, this.shake - dt);
    const cam = w.toWorld(this.s - 9.5, this.l * 0.6);
    const look = w.toWorld(this.s + 12, this.l * 0.6);
    const jx = this.shake > 0 ? (Math.random() - 0.5) * 0.4 : 0;
    w.camera.position.set(cam.x + jx, 4.2 + this.y * 0.4, cam.z);
    w.camera.lookAt(look.x, 0.9, look.z);
    w.updateTiles(cam.x, cam.z, 420);
  }
}
