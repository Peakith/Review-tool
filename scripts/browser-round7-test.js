// Browsertest bouwronde 7 (stijl 2): projectpagina met voorvertoning (geen autoplay, wisselen stopt
// de vorige speler), omslag kiezen en terugzetten, persoonlijk vastzetten met twee accounts,
// strikt alleen-lezen freelancer (ook via directe verzoeken) en verlopen toegang, de volgorde van
// het klantportaal met goedkeurrechten, een nieuwe versie zonder overgenomen goedkeuring,
// vastzetten per browser voor de klant, de mobiele actiebalk en toetsenbordbediening.
// Chrome op Linux; geen Safari, geen echte Mac of telefoon.
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser:ronde7   (SHOTS_DIR=/map optioneel)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');
const { createApp } = require('../server/app');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Zet CHROME_PATH naar een Chrome met H.264-ondersteuning.'); process.exit(2); }
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ronde7-'));
const SHOTS = process.env.SHOTS_DIR || path.join(S, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const shot = async (page, name, opts = {}) => {
  await page.evaluate(() => document.querySelectorAll('.toast-host > *').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};
const mp4 = (name, sec, size = '640x360', pattern = 'testsrc2') => {
  const f = path.join(S, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `${pattern}=size=${size}:rate=25:duration=${sec}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${sec}`, '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', f]);
  return f;
};

(async () => {
  const server = createApp({ dataDir: path.join(S, 'data'), backupDir: path.join(S, 'backups'), setupToken: 'ronde7-test-code-123', minFreeBytes: 0, variants: false, env: { ...process.env, STUDIO_REVIEW_HOME: path.join(S, 'home'), DATA_DIR: '' } });
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
  const call = async (method, url, data, p = page) => {
    const r = await p.request.fetch(`${BASE}${url}`, { method, headers: H, data });
    return { status: r.status(), data: await r.json().catch(() => null) };
  };
  const apiT = async (method, url, data, p = page) => {
    const r = await call(method, url, data, p);
    if (r.status >= 400) throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
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
  const rid = (s) => `${s}${'a'.repeat(16)}`.slice(0, 16);

  // ---------- Opzet ----------
  const film = mp4('Hoofdfilm_DEF_v03.mp4', 4);
  const staand = mp4('Reel 9x16 v1.mp4', 3, '360x640', 'smptebars');
  const nieuw = mp4('Hoofdfilm_DEF_v04.mp4', 4, '640x360', 'rgbtestsrc');
  await apiT('POST', '/api/setup', { setupToken: 'ronde7-test-code-123', email: 'sanne@agency.nl', name: 'Sanne de Vries', password: 'een-lang-wachtwoord' });
  const LONG = 'Voorjaarscampagne 2026 — landelijke lancering met een bijzonder lange projectnaam die moet afbreken';
  const pA = (await apiT('POST', '/api/projects', { name: LONG, clientName: 'Bakkerij Jansen' })).id;
  const pB = (await apiT('POST', '/api/projects', { name: 'Bedrijfsfilm', clientName: 'Bakkerij Jansen' })).id;
  const pC = (await apiT('POST', '/api/projects', { name: 'Geheim project' })).id;
  const main = await apiT('POST', `/api/projects/${pA}/videos`, { uploadId: await upload(film, { projectId: pA }), title: 'Hoofdfilm' });
  const reel = await apiT('POST', `/api/projects/${pA}/videos`, { uploadId: await upload(staand, { projectId: pA }), title: 'Reel staand' });
  const bfilm = await apiT('POST', `/api/projects/${pB}/videos`, { uploadId: await upload(film, { projectId: pB }), title: 'Bedrijfsfilm' });
  await apiT('POST', `/api/projects/${pC}/videos`, { uploadId: await upload(staand, { projectId: pC }), title: 'Geheime teaser' });
  await apiT('PATCH', `/api/videos/${main.videoId}`, { kind: 'main', approverName: 'Joris Bakker', approverEmail: 'joris@jansen.nl' });
  await apiT('PATCH', `/api/videos/${reel.videoId}`, { kind: 'social', approverName: 'Joris Bakker', approverEmail: 'joris@jansen.nl' });
  await apiT('PATCH', `/api/videos/${bfilm.videoId}`, { approverName: 'Joris Bakker', approverEmail: 'joris@jansen.nl' });
  for (const v of [main, reel, bfilm]) {
    await apiT('POST', `/api/versions/${v.versionId}/ready`);
    await apiT('POST', `/api/versions/${v.versionId}/share`, { requestId: rid(`s${v.versionId}`) });
  }
  const clientId = (await apiT('POST', '/api/clients', { name: 'Bakkerij Jansen', language: 'nl' })).id;
  for (const p of [pA, pB]) await apiT('PUT', `/api/projects/${p}/client`, { clientId });
  const general = (await apiT('POST', `/api/clients/${clientId}/links`, {})).url;
  const personal = (await apiT('POST', `/api/clients/${clientId}/links`, { approverName: 'Joris Bakker', approverEmail: 'joris@jansen.nl' })).url;
  const edith = await apiT('POST', '/api/users', { name: 'Edith Editor', email: 'edith@agency.nl', password: 'een-lang-wachtwoord', role: 'member' });
  await apiT('PUT', `/api/users/${edith.id}/projects`, { projects: [{ projectId: pA, role: 'editor' }, { projectId: pB, role: 'editor' }] });
  const fien = await apiT('POST', '/api/users', { name: 'Fien Freelancer', email: 'fien@freelance.nl', password: 'een-lang-wachtwoord', role: 'freelancer' });
  await apiT('PUT', `/api/users/${fien.id}/projects`, { projects: [{ projectId: pA, role: 'freelancer', expiresAt: new Date(Date.now() + 86400000).toISOString() }] });

  // ---------- Projectpagina: voorvertoning ----------
  await page.goto(`${BASE}/projecten/${pA}`);
  await page.waitForSelector('.project-preview');
  check('geen autoplay: bij openen nog geen video geladen', (await page.locator('video').count()) === 0);
  check('lange projecttitel afgekapt met volledige titel beschikbaar', (await page.getAttribute('.project-head .page-title', 'title')) === LONG || (await page.textContent('.project-head .page-title')).trim() === LONG);
  const firstTitle = (await page.textContent('.preview-title')).trim();
  await page.click('.preview-play');
  await page.waitForFunction(() => { const v = document.querySelector('.project-preview video'); return v && !v.paused && v.currentTime > 0.2; }, null, { timeout: 20000 });
  check('afspelen start pas na klikken', true);
  const other = firstTitle === 'Hoofdfilm' ? reel : main;
  const otherTitle = other === reel ? 'Reel staand' : 'Hoofdfilm';
  await page.click(`.video-card[data-id="${other.videoId}"] .video-card-thumb`);
  await page.waitForFunction((t) => document.querySelector('.preview-title')?.textContent.trim() === t, otherTitle);
  const playing = await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused).length);
  check('wisselen: vorige speler gestopt (geen geluid op de achtergrond)', playing === 0, `${playing} spelend`);
  check('wisselen: voorvertoning en adresbalk tonen de gekozen video', new URL(page.url()).searchParams.get('video') === String(other.videoId));
  check('kiezen in de voorvertoning verandert geen status', (await apiT('GET', `/api/videos/${main.videoId}`)).versions[0].status === 'in_review');
  // Toetsenbord: kaart kiezen met Enter
  await page.focus(`.video-card:not([data-id="${other.videoId}"]) .video-card-thumb`);
  await page.keyboard.press('Enter');
  await page.waitForFunction((t) => document.querySelector('.preview-title')?.textContent.trim() !== t, otherTitle);
  check('toetsenbord: kaart kiezen met Enter', true);
  await page.click(`.video-card[data-id="${reel.videoId}"] .video-card-thumb`);
  await page.waitForSelector('.preview-stage.is-portrait');
  const fit = await page.evaluate(() => getComputedStyle(document.querySelector('.preview-stage img')).objectFit);
  check('staande video volledig zichtbaar (niet bijgesneden)', fit === 'contain', fit);
  await shot(page, '70-projectpagina');

  // ---------- Omslag ----------
  const coverBefore = (await apiT('GET', `/api/projects/${pA}`)).cover;
  check('bestaand project heeft zonder instellen een automatische omslag', coverBefore?.mode === 'auto');
  await page.click('.cover-edit');
  await page.waitForSelector('dialog[open] .cover-option');
  await page.click('dialog[open] .cover-option:has-text("Reel staand")');
  await page.click('dialog[open] button:has-text("Omslag opslaan")');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  let cov = (await apiT('GET', `/api/projects/${pA}`)).cover;
  check('omslag gekozen uit een thumbnail', cov.mode === 'version' && cov.versionId === reel.versionId, JSON.stringify(cov));
  const after = await apiT('GET', `/api/videos/${reel.videoId}`);
  check('omslag verandert geen videotitel of thumbnail', after.title === 'Reel staand' && server.db.prepare('SELECT custom_poster FROM versions WHERE id = ?').get(reel.versionId).custom_poster === 0);
  await page.waitForSelector('.cover-edit');
  await page.click('.cover-edit');
  await page.click('dialog[open] .cover-option:has-text("Automatisch")');
  await page.click('dialog[open] button:has-text("Omslag opslaan")');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  cov = (await apiT('GET', `/api/projects/${pA}`)).cover;
  check('omslag terug naar automatisch', cov.mode === 'auto');

  // ---------- Vastzetten met twee accounts ----------
  await page.goto(`${BASE}/projecten`);
  await page.waitForSelector('.project-card');
  await page.click('.project-card:has-text("Bedrijfsfilm") .pin-btn');
  await page.waitForFunction(() => document.querySelector('.project-card .project-name')?.textContent === 'Bedrijfsfilm');
  await page.reload();
  await page.waitForSelector('.project-card');
  check('vastgezet project staat bovenaan, ook na herladen', (await page.textContent('.project-card .project-name')) === 'Bedrijfsfilm' && (await page.getAttribute('.project-card .pin-btn', 'aria-pressed')) === 'true');
  const ectx = await browser.newContext(ctxOpts);
  const e = await ectx.newPage();
  watch(e, 'edith');
  await login(e, 'edith@agency.nl');
  await e.waitForSelector('.dash-card');
  check('ander account: dashboard zonder mijn vastgezette projecten', !(await e.textContent('.dash-card[data-widget="pinned"]')).includes('Bedrijfsfilm'));
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.dash-card[data-widget="pinned"]');
  check('eigen dashboard: Vastgezet toont het project met omslag', /Bedrijfsfilm/.test(await page.textContent('.dash-card[data-widget="pinned"]')) && (await page.locator('.dash-card[data-widget="pinned"] img').count()) >= 1);
  await shot(page, '71-dashboard');

  // ---------- Freelancer: strikt alleen-lezen, vastzetten en verlopen ----------
  const fctx = await browser.newContext(ctxOpts);
  const f = await fctx.newPage();
  watch(f, 'freelancer');
  await login(f, 'fien@freelance.nl');
  await f.waitForSelector('.project-row');
  check('freelancer: start met omslag uit gedeelde versie', (await f.locator('.project-row .project-row-cover img').count()) === 1 && !(await f.textContent('main')).includes('Geheim'));
  await f.click('.project-row .pin-btn');
  await f.waitForFunction(() => document.querySelector('.project-row .pin-btn')?.getAttribute('aria-pressed') === 'true');
  const forbidden = [
    ['POST', `/api/versions/${main.versionId}/comments`, { body: 'Mag niet', timecode: 1 }],
    ['POST', '/api/uploads', { filename: 'x.mp4', size: 10, projectId: pA }],
    ['POST', `/api/versions/${main.versionId}/share`, {}],
    ['PATCH', `/api/videos/${main.videoId}`, { title: 'Gewijzigd' }],
    ['PUT', `/api/projects/${pA}/cover`, { mode: 'auto' }],
    ['GET', `/api/versions/${main.versionId}/download`],
    ['PUT', `/api/pins/${pC}`, { pinned: true }],
  ];
  const statuses = [];
  for (const [m, u, d] of forbidden) statuses.push((await call(m, u, d, f)).status);
  check('freelancer: verboden acties via directe verzoeken geweigerd', statuses.every((s) => s === 403 || s === 404), statuses.join(','));
  server.db.prepare('UPDATE project_members SET expires_at = ? WHERE user_id = ?').run(new Date(Date.now() - 1000).toISOString(), fien.id);
  await f.reload();
  await f.waitForSelector('.page-title');
  const ov = await call('GET', '/api/freelance/overview', null, f);
  const search = await call('GET', '/api/search?q=Hoofdfilm', null, f);
  check('verlopen: weg uit overzicht en favorieten', !(await f.textContent('main')).includes('Voorjaarscampagne') && (ov.status >= 400 || ov.data.projects.length === 0), String(ov.status));
  check('verlopen: zoeken en media geven niets', (search.status >= 400 || !JSON.stringify(search.data).includes('Hoofdfilm')) && (await call('GET', `/api/freelance/projects/${pA}/cover`, null, f)).status >= 400, String(search.status));
  check('verlopen: losmaken kan niet meer (geen bestaan prijsgeven)', (await call('PUT', `/api/pins/${pA}`, { pinned: false }, f)).status === 404);

  // ---------- Klantportaal: volgorde, goedkeurrechten, nieuwe versie ----------
  const apToken = (await apiT('POST', `/api/videos/${bfilm.videoId}/links`, { role: 'approver' })).url.split('/').pop();
  await page.request.post(`${BASE}/api/review/${apToken}/versions/${bfilm.versionId}/approve`, { headers: H, data: { confirm: true, versionNumber: 1, requestId: rid('apb') } });
  await apiT('POST', `/api/projects/${pB}/deliveries`, { items: [{ versionId: bfilm.versionId }], confirm: true, requestId: rid('dlb') });
  const cctx = await browser.newContext(ctxOpts);
  const c = await cctx.newPage();
  watch(c, 'klant');
  await c.goto(personal);
  await c.waitForSelector('.p-group');
  const order = await c.$$eval('main .p-group', (els) => els.map((x) => [...x.classList].find((k) => k.startsWith('p-group-') && k !== 'p-group')?.slice(8) || (x.classList.contains('p-all') ? 'all' : '?')));
  // 0.9.0: Jouw acties → In behandeling → Goedgekeurd en afgerond (met o.a. definitieve bestanden) → Alle projecten.
  const want = ['todo', 'busy', 'finished', 'all'];
  const idx = order.map((k) => want.indexOf(k));
  check('klantportaal: Jouw acties → In behandeling → Goedgekeurd en afgerond → Alle projecten', order[0] === 'todo' && idx.every((x, i) => x >= 0 && (i === 0 || x > idx[i - 1])), order.join(' > '));
  check('klantportaal: Goedgekeurd standaard ingeklapt', !(await c.isVisible('.p-group-done .p-list')) || (await c.getAttribute('.p-group-done', 'open')) === null);
  check('klantportaal: omslagen alleen in ingeklapte overzichten (duwen acties niet omlaag)', (await c.locator('.p-group-todo .k-cover, .p-group-busy .k-cover').count()) === 0 && (await c.locator('.p-all .k-cover').count()) >= 1);
  // Nieuwe versie van de goedgekeurde video: goedkeuring niet overgenomen
  const v2 = await apiT('POST', `/api/videos/${bfilm.videoId}/versions`, { uploadId: await upload(nieuw, { videoId: bfilm.videoId }) });
  await apiT('POST', `/api/versions/${v2.versionId}/ready`);
  await apiT('POST', `/api/versions/${v2.versionId}/share`, { requestId: rid('s2') });
  check('nieuwe versie neemt goedkeuring niet over', (await apiT('GET', `/api/videos/${bfilm.videoId}`)).versions[0].status === 'in_review');
  await c.reload();
  await c.waitForSelector('.p-group-todo');
  check('nieuwe versie staat weer bij Jouw acties', /Bedrijfsfilm/.test(await c.textContent('.p-group-todo')));
  check('levering van v1 blijft beschikbaar', /Definitieve bestanden/.test(await c.textContent('main')));
  // Vastzetten per browser
  await c.click('summary:has-text("Alle projecten")');
  await c.click('.p-all .k-project:has-text("Bedrijfsfilm") .pin-btn');
  await c.reload();
  await c.waitForSelector('.p-all');
  await c.click('summary:has-text("Alle projecten")');
  check('klant: vastzetten in deze browser blijft na herladen; project bovenaan', (await c.textContent('.p-all .k-project h3')) === 'Bedrijfsfilm' && (await c.getAttribute('.p-all .k-project .pin-btn', 'aria-pressed')) === 'true');
  check('klant: acties blijven boven het overzicht', await c.evaluate(() => document.querySelector('.p-group-todo').compareDocumentPosition(document.querySelector('.p-all')) & Node.DOCUMENT_POSITION_FOLLOWING));
  await shot(c, '72-klantportaal', { fullPage: true });
  // Algemene link: geen goedkeurrecht
  const g = await cctx.newPage();
  await g.goto(general);
  await g.waitForSelector('.p-group');
  check('algemene link: geen goedkeurknop', !(await g.isVisible('text=Bekijken en goedkeuren')));

  // ---------- Mobiel: vaste actiebalk ----------
  const mctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' });
  const m = await mctx.newPage();
  watch(m, 'mobiel');
  await m.goto(personal);
  await m.waitForSelector('.p-group-todo');
  await m.click('.p-group-todo .p-card:has-text("Hoofdfilm")');
  await m.waitForSelector('.r-actions button:has-text("Goedkeuren")');
  check('mobiel: actiebalk met Feedback versturen en Goedkeuren', await m.isVisible('.r-actions button:has-text("Feedback versturen")'));
  await m.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await m.waitForTimeout(300);
  const covered = await m.evaluate(() => {
    const bar = document.querySelector('.r-actions').getBoundingClientRect().top;
    const items = [...document.querySelectorAll('.r-panel > *')].filter((x) => x.offsetHeight);
    return items.length ? items[items.length - 1].getBoundingClientRect().bottom - bar : 0;
  });
  check('mobiel: actiebalk dekt onderaan geen reacties af', covered <= 1, `${Math.round(covered)}px`);
  await m.focus('.r-panel textarea');
  await m.waitForTimeout(150);
  check('mobiel: tijdens typen wijkt de actiebalk (invoer nooit afgedekt)', !(await m.isVisible('.r-actions')));
  await shot(m, '73-mobiel-typen');
  await m.evaluate(() => document.activeElement.blur());
  await m.waitForTimeout(150);
  check('mobiel: na typen is de actiebalk terug', await m.isVisible('.r-actions'));
  const ow = await m.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
  check('mobiel: geen horizontaal scrollen', ow <= 1, String(ow));

  check('geen JavaScript-fouten', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  listener.close();
  server.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} controles geslaagd. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
