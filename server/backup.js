'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sqlite = require('node:sqlite');
const { pipeline } = require('node:stream/promises');
const { diskFree } = require('./storage');
const { VERSION } = require('./build');

/**
 * Back-ups: een map per back-up met
 *   review.db      consistente kopie van de database (SQLite-backup-API, ook tijdens gebruik)
 *   media/         alle videobestanden en thumbnails waar die database naar verwijst
 *   manifest.json  wat erin zit, wanneer, controlesommen en of hij volledig is
 * Een back-up in aanmaak heet "<naam>.bezig" en krijgt pas zijn definitieve naam (en
 * manifest) als alles gekopieerd en gecontroleerd is. Bestanden worden gestreamd,
 * dus ook grote video's passen niet in één keer in het werkgeheugen.
 */
const FORMAT = 1;
const COUNT_TABLES = ['users', 'projects', 'videos', 'versions', 'comments', 'share_links', 'feedback_rounds', 'approvals'];

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}

/** Gestreamde kopie met controlesom; overschrijft nooit een bestaand bestand. */
async function copyWithHash(src, dest) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  await pipeline(
    fs.createReadStream(src),
    async function* (source) { for await (const chunk of source) { hash.update(chunk); bytes += chunk.length; yield chunk; } },
    fs.createWriteStream(dest, { flags: 'wx' }),
  );
  return { bytes, sha256: hash.digest('hex') };
}

/** Consistente kopie van een (mogelijk in gebruik zijnde) database. */
async function snapshotDb(db, dest) {
  if (typeof sqlite.backup === 'function') {
    await sqlite.backup(db, dest);
  } else {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  }
}

function inspectDb(file) {
  const db = new sqlite.DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    const counts = {};
    for (const t of COUNT_TABLES) counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    const files = [];
    for (const v of db.prepare('SELECT stored_name, has_poster, size_bytes FROM versions ORDER BY id').all()) {
      files.push({ key: v.stored_name, expectedBytes: v.size_bytes });
      if (v.has_poster) files.push({ key: `${v.stored_name}.jpg`, expectedBytes: null });
    }
    return { integrityOk: Object.values(integrity)[0] === 'ok', counts, files };
  } finally {
    db.close();
  }
}

/**
 * Maakt een back-up. `db` is de open database (mag in gebruik zijn), `storage` levert de bestanden.
 * onProgress({ phase, done, total, bytes }).
 */
