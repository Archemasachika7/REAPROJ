import * as THREE from '/vendor/three/three.module.js';
import { CHARACTERS, POLICE } from '/shared/characters.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.02, ...extra });
const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 12);
const place = (mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); return mesh; };

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px system-ui, sans-serif'; g.textAlign = 'center';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(text, 128, 44);
  g.fillStyle = '#fff'; g.fillText(text, 128, 44);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(4, 1, 1); s.renderOrder = 10;
  return s;
}

function buildHead(d) {
  const head = new THREE.Group();
  const skin = std(d.skin);
  head.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 18), skin), 0, 0.27, 0));
  // face (character looks toward -Z)
  const eye = std(0x14141a);
  for (const x of [-0.09, 0.09]) head.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), eye), x, 0.3, -0.235));
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), std(d.hairColor || 0x2b1b12));
  for (const x of [-0.09, 0.09]) head.add(place(brow.clone(), x, 0.355, -0.245));
  head.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.018, 0.02), std(0x7a2f2f)), 0, 0.17, -0.245));
  head.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), skin), 0, 0.25, -0.265)); // nose
  for (const x of [-0.26, 0.26]) head.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skin), x, 0.26, 0)); // ears

  const hair = std(d.hairColor || 0x222222);
  if (d.hair === 'short') head.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.275, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), hair), 0, 0.28, 0.02));
  if (d.hair === 'spiky') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 6), hair);
      spike.position.set(Math.cos(a) * 0.16, 0.5, Math.sin(a) * 0.16);
      spike.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      head.add(spike);
    }
    head.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), hair), 0, 0.28, 0.02));
  }
  if (d.hair === 'ponytail') {
    head.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.275, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hair), 0, 0.28, 0.02));
    const tail = place(new THREE.Mesh(cap(0.07, 0.3), hair), 0, 0.2, 0.3); tail.rotation.x = -0.5; head.add(tail);
    head.userData.tail = tail;
  }
  if (d.hair === 'bob') head.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.29, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.72), hair), 0, 0.26, 0.03));

  const hat = std(d.hatColor);
  if (d.hat === 'cap' || d.hat === 'capBack') {
    head.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.285, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), hat), 0, 0.3, 0));
    const brim = place(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.24), hat), 0, 0.37, d.hat === 'cap' ? -0.3 : 0.3);
    head.add(brim);
    if (d.hat === 'cap') head.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 12), std(0xffd24a)), 0, 0.46, -0.27).rotateX(Math.PI / 2.4));
  }
  if (d.hat === 'beanie') {
    head.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.285, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hat), 0, 0.3, 0));
    head.add(place(new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.04, 8, 24), std(0xff7a1a)), 0, 0.33, 0).rotateX(Math.PI / 2));
    head.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), std(0xff7a1a)), 0, 0.6, 0));
  }
  if (d.hat === 'bucket') {
    head.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.2, 18), hat), 0, 0.46, 0));
    head.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.025, 24), hat), 0, 0.37, 0));
  }
  if (d.hat === 'hood') {
    head.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.31, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), hat), 0, 0.25, 0.05));
  }
  if (d.extra === 'headphones') {
    head.add(place(new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.03, 8, 24, Math.PI), std(0x1c1c24)), 0, 0.28, 0));
    for (const x of [-0.27, 0.27]) head.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 14), std(0x00e5ff, { emissive: 0x00a0c0 })), x, 0.27, 0).rotateZ(Math.PI / 2));
  }
  if (d.extra === 'shades') {
    const lens = std(0x0a0a10, { roughness: 0.2, metalness: 0.5 });
    for (const x of [-0.095, 0.095]) head.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.085, 0.03), lens), x, 0.3, -0.245));
    head.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.03), lens), 0, 0.31, -0.25));
  }
  return head;
}

/**
 * Builds a rigged low-poly runner facing -Z with feet at y=0.
 * Returns { root, update(dt, state), setArmed(bool) }.
 * state: { t, speedK, airborne, rollP, stumble, dead, idle, aiming, shootBack }
 */
