'use strict';
const { now } = require('./db');
const { HttpError } = require('./status');
const { intParam } = require('./access');
const { sharedVersions } = require('./client');
const { clientProject } = require('./clientportal');

/**
 * "Vraag aan klant": een vraag van het team over een project, en waar relevant over een exacte
 * video en versie. Staat los van interne feedbacktaken.
 *
 * - Bewust gedeeld door iemand met publicatierechten (Projectleider of beheerder); verschijnt bij de
 *   klant onder "Jouw acties" en wordt beantwoord via de bestaande beveiligde klantomgeving
 *   (klantportaal of projectlink). Zelfde toegangscontrole als het portaal.
 * - Open → beantwoord (antwoord, moment en de beschikbare identiteit; een zelf ingevulde naam is
 *   niet geverifieerd). Het team kan een open vraag intrekken.
 * - Idempotent: een herhaald verzoek (zelfde request-id) maakt geen tweede vraag, antwoord of melding.
 * - Een antwoord verandert niets aan video-status of goedkeuring, en een goedkeuring beantwoordt geen vraag.
 */
const MAX = 2000;
const cleanText = (v, what) => {
  const t = String(v ?? '').trim();
  if (!t) throw new HttpError(400, `Vul ${what} in.`);
  if (t.length > MAX) throw new HttpError(400, `${what[0].toUpperCase()}${what.slice(1)} is te lang (maximaal ${MAX} tekens).`);
  return t;
};
const cleanRequestId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null);

function questionDto(db, q, { team = false } = {}) {
  const v = q.video_id ? db.prepare('SELECT title FROM videos WHERE id = ?').get(q.video_id) : null;
  const ver = q.version_id ? db.prepare('SELECT number FROM versions WHERE id = ?').get(q.version_id) : null;
  return {
    id: q.id,
    projectId: q.project_id,
    videoId: q.video_id,
    videoTitle: v?.title || null,
    versionNumber: ver?.number || null,
    body: q.body,
    status: q.status,
    createdAt: q.created_at,
    answer: q.status === 'answered' ? { text: q.answer, at: q.answered_at, name: q.answer_name, verified: !!q.answer_verified } : null,
    ...(team ? {
      createdBy: q.created_by ? db.prepare('SELECT name FROM users WHERE id = ?').get(q.created_by)?.name || null : null,
      withdrawnAt: q.withdrawn_at, answerSource: q.answer_source,
    } : {}),
  };
}

/** Vragen die de klant via deze projecten mag zien: niet ingetrokken, video niet weggegooid en (als er een is) gedeeld. */
function visibleQuestions(db, projectIds) {
  if (!projectIds.length) return [];
  return db.prepare(`SELECT * FROM client_questions WHERE project_id IN (${projectIds.map(() => '?').join(',')}) AND status != 'withdrawn' ORDER BY created_at, id`).all(...projectIds)
    .filter((q) => {
      if (!q.video_id) return true;
      const v = db.prepare('SELECT trashed_at FROM videos WHERE id = ?').get(q.video_id);
      return v && !v.trashed_at && sharedVersions(db, q.video_id).length > 0;
    });
}

