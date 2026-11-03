// Deterministic course generation shared by browser and server.
// The server regenerates a course from its seed to validate coin/ammo claims.

export const COURSE_LENGTH = 5000; // metres (5 km)
export const LANE_W = 2.6;
export const GUN_AMMO = 6;
export const MIN_SPEED = 18;
export const MAX_SPEED = 30;

// bearing: degrees clockwise from north. Courses are straight 5 km runs laid over
// real satellite imagery starting at (lat, lon); the route is approximate and is
// not guaranteed to follow a street.
export const CITIES = [
  { id: 'nyc', name: 'New York', lat: 40.7527, lon: -73.9772, bearing: 29 },
  { id: 'paris', name: 'Paris', lat: 48.8738, lon: 2.295, bearing: 120 },
  { id: 'dubai', name: 'Dubai', lat: 25.1972, lon: 55.2744, bearing: 245 },
  { id: 'tokyo', name: 'Tokyo', lat: 35.6595, lon: 139.7004, bearing: 340 },
  { id: 'london', name: 'London', lat: 51.5014, lon: -0.1419, bearing: 75 },
  { id: 'rio', name: 'Rio de Janeiro', lat: -22.9711, lon: -43.1822, bearing: 300 },
];

export function cityById(id) {
  return CITIES.find((c) => c.id === id) || null;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Speed (m/s) a runner moves at distance s when not stumbling. */
export function baseSpeed(s) {
  const k = Math.min(1, Math.max(0, s / COURSE_LENGTH));
  return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * k;
}

/**
 * Item types: coin | gun | low (jump over) | high (roll under) | block (dodge)
 * lane in {-1,0,1}; s is metres along the course.
 */
export function generateCourse(seed) {
  const rand = mulberry32(seed);
  const items = [];
  let id = 0;
  let s = 90;
  let lastGun = 0;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  while (s < COURSE_LENGTH - 40) {
    const r = rand();
    if (s - lastGun > 320 || (s - lastGun > 150 && r > 0.93)) {
      items.push({ id: id++, s, lane: pick([-1, 0, 1]), type: 'gun' });
      lastGun = s;
      s += 14;
    } else if (r < 0.34) {
      const lane = pick([-1, 0, 1]);
      const n = 5 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) items.push({ id: id++, s: s + i * 2.6, lane, type: 'coin' });
      s += n * 2.6 + 10;
    } else if (r < 0.7) {
      const lanes = [-1, 0, 1];
      const blocked = rand() < 0.35 ? 2 : 1; // never block all three lanes
      for (let i = 0; i < blocked; i++) {
        const lane = lanes.splice(Math.floor(rand() * lanes.length), 1)[0];
        items.push({ id: id++, s, lane, type: pick(['low', 'high', 'block']) });
      }
      s += 16 + rand() * 10;
    } else {
      s += 12 + rand() * 10;
    }
  }

  items.sort((a, b) => a.s - b.s || a.id - b.id);
  const coinS = items.filter((i) => i.type === 'coin').map((i) => i.s);
  const gunS = items.filter((i) => i.type === 'gun').map((i) => i.s);
  const countUpTo = (arr, d) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= d) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return {
    seed,
    items,
    totalCoins: coinS.length,
    totalGuns: gunS.length,
    coinsUpTo: (d) => countUpTo(coinS, d),
    ammoUpTo: (d) => countUpTo(gunS, d) * GUN_AMMO,
  };
}
