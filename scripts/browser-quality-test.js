// Browsertest bouwronde 5, fase D: echte kwaliteitskeuze met hls.js in Chrome (Linux), 4K-bron,
// lagere bron en staande video. Netwerk vertragen en weer versnellen (Chrome DevTools-protocol),
// handmatig wisselen met behoud van tijdcode, geluid, fragment en tekening, en controle dat het
// origineel nooit wordt opgevraagd als downloaden uit staat.
// Niet getest: Safari (macOS/iOS). Safari gebruikt zijn eigen HLS-ondersteuning; zie ACCEPTATIETEST.md.
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser:kwaliteit   (SHOTS_DIR=/map optioneel)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');
const { createApp } = require('../server/app');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Zet CHROME_PATH naar een Chrome met H.264-ondersteuning.'); process.exit(2); }
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-kwaliteit-'));
const SHOTS = process.env.SHOTS_DIR || path.join(S, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const shot = async (page, name, opts = {}) => {
  await page.evaluate(() => document.querySelectorAll('.toast-host > *').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};
const mp4 = (name, size, sec) => {
  const f = path.join(S, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=25:duration=${sec}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${sec}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]);
  return f;
};

(async () => {
  // Productie gebruikt preset "veryfast"; hier "ultrafast" om de test kort te houden (zelfde opbouw).
  const server = createApp({ dataDir: path.join(S, 'data'), backupDir: path.join(S, 'backups'), setupToken: 'kwaliteit-code-1234', minFreeBytes: 0, variantPreset: 'ultrafast', env: { ...process.env, STUDIO_REVIEW_HOME: path.join(S, 'home'), DATA_DIR: '' } });
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
  await apiT('POST', '/api/setup', { setupToken: 'kwaliteit-code-1234', email: 'sanne@agency.nl', name: 'Sanne de Vries', password: 'een-lang-wachtwoord' });
  const pId = (await apiT('POST', '/api/projects', { name: 'Kwaliteit' })).id;
  const t0 = Date.now();
  const uhd = await apiT('POST', `/api/projects/${pId}/videos`, { uploadId: await upload(mp4('uhd.mp4', '3840x2160', 40), { projectId: pId }), title: '4K-bron' });
  const hd = await apiT('POST', `/api/projects/${pId}/videos`, { uploadId: await upload(mp4('hd.mp4', '1280x720', 6), { projectId: pId }), title: '720p-bron' });
  const vert = await apiT('POST', `/api/projects/${pId}/videos`, { uploadId: await upload(mp4('staand.mp4', '1080x1920', 6), { projectId: pId }), title: 'Staand' });
  await server.variants.whenIdle();
  console.log(`     (afspeelversies gemaakt in ${Math.round((Date.now() - t0) / 1000)} s)`);
  for (const v of [uhd, hd, vert]) {
    await apiT('POST', `/api/versions/${v.versionId}/ready`);
    await apiT('POST', `/api/versions/${v.versionId}/share`, { round: 'new', requestId: `share-${v.versionId}-aaaaa` });
  }
  const linkOf = async (videoId) => (await apiT('GET', `/api/videos/${videoId}`)).links.find((l) => l.role === 'reviewer').url;

  // ---------- Klant: 4K-bron ----------
  const cctx = await browser.newContext(ctxOpts);
  const c = await cctx.newPage();
  watch(c, 'klant');
  const requested = [];
  c.on('request', (r) => requested.push(r.url()));
  await c.goto(await linkOf(uhd.videoId));
  await c.waitForSelector('.pc-quality:not([hidden])');
  await c.click('.pc-quality');
  const opts = await c.$$eval('.pc-quality-item', (els) => els.map((e) => e.childNodes[1].textContent));
  check('tandwielmenu 4K-bron: Auto, 4K, 1440p, 1080p, 720p', JSON.stringify(opts) === JSON.stringify(['Auto', '4K', '1440p', '1080p', '720p']), opts.join(', '));
  await shot(c, '90-kwaliteit-menu');
  await c.keyboard.press('Escape');
  check('menu sluit met Escape en focus terug op de knop', await c.isHidden('.pc-quality-menu') && await c.evaluate(() => document.activeElement.classList.contains('pc-quality')));
  await c.click('.pc-bigplay');
  await c.waitForFunction(() => document.querySelector('.player video').currentTime > 2, null, { timeout: 30000 });
  const auto = await c.evaluate(() => ({ h: document.querySelector('.player video').videoHeight, label: document.querySelector('.pc-quality-label').textContent }));
  check('Auto (snelle verbinding): hoogste kwaliteit en het label toont wat er echt speelt', auto.h === 2160 && /Auto · 4K/.test(auto.label), JSON.stringify(auto));

  // Vertragen: Auto moet omlaag
  const cdp = await cctx.newCDPSession(c);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (2.5 * 1e6) / 8, uploadThroughput: (2 * 1e6) / 8 });
  const down = await c.waitForFunction(() => document.querySelector('.player video').videoHeight <= 1080, null, { timeout: 60000 }).then(() => true).catch(() => false);
  const downH = await c.evaluate(() => document.querySelector('.player video').videoHeight);
  check('trage verbinding (2,5 Mbit/s): Auto schakelt zelf terug', down, `nu ${downH}p`);
  // Opnieuw vooraan beginnen (de video kan tijdens de trage fase al zijn afgelopen).
  await c.evaluate(() => { const v = document.querySelector('.player video'); v.currentTime = 1; return v.play(); });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const up = await c.waitForFunction((h) => document.querySelector('.player video').videoHeight > h, downH, { timeout: 60000 }).then(() => true).catch(() => false);
  check('verbinding weer snel: Auto gaat weer omhoog', up, `nu ${await c.evaluate(() => document.querySelector('.player video').videoHeight)}p`);

  // Handmatig kiezen tijdens afspelen: geen sprong in de tijd, geluid speelt door
  await c.evaluate(() => { const v = document.querySelector('.player video'); v.currentTime = 3; return v.play(); });
  await c.waitForFunction(() => { const v = document.querySelector('.player video'); return !v.paused && v.currentTime > 4; }, null, { timeout: 30000 });
  const beforeSwitch = await c.evaluate(() => { const v = document.querySelector('.player video'); return { t: v.currentTime, wall: performance.now(), audio: v.webkitAudioDecodedByteCount }; });
  await c.click('.pc-quality');
  await c.click('.pc-quality-item:has-text("720p")');
  await c.waitForFunction(() => document.querySelector('.player video').videoHeight === 720, null, { timeout: 30000 });
  const afterSwitch = await c.evaluate(() => { const v = document.querySelector('.player video'); return { t: v.currentTime, wall: performance.now(), audio: v.webkitAudioDecodedByteCount, paused: v.paused, muted: v.muted }; });
  const drift = Math.abs((afterSwitch.t - beforeSwitch.t) - (afterSwitch.wall - beforeSwitch.wall) / 1000);
  check('handmatig 720p: tijdcode loopt door zonder sprong', drift < 1.5 && !afterSwitch.paused, `afwijking ${drift.toFixed(2)} s`);
  check('geluid speelt door na wisselen', afterSwitch.audio > beforeSwitch.audio && !afterSwitch.muted, `${beforeSwitch.audio} → ${afterSwitch.audio} bytes`);
  check('label toont de vaste keuze', (await c.textContent('.pc-quality-label')) === '720p');
  await c.waitForTimeout(6000);
  check('vaste keuze blijft staan (geen automatische terugval)', await c.evaluate(() => document.querySelector('.player video').videoHeight) === 720);

  // Tekening en fragment behouden bij wisselen
  await c.fill('#reviewer-name', 'Eva');
  await c.evaluate(() => document.querySelector('.player video').pause());
  const tk = server.db.prepare('SELECT token FROM share_links WHERE video_id = ? AND role = ?').get(uhd.videoId, 'reviewer').token;
  await c.request.post(`${BASE}/api/review/${tk}/versions/${uhd.versionId}/comments`, { headers: { ...H, 'x-reviewer-key': await c.evaluate(() => localStorage.getItem('rt-reviewer-key')) }, data: { body: 'Kader hier', timecode: 4, timecodeEnd: 7, authorName: 'Eva', requestId: 'tekening-aaaaaaaa', annotation: { v: 1, shapes: [{ t: 'rect', c: '#ff4d4f', a: [0.2, 0.2], b: [0.6, 0.6] }] } } });
  await c.reload();
  await c.waitForSelector('.pc-marker');
  await c.click('.comment .comment-drawing');
  await c.waitForSelector('.pc-overlay:not([hidden]) svg');
  const rect1 = await c.evaluate(() => { const r = document.querySelector('.pc-overlay').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); });
  await c.click('.pc-quality');
  await c.click('.pc-quality-item:has-text("1080p")');
  await c.waitForFunction(() => document.querySelector('.player video').videoHeight === 1080, null, { timeout: 30000 }).catch(() => {});
  const rect2 = await c.evaluate(() => { const r = document.querySelector('.pc-overlay').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); });
  check('tekening blijft zichtbaar op dezelfde plek na wisselen', await c.isVisible('.pc-overlay svg') && JSON.stringify(rect1) === JSON.stringify(rect2), `${rect1} / ${rect2}`);
  await c.click('.comment button:has-text("Fragment afspelen")');
  await c.waitForTimeout(1200);
  await c.click('.pc-quality');
  await c.click('.pc-quality-item:has-text("720p")');
  await c.waitForFunction(() => document.querySelector('.player video').paused, null, { timeout: 15000 }).catch(() => {});
  const endT = await c.evaluate(() => document.querySelector('.player video').currentTime);
  check('fragment (4–7 s) stopt na wisselen nog steeds aan het eind', Math.abs(endT - 7) < 0.4, `stopte op ${endT.toFixed(2)} s`);
  await shot(c, '91-kwaliteit-720-met-tekening');

  // Geen origineel, geen downloadknop, geen contextmenu
  check('zonder downloadrecht: het origineel is nooit opgevraagd', !requested.some((u) => /\/media(\?|$)/.test(u)), requested.filter((u) => /media/.test(u)).join(', '));
  check('geen downloadknop zonder downloadrecht', !(await c.isVisible('a:has-text("Download")')));
  const ctxPrevented = await c.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.querySelector('.player video').dispatchEvent(e); return e.defaultPrevented; });
  check('contextmenu op de video uitgeschakeld (geen “Video opslaan als”)', ctxPrevented);
  const direct = await c.evaluate(async (u) => (await fetch(u)).status, `/api/review/${tk}/versions/${uhd.versionId}/media`);
  check('direct opvragen van het origineel: geweigerd (403)', direct === 403, String(direct));

  // ---------- Lagere en staande bron ----------
  await c.goto(await linkOf(hd.videoId));
  await c.waitForSelector('.pc-quality:not([hidden])');
  await c.click('.pc-quality');
  const hdOpts = await c.$$eval('.pc-quality-item', (els) => els.map((e) => e.childNodes[1].textContent));
  check('720p-bron: alleen Auto en 720p (niet opgeschaald)', JSON.stringify(hdOpts) === JSON.stringify(['Auto', '720p']), hdOpts.join(', '));
  await c.goto(await linkOf(vert.videoId));
  await c.waitForSelector('.pc-quality:not([hidden])');
  await c.click('.pc-quality');
  const vOpts = await c.$$eval('.pc-quality-item', (els) => els.map((e) => `${e.childNodes[1].textContent} ${e.querySelector('.pc-quality-sub')?.textContent || ''}`.trim()));
  check('staande video: 1080p (1080×1920) en 720p (720×1280)', JSON.stringify(vOpts) === JSON.stringify(['Auto hoogste die je verbinding aankan', '1080p 1080×1920', '720p 720×1280']), vOpts.join(' | '));
  await c.keyboard.press('Escape');
  await c.click('.pc-bigplay');
  await c.waitForFunction(() => document.querySelector('.player video').videoWidth > 0, null, { timeout: 20000 });
  const vdim = await c.evaluate(() => { const v = document.querySelector('.player video'); return [v.videoWidth, v.videoHeight]; });
  check('staand beeld blijft staand', vdim[1] > vdim[0], vdim.join('×'));

  // ---------- Engels ----------
  await c.click('.lang-toggle button[lang=en]');
  await c.click('.pc-quality');
  check('kwaliteitsmenu in het Engels', /Quality/.test(await c.textContent('.pc-quality-menu')) && /highest your connection can handle/.test(await c.textContent('.pc-quality-menu')));

  // ---------- Team ----------
  await page.goto(`${BASE}/video/${uhd.videoId}?tab=info`);
  await page.waitForSelector('.pb-status');
  check('teamwerkplek: afspeelversies en ruimte zichtbaar in Info', /4K, 1440p, 1080p, 720p/.test(await page.textContent('.pb-status')) && /MB|GB/.test(await page.textContent('.pb-status')));
  await page.click('.pc-quality');
  check('team: zelfde kwaliteitsmenu', (await page.$$('.pc-quality-item')).length === 5);
  await shot(page, '92-team-afspeelversies');

  // ---------- Mobiel (Pixel 7-emulatie) ----------
  const mctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' });
  const m = await mctx.newPage();
  watch(m, 'mobiel');
  await m.goto(await linkOf(uhd.videoId));
  await m.waitForSelector('.pc-quality:not([hidden])');
  await m.click('.pc-quality');
  const inView = await m.evaluate(() => { const r = document.querySelector('.pc-quality-menu').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0; });
  check('mobiel: kwaliteitsmenu past in beeld', inView);
  await shot(m, '93-mobiel-kwaliteit');

  check('geen JavaScript-fouten', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  listener.close();
  server.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} controles geslaagd. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