export function buildCharacter(def, { name = '' } = {}) {
  const d = typeof def === 'number' ? CHARACTERS[def % CHARACTERS.length] : def || POLICE;
  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 0.95; root.add(body);

  const topM = std(d.top), sleeveM = std(d.sleeve), pantsM = std(d.pants), skinM = std(d.skin), shoeM = std(d.shoes);

  // torso
  const torso = new THREE.Mesh(cap(0.27, 0.28), topM);
  torso.scale.set(1.12, 1, 0.78); torso.position.y = 0.4; body.add(torso);
  if (d.hat === 'hood') { const h = place(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 8, 16), topM), 0, 0.72, 0.1); h.rotation.x = 1.2; body.add(h); }
  if (d.extra === 'scarf') body.add(place(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 8, 16), std(0xf5e6c8)), 0, 0.72, 0).rotateX(Math.PI / 2));
  if (d === POLICE) { // badge + belt + tie
    body.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), std(0xffd24a)), 0.12, 0.5, -0.215));
    const belt = place(new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.06, 16), std(0x0a0a0e)), 0, 0.12, 0);
    belt.scale.set(1.1, 1, 0.8);
    body.add(belt);
    body.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.02), std(0x0a0a0e)), 0, 0.5, -0.215));
  }
  // backpack
  const pack = place(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.46, 0.2), std(d.pack)), 0, 0.42, 0.26); body.add(pack);
  body.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.04), std(0x111111)), 0, 0.3, 0.37));

  // head
  const neck = new THREE.Group(); neck.position.y = 0.74; body.add(neck);
  const head = buildHead(d); neck.add(head);

  // arms
  const mkArm = (side) => {
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.37, 0.64, 0);
    shoulder.add(place(new THREE.Mesh(cap(0.095, 0.2), sleeveM), 0, -0.2, 0));
    const elbow = new THREE.Group(); elbow.position.y = -0.38; shoulder.add(elbow);
    elbow.add(place(new THREE.Mesh(cap(0.085, 0.18), sleeveM), 0, -0.16, 0));
    elbow.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), skinM), 0, -0.36, 0));
    body.add(shoulder);
    return { shoulder, elbow };
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // gun (right hand)
  const gun = new THREE.Group();
  const gunM = std(0x161b22, { metalness: 0.6, roughness: 0.35 });
  gun.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.34), gunM), 0, -0.36, -0.14));
  gun.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.07), gunM), 0, -0.45, -0.02));
  gun.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.1), std(0x00e5ff, { emissive: 0x00e5ff })), 0, -0.31, -0.3));
  gun.visible = false;
  armR.elbow.add(gun);

  // legs
  const mkLeg = (side) => {
    const hip = new THREE.Group(); hip.position.set(side * 0.16, 0, 0);
    hip.add(place(new THREE.Mesh(cap(0.13, 0.32), pantsM), 0, -0.25, 0));
    const knee = new THREE.Group(); knee.position.y = -0.5; hip.add(knee);
    knee.add(place(new THREE.Mesh(cap(0.11, 0.26), pantsM), 0, -0.21, 0));
    knee.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.36), shoeM), 0, -0.44, -0.05));
    knee.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.04, 0.37), std(0xffffff)), 0, -0.5, -0.05));
    body.add(hip);
    return { hip, knee };
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  // soft blob shadow
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.05; root.add(shadow);

  if (name) { const l = makeLabel(name); l.position.y = 2.75; root.add(l); }

  // damped pose
  const P = { bodyX: 0, bodyY: 0, bodyZ: 0, hipY: 0.95, lThigh: 0, rThigh: 0, lKnee: 0, rKnee: 0, lArm: 0, rArm: 0, lElbow: 0, rElbow: 0, lArmZ: 0, rArmZ: 0, head: 0, headZ: 0, armed: 0 };
  const T = { ...P };

  function update(dt, st = {}) {
    const t = st.t ?? performance.now() / 1000;
    const k = 1 - Math.exp(-dt * 20);
    const rate = (st.speedK ?? 1) * 11;
    const ph = t * rate;
    const sn = Math.sin(ph), cs = Math.cos(ph);
    const run = st.idle || st.dead ? 0 : Math.min(1, st.speedK ?? 1);

    // running base
    T.bodyX = -0.2 * run; T.bodyY = 0; T.bodyZ = 0; T.hipY = 0.95 + Math.abs(cs) * 0.06 * run;
    T.lThigh = sn * 1.0 * run; T.rThigh = -sn * 1.0 * run;
    T.lKnee = -(0.6 + 0.6 * Math.sin(ph + 1.6)) * run; T.rKnee = -(0.6 + 0.6 * Math.sin(ph + 1.6 + Math.PI)) * run;
    T.lArm = -sn * 0.95 * run; T.rArm = sn * 0.95 * run; T.lElbow = 1.1 * run; T.rElbow = 1.1 * run;
    T.lArmZ = -0.08; T.rArmZ = 0.08; T.head = 0.1 * run; T.headZ = 0;

    if (st.idle) { // breathing
      const b = Math.sin(t * 2.2);
      T.hipY = 0.95 + b * 0.012; T.lArm = 0.05 + b * 0.03; T.rArm = 0.05 + b * 0.03; T.lElbow = 0.2; T.rElbow = 0.2; T.head = Math.sin(t * 0.9) * 0.05;
    }
    if (st.airborne) { // stride-leap
      T.lThigh = 1.1; T.rThigh = -0.35; T.lKnee = -1.3; T.rKnee = -0.5;
      T.lArm = 2.5; T.rArm = 2.3; T.lElbow = 0.3; T.rElbow = 0.3; T.lArmZ = -0.35; T.rArmZ = 0.35; T.bodyX = -0.1;
    }
    if (st.rollP > 0) { // forward somersault, tucked
      const p = Math.min(1, st.rollP);
      T.bodyX = -p * Math.PI * 2; T.hipY = 0.55;
      T.lThigh = T.rThigh = 1.9; T.lKnee = T.rKnee = -2.1; T.lArm = T.rArm = 1.3; T.lElbow = T.rElbow = 1.6;
    }
    if (st.stumble) { // thrown off balance
      const f = Math.sin(t * 28);
      T.bodyX = 0.35; T.lArm = 2.3 + f * 0.4; T.rArm = 2.3 - f * 0.4; T.lArmZ = -0.7; T.rArmZ = 0.7; T.lElbow = 0.4; T.rElbow = 0.4;
      T.lThigh = 0.6 + f * 0.3; T.rThigh = -0.2 - f * 0.3; T.head = -0.3;
    }
    if (st.aiming) { // arena: gun forward, legs follow movement
      T.rArm = 1.55; T.rElbow = 0.05; T.lArm = 1.35; T.lElbow = 0.5; T.lArmZ = 0.35; T.rArmZ = 0; T.bodyX = -0.05 * (1 - run) - 0.1 * run;
    }
    if (st.shootBack) { // single mode: turn and fire at the chasers
      T.bodyY = 2.5; T.rArm = 1.55; T.rElbow = 0.05; T.lArm = 1.2; T.lElbow = 0.6; T.bodyX = -0.1;
    }
    if (st.dead) { T.bodyX = 1.45; T.hipY = 0.3; T.lArm = 2.6; T.rArm = 2.2; T.lArmZ = -0.9; T.rArmZ = 0.9; T.lThigh = 0.2; T.rThigh = -0.1; T.lKnee = T.rKnee = -0.2; }

    for (const key of Object.keys(T)) if (key !== 'armed') P[key] += (T[key] - P[key]) * k;
    // roll is a continuous rotation; do not damp across the wrap
    if (st.rollP > 0) P.bodyX = T.bodyX;

    body.position.y = P.hipY;
    body.rotation.set(P.bodyX, P.bodyY, P.bodyZ);
    legL.hip.rotation.x = P.lThigh; legR.hip.rotation.x = P.rThigh;
    legL.knee.rotation.x = P.lKnee; legR.knee.rotation.x = P.rKnee;
    armL.shoulder.rotation.set(P.lArm, 0, P.lArmZ); armR.shoulder.rotation.set(P.rArm, 0, P.rArmZ);
    armL.elbow.rotation.x = P.lElbow; armR.elbow.rotation.x = P.rElbow;
    neck.rotation.set(P.head, 0, 0);
    if (head.userData.tail) head.userData.tail.rotation.x = -0.5 + Math.sin(ph * 1.2) * 0.35 * run;
    shadow.scale.setScalar(st.airborne ? 0.7 : 1);
  }

  return { root, update, setArmed: (a) => { gun.visible = !!a; }, def: d };
}

/** Small standalone viewer used by the character picker. */
export class CharacterPreview {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, canvas.width / canvas.height, 0.1, 50);
    this.camera.position.set(0, 1.35, -5.2); this.camera.lookAt(0, 1.05, 0);
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x30384a, 1.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-3, 5, -4); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x00e5ff, 1.4); rim.position.set(4, 3, 4); this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.18 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; this.scene.add(floor);
    this.spin = 0; this.char = null; this.t = 0;
    this.canvas = canvas;
  }
  set(index) {
    if (this.char) this.scene.remove(this.char.root);
    this.char = buildCharacter(index);
    this.char.setArmed(true);
    this.scene.add(this.char.root);
  }
  frame(dt) {
    this.t += dt; this.spin += dt * 0.7;
    if (!this.char) return;
    this.char.root.rotation.y = Math.sin(this.spin) * 0.9;
    this.char.update(dt, { t: this.t, speedK: 0.55 });
    this.renderer.render(this.scene, this.camera);
  }
}
