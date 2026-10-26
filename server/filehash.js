'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');

/**
 * SHA-256 van een bestand, gestreamd (grote video's komen nooit in één keer in het geheugen).
 * Gebruikt voor het herkennen van identieke uploads: zelfde inhoud = zelfde hash, ongeacht de naam.
 */
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file, { highWaterMark: 1024 * 1024 })
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Bestaande versies (van vóór deze update) krijgen op de achtergrond alsnog een hash, één tegelijk,
 * zodat ook dubbele uploads van oudere bestanden worden herkend. Stopt netjes bij afsluiten.
 */
function startHashBackfill({ db, storage, delayMs = 2000 }) {
  let stopped = false;
  let timer = null;
  async function step() {
    timer = null;
    if (stopped) return;
    let row = null;
    try {
      if (!storage.status().ok) return schedule(60_000);
      row = db.prepare("SELECT id, stored_name FROM versions WHERE sha256 IS NULL AND (sha256_error IS NULL OR sha256_error = '') ORDER BY id LIMIT 1").get();
      if (!row) return schedule(5 * 60_000);
      const file = storage.localPath(row.stored_name);
      const digest = fs.existsSync(file) ? await hashFile(file) : null;
      if (stopped) return;
      if (digest) db.prepare('UPDATE versions SET sha256 = ? WHERE id = ?').run(digest, row.id);
      else db.prepare("UPDATE versions SET sha256_error = 'bestand ontbreekt' WHERE id = ?").run(row.id);
    } catch (err) {
      if (stopped) return;
      try { if (row) db.prepare('UPDATE versions SET sha256_error = ? WHERE id = ?').run(String(err.message).slice(0, 200), row.id); } catch { /* database dicht */ }
    }
    schedule(50);
  }
  function schedule(ms) { if (!stopped) { timer = setTimeout(step, ms); timer.unref?.(); } }
  schedule(delayMs);
  return { stop() { stopped = true; if (timer) clearTimeout(timer); } };
}

module.exports = { hashFile, startHashBackfill };
