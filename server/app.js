'use strict';
const path = require('node:path');
const express = require('express');
const { loadConfig } = require('./config');
const { openDb } = require('./db');
const auth = require('./auth');
const { HttpError } = require('./status');
const { uploadRoutes } = require('./uploads');
const { teamRoutes } = require('./routes/team');
const { reviewRoutes } = require('./routes/review');
const { FORMATS, toolStatus } = require('./media');

/** Express 4 vangt geen fouten uit async handlers; deze router doet dat wel. */
function asyncRouter() {
  const router = express.Router();
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
    const original = router[method].bind(router);
    router[method] = (route, ...handlers) => original(route, ...handlers.map((h) =>
      (h.length === 4 ? h : (req, res, next) => Promise.resolve(h(req, res, next)).catch(next))));
  }
  return router;
}

function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const db = openDb(config);
  const app = express();
  const publicDir = path.join(__dirname, '..', 'public');
  const limiter = auth.loginLimiter();
  // Het eerste account kan alleen worden aangemaakt met deze code. Zonder SETUP_TOKEN
  // genereert de server bij elke start een nieuwe code en toont die alleen in het serverlog.
  const setupToken = config.setupToken || auth.randomToken(18);

  app.set('trust proxy', process.env.TRUST_PROXY === 'true');
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    // Geen referrer: deel-links met token lekken zo niet naar andere sites.
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
  });

  // CSRF-bescherming: wijzigende API-verzoeken moeten deze header meesturen,
  // wat een andere website via een gewoon formulier niet kan.
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-requested-with') !== 'review-tool') {
      return next(new HttpError(403, 'Ongeldig verzoek'));
    }
    next();
  });
  app.use('/api', express.json({ limit: '1mb' }));

  const api = asyncRouter();

  // ---------- Sessie & inloggen ----------
  const mediaCheck = async () => {
    const tools = await toolStatus(config.tools);
    return {
      ffprobe: tools.ffprobe,
      ffmpeg: tools.ffmpeg,
      uploadsEnabled: tools.ffprobe || config.allowUnverifiedUploads,
      unverifiedAllowed: config.allowUnverifiedUploads,
    };
  };

  api.get('/health', async (req, res) => {
    db.prepare('SELECT 1').get();
    const media = await mediaCheck();
    const ok = media.ffprobe && media.ffmpeg && !media.unverifiedAllowed;
    res.json({
      status: ok ? 'ok' : 'degraded',
      database: 'ok',
      ffprobe: media.ffprobe ? 'ok' : 'ontbreekt',
      ffmpeg: media.ffmpeg ? 'ok' : 'ontbreekt',
      uploads: media.uploadsEnabled ? (media.unverifiedAllowed && !media.ffprobe ? 'zonder controle (ALLOW_UNVERIFIED_UPLOADS)' : 'ok') : 'uitgeschakeld',
    });
  });

  api.get('/session', async (req, res) => {
    const user = auth.sessionUser(db, req);
    const needsSetup = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
    res.json({
      user, needsSetup, formats: Object.keys(FORMATS), maxUploadBytes: config.maxUploadBytes,
      media: user ? await mediaCheck() : undefined,
    });
  });

  api.post('/setup', (req, res) => {
    limiter.check(req.ip);
    if (!auth.safeEqual(String(req.body?.setupToken || '').trim(), setupToken)) {
      limiter.fail(req.ip);
      throw new HttpError(403, 'De installatiecode klopt niet. Je vindt de code in het serverlog bij het starten, of in de variabele SETUP_TOKEN.');
    }
    const userId = db.tx(() => {
      if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) throw new HttpError(409, 'Er is al een account aangemaakt');
      return auth.createUser(db, req.body || {});
    });
    auth.createSession(db, config, res, userId);
    res.status(201).json({ ok: true });
  });

  api.post('/login', (req, res) => {
    limiter.check(req.ip);
    const { email, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
    if (!user || !auth.verifyPassword(String(password || ''), user.password_hash)) {
      limiter.fail(req.ip);
      throw new HttpError(401, 'E-mailadres of wachtwoord klopt niet');
    }
    limiter.reset(req.ip);
    auth.createSession(db, config, res, user.id);
    res.json({ ok: true });
  });

  api.post('/logout', (req, res) => {
    auth.destroySession(db, config, req, res);
    res.json({ ok: true });
  });

  // ---------- Klant (deel-link) ----------
  reviewRoutes(api, db, config);

  // ---------- Team (inloggen verplicht) ----------
  const team = asyncRouter();
  team.use(auth.requireTeam(db));
  const uploads = uploadRoutes(team, db, config);
  teamRoutes(team, db, config, uploads);

  const runCleanup = () => uploads.cleanupExpired().then((r) => {
    if (r.removed || r.orphans) console.log(`Opruimen: ${r.removed} verlopen upload(s) en ${r.orphans} los(se) bestand(en) verwijderd`);
  }).catch((err) => console.error('Opruimen van uploads mislukt:', err));
  const cleanupTimer = setInterval(runCleanup, config.cleanupIntervalMinutes * 60_000);
  cleanupTimer.unref();
  api.use(team);

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Niet gevonden' }));

  // ---------- Frontend ----------
  app.use(express.static(publicDir, { index: false, maxAge: '1h' }));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
  app.get('/r/:token', (req, res) => res.sendFile(path.join(publicDir, 'review', 'index.html')));
  app.get(['/', '/login', '/projecten*', '/video*', '/team'], (req, res) => res.sendFile(path.join(publicDir, 'app', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    const expected = err instanceof HttpError;
    if (status >= 500 && !expected) console.error(err);
    if (res.headersSent) return res.end();
    const message = status >= 500 && !expected ? 'Er ging iets mis op de server' : err.message;
    if (req.path.startsWith('/api')) res.status(status).json({ error: message });
    else res.status(status).send(message);
  });

  const needsSetup = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  return {
    app, db, config, uploads, setupToken, needsSetup, runCleanup, mediaCheck,
    stop() { clearInterval(cleanupTimer); },
  };
}

module.exports = { createApp };
