'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { now } = require('./db');
const { HttpError } = require('./status');
const { extensionOf, FORMATS, probe, makePoster, resolveTools } = require('./media');
const { diskFree } = require('./storage');
const { ATTACHMENT_TYPES, checkAttachment, verifyContent } = require('./files');

/**
 * Hervatbare uploads in blokken. De browser stuurt blokken van ~8 MB met een
 * offset; een afgebroken blok wordt bij een nieuwe poging overschreven, zodat
 * grote bestanden niet in één keer hoeven te slagen.
 */
function uploadRoutes(router, db, config, { access, storage }) {
  // De map voor tijdelijke uploads pas aanmaken als de opslag bereikbaar is (een ontbrekende
  // externe schijf mag niet vervangen worden door een map op de interne schijf).
  const ensureTmpDir = () => { storage.assertReady(); fs.mkdirSync(config.uploadTmpDir, { recursive: true }); };
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

  /**
   * Is er genoeg ruimte voor `bytes` extra? Houdt rekening met de ingestelde vrije reserve
   * en met wat lopende uploads nog gaan innemen. Gooit 507 met een concrete melding.
   */
  async function assertSpace(bytes) {
    const disk = await diskFree(config.uploadTmpDir);
    const pending = db.prepare('SELECT COALESCE(SUM(size_bytes - received_bytes), 0) AS n FROM uploads').get().n;
    const needed = bytes + pending + config.minFreeBytes;
    if (disk.free < needed) {
      const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`;
      throw Object.assign(new HttpError(507,
        `Onvoldoende schijfruimte voor dit bestand. Nodig: ${gb(bytes)}${pending ? ` (plus ${gb(pending)} voor lopende uploads)` : ''} en een vrije reserve van ${gb(config.minFreeBytes)}; beschikbaar: ${gb(disk.free)}. Maak ruimte vrij (bijv. via Opslag › Prullenbak) of kies een andere opslaglocatie.`),
      { data: { free: disk.free, needed } });
    }
  }

  /** Waarvoor is de upload? Controleert het recht "uploaden" al vóór er data binnenkomt. */
  function uploadTarget(req) {
    const { projectId, videoId } = req.body || {};
    if (videoId) {
      const { video } = access.video(req, videoId, 'upload', { write: true });
      return { projectId: video.project_id, videoId: video.id };
    }
    if (projectId) {
      const { project } = access.project(req, projectId, 'upload', { write: true });
      return { projectId: project.id, videoId: null };
    }
    // Zonder doel alleen voor beheerders (scripts en oudere clients).
    if (!req.user.isAdmin) throw new HttpError(400, 'Geef aan voor welk project of welke video deze upload is.');
    return { projectId: null, videoId: null };
  }

  router.post('/uploads', async (req, res) => {
    // purpose: "video" (nieuwe video of versie) of "attachment" (bijlage bij de briefing van een project).
    const purpose = req.body?.purpose === 'attachment' ? 'attachment' : 'video';
    if (purpose === 'attachment' && !req.body?.projectId) throw new HttpError(400, 'Geef aan bij welk project deze bijlage hoort.');
    const target = uploadTarget(req);
    const { filename, size } = req.body || {};
    const bytes = Number(size);
    if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new HttpError(400, 'Ongeldige bestandsgrootte');
    if (purpose === 'attachment') {
      checkAttachment(filename, bytes, config.maxUploadBytes);
    } else {
      await assertMediaCheck();
      const ext = extensionOf(filename);
      if (!ext) throw new HttpError(400, `Dit bestandstype wordt niet ondersteund. Toegestaan: ${Object.keys(FORMATS).map((e) => '.' + e).join(', ')}`);
    }
    if (bytes > config.maxUploadBytes) throw new HttpError(413, `Bestand is te groot (maximaal ${Math.round(config.maxUploadBytes / 1024 ** 3)} GB)`);
    ensureTmpDir();
    await assertSpace(bytes);
    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(tmpPath(id), '');
    const at = now();
    db.prepare('INSERT INTO uploads (id, user_id, original_filename, size_bytes, project_id, video_id, purpose, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.user.id, path.basename(String(filename)), bytes, target.projectId, target.videoId, purpose, at, at);
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
  async function finalize(uploadId, user, target = {}) {
    const up = db.prepare('SELECT * FROM uploads WHERE id = ? AND user_id = ?').get(String(uploadId || ''), user.id);
    if (!up) throw new HttpError(400, 'Upload niet gevonden of verlopen. Start de upload opnieuw.');
    if (up.received_bytes !== up.size_bytes) throw new HttpError(400, 'De upload is nog niet compleet');
    if (up.purpose !== 'video') throw new HttpError(400, 'Deze upload is een bijlage, geen video.');
    // Een upload mag alleen worden gebruikt voor het project/de video waarvoor hij is gestart.
    if ((up.project_id && target.projectId && up.project_id !== target.projectId) || (up.video_id && up.video_id !== target.videoId)) {
      throw new HttpError(400, 'Deze upload hoort bij een ander project of een andere video.');
    }
    await assertMediaCheck();
    storage.assertReady();
    busy.add(up.id);
    try {
      const ext = extensionOf(up.original_filename);
      const storedName = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
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
      // Thumbnail maken vanuit het tijdelijke bestand, daarna beide in de opslag zetten.
      const posterTmp = `${source}.jpg`;
      const hasPoster = await makePoster(source, posterTmp, info?.duration, tools);
      await storage.importFile(source, storedName);
      if (hasPoster) await storage.importFile(posterTmp, `${storedName}.jpg`);
      db.prepare('DELETE FROM uploads WHERE id = ?').run(up.id);
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
   * Zet een voltooide bijlage-upload om naar een opgeslagen bestand, na controle van de inhoud.
   * Geeft { key, name, mime, size }.
   */
  async function finalizeAttachment(uploadId, user, projectId) {
    const up = db.prepare('SELECT * FROM uploads WHERE id = ? AND user_id = ?').get(String(uploadId || ''), user.id);
    if (!up) throw new HttpError(400, 'Upload niet gevonden of verlopen. Start de upload opnieuw.');
    if (up.purpose !== 'attachment') throw new HttpError(400, 'Deze upload is geen bijlage.');
    if (up.project_id !== projectId) throw new HttpError(400, 'Deze upload hoort bij een ander project.');
    if (up.received_bytes !== up.size_bytes) throw new HttpError(400, 'De upload is nog niet compleet');
    storage.assertReady();
    busy.add(up.id);
    try {
      const ext = checkAttachment(up.original_filename, up.size_bytes, config.maxUploadBytes);
      const source = tmpPath(up.id);
      try {
        await verifyContent(source, ext);
      } catch (err) {
        db.prepare('DELETE FROM uploads WHERE id = ?').run(up.id);
        await fsp.rm(source, { force: true });
        throw err;
      }
      const key = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
      await storage.importFile(source, key);
      db.prepare('DELETE FROM uploads WHERE id = ?').run(up.id);
      return { key, name: up.original_filename, mime: ATTACHMENT_TYPES[ext].mime, size: up.size_bytes };
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
    const names = await fsp.readdir(config.uploadTmpDir).catch(() => []);
    for (const name of names) {
      const id = name.replace(/\.part(\.jpg)?$/, '');
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

  /** Grootte van tijdelijke uploads (voor het opslagoverzicht). */
  async function tmpUsage() {
    let bytes = 0;
    let files = 0;
    for (const name of await fsp.readdir(config.uploadTmpDir).catch(() => [])) {
      const st = await fsp.stat(path.join(config.uploadTmpDir, name)).catch(() => null);
      if (st?.isFile()) { bytes += st.size; files++; }
    }
    return { bytes, files, active: db.prepare('SELECT COUNT(*) AS n FROM uploads').get().n };
  }

  return { finalize, finalizeAttachment, cleanupExpired, assertSpace, tmpUsage };
}

module.exports = { uploadRoutes };
