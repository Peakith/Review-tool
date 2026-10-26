// Ontwikkeltest (bouwronde 8): de app stond in 0.8.0 op "Licht" (bewaard in het account én in de
// browser). Na de update en een gewone verversing moet alles direct donker zijn, met behoud van de
// overige voorkeuren (dashboardindeling) en zonder opnieuw in te loggen.
// Start de vorige versie (git-commit, standaard 5ae74b6 = 0.8.0) met een blijvend browserprofiel,
// vervangt de server door de huidige code op dezelfde poort en met dezelfde gegevens en ververst.
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser:update-donker [-- <oude-commit>]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Zet CHROME_PATH.'); process.exit(2); }
const OLD = process.argv[2] || '5ae74b6';
const REPO = path.resolve(__dirname, '..');
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-donker-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const H = { 'x-requested-with': 'review-tool' };
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

function startServer(appDir) {
  const env = { ...process.env, DATA_DIR: path.join(S, 'data'), PORT: String(PORT), SETUP_TOKEN: 'donker-test-code-12345', STUDIO_REVIEW_HOME: path.join(S, 'home'), MIN_FREE_GB: '0' };
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: appDir, env, stdio: 'ignore' });
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = async () => {
      try { if ((await fetch(`${BASE}/api/session`)).ok) return resolve(child); } catch { /* nog niet */ }
      if (Date.now() - t0 > 15000) return reject(new Error('server start niet'));
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
    server = await startServer(oldDir);
    context = await chromium.launchPersistentContext(path.join(S, 'profiel'), { executablePath: CHROME, viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const page = context.pages()[0] || await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.request.post(`${BASE}/api/setup`, { headers: H, data: { setupToken: 'donker-test-code-12345', email: 'sanne@agency.nl', name: 'Sanne', password: 'een-lang-wachtwoord' } });
    await page.request.post(`${BASE}/api/projects`, { headers: H, data: { name: 'Project uit 0.8.0' } });
    // In de vorige versie: "Licht" kiezen via het profielmenu en een eigen dashboardindeling bewaren.
    await page.request.put(`${BASE}/api/me/preferences`, { headers: H, data: { dashboard: { widgets: [{ id: 'inbox', size: 'wide' }, { id: 'waiting' }] } } });
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.side-user');
    await page.click('.side-user');
    await page.click('.profile-menu .menu-item:has-text("Licht")');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.reload();
    await page.waitForSelector('.dash-card');
    check(`vorige versie (${OLD}): stond op Licht (account en browser)`, (await page.getAttribute('html', 'data-theme')) === 'light' && (await page.evaluate(() => localStorage.getItem('rt-theme'))) === 'light');

    await stopServer(server);
    server = await startServer(REPO);
    await page.reload(); // gewone verversing, zelfde browserprofiel en cache
    await page.waitForSelector('.dash-card');
    const bg = await page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).backgroundColor]);
    check('na de update en gewoon verversen: direct donker (#0B1424)', bg[0] === 'dark' && bg[1] === 'rgb(11, 20, 36)' && bg[2] === 'rgb(11, 20, 36)', bg.join(' '));
    const stored = await page.evaluate(() => localStorage.getItem('rt-theme'));
    await page.click('.side-user');
    const themeItems = await page.locator('.profile-menu [role=menuitemradio], .profile-menu .menu-item:has-text("Licht")').count();
    await page.keyboard.press('Escape');
    check('oude lichte keuze in de browser opgeruimd; geen themakeuze in het profielmenu', stored === null && themeItems === 0, `${stored} / ${themeItems}`);
    const widgets = await page.$$eval('.dash-card', (els) => els.map((e) => e.dataset.widget));
    check('eigen dashboardindeling behouden, nog ingelogd', JSON.stringify(widgets) === '["inbox","waiting"]', widgets.join(','));
    await page.click('.side-nav a:has-text("Projecten")');
    await page.waitForSelector('.project-card');
    check('bestaand project zichtbaar', (await page.textContent('main')).includes('Project uit 0.8.0'));
    check('geen JavaScript-fouten', errors.length === 0, errors.join(' | '));
  } finally {
    await context?.close();
    if (server) await stopServer(server);
    execFileSync('git', ['-C', REPO, 'worktree', 'remove', '--force', oldDir]);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} controles geslaagd`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
