// Browsertest bouwronde 3: feedbacktaken, reviewrondes, annotaties, tijdsbereiken, versies vergelijken
// en export, op desktop en in een mobiele weergave (Pixel 7-emulatie), met echte H.264/AAC-MP4's.
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser:feedback   (SHOTS_DIR=/map optioneel)
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
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-feedbacktest-'));
const SHOTS = process.env.SHOTS_DIR || path.join(S, 'shots');
for (const d of [SHOTS, path.join(S, 'media'), path.join(S, 'downloads')]) fs.mkdirSync(d, { recursive: true });
const ONLY = process.env.ONLY || 'ABC'; // delen: A = taken/rondes, B = annotaties/bereik/vergelijken, C = export
const setupToken = 'feedbacktest-installatiecode';
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const shot = async (page, name, opts = {}) => {
  await page.evaluate(() => document.querySelectorAll('.toast-host > *').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};

function mp4(name, { size = '1920x1080', seconds = 12, freq = 440, pattern = 'testsrc2' } = {}) {
  const file = path.join(S, 'media', name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `${pattern}=size=${size}:rate=25:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}:sample_rate=48000`, '-ac', '2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', file]);
  return file;
}

(async () => {
  console.log('Testvideo’s maken…');
  const files = {
    v1: mp4('campagne_v1.mp4', { seconds: 20, freq: 500 }),
    v2: mp4('campagne_v2.mp4', { seconds: 16, freq: 660, pattern: 'smptehdbars' }),
    v3: mp4('campagne_v3.mp4', { seconds: 18, freq: 330 }),
    social: mp4('social_9x16.mp4', { size: '1080x1920', seconds: 10, freq: 550 }),
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

  // ---------- Team: beheerder ----------
  const team = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, timezoneId: 'Europe/Amsterdam', locale: 'nl-NL' });
  const page = await team.newPage();
  watch(page, 'team');
  const apiT = async (method, url, data, p = page) => {
    const r = await p.request.fetch(`${BASE}${url}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  async function uploadVia(p, file, target) {
    const buf = fs.readFileSync(file);
    const up = await apiT('POST', '/api/uploads', { filename: path.basename(file), size: buf.length, ...target }, p);
    for (let o = 0; o < buf.length; o += up.chunkSize) await p.request.put(`${BASE}/api/uploads/${up.id}?offset=${o}`, { headers: { ...H, 'content-type': 'application/octet-stream' }, data: buf.subarray(o, o + up.chunkSize) });
    return up.id;
  }
  await page.goto(`${BASE}/?setup=${setupToken}`);
  await page.fill('input[name=name]', 'Sanne de Vries');
  await page.fill('input[name=email]', 'sanne@agency.nl');
  await page.fill('input[name=password]', 'een-lang-wachtwoord');
  await page.click('button[type=submit]');
  await page.waitForSelector('.onboarding');
  const editor = await apiT('POST', '/api/users', { name: 'Edith Editor', email: 'edith@agency.nl', password: 'een-lang-wachtwoord', role: 'member' });

  // Project met afgesproken rondes (via het venster)
  await page.click('text=Eerste project aanmaken');
  await page.fill('dialog input[name=name]', 'Voorjaarscampagne 2026');
  await page.fill('dialog input[name=clientName]', 'Bakkerij Jansen');
  await page.fill('dialog input[type=number]', '2');
  await page.click('dialog button:has-text("Project aanmaken")');
  await page.waitForSelector('.dropzone-big');
  const projectId = Number(page.url().match(/projecten\/(\d+)/)[1]);
  await apiT('PUT', `/api/users/${editor.id}/projects`, { projects: [{ projectId, level: 'upload' }] });
  const main = await apiT('POST', `/api/projects/${projectId}/videos`, { uploadId: await uploadVia(page, files.v1, { projectId }), title: 'Campagnefilm — Hoofdvideo' });
  const social = await apiT('POST', `/api/projects/${projectId}/videos`, { uploadId: await uploadVia(page, files.social, { projectId }), title: 'Social reel 9:16' });
  await apiT('PATCH', `/api/videos/${social.videoId}`, { kind: 'social' });

  // Publiceren via het venster: ronde 1 met deadline en toelichting
  async function publishUi(videoId, { round, changeNote, deadlineDate, roundNote, expectWarn } = {}) {
    await page.goto(`${BASE}/video/${videoId}`);
    await page.waitForSelector('.publish-bar');
    const ready = page.locator('.publish-bar button:has-text("Klaar voor review")');
    if (await ready.count()) { await ready.click(); await page.waitForSelector('.publish-bar button:has-text("Publiceren naar klant")'); }
    await page.click('.publish-bar button:has-text("Publiceren naar klant")');
    await page.waitForSelector('dialog .round-choice');
    if (round) await page.check(`dialog .round-option:has-text("${round}") input`);
    if (deadlineDate) { await page.fill('dialog .deadline-fields input[type=date]', deadlineDate); await page.fill('dialog .deadline-fields input[type=time]', '17:00'); }
    if (roundNote) await page.fill('dialog .round-new-fields textarea', roundNote);
    if (changeNote) await page.fill('dialog textarea[placeholder^="Bijv. “Logo"], dialog textarea[placeholder^="Optioneel"]', changeNote);
    const warnShown = await page.isVisible('dialog .notice-warn:has-text("afgesproken")');
    if (expectWarn !== undefined) check(`publiceren: waarschuwing bij overschrijden afgesproken rondes ${expectWarn ? 'zichtbaar' : 'niet nodig'}`, warnShown === expectWarn);
    if (expectWarn) await shot(page, '60-publiceren-ronde-boven-afspraak');
    await page.click('dialog button:has-text("Publiceren")');
    await page.waitForSelector('.publish-bar.is-in_review');
  }

  if (ONLY.includes('A')) {
    await publishUi(main.videoId, { round: 'Ronde 1 starten', deadlineDate: '2026-11-10', roundNote: 'Let vooral op de eindtitel.' });
    await page.click('#tab-rounds');
    const roundsText = await page.textContent('#tabpanel-rounds');
    check('rondes: ronde 1 met deadline en tijdzone (per video bijgehouden)', /Ronde 1/.test(roundsText) && /10 nov 2026.*17:00.*(CET|GMT\+1)/.test(roundsText) && /per video/.test(roundsText), roundsText.slice(0, 160));
    await shot(page, '61-rondes-tab');

    // ---------- Klant geeft feedback ----------
    const reviewUrl = (await apiT('GET', `/api/videos/${main.videoId}`)).links.find((l) => l.role === 'reviewer').url.replace(/^https?:\/\/[^/]+/, BASE);
    const clientCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Amsterdam', locale: 'nl-NL' });
    const cp = await clientCtx.newPage();
    watch(cp, 'klant');
    await cp.goto(reviewUrl);
    await cp.waitForSelector('.r-round');
    check('klant: reviewronde, deadline en toelichting zichtbaar', /Reviewronde 1/.test(await cp.textContent('.r-round')) && /Let vooral op de eindtitel/.test(await cp.textContent('.r-round')));
    await cp.fill('#reviewer-name', 'Eva Jansen');
    for (const [t, body] of [[2, 'Logo in de eindtitel graag groter'], [9, 'Muziek mag zachter']]) {
      await cp.evaluate((x) => { const v = document.querySelector('video'); v.pause(); v.currentTime = x; }, t);
      await cp.waitForTimeout(300);
      await cp.fill('.composer textarea', body);
      await cp.click('.composer button[type=submit]');
      await cp.waitForSelector(`.comment:has-text("${body}")`);
    }
    await cp.click('.r-actions button:has-text("Feedback versturen")');
    await cp.click('dialog button:has-text("Feedback versturen")');
    await cp.waitForSelector('.notice-ok:has-text("Je feedback is verstuurd")');

    // ---------- Team: taak maken, ook na een verbindingsfout ----------
    await page.goto(`${BASE}/video/${main.videoId}`);
    await page.waitForSelector('.comment:has-text("Logo in de eindtitel")');
    await page.click('.comment:has-text("Logo in de eindtitel") button:has-text("Taak maken")');
    await page.waitForSelector('dialog .task-quote');
    await page.selectOption('dialog select[aria-label="Verantwoordelijke"]', { label: 'Edith Editor' });
    await page.selectOption('dialog select[aria-label="Prioriteit"]', 'high');
    await page.fill('dialog input[type=date]', '2026-11-05');
    await page.fill('dialog textarea', 'Nieuw logo staat in de map Assets/2026');
    let failOnce = true;
    await page.route('**/api/comments/*/task', (route) => { if (failOnce) { failOnce = false; return route.abort(); } return route.continue(); });
    await page.click('dialog button:has-text("Taak maken")');
    await page.waitForSelector('dialog .form-error:not([hidden])');
    check('taak: verbindingsfout → melding, invoer blijft staan', (await page.inputValue('dialog textarea')) === 'Nieuw logo staat in de map Assets/2026');
    await page.click('dialog button:has-text("Taak maken")');
    await page.waitForSelector('.comment:has-text("Logo in de eindtitel") .task-chip');
    await page.unroute('**/api/comments/*/task');
    const taskCount = server.db.prepare('SELECT COUNT(*) AS n FROM comment_tasks').get().n;
    check('taak: opnieuw proberen maakt geen dubbele taak', taskCount === 1, `${taskCount} taak/taken`);
    check('taak: chip met verantwoordelijke, prioriteit en deadline', /Open\s*·\s*Edith Editor\s*·\s*Hoge prioriteit\s*·\s*uiterlijk/.test(await page.textContent('.comment:has-text("Logo in de eindtitel") .task-chip')));
    await shot(page, '62-werkplek-taak');

    // Overzicht met filters
    await page.goto(`${BASE}/projecten/${projectId}/feedback`);
    await page.waitForSelector('.fb-row');
    check('overzicht: beide klantreacties open, één met taak', (await page.locator('.fb-row').count()) === 2 && (await page.locator('.fb-row .task-chip').count()) === 1);
    await page.selectOption('select[aria-label="Verantwoordelijke"]', { label: 'Edith Editor' });
    await page.waitForFunction(() => document.querySelectorAll('.fb-row').length === 1);
    check('overzicht: filter op verantwoordelijke', /Logo in de eindtitel/.test(await page.textContent('.fb-list')));
    await page.selectOption('select[aria-label="Verantwoordelijke"]', '');
    await page.waitForFunction(() => document.querySelectorAll('.fb-row').length === 2);
    await shot(page, '63-feedback-overzicht', { fullPage: true });

    // Edith: Mijn taken → bezig → afgehandeld
    const edCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ep = await edCtx.newPage();
    watch(ep, 'edith');
    await ep.goto(`${BASE}/login`);
    await ep.fill('input[name=email]', 'edith@agency.nl');
    await ep.fill('input[name=password]', 'een-lang-wachtwoord');
    await ep.click('button[type=submit]');
    await ep.waitForSelector('#my-task-count:not([hidden])');
    check('Mijn taken: teller in de zijbalk', (await ep.textContent('#my-task-count')) === '1');
    await ep.click('.side-nav a:has-text("Mijn taken")');
    await ep.waitForSelector('.fb-row');
    await shot(ep, '64-mijn-taken');
    await ep.click('.fb-row button:has-text("Bezig")');
    await ep.waitForSelector('.fb-row .task-chip.is-in_progress');
    await ep.click('.fb-row button:has-text("Afgehandeld")');
    await ep.waitForSelector('.empty-title:has-text("Geen taken voor jou")');
    const st = server.db.prepare('SELECT c.resolved_at, t.status, v.status AS vs FROM comment_tasks t JOIN comments c ON c.id = t.comment_id JOIN versions v ON v.id = c.version_id').get();
    check('afgehandeld: taak én reactie afgehandeld; videostatus ongewijzigd', st.status === 'done' && !!st.resolved_at && st.vs === 'changes_requested', JSON.stringify(st));
    await page.goto(`${BASE}/video/${main.videoId}`);
    await page.waitForSelector('.comment:has-text("Logo in de eindtitel")');
    const card = await page.textContent('.comment:has-text("Logo in de eindtitel")');
    check('werkplek: één consistente status (taak afgehandeld, niet “open”)', /Afgehandeld/.test(card) && !/Open ·/.test(card) && /Heropenen/.test(card));

    // Rondes: v2 in nieuwe ronde (2 van 2), v3 → waarschuwing
    const v2 = await apiT('POST', `/api/videos/${main.videoId}/versions`, { uploadId: await uploadVia(page, files.v2, { videoId: main.videoId }) });
    await publishUi(main.videoId, { round: 'Ronde 2 starten', changeNote: 'Logo in de eindtitel vergroot.\nMuziek vanaf 0:09 zachter.', expectWarn: false });
    const v3 = await apiT('POST', `/api/videos/${main.videoId}/versions`, { uploadId: await uploadVia(page, files.v3, { videoId: main.videoId }) });
    await publishUi(main.videoId, { round: 'Ronde 3 starten', changeNote: 'Kleurcorrectie in de laatste scène.', expectWarn: true });
    check('werkplek: ronde boven afspraak zichtbaar in de kop', /Ronde 3.*2 afgesproken per video.*1 meer dan afgesproken/s.test(await page.textContent('.round-meta')));
    await cp.goto(reviewUrl);
    await cp.waitForSelector('.r-change');
    check('klant: “Aangepast in versie 3” bij de juiste versie', /Aangepast in versie 3[\s\S]*Kleurcorrectie/.test(await cp.textContent('.r-round')));
    await cp.selectOption('.version-pick select', { label: 'Versie 2' });
    await cp.waitForFunction(() => /Aangepast in versie 2/.test(document.querySelector('.r-round')?.textContent || ''));
    check('klant: toelichting van versie 2 bij versie 2', /Muziek vanaf 0:09 zachter/.test(await cp.textContent('.r-round')));
    await shot(cp, '65-klant-ronde-en-wijzigingen');
    check('rondes: precies 3 rondes, geen extra door uploads of reacties', server.db.prepare('SELECT COUNT(*) AS n FROM review_rounds WHERE video_id = ?').get(main.videoId).n === 3);
    void v2; void v3;

    // Toegang ingetrokken: taak losgekoppeld met toelichting
    await apiT('PUT', `/api/users/${editor.id}/projects`, { projects: [] });
    await page.goto(`${BASE}/projecten/${projectId}/feedback?status=all&wie=none`);
    await page.waitForSelector('.fb-row');
    await page.click('.fb-row:has-text("Logo in de eindtitel") a:has-text("Openen")');
    await page.waitForSelector('.comment.is-active');
    await page.click('.comment.is-active button:has-text("Taak")');
    await page.waitForSelector('dialog .notice-warn');
    check('toegang ingetrokken: taak niet meer toegewezen, met uitleg', /Edith Editor heeft geen toegang meer tot dit project/.test(await page.textContent('dialog .notice-warn')));
    await page.keyboard.press('Escape');
    await ep.goto(`${BASE}/taken`);
    await ep.waitForSelector('.empty-title');
    check('toegang ingetrokken: niets meer in Mijn taken van Edith', true);
    await clientCtx.close();
    await edCtx.close();
  }

  if (ONLY.includes('B')) {
    // Zorg voor gepubliceerde versies (ook als deel A niet is gedraaid).
    let mv = await apiT('GET', `/api/videos/${main.videoId}`);
    if (!mv.versions.some((v) => v.sharedAt)) {
      await apiT('POST', `/api/versions/${main.versionId}/ready`);
      await apiT('POST', `/api/versions/${main.versionId}/share`, { round: 'new' });
      const v2 = await apiT('POST', `/api/videos/${main.videoId}/versions`, { uploadId: await uploadVia(page, files.v2, { videoId: main.videoId }) });
      await apiT('POST', `/api/versions/${v2.versionId}/ready`);
      await apiT('POST', `/api/versions/${v2.versionId}/share`, { round: 'new' });
      mv = await apiT('GET', `/api/videos/${main.videoId}`);
    }
    const latestId = mv.versions[0].id;

    // ---------- Tekenen in de werkplek ----------
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/video/${main.videoId}`);
    await page.waitForSelector('.composer');
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
    await page.evaluate(() => { document.querySelector('video').currentTime = 5; });
    await page.waitForTimeout(400);
    await page.click('.composer-visibility button:has-text("Zichtbaar voor klant")');
    await page.click('.composer-tool:has-text("Tekenen")');
    await page.waitForSelector('.pc-overlay.is-editing');
    const box = await page.locator('.pc-overlay').boundingBox();
    const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
    const drag = async (from, to, steps = 8) => { await page.mouse.move(...at(...from)); await page.mouse.down(); await page.mouse.move(...at(...to), { steps }); await page.mouse.up(); };
    await page.click('.ann-btn[aria-label="Rechthoek"]');
    await drag([0.25, 0.25], [0.6, 0.55]);
    await page.click('.ann-btn[aria-label="Pijl"]');
    await page.click('.ann-color[aria-label="Kleur geel"]');
    await drag([0.85, 0.85], [0.62, 0.57]);
    await page.click('.ann-btn[aria-label="Pen"]');
    await page.mouse.move(...at(0.1, 0.8)); await page.mouse.down();
    for (const [x, y] of [[0.15, 0.75], [0.2, 0.82], [0.25, 0.74], [0.3, 0.8]]) await page.mouse.move(...at(x, y), { steps: 4 });
    await page.mouse.up();
    await page.click('.ann-btn[aria-label="Pen"]');
    await drag([0.4, 0.1], [0.45, 0.12]);
    await page.click('.ann-btn[aria-label="Laatste vorm ongedaan maken"]');
    check('tekenen: pen, pijl, rechthoek; ongedaan maken', (await page.locator('.pc-overlay .pc-shapes > *').count()) === 4, `${await page.locator('.pc-overlay .pc-shapes > *').count()} elementen`);
    await page.fill('.composer textarea', 'Logo hier groter, zie de tekening');
    await shot(page, '66-tekenen-werkplek');
    await page.click('.composer button[type=submit]');
    await page.waitForSelector('.comment:has-text("Logo hier groter") .comment-drawing');
    const stored = JSON.parse(server.db.prepare("SELECT annotation FROM comments WHERE body LIKE 'Logo hier groter%'").get().annotation);
    const rect = stored.shapes.find((x) => x.t === 'rect');
    const near = (p, q) => Math.abs(p[0] - q[0]) < 0.012 && Math.abs(p[1] - q[1]) < 0.012;
    check('tekening opgeslagen relatief aan het beeld', near(rect.a, [0.25, 0.25]) && near(rect.b, [0.6, 0.55]) && stored.shapes.length === 3, JSON.stringify(rect));

    // Zelfde tekening op andere schermgroottes en in volledig scherm
    async function measure(label, { click = true } = {}) {
      if (click) await page.click('.comment:has-text("Logo hier groter") .comment-drawing');
      await page.waitForSelector('.pc-overlay:not([hidden]) .pc-shapes rect');
      const m = await page.evaluate(() => {
        const o = document.querySelector('.pc-overlay').getBoundingClientRect();
        const r = document.querySelector('.pc-overlay .pc-shapes rect').getBoundingClientRect();
        const v = document.querySelector('video');
        const vb = v.getBoundingClientRect();
        return { a: [(r.left - o.left) / o.width, (r.top - o.top) / o.height], b: [(r.right - o.left) / o.width, (r.bottom - o.top) / o.height],
          ratio: o.width / o.height, videoRatio: v.videoWidth / v.videoHeight, box: [vb.width, vb.height], overlay: [o.width, o.height] };
      });
      // Lijndikte telt mee in de begrenzing; daarom een kleine marge.
      const ok = near(m.a, [0.25, 0.25]) && near(m.b, [0.6, 0.55]) && Math.abs(m.ratio - m.videoRatio) < 0.02;
      check(`zelfde tekening op dezelfde plek: ${label}`, ok, `rect ${m.a.map((x) => x.toFixed(3))}–${m.b.map((x) => x.toFixed(3))}, beeld ${m.overlay.map(Math.round).join('×')} in vak ${m.box.map(Math.round).join('×')}`);
    }
    await measure('1440×900');
    await page.setViewportSize({ width: 1100, height: 800 });
    await measure('1100×800');
    await page.setViewportSize({ width: 820, height: 1100 });
    await measure('820×1100 (smal venster)');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('.comment:has-text("Logo hier groter") .comment-drawing');
    await page.click('.pc-btn[aria-label^="Volledig scherm"]');
    await page.waitForFunction(() => document.fullscreenElement);
    await page.waitForTimeout(400);
    await measure('volledig scherm (zwarte randen boven en onder)', { click: false });
    await shot(page, '67-tekening-volledig-scherm');
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
    await page.waitForTimeout(300);

    // Verticale video: beeld met zwarte randen links en rechts
    let sv = await apiT('GET', `/api/videos/${social.videoId}`);
    if (!sv.versions[0].sharedAt) { await apiT('POST', `/api/versions/${social.versionId}/ready`); await apiT('POST', `/api/versions/${social.versionId}/share`, { round: 'new' }); sv = await apiT('GET', `/api/videos/${social.videoId}`); }
    await page.goto(`${BASE}/video/${social.videoId}`);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
    await page.click('.composer-tool:has-text("Tekenen")');
    const vbox = await page.locator('.pc-overlay').boundingBox();
    const stageBox = await page.locator('.player-stage').boundingBox();
    check('verticale video: tekenvlak = beeld (zonder zwarte randen)', Math.abs(vbox.width / vbox.height - 9 / 16) < 0.02 && vbox.x > stageBox.x + 20, `${Math.round(vbox.width)}×${Math.round(vbox.height)} in ${Math.round(stageBox.width)}×${Math.round(stageBox.height)}`);
    await page.click('.ann-btn[aria-label="Rechthoek"]');
    await page.mouse.move(vbox.x + vbox.width * 0.1, vbox.y + vbox.height * 0.7); await page.mouse.down();
    await page.mouse.move(vbox.x + vbox.width * 0.9, vbox.y + vbox.height * 0.85, { steps: 6 }); await page.mouse.up();
    await page.fill('.composer textarea', 'Ondertitel valt weg achter de Instagram-knoppen');
    await page.click('.composer-visibility button:has-text("Zichtbaar voor klant")');
    await page.click('.composer button[type=submit]');
    await page.waitForSelector('.comment:has-text("Ondertitel valt weg")');
    const vr = JSON.parse(server.db.prepare("SELECT annotation FROM comments WHERE body LIKE 'Ondertitel valt weg%'").get().annotation).shapes[0];
    check('verticale video: coördinaten relatief aan het staande beeld', near(vr.a, [0.1, 0.7]) && near(vr.b, [0.9, 0.85]), JSON.stringify(vr));
    await page.click('.comment:has-text("Ondertitel valt weg") .comment-drawing');
    await shot(page, '68-tekening-verticaal');

    // ---------- Klant: tekening zien, tijdsbereik maken en fragment afspelen ----------
    const reviewUrl = mv.links.find((l) => l.role === 'reviewer').url.replace(/^https?:\/\/[^/]+/, BASE);
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const cp = await c2.newPage();
    watch(cp, 'klant-B');
    await cp.goto(reviewUrl);
    await cp.waitForSelector('.comment:has-text("Logo hier groter")');
    await cp.click('.comment:has-text("Logo hier groter") .comment-drawing');
    await cp.waitForSelector('.pc-overlay:not([hidden]) .pc-shapes rect');
    check('klant ziet de zichtbare teamtekening', true);
    await cp.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
    await cp.fill('#reviewer-name', 'Eva Jansen');
    await cp.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 4; });
    await cp.waitForTimeout(300);
    await cp.click('.composer-tool:has-text("Bereik")');
    await cp.click('.composer-range button:has-text("Eind hier")');
    check('bereik: eind vóór begin wordt geweigerd met uitleg', await cp.isVisible('.composer-error:not([hidden])'));
    await cp.evaluate(() => { document.querySelector('video').currentTime = 7; });
    await cp.waitForTimeout(300);
    await cp.click('.composer-range button:has-text("Eind hier")');
    await cp.fill('.composer textarea', 'Muziek zachter in dit stuk');
    // Fout bij verzenden: alles blijft staan, daarna opnieuw
    await cp.route('**/api/review/*/versions/*/comments', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
    await cp.click('.composer button[type=submit]');
    await cp.waitForTimeout(4500);
    check('fout bij verzenden: tekst en bereik blijven staan', (await cp.inputValue('.composer textarea')) === 'Muziek zachter in dit stuk' && /0:04 – 0:07/.test(await cp.textContent('.composer-range')));
    await cp.unroute('**/api/review/*/versions/*/comments');
    await cp.click('.composer button[type=submit]');
    await cp.waitForSelector('.comment:has-text("Muziek zachter in dit stuk")');
    const rr = server.db.prepare("SELECT timecode, timecode_end FROM comments WHERE body = 'Muziek zachter in dit stuk'").all();
    check('bereik opgeslagen (één keer, ook na opnieuw proberen)', rr.length === 1 && Math.abs(rr[0].timecode - 4) < 0.3 && Math.abs(rr[0].timecode_end - 7) < 0.3, JSON.stringify(rr));
    check('bereik zichtbaar op de tijdlijn', (await cp.locator('.pc-range').count()) >= 1);
    await cp.click('.comment:has-text("Muziek zachter in dit stuk") button:has-text("Fragment afspelen")');
    await cp.waitForTimeout(3800);
    const fr = await cp.evaluate(() => ({ t: document.querySelector('video').currentTime, paused: document.querySelector('video').paused }));
    check('fragment afspelen stopt aan het einde van het bereik', fr.paused && Math.abs(fr.t - rr[0].timecode_end) < 0.3, `${fr.t.toFixed(2)}s, gepauzeerd: ${fr.paused}`);
    await shot(cp, '69-klant-bereik-en-tekening');

    // ---------- Vergelijken (team) ----------
    const ids = mv.versions.map((v) => v.id);
    await page.goto(`${BASE}/video/${main.videoId}/vergelijk?a=${ids.at(-1)}&b=${ids[0]}`);
    await page.waitForSelector('.cmp');
    await page.waitForFunction(() => [...document.querySelectorAll('.cmp video')].every((v) => v.readyState >= 2), null, { timeout: 20_000 });
    await page.click('.cmp-controls .pc-btn');
    await page.waitForTimeout(1500);
    let t = await page.evaluate(() => [...document.querySelectorAll('.cmp video')].map((v) => ({ t: v.currentTime, muted: v.muted, d: v.duration })));
    check('vergelijken: gekoppeld afspelen (A en B lopen gelijk)', t[0].t > 0.5 && Math.abs(t[0].t - t[1].t) < 0.3, t.map((x) => x.t.toFixed(2)).join(' / '));
    check('vergelijken: geluid van één versie', t[0].muted !== t[1].muted);
    await page.click('.cmp-controls .pc-btn'); // pauze
    await page.click('.cmp-offset button:has-text("+1 s")');
    await page.waitForTimeout(400);
    t = await page.evaluate(() => [...document.querySelectorAll('.cmp video')].map((v) => v.currentTime));
    check('vergelijken: handmatige uitlijning (+1 s voor B)', Math.abs(t[1] - t[0] - 1) < 0.15, t.map((x) => x.toFixed(2)).join(' / '));
    await page.click('.cmp-offset button:has-text("Herstellen")');
    await page.$eval('.cmp-scrub', (el) => { el.value = String(Number(el.max) - 0.5); el.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(400);
    const ends = await page.$$eval('.cmp-state', (els) => els.map((e) => (e.hidden ? '' : e.textContent)));
    check('vergelijken: kortere versie toont “Einde van deze versie”', ends.some((x) => /Einde van deze versie/.test(x)), JSON.stringify(ends));
    await shot(page, '70-vergelijken-team');
    await page.click('.cmp-controls button:has-text("Gekoppeld")');
    check('vergelijken: koppeling los → eigen bediening per versie', await page.$$eval('.cmp video', (vs) => vs.every((v) => v.controls)));
    check('vergelijken: interne versies alleen voor het team zichtbaar in de keuzelijst', (await page.locator('.cmp-pane:first-child option').count()) === mv.versions.length);

    // ---------- Vergelijken (klant, mobiel) ----------
    const mobile = await browser.newContext({ ...devices['Pixel 7'] });
    const mp = await mobile.newPage();
    watch(mp, 'mobiel-B');
    await mp.goto(reviewUrl);
    await mp.waitForSelector('.r-header');
    const shared = (await (await mp.request.get(reviewUrl.replace('/r/', '/api/review/'))).json()).versions.length;
    await mp.click('button:has-text("Versies vergelijken")');
    await mp.waitForSelector('.cmp');
    check('klant: vergelijken alleen met gepubliceerde versies', (await mp.locator('.cmp-pane:first-child option').count()) === shared, `${shared} gepubliceerd`);
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check('mobiel vergelijken: onder elkaar, geen horizontaal scrollen', !overflow);
    await mp.click('.cmp-view button:has-text("Alleen B")');
    check('mobiel vergelijken: wisselen tussen A en B', await mp.isHidden('.cmp-pane:first-child'));
    await mp.click('.cmp-view button:has-text("A en B")');
    await shot(mp, '71-vergelijken-mobiel', { fullPage: true });
    // Mobiel tekenen met aanraking
    await mp.click('button:has-text("Terug naar de video")');
    await mp.waitForSelector('.composer');
    await mp.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
    await mp.fill('#reviewer-name', 'Eva Jansen');
    await mp.click('.composer-tool:has-text("Tekenen")');
    const mb = await mp.locator('.pc-overlay').boundingBox();
    await mp.click('.ann-btn[aria-label="Pijl"]');
    const cdp = await mobile.newCDPSession(mp);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', mb.x + mb.width * 0.2, mb.y + mb.height * 0.8);
    for (let i = 1; i <= 6; i++) await touch('touchMove', mb.x + mb.width * (0.2 + i * 0.05), mb.y + mb.height * (0.8 - i * 0.08));
    await touch('touchEnd');
    await mp.fill('.composer textarea', 'Dit moet scherper');
    await mp.click('.composer button[type=submit]');
    await mp.waitForSelector('.comment:has-text("Dit moet scherper")');
    const ma = JSON.parse(server.db.prepare("SELECT annotation FROM comments WHERE body = 'Dit moet scherper'").get()?.annotation || 'null');
    check('mobiel: tekenen met aanraking + tekst', ma?.shapes?.[0]?.t === 'arrow', JSON.stringify(ma?.shapes?.[0]));
    await mp.click('.comment:has-text("Dit moet scherper") .comment-drawing');
    await mp.evaluate(() => window.scrollTo(0, 0));
    await mp.waitForFunction(() => document.querySelector('video')?.readyState >= 2, null, { timeout: 10_000 });
    check('tekening tonen laadt het beeld eronder', true);
    await shot(mp, '72-tekenen-mobiel');
    await c2.close();
    await mobile.close();
    void latestId;
  }

  check('geen JavaScript-fouten', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  listener.close();
  server.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nSchermafbeeldingen: ${SHOTS}\n${results.length - failed}/${results.length} controles geslaagd`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
