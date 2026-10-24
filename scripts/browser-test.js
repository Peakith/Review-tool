// Browsertest van de volledige flow in de echte interface, met echte H.264/AAC-MP4's.
//
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser
// Vereist: ffmpeg, en een Chrome/Chromium mét H.264-ondersteuning (bijv. Google Chrome
// of "Chrome for Testing"; de open-source Chromium van Playwright kan geen H.264 afspelen).
// Start zelf een tijdelijke server met lege database; raakt je eigen data niet aan.
// Optioneel: SHOTS_DIR=/map voor de schermafbeeldingen.
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
const SHOTS = process.env.SHOTS_DIR || path.join(S, 'shots');
for (const dir of [path.join(S, 'media'), SHOTS, path.join(S, 'downloads')]) fs.mkdirSync(dir, { recursive: true });
const setupToken = 'browsertest-installatiecode';
let BASE;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });

// Representatieve exports: 1080p H.264 High + AAC-LC stereo 48 kHz, 30 s.
function makeMp4(name, freq, { faststart = false, pattern = 'testsrc2', seconds = 30 } = {}) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `${pattern}=size=1920x1080:rate=25:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}:sample_rate=48000`, '-ac', '2',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-b:v', '6M',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', ...(faststart ? ['-movflags', '+faststart'] : []), path.join(S, 'media', name)]);
  return path.join(S, 'media', name);
}

async function playAndMeasure(page, label) {
  await page.click('.pc-bigplay');
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => {
    const v = document.querySelector('video');
    return { t: v.currentTime, audioBytes: v.webkitAudioDecodedByteCount, muted: v.muted, w: v.videoWidth, h: v.videoHeight, err: v.error?.code || null };
  });
  check(`${label}: video speelt af`, m.t > 1 && !m.err, `currentTime ${m.t.toFixed(2)}s, ${m.w}×${m.h}`);
  check(`${label}: audio (AAC) wordt gedecodeerd`, m.audioBytes > 0 && !m.muted, `${m.audioBytes} bytes audio`);
}

async function seekViaTimeline(page, fraction, label) {
  const box = await page.locator('.pc-track').boundingBox();
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
  await page.waitForTimeout(400);
  const t0 = await page.evaluate(() => document.querySelector('video').currentTime);
  await page.waitForTimeout(1500);
  const t1 = await page.evaluate(() => document.querySelector('video').currentTime);
  check(`${label}: vooruitspoelen via tijdlijn naar ${Math.round(fraction * 100)}%`, Math.abs(t0 - 30 * fraction) < 1.5 && t1 > t0 + 0.5, `sprong naar ${t0.toFixed(2)}s, speelt door tot ${t1.toFixed(2)}s`);
}

const pause = (page) => page.evaluate(() => document.querySelector('video').pause());
const seekTo = (page, t) => page.evaluate((x) => { document.querySelector('video').currentTime = x; }, t);
const linkInput = (page, kind) => page.inputValue(`.share-section${kind === 'approver' ? '.is-approver' : ':not(.is-approver)'} .link-url`);

async function chooseFiles(page, trigger, files) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles(files);
}

async function waitUploadsDone(page, n) {
  await page.waitForFunction((count) => document.querySelectorAll('.tray-item.is-done').length >= count, n, { timeout: 180_000 });
}

