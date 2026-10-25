// Browsertest bouwronde 2: klantportaal, merk, opleveringen, briefing en voorbeeldweergave,
// op desktop en in een mobiele weergave (Pixel 7-emulatie), met echte H.264/AAC-MP4's.
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser:portaal   (SHOTS_DIR=/map optioneel)
// Start een eigen tijdelijke server met lege gegevens; raakt je eigen gegevens niet aan.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');
const { createApp } = require('../server/app');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Zet CHROME_PATH naar een Chrome met H.264-ondersteuning.'); process.exit(2); }
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-portaaltest-'));
const SHOTS = process.env.SHOTS_DIR || path.join(S, 'shots');
for (const d of [SHOTS, path.join(S, 'media')]) fs.mkdirSync(d, { recursive: true });
const setupToken = 'portaaltest-installatiecode';
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const shot = async (page, name, opts = {}) => {
  await page.evaluate(() => document.querySelectorAll('.toast-host > *').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

function mp4(name, { size = '1920x1080', seconds = 10, freq = 440, pattern = 'testsrc2' } = {}) {
  const file = path.join(S, 'media', name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `${pattern}=size=${size}:rate=25:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}:sample_rate=48000`, '-ac', '2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', file]);
  return file;
}
function logo() {
  const file = path.join(S, 'media', 'moviemates-logo.png');
  const text = fs.existsSync(FONT) ? `,drawtext=fontfile=${FONT}:text='moviemates':fontcolor=white:fontsize=34:x=64:y=17` : '';
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=330x68,format=rgba',
    '-vf', `drawbox=x=8:y=12:w=44:h=44:color=0x38c6b8@1:t=fill,drawbox=x=22:y=26:w=16:h=16:color=0x0f1012@1:t=fill${text}`, '-frames:v', '1', file]);
  return file;
}

