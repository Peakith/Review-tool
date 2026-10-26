'use strict';
// Videobestanden naar een andere locatie verplaatsen (bijv. een externe schijf):
//   npm run verplaats-opslag -- "/Volumes/Opslag/Studio Review/media"
// De app moet gestopt zijn. Bestanden worden gekopieerd en gecontroleerd; daarna wordt
// MEDIA_DIR opgeslagen in ~/Studio Review/instellingen.env. De oude map blijft bewaard.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { loadConfig, isInside } = require('../server/config');
const { assertNotRunning } = require('../server/lock');
const { diskFree } = require('../server/storage');
const { copyWithHash, sha256File } = require('../server/backup');
const { gb, ask, yes, positional, fail } = require('./lib/cli');

function setSetting(file, key, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : ['# Instellingen voor Studio Review (blijven bewaard bij updates).'];
  const line = `${key}="${value}"`;
  const i = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  if (i >= 0) lines[i] = line; else lines.push(line);
  fs.writeFileSync(file, `${lines.filter((l, idx) => l || idx < lines.length - 1).join('\n')}\n`);
}

(async () => {
  const config = loadConfig();
  const target = positional()[0] ? path.resolve(positional()[0]) : null;
  if (!target) fail('Geef de nieuwe map op, bijv.: npm run verplaats-opslag -- "/Volumes/Opslag/Studio Review/media"');
  if (path.resolve(config.mediaDir) === target) fail('De video\'s staan al op deze locatie.');
  if (isInside(target, config.mediaDir) || isInside(config.mediaDir, target)) fail('De nieuwe map mag niet binnen de huidige map liggen (of andersom).');
  try { assertNotRunning(config.dataDir, 'verplaats de opslag'); } catch (err) { fail(err.message); }
  const parts = target.split(path.sep);
  if (parts[1] === 'Volumes' && !fs.existsSync(path.join('/', 'Volumes', parts[2] || ''))) fail(`De schijf “${parts[2]}” is niet aangesloten.`);
  if (fs.existsSync(target) && (await fsp.readdir(target)).some((n) => !n.startsWith('.'))) fail(`${target} is niet leeg. Kies een lege of nieuwe map.`);
  if (!fs.existsSync(config.mediaDir)) fail(`De huidige opslag (${config.mediaDir}) is niet bereikbaar.`);

  const files = (await fsp.readdir(config.mediaDir, { withFileTypes: true })).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name);
  let bytes = 0;
  for (const f of files) bytes += (await fsp.stat(path.join(config.mediaDir, f))).size;
  const disk = await diskFree(target);
  if (disk.free < bytes + config.minFreeBytes) fail(`Onvoldoende ruimte op de nieuwe locatie: nodig ${gb(bytes)} plus reserve ${gb(config.minFreeBytes)}, beschikbaar ${gb(disk.free)}.`);

  console.log(`Video's verplaatsen: ${files.length} bestand(en), ${gb(bytes)}`);
  console.log(`  van:  ${config.mediaDir}\n  naar: ${target}`);
  if (!yes(await ask('Doorgaan? (j/n) '))) fail('Afgebroken; er is niets gewijzigd.');

  await fsp.mkdir(target, { recursive: true });
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const copied = await copyWithHash(path.join(config.mediaDir, f), path.join(target, f));
      if ((await sha256File(path.join(target, f))).sha256 !== copied.sha256) throw new Error(`Kopie van ${f} klopt niet.`);
      if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${files.length}`);
    }
  } catch (err) {
    for (const f of files) await fsp.rm(path.join(target, f), { force: true });
    fail(`Kopiëren mislukt; er is niets gewijzigd.\n${err.message}`);
  }
  setSetting(config.settingsFile, 'MEDIA_DIR', target);
  console.log(`\n✓ ${files.length} bestand(en) gekopieerd en gecontroleerd.`);
  console.log(`MEDIA_DIR is opgeslagen in ${config.settingsFile}.`);
  console.log(`De oude map ${config.mediaDir} is bewaard; verwijder die pas als alles werkt.`);
})();
