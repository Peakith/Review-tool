'use strict';
const { now } = require('../db');
const { HttpError } = require('../status');
const { intParam, atLeast } = require('../access');
const { TYPES: ACTIVITY_TYPES } = require('../activity');

/**
 * Persoonlijke onderdelen van een teamlid: voorkeuren (thema, dashboard), het dashboard zelf,
 * globaal zoeken en opgeslagen zoekopdrachten. Alles wordt per aanvraag beperkt tot de projecten
 * waar deze gebruiker nu toegang toe heeft; ook aantallen, fragmenten en suggesties.
 */

const THEMES = ['dark', 'light', 'system'];

// Dashboardblokken. need: 'publish' = alleen projecten waar je mag publiceren/delen; 'admin' = beheerder.
const WIDGETS = {
  tasks: { title: 'Mijn taken', description: 'Feedbacktaken die aan jou zijn toegewezen.' },
  feedback: { title: 'Nieuwe feedback', description: 'Feedback die klanten de afgelopen 30 dagen hebben verstuurd.' },
  waiting: { title: 'Wacht op klant', description: 'Gepubliceerde versies die nog op review of goedkeuring wachten.' },
  recent: { title: 'Recente projecten', description: 'Projecten met de meest recente activiteit.' },
  activity: { title: 'Klantactiviteit', description: 'Wat klanten recent openden, afspeelden of downloadden.', need: 'publish' },
  uploads: { title: 'Uploads en verwerking', description: 'Je lopende uploads en de verwerking van video’s.' },
  storage: { title: 'Opslag', description: 'Vrije schijfruimte en gebruik.', need: 'admin' },
};
const DEFAULT_LAYOUT = [
  { id: 'tasks', size: 'normal' }, { id: 'feedback', size: 'normal' },
  { id: 'waiting', size: 'normal' }, { id: 'recent', size: 'normal' },
];
const SIZES = ['normal', 'wide'];

