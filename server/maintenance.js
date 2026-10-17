'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { resolveTools, makePoster } = require('./media');

/**
 * Maakt alsnog een thumbnail voor versies die zonder ffmpeg zijn geüpload.
 * Draait op de achtergrond bij het starten; mislukte pogingen worden bij de volgende start herhaald.
 */
async function backfillPosters(db, config) {
  const tools = await resolveTools(config.tools);
  if (!tools.ffmpeg) return { created: 0, missing: 0, skipped: true };
  const rows = db.prepare('SELECT id, stored_name, duration_seconds FROM versions WHERE has_poster = 0').all();
  let created = 0;
  let missing = 0;
  for (const row of rows) {
    const file = path.join(config.mediaDir, row.stored_name);
    if (!fs.existsSync(file)) { missing++; continue; }
    if (await makePoster(file, `${file}.jpg`, row.duration_seconds, tools)) {
      db.prepare('UPDATE versions SET has_poster = 1 WHERE id = ?').run(row.id);
      created++;
    }
  }
  return { created, missing, skipped: false };
}

module.exports = { backfillPosters };
