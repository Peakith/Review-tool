'use strict';
const { HttpError } = require('../status');
const {
  TYPES, WINDOW_MINUTES, RETENTION_RANGE, DEFAULT_RETENTION_DAYS, recordActivity, shareLinkSource, retentionDays, purgeOldActivity,
} = require('../activity');

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
  router.get('/projects/:id/activity', (req, res) => {
    // Klantactiviteit is zichtbaar voor wie de klantlinks van het project beheert.
    const { project: p } = access.project(req, req.params.id, 'publish');
    const where = ['a.project_id = ?'];
    const args = [p.id];
    const type = String(req.query.type || '');
    if (type) {
      if (!TYPES[type]) throw new HttpError(400, 'Onbekend soort gebeurtenis');
      where.push('a.type = ?');
      args.push(type);
    }
    if (req.query.video) {
      where.push('a.video_id = ?');
      args.push(Number(req.query.video));
    }
    const before = Number(req.query.before);
    if (Number.isSafeInteger(before) && before > 0) { where.push('a.id < ?'); args.push(before); }
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const rows = db.prepare(`SELECT a.*, v.title AS video_title, ver.number AS version_number
      FROM client_activity a LEFT JOIN videos v ON v.id = a.video_id LEFT JOIN versions ver ON ver.id = a.version_id
      WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ?`).all(...args, limit + 1);
    const items = rows.slice(0, limit).map((a) => ({
      id: a.id,
      type: a.type,
      label: TYPES[a.type],
      at: a.created_at,
      source: a.source,
      sourceLabel: a.source_label,
      visitorName: a.visitor_name,
      // Een naam die de bezoeker zelf intypte, is niet gecontroleerd.
      visitorNameVerified: false,
      video: a.video_id ? { id: a.video_id, title: a.video_title } : null,
      versionNumber: a.version_number ?? null,
    }));
    const counts = Object.fromEntries(Object.keys(TYPES).map((t) => [t, 0]));
    for (const r of db.prepare('SELECT type, COUNT(*) AS n FROM client_activity WHERE project_id = ? GROUP BY type').all(p.id)) counts[r.type] = r.n;
    res.json({
      items,
      more: rows.length > limit,
      counts,
      types: TYPES,
      sources: SOURCES,
      windows: WINDOW_MINUTES,
      retentionDays: retentionDays(db),
      videos: db.prepare('SELECT DISTINCT v.id, v.title FROM client_activity a JOIN videos v ON v.id = a.video_id WHERE a.project_id = ? ORDER BY v.title').all(p.id),
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
