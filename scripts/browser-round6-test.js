// Browsertest bouwronde 6: opdrachtbalk (⌘K/Ctrl+K) met het toetsenbord en met beperkte rechten,
// identieke uploads in de wachtrij (annuleren en bewust doorgaan, meerdere bestanden tegelijk),
// klantvragen beantwoorden (ook dubbel klikken), de startpagina van de klant en een freelancer
// met een open pagina waarvan de toegang verloopt. Chrome op Linux; geen Safari, geen echte Mac.
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser:ronde6   (SHOTS_DIR=/map optioneel)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');
const { createApp } = require('../server/app');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Zet CHROME_PATH naar een Chrome met H.264-ondersteuning.'); process.exit(2); }
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ronde6-'));
const SHOTS = process.env.SHOTS_DIR || path.join(S, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const shot = async (page, name, opts = {}) => {
  await page.evaluate(() => document.querySelectorAll('.toast-host > *').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};
const mp4 = (name, sec, pattern = 'testsrc2') => {
  const f = path.join(S, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `${pattern}=size=640x360:rate=25:duration=${sec}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f]);
  return f;
};

(async () => {
  const server = createApp({ dataDir: path.join(S, 'data'), backupDir: path.join(S, 'backups'), setupToken: 'ronde6-test-code-123', minFreeBytes: 0, variants: false, env: { ...process.env, STUDIO_REVIEW_HOME: path.join(S, 'home'), DATA_DIR: '' } });
  const listener = await new Promise((r) => { const l = server.app.listen(0, () => r(l)); });
  const BASE = `http://localhost:${listener.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const watch = (p, label) => {
    p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/40[0134]|409|410/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  };
  const H = { 'x-requested-with': 'review-tool' };
  const ctxOpts = { viewport: { width: 1440, height: 900 }, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' };
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  watch(page, 'beheer');
  const apiT = async (method, url, data, p = page) => {
    const r = await p.request.fetch(`${BASE}${url}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const film = mp4('Hoofdfilm_v03.mp4', 3);
  const kopie = path.join(S, 'Kopie van hoofdfilm.mp4');
  fs.copyFileSync(film, kopie);
  const anders = mp4('Teaser_nieuw.mp4', 2, 'smptebars');
  const upload = async (file, target) => {
    const buf = fs.readFileSync(file);
    const up = await apiT('POST', '/api/uploads', { filename: path.basename(file), size: buf.length, ...target });
    for (let o = 0; o < buf.length; o += up.chunkSize) await page.request.put(`${BASE}/api/uploads/${up.id}?offset=${o}`, { headers: { ...H, 'content-type': 'application/octet-stream' }, data: buf.subarray(o, o + up.chunkSize) });
    return up.id;
  };
  const login = async (p, email) => {
    await p.goto(`${BASE}/login`);
    await p.fill('input[name=email]', email);
    await p.fill('input[name=password]', 'een-lang-wachtwoord');
    await p.click('button[type=submit]');
  };

  await apiT('POST', '/api/setup', { setupToken: 'ronde6-test-code-123', email: 'sanne@agency.nl', name: 'Sanne de Vries', password: 'een-lang-wachtwoord' });
  // Na de installatie is de beheerder in deze context al ingelogd.
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.topbar');
  const pA = (await apiT('POST', '/api/projects', { name: 'Voorjaarscampagne' })).id;
  const pB = (await apiT('POST', '/api/projects', { name: 'Geheim project' })).id;
  const main = await apiT('POST', `/api/projects/${pA}/videos`, { uploadId: await upload(film, { projectId: pA }), title: 'Hoofdfilm' });
  await apiT('POST', `/api/projects/${pB}/videos`, { uploadId: await upload(anders, { projectId: pB }), title: 'Geheime teaser' });
  await apiT('POST', `/api/versions/${main.versionId}/ready`);
  await apiT('POST', `/api/versions/${main.versionId}/share`, { round: 'new', requestId: 'share-aaaaaaaa' });
  const clientId = (await apiT('POST', '/api/clients', { name: 'Bakkerij Jansen', language: 'nl' })).id;
  await apiT('PUT', `/api/projects/${pA}/client`, { clientId });
  const general = (await apiT('POST', `/api/clients/${clientId}/links`, {})).url;
  const fien = await apiT('POST', '/api/users', { name: 'Fien Freelancer', email: 'fien@freelance.nl', password: 'een-lang-wachtwoord', role: 'freelancer' });
  await apiT('PUT', `/api/users/${fien.id}/projects`, { projects: [{ projectId: pA, role: 'freelancer', expiresAt: new Date(Date.now() + 86400000).toISOString() }] });
  const kees = await apiT('POST', '/api/users', { name: 'Kees Kijker', email: 'kees@agency.nl', password: 'een-lang-wachtwoord', role: 'member' });
  await apiT('PUT', `/api/users/${kees.id}/projects`, { projects: [{ projectId: pA, role: 'meekijker' }] });

  // ---------- Opdrachtbalk: toetsenbord ----------
  await page.goto(`${BASE}/projecten/${pA}`);
  await page.waitForSelector('.video-row');
  await page.focus('.search-wrap input, .side-search input');
  await page.keyboard.press('Control+k');
  await page.waitForSelector('dialog.palette[open]');
  check('Ctrl+K opent de opdrachtbalk met focus in het invoerveld', await page.evaluate(() => document.activeElement?.classList.contains('palette-input')));
  const actionLabels = await page.locator('.palette-item .palette-label').allTextContents();
  check('acties van dit scherm (uploaden, vraag aan klant, personen)', actionLabels.includes('Video’s uploaden naar dit project') && actionLabels.includes('Vraag aan klant…') && actionLabels.includes('Personen en toegang…'), actionLabels.join(' | '));
  await page.keyboard.type('hoofd');
  await page.waitForSelector('.palette-item:has-text("Hoofdfilm")');
  const resultTexts = await page.locator('.palette-item').allTextContents();
  check('zoekt in toegankelijke video’s', resultTexts.some((t) => t.startsWith('Hoofdfilm')));
  await shot(page, '90-opdrachtbalk');
  await page.keyboard.press('Escape');
  check('Escape sluit en zet de focus terug', !(await page.isVisible('dialog.palette')) && await page.evaluate(() => !!document.activeElement?.closest('.side-search')));
  await page.keyboard.press('Control+k');
  await page.keyboard.type('hoofdfilm');
  await page.waitForSelector('.palette-item:has-text("Hoofdfilm")');
  const items = await page.locator('.palette-item').allTextContents();
  for (let i = 0; i < items.findIndex((t) => t.startsWith('Hoofdfilm')); i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/video\//);
  check('pijltjes + Enter opent het resultaat', page.url().includes(`/video/${main.videoId}`));

  // Beperkte rechten: Meekijker krijgt geen upload- of deelacties; niets uit een ander project.
  const kctx = await browser.newContext(ctxOpts);
  const k = await kctx.newPage();
  watch(k, 'meekijker');
  await login(k, 'kees@agency.nl');
  await k.waitForSelector('.topbar');
  await k.goto(`${BASE}/projecten/${pA}`);
  await k.waitForSelector('.video-row');
  await k.keyboard.press('Control+k');
  await k.waitForSelector('dialog.palette[open]');
  const kLabels = await k.locator('.palette-item .palette-label').allTextContents();
  check('meekijker: geen upload-, vraag- of personenactie in de opdrachtbalk', !kLabels.some((l) => /uploaden|Vraag aan klant|Personen/.test(l)), kLabels.join(' | '));
  await k.keyboard.type('geheim');
  await k.waitForTimeout(800);
  check('meekijker: geen resultaten uit een ander project', !(await k.textContent('.palette-list')).includes('Geheime teaser'));
  await k.keyboard.press('Escape');

  // ---------- Identieke uploads in de wachtrij ----------
  await page.goto(`${BASE}/projecten/${pA}`);
  await page.waitForSelector('.video-row');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('button:has-text("Nieuwe video")')]);
  await chooser.setFiles([kopie, anders]);
  await page.waitForSelector('.tray-item.is-duplicate', { timeout: 120_000 });
  const dupText = await page.textContent('.tray-item.is-duplicate');
  check('zelfde inhoud, andere naam: rustige melding met video en versie', /staat al in dit project als “Hoofdfilm”, versie 1/.test(dupText) && /Bestaande openen/.test(dupText) && /Toch uploaden/.test(dupText), dupText.slice(0, 160));
  await page.waitForSelector('.tray-item.is-done', { timeout: 120_000 });
  check('ander bestand in dezelfde wachtrij gaat gewoon door', (await page.textContent('.tray-item.is-done')).includes('Teaser_nieuw.mp4'));
  await shot(page, '91-identieke-upload');
  await page.click('.tray-item.is-duplicate button:has-text("Annuleren")');
  await page.waitForFunction(() => !document.querySelector('.tray-item.is-duplicate'));
  const left = await apiT('GET', `/api/projects/${pA}`);
  check('annuleren: geen nieuwe video, bestaande blijft', left.videos.filter((v) => v.title.startsWith('Kopie')).length === 0 && left.videos.some((v) => v.title === 'Hoofdfilm'));
  check('annuleren ruimt de tijdelijke upload op', server.db.prepare("SELECT COUNT(*) AS n FROM uploads WHERE original_filename = 'Kopie van hoofdfilm.mp4'").get().n === 0);
  // Nogmaals en nu bewust doorgaan.
  const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.click('button:has-text("Nieuwe video")')]);
  await chooser2.setFiles([kopie]);
  await page.waitForSelector('.tray-item.is-duplicate', { timeout: 120_000 });
  await page.click('.tray-item.is-duplicate button:has-text("Toch uploaden")');
  await page.waitForFunction(() => [...document.querySelectorAll('.tray-item.is-done')].some((el) => el.textContent.includes('Kopie van hoofdfilm.mp4')), null, { timeout: 120_000 });
  const ver = server.db.prepare("SELECT original_filename FROM versions WHERE original_filename = 'Kopie van hoofdfilm.mp4'").get();
  check('bewust doorgaan: gewone nieuwe video met de oorspronkelijke bestandsnaam', !!ver);

  // ---------- Vraag aan klant ----------
  await page.goto(`${BASE}/projecten/${pA}/feedback`);
  await page.waitForSelector('.questions-card');
  await page.click('.questions-card button:has-text("Vraag aan klant")');
  await page.waitForSelector('dialog[open] textarea');
  await page.fill('dialog[open] textarea', 'Klopt de spelling van de naam in de eindtitel?');
  await page.selectOption('dialog[open] select', String(main.videoId));
  await page.dblclick('dialog[open] button:has-text("Vraag delen met klant")');
  await page.waitForSelector('.question-item:has-text("Klopt de spelling")');
  check('vraag gedeeld (dubbelklik maakt geen tweede vraag)', server.db.prepare('SELECT COUNT(*) AS n FROM client_questions').get().n === 1);
  const cctx = await browser.newContext(ctxOpts);
  const c = await cctx.newPage();
  watch(c, 'klant');
  await c.goto(general);
  await c.waitForSelector('.p-group-todo');
  const order = await c.evaluate(() => [...document.querySelectorAll('.p-main > .p-group')].map((e) => e.className.match(/p-group-(\w+)/)?.[1]));
  check('klant: “Jouw acties” bovenaan, met de vraag erin', order[0] === 'todo' && (await c.textContent('.p-group-todo')).includes('Klopt de spelling'), order.join(','));
  await c.click('.p-question button:has-text("Beantwoorden")');
  await c.fill('.p-q-form textarea', 'Ja, dat klopt.');
  await c.fill('.p-q-form input', 'Eva Jansen');
  await c.dblclick('.p-q-form button[type=submit]');
  await c.waitForSelector('.p-group-answered');
  check('klant: antwoord verstuurd (één antwoord, niet geverifieerd gemarkeerd)', server.db.prepare("SELECT COUNT(*) AS n FROM client_questions WHERE status = 'answered' AND answer_verified = 0").get().n === 1 && (await c.textContent('.p-group-answered')).includes('naam zelf ingevuld'));
  check('klant: antwoord verandert de videostatus niet', server.db.prepare('SELECT status FROM versions WHERE id = ?').get(main.versionId).status === 'in_review');
  await shot(c, '92-klant-vraag-beantwoord', { fullPage: true });

  // ---------- Freelancer: open pagina en verlopen toegang ----------
  const fctx = await browser.newContext(ctxOpts);
  const f = await fctx.newPage();
  watch(f, 'freelancer');
  await login(f, 'fien@freelance.nl');
  await f.waitForSelector('.is-freelance');
  await f.goto(`${BASE}/video/${main.videoId}`);
  await f.waitForSelector('.side-panel');
  check('freelancer: alleen klantfeedback, geen invoerveld', !(await f.isVisible('.composer')) && (await f.textContent('.side-panel')).includes('Alleen bekijken'));
  await f.keyboard.press('Control+k');
  await f.waitForSelector('dialog.palette[open]');
  const fLabels = await f.locator('.palette-item .palette-label').allTextContents();
  check('freelancer: opdrachtbalk met alleen leesacties', fLabels.length > 0 && fLabels.every((l) => ['Mijn projecten', 'Inbox', 'Mijn account'].includes(l)), fLabels.join(' | '));
  await f.keyboard.type('geheim');
  await f.waitForTimeout(800);
  check('freelancer: geen resultaten uit een ander project', !(await f.textContent('.palette-list')).includes('Geheime'));
  await f.keyboard.press('Escape');
  server.db.prepare('UPDATE project_members SET expires_at = ? WHERE user_id = ?').run(new Date(Date.now() - 1000).toISOString(), fien.id);
  await f.reload();
  await f.waitForSelector('.empty-title');
  check('verlopen: open pagina toont bij verversen een duidelijke melding', /verlopen/.test(await f.textContent('.empty-title')));
  const media = await f.request.get(`${BASE}/api/freelance/versions/${main.versionId}/poster`);
  check('verlopen: geen thumbnail meer', media.status() === 403, String(media.status()));
  await f.goto(`${BASE}/`);
  await f.waitForSelector('.page-title');
  check('verlopen: project verdwijnt van de startpagina', !(await f.textContent('main')).includes('Voorjaarscampagne'));
  await shot(f, '93-freelancer-verlopen');

  // ---------- Mobiel ----------
  const mctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' });
  const m = await mctx.newPage();
  watch(m, 'mobiel');
  await m.goto(general);
  await m.waitForSelector('.p-group');
  const o = await m.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
  check('mobiel: klantstartpagina zonder horizontaal scrollen', o <= 1, String(o));

  check('geen JavaScript-fouten', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  listener.close();
  server.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} controles geslaagd. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
