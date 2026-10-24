// Ontwikkeltest: bijwerken vanaf een vorige versie (standaard a0d99e8 = 0.4.0, bouwronde 3) met echte gegevens.
//  1. vorige versie (zonder .git) maakt account, project, video met twee versies, reviewlink, klantreactie,
//     feedback, teamnotitie en -antwoord, akkoordlink en goedkeuring, en een back-up;
//  2. de nieuwe code start op dezelfde gegevens: alles werkt nog, teamnotities zijn intern, antwoorden aan
//     de klant blijven zichtbaar, klantportaal werkt;
//  3. de back-up van de vorige versie wordt met de nieuwe code teruggezet en werkt; de klantlinks uit
//     die back-up zijn daarbij (veilige standaard) ongeldig gemaakt.
// Gebruik: npm run test:upgrade [-- <oude-commit>]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, execSync } = require('child_process');
const REPO = path.resolve(__dirname, '..');
const OLD_REV = process.argv[2] || 'a0d99e8';
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
  const backups = await listBackups(env.BACKUP_DIR);
  ok('back-up van de vorige versie staat in de lijst als volledig', backups.some((b) => b.name === oldBackup.name && b.status === 'volledig'));
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
  ok('na herstel: een nieuwe reviewlink werkt', (await fetch(`${base}/api/review/${freshLink}/versions/${v2.versionId}/media`)).status === 200);
  ok('na herstel: projectlink van ná de back-up bestaat niet meer (zoals verwacht)', (await client(base).get(new URL(link.url).pathname.replace('/p/', '/api/portal/'))).status === 404);
  ok('na herstel: oplevering van ná de back-up bestaat niet (geen verzonnen gegevens)', (await t3.get(`/api/projects/${projectId}/deliveries`)).data.history.length === 0);
  await stop(srv);

  fs.rmSync(T, { recursive: true, force: true });
  console.log(fails ? `\n${fails} FOUT(EN)` : '\nAlle controles geslaagd');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
