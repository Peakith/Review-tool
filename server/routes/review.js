'use strict';
const { now } = require('../db');
const { HttpError, changeStatus, OPEN_FOR_CLIENT } = require('../status');
const { originalDownloadName, contentDisposition } = require('../media');
const { commentDtos, posterKey } = require('../views');
const { clientVideoInfo, sharedVersions: listShared } = require('../client');
const { cleanAnnotation, cleanTimes } = require('../annotations');
const { recordActivity, shareLinkSource, isFirstRequest } = require('../activity');

/**
 * Klant-API. Iedere aanvraag controleert opnieuw of de link bestaat en niet is
 * ingetrokken, en of de gevraagde versie bij deze video hoort en gedeeld is.
 */
function reviewRoutes(router, db, config, { storage }) {
  router.use('/review/:token', (req, res, next) => {
    const token = String(req.params.token || '');
    const link = /^[A-Za-z0-9_-]{20,64}$/.test(token)
      ? db.prepare('SELECT * FROM share_links WHERE token = ?').get(token)
      : null;
    if (!link) return next(new HttpError(404, 'Deze reviewlink bestaat niet.'));
    if (link.revoked_at) return next(new HttpError(410, 'Deze reviewlink is ingetrokken. Vraag het team om een nieuwe link.'));
    // Geopend via het klantportaal: geldig zolang de projectlink geldig is.
    if (link.project_link_id) {
      req.projectLink = db.prepare('SELECT * FROM project_links WHERE id = ?').get(link.project_link_id);
      if (!req.projectLink || req.projectLink.revoked_at) return next(new HttpError(410, 'Deze projectlink is ingetrokken. Vraag het team om een nieuwe link.'));
    }
    req.link = link;
    req.video = db.prepare('SELECT * FROM videos WHERE id = ?').get(link.video_id);
    if (!req.video) return next(new HttpError(404, 'Deze video bestaat niet meer.'));
    req.project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.video.project_id);
    // In de prullenbak: niet meer bereikbaar via klantlinks (ook niet de bestanden).
    // De link zelf blijft ongewijzigd, zodat herstellen de toegang terugbrengt.
    if (req.video.trashed_at || req.project.trashed_at) return next(new HttpError(410, 'Deze video is niet meer beschikbaar. Neem contact op met het productieteam.'));
    // Gearchiveerd: nog te bekijken, maar niet meer open voor reacties of goedkeuring.
    req.archived = !!(req.video.archived_at || req.project.archived_at);
    if (!link.last_used_at || Date.now() - Date.parse(link.last_used_at) > 60_000) {
      db.prepare('UPDATE share_links SET last_used_at = ? WHERE id = ?').run(now(), link.id);
    }
    next();
  });

  const sharedVersions = (videoId) => listShared(db, videoId);

  const getSharedVersion = (req) => {
    const id = Number(req.params.versionId);
    const ver = Number.isSafeInteger(id)
      ? db.prepare('SELECT * FROM versions WHERE id = ? AND video_id = ? AND shared_at IS NOT NULL AND trashed_at IS NULL').get(id, req.video.id)
      : null;
    if (!ver) throw new HttpError(404, 'Deze versie is niet beschikbaar.');
    return ver;
  };

  /** Feedback en goedkeuring kunnen alleen op de nieuwste gedeelde versie, als die open staat. */
  const assertActionable = (req, ver) => {
    if (req.archived) throw new HttpError(409, 'Dit project is gearchiveerd. Je kunt de video nog bekijken, maar niet meer reageren of goedkeuren.');
    const latest = sharedVersions(req.video.id)[0];
    if (!latest || latest.id !== ver.id) throw new HttpError(409, 'Er is inmiddels een nieuwere versie. Ververs de pagina om die te bekijken.');
    if (!OPEN_FOR_CLIENT.has(ver.status)) {
      throw new HttpError(409, ver.status === 'approved' ? 'Deze versie is al goedgekeurd.' : 'Deze versie staat op dit moment niet open voor review.');
    }
  };

  const reviewer = (req) => {
    if (req.link.role === 'approver') {
      return { name: req.link.approver_name, type: 'approver', verified: true };
    }
    const name = String(req.body?.authorName || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name) throw new HttpError(400, 'Vul je naam in zodat het team weet van wie de feedback komt.');
    return { name, type: 'guest', verified: false };
  };

  /**
   * Idempotentie: de browser stuurt per actie een eigen request-id mee en
   * gebruikt die opnieuw bij een herhaalpoging. Een herhaald verzoek wordt dan
   * herkend en verandert niets meer aan de status.
   */
  const requestId = (req, required) => {
    const id = String(req.body?.requestId || '');
    if (/^[A-Za-z0-9_-]{8,64}$/.test(id)) return id;
    if (required) throw new HttpError(400, 'Ontbrekende request-id. Ververs de pagina en probeer het opnieuw.');
    return null;
  };
  const currentStatus = (versionId) => db.prepare('SELECT status FROM versions WHERE id = ?').get(versionId).status;

  const reviewerKey = (req) => {
    const key = String(req.get('x-reviewer-key') || req.body?.reviewerKey || '');
    return /^[A-Za-z0-9_-]{16,64}$/.test(key) ? key : null;
  };

  router.get('/review/:token', (req, res) => {
    recordActivity(db, req, { projectId: req.project.id, type: 'review_opened', videoId: req.video.id, src: shareLinkSource(req.link) });
    res.json(clientVideoInfo(db, {
      video: req.video,
      project: req.project,
      role: req.link.role,
      allowDownload: !!req.link.allow_download,
      approverName: req.link.approver_name,
      archived: req.archived,
      portal: req.projectLink ? { url: `/p/${req.projectLink.token}` } : null,
    }));
  });

  router.get('/review/:token/versions/:versionId/comments', (req, res) => {
    const ver = getSharedVersion(req);
    // Interne teamnotities zijn nooit zichtbaar voor de klant.
    res.json(commentDtos(db, ver.id, { reviewerKey: reviewerKey(req), includeInternal: false }));
  });

  // Een losse reactie opslaan verandert de status niet.
  router.post('/review/:token/versions/:versionId/comments', (req, res) => {
    const ver = getSharedVersion(req);
    const reqId = requestId(req, false);
    if (reqId) {
      const prior = db.prepare('SELECT id, version_id FROM comments WHERE share_link_id = ? AND request_id = ?').get(req.link.id, reqId);
      if (prior && prior.version_id === ver.id) return res.status(200).json({ id: prior.id, replayed: true });
    }
    assertActionable(req, ver);
    const who = reviewer(req);
    const key = reviewerKey(req);
    if (!key) throw new HttpError(400, 'Ontbrekende reviewer-sleutel. Ververs de pagina.');
    const body = String(req.body?.body || '').trim();
    let parentId = null;
    let timecode = null;
    let timecodeEnd = null;
    let annotation = null;
    if (req.body?.parentId) {
      if (!body) throw new HttpError(400, 'Een reactie mag niet leeg zijn');
      const parent = db.prepare('SELECT id, version_id, parent_id, internal FROM comments WHERE id = ?').get(Number(req.body.parentId));
      if (!parent || parent.version_id !== ver.id || parent.internal) throw new HttpError(400, 'Reactie om op te antwoorden bestaat niet');
      parentId = parent.parent_id || parent.id;
      if (db.prepare('SELECT internal FROM comments WHERE id = ?').get(parentId)?.internal) throw new HttpError(400, 'Reactie om op te antwoorden bestaat niet');
    } else {
      ({ timecode, timecodeEnd } = cleanTimes(req.body || {}, ver.duration_seconds));
      annotation = cleanAnnotation(req.body?.annotation);
      if (annotation && timecode === null) throw new HttpError(400, 'Een tekening hoort bij een moment in de video.');
      if (!body && !annotation) throw new HttpError(400, 'Een reactie mag niet leeg zijn');
    }
    const info = db.prepare(`INSERT INTO comments (version_id, parent_id, body, timecode, timecode_end, annotation, author_name, author_type, share_link_id, reviewer_key, request_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ver.id, parentId, body.slice(0, 5000), timecode, timecodeEnd, annotation, who.name, who.type, req.link.id, key, reqId, now());
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  // Reviewers mogen hun eigen, nog niet verstuurde reactie verwijderen.
  router.delete('/review/:token/comments/:commentId', (req, res) => {
    const key = reviewerKey(req);
    const c = db.prepare('SELECT c.* FROM comments c JOIN versions v ON v.id = c.version_id WHERE c.id = ? AND v.video_id = ?')
      .get(Number(req.params.commentId), req.video.id);
    if (!c || !key || c.reviewer_key !== key || c.share_link_id !== req.link.id) throw new HttpError(404, 'Reactie niet gevonden');
    if (c.round_id) throw new HttpError(409, 'Verstuurde feedback kan niet meer worden verwijderd');
    db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
    res.json({ ok: true });
  });

  router.post('/review/:token/versions/:versionId/feedback', (req, res) => {
    const ver = getSharedVersion(req);
    const reqId = requestId(req, true);
    const who = reviewer(req);
    const key = reviewerKey(req);
    if (!key) throw new HttpError(400, 'Ontbrekende reviewer-sleutel. Ververs de pagina.');
    const message = String(req.body?.message || '').trim().slice(0, 5000);
    const result = db.tx(() => {
      // Herhaald verzoek voor een al verwerkte feedbackronde: niets wijzigen,
      // zodat een latere goedkeuring of handmatige correctie blijft staan.
      const prior = db.prepare('SELECT * FROM feedback_rounds WHERE share_link_id = ? AND request_id = ?').get(req.link.id, reqId);
      if (prior) {
        if (prior.version_id !== ver.id) throw new HttpError(409, 'Deze request-id hoort bij een andere versie.');
        return { roundId: prior.id, commentCount: prior.comment_count, replayed: true };
      }
      assertActionable(req, ver);
      const pending = db.prepare('SELECT id FROM comments WHERE version_id = ? AND share_link_id = ? AND reviewer_key = ? AND round_id IS NULL')
        .all(ver.id, req.link.id, key);
      if (!pending.length && !message) throw new HttpError(400, 'Plaats eerst een of meer reacties of schrijf een toelichting.');
      const info = db.prepare(`INSERT INTO feedback_rounds (version_id, share_link_id, reviewer_name, verified, message, comment_count, request_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(ver.id, req.link.id, who.name, who.verified ? 1 : 0, message, pending.length, reqId, now());
      const roundId = Number(info.lastInsertRowid);
      db.prepare('UPDATE comments SET round_id = ? WHERE version_id = ? AND share_link_id = ? AND reviewer_key = ? AND round_id IS NULL')
        .run(roundId, ver.id, req.link.id, key);
      if (message) {
        db.prepare(`INSERT INTO comments (version_id, body, timecode, author_name, author_type, share_link_id, reviewer_key, round_id, created_at)
          VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`).run(ver.id, message, who.name, who.type, req.link.id, key, roundId, now());
      }
      const label = who.verified ? `${who.name} (akkoordgever, geverifieerd)` : `${who.name} (opgegeven naam)`;
      changeStatus(db, ver.id, 'changes_requested', {
        event: 'feedback_submitted', actorType: who.type, actorLabel: label, shareLinkId: req.link.id,
        note: `${pending.length} reactie(s)${message ? ' + toelichting' : ''}`,
      });
      return { roundId, commentCount: pending.length, replayed: false };
    });
    res.json({ ok: true, ...result, status: currentStatus(ver.id) });
  });

  // Alleen de aangewezen akkoordgever (persoonlijke link) kan expliciet goedkeuren,
  // en alleen voor precies de versie die hij of zij bekijkt.
  router.post('/review/:token/versions/:versionId/approve', (req, res) => {
    if (req.link.role !== 'approver') throw new HttpError(403, 'Alleen de aangewezen akkoordgever kan deze versie goedkeuren.');
    if (req.body?.confirm !== true) throw new HttpError(400, 'Bevestig de goedkeuring expliciet.');
    const ver = getSharedVersion(req);
    const reqId = requestId(req, true);
    if (Number(req.body?.versionNumber) !== ver.number) throw new HttpError(409, 'De versie die je bekijkt komt niet overeen. Ververs de pagina.');
    if (req.link.approver_name !== req.video.approver_name || req.link.approver_email !== req.video.approver_email) {
      throw new HttpError(403, 'Deze akkoordlink hoort niet meer bij de huidige akkoordgever.');
    }
    const replayed = db.tx(() => {
      const prior = db.prepare('SELECT version_id FROM approvals WHERE share_link_id = ? AND request_id = ?').get(req.link.id, reqId);
      if (prior) {
        if (prior.version_id !== ver.id) throw new HttpError(409, 'Deze request-id hoort bij een andere versie.');
        return true;
      }
      assertActionable(req, ver);
      db.prepare('INSERT INTO approvals (version_id, share_link_id, approver_name, approver_email, ip, user_agent, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ver.id, req.link.id, req.link.approver_name, req.link.approver_email, req.ip || '', String(req.get('user-agent') || '').slice(0, 300), reqId, now());
      changeStatus(db, ver.id, 'approved', {
        event: 'approved', actorType: 'approver', actorLabel: `${req.link.approver_name} (akkoordgever, geverifieerd)`,
        shareLinkId: req.link.id, note: `Versie ${ver.number} goedgekeurd`,
      });
      return false;
    });
    res.json({ ok: true, replayed, status: currentStatus(ver.id) });
  });

  // Klantmedia nooit in de browsercache bewaren: ingetrokken of weggegooid betekent direct geen toegang.
  router.get('/review/:token/versions/:versionId/media', async (req, res) => {
    const ver = getSharedVersion(req);
    await storage.send(res, ver.stored_name, { 'Content-Type': ver.mime_type, 'Cache-Control': 'private, no-store' });
  });

  router.get('/review/:token/versions/:versionId/poster', async (req, res) => {
    const ver = getSharedVersion(req);
    if (!ver.has_poster) throw new HttpError(404, 'Geen voorvertoning');
    await storage.send(res, posterKey(ver), { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' });
  });

  router.get('/review/:token/versions/:versionId/download', async (req, res) => {
    if (!req.link.allow_download) throw new HttpError(403, 'Downloaden is voor deze link niet ingeschakeld.');
    const ver = getSharedVersion(req);
    if (isFirstRequest(req)) {
      recordActivity(db, req, { projectId: req.project.id, type: 'download_requested', videoId: req.video.id, versionId: ver.id, src: shareLinkSource(req.link) });
    }
    const name = originalDownloadName(ver, req.video);
    await storage.send(res, ver.stored_name, { 'Content-Type': ver.mime_type, 'Content-Disposition': contentDisposition(name), 'Cache-Control': 'private, no-store' });
  });
}

module.exports = { reviewRoutes };
