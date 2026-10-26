'use strict';
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const { now } = require('./db');
const { HttpError } = require('./status');
const { intParam } = require('./access');
const { posterKey } = require('./views');
const { makeFrame, resolveTools } = require('./media');

/**
 * Projectcovers en persoonlijk vastzetten (bouwronde 7).
 *
 * Cover = een afzonderlijke projectkeuze; video's, thumbnails, titels en bestanden blijven ongemoeid.
 *  - auto (standaard): de thumbnail van de hoofdvideo, anders van de video met de meeste recente activiteit;
 *  - version: de thumbnail van een gekozen versie;
 *  - frame: een frame uit een gekozen versie, als eigen bestand (`cover-<project>-<willekeurig>.jpg`).
 * Verdwijnt de bron (versie of video weggegooid, project verplaatst), dan valt de cover terug op auto.
 * Klanten en freelancers krijgen alleen een cover uit een gedeelde versie (`sharedOnly`); anders de
 * automatische keuze uit gedeelde versies, of niets (veilige terugval in de interface).
 *
 * Vastzetten: per gebruiker (project_pins). Verleent nooit toegang: lijsten tonen alleen projecten die
 * de gebruiker nu mag zien, dus een verlopen of ingetrokken koppeling verdwijnt ook uit de favorieten.
 */
const KIND_ORDER = { main: 0, teaser: 1, cutdown: 2, social: 3, other: 4 };

function usableVersion(db, project, versionId, { sharedOnly }) {
  if (!versionId) return null;
  const ver = db.prepare('SELECT * FROM versions WHERE id = ?').get(versionId);
  if (!ver || ver.trashed_at) return null;
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(ver.video_id);
  if (!video || video.trashed_at || video.project_id !== project.id) return null;
  if (sharedOnly && !ver.shared_at) return null;
  return ver;
}

/** Automatische keuze: hoofdvideo eerst, dan de meest recente activiteit; nieuwste (gedeelde) versie met thumbnail. */
function autoSource(db, project, { sharedOnly }) {
  const videos = db.prepare('SELECT * FROM videos WHERE project_id = ? AND trashed_at IS NULL').all(project.id)
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 5) - (KIND_ORDER[b.kind] ?? 5) || String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
  for (const v of videos) {
    const ver = db.prepare(`SELECT * FROM versions WHERE video_id = ? AND trashed_at IS NULL AND has_poster = 1 ${sharedOnly ? 'AND shared_at IS NOT NULL' : ''} ORDER BY number DESC LIMIT 1`).get(v.id);
    if (ver) return { mode: 'auto', key: posterKey(ver), versionId: ver.id };
  }
  return null;
}

/** Welke afbeelding is de cover van dit project, voor dit publiek? */
function coverSource(db, project, { sharedOnly = false } = {}) {
  if (project.cover_mode === 'frame' && project.cover_key) {
    if (usableVersion(db, project, project.cover_version_id, { sharedOnly })) return { mode: 'frame', key: project.cover_key, versionId: project.cover_version_id };
  } else if (project.cover_mode === 'version') {
    const ver = usableVersion(db, project, project.cover_version_id, { sharedOnly });
    if (ver && ver.has_poster) return { mode: 'version', key: posterKey(ver), versionId: ver.id };
  }
  return autoSource(db, project, { sharedOnly });
}

/** Adres met versie-aanduiding, zodat een nieuwe keuze direct zichtbaar is (de afbeelding zelf wordt niet gecachet). */
function coverDto(db, project, base, opts = {}) {
  const src = coverSource(db, project, opts);
  if (!src) return null;
  const stamp = crypto.createHash('sha1').update(`${src.key}|${project.cover_updated_at || ''}`).digest('hex').slice(0, 10);
  return { url: `${base}?c=${stamp}`, mode: project.cover_mode || 'auto', effective: src.mode, versionId: opts.sharedOnly ? undefined : src.versionId };
}