(async () => {
  console.log('Testbestanden maken…');
  const files = {
    main: mp4('hoofdvideo_def_v1.mp4', { seconds: 12, freq: 500 }),
    main2: mp4('hoofdvideo_def_v2.mp4', { seconds: 12, freq: 660, pattern: 'smptehdbars' }),
    teaser: mp4('teaser_15s.mp4', { seconds: 8, freq: 330, pattern: 'smptehdbars' }),
    social: mp4('social_reel_9x16.mp4', { size: '1080x1920', seconds: 8, freq: 550 }),
    internal: mp4('interne_test_montage.mp4', { seconds: 6, freq: 220, pattern: 'testsrc' }),
    logo: logo(),
    ref: path.join(S, 'media', 'referentie-kleuren.png'),
  };
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=800x450', '-frames:v', '1', files.ref]);

  const server = createApp({ dataDir: path.join(S, 'data'), backupDir: path.join(S, 'backups'), setupToken, minFreeBytes: 0, env: { ...process.env, STUDIO_REVIEW_HOME: path.join(S, 'home'), DATA_DIR: '' } });
  const listener = await new Promise((r) => { const l = server.app.listen(0, () => r(l)); });
  const BASE = `http://localhost:${listener.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  console.log('Browser:', browser.version());
  const errors = [];
  const watch = (p, label) => {
    p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/40[0134]|410|net::ERR_(ABORTED|FAILED)/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  };
  const noNull = async (page, label) => check(`${label}: geen losse "null"/"undefined"`, !/\bnull\b|\bundefined\b/.test(await page.evaluate(() => document.body.innerText)));

  // PDF voor de briefing, gemaakt door de browser zelf.
  {
    const p = await browser.newPage();
    await p.setContent('<h1 style="font-family:sans-serif">Script — Voorjaarscampagne</h1><p style="font-family:sans-serif">Scène 1: bakkerij bij zonsopkomst.</p>');
    files.pdf = path.join(S, 'media', 'Script v2.pdf');
    await p.pdf({ path: files.pdf, format: 'A4' });
    await p.close();
  }

  // ---------- Team ----------
  const team = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await team.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await team.newPage();
  watch(page, 'team');
  const H = { 'x-requested-with': 'review-tool' };
  const apiT = async (method, url, data) => {
    const r = await page.request.fetch(`${BASE}${url}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  await page.goto(`${BASE}/?setup=${setupToken}`);
  await page.fill('input[name=name]', 'Sanne de Vries');
  await page.fill('input[name=email]', 'sanne@agency.nl');
  await page.fill('input[name=password]', 'een-lang-wachtwoord');
  await page.click('button[type=submit]');
  await page.waitForSelector('.onboarding');

  // Merk: logo uploaden via de merkenpagina
  await page.goto(`${BASE}/merken`);
  await page.waitForSelector('.brand-card');
  const mmCard = page.locator('.brand-card', { hasText: 'Moviemates' });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), mmCard.locator('button:has-text("Logo uploaden")').click()]);
  await chooser.setFiles(files.logo);
  await mmCard.locator('img.logo-thumb').waitFor();
  check('merk: logo geüpload via de merkenpagina', await mmCard.locator('.brand-preview img.brand-logo').isVisible());
  const sbCard = page.locator('.brand-card', { hasText: 'Studio Brutaal' });
  check('merk zonder logo: naam met initialen in het voorbeeld', await sbCard.locator('.brand-preview .brand-initials').isVisible());
  await shot(page, '40-merken', { fullPage: true });

  // Project met merk en introductie
  await page.goto(`${BASE}/`);
  await page.click('text=Eerste project aanmaken');
  await page.fill('dialog input[name=name]', 'Voorjaarscampagne 2026');
  await page.fill('dialog input[name=clientName]', 'Bakkerij Jansen');
  await page.selectOption('dialog select[name=brandId]', { label: 'Moviemates' });
  await page.fill('dialog textarea[name=portalIntro]', 'Hoi! Hier vind je alle video’s voor de voorjaarscampagne. Bekijk ze, laat per video je opmerkingen achter en verstuur je feedback.');
  await page.click('dialog button:has-text("Project aanmaken")');
  await page.waitForSelector('.dropzone-big');
  const projectId = Number(page.url().match(/projecten\/(\d+)/)[1]);
  check('project: merk zichtbaar bij het project', await page.locator('.brand-chip:has-text("Moviemates")').isVisible());

  // Uploaden via de interface (vier opleveringen + een interne montage)
  const [c2] = await Promise.all([page.waitForEvent('filechooser'), page.click('.dropzone-big')]);
  await c2.setFiles([files.main, files.teaser, files.social, files.internal]);
  await page.waitForFunction(() => document.querySelectorAll('.tray-item.is-done').length >= 4, null, { timeout: 180_000 });
  const project = await apiT('GET', `/api/projects/${projectId}`);
  const byFile = (needle) => project.videos.find((v) => v.title.toLowerCase().includes(needle));
  const vMain = byFile('hoofdvideo');
  const vTeaser = byFile('teaser');
  const vSocial = byFile('social');
  const vInternal = byFile('interne');
  await apiT('PATCH', `/api/videos/${vMain.id}`, { title: 'Campagnefilm — Hoofdvideo', kind: 'main', channel: 'YouTube en website' });
  await apiT('PATCH', `/api/videos/${vTeaser.id}`, { title: 'Teaser 15 sec', kind: 'teaser' });
  await apiT('PATCH', `/api/videos/${vInternal.id}`, { title: 'Interne testmontage', kind: 'other' });

  // Gegevens van de social video via het venster op de werkplek
  await page.goto(`${BASE}/video/${vSocial.id}`);
  await page.click('#tab-info');
  await page.waitForSelector('.delivery-meta');
  check('verticale video: 9:16 automatisch herkend', /9:16 \(herkend\)/.test(await page.textContent('.delivery-meta')));
  await page.click('.delivery-meta button');
  await page.selectOption('dialog select[aria-label="Type video"]', 'social');
  await page.fill('dialog input[placeholder^="Bijv. Instagram"]', 'Instagram Reels');
  await page.fill('dialog input[placeholder^="Bijv. Instagram"]', 'Instagram Reels');
  await page.click('dialog button:has-text("Opslaan")');
  await page.waitForFunction(() => /Social · 9:16 \(herkend\) · Instagram Reels/.test(document.querySelector('.delivery-meta')?.textContent || ''));
  check('opleveringsgegevens opgeslagen via de interface', true);
  await apiT('PATCH', `/api/videos/${vSocial.id}`, { title: 'Social reel 9:16' });

  // Publiceren (hoofdvideo, teaser, social); interne montage blijft concept
  for (const v of [vMain, vTeaser, vSocial]) {
    const ver = (await apiT('GET', `/api/videos/${v.id}`)).versions[0];
    await apiT('POST', `/api/versions/${ver.id}/ready`);
    await apiT('POST', `/api/versions/${ver.id}/share`);
  }

  // Projectpagina: gegroepeerd per type
  await page.goto(`${BASE}/projecten/${projectId}`);
  // Bouwronde 7: standaard kaarten; de lijstweergave groepeert per type.
  await page.click('.gallery-tools .view-toggle button[aria-label="Lijst"]');
  await page.waitForSelector('.kind-group');
  const groupNames = await page.locator('.kind-head').allTextContents();
  check('projectpagina: opleveringen per type gegroepeerd', groupNames.length === 4 && /Hoofdvideo/.test(groupNames[0]), groupNames.join(' | '));
  check('projectpagina: intern vs. klant ziet per oplevering', (await page.locator('.ver-chip:has-text("Klant ziet")').count()) === 3 && (await page.locator('.ver-chip.is-none').count()) === 1);
  await shot(page, '41-project-opleveringen', { fullPage: true });

  // Interne notitie en zichtbare notitie op de hoofdvideo (via de werkplek)
  await page.goto(`${BASE}/video/${vMain.id}`);
  await page.waitForSelector('.composer-visibility');
  check('werkplek: notitie staat standaard op Intern', (await page.getAttribute('.composer-visibility button:has-text("Intern")', 'aria-pressed')) === 'true');
  await page.fill('.composer textarea', 'Muziek nog licenseren voor online gebruik');
  await page.click('.composer button[type=submit]');
  await page.waitForSelector('.comment:has-text("Muziek nog licenseren") .badge-internal');
  await page.evaluate(() => { document.querySelector('video').currentTime = 6; });
  await page.click('.composer-visibility button:has-text("Zichtbaar voor klant")');
  await page.fill('.composer textarea', 'Hier komt de eindtitel met het nieuwe logo');
  await page.click('.composer button[type=submit]');
  await page.waitForSelector('.comment:has-text("eindtitel") .badge-visible');
  check('werkplek: interne en zichtbare notitie herkenbaar (icoon + tekst)', true);
  await shot(page, '42-werkplek-intern-en-zichtbaar');

  // Nieuwe interne versie van de hoofdvideo (mag de klantweergave niet veranderen)
  const up = await page.request.post(`${BASE}/api/uploads`, { headers: H, data: { filename: path.basename(files.main2), size: fs.statSync(files.main2).size, videoId: vMain.id } }).then((r) => r.json());
  const buf = fs.readFileSync(files.main2);
  for (let o = 0; o < buf.length; o += up.chunkSize) await page.request.put(`${BASE}/api/uploads/${up.id}?offset=${o}`, { headers: { ...H, 'content-type': 'application/octet-stream' }, data: buf.subarray(o, o + up.chunkSize) });
  const v2 = await apiT('POST', `/api/videos/${vMain.id}/versions`, { uploadId: up.id });

  // ---------- Briefing en referenties ----------
  await page.goto(`${BASE}/projecten/${projectId}/briefing`);
  await page.waitForSelector('.brief-add');
  await page.click('.brief-add button:has-text("Briefingtekst")');
  await page.fill('.brief-form input', 'Briefing');
  await page.fill('.brief-form textarea', 'Doelgroep: jonge gezinnen.\nKernboodschap: elke ochtend vers.\nIntern: budget € 18.000, deadline 14 maart.');
  await page.click('.brief-form button[type=submit]');
  await page.waitForSelector('.brief-card:has-text("Doelgroep")');
  check('briefing: nieuw onderdeel is intern', await page.locator('.brief-card:has-text("Doelgroep") .badge-internal').isVisible());
  // Opslaan mislukt (server weg): tekst blijft staan
  await page.click('.brief-add button:has-text("Link")');
  await page.fill('.brief-form input[type=text]', 'Moodboard');
  await page.fill('.brief-form input[type=url]', 'https://example.com/moodboard-voorjaar');
  await page.route('**/api/projects/*/briefing', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
  await page.click('.brief-form button[type=submit]');
  await page.waitForSelector('.brief-form .form-error:not([hidden])');
  check('briefing: bij mislukt opslaan blijft de ingevulde tekst staan', (await page.inputValue('.brief-form input[type=url]')) === 'https://example.com/moodboard-voorjaar' && /bewaard/.test(await page.textContent('.brief-form .form-error')));
  await page.unroute('**/api/projects/*/briefing');
  await page.check('.brief-form input[type=checkbox]');
  await page.click('.brief-form button[type=submit]');
  await page.waitForSelector('.brief-card:has-text("Moodboard") .badge-visible');
  const [c3] = await Promise.all([page.waitForEvent('filechooser'), page.click('.brief-add button:has-text("Bestand")')]);
  await c3.setFiles([files.pdf, files.ref]);
  await page.waitForSelector('.brief-card:has-text("Script v2")', { timeout: 60_000 });
  await page.waitForSelector('.brief-card:has-text("referentie-kleuren")', { timeout: 60_000 });
  await page.click('.brief-card:has-text("referentie-kleuren") button:has-text("Delen met klant")');
  await page.waitForSelector('.brief-card:has-text("referentie-kleuren") .badge-visible');
  check('briefing: aantallen in het tabblad lopen mee', (await page.textContent('[data-count=briefing]')) === '4' && (await page.textContent('[data-count=shared]')) === '2');
  check('briefing: twee gedeeld, twee intern (gegroepeerd)', (await page.locator('.brief-card.is-client').count()) === 2 && (await page.locator('.brief-card.is-internal').count()) === 2);
  // Intern PDF opent voor het team (inline, eigen type)
  const pdfHref = await page.getAttribute('.brief-card:has-text("Script v2") a:has-text("Openen")', 'href');
  const pdfRes = await page.request.get(`${BASE}${pdfHref}`);
  check('briefing: PDF wordt als PDF geserveerd met sandbox', pdfRes.headers()['content-type'] === 'application/pdf' && /sandbox/.test(pdfRes.headers()['content-security-policy']));
  await shot(page, '43-briefing-team', { fullPage: true });

  // ---------- Klantportaal-link ----------
  await page.goto(`${BASE}/projecten/${projectId}`);
  await page.click('.page-actions button:has-text("Delen")');
  await page.click('.menu:not([hidden]) .menu-item:has-text("Klantportaal")');
  await page.click('dialog button:has-text("Projectlink maken")');
  await page.waitForSelector('dialog .link-url');
  const portalUrl = await page.inputValue('dialog .link-url');
  check('projectlink gemaakt; localhost-melding zichtbaar', /\/p\/[A-Za-z0-9_-]{20,}$/.test(portalUrl) && await page.isVisible('dialog .notice-warn:has-text("alleen op deze computer")'));
  check('portaalvenster legt intrekken en goedkeuren uit', /Goedkeuren kan niet via de projectlink/.test(await page.textContent('dialog')));
  await shot(page, '44-klantportaal-venster');
  await page.click('dialog button:has-text("Klaar")');

  // ---------- Klant: desktop ----------
  const clientCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cp = await clientCtx.newPage();
  watch(cp, 'klant');
  await cp.goto(portalUrl);
  await cp.waitForSelector('.p-card');
  const portalText = await cp.evaluate(() => document.body.innerText);
  check('portaal: merk (logo) en introductie', await cp.isVisible('.p-header img.brand-logo') && portalText.includes('Hier vind je alle video’s'));
  // Bouwronde 6: eerst "Jouw acties" (één regel per video), daaronder de ingeklapte route naar alle video's.
  const titles = await cp.locator('.p-group-todo .p-card-title').allTextContents();
  const allTitles = await cp.locator('.p-all .p-card-title').allTextContents();
  check('portaal: alleen gepubliceerde video’s', titles.length === 3 && allTitles.length === 3 && !portalText.includes('Interne testmontage'), titles.join(', '));
  check('portaal: hoofdvideo toont gepubliceerde Versie 1, niet de interne Versie 2', /Versie 1/.test(await cp.textContent('.p-card:has-text("Hoofdvideo")')));
  check('portaal: “Jouw acties” met 3 video’s en samenvatting bovenaan', /Jouw acties\s*3/.test(await cp.textContent('.p-group-todo h2')) && portalText.includes('Er staan 3 video’s voor je klaar.'));
  check('portaal: geen goedkeurknop, wel uitleg', !(await cp.isVisible('text=Deze versie goedkeuren')) && portalText.includes('Goedkeuren doet de aangewezen akkoordgever'));
  check('portaal: alleen gedeelde briefing', portalText.includes('Moodboard') && portalText.includes('referentie-kleuren') && !portalText.includes('Doelgroep') && !portalText.includes('Script v2'));
  const accent = await cp.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  check('portaal: accentkleur van het merk', accent.toLowerCase() === '#38c6b8', accent);
  // Verticale thumbnail past helemaal in het kader (niet bijgesneden): even hoog als het kader.
  const thumb = await cp.$eval('.p-card:has-text("Social reel") .p-thumb', (el) => ({ box: el.clientHeight, img: el.querySelector('img').clientHeight, fit: getComputedStyle(el.querySelector('img')).objectFit }));
  check('portaal: verticale thumbnail niet bijgesneden', thumb.fit === 'contain' && Math.abs(thumb.box - thumb.img) <= 1, JSON.stringify(thumb));
  await noNull(cp, 'portaal');
  await shot(cp, '45-portaal-desktop', { fullPage: true });

  // Directe verzoeken naar interne zaken vanuit de klant
  const portalApi = portalUrl.replace('/p/', '/api/portal/');
  const pdata = await (await cp.request.get(portalApi)).json();
  const mainCard = pdata.videos.find((v) => v.id === vMain.id);
  const derived = mainCard.href.split('/').pop();
  const internalPdf = (await apiT('GET', `/api/projects/${projectId}/briefing`)).items.find((i) => i.title.startsWith('Script'));
  const probes = [
    [`/api/review/${derived}/versions/${v2.versionId}/media`, 404, 'interne v2 (media)'],
    [`/api/review/${derived}/versions/${v2.versionId}/comments`, 404, 'interne v2 (reacties)'],
    [`${new URL(portalApi).pathname}/videos/${vInternal.id}/poster`, 404, 'thumbnail interne montage'],
    [`${new URL(portalApi).pathname}/briefing/${internalPdf.id}/file`, 404, 'interne PDF'],
    [`/api/briefing/${internalPdf.id}/file`, 401, 'teamroute zonder account'],
    [`/api/projects/${projectId}/portal-preview`, 401, 'voorbeeld zonder account'],
  ];
  for (const [url, status, label] of probes) {
    const r = await cp.request.get(`${BASE}${url}`);
    check(`klant kan niet bij ${label}`, r.status() === status, `${r.status()}`);
  }

  // Video bekijken, reageren en feedback versturen via het portaal
  await cp.click('.p-card:has-text("Hoofdvideo")');
  await cp.waitForSelector('.r-header');
  const reviewText = await cp.evaluate(() => document.body.innerText);
  check('review via portaal: terug-link, merk en type', await cp.isVisible('a.r-back') && await cp.isVisible('.r-header img.brand-logo') && reviewText.includes('Hoofdvideo · 16:9 · YouTube en website'));
  check('review via portaal: zichtbare teamnotitie wel, interne niet', reviewText.includes('eindtitel') && !reviewText.includes('Muziek nog licenseren'));
  check('review via portaal: geen goedkeurknop', !(await cp.isVisible('button:has-text("Deze versie goedkeuren")')));
  await cp.click('.pc-bigplay');
  await cp.waitForTimeout(1500);
  const t = await cp.evaluate(() => document.querySelector('video').currentTime);
  check('review via portaal: video speelt af', t > 0.5, `${t.toFixed(2)}s`);
  await cp.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 3; });
  await cp.fill('#reviewer-name', 'Eva Jansen');
  await cp.fill('.composer textarea', 'Logo in de eindtitel graag groter');
  await cp.click('.composer button[type=submit]');
  await cp.waitForSelector('.comment:has-text("Logo in de eindtitel")');
  await cp.click('button:has-text("Feedback versturen")');
  await cp.click('dialog button:has-text("Feedback versturen")');
  await cp.waitForSelector('.notice-ok:has-text("Je feedback is verstuurd")');
  await shot(cp, '46-review-via-portaal-desktop');
  await cp.click('a.r-back');
  await cp.waitForSelector('.p-group-busy');
  check('portaal na feedback: hoofdvideo onder “Feedback verstuurd”', /Hoofdvideo/.test(await cp.textContent('.p-group-busy')));

  // ---------- Klant: mobiel ----------
  const mobile = await browser.newContext({ ...devices['Pixel 7'] });
  const mp = await mobile.newPage();
  watch(mp, 'mobiel');
  await mp.goto(portalUrl);
  await mp.waitForSelector('.p-card');
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('mobiel portaal: geen horizontaal scrollen', !overflow);
  await shot(mp, '47-portaal-mobiel', { fullPage: true });
  await mp.click('.p-card:has-text("Social reel")');
  await mp.waitForSelector('.r-header');
  await mp.click('.pc-bigplay');
  await mp.waitForTimeout(1500);
  const mt = await mp.evaluate(() => ({ t: document.querySelector('video').currentTime, w: document.querySelector('video').videoWidth, h: document.querySelector('video').videoHeight }));
  check('mobiel: verticale video speelt af', mt.t > 0.5 && mt.h > mt.w, `${mt.t.toFixed(2)}s ${mt.w}×${mt.h}`);
  await mp.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 2; });
  await mp.fill('#reviewer-name', 'Eva Jansen');
  await mp.fill('.composer textarea', 'Ondertiteling iets hoger, valt weg achter de knoppen van Instagram');
  await mp.click('.composer button[type=submit]');
  await mp.waitForSelector('.comment:has-text("Ondertiteling")');
  await mp.click('.r-actions button:has-text("Feedback versturen")');
  await mp.click('dialog button:has-text("Feedback versturen")');
  await mp.waitForSelector('.notice-ok:has-text("Je feedback is verstuurd")');
  check('mobiel: reageren en feedback versturen via het portaal', true);
  await shot(mp, '48-review-via-portaal-mobiel');

  // Akkoordgever keurt de teaser goed via de persoonlijke link (mobiel)
  await apiT('PATCH', `/api/videos/${vTeaser.id}`, { approverName: 'Joris de Klant', approverEmail: 'joris@bakkerijjansen.nl' });
  const approverUrl = (await apiT('POST', `/api/videos/${vTeaser.id}/links`, { role: 'approver' })).url.replace(/^https?:\/\/[^/]+/, BASE);
  await mp.goto(approverUrl);
  await mp.click('.r-actions button:has-text("Deze versie goedkeuren")');
  await mp.click('dialog button:has-text("keur Versie 1 goed")');
  await mp.waitForSelector('.notice-ok:has-text("is goedgekeurd")');
  await mp.goto(portalUrl);
  await mp.waitForSelector('.p-group-done');
  check('portaal: goedgekeurde teaser onder “Goedgekeurd” met naam', /Teaser 15 sec[\s\S]*Goedgekeurd door Joris de Klant/.test(await mp.textContent('.p-group-done')));
  check('portaal: “Goedgekeurd” standaard ingeklapt, na acties en “Bij …”', await mp.$eval('.p-group-done', (el) => el.tagName === 'DETAILS' && !el.open)
    && await mp.evaluate(() => { const g = [...document.querySelectorAll('.p-main > .p-group')].map((e) => e.className.match(/p-group-(\w+)/)?.[1]); return g.indexOf('todo') < g.indexOf('done'); }));
  await shot(mp, '49-portaal-mobiel-goedgekeurd', { fullPage: true });

  // Akkoordgever wijzigen terwijl er al een akkoordlink is (oude link wordt ingetrokken)
  await page.goto(`${BASE}/video/${vTeaser.id}`);
  await page.click('.page-actions button:has-text("Delen")');
  await page.fill('dialog input[aria-label="Naam akkoordgever"]', 'Marieke de Klant');
  await page.click('dialog button:has-text("Akkoordgever wijzigen")');
  await page.click('dialog[open]:last-of-type button:has-text("Wijzigen")');
  await page.waitForFunction(() => {
    const d = document.querySelector('dialog[open]');
    return d && /Ingetrokken links \(1\)/.test(d.textContent) && d.querySelector('input[aria-label="Naam akkoordgever"]')?.value === 'Marieke de Klant';
  }, null, { timeout: 15_000 });
  check('akkoordgever wijzigen met bestaande akkoordlink werkt (oude link ingetrokken)', true);
  await page.keyboard.press('Escape');
  const oldApprover = await cp.request.get(`${BASE}/api/review/${approverUrl.split('/').pop()}`);
  check('oude akkoordlink werkt niet meer na wijzigen akkoordgever', oldApprover.status() === 410, String(oldApprover.status()));

  // ---------- Team: voorbeeldweergave ----------
  await page.goto(`${BASE}/voorbeeld/project/${projectId}`);
  await page.waitForSelector('.preview-bar');
  const prevTitles = await page.locator('.p-all .p-card-title').allTextContents();
  check('voorbeeld portaal: zelfde video’s als de klant', JSON.stringify(prevTitles.sort()) === JSON.stringify((await cp.locator('.p-all .p-card-title').allTextContents()).sort()), prevTitles.join(', '));
  await shot(page, '50-voorbeeld-portaal-team', { fullPage: true });
  await page.click('.p-card:has-text("Hoofdvideo")');
  await page.waitForSelector('.preview-bar');
  const pv = await page.evaluate(() => document.body.innerText);
  check('voorbeeld video: interne notitie verborgen, alleen-lezen', !pv.includes('Muziek nog licenseren') && pv.includes('eindtitel') && !(await page.isVisible('.composer')));
  check('voorbeeld video: alleen gepubliceerde versie (geen Versie 2)', !(await page.isVisible('.version-pick')) && /Versie 1/.test(await page.textContent('.version-chip')));
  await shot(page, '51-voorbeeld-video-team');

  // Nieuwe versie publiceren: de klant ziet nu Versie 2
  await apiT('POST', `/api/versions/${v2.versionId}/ready`);
  await apiT('POST', `/api/versions/${v2.versionId}/share`);
  await cp.goto(portalUrl);
  await cp.waitForSelector('.p-card');
  check('na publiceren van v2: portaal toont Versie 2 bij de klant', /Versie 2/.test(await cp.textContent('.p-card:has-text("Hoofdvideo")')) && /Hoofdvideo/.test(await cp.textContent('.p-group-todo')));

  // ---------- Intrekken ----------
  const directUrl = (await apiT('GET', `/api/videos/${vSocial.id}`)).links.find((l) => l.role === 'reviewer').url.replace(/^https?:\/\/[^/]+/, BASE);
  await page.goto(`${BASE}/projecten/${projectId}`);
  await page.click('.page-actions button:has-text("Delen")');
  await page.click('.menu:not([hidden]) .menu-item:has-text("Klantportaal")');
  await page.waitForSelector('dialog .link-url');
  await page.click('dialog button:has-text("Intrekken")');
  check('intrekken: bevestiging noemt de afzonderlijke videolinks', /afzonderlijke videolinks blijven werken/.test(await page.textContent('dialog[open]:last-of-type')));
  await page.click('dialog[open]:last-of-type button:has-text("Intrekken")');
  await page.waitForSelector('dialog button:has-text("Projectlink maken")');
  await page.keyboard.press('Escape');
  await cp.goto(portalUrl);
  await cp.waitForSelector('.fatal');
  check('ingetrokken projectlink: duidelijke melding', /werkt niet meer/.test(await cp.textContent('.fatal')));
  await shot(cp, '52-projectlink-ingetrokken');
  await cp.goto(`${BASE}/r/${derived}`);
  await cp.waitForSelector('.fatal');
  check('ingetrokken: via het portaal geopende video ook niet meer bereikbaar', /werkt niet meer|ingetrokken/.test(await cp.textContent('.fatal')));
  await cp.goto(directUrl);
  await cp.waitForSelector('.r-header');
  check('ingetrokken projectlink: afzonderlijke reviewlink werkt nog', await cp.isVisible('.r-header h1'));

  check('geen JavaScript-fouten', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  listener.close();
  server.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nSchermafbeeldingen: ${SHOTS}\n${results.length - failed}/${results.length} controles geslaagd`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
