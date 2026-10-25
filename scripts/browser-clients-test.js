// Browsertest bouwronde 5, fase B: klanten en klantportaal, klanttoegang per project, eenvoudiger
// goedkeuren via een persoonlijke portaallink, NL/EN, vorige/volgende met bescherming van niet-verstuurde
// invoer, en wachtwoord/vervaldatum op links. Desktop (Chrome) en Pixel 7-emulatie; geen echt toestel.
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser:klanten   (SHOTS_DIR=/map optioneel)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');
const { createApp } = require('../server/app');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Zet CHROME_PATH naar een Chrome met H.264-ondersteuning.'); process.exit(2); }
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-klanttest-'));
const SHOTS = process.env.SHOTS_DIR || path.join(S, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const shot = async (page, name, opts = {}) => {
  await page.evaluate(() => document.querySelectorAll('.toast-host > *').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};
const mp4 = (name, size = '1280x720', sec = 4) => {
  const f = path.join(S, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=25:duration=${sec}`, '-f', 'lavfi', '-i', `sine=frequency=500:duration=${sec}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]);
  return f;
};

(async () => {
  const server = createApp({ dataDir: path.join(S, 'data'), backupDir: path.join(S, 'backups'), setupToken: 'klant-test-code-1234', minFreeBytes: 0, env: { ...process.env, STUDIO_REVIEW_HOME: path.join(S, 'home'), DATA_DIR: '' } });
  const listener = await new Promise((r) => { const l = server.app.listen(0, () => r(l)); });
  const BASE = `http://localhost:${listener.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const watch = (p, label) => {
    p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/40[0134]|409|410|429/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  };
  const H = { 'x-requested-with': 'review-tool' };
  const ctxOpts = { viewport: { width: 1440, height: 900 }, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' };

  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  watch(page, 'team');
  const apiT = async (method, url, data) => {
    const r = await page.request.fetch(`${BASE}${url}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const upload = async (file, target) => {
    const buf = fs.readFileSync(file);
    const up = await apiT('POST', '/api/uploads', { filename: path.basename(file), size: buf.length, ...target });
    for (let o = 0; o < buf.length; o += up.chunkSize) await page.request.put(`${BASE}/api/uploads/${up.id}?offset=${o}`, { headers: { ...H, 'content-type': 'application/octet-stream' }, data: buf.subarray(o, o + up.chunkSize) });
    return up.id;
  };
  await apiT('POST', '/api/setup', { setupToken: 'klant-test-code-1234', email: 'sanne@agency.nl', name: 'Sanne de Vries', password: 'een-lang-wachtwoord' });
  const file = mp4('film.mp4');
  const vertical = mp4('reel.mp4', '720x1280', 3);
  const pA = (await apiT('POST', '/api/projects', { name: 'Voorjaarscampagne', clientName: 'Bakkerij Jansen' })).id;
  const pB = (await apiT('POST', '/api/projects', { name: 'Kerstfilm 2025', clientName: 'Bakkerij Jansen' })).id;
  const pC = (await apiT('POST', '/api/projects', { name: 'Ander project', clientName: 'Bakkerij Jansen' })).id;
  const main = await apiT('POST', `/api/projects/${pA}/videos`, { uploadId: await upload(file, { projectId: pA }), title: 'Hoofdfilm voorjaar' });
  const reel = await apiT('POST', `/api/projects/${pA}/videos`, { uploadId: await upload(vertical, { projectId: pA }), title: 'Reel 9:16' });
  const xmas = await apiT('POST', `/api/projects/${pB}/videos`, { uploadId: await upload(file, { projectId: pB }), title: 'Kerstfilm' });
  const other = await apiT('POST', `/api/projects/${pC}/videos`, { uploadId: await upload(file, { projectId: pC }), title: 'Niet gekoppelde video' });
  for (const v of [main, reel, xmas, other]) { await apiT('POST', `/api/versions/${v.versionId}/ready`); await apiT('POST', `/api/versions/${v.versionId}/share`, { round: 'new', requestId: `share-${v.versionId}-aaaa` }); }
  await apiT('PATCH', `/api/videos/${main.videoId}`, { kind: 'main', approverName: 'Joris Bakker', approverEmail: 'joris@jansen.nl' });
  await apiT('PATCH', `/api/videos/${reel.videoId}`, { kind: 'social', approverName: 'Sanne Smit', approverEmail: 'sanne@jansen.nl' });
  const fl = await apiT('POST', '/api/users', { name: 'Fien Freelancer', email: 'fien@agency.nl', password: 'een-lang-wachtwoord', role: 'member' });
  await apiT('PUT', `/api/users/${fl.id}/projects`, { projects: [{ projectId: pA, level: 'view' }] });

  // ---------- A. Team: klanten ----------
  await page.goto(`${BASE}/klanten`);
  await page.waitForSelector('.empty');
  check('hoofdmenu bevat Klanten', (await page.$$eval('.side-nav[aria-label="Hoofdmenu"] .nav-label', (els) => els.map((e) => e.textContent))).includes('Klanten'));
  await page.click('button:has-text("Nieuwe klant")');
  await page.fill('dialog input[type=text]', 'Bakkerij Jansen');
  await page.click('dialog button:has-text("Klant maken")');
  await page.waitForSelector('h1:has-text("Bakkerij Jansen")');
  check('nieuwe klant: detailpagina, nog geen projecten gekoppeld (ook niet op klantnaam)', /Nog geen projecten gekoppeld/.test(await page.textContent('main')));
  await page.click('button:has-text("Project koppelen")');
  const options = await page.$$eval('dialog select option', (els) => els.map((e) => e.textContent));
  check('koppelen: kiezen uit bestaande projecten, klantnaam alleen als hint', options.some((o) => /Voorjaarscampagne \(klantnaam: Bakkerij Jansen\)/.test(o)), options.join(' | '));
  await page.selectOption('dialog select', String(pA));
  await page.click('dialog button:has-text("Koppelen")');
  await page.waitForSelector('.client-project:has-text("Voorjaarscampagne")');
  await page.click('button:has-text("Project koppelen")');
  await page.selectOption('dialog select', String(pB));
  await page.click('dialog button:has-text("Koppelen")');
  await page.waitForSelector('.client-project:has-text("Kerstfilm 2025")');
  await page.click('.client-project:has-text("Kerstfilm 2025") button:has-text("Afgerond")');
  await page.waitForSelector('.client-project:has-text("Kerstfilm 2025") button[aria-pressed="true"]:has-text("Afgerond")');
  check('klanttoegang per project: Actief / Afgerond / Klanttoegang uit', await page.isVisible('.client-project:has-text("Voorjaarscampagne") button[aria-pressed="true"]:has-text("Actief")'));
  // Algemene en persoonlijke link
  await page.click('button:has-text("Nieuwe link")');
  await page.click('dialog button:has-text("Link maken")');
  await page.waitForSelector('.link-row:has-text("Klantportaal")');
  await page.click('button:has-text("Nieuwe link")');
  await page.check('dialog input[value=personal]');
  await page.fill('dialog input[aria-label="Naam akkoordgever"]', 'Joris Bakker');
  await page.fill('dialog input[aria-label="E-mailadres akkoordgever"]', 'joris@jansen.nl');
  await page.click('dialog button:has-text("Link maken")');
  await page.waitForSelector('.link-row:has-text("Persoonlijk: Joris Bakker")');
  check('klantportaallinks: algemeen en persoonlijk (met akkoordgeverlabel), localhost-waarschuwing', await page.isVisible('.link-row:has-text("Persoonlijk: Joris Bakker") .badge-verified') && /Werkt nu alleen op deze computer/.test(await page.textContent('main')));
  await shot(page, '60-klant-detail');
  const urls = await page.$$eval('.link-row input.link-url', (els) => els.map((e) => e.value));
  const personalUrl = urls[0];
  const generalUrl = urls[1];
  check('persoonlijke link staat bovenaan (nieuwste eerst)', /\/k\//.test(personalUrl) && /\/k\//.test(generalUrl) && personalUrl !== generalUrl);
  await page.goto(`${BASE}/projecten/${pA}`);
  await page.waitForSelector('.page-title');
  check('projectpagina: gekoppelde klant als link in de kop', await page.isVisible('.project-head a[href^="/klanten/"]:has-text("Bakkerij Jansen")'));
  await page.goto(`${BASE}/klanten`);
  await page.waitForSelector('.client-row');
  await shot(page, '61-klanten');

  // ---------- B. Klantportaal (algemene link), NL/EN ----------
  const cctx = await browser.newContext(ctxOpts);
  const c = await cctx.newPage();
  watch(c, 'klant');
  await c.goto(generalUrl);
  await c.waitForSelector('.p-group-todo');
  // Bouwronde 6: acties eerst; alle projecten via de ingeklapte route "Alle projecten en video’s".
  check('portaal: acties eerst, projectnaam per actie', (await c.textContent('.p-hero h1')) === 'Bakkerij Jansen' && /Voorjaarscampagne/.test(await c.textContent('.p-group-todo .p-card-kicker')));
  await c.click('.p-all > summary');
  check('portaal: klant → projecten; afgerond project ingeklapt', await c.isVisible('.k-project h3:has-text("Voorjaarscampagne")') && !(await c.isVisible('h3:has-text("Kerstfilm 2025")')) && await c.isVisible('.k-completed summary:has-text("Afgerond project (1)")'));
  check('portaal: niet-gekoppeld project onzichtbaar', !(await c.textContent('main')).includes('Niet gekoppelde video'));
  check('algemene link: geen goedkeurknop of “Jij bent de akkoordgever”', !(await c.isVisible('text=Bekijken en goedkeuren')) && !(await c.isVisible('.p-note.is-mine')));
  await shot(c, '62-klantportaal');
  await c.click('.lang-toggle button[lang=en]');
  await c.waitForSelector('html[lang=en]');
  check('EN: interface vertaald, inhoud (titels) niet', /Your actions/.test(await c.textContent('main')) && /Hoofdfilm voorjaar/.test(await c.textContent('main')) && /Finished project \(1\)/.test(await c.textContent('.k-completed summary')));
  await c.reload();
  await c.waitForSelector('.p-group-todo');
  check('EN-keuze blijft bewaard in deze browser', (await c.getAttribute('html', 'lang')) === 'en');
  await shot(c, '63-klantportaal-en');
  // Thema voor bezoekers zonder account (alleen in deze browser onthouden)
  await c.selectOption('.theme-select', 'light');
  await c.waitForSelector('html[data-theme=light]');
  await c.reload();
  await c.waitForSelector('.p-group-todo');
  check('bezoeker: themakeuze (Light) direct toegepast en onthouden', (await c.getAttribute('html', 'data-theme')) === 'light' && (await c.inputValue('.theme-select')) === 'light');
  await shot(c, '63b-klantportaal-licht');
  await c.selectOption('.theme-select', 'dark');
  await c.click('.p-all > summary');
  await c.click('.k-completed summary');
  check('afgerond project openklappen toont de video', await c.isVisible('.p-card:has-text("Kerstfilm")'));

  // Video openen, vorige/volgende, niet-verstuurde invoer beschermen
  await c.click('.p-group-todo .p-card:has-text("Hoofdfilm voorjaar")');
  await c.waitForSelector('.r-nav');
  check('review: vorige/volgende binnen het project (EN)', /Video 1 of 2/.test(await c.textContent('.r-nav')) && await c.isVisible('.r-nav-link.is-next:has-text("Reel 9:16")'));
  check('review: terug naar het klantportaal', await c.isVisible('.r-back:has-text("Back to the overview")'));
  await c.fill('#reviewer-name', 'Eva Jansen');
  await c.fill('.composer textarea', 'Logo iets groter graag');
  await c.click('.r-nav-link.is-next');
  await c.waitForSelector('dialog[open] h2:has-text("Leave this page?")');
  check('niet geplaatste tekst: eerst een bevestiging bij naar de volgende video', /not been posted yet/.test(await c.textContent('dialog[open]')));
  await c.click('dialog[open] button:has-text("Stay")');
  check('“Blijven”: tekst staat er nog', (await c.inputValue('.composer textarea')) === 'Logo iets groter graag');
  await c.click('.composer button[type=submit]');
  await c.waitForSelector('.comment:has-text("Logo iets groter graag")');
  await c.click('.r-nav-link.is-next');
  await c.waitForSelector('dialog[open]');
  check('geplaatst maar niet verstuurd: waarschuwing over “Send feedback”', /1 comment has not been sent as feedback yet/.test(await c.textContent('dialog[open]')));
  await c.click('dialog[open] button:has-text("Leave anyway")');
  await c.waitForSelector('h1:has-text("Reel 9:16")');
  check('“Toch verlaten”: volgende video geopend', /Video 2 of 2/.test(await c.textContent('.r-nav')));
  await shot(c, '64-review-en-navigatie');
  await c.click('.lang-toggle button[lang=nl]');
  await c.waitForSelector('html[lang=nl]');
  check('terug naar NL op de reviewpagina', /Video 2 van 2/.test(await c.textContent('.r-nav')));

  // ---------- C. Persoonlijke link: eenvoudiger goedkeuren ----------
  const jctx = await browser.newContext(ctxOpts);
  const j = await jctx.newPage();
  watch(j, 'akkoordgever');
  await j.goto(personalUrl);
  await j.waitForSelector('.p-identity');
  check('persoonlijke link: “Persoonlijke link van Joris Bakker”, samenvatting bovenaan', /Persoonlijke link van Joris Bakker/.test(await j.textContent('.p-identity')) && /Er sta(at|an) \d+ video/.test(await j.textContent('.p-hero')), await j.textContent('.p-hero'));
  check('alleen bij de eigen video: “Jij bent de akkoordgever” en “Bekijken en goedkeuren”', await j.isVisible('.p-group-todo .p-card:has-text("Hoofdfilm voorjaar") .p-note.is-mine') && !(await j.isVisible('.p-group-todo .p-card:has-text("Reel 9:16") .p-note.is-mine'))
    && /Bekijken en goedkeuren/.test(await j.textContent('.p-group-todo .p-card:has-text("Hoofdfilm voorjaar")')) && /Bekijken en reageren/.test(await j.textContent('.p-group-todo .p-card:has-text("Reel 9:16")')));
  check('één actie per video (geen dubbele regels)', (await j.locator('.p-group-todo .p-card:has-text("Hoofdfilm voorjaar")').count()) === 1);
  await shot(j, '65-portaal-persoonlijk');
  await j.click('.p-group-todo .p-card:has-text("Hoofdfilm voorjaar")');
  await j.waitForSelector('button:has-text("Deze versie goedkeuren")');
  await j.click('button:has-text("Deze versie goedkeuren")');
  await j.waitForSelector('dialog[open] .approve-what');
  const confirmText = await j.textContent('dialog[open]');
  check('één korte bevestiging met videotitel en exacte versie', /Hoofdfilm voorjaar/.test(confirmText) && /Versie 1/.test(confirmText) && await j.isVisible('dialog[open] button:has-text("Ja, keur Versie 1 goed")'));
  await shot(j, '66-goedkeuren-bevestigen');
  await j.click('dialog[open] button:has-text("Ja, keur Versie 1 goed")');
  await j.waitForSelector('.r-status.is-approved');
  check('goedgekeurd via het persoonlijke portaal', /Goedgekeurd door Joris Bakker/.test(await j.textContent('.r-status')));
  await j.goto(personalUrl);
  await j.waitForSelector('.p-card');
  await j.click('.p-group-todo .p-card:has-text("Reel 9:16")');
  await j.waitForSelector('.r-actions');
  check('andere video (andere akkoordgever): geen goedkeurknop', !(await j.isVisible('button:has-text("Deze versie goedkeuren")')));
  // Team trekt de goedkeuring in (statuscorrectie): duidelijke uitleg voor de akkoordgever
  await apiT('POST', `/api/versions/${main.versionId}/status`, { status: 'in_review', note: 'Muziek nog vervangen' });
  await j.goto(personalUrl);
  await j.waitForSelector('.p-card');
  check('portaal: “Eerdere goedkeuring ingetrokken: opnieuw goedkeuren nodig”', await j.isVisible('.p-group-todo .p-card:has-text("Hoofdfilm voorjaar") .p-note.is-warn'));
  await j.click('.p-group-todo .p-card:has-text("Hoofdfilm voorjaar")');
  await j.waitForSelector('.r-revoked');
  check('review: uitleg ingetrokken goedkeuring met wie, wanneer en wat nu', /Joris Bakker keurde deze versie goed op/.test(await j.textContent('.r-revoked')) && /keur hem dan opnieuw goed/.test(await j.textContent('.r-revoked')) && await j.isVisible('button:has-text("Deze versie goedkeuren")'));
  await shot(j, '67-goedkeuring-ingetrokken');

  // ---------- D. Linkbeveiliging ----------
  const detailUrl = `${BASE}/klanten/1`;
  await page.goto(detailUrl);
  await page.waitForSelector('.link-row');
  // Nieuwste eerst: de persoonlijke link staat bovenaan, de algemene daaronder.
  const generalRow = page.locator('.link-row:not(.is-revoked)').nth(1);
  check('tweede link is de algemene link', (await generalRow.locator('input.link-url').inputValue()) === generalUrl);
  await generalRow.locator('button:has-text("Beveiliging")').click();
  await page.fill('dialog[open] input[type=password]', 'bakker-2026');
  await page.uncheck('dialog[open] label:has-text("Geen vervaldatum") input');
  await page.fill('dialog[open] input[type=date]', '2099-12-31');
  await page.fill('dialog[open] input[type=time]', '18:00');
  check('beveiligingsdialoog: tijdzone erbij', /Europe\/Amsterdam/.test(await page.textContent('dialog[open]')));
  await page.click('dialog[open] button:has-text("Opslaan")');
  await page.waitForSelector('.link-row .badge:has-text("wachtwoord")');
  check('linklijst: badges “wachtwoord” en “geldig tot … CET”', /geldig tot 31 dec 2099.*18:00 CET/.test(await generalRow.textContent()));
  const raw = server.db.prepare('SELECT password_hash FROM client_links WHERE token = ?').get(generalUrl.split('/').pop()).password_hash;
  check('wachtwoord gehasht opgeslagen', raw && !raw.includes('bakker-2026'));
  await shot(page, '68-beveiliging');
  // Klant: de al geopende sessie moet nu het wachtwoord invullen
  await c.goto(generalUrl);
  await c.waitForSelector('.gate-card');
  check('klant: wachtwoordscherm (in de taal van de kijker)', /Deze link is beveiligd/.test(await c.textContent('.gate-card')));
  await c.fill('#link-password', 'verkeerd');
  await c.click('.gate-form button[type=submit]');
  await c.waitForSelector('.field-error:not([hidden])');
  check('verkeerd wachtwoord: duidelijke melding', /klopt niet/.test(await c.textContent('.field-error')));
  await shot(c, '69-wachtwoord');
  await c.fill('#link-password', 'bakker-2026');
  await c.click('.gate-form button[type=submit]');
  await c.waitForSelector('.p-group-todo');
  check('juist wachtwoord: portaal open, met geldigheid en tijdzone', /Deze link is geldig tot 31 dec 2099.*18:00 CET/.test(await c.textContent('.link-expiry')));
  check('wachtwoord staat niet in de URL', !c.url().includes('bakker'));
  await c.click('.p-group-todo .p-card:has-text("Hoofdfilm voorjaar")');
  await c.waitForSelector('.r-stage video');
  check('na ontgrendelen: video’s via het portaal zonder opnieuw invullen', await c.isVisible('.r-stage video'));
  // Opleverlink met wachtwoord
  await apiT('POST', `/api/projects/${pB}/delivery-link`);
  await page.goto(`${BASE}/projecten/${pB}/oplevering`);
  await page.waitForSelector('.dl-card');
  await page.click('.dl-card button:has-text("Beveiliging")');
  await page.fill('dialog[open] input[type=password]', 'oplever-123');
  await page.click('dialog[open] button:has-text("Opslaan")');
  await page.waitForSelector('.dl-card .badge:has-text("wachtwoord")');
  const dUrl = await page.inputValue('.dl-card input.link-url');
  const dctx = await browser.newContext(ctxOpts);
  const d = await dctx.newPage();
  watch(d, 'oplevering');
  await d.goto(dUrl);
  await d.waitForSelector('.gate-card');
  await d.fill('#link-password', 'oplever-123');
  await d.click('.gate-form button[type=submit]');
  await d.waitForSelector('.d-eyebrow');
  check('opleverlink met wachtwoord: invullen en daarna de opleverpagina', /Definitieve oplevering/.test(await d.textContent('.p-hero')));

  // ---------- E. Klanttoegang uit ----------
  await page.goto(`${BASE}/projecten/${pA}`);
  await page.waitForSelector('.page-title');
  await page.click('button:has-text("Delen")');
  await page.click('.menu-item:has-text("Klant en klanttoegang")');
  await page.check('dialog[open] input[value=off]');
  await page.click('dialog[open] button:has-text("Opslaan")');
  await page.waitForSelector('dialog[open] h2:has-text("Klanttoegang uitzetten?")');
  await page.click('dialog[open] button:has-text("Klanttoegang uit")');
  await page.waitForSelector('.notice:has-text("Klanttoegang staat uit")');
  check('team: duidelijke melding en badge “klanttoegang uit”', await page.isVisible('.badge-danger:has-text("klanttoegang uit")'));
  await c.reload();
  await c.waitForSelector('.fatal');
  check('klant: open videopagina geblokkeerd met heldere melding', /Tijdelijk niet beschikbaar/.test(await c.textContent('.fatal')));
  const mediaStatus = await c.evaluate(async (u) => (await fetch(u)).status, `/api/review/${c.url().split('/').pop()}/versions/${main.versionId}/media`);
  check('klant: ook het directe videobestand geblokkeerd (410)', mediaStatus === 410, String(mediaStatus));
  await shot(c, '70-klanttoegang-uit');
  await j.goto(personalUrl);
  await j.waitForSelector('.p-all');
  check('portaal: project met klanttoegang uit verborgen', !(await j.textContent('main')).includes('Voorjaarscampagne'));
  await apiT('PUT', `/api/projects/${pA}/client-visibility`, { visibility: 'active' });

  // ---------- F. Freelancer ----------
  const fctx = await browser.newContext(ctxOpts);
  const f = await fctx.newPage();
  watch(f, 'freelancer');
  await f.goto(`${BASE}/login`);
  await f.fill('input[name=email]', 'fien@agency.nl');
  await f.fill('input[name=password]', 'een-lang-wachtwoord');
  await f.click('button[type=submit]');
  await f.waitForSelector('.side-nav');
  await f.goto(`${BASE}/klanten/1`);
  await f.waitForSelector('h1:has-text("Bakkerij Jansen")');
  const fText = await f.textContent('main');
  check('freelancer: alleen eigen project, geen links, geen koppelknop', /Voorjaarscampagne/.test(fText) && !/Kerstfilm/.test(fText) && !(await f.isVisible('.link-row')) && !(await f.isVisible('button:has-text("Project koppelen")')) && /1 ander project/.test(fText));

  // ---------- G. Mobiel (Pixel 7-emulatie) ----------
  const mctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' });
  const m = await mctx.newPage();
  watch(m, 'mobiel');
  await m.goto(personalUrl);
  await m.waitForSelector('.p-group-todo');
  const o1 = await m.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
  await shot(m, '71-mobiel-klantportaal', { fullPage: true });
  await m.click('.p-group-todo .p-card:has-text("Reel 9:16")');
  await m.waitForSelector('.r-nav');
  const o2 = await m.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
  await shot(m, '72-mobiel-review-navigatie');
  check('mobiel: klantportaal en reviewpagina zonder horizontaal scrollen', o1 <= 1 && o2 <= 1, `${o1}/${o2}`);

  check('geen JavaScript-fouten', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  listener.close();
  server.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} controles geslaagd. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
