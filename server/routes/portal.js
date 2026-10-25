'use strict';
const { now } = require('../db');
const auth = require('../auth');
const { HttpError } = require('../status');
const { portalDto, sharedVersions } = require('../client');
const { safeFileHeaders } = require('../files');
const { posterKey } = require('../views');
const { recordActivity, portalSource } = require('../activity');
const { activeDeliveries } = require('../deliveries');
const linkguard = require('../linkguard');
const { assertClientAccess, clientLanguage } = require('../clientportal');

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/**
 * Reviewlink die bij een projectlink hoort, voor één video. Wordt aangemaakt zodra de klant het
 * portaal opent, zodat reageren en feedback versturen precies zo werken als bij een gewone
 * reviewlink. Rol is altijd "reviewer": een projectlink geeft nooit goedkeuringsrechten.
 */
function portalReviewToken(db, projectLink, videoId) {
  return db.tx(() => {
    const existing = db.prepare('SELECT token, revoked_at FROM share_links WHERE project_link_id = ? AND video_id = ?').get(projectLink.id, videoId);
    if (existing && !existing.revoked_at) return existing.token;
    if (existing) return null; // los ingetrokken: niet stilzwijgend opnieuw openen
    const token = auth.randomToken(24);
    db.prepare(`INSERT INTO share_links (video_id, token, role, label, allow_download, created_by, created_at, project_link_id)
      VALUES (?, ?, 'reviewer', 'Via klantportaal', 0, ?, ?, ?)`).run(videoId, token, projectLink.created_by, now(), projectLink.id);
    return token;
  });
}

/** Verwijzing naar de opleverpagina in het portaal, als er definitieve bestanden zijn. */
function deliverySummary(db, project, url) {
  const n = activeDeliveries(db, project.id).filter((d) => !db.prepare('SELECT trashed_at FROM videos WHERE id = ?').get(d.video_id)?.trashed_at).length;
  return n ? { count: n, url } : null;
}

/** Klantportaal: één stabiele link per project, zonder account. */
function portalRoutes(router, db, config, { storage }) {
  router.use('/portal/:token', (req, res, next) => {
    const token = String(req.params.token || '');
    const link = TOKEN.test(token) ? db.prepare('SELECT * FROM project_links WHERE token = ?').get(token) : null;
    linkguard.guard(db, req, 'project', link);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(link.project_id);
    if (!project || project.trashed_at) return next(new HttpError(410, 'Dit project is niet meer beschikbaar. Neem contact op met het productieteam.', 'gone'));
    // Klanttoegang uit: het portaal en alles daaronder is geblokkeerd.
    assertClientAccess(project);
    req.projectLink = link;
    req.project = project;
    if (!link.last_used_at || Date.now() - Date.parse(link.last_used_at) > 60_000) {
      db.prepare('UPDATE project_links SET last_used_at = ? WHERE id = ?').run(now(), link.id);
    }
    next();
  });

  router.get('/portal/:token', (req, res) => {
    const base = `/api/portal/${req.projectLink.token}`;
    const dto = portalDto(db, req.project, {
      videoLink: (v) => {
        const t = portalReviewToken(db, req.projectLink, v.id);
        return t ? `/r/${t}` : null;
      },
      posterUrl: (v) => `${base}/videos/${v.id}/poster`,
      fileUrl: (b) => `${base}/briefing/${b.id}/file`,
    });
    recordActivity(db, req, { projectId: req.project.id, type: 'portal_opened', src: portalSource(req.projectLink) });
    const { visibleQuestions, questionDto } = require('../questions');
    res.json({ ...dto, questions: visibleQuestions(db, [req.project.id]).map((q) => ({ ...questionDto(db, q), projectName: req.project.name })), language: clientLanguage(db, req.project), linkExpiresAt: req.projectLink.expires_at || null, delivery: deliverySummary(db, req.project, `/p/${req.projectLink.token}/oplevering`) });
  });

  // Alleen de thumbnail van de gepubliceerde versie; nooit van een intern concept.
  router.get('/portal/:token/videos/:videoId/poster', async (req, res) => {
    const video = db.prepare('SELECT * FROM videos WHERE id = ? AND project_id = ? AND trashed_at IS NULL').get(Number(req.params.videoId), req.project.id);
    const ver = video ? sharedVersions(db, video.id)[0] : null;
    if (!ver || !ver.has_poster) throw new HttpError(404, 'Geen voorvertoning');
    await storage.send(res, posterKey(ver), { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' });
  });

  // Alleen gedeelde briefingbestanden; interne onderdelen bestaan voor de klant niet.
  router.get('/portal/:token/briefing/:itemId/file', async (req, res) => {
    const item = db.prepare("SELECT * FROM briefing_items WHERE id = ? AND project_id = ? AND kind = 'file' AND visibility = 'client' AND trashed_at IS NULL")
      .get(Number(req.params.itemId), req.project.id);
    if (!item) throw new HttpError(404, 'Dit bestand is niet beschikbaar.');
    await storage.send(res, item.file_key, safeFileHeaders({ mime: item.file_mime, filename: item.file_name, download: req.query.download === '1' }));
  });
}

module.exports = { portalRoutes, portalReviewToken, deliverySummary };
