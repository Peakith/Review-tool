'use strict';
const crypto = require('node:crypto');
const { now } = require('./db');
const { HttpError } = require('./status');

const COOKIE = 'rt_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Vergelijking in constante tijd (via hashes, dus ook bij ongelijke lengte). */
const safeEqual = (a, b) => crypto.timingSafeEqual(Buffer.from(sha256(String(a)), 'hex'), Buffer.from(sha256(String(b)), 'hex'));

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function validateNewUser({ email, name, password }) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Vul een geldig e-mailadres in');
  if (!name || !String(name).trim()) throw new HttpError(400, 'Vul een naam in');
  if (!password || String(password).length < 10) throw new HttpError(400, 'Kies een wachtwoord van minimaal 10 tekens');
}

/** role: 'admin' (beheerder, alle projecten en instellingen) of 'member' (alleen toegewezen projecten). */
function createUser(db, { email, name, password, role = 'member' }) {
  validateNewUser({ email, name, password });
  if (!['admin', 'member'].includes(role)) throw new HttpError(400, 'Onbekende rol');
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) throw new HttpError(409, 'Er bestaat al een account met dit e-mailadres');
  const info = db.prepare('INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(String(email).trim(), String(name).trim(), hashPassword(password), role, now());
  return Number(info.lastInsertRowid);
}

function setPassword(db, userId, password) {
  if (!password || String(password).length < 10) throw new HttpError(400, 'Kies een wachtwoord van minimaal 10 tekens');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function createSession(db, config, res, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires.toISOString());
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${config.secureCookies ? '; Secure' : ''}`);
}

function destroySession(db, config, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.secureCookies ? '; Secure' : ''}`);
}

function sessionUser(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.email, u.name, u.role, u.disabled_at, s.expires_at FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token));
  if (!row) return null;
  if (row.expires_at < now() || row.disabled_at) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role, isAdmin: row.role === 'admin' };
}

function requireTeam(db) {
  return (req, res, next) => {
    const user = sessionUser(db, req);
    if (!user) return next(new HttpError(401, 'Log in om verder te gaan'));
    req.user = user;
    next();
  };
}

// Eenvoudige rem op wachtwoord raden (per IP, in geheugen).
function loginLimiter() {
  const attempts = new Map();
  return {
    check(ip) {
      const entry = attempts.get(ip);
      if (entry && entry.count >= 10 && Date.now() - entry.first < 15 * 60_000) {
        throw new HttpError(429, 'Te veel inlogpogingen. Probeer het over een kwartier opnieuw.');
      }
    },
    fail(ip) {
      const entry = attempts.get(ip);
      if (!entry || Date.now() - entry.first > 15 * 60_000) attempts.set(ip, { count: 1, first: Date.now() });
      else entry.count += 1;
    },
    reset(ip) { attempts.delete(ip); },
  };
}

module.exports = {
  hashPassword, verifyPassword, sha256, randomToken, safeEqual, createUser, setPassword, createSession,
  destroySession, sessionUser, requireTeam, loginLimiter,
};
