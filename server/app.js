'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { loadConfig } = require('./config');
const { openDb } = require('./db');
const auth = require('./auth');
const { HttpError } = require('./status');
const { uploadRoutes } = require('./uploads');
const { teamRoutes } = require('./routes/team');
const { reviewRoutes } = require('./routes/review');
const { adminRoutes } = require('./routes/admin');
const { portalRoutes } = require('./routes/portal');
const { briefingRoutes } = require('./routes/briefing');
const { brandRoutes, brandLogoRoute } = require('./routes/brands');
const { FORMATS, toolStatus } = require('./media');
const { createLocalStorage } = require('./storage');
const { createAccess } = require('./access');
const { build, versionInfo } = require('./build');

const CSP = "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

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
  const storage = createLocalStorage(config);
  const access = createAccess(db);
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
    res.setHeader('Content-Security-Policy', CSP);
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
      paths: tools.paths,
      uploadsEnabled: tools.ffprobe || config.allowUnverifiedUploads,
      unverifiedAllowed: config.allowUnverifiedUploads,
    };
  };

  api.get('/health', async (req, res) => {
    db.prepare('SELECT 1').get();
    const media = await mediaCheck();
    const ok = media.ffprobe && media.ffmpeg && !media.unverifiedAllowed;
    const st = storage.status();
    res.json({
      app: 'studio-review',
      ...versionInfo(),
      instanceId: config.instanceId,
      status: ok && st.ok ? 'ok' : 'degraded',
      database: 'ok',
      storage: st.ok ? 'ok' : 'niet bereikbaar',
      ffprobe: media.ffprobe ? 'ok' : 'ontbreekt',
      ffmpeg: media.ffmpeg ? 'ok' : 'ontbreekt',
      uploads: media.uploadsEnabled ? (media.unverifiedAllowed && !media.ffprobe ? 'zonder controle (ALLOW_UNVERIFIED_UPLOADS)' : 'ok') : 'uitgeschakeld',
      // Alleen voor de startknop op dezelfde computer: welk proces is dit en welke installatie.
      ...(isLoopback(req) ? { pid: process.pid, appDir: config.appDir, dataDir: config.dataDir, port: config.port } : {}),
    });
  });

  api.get('/session', async (req, res) => {
    const user = auth.sessionUser(db, req);
    const needsSetup = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
    res.json({
      user, needsSetup, formats: Object.keys(FORMATS), maxUploadBytes: config.maxUploadBytes,
      version: versionInfo(),
      media: user ? await mediaCheck() : undefined,
      system: user ? {
        storage: storage.status(),
        dataSource: config.dataSource,
        // Gegevens staan nog in de programmamap: bij een update zouden ze achterblijven.
        dataInAppDir: config.dataSource === 'programmamap',
        legacyDataLeft: user.isAdmin && config.dataSource === 'vast' ? config.legacyDataDir : null,
      } : undefined,
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
      // Het eerste account is altijd beheerder.
      return auth.createUser(db, { ...(req.body || {}), role: 'admin' });
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
    if (user.disabled_at) throw new HttpError(403, 'Dit account is uitgeschakeld. Neem contact op met een beheerder.');
    limiter.reset(req.ip);
    auth.createSession(db, config, res, user.id);
    res.json({ ok: true });
  });

  api.post('/logout', (req, res) => {
    auth.destroySession(db, config, req, res);
    res.json({ ok: true });
  });

  // ---------- Klant (deel-link) ----------
  reviewRoutes(api, db, config, { storage });
  portalRoutes(api, db, config, { storage });
  brandLogoRoute(api, db, config, { storage });

  // ---------- Team (inloggen verplicht) ----------
  const team = asyncRouter();
  team.use(auth.requireTeam(db));
  const uploads = uploadRoutes(team, db, config, { access, storage });
  teamRoutes(team, db, config, { ...uploads, access, storage });
  adminRoutes(team, db, config, { access, storage, uploads });
  briefingRoutes(team, db, config, { access, storage, uploads });
  brandRoutes(team, db, config, { access, storage });

  const runCleanup = () => uploads.cleanupExpired().then((r) => {
    if (r.removed || r.orphans) console.log(`Opruimen: ${r.removed} verlopen upload(s) en ${r.orphans} los(se) bestand(en) verwijderd`);
  }).catch((err) => console.error('Opruimen van uploads mislukt:', err));
  const cleanupTimer = setInterval(runCleanup, config.cleanupIntervalMinutes * 60_000);
  cleanupTimer.unref();
  api.use(team);

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Niet gevonden' }));

  // ---------- Frontend ----------
  // Cache-aanpak: de HTML wordt altijd opnieuw gecontroleerd en verwijst naar bestanden onder
  // /assets/<build>/…. De build-code verandert zodra een interfacebestand verandert, dus na een
  // update laadt de browser met gewoon verversen alle nieuwe bestanden, ook geïmporteerde
  // JavaScript-modules (via de import map, die /shared/, /app/ en /review/ omzet naar dezelfde build).
  function renderPage(file) {
    const b = build();
    const prefix = `/assets/${b}`;
    const importMap = JSON.stringify({ imports: { '/shared/': `${prefix}/shared/`, '/app/': `${prefix}/app/`, '/review/': `${prefix}/review/` } });
    const html = fs.readFileSync(path.join(publicDir, file), 'utf8')
      .replace(/(href|src)="\/(shared|app|review)\//g, `$1="${prefix}/$2/`)
      .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta name="app-version" content="${versionInfo().label}">\n  <script type="importmap">${importMap}</script>`);
    const hash = crypto.createHash('sha256').update(importMap).digest('base64');
    return { html, csp: CSP.replace("script-src 'self'", `script-src 'self' 'sha256-${hash}'`) };
  }
  const sendPage = (file) => (req, res) => {
    const { html, csp } = renderPage(file);
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  };

  app.use('/assets/:build', (req, res, next) => {
    // Alleen de huidige build mag "voor altijd" gecachet worden; een oude pagina die nog een
    // oude build-URL vraagt, krijgt de actuele bestanden zonder ze onder die oude URL vast te leggen.
    res.locals.immutable = req.params.build === build();
    next();
  }, express.static(publicDir, {
    index: false,
    setHeaders: (res) => res.setHeader('Cache-Control', res.locals.immutable ? 'public, max-age=31536000, immutable' : 'no-store'),
  }));
  // Oude, niet-geversioneerde paden blijven werken, maar worden altijd opnieuw gecontroleerd.
  app.use(express.static(publicDir, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
  app.get('/r/:token', sendPage('review/index.html'));
  app.get('/p/:token', sendPage('review/portal.html'));
  // Voorbeeldweergave voor het team: dezelfde klantpagina's, gevuld via het teamaccount.
  app.get('/voorbeeld/project/:id', sendPage('review/portal.html'));
  app.get('/voorbeeld/video/:id', sendPage('review/index.html'));
  app.get(['/', '/login', '/projecten*', '/video*', '/team', '/opslag', '/prullenbak', '/archief', '/merken'], sendPage('app/index.html'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    const expected = err instanceof HttpError;
    if (status >= 500 && !expected) console.error(err);
    if (res.headersSent) return res.end();
    const message = err.type === 'entity.too.large' ? 'Het bestand is te groot.'
      : status >= 500 && !expected ? 'Er ging iets mis op de server' : err.message;
    if (req.path.startsWith('/api')) res.status(status).json({ error: message });
    else res.status(status).send(message);
  });

  const needsSetup = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  return {
    app, db, config, uploads, storage, access, setupToken, needsSetup, runCleanup, mediaCheck,
    stop() { clearInterval(cleanupTimer); },
  };
}

module.exports = { createApp };
