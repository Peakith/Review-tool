// Browsertest bouwronde 5, fase A: rustige indeling, persoonlijk dashboard, thema, globaal zoeken,
// oorspronkelijke bestandsnamen en handmatige thumbnails. Met meerdere accounts (beheerder en
// freelancer), lange titels en veel reacties, op desktop en in Pixel 7-emulatie.
// Gebruik: CHROME_PATH=/pad/naar/chrome npm run test:browser:ui   (SHOTS_DIR=/map optioneel)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');
const { createApp } = require('../server/app');

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Zet CHROME_PATH naar een Chrome met H.264-ondersteuning.'); process.exit(2); }
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'review-uitest-'));
const SHOTS = process.env.SHOTS_DIR || path.join(S, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const shot = async (page, name, opts = {}) => {
  await page.evaluate(() => document.querySelectorAll('.toast-host > *').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};
const mp4 = (name, size = '1920x1080', sec = 6, pat = 'testsrc2') => {
  const f = path.join(S, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `${pat}=size=${size}:rate=25:duration=${sec}`, '-f', 'lavfi', '-i', `sine=frequency=500:duration=${sec}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]);
  return f;
};

(async () => {
  const server = createApp({ dataDir: path.join(S, 'data'), backupDir: path.join(S, 'backups'), setupToken: 'ui-test-code-1234', minFreeBytes: 0, env: { ...process.env, STUDIO_REVIEW_HOME: path.join(S, 'home'), DATA_DIR: '' } });
  const listener = await new Promise((r) => { const l = server.app.listen(0, () => r(l)); });
  const BASE = `http://localhost:${listener.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const watch = (p, label) => {
    p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/40[0134]|409|410/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  };
  const H = { 'x-requested-with': 'review-tool' };
  const ctxOpts = { viewport: { width: 1440, height: 900 }, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam', acceptDownloads: true };

  // ---------- Opzet: beheerder, freelancer, projecten met lange titels en veel reacties ----------
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  watch(page, 'beheer');
  const apiT = async (method, url, data, p = page) => {
    const r = await p.request.fetch(`${BASE}${url}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const upload = async (file, target) => {
    const buf = fs.readFileSync(file);
    const up = await apiT('POST', '/api/uploads', { filename: path.basename(file), size: buf.length, ...target });
    for (let o = 0; o < buf.length; o += up.chunkSize) await page.request.put(`${BASE}/api/uploads/${up.id}?offset=${o}`, { headers: { ...H, 'content-type': 'application/octet-stream' }, data: buf.subarray(o, o + up.chunkSize) });
    return up.id;
  };
  await page.goto(`${BASE}/?setup=ui-test-code-1234`);
  await page.fill('input[name=name]', 'Sanne de Vries');
  await page.fill('input[name=email]', 'sanne@agency.nl');
  await page.fill('input[name=password]', 'een-lang-wachtwoord');
  await page.click('button[type=submit]');
  await page.waitForSelector('.onboarding');
  check('lege installatie: dashboard toont de welkomstuitleg', await page.isVisible('.onboarding button:has-text("Eerste project aanmaken")'));
  await shot(page, '50-dashboard-leeg');

  const longName = 'Zomercampagne 2026 — landelijke lancering met een bijzonder lange projectnaam die netjes moet afbreken';
  const pA = (await apiT('POST', '/api/projects', { name: longName, clientName: 'Fietsfabriek Noord', roundsIncluded: 2 })).id;
  const pB = (await apiT('POST', '/api/projects', { name: 'Geheim project', clientName: 'Andere klant' })).id;
  await apiT('POST', '/api/projects', { name: 'Leeg project', clientName: 'Nieuwe klant' });
  const fileA = mp4('SB_Campagne_Edit_v03.mp4');
  const fileReel = mp4('Reel_9x16_final.mp4', '1080x1920', 5);
  const vA = await apiT('POST', `/api/projects/${pA}/videos`, { uploadId: await upload(fileA, { projectId: pA }), title: 'Zomercampagne — hoofdvideo met een hele lange titel die moet afbreken' });
  const reel = await apiT('POST', `/api/projects/${pA}/videos`, { uploadId: await upload(fileReel, { projectId: pA }), title: 'Instagram reel 9:16' });
  const vB = await apiT('POST', `/api/projects/${pB}/videos`, { uploadId: await upload(fileA, { projectId: pB }), title: 'Geheime lancering' });
  for (const v of [vA, reel, vB]) { await apiT('POST', `/api/versions/${v.versionId}/ready`); await apiT('POST', `/api/versions/${v.versionId}/share`, { round: 'new', requestId: `share-${v.versionId}-aaaa` }); }
  const tokenOf = async (videoId) => (await apiT('GET', `/api/videos/${videoId}`)).links.find((l) => l.role === 'reviewer').url.split('/').pop();
  const tA = await tokenOf(vA.videoId);
  const tB = await tokenOf(vB.videoId);
  const guest = (token, ver, body, i) => page.request.post(`${BASE}/api/review/${token}/versions/${ver}/comments`, { headers: { ...H, 'x-reviewer-key': 'ui-reviewer-key-000001' }, data: { body, timecode: (i * 0.13) % 5.5, authorName: 'Eva Jansen', requestId: `c${token.slice(0, 6)}${i}aaaaaaaa` } });
  for (let i = 0; i < 40; i++) await guest(tA, vA.versionId, `Opmerking ${i + 1}: ${i === 17 ? 'het LOGO-zoekwoord in beeld' : 'de eindtitel iets langer in beeld'}`, i);
  await guest(tB, vB.versionId, 'Geheime opmerking over het LOGO-zoekwoord', 1);
  await page.request.post(`${BASE}/api/review/${tA}/versions/${vA.versionId}/feedback`, { headers: { ...H, 'x-reviewer-key': 'ui-reviewer-key-000001' }, data: { authorName: 'Eva Jansen', requestId: 'feedback-aaaaaaaa' } });
  const fl = await apiT('POST', '/api/users', { name: 'Fien Freelancer', email: 'fien@agency.nl', password: 'een-lang-wachtwoord', role: 'member' });
  await apiT('PUT', `/api/users/${fl.id}/projects`, { projects: [{ projectId: pA, level: 'upload' }] });

  // ---------- Dashboard ----------
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.dash-card');
  const titles = await page.$$eval('.dash-card h2', (els) => els.map((e) => e.textContent));
  check('standaarddashboard: vier rustige blokken — Aandacht nodig, Vastgezet, Inbox, Bij de klant', JSON.stringify(titles) === JSON.stringify(['Aandacht nodig', 'Vastgezet', 'Inbox', 'Bij de klant']), titles.join(', '));
  check('geen bewerkknoppen buiten de aanpasmodus', !(await page.isVisible('.dash-grip')) && !(await page.isVisible('.dash-tools')));
  await shot(page, '51-dashboard');
  await page.click('button:has-text("Dashboard aanpassen")');
  check('aanpasmodus: grepen en knoppen zichtbaar', await page.isVisible('.dash-grip') && await page.isVisible('.dash-add button:has-text("Opslag")'));
  await page.click('.dash-add button:has-text("Opslag")');
  await page.waitForSelector('.dash-card[data-widget="storage"] .progress');
  await page.click('.dash-card[data-widget="inbox"] button:has-text("Breed")');
  await page.click('.dash-card[data-widget="inbox"] button[aria-label="Inbox omhoog"]');
  await page.click('.dash-card[data-widget="waiting"] button:has-text("Verbergen")');
  await page.waitForFunction(() => !document.querySelector('.dash-card[data-widget="waiting"]'));
  // Verplaatsen met het toetsenbord via de greep
  await page.focus('.dash-card[data-widget="storage"] .dash-grip');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  await shot(page, '52-dashboard-aanpassen');
  await page.click('.dash-editbar button:has-text("Klaar")');
  await page.reload();
  await page.waitForSelector('.dash-card');
  const after = await page.$$eval('.dash-card', (els) => els.map((e) => `${e.dataset.widget}:${e.classList.contains('is-wide') ? 'breed' : 'normaal'}`));
  check('dashboard: toevoegen, verbergen, verplaatsen (muis en toetsenbord) en formaat blijven bewaard', JSON.stringify(after) === JSON.stringify(['attention:breed', 'inbox:breed', 'storage:normaal', 'pinned:breed']), after.join(', '));

  // Freelancer: eigen dashboard, geen beheerblokken en geen gegevens uit andere projecten
  const fctx = await browser.newContext(ctxOpts);
  const f = await fctx.newPage();
  watch(f, 'freelancer');
  await f.goto(`${BASE}/login`);
  await f.fill('input[name=email]', 'fien@agency.nl');
  await f.fill('input[name=password]', 'een-lang-wachtwoord');
  await f.click('button[type=submit]');
  await f.waitForSelector('.dash-card');
  const ftitles = await f.$$eval('.dash-card h2', (els) => els.map((e) => e.textContent));
  check('freelancer: eigen standaarddashboard (indeling beheerder niet overgenomen)', ftitles.length === 4 && ftitles[3] === 'Bij de klant', ftitles.join(', '));
  check('freelancer: niets uit een ander project op het dashboard', !(await f.textContent('.dash-grid')).includes('Geheim'));
  await f.click('button:has-text("Dashboard aanpassen")');
  const fAdd = await f.$$eval('.dash-add button', (els) => els.map((e) => e.textContent));
  check('freelancer: geen opslag- of klantactiviteitblok beschikbaar', !fAdd.some((t) => /Opslag|Klantactiviteit/.test(t)), fAdd.join(', '));
  await f.click('.dash-editbar button:has-text("Klaar")');

  // ---------- Vaste donkere stijl (0.9.0) ----------
  check('donkere stijl', (await page.getAttribute('html', 'data-theme')) === 'dark');
  await page.click('.side-user');
  check('profielmenu: geen themakeuze meer', !(await page.isVisible('.profile-menu .menu-item:has-text("Licht")')) && !(await page.isVisible('.profile-menu .menu-item:has-text("Systeem")')));
  await page.keyboard.press('Escape');
  // Bestaande browser met een oude lichte voorkeur (account én browser) en een licht ingesteld systeem.
  const me = (await (await page.request.get(`${BASE}/api/session`)).json()).user.id;
  server.db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(JSON.stringify({ theme: 'light' }), me);
  await page.evaluate(() => localStorage.setItem('rt-theme', 'light'));
  await page.emulateMedia({ colorScheme: 'light' });
  const served = await (await page.request.get(`${BASE}/`)).text();
  check('pagina komt al donker binnen (geen witte flits): data-theme, color-scheme en achtergrond vóór de scripts', /<html lang="nl" data-theme="dark">/.test(served) && /<meta name="color-scheme" content="dark">/.test(served) && !served.includes('data-theme-pref'));
  await page.reload();
  await page.waitForSelector('.dash-card');
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const htmlBg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  check('oude lichte voorkeur + licht systeem → toch donker #0B1424', (await page.getAttribute('html', 'data-theme')) === 'dark' && bodyBg === 'rgb(11, 20, 36)' && htmlBg === 'rgb(11, 20, 36)', `${bodyBg} ${htmlBg}`);
  check('oude themakeuze in deze browser opgeruimd', (await page.evaluate(() => localStorage.getItem('rt-theme'))) === null);
  await page.emulateMedia({ colorScheme: 'dark' });
  // Contrast in de gebouwde interface: tekstkleuren, knoppen (ook hover en uitgeschakeld) en focus.
  const contrastJs = `const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const rgb = (c) => c.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number);`;
  const cTokens = await page.evaluate(`(() => { ${contrastJs}
    const probe = (v) => { const el = document.createElement('span'); el.style.color = 'var(' + v + ')'; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return rgb(c); };
    const bg = rgb(getComputedStyle(document.body).backgroundColor);
    const surf = (v) => { const el = document.createElement('div'); el.style.background = 'var(' + v + ')'; document.body.append(el); const c = getComputedStyle(el).backgroundColor; el.remove(); return rgb(c); };
    const s1 = surf('--surface'); const s2 = surf('--surface-2');
    return Object.fromEntries(['--text', '--text-2', '--text-3', '--sel', '--warn-text', '--danger-text', '--ok-text', '--info-text'].map((v) => [v, Math.min(cr(probe(v), bg), cr(probe(v), s1), cr(probe(v), s2)).toFixed(2)]));
  })()`);
  check('contrast tekstkleuren ≥ 4,5:1 op achtergrond, panelen en verhoogde vlakken', Object.values(cTokens).every((x) => Number(x) >= 4.5), JSON.stringify(cTokens));
  const btnContrast = async (sel) => page.evaluate(`(() => { ${contrastJs} const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 0; const s = getComputedStyle(e); let bgc = s.backgroundColor; if (/rgba\\(0, 0, 0, 0\\)|transparent/.test(bgc)) bgc = getComputedStyle(document.body).backgroundColor; return cr(rgb(s.color), rgb(bgc)).toFixed(2); })()`);
  await page.goto(`${BASE}/projecten`);
  await page.waitForSelector('.btn-primary');
  const cPrimary = await btnContrast('.btn-primary');
  await page.hover('.btn-primary');
  await page.waitForTimeout(250);
  const cPrimaryHover = await btnContrast('.btn-primary');
  const cSecondary = await btnContrast('.view-toggle button, .btn-secondary, .btn');
  await page.evaluate(() => { const b = document.createElement('button'); b.className = 'btn btn-primary test-disabled'; b.disabled = true; b.textContent = 'Uitgeschakeld'; document.querySelector('main').prepend(b); });
  const cDisabled = await btnContrast('.test-disabled');
  await page.evaluate(() => document.querySelector('.test-disabled').remove());
  await page.focus('.side-nav a:has-text("Projecten")');
  await page.keyboard.press('Tab');
  const focusRing = await page.evaluate(`(() => { ${contrastJs} const s = getComputedStyle(document.activeElement); const m = s.boxShadow.match(/rgb\\([^)]+\\)/g) || []; const ring = m.length ? rgb(m[m.length - 1]) : null; return ring ? cr(ring, rgb(getComputedStyle(document.body).backgroundColor)).toFixed(2) : 0; })()`);
  check('contrast knoppen: primair, primair hover, secundair en uitgeschakeld ≥ 4,5:1; focusring ≥ 3:1', [cPrimary, cPrimaryHover, cSecondary, cDisabled].every((x) => Number(x) >= 4.5) && Number(focusRing) >= 3,
    JSON.stringify({ cPrimary, cPrimaryHover, cSecondary, cDisabled, focusRing }));

  // ---------- Zoeken ----------
  await page.click('.side-search input');
  await page.keyboard.type('LOGO-zoek');
  await page.waitForSelector('.search-suggest:not([hidden]) .suggest-item');
  const sugg = await page.textContent('.search-suggest');
  check('zoeksuggesties tijdens typen, gegroepeerd', /Reacties/.test(sugg) && /Alle resultaten/.test(sugg), sugg.slice(0, 120));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.search-item');
  check('Enter opent de resultatenpagina', page.url().includes('/zoeken?q=LOGO-zoek'));
  await shot(page, '54-zoeken');
  await page.click('.search-item:has-text("Opmerking 18")');
  await page.waitForSelector('.comment.is-active');
  const opened = await page.evaluate(() => ({ url: location.pathname + location.search, active: document.querySelector('.comment.is-active')?.textContent, t: document.querySelector('.player video').currentTime }));
  check('reactieresultaat opent de juiste video, versie en reactie op de tijdcode', opened.url.startsWith(`/video/${vA.videoId}?v=${vA.versionId}&c=`) && /Opmerking 18/.test(opened.active) && Math.abs(opened.t - ((17 * 0.13) % 5.5)) < 0.3, JSON.stringify(opened).slice(0, 160));
  // Zoekopdracht bewaren
  await page.goto(`${BASE}/zoeken?q=eindtitel&in=comments`);
  await page.waitForSelector('.search-item');
  await page.click('button:has-text("Zoekopdracht bewaren")');
  await page.fill('dialog input', 'Eindtitels');
  await page.click('dialog button:has-text("Bewaren")');
  await page.waitForSelector('.saved-chip:has-text("Eindtitels")');
  check('zoekopdracht bewaard (alleen voor dit account)', (await (await f.request.get(`${BASE}/api/saved-searches`)).json()).length === 0);
  // Freelancer: zoekt in de interface naar iets uit een ander project
  await f.goto(`${BASE}/zoeken?q=Geheim`);
  await f.waitForSelector('.search-results .empty-state, .search-results .empty, .search-results .card');
  check('freelancer: zoeken naar een ander project geeft niets (ook geen aantallen)', !(await f.textContent('.search-results')).includes('Geheime') && !(await f.isVisible('.search-group')));

  // ---------- Werkplek: alle functies bereikbaar ----------
  await page.goto(`${BASE}/video/${vA.videoId}`);
  await page.waitForSelector('.comment');
  const layout = await page.evaluate(() => {
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const panel = document.querySelector('.side-panel').getBoundingClientRect();
    const composer = document.querySelector('.panel-composer').getBoundingClientRect();
    return { stage: Math.round(stage.width), panel: Math.round(panel.width), composerVisible: composer.bottom <= innerHeight + 1 };
  });
  check('speler krijgt de meeste ruimte; invoerveld in beeld ondanks 40 reacties', layout.stage > layout.panel * 2 && layout.composerVisible, JSON.stringify(layout));
  const tabs = await page.$$eval('.side-panel [role=tab]', (els) => els.map((e) => e.textContent.replace(/\d+/g, '').trim()));
  check('zijpaneel: Reacties, Versies en Info', JSON.stringify(tabs) === JSON.stringify(['Reacties', 'Versies', 'Info']), tabs.join(', '));
  check('versiekeuze en volgende stap direct in beeld', await page.isVisible('.version-select') && await page.isVisible('.publish-bar'));
  await page.click('button[aria-label="Meer acties"]');
  const menu = await page.$$eval('.menu:not([hidden]) .menu-item', (els) => els.map((e) => e.textContent));
  const expected = ['Nieuwe versie uploaden', 'Klantweergave bekijken', 'Download Versie', 'Feedback exporteren', 'Gegevens wijzigen', 'Status van Versie', 'Video archiveren', 'Video naar prullenbak'];
  check('menu ⋯ bevat alle minder gebruikte acties', expected.every((x) => menu.some((m) => m.includes(x))), menu.join(' | '));
  await page.keyboard.press('Escape');
  await page.click('#tab-info');
  const info = await page.textContent('#tabpanel-info');
  check('Info: eigenschappen, oorspronkelijke naam, rondes en geschiedenis', /Eigenschappen/.test(info) && /SB_Campagne_Edit_v03\.mp4/.test(info) && /Reviewrondes/.test(info) && /Geschiedenis van versie 1/.test(info));
  await shot(page, '55-werkplek-info');
  // Handmatige thumbnail via het huidige frame
  await page.evaluate(() => { const v = document.querySelector('.player video'); v.currentTime = 3.2; });
  await page.waitForFunction(() => Math.abs(document.querySelector('.player video').currentTime - 3.2) < 0.1);
  await page.click('#tabpanel-info button:has-text("Huidig frame gebruiken")');
  await page.waitForSelector('#tabpanel-info:has-text("Zelf gekozen frame op 0:03")');
  check('thumbnail: zelf gekozen frame van deze versie', true);
  await page.click('#tabpanel-info button:has-text("Automatisch")');
  await page.waitForSelector('#tabpanel-info:has-text("Automatisch gekozen frame")');
  check('thumbnail: terug naar automatisch', true);
  // Titel wijzigen verandert de downloadnaam niet
  await apiT('PATCH', `/api/videos/${vA.videoId}`, { title: 'Nieuwe titel — "definitief" & klaar' });
  await page.reload();
  await page.waitForSelector('#tabpanel-info:not([hidden])');
  check('gekozen tabblad (Info) blijft open na herladen', page.url().includes('tab=info'));
  await page.click('button[aria-label="Meer acties"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.menu:not([hidden]) .menu-item:has-text("Download Versie")')]);
  check('download na titelwijziging: oorspronkelijke uploadnaam', dl.suggestedFilename() === 'SB_Campagne_Edit_v03.mp4', dl.suggestedFilename());
  const saved = path.join(S, 'dl.mp4');
  await dl.saveAs(saved);
  check('download: identieke inhoud', Buffer.compare(fs.readFileSync(saved), fs.readFileSync(fileA)) === 0);

  // Zichtbare toetsenbordfocus
  await page.goto(`${BASE}/projecten`);
  await page.waitForSelector('.project-card');
  await page.focus('.side-nav a:has-text("Projecten")');
  await page.keyboard.press('Tab');
  const focusStyle = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${s.outlineStyle} ${s.outlineWidth} | ${s.boxShadow}`; });
  check('toetsenbordfocus zichtbaar', !/^none 0px \| none$/.test(focusStyle), focusStyle);
  await shot(page, '56-projecten-licht');

  // ---------- Instellingen ----------
  await page.click('.side-user');
  await page.click('.profile-menu a:has-text("Instellingen")');
  const sections = await page.$$eval('.settings-nav a', (els) => els.map((e) => e.textContent));
  check('Instellingen bundelt account, team, merken, opslag, archief en prullenbak', ['Mijn account', 'Team & rechten', 'Merken', 'Opslag & back-ups', 'Archief', 'Prullenbak'].every((x) => sections.includes(x)), sections.join(', '));
  for (const old of ['/team', '/merken', '/opslag', '/prullenbak', '/archief']) {
    await page.goto(`${BASE}${old}`);
    await page.waitForSelector('.settings-nav a.is-active');
  }
  check('oude adressen (/team, /merken, /opslag, /prullenbak, /archief) blijven werken', true);

  // ---------- Mobiel ----------
  const mctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'nl-NL', timezoneId: 'Europe/Amsterdam', storageState: await ctx.storageState() });
  const m = await mctx.newPage();
  watch(m, 'mobiel');
  const overflow = {};
  for (const [name, url, sel] of [['dashboard', '/', '.dash-card'], ['projecten', '/projecten', '.project-card'], ['project', `/projecten/${pA}`, '.video-row'], ['werkplek', `/video/${vA.videoId}`, '.comment'], ['zoeken', '/zoeken?q=eindtitel', '.search-item'], ['instellingen', '/instellingen/opslag', '.settings-nav']]) {
    await m.goto(`${BASE}${url}`);
    await m.waitForSelector(sel);
    overflow[name] = await m.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
    if (name === 'dashboard' || name === 'werkplek') await shot(m, `57-mobiel-${name}`);
  }
  check('mobiel: geen horizontaal scrollen op de nieuwe schermen', Object.values(overflow).every((x) => x <= 1), JSON.stringify(overflow));
  check('mobiel: navigatie ingeklapt achter de menuknop', !(await m.isVisible('.side-nav a:has-text("Projecten")')));
  await m.click('.menu-btn');
  check('mobiel: menu opent met zoeken en navigatie', await m.isVisible('.side-search input') && await m.isVisible('.side-nav a:has-text("Projecten")'));

  check('geen JavaScript-fouten', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  listener.close();
  server.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} controles geslaagd. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
