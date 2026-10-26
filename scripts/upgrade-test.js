// Ontwikkeltest: bijwerken vanaf een vorige versie (standaard 5ae74b6 = 0.8.0) met echte gegevens.
//  1. vorige versie (zonder .git) maakt account, project, video met twee versies, reviewlink, klantreactie,
//     feedback, teamnotitie en -antwoord, akkoordlink en goedkeuring, en een back-up;
//  2. de nieuwe code start op dezelfde gegevens: alles werkt nog, teamnotities zijn intern, antwoorden aan
//     de klant blijven zichtbaar, klantportaal werkt;
//  3. de back-up van de vorige versie wordt met de nieuwe code teruggezet en werkt; de klantlinks uit
//     die back-up zijn daarbij (veilige standaard) ongeldig gemaakt;
//  4. bouwronde 6: een nieuwe back-up met projectkoppelingen (einddatums) en klantvragen terugzetten;
//     een verstreken einddatum blijft verstreken;
//  5. bouwronde 7/8: de eigen dashboardindeling blijft na de update en een oude lichte themakeuze
//     maakt niets meer licht; bestaande projecten
//     hebben zonder instellen een automatische omslag; omslag (eigen frame) en vastgezette projecten gaan
//     mee in een back-up en komen terug bij herstel.
// Gebruik: npm run test:upgrade [-- <oude-commit>]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, execSync } = require('child_process');
const REPO = path.resolve(__dirname, '..');
const OLD_REV = process.argv[2] || '5ae74b6';
const { client, upload, makeVideo, rid } = require(path.join(REPO, 'test/helpers'));
const { restoreBackup, listBackups } = require(path.join(REPO, 'server/backup'));

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'review-upgrade-'));
const OLD = path.join(T, 'oud');
let fails = 0;
const ok = (n, c, d = '') => { if (!c) fails++; console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

(async () => {
  fs.mkdirSync(OLD, { recursive: true });
  execSync(`git -C "${REPO}" archive ${OLD_REV} | tar -x -C "${OLD}"`);
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(OLD, 'node_modules'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), DATA_DIR: path.join(T, 'gegevens'), STUDIO_REVIEW_HOME: path.join(T, 'home'), BACKUP_DIR: path.join(T, 'backups'), MIN_FREE_GB: '0', SETUP_TOKEN: 'upgrade-test-code-123' };
  const start = async (dir) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/api/session`)).ok) return child; } catch { /* nog niet */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`server start niet:\n${log}`);
  };
  const stop = (child) => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); });

  // ---- 1. Vorige versie ----
  let srv = await start(OLD);
  const team = client(base);
  await team.post('/api/setup', { setupToken: env.SETUP_TOKEN, email: 'sanne@agency.nl', name: 'Sanne', password: 'een-lang-wachtwoord' });
  const projectId = (await team.post('/api/projects', { name: 'Bestaand project', clientName: 'Klant BV' })).data.id;
  const file = makeVideo(T, 'film.mp4');
  const created = (await team.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(team, file, { projectId }), title: 'Hoofdvideo' })).data;
  await team.post(`/api/versions/${created.versionId}/ready`);
  await team.post(`/api/versions/${created.versionId}/share`);
  const v = (await team.get(`/api/videos/${created.videoId}`)).data;
  const token = new URL(v.links.find((l) => l.role === 'reviewer').url).pathname.split('/').pop();
  const guest = client(base);
  const key = { 'x-reviewer-key': 'upgrade-reviewer-key-01' };
  const cc = (await guest.post(`/api/review/${token}/versions/${created.versionId}/comments`, { body: 'Klantreactie: logo groter', timecode: 1, authorName: 'Eva', requestId: rid() }, key)).data.id;
  await guest.post(`/api/review/${token}/versions/${created.versionId}/feedback`, { authorName: 'Eva', requestId: rid() }, key);
  await team.post(`/api/versions/${created.versionId}/comments`, { body: 'Teamnotitie: muziek licenseren', timecode: 0.5 });
  await team.post(`/api/versions/${created.versionId}/comments`, { body: 'Antwoord aan klant: komt goed', parentId: cc });
  const v2 = (await team.post(`/api/videos/${created.videoId}/versions`, { uploadId: await upload(team, file, { videoId: created.videoId }) })).data;
  await team.post(`/api/versions/${v2.versionId}/ready`);
  await team.post(`/api/versions/${v2.versionId}/share`);
  await team.patch(`/api/videos/${created.videoId}`, { approverName: 'Joris', approverEmail: 'joris@klant.nl' });
  const approver = new URL((await team.post(`/api/videos/${created.videoId}/links`, { role: 'approver' })).data.url).pathname.split('/').pop();
  const appr = await guest.post(`/api/review/${approver}/versions/${v2.versionId}/approve`, { confirm: true, versionNumber: 2, requestId: rid() }, key);
  ok(`vorige versie (${OLD_REV}): gegevens aangemaakt incl. goedkeuring`, appr.status === 200, String(appr.status));
  // Teamleden met de oude niveaus (alleen als de vorige versie al rollen kende).
  const kijker = await team.post('/api/users', { name: 'Kees Kijker', email: 'kees@agency.nl', password: 'een-lang-wachtwoord', role: 'member' });
  const publiceerder = await team.post('/api/users', { name: 'Pim Publiceer', email: 'pim@agency.nl', password: 'een-lang-wachtwoord', role: 'member' });
  const hadRoles = kijker.status === 201;
  if (hadRoles) {
    await team.put(`/api/users/${kijker.data.id}/projects`, { projects: [{ projectId, level: 'view' }] });
    await team.put(`/api/users/${publiceerder.data.id}/projects`, { projects: [{ projectId, level: 'publish' }] });
  }
  // Voorkeuren van vóór de update (thema en een eigen dashboardindeling).
  const prefsSet = await team.put('/api/me/preferences', { theme: 'light', dashboard: { widgets: [{ id: 'tasks', size: 'wide' }, { id: 'recent' }] } });
  await team.post('/api/backups', { label: 'voor-update' });
  for (let i = 0; i < 100 && (await team.get('/api/backups')).data.job?.state === 'bezig'; i++) await new Promise((r) => setTimeout(r, 100));
  const oldBackup = (await team.get('/api/backups')).data.backups[0];
  ok('vorige versie: volledige back-up gemaakt', oldBackup?.status === 'volledig');
  await stop(srv);

  // ---- 2. Nieuwe code op dezelfde gegevens ----
  srv = await start(REPO);
  const t2 = client(base);
  ok('inloggen met bestaand account', (await t2.post('/api/login', { email: 'sanne@agency.nl', password: 'een-lang-wachtwoord' })).status === 200);
  const video = (await t2.get(`/api/videos/${created.videoId}`)).data;
  ok('video, versies, akkoordgever en goedkeuring behouden', video.versions.length === 2 && video.versions[0].approval?.name === 'Joris' && video.approverName === 'Joris');
  ok('bestaande reviewlink werkt', (await client(base).get(`/api/review/${token}`)).status === 200);
  ok('bestaande akkoordlink werkt', (await client(base).get(`/api/review/${approver}`)).status === 200);
  const seen = JSON.stringify((await client(base).get(`/api/review/${token}/versions/${created.versionId}/comments`, key)).data);
  ok('klant ziet eigen reactie en het antwoord van het team', seen.includes('logo groter') && seen.includes('komt goed'));
  ok('losse teamnotitie van vóór de update is nu intern', !seen.includes('muziek licenseren'));
  const teamSees = (await t2.get(`/api/versions/${created.versionId}/comments`)).data;
  ok('team ziet alle reacties, met zichtbaarheid', JSON.stringify(teamSees).includes('muziek licenseren') && teamSees.some((c) => c.internal === true));
  const link = (await t2.post(`/api/projects/${projectId}/portal-link`)).data.link;
  const portal = (await client(base).get(new URL(link.url).pathname.replace('/p/', '/api/portal/'))).data;
  ok('klantportaal voor bestaand project', portal.videos.length === 1 && portal.videos[0].version.status === 'approved' && portal.videos[0].version.number === 2);
  // Bouwronde 3 op bestaande gegevens: geen verzonnen rondes, taken en export werken.
  // Vanaf 0.3.0: geen rondes verzinnen. Vanaf 0.4.0: de vastgelegde rondes blijven precies staan.
  const hadRounds = fs.readFileSync(path.join(OLD, 'server', 'db.js'), 'utf8').includes('review_rounds');
  if (hadRounds) ok('bestaande reviewronde behouden (v1 en v2 in ronde 1)', JSON.stringify(video.rounds.map((r) => [r.number, r.versions.map((x) => x.number).sort()])) === '[[1,[1,2]]]' && video.unroundedSharedVersions.length === 0);
  else ok('geen verzonnen reviewrondes voor eerder gedeelde versies', video.rounds?.length === 0 && JSON.stringify(video.unroundedSharedVersions) === '[1,2]');
  const fb = (await t2.get(`/api/projects/${projectId}/feedback?status=all`)).data.items;
  ok('bestaande klantreactie staat in het feedbackoverzicht', fb.some((i) => i.body === 'Klantreactie: logo groter'));
  const cc2 = fb.find((i) => i.body === 'Klantreactie: logo groter').commentId;
  ok('van een bestaande reactie een taak maken', (await t2.post(`/api/comments/${cc2}/task`, { priority: 'high' })).status === 201);
  const v3 = (await t2.post(`/api/videos/${created.videoId}/versions`, { uploadId: await upload(t2, file, { videoId: created.videoId }) })).data;
  await t2.post(`/api/versions/${v3.versionId}/ready`);
  const nextRound = video.rounds.length + 1;
  ok(`volgende publicatie start ronde ${nextRound}`, (await t2.post(`/api/versions/${v3.versionId}/share`, { round: 'new', changeNote: 'Logo groter', requestId: rid() })).data.roundNumber === nextRound);
  const pdf = await fetch(`${base}/api/projects/${projectId}/export.pdf`, { headers: { cookie: t2.cookie() } });
  ok('feedback exporteren (PDF) op bestaande gegevens', pdf.status === 200 && (await pdf.arrayBuffer()).byteLength > 1000);
  // Bouwronde 4 op bestaande gegevens: een goedkeuring van vóór de update kan worden vrijgegeven.
  const cand = (await t2.get(`/api/projects/${projectId}/delivery-candidates`)).data.videos[0].versions.find((x) => x.number === 2);
  ok('bestaande klantgoedkeuring (v2) telt voor definitief vrijgeven', cand?.eligible === true && cand.approval.name === 'Joris');
  ok('v2 bewust vrijgeven', (await t2.post(`/api/projects/${projectId}/deliveries`, { items: [{ versionId: v2.versionId }], confirm: true, requestId: rid() })).status === 201);
  const dlToken = new URL((await t2.post(`/api/projects/${projectId}/delivery-link`)).data.link.url).pathname.split('/').pop();
  const page = (await client(base).get(`/api/delivery/${dlToken}`)).data;
  ok('opleverpagina toont v2 (niet de nieuwe interne v3)', page.items.length === 1 && page.items[0].versionNumber === 2);
  const file2 = await fetch(`${base}${page.items[0].downloadUrl}`);
  ok('download van de opgeleverde versie werkt', file2.status === 200 && (await file2.arrayBuffer()).byteLength === fs.statSync(file).size);
  ok('klantactiviteit vastgelegd (opleverpagina + download)', (await t2.get(`/api/projects/${projectId}/activity`)).data.items.length >= 2);
  // Bouwronde 5 op bestaande gegevens
  let pb = null;
  for (let i = 0; i < 300; i++) {
    pb = (await t2.get(`/api/versions/${v2.versionId}/playback`)).data;
    if (pb.status === 'done' || pb.status === 'failed') break;
    await new Promise((r2) => setTimeout(r2, 200));
  }
  ok('afspeelversies worden na de update ook voor bestaande versies gemaakt', pb.status === 'done' && pb.levels.length >= 1, JSON.stringify(pb.levels.map((l) => l.label)));
  ok('bestaande reviewlink (zonder downloadrecht): afspelen via afspeelversie, origineel geweigerd', (await fetch(`${base}/api/review/${token}/versions/${v2.versionId}/hls/master.m3u8`)).status === 200
    && (await fetch(`${base}/api/review/${token}/versions/${v2.versionId}/media`)).status === 403);
  ok('inbox, klanten en zoeken werken op bestaande gegevens', (await t2.get('/api/inbox')).status === 200 && (await t2.get('/api/clients')).status === 200
    && (await t2.get('/api/search?q=logo')).data.groups.comments.total >= 1);
  const tl = (await t2.get(`/api/projects/${projectId}/activity`)).data.items;
  ok('tijdlijn toont feedback en goedkeuring van vóór de update (uit de vastgelegde gegevens)', tl.some((i) => i.type === 'feedback_sent') && tl.some((i) => i.type === 'approval_given'));
  const zip = await fetch(`${base}/api/delivery/${dlToken}/package.zip`);
  ok('opleverpakket (ZIP) van een bestaande oplevering', zip.status === 200 && zip.headers.get('content-type') === 'application/zip');
  ok('bestaande projectlink houdt zijn bereik (geen vorige/volgende buiten het project)', (await client(base).get(new URL(link.url).pathname.replace('/p/', '/api/portal/'))).status === 200);
  const backups = await listBackups(env.BACKUP_DIR);
  ok('back-up van de vorige versie staat in de lijst als volledig', backups.some((b) => b.name === oldBackup.name && b.status === 'volledig'));
  // Bouwronde 6 op bestaande gegevens
  // Bouwronde 7 op bestaande gegevens
  const prefs = (await t2.get('/api/me/preferences')).data;
  if (prefsSet.status === 200) {
    ok('voorkeuren: eigen dashboardindeling behouden, oude lichte themakeuze zonder effect', !('theme' in prefs) && JSON.stringify(prefs.dashboard.widgets) === '[{"id":"tasks","size":"wide"},{"id":"recent","size":"normal"}]', JSON.stringify(prefs));
    const html = await (await fetch(`${base}/`, { headers: { cookie: t2.cookie() } })).text();
    ok('pagina na de update vast donker (ook met een oude lichte voorkeur)', html.includes('<html lang="nl" data-theme="dark">') && !html.includes('data-theme-pref'));
  }
  const proj = (await t2.get(`/api/projects/${projectId}`)).data;
  ok('bestaand project heeft zonder instellen een automatische omslag', proj.cover?.mode === 'auto' && (await fetch(`${base}${proj.cover.url}`, { headers: { cookie: t2.cookie() } })).status === 200);
  ok('beheerder blijft beheerder na de update', (await t2.get('/api/session')).data.user.role === 'admin' && (await t2.get('/api/storage')).status === 200);
  if (hadRoles) {
    const users = (await t2.get('/api/users')).data;
    const roleOf = (email) => users.find((u) => u.email === email).projects[0]?.role;
    ok('oude niveaus omgezet zonder extra rechten (view → Meekijker, publish → Editor)', roleOf('kees@agency.nl') === 'meekijker' && roleOf('pim@agency.nl') === 'editor');
    // Alleen bij bijwerken van vóór de rollen (0.6.0 en eerder) valt er iets om te zetten.
    const oldHadRoleModel = fs.readFileSync(path.join(OLD, 'server', 'access.js'), 'utf8').includes('meekijker');
    const notice = (await t2.get('/api/system/roles-notice')).data.notice;
    if (oldHadRoleModel) ok('geen omzetmelding nodig (vorige versie kende de rollen al)', !notice?.changes?.length);
    else ok('melding voor de beheerder over omgezette rechten', notice?.changes?.length === 2);
    const kees = client(base);
    await kees.post('/api/login', { email: 'kees@agency.nl', password: 'een-lang-wachtwoord' });
    ok('meekijker kan na de update kijken maar niet reageren', (await kees.get(`/api/videos/${created.videoId}`)).status === 200
      && (await kees.post(`/api/versions/${v2.versionId}/comments`, { body: 'x', timecode: 1 })).status === 403);
  }
  // Inhoudshash van bestaande versies op de achtergrond; daarna wordt een identieke upload herkend.
  let hashed = false;
  for (let i = 0; i < 60 && !hashed; i++) {
    const dupId = await upload(t2, file, { projectId });
    const d = (await t2.post(`/api/uploads/${dupId}/check-duplicate`, {})).data;
    await t2.del(`/api/uploads/${dupId}`);
    hashed = d.duplicates?.length >= 1;
    if (!hashed) await new Promise((r2) => setTimeout(r2, 500));
  }
  ok('identieke upload herkend, ook voor bestanden van vóór de update', hashed);
  const q = await t2.post(`/api/projects/${projectId}/questions`, { body: 'Vraag na de update', requestId: rid() });
  ok('vraag aan klant op een bestaand project', q.status === 201);
  await stop(srv);

  // ---- 3. Oude back-up terugzetten met de nieuwe code ----
  const r = await restoreBackup({ backupPath: path.join(env.BACKUP_DIR, oldBackup.name), dataDir: env.DATA_DIR, mediaDir: path.join(env.DATA_DIR, 'media') });
  ok('back-up van de vorige versie teruggezet (huidige gegevens bewaard)', !!r.keptData && fs.existsSync(r.keptData));
  srv = await start(REPO);
  const t3 = client(base);
  await t3.post('/api/login', { email: 'sanne@agency.nl', password: 'een-lang-wachtwoord' });
  const restored = (await t3.get(`/api/videos/${created.videoId}`)).data;
  ok('na herstel: video met 2 versies en goedkeuring', restored.versions?.length === 2 && restored.versions[0].approval?.name === 'Joris');
  // Veilige standaard bij herstel: alle klantlinks uit de (oudere) back-up zijn ongeldig gemaakt.
  ok('na herstel: oude review- en akkoordlink ongeldig (veilige standaard)', r.links.mode === 'invalidate'
    && (await fetch(`${base}/api/review/${token}/versions/${v2.versionId}/media`)).status === 410 && (await client(base).get(`/api/review/${approver}`)).status === 410);
  const teamMedia = await fetch(`${base}/api/versions/${v2.versionId}/media`, { headers: { cookie: t3.cookie() } });
  ok('na herstel: video speelt af voor het team; melding over de klantlinks', teamMedia.status === 200 && (await t3.get('/api/session')).data.system.restoreNotice?.links === 'invalidate');
  const freshLink = new URL((await t3.post(`/api/videos/${created.videoId}/links`, { role: 'reviewer' })).data.url).pathname.split('/').pop();
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    ready = (await fetch(`${base}/api/review/${freshLink}/versions/${v2.versionId}/hls/master.m3u8`)).status === 200;
    if (!ready) await new Promise((r2) => setTimeout(r2, 200));
  }
  ok('na herstel: een nieuwe reviewlink werkt (afspeelversies opnieuw gemaakt voor de oudere back-up)', (await client(base).get(`/api/review/${freshLink}`)).status === 200 && ready);
  ok('na herstel: projectlink van ná de back-up bestaat niet meer (zoals verwacht)', (await client(base).get(new URL(link.url).pathname.replace('/p/', '/api/portal/'))).status === 404);
  ok('na herstel: oplevering van ná de back-up bestaat niet (geen verzonnen gegevens)', (await t3.get(`/api/projects/${projectId}/deliveries`)).data.history.length === 0);

  // ---- 4. Nieuwe gegevens (bouwronde 6) in een back-up en terugzetten ----
  const fl = (await t3.post('/api/users', { name: 'Fien Freelancer', email: 'fien@freelance.nl', password: 'een-lang-wachtwoord', role: 'freelancer' })).data.id;
  const ed = (await t3.post('/api/users', { name: 'Ed Editor', email: 'ed@agency.nl', password: 'een-lang-wachtwoord', role: 'member' })).data.id;
  const soon = new Date(Date.now() + 2500).toISOString();
  const later = new Date(Date.now() + 7 * 86400000).toISOString();
  await t3.put(`/api/users/${fl}/projects`, { projects: [{ projectId, role: 'freelancer', expiresAt: soon }] });
  await t3.put(`/api/users/${ed}/projects`, { projects: [{ projectId, role: 'editor', expiresAt: later }] });
  const q4 = (await t3.post(`/api/projects/${projectId}/questions`, { body: 'Vraag in de back-up', requestId: rid() })).data.question;
  await t3.post('/api/backups', { label: 'ronde6' });
  for (let i = 0; i < 100 && (await t3.get('/api/backups')).data.job?.state === 'bezig'; i++) await new Promise((r2) => setTimeout(r2, 100));
  const newBackup = (await t3.get('/api/backups')).data.backups[0];
  ok('back-up met projectkoppelingen en klantvragen', newBackup?.status === 'volledig');
  await new Promise((r2) => setTimeout(r2, 3000)); // de korte einddatum is nu verstreken
  await stop(srv);
  await restoreBackup({ backupPath: path.join(env.BACKUP_DIR, newBackup.name), dataDir: env.DATA_DIR, mediaDir: path.join(env.DATA_DIR, 'media') });
  srv = await start(REPO);
  const t4 = client(base);
  await t4.post('/api/login', { email: 'sanne@agency.nl', password: 'een-lang-wachtwoord' });
  const users4 = (await t4.get('/api/users')).data;
  const flUser = users4.find((u) => u.email === 'fien@freelance.nl');
  const edUser = users4.find((u) => u.email === 'ed@agency.nl');
  ok('na herstel: freelanceraccount en koppeling met einddatum behouden', flUser?.role === 'freelancer' && flUser.projects[0]?.expiresAt === soon);
  ok('na herstel: verstreken einddatum blijft verstreken', flUser.projects[0]?.expired === true);
  const fien = client(base);
  await fien.post('/api/login', { email: 'fien@freelance.nl', password: 'een-lang-wachtwoord' });
  ok('na herstel: verlopen freelancer heeft geen toegang', (await fien.get(`/api/freelance/projects/${projectId}`)).status === 403 && (await fien.get('/api/freelance/overview')).data.projects.length === 0);
  ok('na herstel: geldige koppeling (editor tot later) werkt', edUser.projects[0]?.expiresAt === later && edUser.projects[0]?.expired === false);
  const qs = (await t4.get(`/api/projects/${projectId}/questions`)).data.questions;
  ok('na herstel: klantvraag behouden', qs.some((x) => x.id === q4.id && x.body === 'Vraag in de back-up'));

  // ---- 5. Omslag en vastzetten in back-up en herstel (bouwronde 7) ----
  const frame = await t4.put(`/api/projects/${projectId}/cover`, { mode: 'frame', versionId: v2.versionId, time: 0.5 });
  ok('eigen frame als omslag', frame.status === 200 && frame.data.cover.mode === 'frame', String(frame.status));
  const coverBytes = Buffer.from(await (await fetch(`${base}${frame.data.cover.url}`, { headers: { cookie: t4.cookie() } })).arrayBuffer());
  await t4.put(`/api/pins/${projectId}`, { pinned: true });
  await t4.post('/api/backups', { label: 'ronde7' });
  for (let i = 0; i < 100 && (await t4.get('/api/backups')).data.job?.state === 'bezig'; i++) await new Promise((r2) => setTimeout(r2, 100));
  const b7 = (await t4.get('/api/backups')).data.backups[0];
  ok('back-up met omslag en vastgezette projecten', b7?.status === 'volledig');
  await t4.put(`/api/projects/${projectId}/cover`, { mode: 'auto' });
  await t4.put(`/api/pins/${projectId}`, { pinned: false });
  await stop(srv);
  await restoreBackup({ backupPath: path.join(env.BACKUP_DIR, b7.name), dataDir: env.DATA_DIR, mediaDir: path.join(env.DATA_DIR, 'media') });
  srv = await start(REPO);
  const t5 = client(base);
  await t5.post('/api/login', { email: 'sanne@agency.nl', password: 'een-lang-wachtwoord' });
  const p5 = (await t5.get(`/api/projects/${projectId}`)).data;
  const bytes5 = Buffer.from(await (await fetch(`${base}${p5.cover.url}`, { headers: { cookie: t5.cookie() } })).arrayBuffer());
  ok('na herstel: eigen frame terug (zelfde beeld)', p5.cover.mode === 'frame' && Buffer.compare(bytes5, coverBytes) === 0);
  ok('na herstel: vastgezet project weer vastgezet', p5.pinned === true);
  await stop(srv);

  fs.rmSync(T, { recursive: true, force: true });
  console.log(fails ? `\n${fails} FOUT(EN)` : '\nAlle controles geslaagd');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
