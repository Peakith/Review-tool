'use strict';
// Back-up terugzetten: npm run herstel            (kiest uit een lijst)
//                      npm run herstel -- "<map>"  (een specifieke back-upmap)
// De app moet gestopt zijn. Je huidige gegevens worden niet verwijderd maar hernoemd.
const path = require('node:path');
const { loadConfig } = require('../server/config');
const { listBackups, restoreBackup } = require('../server/backup');
const { assertNotRunning } = require('../server/lock');
const { gb, ask, yes, positional, fail } = require('./lib/cli');

(async () => {
  const config = loadConfig();
  try { assertNotRunning(config.dataDir, 'voer het herstel'); } catch (err) { fail(err.message); }

  let chosen = positional()[0] ? path.resolve(positional()[0]) : null;
  if (!chosen) {
    const backups = (await listBackups(config.backupDir)).filter((b) => b.status === 'volledig' && b.kind.startsWith('volledig'));
    if (!backups.length) fail(`Geen volledige back-ups gevonden in ${config.backupDir}.`);
    console.log(`Back-ups in ${config.backupDir}:\n`);
    backups.forEach((b, i) => console.log(`  ${i + 1}. ${new Date(b.createdAt).toLocaleString('nl-NL')} · ${b.counts.projects} project(en), ${b.counts.versions} versie(s) · ${gb(b.totalBytes)}  [${b.name}]`));
    const answer = await ask('\nWelk nummer wil je terugzetten? ');
    const pick = backups[Number(answer) - 1];
    if (!pick) fail('Geen geldige keuze; er is niets gewijzigd.');
    chosen = pick.dir;
  }

  console.log(`\nTerugzetten: ${chosen}`);
  console.log(`naar:        ${config.dataDir}${config.mediaConfigured ? `\n en video's naar: ${config.mediaDir}` : ''}`);
  console.log('Je huidige gegevens worden bewaard als "<map>.voor-herstel-<datum>".');
  if (!yes(await ask('Doorgaan? (j/n) '))) fail('Afgebroken; er is niets gewijzigd.');

  try {
    const r = await restoreBackup({
      backupPath: chosen, dataDir: config.dataDir, mediaDir: config.mediaDir,
      onProgress: (p) => { if (p.phase === 'bestanden' && p.done % 20 === 0) process.stdout.write(`  bestanden ${p.done}/${p.total}\n`); },
    });
    const c = r.manifest.counts;
    console.log(`\n✓ Back-up van ${new Date(r.manifest.createdAt).toLocaleString('nl-NL')} is teruggezet en gecontroleerd.`);
    console.log(`  ${c.users} account(s), ${c.projects} project(en), ${c.videos} video('s), ${c.versions} versie(s), ${c.comments} reactie(s), ${c.share_links} link(s)`);
    if (r.keptData) console.log(`  Vorige gegevens bewaard in: ${r.keptData}`);
    if (r.keptMedia) console.log(`  Vorige video's bewaard in:  ${r.keptMedia}`);
    console.log('\nStart de app opnieuw om verder te werken.');
  } catch (err) {
    fail(`Herstel mislukt; je huidige gegevens zijn ongewijzigd.\n${err.message}`);
  }
})();
