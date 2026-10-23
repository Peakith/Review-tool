// Ontwikkeltest: werkt een update in een browser die de VORIGE interface al in de cache heeft?
// Start de vorige versie (git-commit, standaard e9e6f2b), laat een browser met een blijvend profiel
// die interface laden en cachen, vervangt dan de server door de huidige code op dezelfde poort en
// met dezelfde gegevens, en ververst de pagina normaal (zoals F5 / Cmd+R).
// Gebruik: CHROME_PATH=/pad/naar/chrome node scripts/browser-update-test.js [oude-commit]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Zet CHROME_PATH.'); process.exit(2); }
const OLD = process.argv[2] || 'e9e6f2b';
const REPO = path.resolve(__dirname, '..');
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-updatetest-'));
const SHOTS = process.env.SHOTS_DIR || path.join(S, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 3700 + Math.floor(Math.random() * 200);
const BASE = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

function startServer(appDir, label) {
  const env = { ...process.env, DATA_DIR: path.join(S, 'data'), PORT: String(PORT), SETUP_TOKEN: 'update-test-code-12345', STUDIO_REVIEW_HOME: path.join(S, 'home') };
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => process.env.DEBUG && process.stdout.write(`[${label}] ${d}`));
  child.stderr.on('data', (d) => process.env.DEBUG && process.stderr.write(`[${label}] ${d}`));
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = async () => {
      try { const r = await fetch(`${BASE}/api/session`); if (r.ok) return resolve(child); } catch { /* nog niet */ }
      if (Date.now() - t0 > 15000) return reject(new Error(`${label} start niet`));
      setTimeout(poll, 200);
    };
    poll();
  });
}
const stopServer = (child) => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); });

(async () => {
  const oldDir = path.join(S, 'oud');
  execFileSync('git', ['-C', REPO, 'worktree', 'add', '-q', '--detach', oldDir, OLD]);
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(oldDir, 'node_modules'));
  let server;
  let context;
  try {
    // ---- Vorige versie ----
    server = await startServer(oldDir, 'oud');
    context = await chromium.launchPersistentContext(path.join(S, 'profiel'), { executablePath: CHROME, viewport: { width: 1440, height: 900 } });
    const page = context.pages()[0] || await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/?setup=update-test-code-12345`);
    await page.fill('input[name=name]', 'Sanne');
    await page.fill('input[name=email]', 'sanne@agency.nl');
    await page.fill('input[name=password]', 'een-lang-wachtwoord');
    await page.click('button[type=submit]');
    await page.waitForSelector('.onboarding');
    await page.request.post(`${BASE}/api/projects`, { headers: { 'x-requested-with': 'review-tool' }, data: { name: 'Project uit de vorige versie' } });
    await page.reload();
    await page.waitForSelector('.project-card');
    const oldHeaders = (await page.request.get(`${BASE}/shared/util.js`)).headers()['cache-control'];
    check(`vorige versie (${OLD}) cachet de interface`, /max-age=3600/.test(oldHeaders || ''), oldHeaders);
    check('vorige versie: geen versienummer, geen prullenbak', !(await page.isVisible('.side-version')) && !(await page.isVisible('text=Prullenbak')));
    await page.screenshot({ path: path.join(SHOTS, '30-voor-update.png') });

    // ---- Update: nieuwe code, zelfde poort en gegevens ----
    await stopServer(server);
    server = await startServer(REPO, 'nieuw');
    const fresh = [];
    page.on('response', (r) => { if (/\/assets\/[0-9a-f]{8}\//.test(r.url())) fresh.push(r.url()); });
    await page.reload(); // gewoon verversen
    await page.waitForSelector('.side-version', { timeout: 15000 });
    const label = await page.textContent('.side-version');
    check('na gewoon verversen: nieuwe interface met versienummer', /0\.2\.\d+ \(build/.test(label), label);
    check('nieuwe beheeronderdelen zichtbaar (bestaand account is beheerder)', await page.isVisible('.side-nav a:has-text("Prullenbak")') && await page.isVisible('.side-nav a:has-text("Opslag & back-ups")'));
    check('ook geïmporteerde modules komen van de nieuwe build', fresh.some((u) => u.includes('/shared/util.js')) && fresh.some((u) => u.includes('/shared/icons.js')), `${fresh.length} bestanden via /assets/<build>/`);
    check('bestaand project en sessie behouden', await page.isVisible('.project-card:has-text("Project uit de vorige versie")'));
    check('geen JavaScript-fouten na de update', errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: path.join(SHOTS, '31-na-update.png') });
  } finally {
    await context?.close();
    if (server) await stopServer(server);
    execFileSync('git', ['-C', REPO, 'worktree', 'remove', '--force', oldDir]);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nSchermafbeeldingen: ${SHOTS}\n${results.length - failed}/${results.length} controles geslaagd`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