function questionTeamRoutes(router, db, config, { access, notifier }) {
  router.get('/projects/:id/questions', (req, res) => {
    const { project } = access.project(req, req.params.id, 'view');
    const videoId = req.query.video ? Number(req.query.video) : null;
    const rows = db.prepare(`SELECT * FROM client_questions WHERE project_id = ? ${videoId ? 'AND video_id = ?' : ''} ORDER BY status = 'open' DESC, created_at DESC, id DESC`)
      .all(...(videoId ? [project.id, videoId] : [project.id]));
    res.json({ questions: rows.map((q) => questionDto(db, q, { team: true })), clientCanSee: !!project.client_id || !!db.prepare('SELECT 1 FROM project_links WHERE project_id = ? AND revoked_at IS NULL').get(project.id) });
  });

  // Vraag delen met de klant. Vraagt publicatierechten (Projectleider of beheerder).
  router.post('/projects/:id/questions', (req, res) => {
    const { project } = access.project(req, req.params.id, 'publish', { write: true });
    const body = req.body || {};
    const text = cleanText(body.body, 'de vraag');
    const requestId = cleanRequestId(body.requestId);
    let videoId = null;
    let versionId = null;
    if (body.videoId) {
      const v = db.prepare('SELECT * FROM videos WHERE id = ? AND project_id = ? AND trashed_at IS NULL').get(intParam(body.videoId), project.id);
      if (!v) throw new HttpError(400, 'Deze video hoort niet bij dit project.');
      const shared = sharedVersions(db, v.id);
      if (!shared.length) throw new HttpError(400, 'Deze video is nog niet met de klant gedeeld. Publiceer eerst een versie, of stel de vraag over het hele project.');
      videoId = v.id;
      if (body.versionId) {
        const ver = shared.find((x) => x.id === Number(body.versionId));
        if (!ver) throw new HttpError(400, 'Deze versie is niet met de klant gedeeld.');
        versionId = ver.id;
      }
    }
    const result = db.tx(() => {
      if (requestId) {
        const dup = db.prepare('SELECT * FROM client_questions WHERE project_id = ? AND created_by = ? AND request_id = ?').get(project.id, req.user.id, requestId);
        if (dup) return { q: dup, created: false };
      }
      const info = db.prepare('INSERT INTO client_questions (project_id, video_id, version_id, body, created_by, created_at, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(project.id, videoId, versionId, text, req.user.id, now(), requestId);
      return { q: db.prepare('SELECT * FROM client_questions WHERE id = ?').get(Number(info.lastInsertRowid)), created: true };
    });
    res.status(result.created ? 201 : 200).json({ question: questionDto(db, result.q, { team: true }), created: result.created });
  });

  router.post('/questions/:id/withdraw', (req, res) => {
    const q = db.prepare('SELECT * FROM client_questions WHERE id = ?').get(intParam(req.params.id));
    if (!q) throw new HttpError(404, 'Vraag niet gevonden');
    access.project(req, q.project_id, 'publish');
    if (q.status === 'answered') throw new HttpError(409, 'Deze vraag is al beantwoord en kan niet meer worden ingetrokken.');
    if (q.status === 'open') db.prepare("UPDATE client_questions SET status = 'withdrawn', withdrawn_at = ?, withdrawn_by = ? WHERE id = ?").run(now(), req.user.id, q.id);
    res.json({ question: questionDto(db, db.prepare('SELECT * FROM client_questions WHERE id = ?').get(q.id), { team: true }) });
  });
}

/**
 * Antwoord geven via een klantlink. who: { name, verified, source, linkKey }.
 * Herhaald verzoek met hetzelfde request-id → hetzelfde antwoord, geen tweede melding.
 */
function answerQuestion(db, notifier, q, { text, requestId, who }) {
  const answer = cleanText(text, 'je antwoord');
  const out = db.tx(() => {
    const cur = db.prepare('SELECT * FROM client_questions WHERE id = ?').get(q.id);
    if (cur.status === 'withdrawn') throw new HttpError(410, 'Het team heeft deze vraag ingetrokken.', 'withdrawn');
    if (cur.status === 'answered') {
      if (requestId && cur.answer_request_id === requestId) return { q: cur, fresh: false };
      throw new HttpError(409, 'Deze vraag is al beantwoord.', 'already_answered', { answer: { text: cur.answer, at: cur.answered_at, name: cur.answer_name } });
    }
    db.prepare(`UPDATE client_questions SET status = 'answered', answer = ?, answered_at = ?, answer_name = ?, answer_verified = ?, answer_source = ?, answer_link_key = ?, answer_request_id = ?
      WHERE id = ? AND status = 'open'`).run(answer, now(), who.name, who.verified ? 1 : 0, who.source, who.linkKey, requestId, cur.id);
    return { q: db.prepare('SELECT * FROM client_questions WHERE id = ?').get(cur.id), fresh: true };
  });
  if (out.fresh) notifier.emit('questionAnswered', { questionId: out.q.id });
  return out.q;
}

function questionClientRoutes(router, db, config, { notifier }) {
  const requireName = (v) => {
    const n = String(v ?? '').trim().slice(0, 120);
    if (!n) throw new HttpError(400, 'Vul je naam in, zodat het team weet van wie het antwoord komt.');
    return n;
  };

  // Klantportaal: vraag moet bij een project van deze klant horen dat (nog) zichtbaar is.
  router.post('/client/:token/questions/:id/answer', (req, res) => {
    const q = db.prepare('SELECT * FROM client_questions WHERE id = ?').get(intParam(req.params.id));
    if (!q) throw new HttpError(404, 'Deze vraag is niet beschikbaar via deze link.', 'not_found');
    clientProject(db, req.clientLink, q.project_id);
    if (!visibleQuestions(db, [q.project_id]).some((x) => x.id === q.id) && q.status !== 'withdrawn') throw new HttpError(404, 'Deze vraag is niet beschikbaar via deze link.', 'not_found');
    const personal = !!req.clientLink.approver_email;
    const who = personal
      ? { name: req.clientLink.approver_name, verified: true, source: 'client_personal', linkKey: `client:${req.clientLink.id}` }
      : { name: requireName(req.body?.name), verified: false, source: 'client', linkKey: `client:${req.clientLink.id}` };
    const saved = answerQuestion(db, notifier, q, { text: req.body?.answer, requestId: cleanRequestId(req.body?.requestId), who });
    res.json({ question: questionDto(db, saved) });
  });

  // Projectlink (portaal per project): alleen vragen van dit project.
  router.post('/portal/:token/questions/:id/answer', (req, res) => {
    const q = db.prepare('SELECT * FROM client_questions WHERE id = ? AND project_id = ?').get(intParam(req.params.id), req.project.id);
    if (!q) throw new HttpError(404, 'Deze vraag is niet beschikbaar via deze link.', 'not_found');
    if (!visibleQuestions(db, [q.project_id]).some((x) => x.id === q.id) && q.status !== 'withdrawn') throw new HttpError(404, 'Deze vraag is niet beschikbaar via deze link.', 'not_found');
    const who = { name: requireName(req.body?.name), verified: false, source: 'project', linkKey: `project:${req.projectLink.id}` };
    const saved = answerQuestion(db, notifier, q, { text: req.body?.answer, requestId: cleanRequestId(req.body?.requestId), who });
    res.json({ question: questionDto(db, saved) });
  });
}

module.exports = { questionTeamRoutes, questionClientRoutes, questionDto, visibleQuestions };
