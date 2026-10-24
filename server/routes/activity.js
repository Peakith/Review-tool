'use strict';
const { HttpError } = require('../status');
const {
  TYPES, WINDOW_MINUTES, RETENTION_RANGE, DEFAULT_RETENTION_DAYS, recordActivity, shareLinkSource, retentionDays, purgeOldActivity,
} = require('../activity');

// Formele acties (al vastgelegd in hun eigen tabel; vallen niet onder de bewaartermijn van activiteit).
const FORMAL = {
  feedback_sent: 'Feedback verstuurd (formeel)',
  approval_given: 'Goedkeuring gegeven (formeel)',
};
const ALL_TYPES = { ...TYPES, ...FORMAL };

const SOURCES = {
  review_link: 'Reviewlink',
  approver_link: 'Akkoordlink',
  portal: 'Klantportaal',
  delivery_link: 'Opleverlink',
};

/** Klantkant: het enige signaal dat de browser zelf meldt, is “afspelen gestart”. */
function activityClientRoutes(router, db) {
  // Valt onder de controle van /review/:token (link bestaat, niet ingetrokken, video bereikbaar).
  router.post('/review/:token/activity', (req, res) => {
    if (req.body?.type !== 'playback_started') throw new HttpError(400, 'Onbekende activiteit');
    const id = Number(req.body?.versionId);
    // Alleen een gepubliceerde versie van precies deze video; anders kan een bezoeker niets registreren.
    const ver = Number.isSafeInteger(id)
      ? db.prepare('SELECT * FROM versions WHERE id = ? AND video_id = ? AND shared_at IS NOT NULL AND trashed_at IS NULL').get(id, req.video.id)
      : null;
    if (!ver) throw new HttpError(404, 'Deze versie is niet beschikbaar.');
    const requestId = /^[A-Za-z0-9_-]{8,64}$/.test(String(req.body?.requestId || '')) ? String(req.body.requestId) : null;
    const r = recordActivity(db, req, {
      projectId: req.project.id, type: 'playback_started', videoId: req.video.id, versionId: ver.id,
      src: shareLinkSource(req.link), visitorName: req.body?.visitorName, requestId,
    });
    res.json({ ok: true, recorded: r.recorded });
  });
}

