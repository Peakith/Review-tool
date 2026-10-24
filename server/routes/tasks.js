'use strict';
const { now } = require('../db');
const { HttpError } = require('../status');
const { intParam, atLeast } = require('../access');

/**
 * Feedbacktaken: een bestaande reactie wordt een taak voor een teamlid. Hooguit één taak per
 * reactie (UNIQUE), dus opnieuw klikken of opnieuw proberen maakt nooit een tweede taak.
 *
 * Eén afhandelstatus: heeft een reactie een taak, dan bepaalt de taak of de reactie
 * afgehandeld is (taak "afgehandeld" ⇔ reactie afgehandeld), in beide richtingen.
 * Taken zijn alleen voor het team; klanten zien ze nooit.
 */
const PRIORITIES = { high: 'Hoog', normal: 'Normaal', low: 'Laag' };
const TASK_STATUSES = { open: 'Open', in_progress: 'Bezig', done: 'Afgehandeld' };

function taskDto(db, t) {
  if (!t) return null;
  const name = (id) => (id ? db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || null : null);
  return {
    id: t.id,
    commentId: t.comment_id,
    assigneeId: t.assignee_id,
    assigneeName: name(t.assignee_id),
    priority: t.priority,
    priorityLabel: PRIORITIES[t.priority],
    dueDate: t.due_date,
    status: t.status,
    statusLabel: TASK_STATUSES[t.status],
    note: t.note,
    unassignedNote: t.unassigned_note,
    createdBy: name(t.created_by),
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    updatedBy: name(t.updated_by),
  };
}

/** Taak en reactie in dezelfde afhandelstatus zetten (binnen een transactie aanroepen). */
function setResolved(db, commentId, resolved, userId) {
  db.prepare('UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ?').run(resolved ? now() : null, resolved ? userId : null, commentId);
}

/** Na afhandelen/heropenen van een reactie: de taak volgt (gebruikt door de bestaande afvinkroute). */
function syncTaskFromComment(db, commentId, resolved, userId) {
  const t = db.prepare('SELECT * FROM comment_tasks WHERE comment_id = ?').get(commentId);
  if (!t) return;
  if (resolved && t.status !== 'done') db.prepare("UPDATE comment_tasks SET status = 'done', updated_at = ?, updated_by = ? WHERE id = ?").run(now(), userId, t.id);
  if (!resolved && t.status === 'done') db.prepare("UPDATE comment_tasks SET status = 'open', updated_at = ?, updated_by = ? WHERE id = ?").run(now(), userId, t.id);
}

/**
 * Taken van teamleden die geen toegang (meer) hebben tot het project worden losgekoppeld,
 * met een zichtbare toelichting. Aanroepen na het wijzigen van rechten, rollen of accounts.
 */
function reconcileAssignees(db, access) {
  const rows = db.prepare(`SELECT t.id, t.assignee_id, u.name, u.disabled_at, v.project_id FROM comment_tasks t
    JOIN users u ON u.id = t.assignee_id JOIN comments c ON c.id = t.comment_id
    JOIN versions ver ON ver.id = c.version_id JOIN videos v ON v.id = ver.video_id`).all();
  let changed = 0;
  for (const r of rows) {
    const user = { id: r.assignee_id, isAdmin: db.prepare("SELECT role FROM users WHERE id = ?").get(r.assignee_id)?.role === 'admin' };
    if (r.disabled_at || !access.levelFor(user, r.project_id)) {
      const why = r.disabled_at ? `${r.name} is uitgeschakeld` : `${r.name} heeft geen toegang meer tot dit project`;
      db.prepare('UPDATE comment_tasks SET assignee_id = NULL, unassigned_note = ?, updated_at = ? WHERE id = ?').run(`${why}; de taak is daarom niet meer toegewezen.`, now(), r.id);
      changed++;
    }
  }
  return changed;
}

