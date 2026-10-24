// Browsertest bouwronde 4: definitieve opleveringen, klantactiviteit en de uitleg bij volledig scherm
// op iPhone, op desktop en in een mobiele weergave (Pixel 7-emulatie), met echte H.264/AAC-MP4's.
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser:oplevering   (SHOTS_DIR=/map optioneel)
// Start een eigen tijdelijke server met lege gegevens; raakt je eigen gegevens niet aan.
// Let op: het iPhone-gedrag wordt hier nagebootst (Chrome zonder element-volledig-scherm, met een
// nep-webkitEnterFullscreen). Dat is geen test op een echte iPhone.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');
const { createApp } = require('../server/app');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Zet CHROME_PATH naar een Chrome met H.264-ondersteuning.'); process.exit(2); }
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-oplevertest-'));
const SHOTS = process.env.SHOTS_DIR || path.join(S, 'shots');
for (const d of [SHOTS, path.join(S, 'media')]) fs.mkdirSync(d, { recursive: true });
const setupToken = 'oplevertest-installatiecode';
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const shot = async (page, name, opts = {}) => {
  await page.evaluate(() => document.querySelectorAll('.toast-host > *').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};

function mp4(name, { size = '1920x1080', seconds = 8, freq = 440, pattern = 'testsrc2' } = {}) {
  const file = path.join(S, 'media', name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `${pattern}=size=${size}:rate=25:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}:sample_rate=48000`, '-ac', '2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', file]);
  return file;
}

