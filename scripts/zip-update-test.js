// Ontwikkeltest: de ZIP-update zoals op de Mac, gesimuleerd in tijdelijke mappen.
//  1. vorige versie (standaard e9e6f2b, zonder .git, gegevens in de programmamap) in Downloads/Review-tool-nieuw,
//     met account, project, video, reviewlink en klantreactie;
//  2. nieuwe versie uitgepakt in een nieuwe map; de startknop (launcher) vindt de vorige installatie en neemt
//     de gegevens over naar de vaste gegevensmap;
//  3. alles werkt nog (inloggen, video, link, reactie); daarna een volgende update met alleen een nieuwe programmamap.
// Gebruik: npm run test:update-zip [-- <oude-commit>]   (WORKTREE=1 neemt ook niet-gecommitte wijzigingen mee)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const { spawn, execSync, execFileSync } = require('child_process');
const REPO = path.resolve(__dirname, '..');
const OLD_REV = process.argv[2] || 'e9e6f2b';
const { client, upload, makeVideo } = require(REPO + '/test/helpers');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-update-'));
const DL = path.join(T, 'Downloads'), OLD = path.join(DL, 'Review-tool-nieuw'), NEW = path.join(DL, 'Review-tool-0.2.0');
const HOME = path.join(T, 'Studio Review');
let fails = 0; const ok = (n, c, d = '') => { if (!c) fails++; console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
async function waitUp(base, child) { for (let i = 0; i < 100 && child.exitCode === null; i++) { try { if ((await fetch(base + '/api/session')).ok) return true; } catch {} await new Promise((r) => setTimeout(r, 150)); } return false; }
(async () => {
  for (const [dir, rev] of [[OLD, OLD_REV], [NEW, 'HEAD']]) {
    fs.mkdirSync(dir, { recursive: true });
    execSync(`git -C ${REPO} archive ${rev} | tar -x -C "${dir}"`);
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  }
  // nieuwe map krijgt ook de nog niet gecommitte werkkopie
  if (process.env.WORKTREE) execSync(`cd ${REPO} && git ls-files -m -o --exclude-standard | tar -cf - -T - | tar -xf - -C "${NEW}"`);
  ok('geen .git in de ZIP-mappen', !fs.existsSync(path.join(OLD, '.git')) && !fs.existsSync(path.join(NEW, '.git')));
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), DATA_DIR: '', STUDIO_REVIEW_HOME: HOME, NO_BROWSER: '1', NON_INTERACTIVE: '1', STUDIO_REVIEW_SEARCH: DL };
  // ---- oude versie gebruiken ----
  const old = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: OLD, env: { ...env, SETUP_TOKEN: 'oude-versie-code-123' }, stdio: 'ignore' });
  await waitUp(base, old);
  const team = client(base);
  await team.post('/api/setup', { setupToken: 'oude-versie-code-123', email: 'sanne@agency.nl', name: 'Sanne', password: 'een-lang-wachtwoord' });
  const projectId = (await team.post('/api/projects', { name: 'Campagne 2026', clientName: 'Klant BV' })).data.id;
  const file = makeVideo(T, 'edit_v03.mp4');
  const uploadId = await upload(team, file);
  const video = (await team.post(`/api/projects/${projectId}/videos`, { uploadId, title: 'Hoofdvideo' })).data;
  const ver = (await team.get(`/api/videos/${video.videoId}`)).data.versions[0];
  await team.post(`/api/versions/${ver.id}/ready`); await team.post(`/api/versions/${ver.id}/share`);
  const v = (await team.get(`/api/videos/${video.videoId}`)).data;
  const token = new URL(v.links.find((l) => l.role === 'reviewer').url).pathname.split('/').pop();
  const guest = client(base);
  const c = await guest.post(`/api/review/${token}/versions/${ver.id}/comments`, { body: 'Logo te klein', timecode: 1.2, authorName: 'Eva' }, { 'x-reviewer-key': 'reviewer-key-00000001' });
  ok('oude versie: account, project, video, link en reactie aangemaakt', c.status === 201, `status ${c.status}`);
  old.kill('SIGTERM'); await new Promise((r) => old.once('exit', r));
  // ---- nieuwe versie: dubbelklik startknop ----
  const launcher = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/launcher.js'], { cwd: NEW, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; launcher.stdout.on('data', (d) => (out += d)); launcher.stderr.on('data', (d) => (out += d));
  await waitUp(base, launcher);
  console.log(out.split('\n').map((l) => '    | ' + l).join('\n'));
  ok('startknop vond de vorige installatie en nam de gegevens over', /Overgenomen en gecontroleerd/.test(out));
  const t2 = client(base);
  ok('inloggen met het bestaande account', (await t2.post('/api/login', { email: 'sanne@agency.nl', password: 'een-lang-wachtwoord' })).status === 200);
  const s = (await t2.get('/api/session')).data;
  ok('bestaand account is beheerder', s.user.isAdmin === true);
  const projects = (await t2.get('/api/projects')).data;
  ok('project aanwezig', JSON.stringify(projects).includes('Campagne 2026'));
  const v2 = (await t2.get(`/api/videos/${video.videoId}`)).data;
  ok('video met titel en versie aanwezig', v2.title === 'Hoofdvideo' && v2.versions.length === 1);
  const media = await fetch(`${base}/api/versions/${ver.id}/media`, { headers: { cookie: t2.cookie() } });
  ok('videobestand speelbaar (team)', media.status === 200 && Number(media.headers.get('content-length')) === fs.statSync(file).size);
  const g2 = client(base);
  const info = await g2.get(`/api/review/${token}`);
  ok('bestaande reviewlink werkt nog', info.status === 200, `status ${info.status}`);
  const comments = (await g2.get(`/api/review/${token}/versions/${ver.id}/comments`)).data;
  ok('klantreactie bewaard', Array.isArray(comments) && comments.some((x) => x.body === 'Logo te klein'));
  // Bouwronde 5: zonder downloadrecht speelt de klant via de afspeelversies (na de update alsnog gemaakt),
  // nooit via het origineel.
  let master = 0;
  for (let i = 0; i < 300 && master !== 200; i++) {
    master = (await fetch(`${base}/api/review/${token}/versions/${ver.id}/hls/master.m3u8`)).status;
    if (master !== 200) await new Promise((r) => setTimeout(r, 200));
  }
  const cm = await fetch(`${base}/api/review/${token}/versions/${ver.id}/media`);
  ok('klant kan video afspelen via de link (afspeelversie; origineel afgeschermd)', master === 200 && cm.status === 403, `${master}/${cm.status}`);
  ok('oude map onaangeroerd (database nog aanwezig)', fs.existsSync(path.join(OLD, 'data', 'review.db')));
  ok('gegevens staan nu buiten de programmamap', fs.existsSync(path.join(HOME, 'gegevens', 'review.db')) && !fs.existsSync(path.join(NEW, 'data')));
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/stop.js'], { cwd: NEW, env });
  await new Promise((r) => (launcher.exitCode !== null ? r() : launcher.once('exit', r)));
  // ---- volgende update: alleen de programmamap vervangen ----
  const NEWER = path.join(DL, 'Review-tool-0.2.1'); fs.cpSync(NEW, NEWER, { recursive: true, verbatimSymlinks: true }); fs.rmSync(NEW, { recursive: true });
  const l3 = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/launcher.js'], { cwd: NEWER, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out3 = ''; l3.stdout.on('data', (d) => (out3 += d));
  await waitUp(base, l3);
  const t3 = client(base); await t3.post('/api/login', { email: 'sanne@agency.nl', password: 'een-lang-wachtwoord' });
  ok('volgende update (nieuwe map, oude verwijderd): gegevens direct beschikbaar, geen vraag', JSON.stringify((await t3.get('/api/projects')).data).includes('Campagne 2026') && !/eerdere versie/.test(out3));
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/stop.js'], { cwd: NEWER, env });
  await new Promise((r) => (l3.exitCode !== null ? r() : l3.once('exit', r)));
  fs.rmSync(T, { recursive: true, force: true });
  console.log(fails ? `\n${fails} FOUT(EN)` : '\nAlle controles geslaagd'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
