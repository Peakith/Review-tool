// Browsertest bouwronde 5, fase C: persoonlijke inbox, browsermeldingen (alleen na inschakelen) en de
// klantactiviteit als tijdlijn. Chrome op deze Linux-machine en Pixel 7-emulatie; geen echt toestel
// en geen Safari. Browsermeldingen worden in de browser zelf aangemaakt; dat ze op een Mac als
// systeemmelding verschijnen is hier niet te controleren (zie ACCEPTATIETEST.md).
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser:inbox   (SHOTS_DIR=/map optioneel)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');
const { createApp } = require('../server/app');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Zet CHROME_PATH naar een Chrome met H.264-ondersteuning.'); process.exit(2); }
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-inboxtest-'));
const SHOTS = process.env.SHOTS_DIR || path.join(S, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const shot = async (page, name, opts = {}) => {
  await page.evaluate(() => document.querySelectorAll('.toast-host > *').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};

(async () => {
  const server = createApp({ dataDir: path.join(S, 'data'), backupDir: path.join(S, 'backups'), setupToken: 'inbox-test-code-1234', minFreeBytes: 0, env: { ...process.env, STUDIO_REVIEW_HOME: path.join(S, 'home'), DATA_DIR: '' } });
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
  const file = path.join(S, 'film.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
  const upload = async (target) => {
    const buf = fs.readFileSync(file);
    const up = await apiT('POST', '/api/uploads', { filename: 'film.mp4', size: buf.length, ...target });
    for (let o = 0; o < buf.length; o += up.chunkSize) await page.request.put(`${BASE}/api/uploads/${up.id}?offset=${o}`, { headers: { ...H, 'content-type': 'application/octet-stream' }, data: buf.subarray(o, o + up.chunkSize) });
    return up.id;
  };
  await apiT('POST', '/api/setup', { setupToken: 'inbox-test-code-1234', email: 'sanne@agency.nl', name: 'Sanne de Vries', password: 'een-lang-wachtwoord' });
  const pA = (await apiT('POST', '/api/projects', { name: 'Voorjaarscampagne' })).id;
  const v = await apiT('POST', `/api/projects/${pA}/videos`, { uploadId: await upload({ projectId: pA }), title: 'Hoofdfilm' });
  await apiT('POST', `/api/versions/${v.versionId}/ready`);
  await apiT('POST', `/api/versions/${v.versionId}/share`, { round: 'new', requestId: 'share-aaaaaaaa' });
  await apiT('PATCH', `/api/videos/${v.videoId}`, { approverName: 'Joris', approverEmail: 'joris@klant.nl' });
  const token = (await apiT('GET', `/api/videos/${v.videoId}`)).links.find((l) => l.role === 'reviewer').url.split('/').pop();
  const ed = await apiT('POST', '/api/users', { name: 'Edith Editor', email: 'edith@agency.nl', password: 'een-lang-wachtwoord', role: 'member' });
  await apiT('PUT', `/api/users/${ed.id}/projects`, { projects: [{ projectId: pA, level: 'upload' }] });
  const guest = (url, data) => page.request.post(`${BASE}${url}`, { headers: { ...H, 'x-reviewer-key': 'inbox-reviewer-key-01' }, data });

  // Edith logt in, volgt het project via de knop en zet browsermeldingen aan
  const ectx = await browser.newContext(ctxOpts);
  await ectx.grantPermissions(['notifications'], { origin: BASE });
  await ectx.addInitScript(() => {
    // Zichtbaarheid en Notification nabootsen om te zien wat de app aanmaakt (emulatie, geen systeemmelding).
    window.__shown = [];
    const Real = window.Notification;
    class Fake { constructor(title, opts) { window.__shown.push({ title, body: opts?.body }); } static get permission() { return Real.permission; } static requestPermission() { return Real.requestPermission(); } }
    window.Notification = Fake;
    Object.defineProperty(document, 'visibilityState', { get: () => window.__hidden ? 'hidden' : 'visible' });
  });
  const e = await ectx.newPage();
  watch(e, 'edith');
  await e.goto(`${BASE}/login`);
  await e.fill('input[name=email]', 'edith@agency.nl');
  await e.fill('input[name=password]', 'een-lang-wachtwoord');
  await e.click('button[type=submit]');
  await e.waitForSelector('.side-nav');
  const menu = await e.$$eval('.side-nav[aria-label="Hoofdmenu"] a', (els) => els.map((x) => x.querySelector('.nav-label').textContent));
  check('hoofdmenu (bovenbalk): Dashboard, Projecten, Klanten, Inbox, Mijn taken', JSON.stringify(menu) === JSON.stringify(['Dashboard', 'Projecten', 'Klanten', 'Inbox', 'Mijn taken']), menu.join(', '));
  await e.goto(`${BASE}/inbox`);
  await e.waitForSelector('.inbox-page .empty');
  check('lege inbox met uitleg wat er komt', /Je inbox is leeg/.test(await e.textContent('.inbox-list')));
  check('inbox werkt zonder meldingstoestemming; meldingen alleen na eigen keuze', await e.isVisible('button:has-text("Meldingen inschakelen")'));
  await e.click('button:has-text("Meldingen inschakelen")');
  await e.waitForSelector('button:has-text("Browsermeldingen uitzetten")');
  check('eerlijke uitleg: alleen met open tabblad, geen e-mail, alleen op deze Mac', /alleen zolang Studio Review in een tabblad openstaat/.test(await e.textContent('.inbox-settings')) && /niets gemaild/.test(await e.textContent('.inbox-settings')) && /localhost/.test(await e.textContent('.inbox-settings')));
  await e.goto(`${BASE}/projecten/${pA}`);
  await e.waitForSelector('.follow-btn');
  await e.waitForFunction(() => document.querySelector('.follow-btn .btn-label').textContent === 'Volgen');
  await e.click('.follow-btn');
  await e.waitForSelector('.follow-btn[aria-pressed="true"]');
  check('project volgen met één knop in de projectkop', (await e.textContent('.follow-btn')).includes('Volgend'));

  // Gebeurtenissen: klantfeedback, taak, vermelding
  await guest(`/api/review/${token}/versions/${v.versionId}/comments`, { body: 'Logo groter', timecode: 1, authorName: 'Eva', requestId: 'c1-aaaaaaaaaa' });
  const cid = (await apiT('GET', `/api/versions/${v.versionId}/comments`))[0].id;
  await guest(`/api/review/${token}/versions/${v.versionId}/feedback`, { authorName: 'Eva', requestId: 'fb-aaaaaaaaaa' });
  await e.evaluate(() => { window.__hidden = true; });
  await apiT('POST', `/api/comments/${cid}/task`, { assigneeId: ed.id, priority: 'high' });
  await apiT('POST', `/api/versions/${v.versionId}/comments`, { body: '@Edith Editor kun jij dit oppakken?', parentId: cid });
  await e.evaluate(() => import('/app/inbox.js').then((m) => m.refreshInboxCount()));
  await e.waitForFunction(() => document.getElementById('inbox-count') && !document.getElementById('inbox-count').hidden);
  check('zijbalk: aantal ongelezen', (await e.textContent('#inbox-count')) === '3');
  const shown = await e.evaluate(() => window.__shown);
  check('browsermelding aangemaakt voor nieuwe items (tabblad op de achtergrond, emulatie)', shown.length >= 1 && shown.some((n) => /wees je een taak toe/.test(n.title)), JSON.stringify(shown.map((n) => n.title)));
  await e.evaluate(() => { window.__hidden = false; });
  await e.goto(`${BASE}/inbox`);
  await e.waitForSelector('.inbox-item');
  const titles = await e.$$eval('.inbox-title', (els) => els.map((x) => x.textContent));
  check('inbox: vermelding, taak en klantfeedback (nieuwste eerst)', titles.length === 3 && /noemde je/.test(titles[0]) && /taak toe/.test(titles[1]) && /Eva stuurde feedback/.test(titles[2]), titles.join(' | '));
  check('ongelezen duidelijk gemarkeerd, acties zonder hover zichtbaar', (await e.$$('.inbox-item.is-unread')).length === 3 && await e.isVisible('.inbox-item >> nth=0 >> button:has-text("Markeer als gelezen")'));
  await shot(e, '80-inbox');
  await e.click('.inbox-item:has-text("taak toe") .inbox-title');
  await e.waitForURL(/\/video\//);
  await e.waitForSelector('.comment.is-active, .comment[aria-current]', { timeout: 10000 }).catch(() => {});
  check('melding openen: juiste video, versie en reactie', e.url().includes(`/video/${v.videoId}?v=${v.versionId}&c=${cid}`), e.url());
  await e.waitForFunction(() => document.getElementById('inbox-count').textContent === '2');
  check('na openen: één minder ongelezen', true);
  await e.goto(`${BASE}/inbox`);
  await e.waitForSelector('.inbox-item');
  await e.click('.segmented button:has-text("Ongelezen")');
  await e.waitForFunction(() => document.querySelectorAll('.inbox-item').length === 2);
  check('filter “Ongelezen”', new URL(e.url()).search === '?filter=ongelezen');
  await e.click('button:has-text("Alles gelezen")');
  await e.waitForSelector('.inbox-list .empty');
  check('alles gelezen: teller weg', await e.isHidden('#inbox-count'));
  // Voorkeur uitzetten
  await e.uncheck('.inbox-prefs label:has-text("Klantfeedback") input');
  await e.waitForTimeout(300);
  await guest(`/api/review/${token}/versions/${v.versionId}/comments`, { body: 'Nog iets', timecode: 2, authorName: 'Eva', requestId: 'c2-aaaaaaaaaa' });
  await apiT('POST', `/api/versions/${v.versionId}/status`, { status: 'in_review', note: 'Opnieuw open' });
  await guest(`/api/review/${token}/versions/${v.versionId}/feedback`, { authorName: 'Eva', requestId: 'fb2-aaaaaaaaa' });
  await e.reload();
  await e.waitForSelector('.inbox-filters');
  await e.click('.segmented button:has-text("Alles")');
  await e.waitForSelector('.inbox-item');
  check('voorkeur “Klantfeedback” uit: geen nieuwe feedbackmelding', (await e.$$('.inbox-item:has-text("stuurde feedback")')).length === 1);

  // Beheerder ziet eigen inbox, niet die van Edith; Edith’s gelezen-status raakt de beheerder niet
  await page.goto(`${BASE}/inbox`);
  await page.waitForSelector('.inbox-item');
  check('beheerder: eigen inbox (feedback in gevolgd project), los van Edith', (await page.$$('.inbox-item.is-unread')).length >= 2 && !(await page.textContent('.inbox-list')).includes('wees je een taak toe'));

  // ---------- Klantactiviteit als tijdlijn ----------
  const cctx = await browser.newContext(ctxOpts);
  const c = await cctx.newPage();
  watch(c, 'klant');
  await c.goto(`${BASE}/r/${token}`);
  await c.waitForSelector('.r-stage video');
  await c.click('.pc-bigplay');
  await c.waitForTimeout(800);
  // Eigen testbezoek als ingelogd teamlid
  await page.goto(`${BASE}/r/${token}`);
  await page.waitForSelector('.r-stage video');
  await page.goto(`${BASE}/projecten/${pA}/activiteit`);
  await page.waitForSelector('.act-row');
  const types = await page.$$eval('.act-row strong', (els) => els.map((x) => x.textContent));
  check('tijdlijn: formele feedback naast geopend en afspelen gestart', types.includes('Feedback verstuurd (formeel)') && types.includes('Reviewpagina geopend') && types.includes('Afspelen gestart'), types.join(', '));
  check('tijdlijn: datum, tijd met tijdzone, video met versie-link', /CET|CEST/.test(await page.textContent('.act-row')) && await page.isVisible(`.act-row a[href="/video/${v.videoId}?v=${v.versionId}"]`));
  check('eigen teambezoek standaard verborgen, met uitleg en teller', !(await page.isVisible('.act-row.is-team')) && /Eigen teambezoeken tonen \(1\)/.test(await page.textContent('.fb-filters')));
  await page.check('.act-team input');
  await page.waitForSelector('.act-row.is-team');
  check('teambezoek tonen: apart gemarkeerd, actief filter zichtbaar', /teambezoek/.test(await page.textContent('.act-row.is-team')) && /Inclusief eigen teambezoeken/.test(await page.textContent('.act-active')));
  await page.selectOption('.fb-filters select >> nth=0', 'playback_started');
  await page.waitForFunction(() => /Gebeurtenis: Afspelen gestart/.test(document.querySelector('.act-active').textContent));
  check('actieve filters als chips, met “Alle filters wissen”', await page.isVisible('.act-active button:has-text("Alle filters wissen")'));
  await shot(page, '81-klantactiviteit');
  await page.click('.act-active button:has-text("Alle filters wissen")');
  await page.waitForFunction(() => !document.querySelector('.act-active').textContent.trim());
  // Nieuw klantbezoek verschijnt zonder handmatig verversen
  const n0 = (await page.$$('.act-row')).length;
  await page.evaluate(() => { const s = document.createElement('div'); s.id = 'probe'; document.body.append(s); });
  // Een tweede reviewlink (andere link: niet samengevoegd met het eerdere bezoek)
  const extra = (await apiT('POST', `/api/videos/${v.videoId}/links`, { role: 'reviewer', label: 'Marketing' })).url;
  const c2 = await (await browser.newContext(ctxOpts)).newPage();
  await c2.goto(extra);
  await c2.waitForSelector('.r-stage video');
  const appeared = await page.waitForFunction((n) => document.querySelectorAll('.act-row').length > n, n0, { timeout: 40000 }).then(() => true).catch(() => false);
  check('nieuwe activiteit verschijnt vanzelf (verversen elke 30 s), zonder handmatig verversen', appeared && /Via reviewlink “Marketing”/.test(await page.textContent('.act-list')));
  check('pagina is niet herladen', !!(await page.$('#probe')));

  // ---------- Mobiel ----------
  const mctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'nl-NL', timezoneId: 'Europe/Amsterdam', storageState: await ectx.storageState() });
  const m = await mctx.newPage();
  watch(m, 'mobiel');
  await m.goto(`${BASE}/inbox`);
  await m.waitForSelector('.inbox-item');
  const o = await m.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
  await shot(m, '82-mobiel-inbox', { fullPage: true });
  check('mobiel: inbox zonder horizontaal scrollen', o <= 1, String(o));

  check('geen JavaScript-fouten', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  listener.close();
  server.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} controles geslaagd. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
