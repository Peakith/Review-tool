'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// Programmacode (deze map) staat los van de blijvende gegevens. Een update vervangt de
// programmamap; gegevens, back-ups en instellingen staan daarbuiten in een vaste map.
const APP_DIR = path.resolve(__dirname, '..');
const LEGACY_DATA_DIR = path.join(APP_DIR, 'data');

/** Vaste basismap voor gegevens, back-ups en instellingen (standaard ~/Studio Review). */
function homeRoot(env = process.env) {
  return path.resolve(env.STUDIO_REVIEW_HOME || path.join(os.homedir(), 'Studio Review'));
}

/** Leest een eenvoudig KEY=waarde-bestand. Ontbreekt het, dan een leeg object. */
function parseEnvFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, idx).trim()] = value;
  }
  return out;
}

/**
 * Instellingen: echte omgevingsvariabelen (en het .env-bestand in de programmamap) gaan voor;
 * daarna ~/Studio Review/instellingen.env, dat een update van de programmamap overleeft.
 */
function effectiveEnv(baseEnv = process.env) {
  const root = homeRoot(baseEnv);
  return { root, settingsFile: path.join(root, 'instellingen.env'), env: { ...parseEnvFile(path.join(root, 'instellingen.env')), ...baseEnv } };
}

const hasDb = (dir) => fs.existsSync(path.join(dir, 'review.db'));

/**
 * Waar staan de gegevens?
 * 1. DATA_DIR als die is ingesteld (wordt altijd gerespecteerd);
 * 2. de vaste map ~/Studio Review/gegevens zodra daar een database staat;
 * 3. anders een bestaande oude map <programmamap>/data (nog niet verhuisd);
 * 4. anders (nieuwe installatie) de vaste map.
 */
function resolveDataDir(env, root) {
  if (env.DATA_DIR) return { dir: path.resolve(env.DATA_DIR), source: 'DATA_DIR', legacyDir: null };
  const fixed = path.join(root, 'gegevens');
  if (hasDb(fixed)) return { dir: fixed, source: 'vast', legacyDir: hasDb(LEGACY_DATA_DIR) ? LEGACY_DATA_DIR : null };
  if (hasDb(LEGACY_DATA_DIR)) return { dir: LEGACY_DATA_DIR, source: 'programmamap', legacyDir: LEGACY_DATA_DIR };
  return { dir: fixed, source: 'vast', legacyDir: null };
}

const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

function loadConfig(overrides = {}) {
  const { root, settingsFile, env } = effectiveEnv(overrides.env || process.env);
  const data = overrides.dataDir
    ? { dir: path.resolve(overrides.dataDir), source: 'test', legacyDir: null }
    : resolveDataDir(env, root);
  const dataDir = data.dir;
  const mediaConfigured = !!(overrides.mediaDir || env.MEDIA_DIR);
  const mediaDir = path.resolve(overrides.mediaDir || env.MEDIA_DIR || path.join(dataDir, 'media'));
  const backupDir = path.resolve(overrides.backupDir || env.BACKUP_DIR || path.join(root, 'backups'));

  return {
    appDir: APP_DIR,
    root,
    settingsFile,
    port: Number(env.PORT || 3000),
    dataDir,
    dataSource: data.source,
    legacyDataDir: data.legacyDir,
    dbFile: path.join(dataDir, 'review.db'),
    mediaDir,
    mediaConfigured,
    // Tijdelijke uploads staan op dezelfde schijf als de video's, zodat afronden een snelle verplaatsing is.
    uploadTmpDir: mediaConfigured ? path.join(mediaDir, '.uploads-tmp') : path.join(dataDir, 'uploads-tmp'),
    backupDir,
    backupDirInsideData: isInside(backupDir, dataDir) || isInside(dataDir, backupDir),
    // Publiek adres waarop klanten de app bereiken, gebruikt voor deel-links.
    publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
    // Zet op true achter HTTPS zodat cookies het Secure-attribuut krijgen.
    secureCookies: env.SECURE_COOKIES === 'true',
    maxUploadBytes: Number(env.MAX_UPLOAD_GB || 20) * 1024 ** 3,
    // Vrije ruimte die altijd over moet blijven op de schijf met video's.
    minFreeBytes: Number(env.MIN_FREE_GB ?? 5) * 1024 ** 3,
    chunkBytes: 8 * 1024 * 1024,
    sessionDays: 14,
    tools: {
      // Leeg = automatisch zoeken (PATH, /opt/homebrew/bin, /usr/local/bin, /usr/bin).
      ffprobe: env.FFPROBE_PATH || null,
      ffmpeg: env.FFMPEG_PATH || null,
    },
    // Uploads zonder inhoudscontrole alleen toestaan als dit expliciet is ingesteld (nooit in productie).
    allowUnverifiedUploads: env.ALLOW_UNVERIFIED_UPLOADS === 'true',
    // Afgebroken uploads zonder activiteit worden na deze tijd opgeruimd.
    uploadExpiryHours: Number(env.UPLOAD_EXPIRY_HOURS || 24),
    cleanupIntervalMinutes: Number(env.UPLOAD_CLEANUP_INTERVAL_MINUTES || 60),
    // Eenmalige code voor het eerste account. Zonder waarde genereert de server er een bij het starten.
    setupToken: env.SETUP_TOKEN || null,
    // Herkent "deze installatie" (programmamap + gegevensmap), bijvoorbeeld voor de startknop.
    instanceId: crypto.createHash('sha256').update(`${APP_DIR}|${dataDir}`).digest('hex').slice(0, 16),
    ...overrides,
  };
}

module.exports = { loadConfig, homeRoot, parseEnvFile, effectiveEnv, resolveDataDir, isInside, APP_DIR, LEGACY_DATA_DIR };
