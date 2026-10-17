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
    ...overrides,
  };
}

module.exports = { loadConfig };
