import * as THREE from '/vendor/three/three.module.js';
import { LANE_W, COURSE_LENGTH } from '/shared/course.js';

const M_PER_DEG_LAT = 111132;
const TILE_Z = 17;
const rad = Math.PI / 180;

function tileLon(x, z) { return (x / 2 ** z) * 360 - 180; }
function tileLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return Math.atan(Math.sinh(n)) / rad;
}

function fallbackTexture(tx, ty) {
  // Used when imagery is unreachable: a procedural "city block" look so the game still plays.
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  let seed = (tx * 73856093) ^ (ty * 19349663);
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  g.fillStyle = '#34403a'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `hsl(${90 + rnd() * 60},${10 + rnd() * 20}%,${22 + rnd() * 22}%)`;
    g.fillRect(rnd() * 120, rnd() * 120, 6 + rnd() * 26, 6 + rnd() * 26);
  }
  g.fillStyle = '#1b1d22';
  g.fillRect(0, 60, 128, 8); g.fillRect(60, 0, 8, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeLabel(text, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.75)';
  g.strokeText(text, 128, 44);
  g.fillStyle = color; g.fillText(text, 128, 44);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(4, 1, 1);
  s.renderOrder = 10;
  return s;
}

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1020);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x203040, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(30, 60, 20);
    this.scene.add(sun);
    this.tiles = new Map();
    this.loading = 0;
    this.loader = new THREE.TextureLoader();
    this.track = new THREE.Group();
    this.scene.add(this.track);
    this.city = null;
    this.tileZoom = TILE_Z;
    this.tileFailures = 0;
    this.tileLoads = 0;
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setFog(near, far, color = 0x9db9dd) {
    this.scene.fog = new THREE.Fog(color, near, far);
    this.scene.background = new THREE.Color(color);
  }

  setCity(city) {
    this.clearTiles();
    this.city = city;
    this.mLon = 111320 * Math.cos(city.lat * rad);
    const b = city.bearing * rad;
    this.dir = { x: Math.sin(b), z: -Math.cos(b) };
    this.right = { x: Math.cos(b), z: Math.sin(b) };
    this.track.rotation.y = -b;
    this.track.clear();
    this.tileZoom = TILE_Z;
    this.setFog(80, 400);
  }

  /** Course coordinates (s metres along, l metres lateral) -> world x/z. */
  toWorld(s, l) {
    return { x: this.dir.x * s + this.right.x * l, z: this.dir.z * s + this.right.z * l };
  }

  clearTiles() {
    for (const t of this.tiles.values()) this.#disposeTile(t);
    this.tiles.clear();
  }

  #disposeTile(t) {
    this.scene.remove(t.mesh);
    t.mesh.geometry.dispose();
    t.mesh.material.map?.dispose();
    t.mesh.material.dispose();
  }

  /** Streams satellite tiles around world position (x, z); evicts far ones. */
  updateTiles(x, z, radius = 420) {
    if (!this.city) return;
    const zoom = this.tileZoom;
    const lon = this.city.lon + x / this.mLon;
    const lat = this.city.lat - z / M_PER_DEG_LAT;
    const n = 2 ** zoom;
    const cx = Math.floor(((lon + 180) / 360) * n);
    const cy = Math.floor(((1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2) * n);
    const span = Math.ceil(radius / 200);
    const want = new Set();
    for (let dx = -span; dx <= span; dx++) {
      for (let dy = -span; dy <= span; dy++) {
        const tx = cx + dx, ty = cy + dy;
        const key = `${zoom}/${tx}/${ty}`;
        want.add(key);
        if (!this.tiles.has(key) && this.loading < 6) this.#loadTile(key, zoom, tx, ty);
      }
    }
    for (const [key, t] of this.tiles) {
      if (!want.has(key)) { this.#disposeTile(t); this.tiles.delete(key); }
    }
  }

  #loadTile(key, z, tx, ty) {
    const w = (tileLon(tx + 1, z) - tileLon(tx, z)) * this.mLon;
    const north = (tileLat(ty, z) - this.city.lat) * M_PER_DEG_LAT;
    const south = (tileLat(ty + 1, z) - this.city.lat) * M_PER_DEG_LAT;
    const h = north - south;
    const x0 = (tileLon(tx, z) - this.city.lon) * this.mLon;
    const mat = new THREE.MeshBasicMaterial({ color: 0x223028 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.4, h + 0.4), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x0 + w / 2, 0, -(south + h / 2));
    this.scene.add(mesh);
    const rec = { mesh };
    this.tiles.set(key, rec);
    this.loading++;
    this.loader.load(
      `/tiles/${z}/${tx}/${ty}.jpg`,
      (tex) => {
        this.loading--; this.tileLoads++;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
      },
      undefined,
      () => {
        this.loading--; this.tileFailures++;
        mat.map = fallbackTexture(tx, ty); mat.color.set(0xffffff); mat.needsUpdate = true;
      },
    );
  }

  get usingFallbackImagery() { return this.tileFailures > 0 && this.tileLoads === 0; }

  render() { this.renderer.render(this.scene, this.camera); }
}

