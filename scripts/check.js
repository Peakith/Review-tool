'use strict';
// Controleert of alles klaarstaat om de app te starten: npm run check
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../server/config');
const { resolveTools } = require('../server/media');
const { createLocalStorage, diskFree } = require('../server/storage');
const { listBackups } = require('../server/backup');
const { readLock } = require('../server/lock');
const { versionInfo } = require('../server/build');
const { gb } = require('./lib/cli');

(async () => {
  const config = loadConfig();
  let ok = true;
  const line = (good, label, detail) => {
    if (good === false) ok = false;
    const mark = good === true ? '✓' : good === false ? '✗' : '!';
    console.log(`${mark} ${label}${detail ? `: ${detail}` : ''}`);
  };

  console.log(`Studio Review ${versionInfo().label}`);
  console.log(`• Programma: ${config.appDir}\n`);

  const [major, minor] = process.versions.node.split('.').map(Number);
  line(major > 22 || (major === 22 && minor >= 13), 'Node.js', `${process.versions.node} (minimaal 22.13 nodig)`);

  const tools = await resolveTools(config.tools);
  line(!!tools.ffprobe, 'ffprobe', tools.ffprobe || (config.tools.ffprobe
    ? `niet uitvoerbaar op ${config.tools.ffprobe} (controleer FFPROBE_PATH)`
    : 'niet gevonden in PATH, /opt/homebrew/bin, /usr/local/bin of /usr/bin. Installeer met: brew install ffmpeg'));
  line(tools.ffmpeg ? true : null, 'ffmpeg', tools.ffmpeg || 'niet gevonden (nodig voor thumbnails)');

  console.log('');
  const sourceLabel = { vast: 'vaste gegevensmap', DATA_DIR: 'uit DATA_DIR', programmamap: 'NOG IN DE PROGRAMMAMAP' }[config.dataSource] || config.dataSource;
  line(config.dataSource === 'programmamap' ? null : true, 'Gegevens', `${config.dataDir} (${sourceLabel})`);
  if (config.dataSource === 'programmamap') console.log('  → Verhuis ze eenmalig naar een vaste map zodat updates ze niet raken: npm run verhuis');
  if (config.dataSource === 'vast' && config.legacyDataDir) console.log(`  (oude map ${config.legacyDataDir} wordt niet meer gebruikt; na controle mag je hem verwijderen)`);
  if (fs.existsSync(config.dbFile)) {
    const { openReadOnly } = require('./lib/cli');
    const db = openReadOnly(config.dbFile);
    const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    console.log(`  ${n('users')} account(s), ${n('projects')} project(en), ${n('videos')} video('s), ${n('versions')} versie(s)`);
    db.close();
  } else {
    console.log('  (nog leeg; wordt bij de eerste start aangemaakt)');
  }

  const storage = createLocalStorage(config);
  const st = storage.status();
  line(st.ok, "Video's", st.ok ? config.mediaDir : st.reason);
  if (st.ok) {
    const disk = await storage.freeBytes();
    const low = disk.free < config.minFreeBytes;
    line(low ? null : true, 'Vrije ruimte', `${gb(disk.free)} van ${gb(disk.total)} (reserve ${gb(config.minFreeBytes)})${low ? ' — uploads worden geweigerd tot er meer ruimte is' : ''}`);
  }

  line(config.backupDirInsideData ? false : true, 'Back-ups', config.backupDirInsideData ? `${config.backupDir} ligt binnen de gegevensmap; kies een andere map met BACKUP_DIR` : config.backupDir);
  const backups = await listBackups(config.backupDir);
  const last = backups.find((b) => b.status === 'volledig' && b.kind.startsWith('volledig'));
  console.log(`  ${backups.length} back-up(s)${last ? `, laatste volledige: ${new Date(last.createdAt).toLocaleString('nl-NL')}` : ', nog geen volledige back-up (maak er een met: npm run backup)'}`);
  if (fs.existsSync(path.dirname(config.backupDir))) {
    const disk = await diskFree(config.backupDir).catch(() => null);
    if (disk) console.log(`  vrij op de back-upschijf: ${gb(disk.free)}`);
  }

  console.log('');
  const lock = readLock(config.dataDir);
  console.log(lock ? `• Draait nu op http://localhost:${lock.port} (proces ${lock.pid})` : `• Draait niet. Adres na starten: http://localhost:${config.port}`);
  console.log(`• Instellingen die updates overleven: ${config.settingsFile}${fs.existsSync(config.settingsFile) ? '' : ' (nog niet aangemaakt)'}`);
  console.log(ok ? '\nAlles in orde. Start met de startknop of: npm start' : '\nLos de punten met ✗ op en draai daarna opnieuw: npm run check');
  process.exitCode = ok ? 0 : 1;
})();