function taskRoutes(router, db, config, { access }) {
  const getComment = (req, need, opts) => {
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(intParam(req.params.id));
    if (!c) throw new HttpError(404, 'Reactie niet gevonden');
    return { comment: c, ...access.version(req, c.version_id, need, opts) };
  };
  const getTask = (req, need, opts) => {
    const t = db.prepare('SELECT * FROM comment_tasks WHERE id = ?').get(intParam(req.params.id));
    if (!t) throw new HttpError(404, 'Taak niet gevonden');
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(t.comment_id);
    return { task: t, comment: c, ...access.version(req, c.version_id, need, opts) };
  };

  /** Mag deze gebruiker de taak toegewezen krijgen? Alleen met toegang tot het project. */
  function checkAssignee(assigneeId, projectId) {
    if (assigneeId === null || assigneeId === undefined || assigneeId === '') return null;
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(assigneeId));
    if (!u || u.disabled_at) throw new HttpError(400, 'Dit teamlid bestaat niet of is uitgeschakeld.');
    if (!access.levelFor({ id: u.id, isAdmin: u.role === 'admin' }, projectId)) {
      throw new HttpError(400, `${u.name} heeft geen toegang tot dit project. Geef eerst toegang via Team & rechten, of kies iemand anders.`);
    }
    return u.id;
  }
  const checkPriority = (p) => {
    if (p === undefined) return undefined;
    if (!PRIORITIES[p]) throw new HttpError(400, 'Onbekende prioriteit');
    return p;
  };
  const checkStatus = (s) => {
    if (s === undefined) return undefined;
    if (!TASK_STATUSES[s]) throw new HttpError(400, 'Onbekende status');
    return s;
  };
  function checkDate(d) {
    if (d === undefined) return undefined;
    if (d === null || d === '') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
    const dt = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!m || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) throw new HttpError(400, 'Ongeldige deadline. Gebruik een datum (dag, maand, jaar).');
    return String(d);
  }

  // Lijst van teamleden die een taak in dit project kunnen krijgen.
  router.get('/projects/:id/assignees', (req, res) => {
    const { project } = access.project(req, req.params.id, 'view');
    const users = db.prepare('SELECT id, name, role FROM users WHERE disabled_at IS NULL ORDER BY name').all()
      .filter((u) => access.levelFor({ id: u.id, isAdmin: u.role === 'admin' }, project.id))
      .map((u) => ({ id: u.id, name: u.name, me: u.id === req.user.id }));
    res.json(users);
  });

  // Taak maken van een reactie. Bestaat er al een taak, dan komt die terug (geen dubbele taak).
  router.post('/comments/:id/task', (req, res) => {
    const { comment, video } = getComment(req, 'upload', { write: true });
    if (comment.parent_id) throw new HttpError(400, 'Maak een taak van de oorspronkelijke reactie, niet van een antwoord.');
    const body = req.body || {};
    const result = db.tx(() => {
      const existing = db.prepare('SELECT * FROM comment_tasks WHERE comment_id = ?').get(comment.id);
      if (existing) return { task: existing, existing: true };
      const status = checkStatus(body.status) || 'open';
      const at = now();
      const info = db.prepare(`INSERT INTO comment_tasks (comment_id, assignee_id, priority, due_date, status, note, created_by, created_at, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(comment.id, checkAssignee(body.assigneeId, video.project_id), checkPriority(body.priority) || 'normal',
        checkDate(body.dueDate) ?? null, status, String(body.note || '').trim().slice(0, 2000), req.user.id, at, at, req.user.id);
      setResolved(db, comment.id, status === 'done', req.user.id);
      return { task: db.prepare('SELECT * FROM comment_tasks WHERE id = ?').get(Number(info.lastInsertRowid)), existing: false };
    });
    res.status(result.existing ? 200 : 201).json({ task: taskDto(db, result.task), existing: result.existing });
  });

  router.patch('/tasks/:id', (req, res) => {
    const { task, comment, video, level } = getTask(req, 'view', { write: true });
    const body = req.body || {};
    const editsDetails = ['assigneeId', 'priority', 'dueDate', 'note'].some((k) => body[k] !== undefined);
    // Details wijzigen: recht "uploaden". Status wijzigen: ook de toegewezen persoon zelf.
    if (editsDetails && !atLeast(level, 'upload')) throw new HttpError(403, 'Hiervoor heb je in dit project het recht “Uploaden” nodig.');
    if (body.status !== undefined && !atLeast(level, 'upload') && task.assignee_id !== req.user.id) {
      throw new HttpError(403, 'Alleen de toegewezen persoon of iemand met het recht “Uploaden” kan de status wijzigen.');
    }
    const assignee = body.assigneeId !== undefined ? checkAssignee(body.assigneeId, video.project_id) : task.assignee_id;
    const status = checkStatus(body.status) ?? task.status;
    db.tx(() => {
      db.prepare(`UPDATE comment_tasks SET assignee_id = ?, priority = ?, due_date = ?, status = ?, note = ?, unassigned_note = ?, updated_at = ?, updated_by = ? WHERE id = ?`).run(
        assignee, checkPriority(body.priority) ?? task.priority, checkDate(body.dueDate) !== undefined ? checkDate(body.dueDate) : task.due_date, status,
        body.note !== undefined ? String(body.note).trim().slice(0, 2000) : task.note,
        body.assigneeId !== undefined ? null : task.unassigned_note, now(), req.user.id, task.id);
      if (status !== task.status) setResolved(db, comment.id, status === 'done', req.user.id);
    });
    res.json({ task: taskDto(db, db.prepare('SELECT * FROM comment_tasks WHERE id = ?').get(task.id)) });
  });

  // Taak weghalen: de reactie blijft, met haar huidige afhandelstatus.
  router.delete('/tasks/:id', (req, res) => {
    const { task } = getTask(req, 'upload', { write: true });
    db.prepare('DELETE FROM comment_tasks WHERE id = ?').run(task.id);
    res.json({ ok: true });
  });

  /**
   * Feedback in een project: klantreacties die als feedback zijn verstuurd (of op een goedgekeurde
   * versie staan) en alle reacties met een taak. Filters: assignee (id | none | me), video, priority, status.
   */
  function feedbackItems({ projectIds, filters = {}, userId }) {
    if (projectIds && !projectIds.length) return [];
    const where = ['v.trashed_at IS NULL', 'ver.trashed_at IS NULL', 'p.trashed_at IS NULL', 'c.parent_id IS NULL',
      "((c.author_type != 'team' AND (c.round_id IS NOT NULL OR ver.status = 'approved')) OR t.id IS NOT NULL)"];
    const args = [];
    if (projectIds) { where.push(`v.project_id IN (${projectIds.map(() => '?').join(',')})`); args.push(...projectIds); }
    if (filters.video) { where.push('v.id = ?'); args.push(Number(filters.video)); }
    if (filters.priority) { where.push('t.priority = ?'); args.push(filters.priority); }
    if (filters.assignee === 'none') where.push('t.assignee_id IS NULL');
    else if (filters.assignee === 'me') { where.push('t.assignee_id = ?'); args.push(userId); } else if (filters.assignee) { where.push('t.assignee_id = ?'); args.push(Number(filters.assignee)); }
    const rows = db.prepare(`SELECT c.*, t.id AS task_id, v.id AS video_id, v.title AS video_title, v.project_id, p.name AS project_name,
        ver.number AS version_number, ver.status AS version_status, r.number AS round_number,
        (SELECT COUNT(*) FROM comments x WHERE x.parent_id = c.id) AS reply_count
      FROM comments c JOIN versions ver ON ver.id = c.version_id JOIN videos v ON v.id = ver.video_id JOIN projects p ON p.id = v.project_id
      LEFT JOIN comment_tasks t ON t.comment_id = c.id LEFT JOIN review_rounds r ON r.id = ver.round_id
      WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC, c.id DESC`).all(...args);
    const items = rows.map((c) => {
      const task = c.task_id ? taskDto(db, db.prepare('SELECT * FROM comment_tasks WHERE id = ?').get(c.task_id)) : null;
      const status = task ? task.status : (c.resolved_at ? 'done' : 'open');
      return {
        commentId: c.id, projectId: c.project_id, projectName: c.project_name, videoId: c.video_id, videoTitle: c.video_title,
        versionId: c.version_id, versionNumber: c.version_number, roundNumber: c.round_number,
        timecode: c.timecode, timecodeEnd: c.timecode_end, hasAnnotation: !!c.annotation,
        body: c.body, authorName: c.author_name, authorType: c.author_type, internal: !!c.internal, createdAt: c.created_at,
        replyCount: c.reply_count, status, statusLabel: TASK_STATUSES[status], task,
      };
    });
    const wanted = filters.status || 'active';
    return items.filter((i) => (wanted === 'all' ? true : wanted === 'active' ? i.status !== 'done' : i.status === wanted));
  }

  router.get('/projects/:id/feedback', (req, res) => {
    const { project } = access.project(req, req.params.id, 'view');
    const q = req.query;
    const filters = { video: q.video, priority: q.priority && PRIORITIES[q.priority] ? q.priority : undefined, assignee: q.assignee, status: q.status };
    if (filters.status && !['active', 'all', ...Object.keys(TASK_STATUSES)].includes(filters.status)) throw new HttpError(400, 'Onbekende status');
    const items = feedbackItems({ projectIds: [project.id], filters, userId: req.user.id });
    const all = feedbackItems({ projectIds: [project.id], filters: { status: 'all' }, userId: req.user.id });
    res.json({
      items,
      counts: Object.fromEntries(Object.keys(TASK_STATUSES).map((s) => [s, all.filter((i) => i.status === s).length])),
      videos: db.prepare('SELECT id, title FROM videos WHERE project_id = ? AND trashed_at IS NULL ORDER BY title').all(project.id),
    });
  });

  // Mijn feedbacktaken: alleen in projecten waar ik (nog) toegang toe heb.
  router.get('/my/tasks', (req, res) => {
    const allowed = access.projectIdsFor(req.user);
    const projectIds = allowed ? [...allowed.keys()] : db.prepare('SELECT id FROM projects').all().map((p) => p.id);
    res.json({ items: feedbackItems({ projectIds, filters: { assignee: 'me', status: req.query.status || 'active' }, userId: req.user.id }) });
  });

  return { feedbackItems };
}

module.exports = { taskRoutes, taskDto, syncTaskFromComment, reconcileAssignees, PRIORITIES, TASK_STATUSES };
