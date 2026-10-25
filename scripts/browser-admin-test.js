// Browsertest van de beheerschermen: rechten, opslag & back-ups, prullenbak en archief.
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser:beheer   (optioneel SHOTS_DIR=/map)
// Start zelf tijdelijke servers met lege gegevens; raakt je eigen data niet aan.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');
const { createApp } = require('../server/app');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Zet CHROME_PATH naar een Chrome met H.264-ondersteuning.'); process.exit(2); }
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-beheertest-'));
const SHOTS = process.env.SHOTS_DIR || path.join(S, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const shot = async (page, name, opts = {}) => {
  // Oude meldingen weghalen zodat ze de schermafbeelding niet bedekken.
  await page.evaluate(() => document.querySelectorAll('.toast-host > *').forEach((t) => t.remove()));
  return page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};
const setupToken = 'beheertest-installatiecode';

function makeVideo(name, seconds = 6) {
  const file = path.join(S, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=25:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=500:duration=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', file]);
  return file;
}

async function start(overrides = {}) {
  const dataDir = path.join(S, overrides.name || 'data');
  const created = createApp({ dataDir, backupDir: `${dataDir}-backups`, setupToken, minFreeBytes: 0, env: { ...process.env, STUDIO_REVIEW_HOME: `${dataDir}-home` }, ...overrides.config });
  const listener = await new Promise((r) => { const l = created.app.listen(0, () => r(l)); });
  return { ...created, base: `http://127.0.0.1:${listener.address().port}`, close: () => { created.stop(); listener.close(); } };
}

/** API-aanroepen met de cookies van de ingelogde pagina. */
const apiOf = (page, base) => ({
  async call(method, url, body) {
    const r = await page.request.fetch(base + url, { method, headers: { 'x-requested-with': 'review-tool', 'content-type': 'application/json' }, data: body ? JSON.stringify(body) : undefined });
    return { status: r.status(), data: await r.json().catch(() => null) };
  },
  async upload(file, target) {
    const buf = fs.readFileSync(file);
    const init = await this.call('POST', '/api/uploads', { filename: path.basename(file), size: buf.length, ...target });
    for (let off = 0; off < buf.length; off += init.data.chunkSize) {
      await page.request.fetch(`${base}/api/uploads/${init.data.id}?offset=${off}`, { method: 'PUT', headers: { 'x-requested-with': 'review-tool', 'content-type': 'application/octet-stream' }, data: buf.subarray(off, off + init.data.chunkSize) });
    }
    return init.data.id;
  },
});

(async () => {
  const fileA = makeVideo('campagne_hoofdfilm_v1.mp4');
  const fileB = makeVideo('bedrijfsfilm_interview.mp4', 4);
  const srv = await start();
  const browser = await chromium.launch({ executablePath: CHROME, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  const errors = [];
  const watch = (p, label) => {
    p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/40[34]|410|409/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  };

  // ---------- Beheerder: opzet ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'beheer');
  await page.goto(`${srv.base}/?setup=${setupToken}`);
  await page.fill('input[name=name]', 'Sanne de Vries');
  await page.fill('input[name=email]', 'sanne@agency.nl');
  await page.fill('input[name=password]', 'een-lang-wachtwoord');
  await page.click('button[type=submit]');
  await page.waitForSelector('.onboarding');
  const api = apiOf(page, srv.base);
  const pA = (await api.call('POST', '/api/projects', { name: 'Voorjaarscampagne 2026', clientName: 'Bakkerij Jansen' })).data.id;
  const pB = (await api.call('POST', '/api/projects', { name: 'Bedrijfsfilm Van Dijk', clientName: 'Van Dijk Logistiek' })).data.id;
  const vA = (await api.call('POST', `/api/projects/${pA}/videos`, { uploadId: await api.upload(fileA, { projectId: pA }), title: 'Campagnefilm — Hoofdvideo' })).data;
  const vB = (await api.call('POST', `/api/projects/${pB}/videos`, { uploadId: await api.upload(fileB, { projectId: pB }), title: 'Interview directeur' })).data;
  await api.call('POST', `/api/versions/${vA.versionId}/ready`);
  await api.call('POST', `/api/versions/${vA.versionId}/share`);
  await api.call('POST', `/api/videos/${vA.videoId}/versions`, { uploadId: await api.upload(fileA, { videoId: vA.videoId }) });
  const reviewUrl = (await api.call('GET', `/api/videos/${vA.videoId}`)).data.links[0].url;
  await page.reload();
  await page.waitForSelector('.dash-card');
  check('na het eerste project opent de app op het dashboard', await page.isVisible('.dash-card:has-text("Recente projecten")'));
  check('versienummer zichtbaar in de zijbalk', /Studio Review \d+\.\d+\.\d+ \(build [0-9a-f]{8}\)/.test(await page.textContent('.side-version')), await page.textContent('.side-version'));

  // ---------- Team & rechten ----------
  await page.click('.side-nav a:has-text("Instellingen")');
  await page.click('.settings-nav a:has-text("Team & rechten")');
  await page.waitForSelector('.member-list');
  // Bouwronde 6: een freelancer is een eigen accountsoort (alleen klantfeedback bekijken).
  const form = page.locator('form.card:has-text("Account toevoegen")');
  await form.locator('input').nth(0).fill('Freek Freelancer');
  await form.locator('input[type=email]').fill('freek@freelance.nl');
  await form.locator('input[type=password]').fill('een-lang-wachtwoord');
  await form.locator('select').selectOption('freelancer');
  await form.locator('button[type=submit]').click();
  await page.waitForSelector('dialog .access-list');
  const roleOptions = await page.locator('dialog select[aria-label="Rol in Voorjaarscampagne 2026"] option').allTextContents();
  check('freelanceraccount: per project alleen “Geen toegang” of “Freelancer”', JSON.stringify(roleOptions) === JSON.stringify(['Geen toegang', 'Freelancer']), roleOptions.join(' | '));
  await page.selectOption('dialog select[aria-label="Rol in Voorjaarscampagne 2026"]', 'freelancer');
  await shot(page, '21-rechten-dialoog');
  await page.click('dialog button:has-text("Opslaan")');
  await page.waitForSelector('.member-row:has-text("Freek Freelancer") .member-scope:has-text("Voorjaarscampagne 2026 (freelancer)")');
  check('freelancer toegevoegd met projecttoegang', await page.isVisible('.member-row:has-text("Freek Freelancer") .badge:has-text("Freelancer")'));
  check('rechtenmatrix op de teampagina', await page.isVisible('.rights-table th:has-text("Freelancer")'));
  await shot(page, '20-team-en-rechten', { fullPage: true });

  // ---------- Freelancer: eigen alleen-lezen omgeving ----------
  const fctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const f = await fctx.newPage();
  watch(f, 'freelancer');
  await f.goto(`${srv.base}/login`);
  await f.fill('input[name=email]', 'freek@freelance.nl');
  await f.fill('input[name=password]', 'een-lang-wachtwoord');
  await f.click('button[type=submit]');
  await f.waitForSelector('.is-freelance .page-title:has-text("Klantfeedback")');
  const fText = await f.textContent('main');
  check('freelancer: start toont alleen het eigen project', fText.includes('Voorjaarscampagne') && !fText.includes('Van Dijk'));
  check('freelancer: geen teammenu (dashboard, klanten, instellingen, nieuw project)', !(await f.isVisible('.side-nav a:has-text("Klanten")')) && !(await f.isVisible('.side-nav a:has-text("Instellingen")')) && !(await f.isVisible('text=Nieuw project')));
  for (const url of ['/api/storage', '/api/projects', `/api/versions/${vB.versionId}/media`, `/api/projects/${pB}`]) {
    const r = await f.request.get(`${srv.base}${url}`);
    check(`freelancer: ${url} rechtstreeks geweigerd`, r.status() === 403, String(r.status()));
  }
  await f.click('.list-row');
  await f.waitForSelector('.page-title');
  check('freelancer: projectpagina zonder upload-, deel- of beheerknoppen', !(await f.isVisible('button:has-text("Nieuwe video")')) && !(await f.isVisible('button:has-text("Delen")')) && !(await f.isVisible('button[aria-label="Projectacties"]')));
  await shot(f, '22-freelancer-project');
  await f.goto(`${srv.base}/projecten/${pB}`);
  await f.waitForSelector('.empty-title');
  check('freelancer: ander project via URL → geen toegang', /Geen toegang/.test(await f.textContent('main')));
  await f.goto(`${srv.base}/instellingen/opslag`);
  await f.waitForSelector('.empty-title');
  check('freelancer: beheerpagina niet beschikbaar', /niet beschikbaar in je rol/.test(await f.textContent('main')));

  // ---------- Opslag & back-ups ----------
  await page.click('.side-nav a:has-text("Instellingen")');
  await page.click('.settings-nav a:has-text("Opslag & back-ups")');
  await page.waitForSelector('.stat-tiles');
  check('opslagpagina toont schijfruimte en gebruik per project', await page.isVisible('.disk-bar') && (await page.locator('.data-table tbody tr').count()) >= 2);
  await page.click('button:has-text("Nu back-up maken")');
  await page.waitForSelector('.backup-list .pill-approved', { timeout: 60_000 });
  check('back-up via de knop gemaakt en als volledig gemarkeerd', (await page.textContent('.backup-list')).includes('2 projecten'));
  await shot(page, '23-opslag-en-backups', { fullPage: true });

  // ---------- Prullenbak ----------
  await page.goto(`${srv.base}/video/${vB.videoId}`);
  await page.waitForSelector('.publish-bar');
  await page.click('button[aria-label="Meer acties"]');
  await page.click('.menu:not([hidden]) .menu-item:has-text("Video naar prullenbak")');
  await page.click('dialog button:has-text("Naar prullenbak")');
  await page.waitForURL(/\/projecten\//);
  const undo = page.locator('.toast-action:has-text("Ongedaan maken")');
  await undo.waitFor();
  check('na "naar prullenbak" verschijnt "Ongedaan maken"', true);
  await undo.click();
  await page.waitForSelector('.video-row:has-text("Interview directeur")');
  check('"Ongedaan maken" zet de video terug', true);
  await page.click('.video-row:has-text("Interview directeur") button[aria-label^="Acties voor"]');
  await page.click('.menu:not([hidden]) .menu-item:has-text("Naar prullenbak")');
  await page.click('dialog button:has-text("Naar prullenbak")');
  await page.waitForSelector('.toast:has-text("prullenbak")');
  const clientMediaTrashed = await page.request.get(`${srv.base}/api/versions/${vB.versionId}/media`);
  check('video in prullenbak: ook voor beheerder niet direct op te vragen (410)', clientMediaTrashed.status() === 410);
  await page.click('.side-nav a:has-text("Instellingen")');
  await page.click('.settings-nav a:has-text("Prullenbak")');
  await page.waitForSelector('.trash-item');
  await shot(page, '24-prullenbak');
  await page.click('.trash-item:has-text("Interview directeur") button:has-text("Definitief verwijderen")');
  await page.waitForSelector('dialog .purge-files li');
  const dialogText = await page.textContent('dialog');
  check('definitief verwijderen toont bestanden en vrij te maken ruimte vooraf', dialogText.includes('bedrijfsfilm_interview.mp4') && /komt vrij/.test(dialogText));
  await shot(page, '25-definitief-verwijderen');
  await page.click('dialog button:has-text("Definitief verwijderen")');
  check('zonder bevestigingsvinkje gebeurt er niets', await page.isVisible('dialog[open]'));
  await page.check('dialog .purge-ack input');
  await page.click('dialog button:has-text("Definitief verwijderen")');
  await page.waitForSelector('.empty-title:has-text("De prullenbak is leeg")');
  check('na definitief verwijderen is de prullenbak leeg', true);

  // ---------- Archief ----------
  await page.goto(`${srv.base}/projecten/${pA}`);
  await page.click('button[aria-label="Projectacties"]');
  await page.click('.menu:not([hidden]) .menu-item:has-text("Archiveren")');
  await page.waitForSelector('.notice:has-text("Dit project is gearchiveerd")');
  check('project gearchiveerd, alleen-lezen melding', !(await page.isVisible('button:has-text("Nieuwe video")')));
  await page.click('.side-nav a:has-text("Projecten")');
  await page.click('.projects-foot a:has-text("Gearchiveerde projecten")');
  await page.waitForSelector('.trash-item:has-text("Voorjaarscampagne 2026")');
  await shot(page, '26-archief');
  const cctx = await browser.newContext({ ...devices['Pixel 7'] });
  const client = await cctx.newPage();
  watch(client, 'klant');
  await client.goto(reviewUrl);
  await client.waitForSelector('.r-status');
  check('klant van gearchiveerd project: kan kijken, niet reageren', (await client.textContent('.r-status')).includes('gearchiveerd') && !(await client.isVisible('.composer')) && !(await client.isVisible('.r-actions')));
  await shot(client, '27-klant-gearchiveerd-mobiel');
  await page.click('.trash-item:has-text("Voorjaarscampagne") button:has-text("Uit archief halen")');
  await page.waitForSelector('.empty-title:has-text("Geen gearchiveerde projecten")');
  check('project uit archief gehaald', true);

  // ---------- Externe schijf ontbreekt ----------
  const off = await start({ name: 'extern', config: { mediaDir: '/Volumes/StudioReviewSchijf/media', mediaConfigured: true, uploadTmpDir: '/Volumes/StudioReviewSchijf/media/.uploads-tmp' } });
  const octx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const o = await octx.newPage();
  await o.goto(`${off.base}/?setup=${setupToken}`);
  await o.fill('input[name=name]', 'Sanne');
  await o.fill('input[name=email]', 'sanne@agency.nl');
  await o.fill('input[name=password]', 'een-lang-wachtwoord');
  await o.click('button[type=submit]');
  await o.waitForSelector('.system-banner.is-error');
  check('ontbrekende externe schijf: duidelijke melding', (await o.textContent('.system-banner')).includes('“StudioReviewSchijf” is niet aangesloten'));
  await o.click('.side-nav a:has-text("Instellingen")');
  await o.click('.settings-nav a:has-text("Opslag & back-ups")');
  await o.waitForSelector('.notice-error:has-text("Opslag niet bereikbaar")');
  await shot(o, '28-externe-schijf-ontbreekt');
  check('geen map aangemaakt onder /Volumes', !fs.existsSync('/Volumes/StudioReviewSchijf'));
  off.close();

  check('geen JavaScript-fouten in de browser', errors.length === 0, errors.join(' | '));
  await browser.close();
  srv.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nSchermafbeeldingen: ${SHOTS}`);
  console.log(`${results.length - failed}/${results.length} controles geslaagd`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