async function sendCover(res, storage, db, project, opts) {
  const src = coverSource(db, project, opts);
  if (!src) throw new HttpError(404, 'Geen cover', 'not_found');
  try {
    await storage.send(res, src.key, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' });
  } catch (err) {
    if (res.headersSent) throw err;
    // Bestand onverwacht weg: terugvallen op de automatische keuze.
    const auto = autoSource(db, project, opts);
    if (!auto || auto.key === src.key) throw new HttpError(404, 'Geen cover', 'not_found');
    await storage.send(res, auto.key, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' });
  }
}

const pinnedSet = (db, userId) => new Set(db.prepare('SELECT project_id FROM project_pins WHERE user_id = ?').all(userId).map((r) => r.project_id));

function coverTeamRoutes(router, db, config, { access, storage }) {
  router.get('/projects/:id/cover', async (req, res) => {
    const { project } = access.project(req, req.params.id, 'read', { allowTrashed: false });
    await sendCover(res, storage, db, project, { sharedOnly: false });
  });

  // Omslag wijzigen: alleen Projectleider of beheerder. Video's en thumbnails blijven ongewijzigd.
  router.put('/projects/:id/cover', async (req, res) => {
    const { project } = access.project(req, req.params.id, 'manage');
    const body = req.body || {};
    const old = project.cover_key;
    if (body.mode === 'auto') {
      db.prepare("UPDATE projects SET cover_mode = 'auto', cover_version_id = NULL, cover_time = NULL, cover_key = NULL, cover_updated_at = ? WHERE id = ?").run(now(), project.id);
    } else if (body.mode === 'version' || body.mode === 'frame') {
      const ver = usableVersion(db, project, Number(body.versionId), { sharedOnly: false });
      if (!ver) throw new HttpError(400, 'Kies een versie van een video uit dit project.');
      if (body.mode === 'version') {
        if (!ver.has_poster) throw new HttpError(400, 'Deze versie heeft (nog) geen thumbnail. Kies een frame of een andere video.');
        db.prepare("UPDATE projects SET cover_mode = 'version', cover_version_id = ?, cover_time = NULL, cover_key = NULL, cover_updated_at = ? WHERE id = ?").run(ver.id, now(), project.id);
      } else {
        const at = Number(body.time);
        if (!Number.isFinite(at) || at < 0 || (ver.duration_seconds && at > ver.duration_seconds + 0.5)) throw new HttpError(400, 'Kies een moment binnen de video.');
        const tools = await resolveTools(config.tools);
        if (!tools.ffmpeg || !storage.localPath) throw new HttpError(503, 'ffmpeg ontbreekt; een frame als omslag kiezen is nu niet mogelijk.');
        const key = `cover-${project.id}-${crypto.randomBytes(6).toString('hex')}.jpg`;
        const tmp = `${storage.localPath(ver.stored_name)}.cover.tmp.jpg`;
        try {
          await makeFrame(storage.localPath(ver.stored_name), tmp, Math.min(at, Math.max(0, (ver.duration_seconds || at) - 0.05)), tools);
          await storage.importFile(tmp, key);
        } catch (err) {
          await fsp.rm(tmp, { force: true });
          throw new HttpError(500, `Het frame kon niet worden gemaakt: ${err.message}`);
        }
        db.prepare("UPDATE projects SET cover_mode = 'frame', cover_version_id = ?, cover_time = ?, cover_key = ?, cover_updated_at = ? WHERE id = ?").run(ver.id, at, key, now(), project.id);
      }
    } else {
      throw new HttpError(400, 'Kies automatisch, een thumbnail of een frame.');
    }
    // Het vorige frame-bestand is niet meer nodig.
    if (old && old !== db.prepare('SELECT cover_key FROM projects WHERE id = ?').get(project.id).cover_key) await storage.remove(old).catch(() => {});
    const fresh = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);
    res.json({ cover: coverDto(db, fresh, `/api/projects/${project.id}/cover`) });
  });

  // Persoonlijk vastzetten. Freelancers alleen in projecten waar hun koppeling nu geldt.
  router.put('/pins/:projectId', (req, res) => {
    const projectId = intParam(req.params.projectId);
    const p = db.prepare('SELECT * FROM projects WHERE id = ? AND trashed_at IS NULL').get(projectId);
    if (!p || !access.canAccess(req.user, projectId, req.user.isFreelancer ? 'feedback' : 'read')) throw new HttpError(404, 'Project niet gevonden');
    const on = req.body?.pinned === true;
    if (on) db.prepare('INSERT OR IGNORE INTO project_pins (user_id, project_id, created_at) VALUES (?, ?, ?)').run(req.user.id, projectId, now());
    else db.prepare('DELETE FROM project_pins WHERE user_id = ? AND project_id = ?').run(req.user.id, projectId);
    res.json({ pinned: on });
  });
}

module.exports = { coverSource, coverDto, sendCover, coverTeamRoutes, pinnedSet };
