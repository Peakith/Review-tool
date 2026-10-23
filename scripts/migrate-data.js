'use strict';
// Gegevens eenmalig verhuizen uit de programmamap naar een vaste map: npm run verhuis
//   standaard: van <programmamap>/data  naar  ~/Studio Review/gegevens
//   of zelf kiezen: npm run verhuis -- --van "<map>" --naar "<map>"
// Veilig: de app moet gestopt zijn, eerst komt er een back-up van de database, alles wordt in een
// tijdelijke map gekopieerd en gecontroleerd, en de oorspronkelijke map blijft onaangeroerd.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { loadConfig, isInside } = require('../server/config');
const { assertNotRunning } = require('../server/lock');
const { diskFree } = require('../server/storage');
const { createDbBackup, snapshotDb, inspectDb, copyWithHash, sha256File, stamp, COUNT_TABLES } = require('../server/backup');
const { gb, ask, yes, openReadOnly, argValue, fail } = require('./lib/cli');

async function migrate({ source, target, backupDir, copyMedia = true, log = console.log }) {
  if (path.resolve(source) === path.resolve(target)) return { already: true };
  if (!fs.existsSync(path.join(source, 'review.db'))) throw new Error(`Geen database gevonden in ${source}.`);
  if (fs.existsSync(path.join(target, 'review.db'))) throw new Error(`In ${target} staan al gegevens. Er is niets gewijzigd; controleer welke map je wilt gebruiken.`);
  if (isInside(target, source) || isInside(source, target)) throw new Error('De nieuwe map mag niet binnen de oude map liggen (of andersom).');
  if (isInside(backupDir, source) || isInside(backupDir, target)) throw new Error('De back-upmap moet buiten de oude en de nieuwe gegevensmap liggen.');
  assertNotRunning(source, 'start de verhuizing');

  const sourceMedia = path.join(source, 'media');
  const mediaFiles = copyMedia && fs.existsSync(sourceMedia)
    ? (await fsp.readdir(sourceMedia, { withFileTypes: true })).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name)
    : [];
  let needed = (await fsp.stat(path.join(source, 'review.db'))).size;
  for (const f of mediaFiles) needed += (await fsp.stat(path.join(sourceMedia, f))).size;
  const disk = await diskFree(path.dirname(target));
  if (disk.free < needed * 1.05) throw new Error(`Onvoldoende ruimte voor de nieuwe map: nodig ${gb(needed)}, beschikbaar ${gb(disk.free)}.`);

  const db = openReadOnly(path.join(source, 'review.db'));
  const stage = `${target}.verhuis-${stamp()}`;
  try {
    // 1. Eerst een consistente back-up van de database (de bestanden blijven in het origineel staan).
    const safety = await createDbBackup({ db, backupDir, label: 'voor-verhuizing' });
    log(`✓ Back-up van de database: ${safety.dir}`);

    // 2. Alles naar een tijdelijke map kopiëren.
    await fsp.mkdir(path.join(stage, 'media'), { recursive: true });
    await snapshotDb(db, path.join(stage, 'review.db'));
    let done = 0;
    for (const f of mediaFiles) {
      const copied = await copyWithHash(path.join(sourceMedia, f), path.join(stage, 'media', f));
      const check = await sha256File(path.join(stage, 'media', f));
      if (check.sha256 !== copied.sha256) throw new Error(`Kopie van ${f} klopt niet.`);
      done++;
      if (done % 25 === 0) log(`  ${done}/${mediaFiles.length} bestanden gekopieerd`);
    }

    // 3. Controleren: database in orde, dezelfde aantallen, alle bestanden aanwezig.
    const before = inspectDb(path.join(source, 'review.db'));
    const after = inspectDb(path.join(stage, 'review.db'));
    if (!after.integrityOk) throw new Error('De gekopieerde database is niet in orde.');
    for (const t of COUNT_TABLES) if (before.counts[t] !== after.counts[t]) throw new Error(`Aantal ${t} wijkt af na kopiëren.`);
    if (copyMedia) {
      for (const f of after.files) {
        if (fs.existsSync(path.join(sourceMedia, f.key)) && !fs.existsSync(path.join(stage, 'media', f.key))) throw new Error(`Bestand ontbreekt na kopiëren: ${f.key}`);
      }
    }

    // 4. Pas nu de nieuwe map in gebruik nemen.
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) {
      // Lege of bijna lege doelmap (zonder database): opzijzetten in plaats van overschrijven.
      await fsp.rename(target, `${target}.leeg-${stamp()}`);
    }
    await fsp.rename(stage, target);
    return { counts: after.counts, files: mediaFiles.length, bytes: needed, safetyBackup: safety.dir };
  } catch (err) {
    await fsp.rm(stage, { recursive: true, force: true });
    throw err;
  } finally {
    db.close();
  }
}

module.exports = { migrate };

if (require.main === module) {
  (async () => {
    const config = loadConfig();
    const source = path.resolve(argValue('--van') || config.dataDir);
    const target = path.resolve(argValue('--naar') || path.join(config.root, 'gegevens'));
    if (source === target) {
      console.log(`Je gegevens staan al in de vaste map: ${target}`);
      if (config.legacyDataDir) console.log(`De oude map ${config.legacyDataDir} wordt niet meer gebruikt; je kunt hem na controle verwijderen.`);
      return;
    }
    console.log('Gegevens verhuizen');
    console.log(`  van:  ${source}`);
    console.log(`  naar: ${target}`);
    console.log(`  database-back-up vooraf in: ${config.backupDir}`);
    if (config.mediaConfigured) console.log(`  video's blijven op hun eigen locatie (MEDIA_DIR): ${config.mediaDir}`);
    console.log('De oude map blijft volledig bewaard.');
    if (!yes(await ask('Doorgaan? (j/n) '))) fail('Afgebroken; er is niets gewijzigd.');
    try {
      const r = await migrate({ source, target, backupDir: config.backupDir, copyMedia: !config.mediaConfigured });
      console.log(`\n✓ Verhuisd en gecontroleerd: ${r.counts.users} account(s), ${r.counts.projects} project(en), ${r.counts.versions} versie(s), ${r.files} bestand(en), ${gb(r.bytes)}.`);
      if (config.dataSource === 'DATA_DIR') {
        console.log(`\n! DATA_DIR is ingesteld. Verwijder of wijzig die regel (in .env of ${config.settingsFile}), anders gebruikt de app nog de oude map.`);
      }
      console.log(`\nDe app gebruikt vanaf nu ${target}.`);
      console.log(`De oude map ${source} is niet gewijzigd. Controleer eerst of alles werkt; daarna kun je hem verwijderen.`);
    } catch (err) {
      fail(`Verhuizen mislukt; je gegevens staan nog ongewijzigd in ${source}.\n${err.message}`);
    }
  })();
}
