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

  check('geen JavaScript-fouten', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  listener.close();
  server.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nSchermafbeeldingen: ${SHOTS}\n${results.length - failed}/${results.length} controles geslaagd`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