// ---------- shared mesh factories ----------
const GEO = {
  coin: new THREE.CylinderGeometry(0.45, 0.45, 0.1, 16),
  low: new THREE.BoxGeometry(2.2, 0.9, 0.8),
  block: new THREE.BoxGeometry(2.2, 2.4, 1.2),
  barTop: new THREE.BoxGeometry(2.4, 0.7, 0.6),
  post: new THREE.BoxGeometry(0.2, 2.4, 0.4),
  body: new THREE.CapsuleGeometry(0.32, 0.7, 4, 8),
  head: new THREE.SphereGeometry(0.26, 12, 10),
};
const MAT = {
  coin: new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0x8a6400, metalness: 0.6, roughness: 0.3 }),
  low: new THREE.MeshStandardMaterial({ color: 0xff7a1a }),
  high: new THREE.MeshStandardMaterial({ color: 0xe33a5a }),
  block: new THREE.MeshStandardMaterial({ color: 0x59606e }),
  gun: new THREE.MeshStandardMaterial({ color: 0x18222d, emissive: 0x00c8ff, emissiveIntensity: 0.8 }),
};

export function makeItemMesh(item) {
  let m;
  switch (item.type) {
    case 'coin':
      m = new THREE.Mesh(GEO.coin, MAT.coin);
      m.rotation.x = Math.PI / 2;
      m.userData.spin = true;
      break;
    case 'low': m = new THREE.Mesh(GEO.low, MAT.low); break;
    case 'block': m = new THREE.Mesh(GEO.block, MAT.block); break;
    case 'high': {
      m = new THREE.Group();
      const bar = new THREE.Mesh(GEO.barTop, MAT.high); bar.position.y = 1.85;
      const a = new THREE.Mesh(GEO.post, MAT.high); a.position.set(-1.1, 1.2, 0);
      const b = new THREE.Mesh(GEO.post, MAT.high); b.position.set(1.1, 1.2, 0);
      m.add(bar, a, b);
      break;
    }
    case 'gun': {
      m = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 1.1), MAT.gun);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.5, 0.3), MAT.gun);
      grip.position.set(0, -0.35, -0.3);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
      m.add(body, grip, ring);
      m.userData.spin = true;
      break;
    }
    default: m = new THREE.Group();
  }
  const y = item.type === 'coin' ? 1.0 : item.type === 'gun' ? 1.2 : item.type === 'low' ? 0.45 : item.type === 'block' ? 1.2 : 0;
  m.position.set(item.lane * LANE_W, y, -item.s);
  return m;
}

export function makeRunnerMesh(color, name) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color });
  const body = new THREE.Mesh(GEO.body, mat); body.position.y = 0.85;
  const head = new THREE.Mesh(GEO.head, new THREE.MeshStandardMaterial({ color: 0xf2c9a0 })); head.position.y = 1.6;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0xffffff })); cap.position.y = 1.82;
  g.add(body, head, cap);
  g.userData.body = body;
  if (name) { const l = makeLabel(name); l.position.y = 2.7; g.add(l); }
  return g;
}

export function makePoliceCar() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 4.2), new THREE.MeshStandardMaterial({ color: 0x151a24 }));
  body.position.y = 0.7;
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2), new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }));
  top.position.set(0, 1.35, 0.2);
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.4), new THREE.MeshBasicMaterial({ color: 0xff2030 }));
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.4), new THREE.MeshBasicMaterial({ color: 0x2060ff }));
  red.position.set(-0.45, 1.75, 0.2); blue.position.set(0.45, 1.75, 0.2);
  g.add(body, top, red, blue);
  g.userData = { red, blue };
  return g;
}

export const PLAYER_COLORS = [0x00e5ff, 0xff4d8d, 0x9dff4d, 0xffb02e, 0xa56bff, 0xff5c3a, 0x4dffd2, 0xf2f2f2];
export { COURSE_LENGTH, LANE_W, THREE };
