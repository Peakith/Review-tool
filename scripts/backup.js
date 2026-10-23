'use strict';
// Back-up maken van database én videobestanden: npm run backup
// Mag ook terwijl de app draait (de database wordt via de SQLite-backup-API consistent gekopieerd).
const fs = require('node:fs');
const { loadConfig } = require('../server/config');
const { createLocalStorage } = require('../server/storage');
const { createBackup, verifyBackup } = require('../server/backup');
const { gb, openReadOnly, fail } = require('./lib/cli');

(async () => {
  const config = loadConfig();
  if (!fs.existsSync(config.dbFile)) fail(`Geen database gevonden in ${config.dataDir}.`);
  const storage = createLocalStorage(config);
  const st = storage.status();
  if (!st.ok) fail(st.reason);
  const db = openReadOnly(config.dbFile);
  console.log(`Back-up maken van ${config.dataDir}`);
  console.log(`naar ${config.backupDir} …`);
  let last = -1;
  try {
    const result = await createBackup({
      db, config, storage, label: 'handmatig',
      onProgress: (p) => {
        if (p.phase === 'bestanden' && p.total && Math.floor((p.done / p.total) * 10) !== last) {
          last = Math.floor((p.done / p.total) * 10);
          process.stdout.write(`  bestanden ${p.done}/${p.total} (${gb(p.bytes)})\n`);
        }
      },
    });
    const check = await verifyBackup(result.dir, { deep: false });
    const m = result.manifest;
    console.log(`\n${m.complete && check.ok ? '✓ Volledige back-up' : '⚠ Back-up ONVOLLEDIG'}: ${result.dir}`);
    console.log(`  ${m.counts.users} account(s), ${m.counts.projects} project(en), ${m.counts.videos} video('s), ${m.counts.versions} versie(s), ${m.counts.comments} reactie(s), ${m.counts.share_links} link(s)`);
    console.log(`  ${m.files.length} bestand(en), totaal ${gb(m.totalBytes)}`);
    if (!check.ok) console.log(`  Problemen:\n  - ${check.problems.join('\n  - ')}`);
  } catch (err) {
    fail(err.message);
  } finally {
    db.close();
  }
})();
