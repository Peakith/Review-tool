'use strict';
const path = require('node:path');

function loadConfig(overrides = {}) {
  const dataDir = path.resolve(overrides.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  return {
    port: Number(process.env.PORT || 3000),
    dataDir,
    dbFile: path.join(dataDir, 'review.db'),
    mediaDir: path.join(dataDir, 'media'),
    uploadTmpDir: path.join(dataDir, 'uploads-tmp'),
    // Publiek adres waarop klanten de app bereiken, gebruikt voor deel-links.
    publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
    // Zet op true achter HTTPS zodat cookies het Secure-attribuut krijgen.
    secureCookies: process.env.SECURE_COOKIES === 'true',
    maxUploadBytes: Number(process.env.MAX_UPLOAD_GB || 20) * 1024 ** 3,
    chunkBytes: 8 * 1024 * 1024,
    sessionDays: 14,
    tools: {
      ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
      ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
    },
    // Uploads zonder inhoudscontrole alleen toestaan als dit expliciet is ingesteld (nooit in productie).
    allowUnverifiedUploads: process.env.ALLOW_UNVERIFIED_UPLOADS === 'true',
    // Afgebroken uploads zonder activiteit worden na deze tijd opgeruimd.
    uploadExpiryHours: Number(process.env.UPLOAD_EXPIRY_HOURS || 24),
    cleanupIntervalMinutes: Number(process.env.UPLOAD_CLEANUP_INTERVAL_MINUTES || 60),
    // Eenmalige code voor het eerste account. Zonder waarde genereert de server er een bij het starten.
    setupToken: process.env.SETUP_TOKEN || null,
    ...overrides,
  };
}

module.exports = { loadConfig };
