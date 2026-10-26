// Ontwikkeltest: ZIP-update vanaf een vorige versie (standaard 0.8.0, 5ae74b6) zonder internet, met de echte startknop (Start Studio Review.command).
//  0. De vorige versie wordt "geïnstalleerd" zoals op de Mac: eerste start met internet (npm install vult
//     de npm-cache), daarna gegevens: account, project, gedeelde video, reviewlink, akkoordlink, goedkeuring.
//  1. Nieuwe versie vers uitgepakt (zonder node_modules), netwerk geblokkeerd, npm-cache van stap 0:
//     de startknop installeert uit de cache en start; gegevens en bestaande links werken.
//  2. Zelfde, maar met een lege npm-cache: de startknop stopt met een duidelijke melding; gegevens onaangeroerd.
//  3. Lege npm-cache, maar node_modules gekopieerd uit de map van de vorige versie: de startknop start zonder internet.
// Het netwerk wordt echt geblokkeerd met een eigen netwerknamespace (unshare -rn, alleen loopback).
// Vereist Linux met unshare en python3. Gebruik: npm run test:offline-update [-- <oude-commit>]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execSync } = require('child_process');
const REPO = path.resolve(__dirname, '..');

// ---- Binnen de afgesloten netwerkomgeving: startknop draaien en controleren ----
if (process.argv[2] === '--binnen') {
  const [, , , dir, cache, home, port, check] = process.argv;
  (async () => {
    // Alleen loopback aan; geen enkele route naar buiten.
    spawnSync('python3', ['-I', '-c', "import socket,fcntl,struct;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);fcntl.ioctl(s,0x8914,struct.pack('16sH14s',b'lo',0x49,b'\\0'*14))"], { stdio: 'inherit' });
    const net = await fetch('https://registry.npmjs.org/', { signal: AbortSignal.timeout(4000) }).then(() => 'bereikbaar', () => 'geblokkeerd');
    const env = { ...process.env, PORT: port, DATA_DIR: '', STUDIO_REVIEW_HOME: home, NO_BROWSER: '1', NON_INTERACTIVE: '1', npm_config_cache: cache, STUDIO_REVIEW_SEARCH: path.join(dir, '..', 'geen') };
    const started = Date.now();
    // Eigen procesgroep, zodat stoppen ook de launcher en de server meeneemt (zoals het venster sluiten).
    const child = spawn('bash', [path.join(dir, 'Start Studio Review.command')], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 1200 && child.exitCode === null; i++) {
      try { if ((await fetch(`${base}/api/session`)).ok) { up = true; break; } } catch { /* nog niet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    const result = { internet: net, up, seconds: Math.round((Date.now() - started) / 1000), exitCode: child.exitCode, log: log.slice(-1500) };
    if (up) {
      const c = JSON.parse(check);
      const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'review-tool' }, body: JSON.stringify({ email: 'sanne@agency.nl', password: 'een-lang-wachtwoord' }) });
      const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
      const video = await (await fetch(`${base}/api/videos/${c.videoId}`, { headers: { cookie } })).json();
      const session = await (await fetch(`${base}/api/session`, { headers: { cookie } })).json();
      result.login = login.status;
      result.version = session.version?.version;
      result.approval = video.versions?.[0]?.approval?.name || null;
      result.reviewLink = (await fetch(`${base}/api/review/${c.reviewer}`)).status;
      result.approverLink = (await fetch(`${base}/api/review/${c.approver}`)).status;
      result.restoreNotice = session.system?.restoreNotice ?? null;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* al gestopt */ }
      for (let i = 0; i < 40; i++) {
        try { await fetch(`${base}/api/session`); } catch { break; }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    process.stdout.write(`\nRESULTAAT ${JSON.stringify(result)}\n`);
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
  return;
}

// ---- Buiten: voorbereiden en de drie situaties draaien ----
const OLD_REV = process.argv[2] || '5ae74b6';
const { client, upload, makeVideo, rid } = require(path.join(REPO, 'test/helpers'));
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-update-'));
const DL = path.join(T, 'Downloads');
let fails = 0;
const ok = (n, c, d = '') => { if (!c) fails++; console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
const port = String(20000 + Math.floor(Math.random() * 20000));
const unzip = (rev, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  execSync(`git -C "${REPO}" archive ${rev} | tar -x -C "${dir}"`);
  // De nieuwe versie bevat ook nog niet gecommitte wijzigingen (zoals de ZIP die je zou maken).
  if (rev === 'HEAD') execSync(`cd "${REPO}" && git ls-files -m -o --exclude-standard | tar -cf - -T - | tar -xf - -C "${dir}"`);
};
const inside = (dir, cache, home, check) => {
  const r = spawnSync('unshare', ['-rn', process.execPath, __filename, '--binnen', dir, cache, home, port, JSON.stringify(check)], { encoding: 'utf8', timeout: 600_000 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULTAAT '));
  if (!line) throw new Error(`Geen resultaat:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(line.slice(10));
};

(async () => {
  if (spawnSync('unshare', ['-rn', 'true']).status !== 0) { console.error('unshare -rn is hier niet beschikbaar.'); process.exit(2); }
  const cache = path.join(T, 'npm-cache');
  const emptyCache = path.join(T, 'npm-cache-leeg');
  const home = path.join(T, 'Studio Review');

  // 0. Vorige versie: eerste start met internet (npm install vult de cache), daarna gegevens aanmaken
  const OLD = path.join(DL, 'Review-tool-vorige');
  unzip(OLD_REV, OLD);
  const inst = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: OLD, env: { ...process.env, npm_config_cache: cache }, encoding: 'utf8' });
  ok(`vorige versie (${OLD_REV}): eerste installatie met internet`, inst.status === 0, inst.stderr.slice(-200));
  const env = { ...process.env, PORT: port, DATA_DIR: '', STUDIO_REVIEW_HOME: home, SETUP_TOKEN: 'offline-test-code-123' };
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: OLD, env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/session`)).ok) break; } catch { /* nog niet */ } await new Promise((r) => setTimeout(r, 150)); }
  const team = client(base);
  await team.post('/api/setup', { setupToken: env.SETUP_TOKEN, email: 'sanne@agency.nl', name: 'Sanne', password: 'een-lang-wachtwoord' });
  const projectId = (await team.post('/api/projects', { name: 'Offline project' })).data.id;
  const file = makeVideo(T, 'film.mp4');
  const created = (await team.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(team, file, { projectId }), title: 'Film' })).data;
  await team.post(`/api/versions/${created.versionId}/ready`);
  await team.post(`/api/versions/${created.versionId}/share`, { requestId: rid() });
  await team.patch(`/api/videos/${created.videoId}`, { approverName: 'Joris', approverEmail: 'joris@klant.nl' });
  const approver = new URL((await team.post(`/api/videos/${created.videoId}/links`, { role: 'approver' })).data.url).pathname.split('/').pop();
  const reviewer = new URL((await team.get(`/api/videos/${created.videoId}`)).data.links.find((l) => l.role === 'reviewer').url).pathname.split('/').pop();
  const appr = await client(base).post(`/api/review/${approver}/versions/${created.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, { 'x-reviewer-key': 'offline-reviewer-key-01' });
  ok('vorige versie: gegevens met reviewlink, akkoordlink en goedkeuring', appr.status === 200);
  srv.kill('SIGTERM');
  await new Promise((r) => srv.once('exit', r));
  const check = { videoId: created.videoId, reviewer, approver };
  const dbFile = path.join(home, 'gegevens', 'review.db');
  const dbBefore = fs.statSync(dbFile).mtimeMs;

  // 1. Nieuwe ZIP, geen internet, npm-cache van de eerste installatie
  const A = path.join(DL, 'Review-tool-nieuw-a');
  unzip('HEAD', A);
  ok('nieuwe map is vers uitgepakt (geen node_modules)', !fs.existsSync(path.join(A, 'node_modules')));
  const a = inside(A, cache, home, check);
  ok('1. netwerk is echt geblokkeerd', a.internet === 'geblokkeerd');
  ok(`1. met gevulde npm-cache: onderdelen geïnstalleerd en app gestart zonder internet (${a.seconds} s)`, a.up && fs.existsSync(path.join(A, 'node_modules', 'pdfkit')), a.log.slice(-400));
  ok('1. versie, account, goedkeuring', a.login === 200 && a.version === require(path.join(A, 'package.json')).version && a.approval === 'Joris', JSON.stringify({ v: a.version, a: a.approval }));
  ok('1. bestaande review- en akkoordlink blijven werken (een ZIP-update raakt links niet)', a.reviewLink === 200 && a.approverLink === 200 && a.restoreNotice === null, `${a.reviewLink}/${a.approverLink}`);

  // 2. Nieuwe ZIP, geen internet, lege npm-cache
  const B = path.join(DL, 'Review-tool-nieuw-b');
  unzip('HEAD', B);
  const before2 = fs.statSync(dbFile).mtimeMs;
  const b = inside(B, emptyCache, home, check);
  ok(`2. met lege npm-cache: startknop stopt met een duidelijke melding (${b.seconds} s)`, !b.up && b.exitCode === 1 && /Installeren is mislukt/.test(b.log) && /kopieer de map node_modules/.test(b.log), b.log.slice(-500));
  ok('2. gegevens niet aangeraakt', fs.statSync(dbFile).mtimeMs === before2);

  // 3. Lege npm-cache, node_modules gekopieerd uit de vorige programmamap
  const C = path.join(DL, 'Review-tool-nieuw-c');
  unzip('HEAD', C);
  fs.cpSync(path.join(OLD, 'node_modules'), path.join(C, 'node_modules'), { recursive: true });
  const c = inside(C, emptyCache, home, check);
  ok(`3. node_modules uit de vorige map gekopieerd: start zonder internet en zonder cache (${c.seconds} s)`, c.up && c.login === 200 && c.reviewLink === 200, c.log.slice(-400));

  ok('de gegevens van de vorige versie zijn tijdens de test gebruikt (geen lege installatie)', dbBefore > 0);
  fs.rmSync(T, { recursive: true, force: true });
  console.log(fails ? `\n${fails} FOUT(EN)` : '\nAlle controles geslaagd');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
