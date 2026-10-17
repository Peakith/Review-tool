'use strict';
// Controleert of alles klaarstaat om de app te starten: npm run check
const fs = require('node:fs');
const { loadConfig } = require('../server/config');
const { resolveTools } = require('../server/media');

(async () => {
  const config = loadConfig();
  let ok = true;
  const line = (good, label, detail) => {
    if (!good) ok = false;
    console.log(`${good ? '✓' : '✗'} ${label}${detail ? `: ${detail}` : ''}`);
  };

  const [major, minor] = process.versions.node.split('.').map(Number);
  line(major > 22 || (major === 22 && minor >= 13), 'Node.js', `${process.versions.node} (minimaal 22.13 nodig)`);

  const tools = await resolveTools(config.tools);
  line(!!tools.ffprobe, 'ffprobe', tools.ffprobe || (config.tools.ffprobe
    ? `niet uitvoerbaar op ${config.tools.ffprobe} (controleer FFPROBE_PATH in .env)`
    : 'niet gevonden in PATH, /opt/homebrew/bin, /usr/local/bin of /usr/bin. Installeer met: brew install ffmpeg'));
  line(!!tools.ffmpeg, 'ffmpeg', tools.ffmpeg || 'niet gevonden (nodig voor thumbnails)');

  const hasDb = fs.existsSync(config.dbFile);
  console.log(`• Gegevensmap: ${config.dataDir}${hasDb ? '' : ' (nog leeg, wordt bij de eerste start aangemaakt)'}`);
  if (hasDb) {
    const { openDb } = require('../server/db');
    const db = openDb(config);
    const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    console.log(`• Inhoud: ${n('users')} account(s), ${n('projects')} project(en), ${n('videos')} video('s), ${n('versions')} versie(s)`);
    db.close();
  }
  console.log(`• Adres: http://localhost:${config.port}`);
  console.log(ok ? '\nAlles in orde. Start met: npm start' : '\nLos de punten met ✗ op en draai daarna opnieuw: npm run check');
  process.exitCode = ok ? 0 : 1;
})();
