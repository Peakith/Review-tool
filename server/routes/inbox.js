'use strict';
const { now } = require('../db');
const { HttpError } = require('../status');
const { intParam } = require('../access');

/**
 * Inbox per teamlid: meldingen lezen, openen en als (on)gelezen markeren, voorkeuren per soort en
 * volgen van projecten en gesprekken. Elke aanvraag controleert opnieuw of de gebruiker toegang heeft
 * tot het project; meldingen uit projecten zonder toegang (of naar weggegooide onderdelen) worden
 * niet getoond en niet meegeteld.
 */
function inboxRoutes(router, db, config, { access, notifier }) {
  const usable = (user, n) => {
    if (!n.project_id || !notifier.canSee(user.id, n.project_id, n.type)) return false;
    const p = db.prepare('SELECT trashed_at FROM projects WHERE id = ?').get(n.project_id);
    if (!p || p.trashed_at) return false;
    if (n.video_id && db.prepare('SELECT trashed_at FROM videos WHERE id = ?').get(n.video_id)?.trashed_at !== null) return false;
    if (n.version_id && db.prepare('SELECT trashed_at FROM versions WHERE id = ?').get(n.version_id)?.trashed_at !== null) return false;
    return true;
  };
  const hrefOf = (n) => {
    if (n.type === 'delivery') return `/projecten/${n.project_id}/oplevering`;
    if (n.video_id) return `/video/${n.video_id}${n.version_id ? `?v=${n.version_id}` : ''}${n.comment_id ? `${n.version_id ? '&' : '?'}c=${n.comment_id}` : ''}`;
    return `/projecten/${n.project_id}`;
  };
  const dto = (n) => ({
    id: n.id,
    type: n.type,
    typeLabel: notifier.TYPES[n.type]?.label || n.type,
    title: n.title,
    body: n.body,
    actor: n.actor_label,
    project: db.prepare('SELECT name FROM projects WHERE id = ?').get(n.project_id)?.name || '',
    createdAt: n.created_at,
    read: !!n.read_at,
    href: hrefOf(n),
    projectId: n.project_id,
    // Gesprek (hoofdreactie) bij vermeldingen en antwoorden: om het gesprek te kunnen ontvolgen.
    threadId: ['reply', 'mention'].includes(n.type) ? n.comment_id : null,
  });
  /** Alle meldingen van deze gebruiker die hij nu nog mag zien (nieuwste eerst). */
  const visible = (user) => db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1000').all(user.id).filter((n) => usable(user, n));
  const own = (req) => {
    const n = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(intParam(req.params.id), req.user.id);
    if (!n) throw new HttpError(404, 'Melding niet gevonden');
    return n;
  };

  router.get('/inbox', (req, res) => {
    const all = visible(req.user);
    const filter = req.query.filter === 'unread' ? 'unread' : 'all';
    const type = notifier.TYPES[req.query.type] ? req.query.type : null;
    const list = all.filter((n) => (filter === 'all' || !n.read_at) && (!type || n.type === type));
    res.json({
      items: list.slice(0, 200).map(dto),
      total: list.length,
      unread: all.filter((n) => !n.read_at).length,
      types: Object.fromEntries(Object.entries(notifier.TYPES).map(([k, v]) => [k, v.label])),
    });
  });

  // Klein en vaak opgevraagd (zijbalk, browsermeldingen): aantal ongelezen en de nieuwste.
  router.get('/inbox/count', (req, res) => {
    const unread = visible(req.user).filter((n) => !n.read_at);
    res.json({ unread: unread.length, latest: unread.slice(0, 5).map((n) => ({ id: n.id, title: n.title, body: n.body, href: hrefOf(n) })) });
  });

  // Openen: opnieuw toegang controleren, als gelezen markeren en het doel teruggeven.
  router.post('/inbox/:id/open', (req, res) => {
    const n = own(req);
    if (!usable(req.user, n)) throw new HttpError(404, 'Dit onderdeel is niet meer beschikbaar of je hebt er geen toegang meer toe.');
    if (!n.read_at) db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(now(), n.id);
    res.json({ href: hrefOf(n) });
  });

  router.post('/inbox/:id/read', (req, res) => {
    const n = own(req);
    const read = req.body?.read !== false;
    db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(read ? (n.read_at || now()) : null, n.id);
    res.json({ ok: true, read });
  });

  router.post('/inbox/read-all', (req, res) => {
    const ids = visible(req.user).filter((n) => !n.read_at).map((n) => n.id);
    const at = now();
    db.tx(() => { for (const id of ids) db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(at, id); });
    res.json({ ok: true, marked: ids.length });
  });

  // ---------- Voorkeuren ----------
  const prefsOf = (userId) => {
    try { return JSON.parse(db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId)?.preferences || '{}') || {}; } catch { return {}; }
  };
  // Freelancers krijgen alleen meldingen over verstuurde klantfeedback; de rest is voor hen niet van toepassing.
  const prefsDto = (p, user) => Object.entries(notifier.PREFS).filter(([key]) => !user?.isFreelancer || key === 'feedback')
    .map(([key, label]) => ({ key, label: user?.isFreelancer && key === 'feedback' ? 'Klantfeedback in projecten waaraan ik ben gekoppeld' : label, on: p.notifications?.[key] !== false }));

  router.get('/inbox/preferences', (req, res) => res.json({ preferences: prefsDto(prefsOf(req.user.id), req.user) }));

  router.put('/inbox/preferences', (req, res) => {
    const p = prefsOf(req.user.id);
    const next = { ...(p.notifications || {}) };
    for (const [key, value] of Object.entries(req.body || {})) {
      if (!notifier.PREFS[key] || typeof value !== 'boolean') throw new HttpError(400, 'Onbekende meldingsvoorkeur');
      next[key] = value;
    }
    p.notifications = next;
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(JSON.stringify(p), req.user.id);
    res.json({ preferences: prefsDto(p, req.user) });
  });

  // ---------- Volgen ----------
  const target = (req) => {
    const kind = req.params.kind;
    if (kind === 'project') { access.project(req, req.params.id, 'read', { allowTrashed: true }); return { kind, id: intParam(req.params.id) }; }
    if (kind === 'comment') {
      const c = db.prepare('SELECT id, parent_id, version_id FROM comments WHERE id = ?').get(intParam(req.params.id));
      if (!c) throw new HttpError(404, 'Reactie niet gevonden');
      access.version(req, c.version_id, 'read', { allowTrashed: true });
      return { kind, id: c.parent_id || c.id };
    }
    throw new HttpError(404, 'Onbekende soort');
  };
  router.get('/follows/:kind/:id', (req, res) => {
    const t = target(req);
    res.json({ following: notifier.followState(req.user.id, t.kind, t.id) === 'on' || (t.kind === 'comment' && implicitThread(req.user.id, t.id)) });
  });
  router.put('/follows/:kind/:id', (req, res) => {
    const t = target(req);
    const on = req.body?.follow === true;
    notifier.setFollow(req.user.id, t.kind, t.id, on);
    res.json({ following: on });
  });
  /** Een gesprek volg je ook automatisch als je erin schreef of de taak hebt (tenzij uitgezet). */
  const implicitThread = (userId, rootId) => notifier.followState(userId, 'comment', rootId) !== 'off'
    && (!!db.prepare('SELECT 1 FROM comments WHERE (id = ? OR parent_id = ?) AND user_id = ?').get(rootId, rootId, userId)
      || !!db.prepare('SELECT 1 FROM comment_tasks WHERE comment_id = ? AND assignee_id = ?').get(rootId, userId));
}

module.exports = { inboxRoutes };
