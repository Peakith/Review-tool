// Browsertest van de volledige klantflow met een echte H.264/AAC-MP4.
//
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser
// Vereist: ffmpeg, en een Chrome/Chromium mét H.264-ondersteuning (bijv. Google Chrome
// of "Chrome for Testing"; de open-source Chromium van Playwright kan geen H.264 afspelen).
// Start zelf een tijdelijke server met lege database; raakt je eigen data niet aan.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');
const { createApp } = require('../server/app');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) {
  console.error('Zet CHROME_PATH naar een Chrome met H.264-ondersteuning.');
  process.exit(2);
}
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-browsertest-'));
for (const dir of ['media', 'shots', 'downloads']) fs.mkdirSync(path.join(S, dir));
const setupToken = 'browsertest-installatiecode';
let BASE;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// Representatieve exports: 1080p H.264 High + AAC-LC stereo 48 kHz, 30 s.
// v03 zonder faststart (moov-atoom achteraan), v04 met faststart.
function makeMp4(name, freq, faststart) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25:duration=30',
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=30:sample_rate=48000`, '-ac', '2',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-b:v', '6M',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', ...(faststart ? ['-movflags', '+faststart'] : []), path.join(S, 'media', name)]);
}

async function playAndMeasure(page, label) {
  await page.click('.pc-bigplay');
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => {
    const v = document.querySelector('video');
    return { t: v.currentTime, audioBytes: v.webkitAudioDecodedByteCount, videoBytes: v.webkitVideoDecodedByteCount, muted: v.muted, volume: v.volume, w: v.videoWidth, h: v.videoHeight, err: v.error?.code || null };
  });
  check(`${label}: video speelt af`, m.t > 1 && !m.err, `currentTime ${m.t.toFixed(2)}s, ${m.w}×${m.h}`);
  check(`${label}: audio (AAC) wordt gedecodeerd`, m.audioBytes > 0 && !m.muted && m.volume > 0, `${m.audioBytes} bytes audio`);
  return m;
}

async function seekViaTimeline(page, fraction, label) {
  const box = await page.locator('.pc-track').boundingBox();
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const t0 = await page.evaluate(() => document.querySelector('video').currentTime);
  await page.waitForTimeout(1500);
  const t1 = await page.evaluate(() => document.querySelector('video').currentTime);
  check(`${label}: vooruitspoelen via tijdlijn naar ${Math.round(fraction * 100)}%`, Math.abs(t0 - 30 * fraction) < 1.5 && t1 > t0 + 0.5, `sprong naar ${t0.toFixed(2)}s, speelt door tot ${t1.toFixed(2)}s`);
}

(async () => {
  makeMp4('klant_campagne_edit_v03.mp4', 1000, false);
  makeMp4('klant_campagne_edit_v04.mp4', 660, true);
  const server = createApp({ dataDir: path.join(S, 'data'), setupToken });
  const listener = await new Promise((r) => { const l = server.app.listen(0, () => r(l)); });
  BASE = `http://127.0.0.1:${listener.address().port}`;
  // Zonder UTF-8-locale weigert Chrome op Linux niet-ASCII-tekens in downloadnamen.
  const browser = await chromium.launch({ executablePath: CHROME, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  console.log('Browser:', browser.version());
  const errors = [];
  const watch = (p, label) => {
    p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('410')) errors.push(`${label}: ${m.text()}`); });
  };

  // ---------- Team: installatie, upload, delen ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'team');
  await page.goto(`${BASE}/?setup=${setupToken}`);
  check('installatiecode staat al ingevuld via link', (await page.inputValue('input[name=setupToken]')) === setupToken);
  await page.fill('input[name=name]', 'Sanne de Vries');
  await page.fill('input[name=email]', 'sanne@agency.nl');
  await page.fill('input[name=password]', 'een-lang-wachtwoord');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Nog geen projecten');
  check('setup-code verdwijnt uit adresbalk', !page.url().includes('setup='), page.url());

  await page.click('text=+ Nieuw project');
  await page.fill('input[name=name]', 'Voorjaarscampagne 2026');
  await page.fill('input[name=clientName]', 'Bakkerij Jansen');
  await page.click('button:has-text("Project aanmaken")');
  await page.click('text=+ Video uploaden');
  await page.setInputFiles('#upload-file', `${S}/media/klant_campagne_edit_v03.mp4`);
  await page.fill('.dialog input[type=text]', 'Campagnefilm — Hoofdvideo');
  await page.click('.dialog button[type=submit]');
  await page.waitForURL(/\/video\/\d+/, { timeout: 120000 });
  await page.waitForSelector('.status-now .pill-concept');
  check('MP4 (23 MB, 3 blokken) geüpload als Concept', true);

  await page.click('text=Zet op “Klaar voor review”');
  await page.click('button:has-text("Delen met klant")');
  await page.click('dialog button:has-text("Delen met klant")');
  await page.waitForSelector('.status-now .pill-in_review');
  await page.fill('input[aria-label="Naam akkoordgever"]', 'Joris Jansen');
  await page.fill('input[aria-label="E-mail akkoordgever"]', 'joris@bakkerijjansen.nl');
  await page.click('form:has(input[aria-label="Naam akkoordgever"]) button');
  await page.waitForSelector('text=Maak persoonlijke akkoordlink');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('text=Maak persoonlijke akkoordlink');
  await page.waitForSelector('text=Akkoordlink · Joris Jansen');
  const reviewUrl = await page.inputValue('.link-row:has-text("Reviewlink") .link-url');
  const approverUrl = await page.inputValue('.link-row:has-text("Akkoordlink") .link-url');

  // Download: werkelijke bestandsnaam + geldig bestand
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.stage-meta a:has-text("Download")')]);
  const dlName = dl.suggestedFilename();
  const saved = `${S}/downloads/${dlName}`;
  await dl.saveAs(saved);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', saved]).toString().trim().split('\n');
  check('download: bestandsnaam = titel + versie + .mp4', dlName === 'Campagnefilm — Hoofdvideo - v1.mp4', dlName);
  check('download: bestand is identiek en speelbaar', fs.statSync(saved).size === fs.statSync(`${S}/media/klant_campagne_edit_v03.mp4`).size && probe.includes('h264') && probe.includes('aac'), probe.join('+'));

  // ---------- Klant op desktop ----------
  const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const client = await cctx.newPage();
  watch(client, 'klant');
  const ranges = [];
  client.on('response', (r) => { if (r.url().includes('/media')) ranges.push(r.status()); });
  await client.goto(reviewUrl);
  await client.waitForSelector('.player');
  await playAndMeasure(client, 'Desktop Chrome, MP4 zonder faststart');
  check('streaming via range-verzoeken (206)', ranges.includes(206), `statussen: ${[...new Set(ranges)].join(',')}`);
  await seekViaTimeline(client, 0.5, 'Desktop Chrome');
  await client.click('.pc-btn[aria-label=Pauzeren]');
  const pausedAt = await client.evaluate(() => document.querySelector('video').currentTime);

  // Volledig scherm
  await client.click('.pc-btn[aria-label="Volledig scherm"]');
  await client.waitForTimeout(500);
  check('volledig scherm', await client.evaluate(() => document.fullscreenElement?.classList.contains('player')));
  await client.screenshot({ path: `${S}/shots/fullscreen-desktop.png` });
  await client.keyboard.press('Escape');
  await client.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await client.waitForTimeout(300);

  // Tijdgebonden reacties
  await client.fill('#reviewer-name', 'Eva Bakker');
  await client.click('.composer textarea');
  await client.fill('.composer textarea', 'Logo in deze scène iets groter.');
  await client.click('.composer button[type=submit]');
  await client.waitForSelector('text=Logo in deze scène iets groter.');
  const tcText = await client.textContent('.comment:has-text("Logo in deze") .timecode');
  const expectTc = `0:${String(Math.floor(pausedAt)).padStart(2, '0')}`;
  check('reactie gekoppeld aan gepauzeerd tijdstip', tcText === expectTc, `${tcText} (gepauzeerd op ${pausedAt.toFixed(2)}s)`);
  await client.evaluate(() => { document.querySelector('video').currentTime = 4.2; });
  await client.waitForTimeout(500);
  await client.click('.composer textarea');
  await client.fill('.composer textarea', 'Intro mag sneller.');
  await client.click('.composer button[type=submit]');
  await client.waitForSelector('text=Intro mag sneller.');
  await client.click('.comment:has-text("Logo in deze") .timecode');
  await client.waitForTimeout(400);
  const jumped = await client.evaluate(() => document.querySelector('video').currentTime);
  check('klik op reactie springt naar tijdstip', Math.abs(jumped - pausedAt) < 0.1, `${jumped.toFixed(2)}s`);
  const markers = await client.locator('.pc-marker').count();
  check('reactiemarkeringen op tijdlijn', markers === 2, `${markers} markeringen`);
  await client.click('.pc-marker >> nth=0');
  await client.waitForTimeout(300);
  const viaMarker = await client.evaluate(() => document.querySelector('video').currentTime);
  check('klik op markering springt naar tijdstip', Math.abs(viaMarker - 4.2) < 0.1, `${viaMarker.toFixed(2)}s`);
  await client.screenshot({ path: `${S}/shots/klant-desktop-mp4.png` });

  // Versieflow in de UI: v2 als concept blijft onzichtbaar
  await page.click('text=+ Nieuwe versie uploaden');
  await page.setInputFiles('#upload-file', `${S}/media/klant_campagne_edit_v04.mp4`);
  await page.click('.dialog button[type=submit]');
  await page.waitForSelector('.version-item.is-current:has-text("v2")', { timeout: 120000 });
  await client.reload();
  await client.waitForSelector('.version-chip');
  check('klant ziet na upload v2 (concept) nog Versie 1', (await client.textContent('.version-chip')).includes('Versie 1') && !(await client.isVisible('.version-select')));
  await client.click('button:has-text("Feedback versturen")');
  await client.click('dialog button:has-text("Feedback versturen")');
  await client.waitForSelector('.pill-changes_requested');
  check('feedback versturen → Aanpassingen nodig (op v1)', true);

  await page.click('text=Zet op “Klaar voor review”');
  await page.click('button:has-text("Delen met klant")');
  await page.click('dialog button:has-text("Delen met klant")');
  await page.waitForSelector('.status-now .pill-in_review');
  await client.reload();
  await client.waitForSelector('.version-chip');
  check('na delen ziet klant Versie 2 (nieuwste) met dezelfde link', (await client.textContent('.version-chip')).includes('Versie 2'));
  check('versie 2 staat In review, niet goedgekeurd', await client.isVisible('.review-header .pill-in_review') && !(await client.isVisible('.notice-ok')));
  await client.selectOption('.version-select', { label: 'Versie 1' });
  await client.waitForSelector('text=Je bekijkt een oudere versie');
  check('feedback op versie 1 bewaard', (await client.locator('.comment').count()) >= 2);

  // ---------- Mobiel (Chrome-emulatie, Pixel 7) ----------
  const mctx = await browser.newContext({ ...devices['Pixel 7'] });
  const m = await mctx.newPage();
  watch(m, 'mobiel');
  await m.goto(approverUrl);
  await m.waitForSelector('.player');
  await m.tap('.pc-bigplay');
  await m.waitForTimeout(2500);
  const mm = await m.evaluate(() => { const v = document.querySelector('video'); return { t: v.currentTime, a: v.webkitAudioDecodedByteCount }; });
  check('Mobiel (Pixel 7-emulatie): MP4 met faststart speelt af met audio', mm.t > 1 && mm.a > 0, `t=${mm.t.toFixed(2)}s, audio ${mm.a} bytes`);
  await seekViaTimeline(m, 0.8, 'Mobiel');
  await m.tap('.pc-btn[aria-label=Pauzeren]');
  await m.tap('.composer textarea');
  await m.fill('.composer textarea', 'Eindshot is perfect.');
  await m.tap('.composer button[type=submit]');
  await m.waitForSelector('text=Eindshot is perfect.');
  check('mobiel: reactie geplaatst als geverifieerde akkoordgever', await m.isVisible('.comment:has-text("Eindshot") .badge-verified'));
  await m.screenshot({ path: `${S}/shots/mobiel-akkoordgever.png` });
  await m.tap('button:has-text("Deze versie goedkeuren")');
  await m.tap('dialog button:has-text("Ja, keur Versie 2 goed")');
  await m.waitForSelector('.notice-ok');
  check('mobiel: Versie 2 goedgekeurd door akkoordgever', (await m.textContent('.notice-ok')).includes('Versie 2 is goedgekeurd door Joris Jansen'));
  await m.screenshot({ path: `${S}/shots/mobiel-goedgekeurd.png` });

  await page.reload();
  await page.waitForSelector('.status-now');
  check('team ziet v2 Goedgekeurd en v1 Aanpassingen nodig',
    await page.isVisible('.status-now .pill-approved') && await page.isVisible('.version-item:has-text("v1") .pill-changes_requested'));
  await page.screenshot({ path: `${S}/shots/team-na-goedkeuring.png`, fullPage: true });

  check('geen JavaScript-fouten in de browser', errors.length === 0, errors.join(' | '));
  await browser.close();
  listener.close();
  server.stop();
  fs.writeFileSync(`${S}/resultaten.json`, JSON.stringify(results, null, 2));
  console.log(`Schermafbeeldingen en resultaten: ${S}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} controles geslaagd`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