function meRoutes(router, db, config, { access, storage, feedbackItems }) {
  const prefsOf = (userId) => {
    let p = {};
    try { p = JSON.parse(db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId)?.preferences || '{}'); } catch { p = {}; }
    return p && typeof p === 'object' ? p : {};
  };
  /** Projecten (id → niveau) die deze gebruiker nu mag zien; null = alle (beheerder). */
  const allowedIds = (user) => {
    const m = access.projectIdsFor(user);
    return m ? [...m.keys()] : null;
  };
  const inList = (col, ids) => (ids ? (ids.length ? `${col} IN (${ids.map(() => '?').join(',')})` : '0') : '1');

  /** Welke blokken mag deze gebruiker gebruiken? */
  function availableWidgets(user) {
    const levels = access.projectIdsFor(user);
    const canPublish = !levels || [...levels.values()].some((l) => atLeast(l, 'publish'));
    return Object.entries(WIDGETS)
      .filter(([, w]) => (w.need === 'admin' ? user.isAdmin : w.need === 'publish' ? canPublish : true))
      .map(([id, w]) => ({ id, title: w.title, description: w.description }));
  }

  function layoutFor(user) {
    const allowed = new Set(availableWidgets(user).map((w) => w.id));
    const saved = prefsOf(user.id).dashboard;
    const list = Array.isArray(saved?.widgets) ? saved.widgets : DEFAULT_LAYOUT;
    return list.filter((w) => allowed.has(w.id));
  }

  router.get('/me/preferences', (req, res) => {
    const p = prefsOf(req.user.id);
    res.json({ theme: THEMES.includes(p.theme) ? p.theme : 'dark', dashboard: { widgets: layoutFor(req.user) } });
  });

  router.put('/me/preferences', (req, res) => {
    const body = req.body || {};
    const p = prefsOf(req.user.id);
    if (body.theme !== undefined) {
      if (!THEMES.includes(body.theme)) throw new HttpError(400, 'Kies Licht, Donker of Systeem.');
      p.theme = body.theme;
    }
    if (body.dashboard !== undefined) {
      if (body.dashboard === null) { delete p.dashboard; } else {
        const allowed = new Set(availableWidgets(req.user).map((w) => w.id));
        const list = Array.isArray(body.dashboard.widgets) ? body.dashboard.widgets : null;
        if (!list || list.length > 12) throw new HttpError(400, 'Ongeldige dashboardindeling.');
        const seen = new Set();
        const widgets = [];
        for (const w of list) {
          if (!allowed.has(w?.id) || seen.has(w.id)) throw new HttpError(400, 'Dit blok is niet beschikbaar.');
          seen.add(w.id);
          widgets.push({ id: w.id, size: SIZES.includes(w.size) ? w.size : 'normal' });
        }
        p.dashboard = { widgets };
      }
    }
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(JSON.stringify(p), req.user.id);
    res.json({ ok: true, theme: THEMES.includes(p.theme) ? p.theme : 'dark', dashboard: { widgets: layoutFor(req.user) } });
  });

  // ---------- Dashboard ----------

  const widgetData = {
    tasks(user, ids) {
      const items = feedbackItems({ projectIds: ids, filters: { assignee: 'me', status: 'active' }, userId: user.id });
      return { total: items.length, items: items.slice(0, 6) };
    },
    feedback(user, ids) {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const rows = db.prepare(`SELECT f.*, ver.number AS version_number, v.id AS video_id, v.title AS video_title, p.id AS project_id, p.name AS project_name
        FROM feedback_rounds f JOIN versions ver ON ver.id = f.version_id JOIN videos v ON v.id = ver.video_id JOIN projects p ON p.id = v.project_id
        WHERE f.created_at >= ? AND ver.trashed_at IS NULL AND v.trashed_at IS NULL AND p.trashed_at IS NULL AND ${inList('p.id', ids)}
        ORDER BY f.created_at DESC LIMIT 7`).all(since, ...(ids || []));
      return {
        items: rows.map((f) => ({ projectId: f.project_id, projectName: f.project_name, videoId: f.video_id, videoTitle: f.video_title, versionId: f.version_id,
          versionNumber: f.version_number, reviewerName: f.reviewer_name, verified: !!f.verified, commentCount: f.comment_count, at: f.created_at })),
      };
    },
    waiting(user, ids) {
      const rows = db.prepare(`SELECT ver.*, v.title AS video_title, p.id AS project_id, p.name AS project_name, r.deadline_at
        FROM versions ver JOIN videos v ON v.id = ver.video_id JOIN projects p ON p.id = v.project_id LEFT JOIN review_rounds r ON r.id = ver.round_id
        WHERE ver.status = 'in_review' AND ver.shared_at IS NOT NULL AND ver.trashed_at IS NULL AND v.trashed_at IS NULL AND v.archived_at IS NULL
          AND p.trashed_at IS NULL AND p.archived_at IS NULL AND ${inList('p.id', ids)}
          AND ver.number = (SELECT MAX(x.number) FROM versions x WHERE x.video_id = v.id AND x.shared_at IS NOT NULL AND x.trashed_at IS NULL)
        ORDER BY ver.shared_at ASC LIMIT 8`).all(...(ids || []));
      return {
        items: rows.map((v) => ({ projectId: v.project_id, projectName: v.project_name, videoId: v.video_id, videoTitle: v.video_title, versionId: v.id,
          versionNumber: v.number, sharedAt: v.shared_at, deadline: v.deadline_at })),
      };
    },
    recent(user, ids) {
      const rows = db.prepare(`SELECT p.*, (SELECT MAX(at) FROM (
          SELECT MAX(c.created_at) AS at FROM comments c JOIN versions x ON x.id = c.version_id JOIN videos y ON y.id = x.video_id WHERE y.project_id = p.id
          UNION ALL SELECT MAX(e.created_at) FROM status_events e JOIN versions x ON x.id = e.version_id JOIN videos y ON y.id = x.video_id WHERE y.project_id = p.id
          UNION ALL SELECT p.created_at)) AS last_at,
          (SELECT COUNT(*) FROM videos y WHERE y.project_id = p.id AND y.trashed_at IS NULL) AS video_count
        FROM projects p WHERE p.trashed_at IS NULL AND p.archived_at IS NULL AND ${inList('p.id', ids)} ORDER BY last_at DESC LIMIT 6`).all(...(ids || []));
      return { items: rows.map((p) => ({ id: p.id, name: p.name, clientName: p.client_name, videoCount: p.video_count, lastActivityAt: p.last_at })) };
    },
    activity(user) {
      const levels = access.projectIdsFor(user);
      const ids = levels ? [...levels].filter(([, l]) => atLeast(l, 'publish')).map(([id]) => id) : null;
      const rows = db.prepare(`SELECT a.*, p.name AS project_name, v.title AS video_title, ver.number AS version_number FROM client_activity a
        JOIN projects p ON p.id = a.project_id LEFT JOIN videos v ON v.id = a.video_id LEFT JOIN versions ver ON ver.id = a.version_id
        WHERE p.trashed_at IS NULL AND ${inList('p.id', ids)} ORDER BY a.id DESC LIMIT 8`).all(...(ids || []));
      return {
        items: rows.map((a) => ({ type: a.type, label: ACTIVITY_TYPES[a.type], at: a.created_at, projectId: a.project_id, projectName: a.project_name,
          videoId: a.video_id, videoTitle: a.video_title, versionNumber: a.version_number, sourceLabel: a.source_label })),
      };
    },
    uploads(user) {
      const rows = db.prepare('SELECT * FROM uploads WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(user.id);
      return { items: rows.map((u) => ({ name: u.original_filename, size: u.size_bytes, received: u.received_bytes, updatedAt: u.updated_at })), processing: [] };
    },
    async storage() {
      const st = storage.status();
      return { ok: st.ok, reason: st.reason, disk: st.ok ? await storage.freeBytes() : null, usage: st.ok ? await storage.usage() : null };
    },
  };

  router.get('/dashboard', async (req, res) => {
    const ids = allowedIds(req.user);
    const layout = layoutFor(req.user);
    const data = {};
    for (const w of layout) data[w.id] = await widgetData[w.id](req.user, ids);
    const projectCount = db.prepare(`SELECT COUNT(*) AS n FROM projects p WHERE p.trashed_at IS NULL AND ${inList('p.id', ids)}`).get(...(ids || [])).n;
    res.json({ layout, available: availableWidgets(req.user), data, projectCount, defaultLayout: DEFAULT_LAYOUT.filter((w) => availableWidgets(req.user).some((a) => a.id === w.id)) });
  });

  // ---------- Zoeken ----------

  const GROUPS = ['projects', 'videos', 'files', 'briefing', 'comments'];
  const escapeLike = (q) => q.replace(/[\\%_]/g, (c) => `\\${c}`);
  /** Tekstfragment rond de treffer (alleen uit tekst die deze gebruiker mag zien). */
  function snippet(text, q) {
    const t = String(text || '').replace(/\s+/g, ' ');
    const i = t.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return t.slice(0, 120);
    const start = Math.max(0, i - 50);
    return `${start ? '…' : ''}${t.slice(start, i + q.length + 70)}${i + q.length + 70 < t.length ? '…' : ''}`;
  }

  function search(user, q, { types = GROUPS, limit = 8 } = {}) {
    const ids = allowedIds(user);
    const like = `%${escapeLike(q)}%`;
    const P = inList('p.id', ids);
    const args = (...a) => [...a, ...(ids || [])];
    const out = {};
    const run = (group, sql, params, map) => {
      if (!types.includes(group)) return;
      const total = db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params).n;
      out[group] = { total, items: db.prepare(`${sql} LIMIT ${limit}`).all(...params).map(map) };
    };
    run('projects', `SELECT p.id, p.name, p.client_name, p.archived_at FROM projects p
      WHERE p.trashed_at IS NULL AND (p.name LIKE ? ESCAPE '\\' OR p.client_name LIKE ? ESCAPE '\\') AND ${P} ORDER BY p.name`, args(like, like),
    (p) => ({ title: p.name, sub: p.client_name || '', archived: !!p.archived_at, href: `/projecten/${p.id}` }));
    run('videos', `SELECT v.id, v.title, v.archived_at, p.name AS project_name FROM videos v JOIN projects p ON p.id = v.project_id
      WHERE v.trashed_at IS NULL AND p.trashed_at IS NULL AND v.title LIKE ? ESCAPE '\\' AND ${P} ORDER BY v.title`, args(like),
    (v) => ({ title: v.title, sub: v.project_name, archived: !!v.archived_at, href: `/video/${v.id}` }));
    run('files', `SELECT ver.id, ver.number, ver.original_filename, v.id AS video_id, v.title, p.name AS project_name FROM versions ver
      JOIN videos v ON v.id = ver.video_id JOIN projects p ON p.id = v.project_id
      WHERE ver.trashed_at IS NULL AND v.trashed_at IS NULL AND p.trashed_at IS NULL AND ver.original_filename LIKE ? ESCAPE '\\' AND ${P}
      ORDER BY ver.created_at DESC`, args(like),
    (f) => ({ title: f.original_filename, sub: `${f.title} · versie ${f.number} · ${f.project_name}`, href: `/video/${f.video_id}?v=${f.id}` }));
    run('briefing', `SELECT b.id, b.title, b.body, b.url, b.file_name, b.visibility, p.id AS project_id, p.name AS project_name FROM briefing_items b
      JOIN projects p ON p.id = b.project_id
      WHERE b.trashed_at IS NULL AND p.trashed_at IS NULL AND (b.title LIKE ? ESCAPE '\\' OR b.body LIKE ? ESCAPE '\\' OR b.url LIKE ? ESCAPE '\\' OR COALESCE(b.file_name, '') LIKE ? ESCAPE '\\')
        AND ${P} ORDER BY b.updated_at DESC`, args(like, like, like, like),
    (b) => ({ title: b.title || b.file_name || 'Briefing', sub: b.project_name, snippet: snippet(`${b.body} ${b.url} ${b.file_name || ''}`, q), internal: b.visibility !== 'client', href: `/projecten/${b.project_id}/briefing` }));
    run('comments', `SELECT c.id, c.body, c.timecode, c.author_name, c.internal, c.parent_id, ver.id AS version_id, ver.number, v.id AS video_id, v.title, p.name AS project_name
      FROM comments c JOIN versions ver ON ver.id = c.version_id JOIN videos v ON v.id = ver.video_id JOIN projects p ON p.id = v.project_id
      WHERE ver.trashed_at IS NULL AND v.trashed_at IS NULL AND p.trashed_at IS NULL AND c.body LIKE ? ESCAPE '\\' AND ${P}
      ORDER BY c.created_at DESC`, args(like),
    (c) => ({ title: `${c.author_name}${c.timecode !== null ? ` · ${fmtTc(c.timecode)}` : ''}`, sub: `${c.title} · versie ${c.number} · ${c.project_name}`,
      snippet: snippet(c.body, q), internal: !!c.internal, href: `/video/${c.video_id}?v=${c.version_id}&c=${c.parent_id || c.id}` }));
    return out;
  }
  const fmtTc = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  router.get('/search', (req, res) => {
    const q = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (q.length < 2) return res.json({ q, groups: {} });
    const types = req.query.types ? String(req.query.types).split(',').filter((t) => GROUPS.includes(t)) : GROUPS;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 8));
    res.json({ q, groups: search(req.user, q, { types, limit }) });
  });

  router.get('/saved-searches', (req, res) => {
    res.json(db.prepare('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY name').all(req.user.id)
      .map((s) => ({ id: s.id, name: s.name, query: s.query, filters: JSON.parse(s.filters || '{}'), createdAt: s.created_at })));
  });

  router.post('/saved-searches', (req, res) => {
    const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const query = String(req.body?.query || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!name || query.length < 2) throw new HttpError(400, 'Geef de zoekopdracht een naam en een zoekterm van minstens 2 tekens.');
    const types = Array.isArray(req.body?.filters?.types) ? req.body.filters.types.filter((t) => GROUPS.includes(t)) : [];
    if (db.prepare('SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?').get(req.user.id).n >= 30) throw new HttpError(400, 'Je kunt maximaal 30 zoekopdrachten bewaren.');
    const id = Number(db.prepare('INSERT INTO saved_searches (user_id, name, query, filters, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, name, query, JSON.stringify({ types }), now()).lastInsertRowid);
    res.status(201).json({ id });
  });

  router.delete('/saved-searches/:id', (req, res) => {
    // Alleen je eigen opgeslagen zoekopdrachten.
    const r = db.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').run(intParam(req.params.id), req.user.id);
    if (!r.changes) throw new HttpError(404, 'Zoekopdracht niet gevonden');
    res.json({ ok: true });
  });

  return { prefsOf, THEMES };
}

module.exports = { meRoutes, WIDGETS, DEFAULT_LAYOUT, THEMES };
