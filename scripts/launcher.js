'use strict';
// Startknop: wordt aangeroepen door "Start Studio Review.command" (of: npm run launch).
//  1. controleert Node, ffprobe en ffmpeg (dezelfde controles als npm run check);
//  2. draait deze installatie al? → opent de bestaande sessie in de browser;
//  3. gebruikt een andere installatie of een ander programma de poort? → duidelijke melding,
//     er wordt niets gestopt;
//  4. anders: start de server (zelfde code als npm start) en opent de browser.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { loadConfig } = require('../server/config');
const { resolveTools } = require('../server/media');
const { readLock } = require('../server/lock');
const { versionInfo } = require('../server/build');
const { ask, yes, openReadOnly } = require('./lib/cli');

const APP_DIR = path.resolve(__dirname, '..');
const line = (s = '') => console.log(s);

async function health(port, timeout = 1500) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeout) });
    const data = await res.json().catch(() => null);
    return data?.app === 'studio-review' ? data : { foreign: true };
  } catch {
    return null; // niets dat op HTTP antwoordt
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

function openBrowser(url) {
  if (process.env.NO_BROWSER === '1') { line(`(browser niet geopend: ${url})`); return; }
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [url], () => {});
}

function needsSetup(config) {
  if (!fs.existsSync(config.dbFile)) return true;
  try {
    const db = openReadOnly(config.dbFile);
    try { return db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0; } finally { db.close(); }
  } catch { return false; }
}

async function main() {
  let config = loadConfig();
  line(`Studio Review ${versionInfo().label}`);
  line(`Programma: ${APP_DIR}`);

  // ---- Controles ----
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(major > 22 || (major === 22 && minor >= 13))) {
    line(`✗ Node.js ${process.versions.node} is te oud (22.13 of nieuwer nodig). Werk bij met: brew upgrade node`);
    return 1;
  }
  const tools = await resolveTools(config.tools);
  line(`${tools.ffprobe ? '✓' : '✗'} ffprobe ${tools.ffprobe || 'niet gevonden: uploaden is uitgeschakeld tot je ffmpeg installeert (brew install ffmpeg)'}`);
  line(`${tools.ffmpeg ? '✓' : '!'} ffmpeg ${tools.ffmpeg || 'niet gevonden: nieuwe uploads krijgen geen thumbnail'}`);

  // ---- Draait deze installatie al? ----
  const lock = readLock(config.dataDir);
  if (lock) {
    const h = await health(lock.port);
    const url = `http://localhost:${lock.port}`;
    if (h && h.instanceId === config.instanceId) {
      line(`\nStudio Review draait al op ${url}. De bestaande sessie wordt geopend.`);
      openBrowser(url);
      return 0;
    }
    line(`\n✗ Deze gegevens (${config.dataDir}) worden al gebruikt door een andere Studio Review-installatie`);
    line(`  (proces ${lock.pid}${lock.appDir ? `, programmamap ${lock.appDir}` : ''}, poort ${lock.port}).`);
    line('  Stop die eerst met de Stop-knop in die programmamap. Er is niets gestopt.');
    return 2;
  }

  // ---- Is de poort vrij? ----
  const h = await health(config.port);
  if (h && !h.foreign) {
    if (h.instanceId === config.instanceId) {
      line(`\nStudio Review draait al op http://localhost:${config.port}. De bestaande sessie wordt geopend.`);
      openBrowser(`http://localhost:${config.port}`);
      return 0;
    }
    line(`\n✗ Op poort ${config.port} draait een andere Studio Review-installatie${h.appDir ? `:\n  programma ${h.appDir}\n  gegevens  ${h.dataDir}` : ''}.`);
    line(`  Stop die eerst (Stop-knop in die map), of kies een andere poort met PORT=${config.port + 1} in:\n  ${config.settingsFile}`);
    line('  Er is niets gestopt.');
    return 2;
  }
  if (!(await portFree(config.port))) {
    line(`\n✗ Poort ${config.port} is in gebruik door een ander programma.`);
    line(`  Kies een andere poort: zet PORT=${config.port + 1} in ${config.settingsFile} en start opnieuw.`);
    line('  Er is niets gestopt.');
    return 2;
  }

  // ---- Gegevens nog in de programmamap? Aanbieden om te verhuizen. ----
  if (config.dataSource === 'programmamap') {
    line(`\n! Je gegevens staan nog in de programmamap (${config.dataDir}).`);
    line(`  Bij een update met een nieuwe ZIP blijven ze daar achter. Verhuis ze naar ${path.join(config.root, 'gegevens')}.`);
    line('  De oude map blijft daarbij onaangeroerd en er wordt eerst een back-up gemaakt.');
    if (yes(await ask('  Nu verhuizen? (j/n) '))) {
      const { migrate } = require('./migrate-data');
      try {
        const r = await migrate({ source: config.dataDir, target: path.join(config.root, 'gegevens'), backupDir: config.backupDir, copyMedia: !config.mediaConfigured });
        line(`  ✓ Verhuisd: ${r.counts.projects} project(en), ${r.files} bestand(en).`);
        config = loadConfig();
      } catch (err) {
        line(`  ✗ Verhuizen mislukt, er is niets gewijzigd: ${err.message}`);
      }
    } else {
      line('  Overgeslagen. Je kunt dit later doen met: npm run verhuis');
    }
  }

  // ---- Starten ----
  const env = { ...process.env };
  let url = `http://localhost:${config.port}`;
  if (needsSetup(config) && !env.SETUP_TOKEN) {
    env.SETUP_TOKEN = crypto.randomBytes(18).toString('base64url');
    url += `/?setup=${env.SETUP_TOKEN}`;
  }
  line(`\nStarten op http://localhost:${config.port} …`);
  line('Laat dit venster open zolang je met Studio Review werkt.');
  line('Stoppen: druk hier op Ctrl+C, sluit dit venster, of dubbelklik "Stop Studio Review.command".\n');
  const envFile = fs.existsSync(path.join(APP_DIR, '.env')) ? ['--env-file=.env'] : [];
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...envFile, 'server/index.js'], { cwd: APP_DIR, env, stdio: 'inherit' });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));

  // Browser openen zodra de server antwoordt.
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) break;
    const ok = await health(config.port, 1000);
    if (ok && ok.instanceId === config.instanceId) { openBrowser(url); break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 0)));
}

main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
