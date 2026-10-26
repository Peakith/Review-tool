'use strict';
const { now } = require('./db');

/**
 * Persoonlijke inbox voor het team.
 *
 * Gebeurtenissen: taak toegewezen, @vermelding, antwoord in een gevolgd gesprek, verstuurde
 * klantfeedback, goedkeuring (en intrekking), vrijgave en terugnemen van een oplevering in een
 * gevolgd project.
 *
 * - Per ontvanger een eigen rij met eigen gelezen/ongelezen-status.
 * - dedupe_key + UNIQUE(user_id, dedupe_key): een herhaald verzoek maakt geen tweede melding.
 * - Bij het maken wordt gecontroleerd of de ontvanger toegang heeft tot het project en meldingen
 *   van deze soort wil; bij tonen en openen opnieuw (wie toegang verliest, ziet de inhoud niet meer).
 * - De maker van de gebeurtenis krijgt zelf geen melding.
 * - Er wordt niets gemaild en niets naar buiten gestuurd. Browsermeldingen zijn een optie in de
 *   browser zelf, alleen zolang de app in een tabblad openstaat.
 */
const TYPES = {
  task_assigned: { label: 'Taak toegewezen', pref: 'tasks' },
  mention: { label: 'Vermelding', pref: 'mentions' },
  reply: { label: 'Antwoord in gesprek', pref: 'replies' },
  feedback: { label: 'Klantfeedback', pref: 'feedback' },
  approval: { label: 'Goedkeuring', pref: 'approvals' },
  approval_revoked: { label: 'Goedkeuring ingetrokken', pref: 'approvals' },
  delivery: { label: 'Oplevering', pref: 'deliveries' },
  question_answered: { label: 'Antwoord van klant', pref: 'questions' },
};
const PREFS = {
  tasks: 'Taken die aan mij worden toegewezen',
  mentions: 'Als iemand mij noemt (@naam)',
  replies: 'Antwoorden in gesprekken die ik volg',
  feedback: 'Klantfeedback in projecten die ik volg',
  approvals: 'Goedkeuringen (en intrekkingen) in projecten die ik volg',
  deliveries: 'Vrijgaven en teruggenomen opleveringen in projecten die ik volg',
  questions: 'Antwoorden van de klant op vragen (eigen vragen en projecten die ik volg)',
};

function userPrefs(db, userId) {
  try {
    const p = JSON.parse(db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId)?.preferences || '{}');
    return p?.notifications && typeof p.notifications === 'object' ? p.notifications : {};
  } catch { return {}; }
}
const wants = (db, userId, type) => userPrefs(db, userId)[TYPES[type].pref] !== false;