/** Teamkant: overzicht per project en de bewaartermijn. */
function activityRoutes(router, db, config, { access }) {
  /**
   * Tijdlijn per project: passieve signalen (client_activity) plus de formele acties die al vastliggen
   * (verstuurde feedback en goedkeuringen). Formele acties komen uit hun eigen tabel; er wordt niets
   * nagemaakt of afgeleid. Bezoeken van ingelogde teamleden (eigen testbezoek) staan standaard uit.
   */
  router.get('/projects/:id/activity', (req, res) => {
    // Klantactiviteit is zichtbaar voor wie de klantlinks van het project beheert.
    const { project: p } = access.project(req, req.params.id, 'publish');
    const type = String(req.query.type || '');
    if (type && !ALL_TYPES[type]) throw new HttpError(400, 'Onbekend soort gebeurtenis');
    const video = req.query.video ? Number(req.query.video) : null;
    const team = req.query.team === '1';
    const before = req.query.before && Number.isFinite(Date.parse(String(req.query.before))) ? String(req.query.before) : null;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const items = [];
    const versionHref = (videoId, versionId) => (videoId ? `/video/${videoId}${versionId ? `?v=${versionId}` : ''}` : null);

    if (!type || TYPES[type]) {
      const where = ['a.project_id = ?'];
      const args = [p.id];
      if (type) { where.push('a.type = ?'); args.push(type); }
      if (video) { where.push('a.video_id = ?'); args.push(video); }
      if (!team) where.push('a.team = 0');
      if (before) { where.push('a.created_at < ?'); args.push(before); }
      for (const a of db.prepare(`SELECT a.*, v.title AS video_title, ver.number AS version_number
        FROM client_activity a LEFT JOIN videos v ON v.id = a.video_id LEFT JOIN versions ver ON ver.id = a.version_id
        WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).all(...args, limit + 1)) {
        items.push({
          id: `a${a.id}`, kind: 'signal', type: a.type, label: TYPES[a.type], at: a.created_at,
          source: a.source, sourceLabel: a.team ? 'Ingelogd teamlid (eigen bezoek via klantlink)' : a.source_label,
          team: !!a.team,
          visitorName: a.visitor_name,
          // Een naam die de bezoeker zelf intypte, is niet gecontroleerd.
          visitorNameVerified: false,
          video: a.video_id ? { id: a.video_id, title: a.video_title } : null,
          versionNumber: a.version_number ?? null,
          href: versionHref(a.video_id, a.version_id),
        });
      }
    }
    const formal = (t, sql) => {
      if (type && type !== t) return;
      const where = ['v.project_id = ?'];
      const args = [p.id];
      if (video) { where.push('v.id = ?'); args.push(video); }
      if (before) { where.push('x.created_at < ?'); args.push(before); }
      for (const r of db.prepare(sql.replace('%WHERE%', where.join(' AND '))).all(...args, limit + 1)) {
        const src = r.link_id ? shareLinkSource({
          id: r.link_id, project_link_id: r.project_link_id, client_link_id: r.client_link_id, label: r.link_label,
          role: t === 'approval_given' ? 'approver' : r.role, approver_name: t === 'approval_given' ? r.name : r.approver_name,
        }) : { source: 'review_link', label: 'Via een klantlink' };
        items.push({
          id: `${t === 'feedback_sent' ? 'f' : 'g'}${r.id}`, kind: 'formal', type: t, label: FORMAL[t], at: r.created_at,
          source: src.source, sourceLabel: src.label, team: false,
          visitorName: r.name, visitorNameVerified: !!r.verified,
          detail: t === 'feedback_sent' ? `${r.comment_count} reactie(s)${r.message ? ' + toelichting' : ''}` : null,
          video: { id: r.video_id, title: r.title }, versionNumber: r.number, href: versionHref(r.video_id, r.version_id),
        });
      }
    };
    formal('feedback_sent', `SELECT x.id, x.created_at, x.reviewer_name AS name, x.verified, x.comment_count, x.message, x.version_id, ver.number, v.id AS video_id, v.title,
        s.role, s.label AS link_label, s.project_link_id, s.client_link_id, s.approver_name, s.id AS link_id
      FROM feedback_rounds x JOIN versions ver ON ver.id = x.version_id JOIN videos v ON v.id = ver.video_id LEFT JOIN share_links s ON s.id = x.share_link_id
      WHERE %WHERE% ORDER BY x.created_at DESC LIMIT ?`);
    formal('approval_given', `SELECT x.id, x.created_at, x.approver_name AS name, 1 AS verified, x.version_id, ver.number, v.id AS video_id, v.title,
        s.role, s.label AS link_label, s.project_link_id, s.client_link_id, s.approver_name, s.id AS link_id
      FROM approvals x JOIN versions ver ON ver.id = x.version_id JOIN videos v ON v.id = ver.video_id LEFT JOIN share_links s ON s.id = x.share_link_id
      WHERE %WHERE% ORDER BY x.created_at DESC LIMIT ?`);
    items.sort((a, b) => b.at.localeCompare(a.at) || String(b.id).localeCompare(String(a.id)));
    const page = items.slice(0, limit);
    const counts = Object.fromEntries(Object.keys(ALL_TYPES).map((t) => [t, 0]));
    for (const r of db.prepare('SELECT type, COUNT(*) AS n FROM client_activity WHERE project_id = ? AND team = 0 GROUP BY type').all(p.id)) counts[r.type] = r.n;
    counts.feedback_sent = db.prepare('SELECT COUNT(*) AS n FROM feedback_rounds x JOIN versions ver ON ver.id = x.version_id JOIN videos v ON v.id = ver.video_id WHERE v.project_id = ?').get(p.id).n;
    counts.approval_given = db.prepare('SELECT COUNT(*) AS n FROM approvals x JOIN versions ver ON ver.id = x.version_id JOIN videos v ON v.id = ver.video_id WHERE v.project_id = ?').get(p.id).n;
    res.json({
      items: page,
      more: items.length > limit,
      counts,
      teamVisits: db.prepare('SELECT COUNT(*) AS n FROM client_activity WHERE project_id = ? AND team = 1').get(p.id).n,
      types: ALL_TYPES,
      formalTypes: Object.keys(FORMAL),
      sources: SOURCES,
      windows: WINDOW_MINUTES,
      retentionDays: retentionDays(db),
      project: { id: p.id, name: p.name, clientName: p.client_name },
      videos: db.prepare(`SELECT DISTINCT v.id, v.title FROM videos v JOIN versions ver ON ver.video_id = v.id
        WHERE v.project_id = ? AND ver.shared_at IS NOT NULL ORDER BY v.title`).all(p.id),
    });
  });

  router.get('/settings/activity', (req, res) => {
    access.requireAdmin(req);
    res.json({ retentionDays: retentionDays(db), defaultDays: DEFAULT_RETENTION_DAYS, range: RETENTION_RANGE, total: db.prepare('SELECT COUNT(*) AS n FROM client_activity').get().n });
  });

  router.put('/settings/activity', (req, res) => {
    access.requireAdmin(req);
    const days = Number(req.body?.retentionDays);
    if (!Number.isInteger(days) || days < RETENTION_RANGE[0] || days > RETENTION_RANGE[1]) {
      throw new HttpError(400, `Kies een bewaartermijn van ${RETENTION_RANGE[0]} tot ${RETENTION_RANGE[1]} dagen.`);
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('activity_retention_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(days));
    const removed = purgeOldActivity(db, { days });
    res.json({ ok: true, retentionDays: days, removed });
  });
}

module.exports = { activityRoutes, activityClientRoutes };
