'use strict';
const crypto = require('node:crypto');
const { now } = require('./db');
const auth = require('./auth');
const { HttpError } = require('./status');

/**
 * Toegang tot klantlinks: ingetrokken, verlopen en wachtwoord.
 *
 * - Soorten: share (review- en akkoordlinks), project (klantportaal per project), delivery
 *   (opleverlink) en client (klantportaal per klant).
 * - Een afgeleide reviewlink (geopend via een project- of klantportaal) valt onder de bescherming van
 *   die portaallink: wachtwoord, vervaldatum en intrekken van de portaallink gelden ook daar.
 * - Wachtwoorden worden gehasht (scrypt) en nooit in URL's of logs gezet. Na juist invoeren krijgt
 *   de browser een cookie dat alleen geldig is voor die link én die wachtwoordversie: na een nieuw
 *   wachtwoord, intrekken of verlopen geeft een oude ontgrendeling geen toegang meer.
 * - Raadpogingen worden per link en IP-adres beperkt.
 * - Een verlopen link verandert niets aan goedkeuringen of statussen; hij geeft alleen geen toegang meer.
 */
const TABLES = { share: 'share_links', project: 'project_links', delivery: 'delivery_links', client: 'client_links' };
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60_000;
const attempts = new Map();

function secret(db) {
  let row = db.prepare("SELECT value FROM app_meta WHERE key = 'link-unlock-secret'").get();
  if (!row) {
    db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('link-unlock-secret', ?)").run(crypto.randomBytes(32).toString('base64'));
    row = db.prepare("SELECT value FROM app_meta WHERE key = 'link-unlock-secret'").get();
  }
  return row.value;
}

const cookieName = (kind, id) => `rtu_${kind}_${id}`;
const unlockValue = (db, kind, link) => crypto.createHmac('sha256', secret(db)).update(`${kind}:${link.id}:${link.password_set_at || ''}`).digest('base64url');

/** De link die over de bescherming gaat (bij een afgeleide reviewlink: de portaallink). */
function protectingLink(db, kind, link) {
  if (kind === 'share' && link.project_link_id) return { kind: 'project', link: db.prepare('SELECT * FROM project_links WHERE id = ?').get(link.project_link_id) };
  if (kind === 'share' && link.client_link_id) return { kind: 'client', link: db.prepare('SELECT * FROM client_links WHERE id = ?').get(link.client_link_id) };
  return null;
}

/**
 * Taal van de klantweergave bij een link, zodat ook een foutmelding of wachtwoordscherm (vóórdat de
 * pagina gegevens heeft) in de taal van de klant kan verschijnen. Verraadt verder niets.
 */
function linkLanguage(db, kind, link) {
  let lang = null;
  if (kind === 'client') lang = db.prepare('SELECT language FROM clients WHERE id = ?').get(link.client_id)?.language;
  else {
    const projectId = kind === 'share' ? db.prepare('SELECT project_id FROM videos WHERE id = ?').get(link.video_id)?.project_id : link.project_id;
    lang = db.prepare('SELECT c.language FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?').get(projectId)?.language;
  }
  return lang === 'en' ? 'en' : 'nl';
}

/** Controleert één link: ingetrokken, verlopen, wachtwoord. Gooit een HttpError met een code. */
function checkOne(db, req, kind, link, what, lang) {
  if (!link) throw new HttpError(404, `Deze ${what} bestaat niet.`, 'not_found');
  if (link.revoked_at) throw new HttpError(410, `Deze ${what} is ingetrokken. Vraag het productieteam om een nieuwe link.`, 'revoked', { language: lang });
  if (link.expires_at && Date.parse(link.expires_at) <= Date.now()) {
    throw new HttpError(410, `Deze ${what} is verlopen. Vraag het productieteam om een nieuwe link.`, 'expired', { expiresAt: link.expires_at, language: lang });
  }
  if (link.password_hash) {
    const cookie = parse(req.headers.cookie)[cookieName(kind, link.id)];
    const expected = unlockValue(db, kind, link);
    if (!cookie || cookie.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(expected))) {
      throw new HttpError(401, 'Deze link is beveiligd met een wachtwoord.', 'password_required', { language: lang });
    }
  }
}

const WHAT = { share: 'reviewlink', project: 'projectlink', delivery: 'opleverlink', client: 'klantportaallink' };

/** Volledige controle voor een binnenkomende klantlink (inclusief de portaallink waar hij onder valt). */
function guard(db, req, kind, link) {
  if (!link) throw new HttpError(404, `Deze ${WHAT[kind]} bestaat niet.`, 'not_found');
  const lang = linkLanguage(db, kind, link);
  checkOne(db, req, kind, link, WHAT[kind], lang);
  const parent = protectingLink(db, kind, link);
  if (parent) checkOne(db, req, parent.kind, parent.link, WHAT[parent.kind], lang);
}

