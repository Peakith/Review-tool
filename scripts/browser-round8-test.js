// Browsertest bouwronde 8: één vaste donkere stijl (ook met een oude lichte voorkeur, in een
// privévenster en met een licht ingesteld systeem), het nieuwe klantoverzicht (veel projecten, geen
// acties, acties per project, afgeronde projecten, ontbrekende thumbnails, laden/fout/opnieuw, traag
// netwerk), gewone reviewer tegenover akkoordgever, feedback versturen zonder herladen (speler en
// invoer blijven), freelancer met ingetrokken toegang, mobiel en toetsenbord.
// Chrome op Linux en Pixel 7-emulatie; geen Safari, geen echte Mac of telefoon.
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser:ronde8   (SHOTS_DIR=/map optioneel)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');
const { createApp } = require('../server/app');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Zet CHROME_PATH naar een Chrome met H.264-ondersteuning.'); process.exit(2); }
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ronde8-'));
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
const DARK = 'rgb(11, 20, 36)';

(async () => {
  const server = createApp({ dataDir: path.join(S, 'data'), backupDir: path.join(S, 'backups'), setupToken: 'ronde8-test-code-123', minFreeBytes: 0, variants: false, env: { ...process.env, STUDIO_REVIEW_HOME: path.join(S, 'home'), DATA_DIR: '' } });
  const listener = await new Promise((r) => { const l = server.app.listen(0, () => r(l)); });
  const BASE = `http://localhost:${listener.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const watch = (p, label) => {
    p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/40[0134]|409|410|500|Failed to load resource/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  };
  const H = { 'x-requested-with': 'review-tool' };
  const ctxOpts = { viewport: { width: 1440, height: 900 }, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' };
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  watch(page, 'team');
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
  const rid = (s) => `${s}${'a'.repeat(16)}`.slice(0, 16);
  let n = 0;
  const share = async (v, extra = {}) => {
    await apiT('POST', `/api/versions/${v.versionId}/ready`);
    await apiT('POST', `/api/versions/${v.versionId}/share`, { requestId: rid(`s${++n}`), ...extra });
  };

  // ---------- Opzet: één klant met veel projecten ----------
  const film = mp4('Hoofdfilm_DEF.mp4', 4);
  const staand = mp4('Reel staand.mp4', 3, '360x640', 'smptebars');
  await apiT('POST', '/api/setup', { setupToken: 'ronde8-test-code-123', email: 'sanne@agency.nl', name: 'Sanne de Vries', password: 'een-lang-wachtwoord' });
  const clientId = (await apiT('POST', '/api/clients', { name: 'Bakkerij Jansen', language: 'nl' })).id;
  const LONG = 'Voorjaarscampagne 2026 — landelijke lancering met een bijzonder lange projectnaam die nergens de indeling mag breken';
  const projects = {};
  for (const name of [LONG, 'Bedrijfsfilm', 'Kerstfilm 2025', 'Social zomer', 'Jubileum 75 jaar', 'Interne training', 'Beursvideo']) {
    projects[name] = (await apiT('POST', '/api/projects', { name, clientName: 'Bakkerij Jansen' })).id;
    await apiT('PUT', `/api/projects/${projects[name]}/client`, { clientId });
  }
  const pA = projects[LONG];
  const main = await apiT('POST', `/api/projects/${pA}/videos`, { uploadId: await upload(film, { projectId: pA }), title: 'Hoofdfilm met een hele lange titel die netjes moet afbreken in elke regel' });
  const reel = await apiT('POST', `/api/projects/${pA}/videos`, { uploadId: await upload(staand, { projectId: pA }), title: 'Reel 9:16' });
  const bfilm = await apiT('POST', `/api/projects/${projects.Bedrijfsfilm}/videos`, { uploadId: await upload(film, { projectId: projects.Bedrijfsfilm }), title: 'Bedrijfsfilm' });
  const kerst = await apiT('POST', `/api/projects/${projects['Kerstfilm 2025']}/videos`, { uploadId: await upload(film, { projectId: projects['Kerstfilm 2025'] }), title: 'Kerstfilm' });
  for (const v of [main, reel, bfilm, kerst]) await apiT('PATCH', `/api/videos/${v.videoId}`, { approverName: 'Joris Bakker', approverEmail: 'joris@jansen.nl' });
  for (const v of [main, reel, bfilm, kerst]) await share(v);
  for (const name of ['Social zomer', 'Jubileum 75 jaar', 'Interne training', 'Beursvideo']) {
    const v = await apiT('POST', `/api/projects/${projects[name]}/videos`, { uploadId: await upload(film, { projectId: projects[name] }), title: `${name} — film` });
    await share(v);
  }
  // Kerstfilm goedgekeurd, vrijgegeven en afgerond; Bedrijfsfilm met een vraag van het team.
  const apK = (await apiT('POST', `/api/videos/${kerst.videoId}/links`, { role: 'approver' })).url.split('/').pop();
  await page.request.post(`${BASE}/api/review/${apK}/versions/${kerst.versionId}/approve`, { headers: H, data: { confirm: true, versionNumber: 1, requestId: rid('apk') } });
  await apiT('POST', `/api/projects/${projects['Kerstfilm 2025']}/deliveries`, { items: [{ versionId: kerst.versionId }], confirm: true, requestId: rid('dlk') });
  await apiT('PUT', `/api/projects/${projects['Kerstfilm 2025']}/client-visibility`, { visibility: 'completed' });
  await apiT('POST', `/api/projects/${projects.Bedrijfsfilm}/questions`, { body: 'Mogen we het nieuwe logo al gebruiken?', requestId: rid('q1') });
  // Klanttoegang uit voor één project: verdwijnt overal.
  await apiT('PUT', `/api/projects/${projects['Interne training']}/client-visibility`, { visibility: 'off' });
  const general = (await apiT('POST', `/api/clients/${clientId}/links`, {})).url;
  const personal = (await apiT('POST', `/api/clients/${clientId}/links`, { approverName: 'Joris Bakker', approverEmail: 'joris@jansen.nl' })).url;

  // ---------- 1. Vaste donkere stijl ----------
  // Bestaande browser met een oude lichte voorkeur en een licht systeem; daarnaast een privévenster.
  const oldCtx = await browser.newContext({ ...ctxOpts, colorScheme: 'light' });
  await oldCtx.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('rt-theme', 'light'); sessionStorage.setItem('seeded', '1'); } } catch { /* */ } });
  const old = await oldCtx.newPage();
  watch(old, 'oude-browser');
  await old.goto(general);
  await old.waitForSelector('.p-group-todo');
  const oldBg = await old.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor, document.documentElement.dataset.theme]);
  check('bestaande browser met oude lichte keuze én licht systeem: donker', oldBg[0] === DARK && oldBg[1] === DARK && oldBg[2] === 'dark', oldBg.join(' '));
  const priv = await (await browser.newContext({ ...ctxOpts, colorScheme: 'light' })).newPage();
  await priv.goto(`${BASE}/login`);
  await priv.waitForSelector('input[name=email]');
  check('privévenster, licht systeem, inlogscherm: donker', (await priv.evaluate(() => getComputedStyle(document.body).backgroundColor)) === DARK);
  // Geen witte flits: de pagina zelf (vóór JavaScript) is al donker.
  const noJs = await (await browser.newContext({ ...ctxOpts, colorScheme: 'light', javaScriptEnabled: false })).newPage();
  await noJs.goto(general);
  check('zonder JavaScript (eerste weergave): achtergrond al donker', (await noJs.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)) === DARK);
  check('geen themakeuze op klantpagina’s', !(await old.isVisible('.theme-select')) && !(await old.isVisible('text=Systeem')));

  // ---------- 2. Klantoverzicht ----------
  const c = old;
  const order = await c.$$eval('main > .p-group', (els) => els.map((x) => (x.classList.contains('p-all') ? 'all' : [...x.classList].find((k) => k.startsWith('p-group-'))?.slice(8))));
  check('volgorde: Jouw acties → In behandeling/… → Goedgekeurd en afgerond → Alle projecten', order[0] === 'todo' && order.indexOf('finished') > 0 && order[order.length - 1] === 'all', order.join(' > '));
  const groups = await c.$$eval('.p-group-todo .p-project-name', (els) => els.map((e) => e.textContent));
  check('acties gegroepeerd per project (veel projecten)', groups.length >= 5 && new Set(groups).size === groups.length, groups.join(' | '));
  check('vraag staat als actie bij het juiste project', /Mogen we het nieuwe logo/.test(await c.textContent('.p-group-todo .p-project-group:has(.p-project-name:text-is("Bedrijfsfilm"))')));
  check('klanttoegang uit: project nergens zichtbaar', !(await c.textContent('main')).includes('Interne training'));
  check('afgerond project ingeklapt onder Goedgekeurd en afgerond; download los van goedkeuring', !(await c.isVisible('.p-group-completed .k-project')) && await c.isVisible('.p-group-files .p-delivery-card:has-text("Kerstfilm 2025")'));
  check('geen videospelers op het overzicht', (await c.locator('video').count()) === 0);
  const dupes = await c.$$eval('.p-group-todo .p-card-title, .p-group-busy .p-card-title', (els) => els.length - new Set(els.map((e) => e.textContent)).size);
  check('geen video dubbel in acties en lopend werk', dupes === 0, String(dupes));
  check('geen deadline zonder ingestelde deadline', (await c.locator('.p-due').count()) === 0);
  check('lange titel afgekapt, volledige titel bereikbaar', (await c.getAttribute(`.p-card-title:has-text("Hoofdfilm met een hele lange")`, 'title')).includes('netjes moet afbreken in elke regel'));
  check('staande video als thumbnail niet bijgesneden', (await c.$eval('.p-card:has-text("Reel 9:16") .p-thumb img', (i) => getComputedStyle(i).objectFit)) === 'contain');
  await shot(c, '80-klantoverzicht', { fullPage: true });
  // Toetsenbord: naar de eerste actie en openen met Enter.
  await c.focus('.p-group-todo a.p-card');
  const focusOk = await c.evaluate(() => getComputedStyle(document.activeElement).boxShadow !== 'none');
  await Promise.all([c.waitForURL(/\/r\//), c.keyboard.press('Enter')]);
  check('toetsenbord: actie heeft zichtbare focus en opent met Enter de juiste video', focusOk && await c.isVisible('.r-header'));

  // Ontbrekende thumbnails, traag netwerk en een fout met "Opnieuw proberen".
  const net = await (await browser.newContext(ctxOpts)).newPage();
  watch(net, 'netwerk');
  await net.route(/\/poster$/, (r) => r.abort());
  let failOnce = true;
  await net.route(/\/api\/client\/[^/]+$/, async (r) => {
    if (failOnce) { failOnce = false; return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Tijdelijke storing' }) }); }
    await new Promise((res) => setTimeout(res, 1500)); // traag
    return r.continue();
  });
  await net.goto(general);
  await net.waitForSelector('button:has-text("Opnieuw proberen")');
  check('fout bij laden: rustige melding met “Opnieuw proberen”', /Laden lukt niet/.test(await net.textContent('body')));
  await net.click('button:has-text("Opnieuw proberen")');
  check('traag netwerk: laadindicator zichtbaar', await net.isVisible('.spinner'));
  await net.waitForSelector('.p-group-todo', { timeout: 15000 });
  await net.waitForTimeout(400);
  check('ontbrekende thumbnails: nette vervanging', (await net.locator('.p-thumb .poster-empty').count()) >= 3);

  // Geen acties: korte melding, projecten blijven bereikbaar.
  const emptyClient = (await apiT('POST', '/api/clients', { name: 'Garage Pietersen' })).id;
  const pE = (await apiT('POST', '/api/projects', { name: 'Showroomfilm' })).id;
  await apiT('PUT', `/api/projects/${pE}/client`, { clientId: emptyClient });
  const vE = await apiT('POST', `/api/projects/${pE}/videos`, { uploadId: await upload(film, { projectId: pE }), title: 'Showroom' });
  await apiT('PATCH', `/api/videos/${vE.videoId}`, { approverName: 'Piet', approverEmail: 'piet@garage.nl' });
  await share(vE);
  const apE = (await apiT('POST', `/api/videos/${vE.videoId}/links`, { role: 'approver' })).url.split('/').pop();
  await page.request.post(`${BASE}/api/review/${apE}/versions/${vE.versionId}/approve`, { headers: H, data: { confirm: true, versionNumber: 1, requestId: rid('ape') } });
  const emptyLink = (await apiT('POST', `/api/clients/${emptyClient}/links`, {})).url;
  await net.unroute(/\/poster$/);
  await net.goto(emptyLink);
  await net.waitForSelector('.p-group-todo');
  check('geen acties: korte rustige melding', /Er wacht nu niets op jou/.test(await net.textContent('.p-group-todo')) && (await net.locator('.p-group-todo .p-card').count()) === 0);
  check('geen acties: projecten direct bereikbaar (open)', await net.isVisible('.p-all .k-project h3:has-text("Showroomfilm")'));
  check('goedgekeurd zonder vrijgave: “Nog niet vrijgegeven als download”', await net.$eval('.p-group-done', (d) => d.tagName === 'DETAILS' && !d.open) && /Nog niet vrijgegeven/.test(await net.textContent('.p-group-done')));

  // ---------- 3. Gewone reviewer tegenover akkoordgever ----------
  const g = await (await browser.newContext(ctxOpts)).newPage();
  watch(g, 'reviewer');
  await g.goto(general);
  await g.waitForSelector('.p-group-todo');
  check('algemene link: alleen “Bekijken en reageren”, nooit goedkeuren', !(await g.isVisible('text=Bekijken en goedkeuren')) && (await g.locator('.p-group-todo .p-action:has-text("Bekijken en reageren")').count()) >= 3);
  await g.click('.p-group-todo .p-card:has-text("Bedrijfsfilm")');
  await g.waitForSelector('.r-actions');
  check('reviewer: geen Goedkeuren-knop', !(await g.isVisible('button:has-text("Goedkeuren")')));
  // Feedback: reageren, “nog niet verstuurd” neutraal, versturen zonder herladen.
  await g.fill('#reviewer-name', 'Eva Jansen');
  await g.click('.r-panel .composer textarea');
  await g.fill('.r-panel .composer textarea', 'Logo iets groter graag');
  await g.click('.r-panel .composer button:has-text("Plaatsen")');
  await g.waitForSelector('.comment-state.is-pending');
  const pendingColor = await g.$eval('.comment-state.is-pending', (e) => getComputedStyle(e).color);
  const hintColor = await g.$eval('.r-actions-hint', (e) => getComputedStyle(e).color);
  check('“Nog niet verstuurd” neutraal (geen rood of oranje)', ![pendingColor, hintColor].some((col) => /rgb\(25\d, 1[0-9]\d, 1[0-2]\d\)/.test(col)), `${pendingColor} ${hintColor}`);
  // Speler en een nieuwe, nog niet geplaatste tekst blijven na versturen staan.
  await g.evaluate(() => { const v = document.querySelector('.r-stage video'); v.dataset.mark = 'zelfde'; v.muted = true; });
  await g.fill('.r-panel .composer textarea', 'Nog een gedachte');
  await g.click('.r-actions button:has-text("Feedback versturen")');
  await g.click('dialog[open] button:has-text("Feedback versturen")');
  await g.waitForSelector('.r-status-host .notice-ok');
  check('na versturen: korte bevestiging', /Je feedback is verstuurd/.test(await g.textContent('.r-status-host')));
  check('na versturen: speler niet vervangen en invoer behouden (geen herladen)', (await g.$eval('.r-stage video', (v) => v.dataset.mark)) === 'zelfde' && (await g.inputValue('.r-panel .composer textarea')) === 'Nog een gedachte');
  await g.goto(general);
  await g.waitForSelector('.p-group-todo');
  const busyText = await g.textContent('.p-group-busy');
  check('overzicht: video naar In behandeling, open vraag houdt het project bij Jouw acties', /Bedrijfsfilm/.test(busyText) && /Mogen we het nieuwe logo/.test(await g.textContent('.p-group-todo')) && /je hoeft nu niets te doen/.test(busyText), busyText.slice(0, 160));

  // Akkoordgever via de persoonlijke portaallink: direct goedkeuren, één bevestiging.
  const j = await (await browser.newContext(ctxOpts)).newPage();
  watch(j, 'akkoordgever');
  await j.goto(personal);
  await j.waitForSelector('.p-group-todo');
  await j.click('.p-group-todo .p-card:has-text("Reel 9:16")');
  await j.waitForSelector('.r-actions button:has-text("Goedkeuren")');
  check('akkoordgever: duidelijke knop “Goedkeuren”, zonder overstap naar een andere link', /\/r\//.test(j.url()) && await j.isVisible('.identity.is-verified'));
  await j.click('.r-actions button:has-text("Goedkeuren")');
  await j.waitForSelector('dialog[open] .approve-what');
  const confirmText = await j.textContent('dialog[open]');
  check('één korte bevestiging met videotitel en exact versienummer', /Reel 9:16/.test(confirmText) && /Versie 1/.test(confirmText) && (await j.locator('dialog[open] button').count()) <= 3);
  await shot(j, '81-goedkeuren-bevestigen');
  await j.click('dialog[open] button:has-text("Ja, keur Versie 1 goed")');
  await j.waitForSelector('.r-status.is-approved');
  check('goedgekeurd: actiebalk weg, status bijgewerkt zonder herladen', !(await j.isVisible('.r-actions')) && /Goedgekeurd door Joris Bakker/.test(await j.textContent('.r-status')));
  check('gewone reviewlink kan via de server nog steeds niet goedkeuren', (await call('POST', `/api/review/${(await g.evaluate(() => location.pathname)).split('/').pop()}/versions/${bfilm.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid('x') }, g)).status >= 400);

  // ---------- 4. Freelancer: ingetrokken toegang ----------
  const fien = await apiT('POST', '/api/users', { name: 'Fien Freelancer', email: 'fien@freelance.nl', password: 'een-lang-wachtwoord', role: 'freelancer' });
  await apiT('PUT', `/api/users/${fien.id}/projects`, { projects: [{ projectId: pA, role: 'freelancer' }] });
  const f = await (await browser.newContext(ctxOpts)).newPage();
  watch(f, 'freelancer');
  await f.goto(`${BASE}/login`);
  await f.fill('input[name=email]', 'fien@freelance.nl');
  await f.fill('input[name=password]', 'een-lang-wachtwoord');
  await f.click('button[type=submit]');
  await f.waitForSelector('.project-row');
  check('freelancer: donkere stijl, alleen het gekoppelde project', (await f.evaluate(() => getComputedStyle(document.body).backgroundColor)) === DARK && (await f.locator('.project-row').count()) === 1);
  await f.click('.project-row-link');
  await f.waitForSelector('.video-row');
  await shot(f, '82-freelancer-project');
  await apiT('PUT', `/api/users/${fien.id}/projects`, { projects: [] });
  await f.reload();
  await f.waitForSelector('.empty-title');
  check('ingetrokken: open projectpagina toont een duidelijke melding', /toegang|niet gevonden/i.test(await f.textContent('main')));
  await f.goto(`${BASE}/`);
  await f.waitForSelector('.page-title');
  check('ingetrokken: niets meer op de startpagina', !(await f.textContent('main')).includes('Voorjaarscampagne'));
  await f.goto(`${BASE}/account`);
  await f.waitForSelector('.page-title');
  check('freelancer: Mijn account ook na herladen bereikbaar (geen witte foutpagina)', /Mijn account/.test(await f.textContent('.page-title')));

  // ---------- 5. Mobiel ----------
  const m = await (await browser.newContext({ ...devices['Pixel 7'], locale: 'nl-NL', timezoneId: 'Europe/Amsterdam', colorScheme: 'light' })).newPage();
  watch(m, 'mobiel');
  await m.goto(general);
  await m.waitForSelector('.p-group-todo');
  const ow = await m.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
  check('mobiel klantoverzicht: geen horizontaal scrollen, lange titels breken de indeling niet', ow <= 1, String(ow));
  await shot(m, '83-mobiel-overzicht', { fullPage: true });
  await m.click('.p-group-todo .p-card:has-text("Hoofdfilm")');
  await m.waitForSelector('.r-actions');
  const stageTop = await m.$eval('.r-stage', (e) => e.getBoundingClientRect().top);
  const panelTop = await m.$eval('.r-panel', (e) => e.getBoundingClientRect().top);
  check('mobiel review: speler boven, reacties eronder', stageTop < panelTop);
  await m.focus('.r-panel .composer textarea');
  await m.waitForTimeout(150);
  check('mobiel: actiebalk wijkt tijdens typen', !(await m.isVisible('.r-actions')));
  await m.evaluate(() => document.activeElement.blur());
  await m.waitForTimeout(150);
  const pad = await m.$eval('.r-actions-inner', (e) => getComputedStyle(e).paddingBottom);
  check('mobiel: actiebalk terug, met ruimte voor de schermrand', await m.isVisible('.r-actions') && parseFloat(pad) >= 10, pad);
  await shot(m, '84-mobiel-review');

  check('geen JavaScript-fouten', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  listener.close();
  server.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} controles geslaagd. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