(async () => {
  console.log('Testvideo’s maken…');
  const v1 = makeMp4('klant_campagne_edit_v03.mp4', 1000);
  const v2 = makeMp4('klant_campagne_edit_v04.mp4', 660, { faststart: true });
  const teaser = makeMp4('teaser_15s_final.mp4', 440, { faststart: true, pattern: 'smptehdbars', seconds: 15 });
  const behind = makeMp4('bts_interview_cut2.mp4', 550, { faststart: true, pattern: 'testsrc', seconds: 12 });
  const server = createApp({ dataDir: path.join(S, 'data'), setupToken });
  const listener = await new Promise((r) => { const l = server.app.listen(0, () => r(l)); });
  BASE = `http://127.0.0.1:${listener.address().port}`;
  // Zonder UTF-8-locale weigert Chrome op Linux niet-ASCII-tekens in downloadnamen.
  const browser = await chromium.launch({ executablePath: CHROME, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  console.log('Browser:', browser.version());
  // Netwerkfouten die door de test zelf worden gesimuleerd (afgebroken thumbnails, offline) tellen niet als JS-fout.
  const errors = [];
  const watch = (p, label) => {
    p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/40[034]|410|net::ERR_(FAILED|INTERNET_DISCONNECTED)/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  };
  const noNullText = async (page, label) => {
    const text = await page.evaluate(() => document.body.innerText);
    check(`${label}: geen losse "null"/"undefined" in de pagina`, !/\bnull\b|\bundefined\b/.test(text));
  };

  // ---------- Team: leeg account ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  watch(page, 'team');
  await page.goto(`${BASE}/?setup=${setupToken}`);
  await page.fill('input[name=name]', 'Sanne de Vries');
  await page.fill('input[name=email]', 'sanne@agency.nl');
  await page.fill('input[name=password]', 'een-lang-wachtwoord');
  await page.click('button[type=submit]');
  await page.waitForSelector('.onboarding');
  check('leeg account: uitleg + één actie', (await page.locator('.onboarding button').count()) === 1);
  await noNullText(page, 'leeg account');
  await shot(page, '01-leeg-account');

  // ---------- Project maken en uploaden ----------
  await page.click('text=Eerste project aanmaken');
  await page.fill('dialog input[name=name]', 'Voorjaarscampagne 2026');
  await page.fill('dialog input[name=clientName]', 'Bakkerij Jansen');
  await page.click('dialog button:has-text("Project aanmaken")');
  await page.waitForSelector('.dropzone-big');
  await noNullText(page, 'leeg project');
  await shot(page, '02-leeg-project');

  await chooseFiles(page, () => page.click('.dropzone-big'), [v1, teaser]);
  await page.waitForSelector('.tray-item');
  check('uploadpaneel toont per bestand de voortgang', (await page.locator('.tray-item').count()) === 2);
  await waitUploadsDone(page, 2);
  check('beide uploads voltooid', true);
  await page.waitForFunction(() => document.querySelectorAll('.video-row').length === 2);
  const titles = await page.locator('.video-row-title').allTextContents();
  check('titels zonder bestandsextensie', titles.every((t) => !/\.mp4/i.test(t)), titles.join(' | '));

  // Inline titel aanpassen
  const row = page.locator('.video-row', { hasText: 'klant campagne edit v03' });
  await row.hover();
  await row.locator('button[aria-label^="Titel van"]').click();
  await page.fill('.inline-input', 'Campagnefilm — Hoofdvideo');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.video-row-title:has-text("Campagnefilm — Hoofdvideo")');
  check('titel inline aangepast', true);

  // Tweede project voor een gevuld overzicht
  await page.click('.side-nav a:has-text("Projecten")');
  await page.click('text=Nieuw project');
  await page.fill('dialog input[name=name]', 'Bedrijfsfilm Van Dijk Logistiek — behind the scenes en interviews');
  await page.fill('dialog input[name=clientName]', 'Van Dijk Logistiek');
  await page.click('dialog button:has-text("Project aanmaken")');
  await page.waitForSelector('.dropzone-big');
  await chooseFiles(page, () => page.click('text=Nieuwe video'), [behind]);
  await waitUploadsDone(page, 3);
  await page.click('.tray-item.is-done >> nth=0 >> button:has-text("Sluiten")').catch(() => {});

  // ---------- Video delen ----------
  await page.click('.side-nav a:has-text("Projecten")');
  await page.click('.project-card:has-text("Voorjaarscampagne")');
  await page.click('.video-row-title:has-text("Campagnefilm")');
  await page.waitForSelector('.publish-bar.is-concept');
  await page.click('.publish-bar button:has-text("Klaar voor review")');
  await page.waitForSelector('.publish-bar.is-ready_for_review');
  await page.click('.publish-bar button:has-text("Publiceren naar klant")');
  await page.click('dialog button:has-text("Publiceren")');
  await page.waitForSelector('.publish-bar.is-in_review');
  check('publiceren zet versie op In review', true);

  await page.click('.page-actions button:has-text("Delen")');
  await page.waitForSelector('dialog .share-section');
  check('deelvenster onderscheidt reviewlink en akkoordlink',
    (await page.textContent('dialog')).includes('Kan niet goedkeuren') && (await page.textContent('dialog')).includes('Alleen met deze link kan een versie worden goedgekeurd'));
  const reviewUrl = await linkInput(page, 'reviewer');
  await page.fill('dialog input[aria-label="Naam akkoordgever"]', 'Joris Jansen');
  await page.fill('dialog input[aria-label="E-mail akkoordgever"]', 'joris@bakkerijjansen.nl');
  await page.click('dialog button:has-text("Akkoordgever opslaan")');
  await page.waitForSelector('dialog button:has-text("Persoonlijke akkoordlink maken")');
  await page.click('dialog button:has-text("Persoonlijke akkoordlink maken")');
  await page.waitForSelector('dialog .share-section.is-approver .link-url');
  const approverUrl = await linkInput(page, 'approver');
  await shot(page, '06-deelvenster');
  await page.click('dialog button:has-text("Klaar")');

  // Download met juiste naam
  await page.click('button[aria-label="Meer acties"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.menu-item:has-text("Download")')]);
  check('download: oorspronkelijke uploadnaam (niet de titel)', dl.suggestedFilename() === 'klant_campagne_edit_v03.mp4', dl.suggestedFilename());

  // ---------- Klant (reviewer) op desktop ----------
  const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const client = await cctx.newPage();
  watch(client, 'klant');
  await client.goto(reviewUrl);
  await client.waitForSelector('.player');
  check('klant ziet titel, versie en status', (await client.textContent('.r-header')).includes('Campagnefilm — Hoofdvideo') && (await client.textContent('.version-chip')).includes('Versie 1'));
  check('klant kan niet goedkeuren', (await client.locator('button:has-text("Deze versie goedkeuren")').count()) === 0);
  await playAndMeasure(client, 'Desktop Chrome, MP4 zonder faststart');
  await seekViaTimeline(client, 0.5, 'Desktop Chrome');
  await pause(client);
  await client.click('.pc-btn[aria-label^="Volledig scherm"]');
  await client.waitForTimeout(400);
  check('volledig scherm', await client.evaluate(() => document.fullscreenElement?.classList.contains('player')));
  await client.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await client.waitForTimeout(300);

  await client.fill('#reviewer-name', 'Eva Bakker');
  await seekTo(client, 6.4);
  await client.waitForTimeout(400);
  await client.click('.composer textarea');
  check('invoerveld toont het videomoment', (await client.textContent('.composer-at')).includes('0:06'));
  await client.fill('.composer textarea', 'Kan het logo hier iets groter?');
  await client.click('.composer button[type=submit]');
  await client.waitForSelector('.comment:has-text("Kan het logo")');
  await seekTo(client, 15.2);
  await client.waitForTimeout(400);
  await client.click('.composer textarea');
  await client.fill('.composer textarea', 'Muziek mag hier wat zachter.');
  await client.click('.composer button[type=submit]');
  await client.waitForSelector('.comment:has-text("Muziek mag")');
  check('reacties tonen "Nog niet verstuurd"', (await client.locator('.comment-state.is-pending').count()) === 2);
  check('actiebalk telt onverstuurde reacties', (await client.textContent('.r-actions')).includes('Feedback versturen (2)'));
  await client.click('.comment:has-text("Kan het logo") .timecode');
  await client.waitForTimeout(300);
  check('klik op tijdcode springt naar moment', Math.abs((await client.evaluate(() => document.querySelector('video').currentTime)) - 6.4) < 0.1);
  await shot(client, '07-klant-review-desktop');

  // Team ziet status ongewijzigd na losse reacties
  await page.reload();
  await page.waitForSelector('.publish-bar');
  check('losse reacties veranderen de status niet', await page.isVisible('.publish-bar.is-in_review'));

  await client.click('.r-actions button:has-text("Feedback versturen")');
  await client.fill('dialog textarea', 'Verder mooi gemaakt!');
  await client.click('dialog button:has-text("Feedback versturen")');
  await client.waitForSelector('.r-status.is-changes');
  check('feedback versturen → bevestiging en status "Feedback verstuurd"', await client.isVisible('.notice-ok:has-text("Je feedback is verstuurd")'));
  check('reacties tonen "Verstuurd als feedback"', (await client.locator('.comment-state:has-text("Verstuurd als feedback")').count()) >= 2);

  // ---------- Team verwerkt ----------
  await page.reload();
  await page.waitForSelector('.publish-bar.is-changes_requested');
  check('team ziet Aanpassingen nodig + wie feedback stuurde', (await page.textContent('.publish-bar')).includes('Eva Bakker'));
  await page.click('.comment:has-text("Kan het logo") >> text=Beantwoorden');
  await page.fill('.reply-form textarea', 'Doen we in de volgende versie.');
  await page.click('.reply-form button[type=submit]');
  await page.waitForSelector('.comment-reply:has-text("Doen we")');
  await page.click('.comment:has-text("Kan het logo") >> button:has-text("Afhandelen")');
  await page.waitForSelector('.comment.is-resolved');
  check('afhandelen verandert de status niet', await page.isVisible('.publish-bar.is-changes_requested'));
  await noNullText(page, 'videowerkplek');
  await shot(page, '05-reviewwerkplek-team');

  // Nieuwe versie
  await page.click('button[aria-label="Meer acties"]');
  await page.click('.menu-item:has-text("Nieuwe versie uploaden")');
  await page.waitForSelector('dialog .facts');
  check('nieuwe-versievenster legt uit dat de versie intern blijft', (await page.textContent('dialog')).includes('Klanten blijven tot dan Versie 1 zien'));
  await chooseFiles(page, () => page.click('dialog .dropzone'), [v2]);
  await page.click('dialog button:has-text("Uploaden als Versie 2")');
  await page.waitForSelector('.publish-bar.is-concept', { timeout: 180_000 });
  check('versie 2 staat intern als Concept', (await page.textContent('.page-meta')).includes('Klant ziet: Versie 1'));

  await client.reload();
  await client.waitForSelector('.version-chip');
  check('klant ziet nog steeds Versie 1', (await client.textContent('.version-chip')).includes('Versie 1') && (await client.locator('.version-pick').count()) === 0);

  await page.click('.publish-bar button:has-text("Klaar voor review")');
  await page.waitForSelector('.publish-bar.is-ready_for_review');
  await page.click('.publish-bar button:has-text("Publiceren naar klant")');
  await page.click('dialog button:has-text("Publiceren")');
  await page.waitForSelector('.publish-bar.is-in_review');
  await client.reload();
  await client.waitForSelector('.version-chip');
  check('na publiceren ziet klant Versie 2 met dezelfde link', (await client.textContent('.version-chip')).includes('Versie 2'));
  check('versie 2 is niet goedgekeurd', await client.isVisible('.r-header .pill-in_review'));
  await client.selectOption('.version-pick select', { label: 'Versie 1' });
  await client.waitForSelector('.r-status.is-old');
  check('feedback op versie 1 blijft bewaard', (await client.locator('.comment').count()) >= 3);

  // ---------- Veel reacties: lijst scrolt, invoerveld blijft in beeld ----------
  await client.selectOption('.version-pick select', { label: 'Versie 2 · nieuwste' });
  await client.waitForSelector('.r-status.is-review');
  await client.evaluate(async (args) => {
    const key = localStorage.getItem('rt-reviewer-key');
    for (let i = 0; i < 24; i++) {
      await fetch(`/api/review/${args.token}/versions/${args.version}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'review-tool', 'x-reviewer-key': key },
        body: JSON.stringify({ body: `Opmerking ${i + 1}: ${'detail '.repeat(i % 5 + 1)}`, timecode: i, authorName: 'Eva Bakker', requestId: `bulk-${i}-${Date.now()}` }),
      });
    }
  }, { token: new URL(reviewUrl).pathname.split('/').pop(), version: await client.evaluate(() => document.querySelector('video').src.match(/versions\/(\d+)/)[1]) });
  await page.reload();
  await page.waitForSelector('.comment');
  const composerBox = await page.locator('.panel-composer').boundingBox();
  check('team: 24+ reacties, invoerveld blijft in beeld', composerBox && composerBox.y + composerBox.height <= 900, `onderkant op ${Math.round(composerBox?.y + composerBox?.height)}px`);
  check('team: reactielijst scrolt binnen het paneel', await page.evaluate(() => { const el = document.querySelector('.tabpanel-comments .panel-scroll'); return el.scrollHeight > el.clientHeight; }));
  await shot(page, '05b-werkplek-veel-reacties');

  // ---------- Akkoordgever op mobiel ----------
  const mctx = await browser.newContext({ ...devices['Pixel 7'] });
  const m = await mctx.newPage();
  watch(m, 'mobiel');
  await m.goto(approverUrl);
  await m.waitForSelector('.player');
  await m.tap('.pc-bigplay');
  await m.waitForTimeout(2500);
  const mm = await m.evaluate(() => { const v = document.querySelector('video'); return { t: v.currentTime, a: v.webkitAudioDecodedByteCount }; });
  check('mobiel (Pixel 7-emulatie): MP4 speelt af met audio', mm.t > 1 && mm.a > 0, `t=${mm.t.toFixed(2)}s`);
  await seekViaTimeline(m, 0.8, 'Mobiel');
  await pause(m);
  await m.tap('.composer textarea');
  await m.fill('.composer textarea', 'Eindshot is perfect.');
  await m.tap('.composer button[type=submit]');
  await m.waitForSelector('.comment:has-text("Eindshot") .badge-verified');
  check('mobiel: reactie als geverifieerde akkoordgever', true);
  await shot(m, '08-klant-mobiel');
  await m.tap('button:has-text("Deze versie goedkeuren")');
  await m.tap('dialog button:has-text("Ja, keur Versie 2 goed")');
  await m.waitForSelector('.r-status.is-approved');
  check('mobiel: Versie 2 goedgekeurd met bevestiging', await m.isVisible('.notice-ok:has-text("Versie 2 is goedgekeurd")'));
  await shot(m, '09-klant-mobiel-goedgekeurd');

  // ---------- Team: handmatige correctie ----------
  await page.reload();
  await page.waitForSelector('.publish-bar.is-approved');
  check('team ziet goedkeuring door Joris Jansen', (await page.textContent('.publish-bar')).includes('Joris Jansen'));
  await page.click('button[aria-label="Meer acties"]');
  check('correctieknop noemt de exacte versie', await page.isVisible('.menu-item:has-text("Status van Versie"):has-text("corrigeren")'));
  await page.click('.menu-item:has-text("Status van Versie 2 corrigeren")');
  await page.selectOption('dialog select', 'in_review');
  await page.click('dialog button:has-text("Status opslaan")');
  check('correctie zonder reden wordt geweigerd', await page.isVisible('dialog[open]'));
  await page.fill('dialog textarea', 'Klant wil eindtitel nog laten checken');
  await page.click('dialog button:has-text("Status opslaan")');
  await page.waitForSelector('.publish-bar.is-in_review');
  await page.click('#tab-info');
  check('correctie met reden in geschiedenis', (await page.textContent('.history')).includes('Reden: Klant wil eindtitel nog laten checken'));

  // ---------- Toegang intrekken ----------
  await page.click('.page-actions button:has-text("Delen")');
  await page.click('dialog .share-section:not(.is-approver) button[aria-label="Link intrekken"]');
  await page.click('dialog[open] >> nth=-1 >> button:has-text("Intrekken")');
  await page.waitForSelector('dialog summary:has-text("Ingetrokken links")');
  await page.click('dialog button:has-text("Klaar")');
  await client.goto(reviewUrl);
  await client.waitForSelector('.fatal');
  check('ingetrokken link geeft geen toegang meer', (await client.textContent('.fatal')).includes('ingetrokken'));
  await shot(client, '10-link-ingetrokken');

  // ---------- Overzichten met gegevens ----------
  await page.click('.side-nav a:has-text("Projecten")');
  await page.waitForSelector('.project-card');
  await noNullText(page, 'projectoverzicht');
  check('projectoverzicht toont thumbnails', (await page.locator('.project-cover img').count()) >= 2);
  await shot(page, '03-projectoverzicht');
  await page.fill('input[aria-label="Zoek projecten"]', 'van dijk');
  check('zoeken filtert projecten', (await page.locator('.project-card').count()) === 1);
  await page.fill('input[aria-label="Zoek projecten"]', '');
  await page.click('.project-card:has-text("Voorjaarscampagne")');
  await page.waitForSelector('.video-row');
  await shot(page, '04-project-gevuld');

  // Ontbrekende thumbnails: nette vervanging i.p.v. een kapot plaatje
  await page.route('**/poster', (r) => r.abort());
  await page.click('.side-nav a:has-text("Projecten")');
  await page.waitForSelector('.project-card');
  await page.waitForTimeout(300);
  check('ontbrekende thumbnail toont een vervangend vlak', (await page.locator('.project-cover .poster-empty').count()) >= 2);
  await page.unroute('**/poster');

  // Trage verbinding: laadstatus zichtbaar, daarna de inhoud
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: 50_000, uploadThroughput: 50_000 });
  await page.click('.project-card:has-text("Voorjaarscampagne")');
  check('trage verbinding: laadindicator zichtbaar', await page.isVisible('.loading-page .spinner'));
  await page.waitForSelector('.video-row', { timeout: 30_000 });
  check('trage verbinding: pagina laadt daarna volledig', true);
  // Server onbereikbaar: herstelbare foutmelding met knop
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.click('.side-nav a:has-text("Projecten")');
  await page.waitForSelector('.error-state');
  check('geen verbinding: foutmelding met "Opnieuw proberen"', await page.isVisible('.error-state button:has-text("Opnieuw proberen")'));
  await shot(page, '12-geen-verbinding');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.click('.error-state button:has-text("Opnieuw proberen")');
  await page.waitForSelector('.project-card');
  check('na herstel van de verbinding werkt "Opnieuw proberen"', true);

  const mteam = await (await browser.newContext({ ...devices['Pixel 7'], storageState: await ctx.storageState() })).newPage();
  watch(mteam, 'team-mobiel');
  await mteam.goto(`${BASE}/projecten`);
  await mteam.waitForSelector('.project-card');
  await shot(mteam, '11-team-mobiel-overzicht');

  check('geen JavaScript-fouten in de browser', errors.length === 0, errors.join(' | '));
  await browser.close();
  listener.close();
  server.stop();
  fs.writeFileSync(path.join(S, 'resultaten.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nSchermafbeeldingen: ${SHOTS}`);
  console.log(`${results.length - failed}/${results.length} controles geslaagd`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
