import { THREE } from './world.js';
import { buildCharacter } from './character.js';

const ARENA_R = 55;

export class ArenaView {
  constructor({ world, city, players, myId, send }) {
    Object.assign(this, { world, myId, send });
    this.center = world.toWorld(5000, 0); // arena sits on the course's finish point
    world.track.clear();
    world.tileZoom = 18;
    world.setFog(80, 260);
    this.group = new THREE.Group();
    this.group.position.set(this.center.x, 0, this.center.z);
    world.scene.add(this.group);

    this.meshes = new Map();
    players.forEach((p, i) => {
      const ch = buildCharacter(Number.isInteger(p.char) ? p.char : i, { name: p.name });
      ch.setArmed(true);
      ch.root.userData.char = ch;
      ch.root.userData.prev = null;
      this.group.add(ch.root);
      this.meshes.set(p.id, ch.root);
    });
    this.pool = [];
    this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
    this.bulletGeo = new THREE.SphereGeometry(0.25, 8, 6);

    this.edge = new THREE.Mesh(new THREE.RingGeometry(ARENA_R - 0.4, ARENA_R, 96), new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide }));
    this.edge.rotation.x = -Math.PI / 2; this.edge.position.y = 0.06;
    this.storm = null; this.stormR = -1;
    this.group.add(this.edge);

    this.snap = null;
    this.input = { mx: 0, mz: 0, aim: 0, fire: false };
    this.keys = new Set();
    this.mouse = new THREE.Vector2();
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.countdown = 3;
    this.#bind();
    this.timer = setInterval(() => this.#sendInput(), 40);
  }

  #bind() {
    this.kd = (e) => { this.keys.add(e.code); if (e.code === 'Space') e.preventDefault(); };
    this.ku = (e) => this.keys.delete(e.code);
    this.mm = (e) => { this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); this.hasMouse = true; };
    this.md = (e) => { if (e.button === 0) this.mouseDown = true; };
    this.mu = () => { this.mouseDown = false; };
    addEventListener('keydown', this.kd); addEventListener('keyup', this.ku);
    addEventListener('mousemove', this.mm); addEventListener('mousedown', this.md); addEventListener('mouseup', this.mu);
  }

  dispose() {
    clearInterval(this.timer);
    removeEventListener('keydown', this.kd); removeEventListener('keyup', this.ku);
    removeEventListener('mousemove', this.mm); removeEventListener('mousedown', this.md); removeEventListener('mouseup', this.mu);
    this.world.scene.remove(this.group);
    this.world.tileZoom = 17;
  }

  me() { return this.snap?.players.find((p) => p.id === this.myId); }

  #sendInput() {
    const k = this.keys;
    const mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const mz = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    const me = this.me();
    let aim = this.input.aim;
    if (me && this.hasMouse) {
      this.ray.setFromCamera(this.mouse, this.world.camera);
      const hit = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.plane, hit)) aim = Math.atan2(hit.z - this.center.z - me.z, hit.x - this.center.x - me.x);
    }
    this.input = { mx, mz, aim, fire: this.mouseDown || k.has('Space') };
    this.send({ t: 'input', ...this.input });
  }

  onSnap(s) { this.snap = s; }

  update(dt) {
    const w = this.world;
    this.countdown = Math.max(0, this.countdown - dt);
    const s = this.snap;
    if (s) {
      for (const p of s.players) {
        const m = this.meshes.get(p.id);
        if (!m) continue;
        const k = Math.min(1, dt * 18);
        const px = m.position.x, pz = m.position.z;
        m.position.x += (p.x - px) * k;
        m.position.z += (p.z - pz) * k;
        const moved = Math.hypot(m.position.x - px, m.position.z - pz) / Math.max(dt, 1e-3);
        m.rotation.y = Math.atan2(-Math.cos(p.a), -Math.sin(p.a)); // model faces -Z; point it along the aim
        m.userData.char.update(dt, { t: performance.now() / 1000, speedK: Math.min(1.3, moved / 9), aiming: p.alive, dead: !p.alive });
        m.userData.char.setArmed(p.ammo > 0);
        m.visible = true;
      }
      while (this.pool.length < s.bullets.length) {
        const b = new THREE.Mesh(this.bulletGeo, this.bulletMat);
        this.group.add(b); this.pool.push(b);
      }
      this.pool.forEach((b, i) => {
        const d = s.bullets[i];
        b.visible = !!d;
        if (d) b.position.set(d.x, 1.2, d.z);
      });
      if (Math.abs(s.r - this.stormR) > 0.4) this.#rebuildStorm(s.r);
    }
    const me = this.me();
    const focus = me?.alive ? this.meshes.get(this.myId).position : new THREE.Vector3(0, 0, 0);
    const fx = this.center.x + focus.x, fz = this.center.z + focus.z;
    w.camera.position.set(fx, 34, fz + 20);
    w.camera.lookAt(fx, 0, fz);
    w.updateTiles(fx, fz, 220);
  }

  #rebuildStorm(r) {
    this.stormR = r;
    if (this.storm) { this.group.remove(this.storm); this.storm.geometry.dispose(); }
    this.storm = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.5, r), 400, 96),
      new THREE.MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
    );
    this.storm.rotation.x = -Math.PI / 2; this.storm.position.y = 0.08;
    this.group.add(this.storm);
  }
}
