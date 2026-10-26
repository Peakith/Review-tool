'use strict';
// Back-up terugzetten: npm run herstel            (kiest uit een lijst)
//                      npm run herstel -- "<map>"  (een specifieke back-upmap)
//                      --links=herstellen          (links uit de back-up laten werken; standaard: ongeldig maken)
// De app moet gestopt zijn. Je huidige gegevens worden niet verwijderd maar hernoemd.
const path = require('node:path');
const { loadConfig } = require('../server/config');
const { listBackups, restoreBackup, activeLinkCounts } = require('../server/backup');
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

  // Klantlinks: vooraf laten zien wat er gebeurt. Standaard (veilig): alle links ongeldig maken.
  let counts;
  try { counts = activeLinkCounts(path.join(chosen, 'review.db')); } catch { fail('De database in deze back-up is niet leesbaar.'); }
  const flag = process.argv.find((a) => a.startsWith('--links='))?.split('=')[1];
  if (flag && !['ongeldig', 'herstellen'].includes(flag)) fail('Gebruik --links=ongeldig (standaard) of --links=herstellen.');
  let links = flag === 'herstellen' ? 'keep' : 'invalidate';
  console.log(`\nKlantlinks in deze back-up die nog geldig waren: ${counts.total}`);
  console.log(`  reviewlinks ${counts.reviewLinks} · akkoordlinks ${counts.approverLinks} · projectlinks (klantportaal) ${counts.projectLinks} · opleverlinks ${counts.deliveryLinks} · klantportaallinks ${counts.clientLinks ?? 0}`);
  console.log('\nEen back-up weet niet welke links je ná het maken ervan hebt ingetrokken. Kies wat er met de links gebeurt:');
  console.log('  1. Veilig (standaard): alle klantlinks ongeldig maken.');
  console.log('     Klanten met een oude link zien "ingetrokken". Je maakt daarna nieuwe links aan en deelt die opnieuw');
  console.log('     (Delen bij elke video, Klantportaal en Oplevering in het project). Goedkeuringen, reacties,');
  console.log('     opleveringen en geschiedenis blijven volledig bewaard.');
  console.log('  2. Links uit de back-up laten werken.');
  console.log('     LET OP: links die je ná deze back-up hebt ingetrokken (bijv. omdat ze bij de verkeerde persoon');
  console.log('     terechtkwamen), werken dan WEER.');
  if (!flag && counts.total) {
    const answer = await ask('Keuze [1]: ');
    if (answer === '2') links = 'keep';
    else if (answer && !['1', 'j', 'ja'].includes(answer.toLowerCase())) fail('Geen geldige keuze; er is niets gewijzigd.');
  }
  if (links === 'keep') {
    console.log('\n⚠ Je kiest ervoor de links uit de back-up te laten werken. Eerder ingetrokken links kunnen weer toegang geven.');
    if (!flag && !yes(await ask('Weet je dit zeker? (j/n) '))) fail('Afgebroken; er is niets gewijzigd.');
  } else if (counts.total) {
    console.log(`\n→ Alle ${counts.total} klantlink(s) worden ongeldig. Maak na het starten nieuwe links aan en deel ze met je klanten.`);
  }

  console.log(`\nTerugzetten: ${chosen}`);
  console.log(`naar:        ${config.dataDir}${config.mediaConfigured ? `\n en video's naar: ${config.mediaDir}` : ''}`);
  console.log('Je huidige gegevens worden bewaard als "<map>.voor-herstel-<datum>".');
  if (!yes(await ask('Doorgaan? (j/n) '))) fail('Afgebroken; er is niets gewijzigd.');

  try {
    const r = await restoreBackup({
      backupPath: chosen, dataDir: config.dataDir, mediaDir: config.mediaDir, links,
      onProgress: (p) => { if (p.phase === 'bestanden' && p.done % 20 === 0) process.stdout.write(`  bestanden ${p.done}/${p.total}\n`); },
    });
    const c = r.manifest.counts;
    console.log(`\n✓ Back-up van ${new Date(r.manifest.createdAt).toLocaleString('nl-NL')} is teruggezet en gecontroleerd.`);
    console.log(`  ${c.users} account(s), ${c.projects} project(en), ${c.videos} video('s), ${c.versions} versie(s), ${c.comments} reactie(s), ${c.share_links} link(s)`);
    console.log(links === 'keep'
      ? `  Klantlinks: zoals in de back-up (${counts.total} geldig). Controleer of daar links bij zitten die je later had ingetrokken.`
      : `  Klantlinks: ${counts.total} ongeldig gemaakt. Maak nieuwe links aan en deel ze opnieuw.`);
    if (r.keptData) console.log(`  Vorige gegevens bewaard in: ${r.keptData}`);
    if (r.keptMedia) console.log(`  Vorige video's bewaard in:  ${r.keptMedia}`);
    console.log('\nStart de app opnieuw om verder te werken.');
  } catch (err) {
    fail(`Herstel mislukt; je huidige gegevens zijn ongewijzigd.\n${err.message}`);
  }
})();