function createNotifier(db, access) {
  const userOf = (id) => {
    const u = db.prepare('SELECT id, role, disabled_at FROM users WHERE id = ?').get(id);
    return u && !u.disabled_at ? { id: u.id, role: u.role, isAdmin: u.role === 'admin', isFreelancer: u.role === 'freelancer' } : null;
  };
  /**
   * Mag deze persoon een melding van deze soort over dit project krijgen/zien? Teamleden vanaf
   * Meekijker: alle soorten. Freelancers: alleen verstuurde klantfeedback, en alleen zolang hun
   * (tijdelijke) toegang tot het project geldt.
   */
  const canSee = (userId, projectId, type = null) => {
    const u = userOf(userId);
    if (!u) return false;
    if (u.isFreelancer) return type === 'feedback' && access.canAccess(u, projectId, 'feedback');
    return access.canAccess(u, projectId, 'read');
  };

  /** Volgen aan/uit. auto: alleen zetten als er nog geen bewuste keuze is. */
  function setFollow(userId, kind, targetId, on, { auto = false } = {}) {
    if (auto) {
      db.prepare("INSERT OR IGNORE INTO follows (user_id, kind, target_id, state, auto, created_at) VALUES (?, ?, ?, 'on', 1, ?)").run(userId, kind, targetId, now());
      return;
    }
    db.prepare(`INSERT INTO follows (user_id, kind, target_id, state, auto, created_at) VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(user_id, kind, target_id) DO UPDATE SET state = excluded.state, auto = 0`).run(userId, kind, targetId, on ? 'on' : 'off', now());
  }
  const followState = (userId, kind, targetId) => db.prepare('SELECT state FROM follows WHERE user_id = ? AND kind = ? AND target_id = ?').get(userId, kind, targetId)?.state || null;
  const projectFollowers = (projectId) => db.prepare("SELECT user_id FROM follows WHERE kind = 'project' AND target_id = ? AND state = 'on'").all(projectId).map((r) => r.user_id);

  /**
   * Volgers van een gesprek (hoofdreactie): wie het expliciet volgt, plus teamleden die erin schreven
   * en de toegewezen persoon van de taak. Wie het gesprek bewust niet volgt, valt af.
   */
  function threadFollowers(rootId) {
    const ids = new Set();
    for (const r of db.prepare("SELECT user_id FROM follows WHERE kind = 'comment' AND target_id = ? AND state = 'on'").all(rootId)) ids.add(r.user_id);
    for (const r of db.prepare('SELECT DISTINCT user_id FROM comments WHERE (id = ? OR parent_id = ?) AND user_id IS NOT NULL').all(rootId, rootId)) ids.add(r.user_id);
    const t = db.prepare('SELECT assignee_id FROM comment_tasks WHERE comment_id = ?').get(rootId);
    if (t?.assignee_id) ids.add(t.assignee_id);
    for (const r of db.prepare("SELECT user_id FROM follows WHERE kind = 'comment' AND target_id = ? AND state = 'off'").all(rootId)) ids.delete(r.user_id);
    return [...ids];
  }

  /** Eén gebeurtenis naar een lijst ontvangers. Geeft het aantal nieuwe meldingen. */
  function send({ type, recipients, actorUserId = null, actorLabel = '', projectId, videoId = null, versionId = null, commentId = null, taskId = null, deliveryId = null, title, body = '', key }) {
    if (!TYPES[type]) throw new Error(`Onbekende melding: ${type}`);
    let n = 0;
    for (const userId of new Set(recipients)) {
      if (!userId || userId === actorUserId) continue;
      if (!canSee(userId, projectId, type) || !wants(db, userId, type)) continue;
      const r = db.prepare(`INSERT OR IGNORE INTO notifications (user_id, type, project_id, video_id, version_id, comment_id, task_id, delivery_id, actor_label, title, body, dedupe_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, type, projectId, videoId, versionId, commentId, taskId, deliveryId, String(actorLabel).slice(0, 120), String(title).slice(0, 300), String(body).slice(0, 400), key, now());
      n += Number(r.changes);
    }
    return n;
  }

  const ctxOfVersion = (versionId) => db.prepare(`SELECT ver.id AS versionId, ver.number, v.id AS videoId, v.title, v.project_id AS projectId
    FROM versions ver JOIN videos v ON v.id = ver.video_id WHERE ver.id = ?`).get(versionId);
  const snippet = (text) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > 160 ? `${t.slice(0, 157)}…` : t; };

  /** @Vermeldingen in een teamreactie: volledige naam of het deel vóór de @ van het e-mailadres. */
  function mentionedUsers(body, projectId) {
    const text = String(body || '');
    if (!text.includes('@')) return [];
    const lower = text.toLowerCase();
    return db.prepare('SELECT id, name, email FROM users WHERE disabled_at IS NULL').all().filter((u) => {
      const local = u.email.split('@')[0].toLowerCase();
      const name = u.name.toLowerCase();
      return (lower.includes(`@${name}`) || new RegExp(`@${local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`).test(lower)) && canSee(u.id, projectId, 'mention');
    }).map((u) => u.id);
  }

  // ---------- Gebeurtenissen ----------

  function taskAssigned({ task, actorUserId, actorLabel }) {
    if (!task.assignee_id) return 0;
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(task.comment_id);
    const ctx = ctxOfVersion(c.version_id);
    return send({
      type: 'task_assigned', recipients: [task.assignee_id], actorUserId, actorLabel, projectId: ctx.projectId, videoId: ctx.videoId, versionId: ctx.versionId,
      commentId: c.id, taskId: task.id, title: `${actorLabel} wees je een taak toe: ${ctx.title}`, body: snippet(c.body),
      key: `task:${task.id}:assignee:${task.assignee_id}:${task.updated_at}`,
    });
  }

  /** Nieuwe reactie (team of klant): vermeldingen en antwoorden in gevolgde gesprekken. */
  function commentPosted({ commentId, actorUserId = null }) {
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
    if (!c) return 0;
    const ctx = ctxOfVersion(c.version_id);
    const who = c.author_name || 'Iemand';
    let n = 0;
    const mentioned = c.author_type === 'team' ? mentionedUsers(c.body, ctx.projectId) : [];
    n += send({
      type: 'mention', recipients: mentioned, actorUserId, actorLabel: who, projectId: ctx.projectId, videoId: ctx.videoId, versionId: ctx.versionId,
      commentId: c.parent_id || c.id, title: `${who} noemde je bij ${ctx.title}`, body: snippet(c.body), key: `mention:${c.id}`,
    });
    if (c.parent_id) {
      // Wie al via een vermelding is ingelicht, krijgt niet ook nog een antwoordmelding.
      const followers = threadFollowers(c.parent_id).filter((id) => !mentioned.includes(id));
      // Klanten zien interne antwoorden nooit; teamleden wel. Volgers zijn altijd teamleden.
      n += send({
        type: 'reply', recipients: followers, actorUserId, actorLabel: who, projectId: ctx.projectId, videoId: ctx.videoId, versionId: ctx.versionId,
        commentId: c.parent_id, title: `${who} antwoordde in een gesprek bij ${ctx.title}`, body: snippet(c.body), key: `reply:${c.id}`,
      });
    }
    // Wie in een gesprek schrijft, volgt het (tenzij bewust uitgezet).
    if (actorUserId) setFollow(actorUserId, 'comment', c.parent_id || c.id, true, { auto: true });
    return n;
  }

  function feedbackSent({ roundId }) {
    const r = db.prepare('SELECT * FROM feedback_rounds WHERE id = ?').get(roundId);
    const ctx = ctxOfVersion(r.version_id);
    return send({
      type: 'feedback', recipients: projectFollowers(ctx.projectId), actorLabel: r.reviewer_name, projectId: ctx.projectId, videoId: ctx.videoId, versionId: ctx.versionId,
      title: `${r.reviewer_name} stuurde feedback op ${ctx.title} (versie ${ctx.number})`,
      body: `${r.comment_count} reactie(s)${r.message ? ` · ${snippet(r.message)}` : ''}`, key: `feedback:${r.id}`,
    });
  }

  function approvalGiven({ approvalId }) {
    const a = db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId);
    const ctx = ctxOfVersion(a.version_id);
    return send({
      type: 'approval', recipients: projectFollowers(ctx.projectId), actorLabel: a.approver_name, projectId: ctx.projectId, videoId: ctx.videoId, versionId: ctx.versionId,
      title: `${a.approver_name} keurde ${ctx.title} versie ${ctx.number} goed`, key: `approval:${a.id}`,
    });
  }

  /** Statuscorrectie weg van “Goedgekeurd” terwijl er een klantgoedkeuring was. */
  function approvalRevoked({ versionId, eventId, actorUserId, actorLabel, note }) {
    const ctx = ctxOfVersion(versionId);
    return send({
      type: 'approval_revoked', recipients: projectFollowers(ctx.projectId), actorUserId, actorLabel, projectId: ctx.projectId, videoId: ctx.videoId, versionId,
      title: `${actorLabel} trok de goedkeuring van ${ctx.title} versie ${ctx.number} in`, body: snippet(note), key: `approval-revoked:${eventId}`,
    });
  }

  function deliveryChanged({ deliveryId, action, actorUserId, actorLabel }) {
    const d = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(deliveryId);
    const ctx = ctxOfVersion(d.version_id);
    return send({
      type: 'delivery', recipients: projectFollowers(ctx.projectId), actorUserId, actorLabel, projectId: ctx.projectId, videoId: ctx.videoId, versionId: ctx.versionId, deliveryId,
      title: action === 'released' ? `${actorLabel} gaf ${ctx.title} versie ${ctx.number} definitief vrij` : `${actorLabel} nam de oplevering van ${ctx.title} versie ${ctx.number} terug`,
      body: action === 'withdrawn' && d.withdrawn_reason ? snippet(d.withdrawn_reason) : '', key: `delivery:${d.id}:${action}`,
    });
  }

  /** Klant beantwoordde een vraag: wie de vraag stelde en de volgers van het project. */
  function questionAnswered({ questionId }) {
    const q = db.prepare('SELECT * FROM client_questions WHERE id = ?').get(questionId);
    if (!q) return 0;
    const v = q.video_id ? db.prepare('SELECT title FROM videos WHERE id = ?').get(q.video_id) : null;
    const p = db.prepare('SELECT name FROM projects WHERE id = ?').get(q.project_id);
    return send({
      type: 'question_answered', recipients: [q.created_by, ...projectFollowers(q.project_id)], actorLabel: q.answer_name || 'Klant', projectId: q.project_id, videoId: q.video_id, versionId: q.version_id,
      title: `${q.answer_name || 'De klant'} beantwoordde je vraag over ${v?.title || p?.name || 'het project'}`, body: snippet(q.answer), key: `question:${q.id}:answered`,
    });
  }

  /** Een melding mag de eigenlijke actie nooit laten mislukken. */
  function emit(name, args) {
    try { return api[name](args); } catch (err) { console.error(`Melding (${name}) maken mislukt:`, err); return 0; }
  }

  const api = { taskAssigned, commentPosted, feedbackSent, approvalGiven, approvalRevoked, deliveryChanged, questionAnswered };
  return { TYPES, PREFS, emit, send, setFollow, followState, canSee, taskAssigned, commentPosted, feedbackSent, approvalGiven, approvalRevoked, deliveryChanged };
}

module.exports = { createNotifier, TYPES, PREFS };