async function createBackup({ db, config, storage, label = '', onProgress = () => {} }) {
  if (config.backupDirInsideData) {
    throw new Error(`De back-upmap (${config.backupDir}) ligt binnen de gegevensmap of andersom. Kies met BACKUP_DIR een map daarbuiten.`);
  }
  storage.assertReady();
  fs.mkdirSync(config.backupDir, { recursive: true });
  const name = `studio-review_${stamp()}${label ? `_${label.replace(/[^a-z0-9-]+/gi, '-').slice(0, 30)}` : ''}`;
  const work = path.join(config.backupDir, `${name}.bezig`);
  const final = path.join(config.backupDir, name);
  await fsp.mkdir(path.join(work, 'media'), { recursive: true });
  try {
    onProgress({ phase: 'database', done: 0, total: 1, bytes: 0 });
    const dbFile = path.join(work, 'review.db');
    await snapshotDb(db, dbFile);
    const snap = inspectDb(dbFile);

    // Ruimte controleren vóór het kopiëren van de bestanden.
    let needed = (await fsp.stat(dbFile)).size;
    for (const f of snap.files) needed += (await storage.size(f.key)) || 0;
    const disk = await diskFree(config.backupDir);
    if (disk.free < needed) {
      throw new Error(`Onvoldoende ruimte op de back-upschijf: nodig ${(needed / 1024 ** 3).toFixed(1)} GB, beschikbaar ${(disk.free / 1024 ** 3).toFixed(1)} GB.`);
    }

    const files = [];
    const missing = [];
    let bytes = 0;
    for (let i = 0; i < snap.files.length; i++) {
      const f = snap.files[i];
      onProgress({ phase: 'bestanden', done: i, total: snap.files.length, bytes });
      if (!(await storage.exists(f.key))) { missing.push(f.key); continue; }
      const copied = await storage.copyOut(f.key, path.join(work, 'media', f.key));
      if (f.expectedBytes !== null && copied.bytes !== f.expectedBytes) missing.push(f.key);
      files.push({ key: f.key, bytes: copied.bytes, sha256: copied.sha256 });
      bytes += copied.bytes;
    }
    const dbHash = await sha256File(dbFile);
    const manifest = {
      format: FORMAT,
      app: 'studio-review',
      appVersion: VERSION,
      createdAt: new Date().toISOString(),
      label,
      source: { dataDir: config.dataDir, mediaDir: config.mediaDir },
      database: { file: 'review.db', bytes: dbHash.bytes, sha256: dbHash.sha256, integrityOk: snap.integrityOk },
      counts: snap.counts,
      files,
      missingFiles: missing,
      totalBytes: bytes + dbHash.bytes,
      complete: snap.integrityOk && missing.length === 0,
    };
    // Manifest als laatste: zonder manifest geldt een back-up als onvoltooid.
    await fsp.writeFile(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await fsp.rename(work, final);
    onProgress({ phase: 'klaar', done: snap.files.length, total: snap.files.length, bytes });
    return { dir: final, name, manifest };
  } catch (err) {
    await fsp.rm(work, { recursive: true, force: true });
    throw err;
  }
}

/** Alle back-ups in een map, nieuwste eerst, met status volledig / onvolledig / afgebroken. */
async function listBackups(backupDir) {
  const out = [];
  for (const entry of await fsp.readdir(backupDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(backupDir, entry.name);
    if (entry.name.endsWith('.bezig')) {
      out.push({ name: entry.name, dir, status: 'afgebroken', createdAt: null, totalBytes: null, counts: null, note: 'Deze back-up is niet afgemaakt (bijv. door afsluiten tijdens het maken). Niet bruikbaar voor herstel.' });
      continue;
    }
    let manifest;
    try { manifest = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8')); } catch { continue; }
    if (manifest.app !== 'studio-review') continue;
    out.push({
      name: entry.name,
      dir,
      status: manifest.complete ? 'volledig' : 'onvolledig',
      createdAt: manifest.createdAt,
      appVersion: manifest.appVersion,
      label: manifest.label,
      totalBytes: manifest.totalBytes,
      counts: manifest.counts,
      fileCount: manifest.files.length,
      missingFiles: manifest.missingFiles,
      kind: manifest.databaseOnly ? 'alleen database' : 'volledig (database + bestanden)',
      note: manifest.complete ? null : `${manifest.missingFiles.length} bestand(en) ontbraken of klopten niet bij het maken van deze back-up.`,
    });
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Controleert een back-up: manifest, database-integriteit en elk bestand (grootte, en bij
 * deep ook de sha256-controlesom). Geeft { ok, problems, manifest }.
 */
async function verifyBackup(dir, { deep = true } = {}) {
  const problems = [];
  let manifest;
  try { manifest = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8')); } catch {
    return { ok: false, problems: ['manifest.json ontbreekt of is onleesbaar'], manifest: null };
  }
  const dbFile = path.join(dir, 'review.db');
  if (!fs.existsSync(dbFile)) problems.push('review.db ontbreekt');
  else {
    const h = await sha256File(dbFile);
    if (h.sha256 !== manifest.database.sha256) problems.push('review.db is gewijzigd of beschadigd (controlesom klopt niet)');
    try { if (!inspectDb(dbFile).integrityOk) problems.push('database-integriteitscontrole mislukt'); } catch (e) { problems.push(`database onleesbaar: ${e.message}`); }
  }
  for (const f of manifest.files) {
    const file = path.join(dir, 'media', f.key);
    const st = await fsp.stat(file).catch(() => null);
    if (!st) { problems.push(`bestand ontbreekt: ${f.key}`); continue; }
    if (st.size !== f.bytes) { problems.push(`bestand heeft verkeerde grootte: ${f.key}`); continue; }
    if (deep && (await sha256File(file)).sha256 !== f.sha256) problems.push(`controlesom klopt niet: ${f.key}`);
  }
  if (manifest.missingFiles?.length) problems.push(`${manifest.missingFiles.length} bestand(en) waren al niet aanwezig bij het maken`);
  return { ok: problems.length === 0, problems, manifest };
}

/**
 * Zet een back-up terug in `dataDir` (en `mediaDir`). De huidige gegevens worden NIET
 * verwijderd maar hernoemd naar "<map>.voor-herstel-<tijd>". Eerst wordt alles in een
 * tijdelijke map opgebouwd en gecontroleerd; pas daarna wordt omgewisseld.
 */
async function restoreBackup({ backupPath, dataDir, mediaDir, allowIncomplete = false, onProgress = () => {} }) {
  const check = await verifyBackup(backupPath, { deep: true });
  const onlyMissing = check.problems.every((p) => p.includes('waren al niet aanwezig'));
  if (!check.ok && !(allowIncomplete && onlyMissing)) {
    throw new Error(`De back-up is niet in orde:\n- ${check.problems.join('\n- ')}`);
  }
  const { manifest } = check;
  const ts = stamp();
  const mediaInside = path.resolve(mediaDir).startsWith(path.resolve(dataDir) + path.sep);
  const stageData = `${dataDir}.herstel-${ts}`;
  const stageMedia = mediaInside ? path.join(stageData, path.relative(dataDir, mediaDir)) : `${mediaDir}.herstel-${ts}`;

  const needed = manifest.totalBytes;
  const disk = await diskFree(path.dirname(dataDir));
  if (disk.free < needed) throw new Error(`Onvoldoende ruimte om te herstellen: nodig ${(needed / 1024 ** 3).toFixed(1)} GB, beschikbaar ${(disk.free / 1024 ** 3).toFixed(1)} GB.`);

  await fsp.mkdir(stageData, { recursive: true });
  await fsp.mkdir(stageMedia, { recursive: true });
  try {
    onProgress({ phase: 'database' });
    const dbCopy = await copyWithHash(path.join(backupPath, 'review.db'), path.join(stageData, 'review.db'));
    if (dbCopy.sha256 !== manifest.database.sha256) throw new Error('Kopie van de database klopt niet met de back-up.');
    for (let i = 0; i < manifest.files.length; i++) {
      const f = manifest.files[i];
      onProgress({ phase: 'bestanden', done: i, total: manifest.files.length });
      const copied = await copyWithHash(path.join(backupPath, 'media', f.key), path.join(stageMedia, f.key));
      if (copied.sha256 !== f.sha256) throw new Error(`Kopie van ${f.key} klopt niet met de back-up.`);
    }
    const restored = inspectDb(path.join(stageData, 'review.db'));
    if (!restored.integrityOk) throw new Error('De herstelde database is niet in orde.');
    for (const t of COUNT_TABLES) {
      if (restored.counts[t] !== manifest.counts[t]) throw new Error(`Aantal ${t} na herstel (${restored.counts[t]}) wijkt af van de back-up (${manifest.counts[t]}).`);
    }
  } catch (err) {
    await fsp.rm(stageData, { recursive: true, force: true });
    if (!mediaInside) await fsp.rm(stageMedia, { recursive: true, force: true });
    throw err;
  }

  // Omwisselen; de huidige gegevens blijven bewaard naast de herstelde.
  const keptData = fs.existsSync(dataDir) ? `${dataDir}.voor-herstel-${ts}` : null;
  if (keptData) await fsp.rename(dataDir, keptData);
  await fsp.rename(stageData, dataDir);
  let keptMedia = null;
  if (!mediaInside) {
    if (fs.existsSync(mediaDir)) { keptMedia = `${mediaDir}.voor-herstel-${ts}`; await fsp.rename(mediaDir, keptMedia); }
    await fsp.rename(stageMedia, mediaDir);
  }
  return { manifest, keptData, keptMedia };
}

module.exports = { createBackup, listBackups, verifyBackup, restoreBackup, snapshotDb, inspectDb, copyWithHash, sha256File, stamp, COUNT_TABLES };
