'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { HttpError } = require('./status');

/**
 * Opslag van videobestanden en thumbnails.
 *
 * De rest van de app gebruikt alleen deze interface (sleutels zoals "ab12….mp4"), nooit
 * rechtstreeks paden. Een latere online opslag (bijv. S3-compatibel) kan dezelfde
 * methodes aanbieden: send() wordt dan een doorverwijzing naar een tijdelijke URL.
 *
 *   status()                 → { ok, kind, location, reason }
 *   assertReady()            → gooit 503 als de opslag niet bereikbaar is
 *   send(res, key, headers)  → stuurt een bestand (met Range-ondersteuning)
 *   size(key) / exists(key)  → bestandsinformatie
 *   importFile(src, key)     → neemt een bestand op (verplaatsen of kopiëren)
 *   remove(key)              → verwijdert definitief
 *   copyOut(key, dest)       → gestreamde kopie met sha256 (voor back-ups)
 *   usage() / freeBytes()    → gebruik en vrije ruimte
 */
function createLocalStorage(config) {
  const dir = config.mediaDir;

  // Een externe schijf op macOS hangt onder /Volumes/<naam>. Ontbreekt die, dan maken we
  // de map NIET aan: anders zouden video's ongemerkt op de interne schijf belanden.
  function volumeOf(p) {
    const parts = path.resolve(p).split(path.sep);
    return parts[1] === 'Volumes' && parts[2] ? path.join('/', 'Volumes', parts[2]) : null;
  }

  function status() {
    if (fs.existsSync(dir)) {
      try { fs.accessSync(dir, fs.constants.W_OK | fs.constants.R_OK); } catch {
        return { ok: false, kind: 'local', location: dir, reason: `De opslagmap ${dir} is niet beschrijfbaar. Controleer de rechten van deze map.` };
      }
      return { ok: true, kind: 'local', location: dir, reason: null };
    }
    const volume = volumeOf(dir);
    if (volume && !fs.existsSync(volume)) {
      return { ok: false, kind: 'local', location: dir, reason: `De externe schijf “${path.basename(volume)}” is niet aangesloten. Sluit de schijf aan en ververs de pagina; bestaande video’s zijn tot dan niet beschikbaar.` };
    }
    if (config.mediaConfigured && !fs.existsSync(path.dirname(dir))) {
      return { ok: false, kind: 'local', location: dir, reason: `De opslagmap ${dir} bestaat niet. Controleer MEDIA_DIR in je instellingen.` };
    }
    // Standaardmap of een nieuwe map binnen een bestaande locatie: aanmaken.
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true, kind: 'local', location: dir, reason: null };
  }

  function assertReady() {
    const s = status();
    if (!s.ok) throw new HttpError(503, s.reason);
  }

  const fileOf = (key) => {
    if (!/^[A-Za-z0-9._-]+$/.test(key) || key.startsWith('.')) throw new HttpError(400, 'Ongeldige bestandsnaam');
    return path.join(dir, key);
  };

  function send(res, key, headers = {}) {
    assertReady();
    return new Promise((resolve, reject) => {
      res.sendFile(fileOf(key), { headers }, (err) => {
        if (!err) return resolve();
        if (err.code === 'ENOENT' && !res.headersSent) return reject(new HttpError(404, 'Bestand niet gevonden in de opslag.'));
        if (err.code === 'ECONNABORTED' || res.headersSent) return resolve(); // kijker sprong verder of sloot het venster
        reject(err);
      });
    });
  }

  async function size(key) {
    try { return (await fsp.stat(fileOf(key))).size; } catch { return null; }
  }
  const exists = async (key) => (await size(key)) !== null;

  async function importFile(src, key) {
    assertReady();
    const target = fileOf(key);
    try {
      await fsp.rename(src, target);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      // Andere schijf: kopiëren en daarna pas het origineel verwijderen.
      await fsp.copyFile(src, target);
      await fsp.rm(src, { force: true });
    }
  }

  async function writeFromPath(src, key) {
    assertReady();
    await fsp.copyFile(src, fileOf(key));
  }

  async function remove(key) {
    await fsp.rm(fileOf(key), { force: true });
  }

  /** Gestreamde kopie (nooit het hele bestand in het geheugen) met sha256 van de inhoud. */
  async function copyOut(key, dest) {
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    await pipeline(
      fs.createReadStream(fileOf(key)),
      async function* (source) { for await (const chunk of source) { hash.update(chunk); bytes += chunk.length; yield chunk; } },
      fs.createWriteStream(dest, { flags: 'wx' }),
    );
    return { bytes, sha256: hash.digest('hex') };
  }

  /** Totale grootte van alle bestanden in de opslagmap (los van de database). */
  async function usage() {
    if (!status().ok) return null;
    let bytes = 0;
    let files = 0;
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const s = await fsp.stat(path.join(dir, entry.name)).catch(() => null);
      if (s) { bytes += s.size; files++; }
    }
    return { bytes, files };
  }

  async function freeBytes() {
    if (!status().ok) return null;
    return diskFree(dir);
  }

  /** Pad op schijf (alleen bij lokale opslag; voor ffmpeg-bewerkingen zoals thumbnails). */
  const localPath = (key) => fileOf(key);

  return { kind: 'local', location: dir, localPath, status, assertReady, send, size, exists, importFile, writeFromPath, remove, copyOut, usage, freeBytes };
}

/** Vrije ruimte (voor gewone gebruikers beschikbaar) op de schijf waar `p` staat. */
async function diskFree(p) {
  let probe = path.resolve(p);
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const s = await fsp.statfs(probe);
  return { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
}

module.exports = { createLocalStorage, diskFree };
