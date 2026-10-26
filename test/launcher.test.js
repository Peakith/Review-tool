'use strict';
// Startknop (scripts/launcher.js) en stopknop (scripts/stop.js) als echte processen, in tijdelijke
// mappen. Wat macOS zelf doet (dubbelklik in Finder, `open` van de browser) zit hier niet in.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { startServer, setupAdmin } = require('./helpers');

const APP = path.resolve(__dirname, '..');
const NODE = [process.execPath, '--disable-warning=ExperimentalWarning'];

function freePort() {
  return new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

function env(home, port, extra = {}) {
  return { ...process.env, STUDIO_REVIEW_HOME: home, PORT: String(port), NO_BROWSER: '1', NON_INTERACTIVE: '1', DATA_DIR: '', MEDIA_DIR: '', BACKUP_DIR: '', SETUP_TOKEN: '', ...extra };
}

function run(script, e) {
  return new Promise((resolve) => execFile(NODE[0], [...NODE.slice(1), script], { cwd: APP, env: e }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr })));
}

/** Start de launcher op de achtergrond en wacht tot de server antwoordt (of de launcher stopt). */
async function launch(e, port) {
  const child = spawn(NODE[0], [...NODE.slice(1), 'scripts/launcher.js'], { cwd: APP, env: e, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && child.exitCode === null; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* nog niet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { child, output: () => out, exited: new Promise((r) => (child.exitCode !== null ? r(child.exitCode) : child.once('exit', r))) };
}

test('startknop: nieuwe map neemt gegevens van de vorige ZIP-installatie over; tweede klik opent bestaande sessie; stopknop stopt', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-launcher-'));
  const home = path.join(tmp, 'Studio Review');
  try {
    // Een "vorige installatie": uitgepakte ZIP met gegevens in de programmamap.
    const oldApp = path.join(tmp, 'Downloads', 'Review-tool-nieuw');
    const srv = await startServer({ dataDir: path.join(oldApp, 'data') });
    const admin = await setupAdmin(srv);
    await admin.post('/api/projects', { name: 'Project uit de oude map' });
    await srv.close(); // ruimt alleen de eigen tijdelijke mappen van de helper op, niet oldApp
    const oldDbBefore = fs.readFileSync(path.join(oldApp, 'data', 'review.db'));

    const port = await freePort();
    const e = env(home, port, { STUDIO_REVIEW_SEARCH: path.join(tmp, 'Downloads') });
    const first = await launch(e, port);
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(health.app, 'studio-review', first.output());
    assert.equal(health.dataDir, path.join(home, 'gegevens'), 'vaste gegevensmap in gebruik');
    assert.match(first.output(), /eerdere versie/);
    assert.match(first.output(), /Overgenomen en gecontroleerd: 1 account\(s\), 1 project\(en\)/);
    assert.ok(fs.existsSync(path.join(home, 'gegevens', '.studio-review.lock')), 'lock-bestand geschreven');
    assert.deepEqual(fs.readFileSync(path.join(oldApp, 'data', 'review.db')), oldDbBefore, 'oude map onaangeroerd');
    assert.ok(fs.readdirSync(path.join(home, 'backups')).some((n) => n.includes('voor-verhuizing')), 'eerst een back-up');

    // Inloggen met het oude account en het oude project zien.
    const login = await fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'review-tool' }, body: JSON.stringify({ email: 'beheer@agency.nl', password: 'een-lang-wachtwoord' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const projects = await (await fetch(`http://127.0.0.1:${port}/api/projects`, { headers: { cookie, 'x-requested-with': 'review-tool' } })).json();
    assert.ok(JSON.stringify(projects).includes('Project uit de oude map'));

    // Tweede klik: opent de bestaande sessie, start niets nieuws.
    const second = await run('scripts/launcher.js', e);
    assert.equal(second.code, 0);
    assert.match(second.out, /draait al op http:\/\/localhost:\d+\. De bestaande sessie wordt geopend/);

    // Stopknop
    const stop = await run('scripts/stop.js', e);
    assert.match(stop.out, /is gestopt/);
    assert.equal(await first.exited, 0);
    assert.ok(!fs.existsSync(path.join(home, 'gegevens', '.studio-review.lock')), 'lock-bestand opgeruimd');

    // Opnieuw starten: geen vraag meer, gegevens staan in de vaste map.
    const again = await launch(e, port);
    assert.doesNotMatch(again.output(), /eerdere versie/);
    await run('scripts/stop.js', e);
    await again.exited;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('startknop: poort bezet door een ander programma → melding, niets gestopt; stopknop raakt het niet aan', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-launcher-'));
  const other = net.createServer((s) => s.end('HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\n\r\nander programma'));
  try {
    const port = await new Promise((r) => other.listen(0, '127.0.0.1', () => r(other.address().port)));
    const e = env(path.join(tmp, 'Studio Review'), port, { STUDIO_REVIEW_SEARCH: path.join(tmp, 'leeg') });
    const r = await run('scripts/launcher.js', e);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /in gebruik door een ander programma/);
    assert.match(r.out, /Er is niets gestopt/);
    const s = await run('scripts/stop.js', e);
    assert.match(s.out, /draait niet\. Er is niets gestopt/);
    assert.ok(other.listening, 'het andere programma draait nog');
  } finally {
    other.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('startknop: andere Studio Review-installatie op dezelfde poort → melding, niets gestopt', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-launcher-'));
  const port = await freePort();
  const otherHome = path.join(tmp, 'andere');
  const first = await launch(env(otherHome, port, { STUDIO_REVIEW_SEARCH: path.join(tmp, 'leeg') }), port);
  try {
    // Zelfde programmamap, maar andere gegevens = andere installatie (ander installatie-ID).
    const e = env(path.join(tmp, 'Studio Review'), port, { STUDIO_REVIEW_SEARCH: path.join(tmp, 'leeg') });
    const r = await run('scripts/launcher.js', e);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /andere Studio Review-installatie/);
    const s = await run('scripts/stop.js', e);
    assert.equal(s.code, 2, s.out);
    assert.match(s.out, /Die wordt niet gestopt/);
    assert.ok((await fetch(`http://127.0.0.1:${port}/api/health`)).ok, 'de andere installatie draait nog');
  } finally {
    await run('scripts/stop.js', env(otherHome, port));
    await first.exited;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