(async () => {
  console.log('Testvideo’s maken…');
  const files = {
    v1: mp4('hoofdfilm_v1.mp4', { seconds: 10, freq: 500 }),
    v2: mp4('hoofdfilm_v2.mp4', { seconds: 9, freq: 660, pattern: 'smptehdbars' }),
    social: mp4('social_9x16.mp4', { size: '1080x1920', seconds: 6, freq: 550 }),
  };
  const server = createApp({ dataDir: path.join(S, 'data'), backupDir: path.join(S, 'backups'), setupToken, minFreeBytes: 0, env: { ...process.env, STUDIO_REVIEW_HOME: path.join(S, 'home'), DATA_DIR: '' } });
  const listener = await new Promise((r) => { const l = server.app.listen(0, () => r(l)); });
  const BASE = `http://localhost:${listener.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  console.log('Browser:', browser.version());
  const errors = [];
  const watch = (p, label) => {
    p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/40[0134]|409|410|net::ERR_(ABORTED|FAILED)/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  };
  const H = { 'x-requested-with': 'review-tool' };
  const activityCount = () => server.db.prepare('SELECT COUNT(*) AS n FROM client_activity WHERE team = 0').get().n;
  const noHorizontalScroll = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);

  // ---------- Team ----------
  const team = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, timezoneId: 'Europe/Amsterdam', locale: 'nl-NL' });
  const page = await team.newPage();
  watch(page, 'team');
  const apiT = async (method, url, data, p = page) => {
    const r = await p.request.fetch(`${BASE}${url}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  async function uploadVia(file, target) {
    const buf = fs.readFileSync(file);
    const up = await apiT('POST', '/api/uploads', { filename: path.basename(file), size: buf.length, ...target });
    for (let o = 0; o < buf.length; o += up.chunkSize) await page.request.put(`${BASE}/api/uploads/${up.id}?offset=${o}`, { headers: { ...H, 'content-type': 'application/octet-stream' }, data: buf.subarray(o, o + up.chunkSize) });
    return up.id;
  }
  await page.goto(`${BASE}/?setup=${setupToken}`);
  await page.fill('input[name=name]', 'Sanne de Vries');
  await page.fill('input[name=email]', 'sanne@agency.nl');
  await page.fill('input[name=password]', 'een-lang-wachtwoord');
  await page.click('button[type=submit]');
  await page.waitForSelector('.onboarding');

  const brand = (await apiT('GET', '/api/brands')).find((b) => b.slug === 'studio-brutaal');
  const { id: projectId } = await apiT('POST', '/api/projects', { name: 'Lancering Zomerlijn', clientName: 'Fietsfabriek Noord', brandId: brand.id });
  const main = await apiT('POST', `/api/projects/${projectId}/videos`, { uploadId: await uploadVia(files.v1, { projectId }), title: 'Zomerlijn — Hoofdfilm' });
  const social = await apiT('POST', `/api/projects/${projectId}/videos`, { uploadId: await uploadVia(files.social, { projectId }), title: 'Zomerlijn — Reel' });
  await apiT('PATCH', `/api/videos/${main.videoId}`, { kind: 'main', channel: 'YouTube en website', approverName: 'Joris Bakker', approverEmail: 'joris@fietsfabriek.nl' });
  await apiT('PATCH', `/api/videos/${social.videoId}`, { kind: 'social', channel: 'Instagram Reels', approverName: 'Joris Bakker', approverEmail: 'joris@fietsfabriek.nl' });
  for (const v of [main, social]) {
    await apiT('POST', `/api/versions/${v.versionId}/ready`);
    await apiT('POST', `/api/versions/${v.versionId}/share`, { round: 'new', requestId: `share-${v.versionId}-aaaa` });
  }
  const approverUrl = async (videoId) => (await apiT('POST', `/api/videos/${videoId}/links`, { role: 'approver' })).url.replace(/^https?:\/\/[^/]+/, BASE);
  const mainApprover = await approverUrl(main.videoId);

  // ---------- Klant: akkoordgever bekijkt, speelt af en keurt goed (ook klantactiviteit) ----------
  const clientCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, timezoneId: 'Europe/Amsterdam', locale: 'nl-NL' });
  const cp = await clientCtx.newPage();
  watch(cp, 'klant');
  await cp.goto(mainApprover);
  await cp.waitForSelector('.player video');
  await cp.click('.pc-bigplay');
  await cp.waitForFunction(() => document.querySelector('.player video')?.currentTime > 0.3, null, { timeout: 15000 });
  await cp.click('.pc-btn[aria-label^="Pauzeren"]');
  await cp.click('.pc-bigplay'); // nogmaals afspelen: telt niet opnieuw
  await cp.waitForTimeout(300);
  await cp.click('.r-actions button:has-text("Deze versie goedkeuren")');
  await cp.click('dialog button:has-text("Ja, keur Versie 1 goed")');
  await cp.waitForSelector('.notice-ok:has-text("goedgekeurd")');
  const acts = server.db.prepare('SELECT type, source_label, version_id FROM client_activity ORDER BY id').all();
  check('klantactiviteit: reviewpagina geopend + één keer afspelen gestart (niet bij opnieuw afspelen)',
    acts.length === 2 && acts[0].type === 'review_opened' && acts[1].type === 'playback_started' && acts[1].version_id === main.versionId && acts[1].source_label === 'Via akkoordlink van Joris Bakker', JSON.stringify(acts));
  check('klantactiviteit: een goedkeuring is een formele actie, geen activiteitsregel', !acts.some((a) => /goedkeur/i.test(a.type)));

  // Social: handmatig op Goedgekeurd zonder klantgoedkeuring
  await apiT('POST', `/api/versions/${social.versionId}/status`, { status: 'approved', note: 'Klant zei telefonisch ja' });

  // ---------- A1. Bewust vrijgeven vanuit de werkplek ----------
  await page.goto(`${BASE}/video/${main.videoId}`);
  await page.waitForSelector('.publish-bar.is-approved');
  check('werkplek: goedgekeurde versie toont “Definitief vrijgeven…”', await page.isVisible('.publish-bar a:has-text("Definitief vrijgeven")'));
  await page.goto(`${BASE}/video/${social.videoId}`);
  await page.waitForSelector('.publish-bar.is-approved');
  const socialBar = await page.textContent('.publish-bar');
  check('werkplek: handmatig “Goedgekeurd” zonder klantgoedkeuring kan niet worden vrijgegeven', /Handmatig op Goedgekeurd gezet/.test(socialBar) && !(await page.isVisible('.publish-bar a:has-text("Definitief vrijgeven")')), socialBar.slice(0, 160));
  await page.goto(`${BASE}/video/${main.videoId}`);
  await page.click('.publish-bar a:has-text("Definitief vrijgeven")');
  await page.waitForSelector('dialog .release-list');
  const step1 = await page.textContent('dialog .release');
  check('vrijgeven stap 1: exacte versie gekozen, handmatig label geweigerd met uitleg',
    await page.isChecked(`dialog input[name="rel-${main.videoId}"][value="${main.versionId}"]`) && /statuslabel vervangt geen klantgoedkeuring/.test(step1) && /Goedgekeurd door Joris Bakker/.test(step1), step1.slice(0, 200));
  await shot(page, '80-vrijgeven-stap1-kiezen');
  await page.click('dialog button:has-text("Overzicht bekijken")');
  await page.waitForSelector('dialog .release-summary');
  const summary = await page.textContent('dialog .release-summary');
  check('vrijgeven stap 2: overzicht van wat de klant krijgt (bestandsnaam, formaat, goedkeuring)', /hoofdfilm_v1\.mp4/.test(summary) && /MP4/.test(summary) && /Joris Bakker/.test(summary), summary);
  await shot(page, '81-vrijgeven-stap2-overzicht');
  await page.click('dialog button:has-text("Vrijgeven (1)")');
  await page.waitForSelector('.dl-row .badge-ok');
  check('oplevering: vrijgegeven en beschikbaar voor de klant', (await page.textContent('.dl-row')).includes('Versie 1'));

  // Oplevertekst: mislukt opslaan bewaart de tekst, daarna lukt het
  const note = 'Hierbij de definitieve bestanden van de Zomerlijn-campagne. Veel succes met de lancering!';
  await page.fill('.dl-card textarea', note);
  let failOnce = true;
  await page.route('**/delivery-note', (route) => { if (failOnce) { failOnce = false; return route.abort(); } return route.continue(); });
  await page.click('button:has-text("Tekst opslaan")');
  await page.waitForSelector('.toast:has-text("bewaard")');
  check('oplevertekst: bij een fout blijft de tekst staan', (await page.inputValue('.dl-card textarea')) === note);
  await page.click('button:has-text("Tekst opslaan")');
  await page.waitForSelector('.toast:has-text("Oplevertekst opgeslagen")');
  await page.unroute('**/delivery-note');

  // Opleverlink maken
  await page.click('button:has-text("Opleverlink maken")');
  await page.waitForSelector('input[aria-label="Opleverlink"]');
  const deliveryUrl = (await page.inputValue('input[aria-label="Opleverlink"]')).replace(/^https?:\/\/[^/]+/, BASE);
  check('opleverlink: gemaakt, met waarschuwing dat localhost alleen op deze computer werkt', await page.isVisible('.dl-card .notice-warn:has-text("alleen op deze computer")'));
  const othersText = await page.textContent('.dl-others');
  check('opleverlink: toont welke andere links nog toegang geven', /Klantportaal/.test(othersText) && /Akkoordlinks/.test(othersText), othersText.slice(0, 160));
  await shot(page, '82-team-oplevering', { fullPage: true });

  // ---------- A2. Klant: opleverpagina en download ----------
  const maxId = () => server.db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM client_activity').get().n;
  const before = maxId();
  await cp.goto(deliveryUrl);
  await cp.waitForSelector('.d-item');
  const card = await cp.textContent('.d-item');
  check('opleverpagina: titel, type/kanaal, formaat, grootte, versie en datum', /Zomerlijn — Hoofdfilm/.test(card) && /Hoofdvideo · 16:9 · YouTube en website/.test(card) && /MP4 · [\d,.]+ (KB|MB)/.test(card) && /Versie\s*1/.test(card) && /Vrijgegeven/.test(card), card);
  check('opleverpagina: branding en oplevertekst', (await cp.textContent('.p-header')).includes('Studio Brutaal') && (await cp.textContent('.p-hero')).includes('Veel succes'));
  await shot(cp, '83-klant-opleverpagina', { fullPage: true });
  const [download] = await Promise.all([cp.waitForEvent('download'), cp.click('.d-download')]);
  const saved = path.join(S, 'download.mp4');
  await download.saveAs(saved);
  check('download: oorspronkelijke uploadnaam met echte extensie', download.suggestedFilename() === 'hoofdfilm_v1.mp4', download.suggestedFilename());
  check('download: identieke bestandsinhoud', Buffer.compare(fs.readFileSync(saved), fs.readFileSync(files.v1)) === 0);
  const newActs = server.db.prepare('SELECT type FROM client_activity WHERE id > ? ORDER BY id').all(before).map((a) => a.type);
  check('klantactiviteit: opleverpagina geopend + download aangevraagd (thumbnail en controle tellen niet)', JSON.stringify(newActs) === '["delivery_opened","download_requested"]', JSON.stringify(newActs));

  // Mobiel
  const mobile = await browser.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Amsterdam', locale: 'nl-NL' });
  const mp = await mobile.newPage();
  watch(mp, 'mobiel');
  await mp.goto(deliveryUrl);
  await mp.waitForSelector('.d-item');
  check('mobiel: opleverpagina zonder horizontaal scrollen, downloadknop over de volle breedte', await noHorizontalScroll(mp) && (await mp.$eval('.d-download', (b) => b.getBoundingClientRect().width)) > 300);
  await shot(mp, '84-klant-opleverpagina-mobiel', { fullPage: true });

  // ---------- A3. Nieuwe conceptversie: oud eindbestand blijft ----------
  const v2 = await apiT('POST', `/api/videos/${main.videoId}/versions`, { uploadId: await uploadVia(files.v2, { videoId: main.videoId }) });
  await page.goto(`${BASE}/projecten/${projectId}/oplevering`);
  await page.waitForSelector('.dl-row');
  check('team: melding dat er een nieuwere (interne) versie is dan de opgeleverde', /Versie 2 staat intern klaar \(Concept\)/.test(await page.textContent('.dl-newer')));
  await shot(page, '85-team-nieuwere-versie');
  await cp.reload();
  await cp.waitForSelector('.d-item');
  check('klant: ziet nog steeds versie 1 na de nieuwe upload', /Versie\s*1/.test(await cp.textContent('.d-item')) && !/Versie\s*2/.test(await cp.textContent('body')));

  // Statuscorrectie: het venster noemt de exacte versie en de gevolgen voor goedkeuring en oplevering
  await page.goto(`${BASE}/video/${main.videoId}?v=${v2.versionId}`);
  await page.click('button[aria-label="Meer acties"]');
  await page.click('.menu:not([hidden]) .menu-item:has-text("Status van Versie 2 corrigeren")');
  const fixV2 = await page.textContent('dialog');
  check('statuscorrectie v2: geldt alleen voor Versie 2; oplevering (Versie 1) verandert niet', /alleen voor Versie 2/.test(fixV2) && /De definitieve oplevering is Versie 1/.test(fixV2), fixV2.slice(0, 200));
  await page.selectOption('dialog select', 'approved');
  check('statuscorrectie v2 naar Goedgekeurd: uitleg dat een label geen klantgoedkeuring is', /alleen een label/.test(await page.textContent('dialog .status-impact')));
  await page.click('dialog button:has-text("Annuleren")');
  await page.goto(`${BASE}/video/${main.videoId}?v=${main.versionId}`);
  await page.click('button[aria-label="Meer acties"]');
  await page.click('.menu:not([hidden]) .menu-item:has-text("Status van Versie 1 corrigeren")');
  await page.selectOption('dialog select', 'changes_requested');
  const fixV1 = await page.textContent('dialog .status-impact');
  check('statuscorrectie v1: waarschuwt dat de goedkeuring wordt ingetrokken en de oplevering geblokkeerd', /trekt de goedkeuring van Joris Bakker voor Versie 1 in/.test(fixV1) && /oplevering van deze versie wordt geblokkeerd/.test(fixV1), fixV1);
  await shot(page, '99-statuscorrectie-per-versie');
  await page.click('dialog button:has-text("Annuleren")');

  // ---------- A4. Bewust vervangen ----------
  await apiT('POST', `/api/versions/${v2.versionId}/ready`);
  await apiT('POST', `/api/versions/${v2.versionId}/share`, { round: 'new', requestId: 'share-v2-bbbbbbbb' });
  const ap = await clientCtx.newPage();
  await ap.goto(mainApprover);
  await ap.waitForSelector('.r-actions button:has-text("Deze versie goedkeuren")');
  await ap.click('.r-actions button:has-text("Deze versie goedkeuren")');
  await ap.click('dialog button:has-text("Ja, keur Versie 2 goed")');
  await ap.waitForSelector('.notice-ok:has-text("goedgekeurd")');
  await ap.close();
  await page.goto(`${BASE}/projecten/${projectId}/oplevering`);
  await page.waitForSelector('.dl-row');
  await page.click('.dl-row button:has-text("Vervangen")');
  await page.waitForSelector('dialog .release-list');
  check('vervangen: nieuwste goedgekeurde versie voorgeselecteerd', await page.isChecked(`dialog input[name="rel-${main.videoId}"][value="${v2.versionId}"]`));
  await page.click('dialog button:has-text("Overzicht bekijken")');
  await page.waitForSelector('dialog .dl-replace');
  await page.click('dialog button:has-text("Vrijgeven (1)")');
  await page.waitForSelector('dialog .notice-error:has-text("bewust vervangt")');
  check('vervangen: zonder expliciete bevestiging gebeurt niets', server.db.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n === 1);
  await shot(page, '86-vervangen-bevestigen');
  await page.check('dialog .check input');
  await page.click('dialog button:has-text("Vrijgeven (1)")');
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.waitForSelector('.dl-row .ver-chip:has-text("Versie 2")');
  await cp.reload();
  await cp.waitForSelector('.d-item');
  check('klant: ziet na vervangen versie 2', /Versie\s*2/.test(await cp.textContent('.d-item')));
  const [dl2] = await Promise.all([cp.waitForEvent('download'), cp.click('.d-download')]);
  const saved2 = path.join(S, 'download2.mp4');
  await dl2.saveAs(saved2);
  check('download na vervangen: v2-bestand met juiste naam', dl2.suggestedFilename() === 'hoofdfilm_v2.mp4' && Buffer.compare(fs.readFileSync(saved2), fs.readFileSync(files.v2)) === 0);
  const histText = await page.textContent('.dl-history');
  check('geschiedenis: vervangen met reden en wie', /vervangen door Sanne de Vries/.test(histText) && /Vervangen door versie 2/.test(histText), histText.slice(0, 200));

  // ---------- A5. Goedkeuring ingetrokken → geblokkeerd ----------
  await apiT('POST', `/api/versions/${v2.versionId}/status`, { status: 'changes_requested', note: 'Klant trekt akkoord in: verkeerde eindtitel' });
  await page.reload();
  await page.waitForSelector('.dl-row.is-blocked');
  check('team: oplevering geblokkeerd na ingetrokken goedkeuring, met uitleg', /goedkeuring van deze versie is ingetrokken/.test(await page.textContent('.dl-alert')));
  await shot(page, '87-team-geblokkeerd');
  await cp.reload();
  await cp.waitForSelector('.d-unavailable');
  check('klant: “tijdelijk niet beschikbaar”, geen downloadknop', !(await cp.isVisible('.d-download')));
  await apiT('POST', `/api/versions/${v2.versionId}/status`, { status: 'in_review', note: 'Nieuwe eindtitel, opnieuw ter goedkeuring' });
  await (async () => {
    const p2 = await clientCtx.newPage();
    await p2.goto(mainApprover);
    await p2.click('.r-actions button:has-text("Deze versie goedkeuren")');
    await p2.click('dialog button:has-text("Ja, keur Versie 2 goed")');
    await p2.waitForSelector('.notice-ok:has-text("goedgekeurd")');
    await p2.close();
  })();
  await cp.reload();
  await cp.waitForSelector('.d-item');
  check('klant: na nieuwe goedkeuring alleen nog steeds geblokkeerd (nieuwe vrijgave nodig)', await cp.isVisible('.d-unavailable'));
  await page.reload();
  await page.click('.dl-row button:has-text("Vervangen")');
  await page.waitForSelector('dialog .release-list');
  await page.check(`dialog input[name="rel-${main.videoId}"][value="${v2.versionId}"]`);
  await page.click('dialog button:has-text("Overzicht bekijken")');
  await page.click('dialog button:has-text("Vrijgeven (1)")');
  await page.waitForSelector('.dl-row .badge-ok');
  await cp.reload();
  await cp.waitForSelector('.d-download');
  check('opnieuw vrijgegeven: klant kan weer downloaden', true);

  // ---------- A6. Fout bij download (link intussen ingetrokken), terugnemen, lege toestand ----------
  await apiT('POST', `/api/projects/${projectId}/delivery-link`, { replace: true });
  await cp.click('.d-download');
  await cp.waitForSelector('.d-error:not([hidden])');
  check('klant: duidelijke foutmelding als de link intussen is ingetrokken', /niet meer beschikbaar via deze link/.test(await cp.textContent('.d-error')));
  await shot(cp, '89-klant-download-fout');
  await page.reload();
  await page.waitForSelector('input[aria-label="Opleverlink"]');
  const deliveryUrl2 = (await page.inputValue('input[aria-label="Opleverlink"]')).replace(/^https?:\/\/[^/]+/, BASE);
  const withdrawnBefore = server.db.prepare('SELECT COUNT(*) AS n FROM deliveries WHERE withdrawn_at IS NOT NULL').get().n;
  await page.click('.dl-row button:has-text("Terugnemen")');
  await page.click('dialog button:has-text("Terugnemen")');
  check('terugnemen: zonder reden gebeurt niets (verplicht veld)', await page.isVisible('dialog textarea') && server.db.prepare('SELECT COUNT(*) AS n FROM deliveries WHERE withdrawn_at IS NOT NULL').get().n === withdrawnBefore && await page.$eval('dialog textarea', (t) => !t.checkValidity()));
  await page.fill('dialog textarea', 'Nieuwe mix volgt volgende week');
  await page.click('dialog button:has-text("Terugnemen")');
  await page.waitForSelector('.dl-section .empty-state, .dl-section .empty');
  await cp.goto(deliveryUrl2);
  await cp.waitForSelector('main');
  check('klant: lege opleverpagina na terugnemen', /nog geen definitieve bestanden/.test(await cp.textContent('main')));
  await shot(cp, '90-klant-leeg');
  await mp.goto(deliveryUrl2);
  await mp.waitForSelector('main .empty-state, main .empty');
  await shot(mp, '91-klant-leeg-mobiel');

  // Intrekken via het venster: toont andere toegang; klant ziet “link werkt niet meer”
  await page.click('button:has-text("Intrekken…")');
  const revokeText = await page.textContent('dialog');
  check('intrekken: venster noemt de andere links die toegang houden', /Blijft daarna nog toegang geven/.test(revokeText) && /Akkoordlinks/.test(revokeText));
  await page.click('dialog button:has-text("Intrekken")');
  await page.waitForSelector('button:has-text("Opleverlink maken")');
  await mp.reload();
  await mp.waitForSelector('.fatal');
  check('mobiel: ingetrokken link toont “Deze link werkt niet meer”', /Deze link werkt niet meer/.test(await mp.textContent('.fatal')));
  await shot(mp, '92-klant-ingetrokken-mobiel');
  const direct = await fetch(`${BASE}/api/delivery/${deliveryUrl2.split('/').pop()}/files/1/download`);
  check('ingetrokken link: ook een direct downloadverzoek wordt geweigerd', direct.status === 410, String(direct.status));

  // Opnieuw vrijgeven voor portaal en voorbeeld
  await apiT('POST', `/api/projects/${projectId}/deliveries`, { items: [{ versionId: v2.versionId }], confirm: true, requestId: 'opnieuw-vrijgeven-0001' });

  // ---------- A7. Teamvoorbeeld en klantportaal ----------
  const n0 = activityCount();
  await page.goto(`${BASE}/voorbeeld/oplevering/${projectId}`);
  await page.waitForSelector('.d-item');
  check('teamvoorbeeld: voorbeeldbalk, download uitgeschakeld, geen klantactiviteit',
    await page.isVisible('.preview-bar') && await page.isVisible('.d-download.is-disabled') && activityCount() === n0);
  await shot(page, '93-teamvoorbeeld-oplevering');
  const portal = await apiT('POST', `/api/projects/${projectId}/portal-link`);
  const portalUrl = portal.link.url.replace(/^https?:\/\/[^/]+/, BASE);
  await cp.goto(portalUrl);
  await cp.waitForSelector('.p-delivery-card');
  await shot(cp, '94-portaal-definitieve-bestanden');
  await cp.click('.p-delivery-card');
  await cp.waitForSelector('.d-item');
  check('portaal: verwijst naar de opleverpagina, met weg terug', cp.url().endsWith('/oplevering') && await cp.isVisible('.r-back'));
  // Ingelogd teamlid opent de klantlink: telt niet als klantactiviteit (bouwronde 5: wel apart als teambezoek)
  const n1 = activityCount();
  const t1 = server.db.prepare('SELECT COUNT(*) AS n FROM client_activity WHERE team = 1').get().n;
  await page.goto(portalUrl);
  await page.waitForSelector('.p-delivery-card');
  check('ingelogd teamlid op een klantlink telt niet als klantactiviteit (wel apart als teambezoek)', activityCount() === n1 && server.db.prepare('SELECT COUNT(*) AS n FROM client_activity WHERE team = 1').get().n === t1 + 1);

  // Prullenbak: waarschuwing bij een opgeleverde video
  await page.goto(`${BASE}/video/${main.videoId}`);
  await page.click('button[aria-label="Meer acties"]');
  await page.click('.menu-item:has-text("Video naar prullenbak")');
  check('prullenbak: waarschuwing dat de video een definitieve oplevering is', /definitieve oplevering/.test(await page.textContent('dialog')));
  await page.click('dialog button:has-text("Annuleren")');

  // ---------- B. Klantactiviteit (team) ----------
  await page.goto(`${BASE}/projecten/${projectId}/activiteit`);
  await page.waitForSelector('.act-row');
  const actText = await page.textContent('.act-list');
  check('activiteit: soorten, video, exacte versie en bron zichtbaar',
    /Afspelen gestart/.test(actText) && /Versie 1/.test(actText) && /Via akkoordlink van Joris Bakker/.test(actText) && /Download aangevraagd/.test(actText) && /Opleverpagina geopend/.test(actText) && /Klantportaal geopend/.test(actText), actText.slice(0, 300));
  check('activiteit: uitleg wat signalen niet bewijzen', /betekent niet dat de video volledig is bekeken/.test(await page.textContent('.fb-intro')));
  await shot(page, '95-team-klantactiviteit', { fullPage: true });
  await page.selectOption('.fb-filter select[aria-label="Gebeurtenis"]', 'download_requested');
  await page.waitForFunction(() => [...document.querySelectorAll('.act-row strong')].every((s) => s.textContent === 'Download aangevraagd'));
  const dlRows = await page.$$eval('.act-row', (r) => r.length);
  check('activiteit: filter op gebeurtenis', dlRows >= 2 && page.url().includes('soort=download_requested'), String(dlRows));
  await page.selectOption('.fb-filter select[aria-label="Gebeurtenis"]', '');
  await page.selectOption('.fb-filter select[aria-label="Video"]', String(main.videoId));
  await page.waitForTimeout(400);
  check('activiteit: filter op video', (await page.$$eval('.act-row a', (as) => as.every((a) => a.textContent === 'Zomerlijn — Hoofdfilm'))));
  // Bewaartermijn
  await page.goto(`${BASE}/opslag`);
  await page.waitForSelector('input[aria-label="Bewaartermijn in dagen"]');
  check('opslag: bewaartermijn klantactiviteit standaard 90 dagen', (await page.inputValue('input[aria-label="Bewaartermijn in dagen"]')) === '90');
  await page.fill('input[aria-label="Bewaartermijn in dagen"]', '120');
  await page.click('section:has-text("Klantactiviteit bewaren") button:has-text("Opslaan")');
  await page.waitForSelector('.toast:has-text("120 dagen")');
  check('opslag: bewaartermijn aangepast', true);
  await page.locator('section:has-text("Klantactiviteit bewaren")').screenshot({ path: path.join(SHOTS, '96-bewaartermijn.png') });

  // ---------- C. iPhone: volledig scherm en tekeningen (nagebootst) ----------
  await apiT('POST', `/api/versions/${v2.versionId}/comments`, { body: 'Hier komt het logo', timecode: 2, internal: false, annotation: { v: 1, shapes: [{ t: 'rect', c: '#ffd60a', a: [0.3, 0.3], b: [0.7, 0.7] }] } });
  const reviewUrl = (await apiT('GET', `/api/videos/${main.videoId}`)).links.find((l) => l.role === 'reviewer').url.replace(/^https?:\/\/[^/]+/, BASE);
  const iphone = await browser.newContext({ ...devices['Pixel 7'], timezoneId: 'Europe/Amsterdam', locale: 'nl-NL' });
  await iphone.addInitScript(() => {
    // iPhone-Safari heeft geen element-volledig-scherm, alleen de ingebouwde videospeler.
    Element.prototype.requestFullscreen = undefined;
    HTMLElement.prototype.requestFullscreen = undefined;
    HTMLVideoElement.prototype.webkitEnterFullscreen = function () { window.__nativeFs = (window.__nativeFs || 0) + 1; };
  });
  const ip = await iphone.newPage();
  watch(ip, 'iphone-emulatie');
  await ip.goto(reviewUrl);
  await ip.waitForSelector('.comment');
  await ip.click('.comment .comment-drawing');
  await ip.waitForFunction(() => !document.querySelector('.pc-overlay').hidden);
  await ip.click('.pc-btn[aria-label^="Volledig scherm"]');
  await ip.waitForSelector('.pc-fschoice:not([hidden])');
  check('iPhone (nagebootst): uitleg dat schermvullend geen tekeningen toont, met alternatief', /toont geen tekeningen/.test(await ip.textContent('.pc-fschoice')) && /niet verdwenen/.test(await ip.textContent('.pc-fschoice')));
  await shot(ip, '97-iphone-uitleg-volledig-scherm');
  await ip.click('.pc-fschoice button:has-text("Groot in de pagina")');
  await ip.waitForSelector('.player.is-pagefull');
  const pf = await ip.evaluate(() => {
    const o = document.querySelector('.pc-overlay').getBoundingClientRect();
    const p = document.querySelector('.player').getBoundingClientRect();
    return { overlayVisible: !document.querySelector('.pc-overlay').hidden && o.width > 0, fills: Math.round(p.height) >= window.innerHeight - 2 };
  });
  check('iPhone (nagebootst): “Groot in de pagina” vult het scherm en toont de tekening', pf.overlayVisible && pf.fills, JSON.stringify(pf));
  await shot(ip, '98-iphone-groot-in-de-pagina');
  await ip.click('.pc-btn[aria-label^="Groot in de pagina sluiten"]');
  await ip.waitForSelector('.player:not(.is-pagefull)');
  await ip.click('.pc-btn[aria-label^="Volledig scherm"]');
  await ip.click('.pc-fschoice button:has-text("Schermvullend zonder tekeningen")');
  check('iPhone (nagebootst): bewust kiezen voor de ingebouwde schermvullende speler kan ook', (await ip.evaluate(() => window.__nativeFs)) === 1);

  // Zonder tekeningen: direct de ingebouwde speler
  const socialReview = (await apiT('GET', `/api/videos/${social.videoId}`)).links.find((l) => l.role === 'reviewer').url.replace(/^https?:\/\/[^/]+/, BASE);
  const ip2 = await iphone.newPage();
  await ip2.goto(socialReview);
  await ip2.waitForSelector('.player video');
  await ip2.click('.pc-btn[aria-label^="Volledig scherm"]');
  await ip2.waitForTimeout(200);
  check('iPhone (nagebootst): zonder tekeningen meteen schermvullend, geen extra vraag', (await ip2.evaluate(() => window.__nativeFs)) === 1 && !(await ip2.isVisible('.pc-fschoice')));

  // Desktop: volledig scherm werkt zoals voorheen (geen keuzevenster)
  await cp.goto(reviewUrl);
  await cp.waitForSelector('.player video');
  await cp.click('.pc-btn[aria-label^="Volledig scherm"]');
  await cp.waitForTimeout(300);
  check('desktop: volledig scherm zonder keuzevenster (tekeningen werken daar)', !(await cp.isVisible('.pc-fschoice')));

  check('geen JavaScript-fouten in de pagina’s', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  listener.close();
  server.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} controles geslaagd. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