/** Vroegste vervaldatum die voor deze link geldt (eigen of van de portaallink waar hij onder valt). */
function expiryOf(db, kind, link) {
  const parent = protectingLink(db, kind, link);
  const dates = [link.expires_at, parent?.link?.expires_at].filter(Boolean).sort();
  return dates[0] || null;
}

function parse(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ongeldig cookie negeren */ }
  }
  return out;
}

/**
 * Ontgrendelen met een wachtwoord. token mag ook een afgeleide reviewlink zijn; dan wordt de
 * portaallink ontgrendeld waar hij onder valt.
 */
function unlock(db, config, req, res, kind, token, password) {
  const table = TABLES[kind];
  if (!table || !/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) throw new HttpError(404, 'Deze link bestaat niet.', 'not_found');
  let link = db.prepare(`SELECT * FROM ${table} WHERE token = ?`).get(token);
  if (!link) throw new HttpError(404, 'Deze link bestaat niet.', 'not_found');
  const parent = protectingLink(db, kind, link);
  // Een afgeleide link heeft zelf geen wachtwoord; het hoort bij de portaallink.
  if (parent && !link.password_hash) { kind = parent.kind; link = parent.link; }
  if (!link || link.revoked_at) throw new HttpError(410, 'Deze link is ingetrokken.', 'revoked');
  if (link.expires_at && Date.parse(link.expires_at) <= Date.now()) throw new HttpError(410, 'Deze link is verlopen.', 'expired', { expiresAt: link.expires_at });
  if (!link.password_hash) return { ok: true };
  const key = `${kind}:${link.id}:${req.ip}`;
  const entry = attempts.get(key);
  if (entry && entry.count >= MAX_ATTEMPTS && Date.now() - entry.first < WINDOW_MS) {
    throw new HttpError(429, 'Te veel pogingen. Probeer het over een kwartier opnieuw.', 'too_many_attempts');
  }
  if (!auth.verifyPassword(String(password || ''), link.password_hash)) {
    if (!entry || Date.now() - entry.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
    else entry.count += 1;
    throw new HttpError(403, 'Het wachtwoord klopt niet.', 'wrong_password');
  }
  attempts.delete(key);
  const maxAge = link.expires_at ? Math.max(60, Math.floor((Date.parse(link.expires_at) - Date.now()) / 1000)) : 30 * 86_400;
  res.append('Set-Cookie', `${cookieName(kind, link.id)}=${unlockValue(db, kind, link)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.min(maxAge, 30 * 86_400)}${config.secureCookies ? '; Secure' : ''}`);
  return { ok: true };
}

/** Teamkant: wachtwoord en/of vervaldatum instellen of wissen. body: { password?: string|null, expiresAt?: string|null } */
function setProtection(db, kind, link, body) {
  const table = TABLES[kind];
  const sets = [];
  const args = [];
  if (body.password !== undefined) {
    if (body.password === null || body.password === '') {
      sets.push('password_hash = NULL', 'password_set_at = ?');
      args.push(now());
    } else {
      const pw = String(body.password);
      if (pw.length < 6 || pw.length > 200) throw new HttpError(400, 'Kies een wachtwoord van minimaal 6 tekens.');
      sets.push('password_hash = ?', 'password_set_at = ?');
      args.push(auth.hashPassword(pw), now());
    }
  }
  if (body.expiresAt !== undefined) {
    if (body.expiresAt === null || body.expiresAt === '') {
      sets.push('expires_at = NULL');
    } else {
      const v = String(body.expiresAt);
      const t = Date.parse(v);
      if (!Number.isFinite(t) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) throw new HttpError(400, 'Ongeldige vervaldatum. Kies een datum en tijd.');
      if (t <= Date.now()) throw new HttpError(400, 'De vervaldatum moet in de toekomst liggen.');
      sets.push('expires_at = ?');
      args.push(new Date(t).toISOString());
    }
  }
  if (!sets.length) throw new HttpError(400, 'Niets om te wijzigen.');
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...args, link.id);
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(link.id);
}

/** Wat het team over de beveiliging van een link te zien krijgt. */
const protectionDto = (l) => ({ hasPassword: !!l.password_hash, expiresAt: l.expires_at || null, expired: !!(l.expires_at && Date.parse(l.expires_at) <= Date.now()) });

module.exports = { guard, unlock, setProtection, protectionDto, expiryOf, TABLES, cookieName };
