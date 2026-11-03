import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3-20 letters, digits or underscores.';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return 'Password must be 8-128 characters.';
  }
  return null;
}

const hashToken = (t) => createHash('sha256').update(t).digest('hex');
const derive = (password, salt) => scryptSync(password, salt, 64);

export function createAuth(db) {
  const insertUser = db.prepare('INSERT INTO users(username, pass_salt, pass_hash, created_at) VALUES (?,?,?,?)');
  const findUser = db.prepare('SELECT id, username, pass_salt, pass_hash FROM users WHERE username = ?');
  const insertSession = db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?,?,?)');
  const findSession = db.prepare(
    'SELECT u.id AS id, u.username AS username, s.expires_at AS expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
  );
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const purge = db.prepare('DELETE FROM sessions WHERE expires_at < ?');

  function issueSession(userId) {
    const token = randomBytes(32).toString('base64url');
    insertSession.run(hashToken(token), userId, Date.now() + SESSION_TTL_MS);
    return token;
  }

  return {
    ttlSeconds: SESSION_TTL_MS / 1000,
    register(username, password) {
      const salt = randomBytes(16);
      try {
        const r = insertUser.run(username, salt, derive(password, salt), Date.now());
        return { id: Number(r.lastInsertRowid), username, token: issueSession(Number(r.lastInsertRowid)) };
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) return null;
        throw e;
      }
    },
    login(username, password) {
      const u = findUser.get(username);
      // Always run scrypt so unknown users cost the same as wrong passwords.
      const salt = u ? u.pass_salt : Buffer.alloc(16);
      const hash = derive(password, salt);
      if (!u || !timingSafeEqual(hash, u.pass_hash)) return null;
      return { id: u.id, username: u.username, token: issueSession(u.id) };
    },
    verify(token) {
      if (!token) return null;
      const row = findSession.get(hashToken(token));
      if (!row) return null;
      if (row.expires_at < Date.now()) {
        deleteSession.run(hashToken(token));
        return null;
      }
      return { id: row.id, username: row.username };
    },
    logout(token) {
      if (token) deleteSession.run(hashToken(token));
    },
    purgeExpired() {
      purge.run(Date.now());
    },
  };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Fixed-window in-memory limiter keyed by string. */
export function createLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const e = hits.get(key);
    if (!e || e.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      return true;
    }
    e.n += 1;
    return e.n <= max;
  };
}
