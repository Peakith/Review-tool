'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { now } = require('./db');
const { HttpError } = require('./status');
const { extensionOf, FORMATS, probe, makePoster, resolveTools } = require('./media');

/**
 * Hervatbare uploads in blokken. De browser stuurt blokken van ~8 MB met een
 * offset; een afgebroken blok wordt bij een nieuwe poging overschreven, zodat
 * grote bestanden niet in één keer hoeven te slagen.
 */
function uploadRoutes(router, db, config) {
  fs.mkdirSync(config.uploadTmpDir, { recursive: true });
  const tmpPath = (id) => path.join(config.uploadTmpDir, `${id}.part`);
  // Uploads waarvoor nu een blok binnenkomt of die worden afgerond; de opruiming slaat deze over.
  const busy = new Set();

  /** Zonder ffprobe geen uploads, tenzij dat expliciet is toegestaan (alleen voor ontwikkeling). */
  async function assertMediaCheck() {
    if (config.allowUnverifiedUploads) return;
    if (!(await resolveTools(config.tools)).ffprobe) {
      throw new HttpError(503, 'Uploaden is uitgeschakeld: ffprobe (onderdeel van ffmpeg) ontbreekt op de server, waardoor de inhoud van bestanden niet kan worden gecontroleerd. Neem contact op met de beheerder.');
    }
  }

  const getUpload = (req) => {
    if (!/^[a-f0-9]{32}$/.test(req.params.id)) throw new HttpError(404, 'Upload niet gevonden');
    const up = db.prepare('SELECT * FROM uploads WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!up) throw new HttpError(404, 'Upload niet gevonden of verlopen. Start de upload opnieuw.');
    return up;
  };

  router.post('/uploads', async (req, res) => {
    await assertMediaCheck();
    const { filename, size } = req.body || {};
    const ext = extensionOf(filename);
    if (!ext) throw new HttpError(400, `Dit bestandstype wordt niet ondersteund. Toegestaan: ${Object.keys(FORMATS).map((e) => '.' + e).join(', ')}`);
    const bytes = Number(size);
    if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new HttpError(400, 'Ongeldige bestandsgrootte');
    if (bytes > config.maxUploadBytes) throw new HttpError(413, `Bestand is te groot (maximaal ${Math.round(config.maxUploadBytes / 1024 ** 3)} GB)`);
    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(tmpPath(id), '');
    const at = now();
    db.prepare('INSERT INTO uploads (id, user_id, original_filename, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, req.user.id, path.basename(String(filename)), bytes, at, at);
    res.status(201).json({ id, chunkSize: config.chunkBytes, receivedBytes: 0 });
  });

  router.get('/uploads/:id', (req, res) => {
    const up = getUpload(req);
    res.json({ id: up.id, receivedBytes: up.received_bytes, size: up.size_bytes });
  });

  router.put('/uploads/:id', (req, res, next) => {
    let up;
    try { up = getUpload(req); } catch (e) { return next(e); }
    const offset = Number(req.query.offset);
    if (offset !== up.received_bytes) {
      return res.status(409).json({ error: 'Onverwachte positie in upload', receivedBytes: up.received_bytes });
    }
    busy.add(up.id);
    const done = () => busy.delete(up.id);
    const maxChunk = config.chunkBytes + 1024;
    let written = 0;
    let failed = false;
    const out = fs.createWriteStream(tmpPath(up.id), { flags: 'r+', start: offset });
    req.on('data', (buf) => {
      written += buf.length;
      if (!failed && (written > maxChunk || offset + written > up.size_bytes)) {
        failed = true;
        req.unpipe(out);
        out.destroy();
        done();
        res.status(413).json({ error: 'Blok is groter dan toegestaan' });
        req.resume();
      }
    });
    req.on('aborted', () => { failed = true; out.destroy(); done(); });
    req.pipe(out);
    out.on('error', (err) => { done(); if (!failed) { failed = true; next(err); } });
    out.on('finish', () => {
      done();
      if (failed) return;
      const received = offset + written;
      db.prepare('UPDATE uploads SET received_bytes = ?, updated_at = ? WHERE id = ?').run(received, now(), up.id);
      res.json({ receivedBytes: received, complete: received === up.size_bytes });
    });
  });

  router.delete('/uploads/:id', async (req, res) => {
    const up = getUpload(req);
    db.prepare('DELETE FROM uploads WHERE id = ?').run(up.id);
    await fsp.rm(tmpPath(up.id), { force: true });
    res.json({ ok: true });
  });

  /**
   * Zet een voltooide upload om naar een opgeslagen mediabestand. Het bestand
   * krijgt een willekeurige, permanente naam die los staat van de videotitel.
   */
  async function finalize(uploadId, user) {
    const up = db.prepare('SELECT * FROM uploads WHERE id = ? AND user_id = ?').get(String(uploadId || ''), user.id);
    if (!up) throw new HttpError(400, 'Upload niet gevonden of verlopen. Start de upload opnieuw.');
    if (up.received_bytes !== up.size_bytes) throw new HttpError(400, 'De upload is nog niet compleet');
    await assertMediaCheck();
    busy.add(up.id);
    try {
      const ext = extensionOf(up.original_filename);
      const storedName = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
      fs.mkdirSync(config.mediaDir, { recursive: true });
      const target = path.join(config.mediaDir, storedName);
      const source = tmpPath(up.id);
      const stat = await fsp.stat(source);
      if (stat.size !== up.size_bytes) throw new HttpError(400, 'De upload is onvolledig, probeer het opnieuw');

      let info = null;
      const tools = await resolveTools(config.tools);
      if (tools.ffprobe) {
        try {
          info = await probe(source, ext, tools);
        } catch (err) {
          db.prepare('DELETE FROM uploads WHERE id = ?').run(up.id);
          await fsp.rm(source, { force: true });
          throw new HttpError(422, err.message);
        }
      }
      await fsp.rename(source, target);
      db.prepare('DELETE FROM uploads WHERE id = ?').run(up.id);
      const hasPoster = await makePoster(target, path.join(config.mediaDir, `${storedName}.jpg`), info?.duration, tools);
      return {
        originalFilename: up.original_filename,
        storedName,
        extension: ext,
        mimeType: FORMATS[ext],
        size: up.size_bytes,
        duration: info?.duration ?? null,
        width: info?.width ?? null,
        height: info?.height ?? null,
        hasPoster,
      };
    } finally {
      busy.delete(up.id);
    }
  }

  /**
   * Ruimt uploads op zonder activiteit sinds `uploadExpiryHours`, plus losse
   * .part-bestanden zonder databaserecord. Actieve uploads blijven staan.
   */
  async function cleanupExpired(at = Date.now()) {
    const cutoff = new Date(at - config.uploadExpiryHours * 3600_000).toISOString();
    const expired = db.prepare('SELECT id FROM uploads WHERE updated_at < ?').all(cutoff).filter((u) => !busy.has(u.id));
    for (const u of expired) {
      db.prepare('DELETE FROM uploads WHERE id = ? AND updated_at < ?').run(u.id, cutoff);
      await fsp.rm(tmpPath(u.id), { force: true });
    }
    let orphans = 0;
    const known = new Set(db.prepare('SELECT id FROM uploads').all().map((u) => u.id));
    for (const name of await fsp.readdir(config.uploadTmpDir)) {
      const id = name.replace(/\.part$/, '');
      if (known.has(id) || busy.has(id)) continue;
      const file = path.join(config.uploadTmpDir, name);
      const stat = await fsp.stat(file).catch(() => null);
      if (stat && stat.mtimeMs < at - config.uploadExpiryHours * 3600_000) {
        await fsp.rm(file, { force: true });
        orphans++;
      }
    }
    return { removed: expired.length, orphans };
  }

  return { finalize, cleanupExpired };
}

module.exports = { uploadRoutes };
