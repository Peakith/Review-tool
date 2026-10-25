'use strict';
const { now } = require('../db');
const { HttpError } = require('../status');
const auth = require('../auth');
const { PROJECT_ROLES, roleOfLevel, activeAt, intParam } = require('../access');
const { reconcileAssignees } = require('./tasks');

/**
 * Personen in een project: vanuit het project iemand koppelen (bestaand account kiezen, of als
 * beheerder een nieuw account maken), rol en einddatum instellen, verlengen, vroegtijdig intrekken
 * of ontkoppelen. Projectleiders mogen dit in hun eigen project; accounts maken kan alleen een
 * beheerder. Een koppeling geeft nooit toegang tot andere projecten of beheerschermen.
 *
 * Freelanceraccounts kunnen alleen de rol Freelancer krijgen, en de rol Freelancer is alleen voor
 * freelanceraccounts. Beheerders hebben al toegang tot alles en worden niet gekoppeld.
 */
function parseExpiry(value, { allowPast = false } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value === 'now') return now();
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Ongeldige einddatum. Kies een datum en tijd.');
  if (!allowPast && d.getTime() <= Date.now()) throw new HttpError(400, 'De einddatum ligt in het verleden. Kies een moment in de toekomst, of trek de toegang direct in.');
  return d.toISOString();
}

function checkRole(role, accountRole) {
  const r = PROJECT_ROLES[role];
  if (!r) throw new HttpError(400, 'Kies een rol: Projectleider, Editor, Meekijker of Freelancer.');
  if (accountRole === 'freelancer' && role !== 'freelancer') throw new HttpError(400, 'Een freelanceraccount kan alleen de rol Freelancer krijgen (alleen klantfeedback bekijken).');
  if (accountRole !== 'freelancer' && role === 'freelancer') throw new HttpError(400, 'De rol Freelancer is alleen voor freelanceraccounts. Kies Meekijker voor een teamlid dat alleen mag kijken.');
  return r.level;
}

function memberRoutes(router, db, config, { access, notifier }) {
  const memberDto = (row) => {
    const role = row.account_role === 'freelancer' ? 'freelancer' : roleOfLevel(row.level);
    return {
      userId: row.user_id, name: row.name, email: row.email, accountRole: row.account_role, disabled: !!row.disabled_at,
      role, roleLabel: PROJECT_ROLES[role]?.label || row.level,
      expiresAt: row.expires_at || null, active: activeAt(row) && !row.disabled_at, addedAt: row.created_at,
    };
  };
  const list = (projectId) => db.prepare(`SELECT pm.*, u.name, u.email, u.role AS account_role, u.disabled_at FROM project_members pm
    JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? AND u.role != 'admin' ORDER BY u.disabled_at IS NOT NULL, u.name`).all(projectId).map(memberDto);
  const admins = () => db.prepare("SELECT id, name FROM users WHERE role = 'admin' AND disabled_at IS NULL ORDER BY name").all();
  const after = (userId, projectId, accountRole) => {
    reconcileAssignees(db, access);
    // Freelancers volgen hun project automatisch, zodat ze meldingen over verstuurde klantfeedback krijgen.
    if (accountRole === 'freelancer') notifier.setFollow(userId, 'project', projectId, true, { auto: true });
  };

  router.get('/projects/:id/members', (req, res) => {
    const { project } = access.project(req, req.params.id, 'manage', { allowTrashed: true });
    res.json({
      members: list(project.id),
      admins: admins(),
      roles: Object.entries(PROJECT_ROLES).map(([key, r]) => ({ key, label: r.label })),
      canCreateAccounts: req.user.isAdmin,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  // Bestaande personen die nog niet gekoppeld zijn (beheerders hebben al toegang).
  router.get('/projects/:id/member-candidates', (req, res) => {
    const { project } = access.project(req, req.params.id, 'manage');
    res.json(db.prepare(`SELECT id, name, email, role FROM users WHERE role != 'admin' AND disabled_at IS NULL
      AND id NOT IN (SELECT user_id FROM project_members WHERE project_id = ?) ORDER BY name`).all(project.id)
      .map((u) => ({ id: u.id, name: u.name, email: u.email, accountRole: u.role })));
  });

  router.post('/projects/:id/members', (req, res) => {
    const { project } = access.project(req, req.params.id, 'manage', { write: true });
    const body = req.body || {};
    const expiresAt = parseExpiry(body.expiresAt) ?? null;
    const result = db.tx(() => {
      let user;
      if (body.newAccount) {
        if (!req.user.isAdmin) throw new HttpError(403, 'Alleen een beheerder kan een nieuw account maken. Kies een bestaand persoon, of vraag een beheerder.');
        const accountRole = body.newAccount.accountRole === 'freelancer' ? 'freelancer' : 'member';
        checkRole(body.role, accountRole);
        const id = auth.createUser(db, { email: body.newAccount.email, name: body.newAccount.name, password: body.newAccount.password, role: accountRole });
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      } else {
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(intParam(body.userId));
        if (!user || user.disabled_at) throw new HttpError(400, 'Deze persoon bestaat niet of is uitgeschakeld.');
      }
      if (user.role === 'admin') throw new HttpError(400, `${user.name} is beheerder en heeft al toegang tot alle projecten.`);
      const level = checkRole(body.role, user.role);
      const existing = db.prepare('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?').get(project.id, user.id);
      // Herhaald verzoek (dubbelklik): dezelfde koppeling, geen tweede.
      if (existing) {
        if (existing.level === level && (existing.expires_at || null) === expiresAt) return { userId: user.id, created: false };
        throw new HttpError(409, `${user.name} is al aan dit project gekoppeld. Pas de rol of einddatum aan in de lijst.`);
      }
      db.prepare('INSERT INTO project_members (project_id, user_id, level, created_at, expires_at, added_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(project.id, user.id, level, now(), expiresAt, req.user.id, now());
      after(user.id, project.id, user.role);
      return { userId: user.id, created: true };
    });
    res.status(result.created ? 201 : 200).json({ ...result, members: list(project.id) });
  });

  const memberOf = (projectId, userId) => {
    const row = db.prepare(`SELECT pm.*, u.role AS account_role, u.name FROM project_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ? AND pm.user_id = ?`).get(projectId, intParam(userId));
    if (!row) throw new HttpError(404, 'Deze persoon is niet aan dit project gekoppeld.');
    return row;
  };

  // Rol wijzigen, einddatum zetten, verlengen ("expiresAt") of nu intrekken ("expiresAt": "now").
  router.patch('/projects/:id/members/:userId', (req, res) => {
    const { project } = access.project(req, req.params.id, 'manage');
    const row = memberOf(project.id, req.params.userId);
    const body = req.body || {};
    const level = body.role !== undefined ? checkRole(body.role, row.account_role) : row.level;
    const expiresAt = body.expiresAt !== undefined ? parseExpiry(body.expiresAt) : row.expires_at;
    db.tx(() => {
      db.prepare('UPDATE project_members SET level = ?, expires_at = ?, updated_at = ? WHERE project_id = ? AND user_id = ?').run(level, expiresAt, now(), project.id, row.user_id);
      reconcileAssignees(db, access);
    });
    res.json({ members: list(project.id) });
  });

  // Ontkoppelen: geen toegang meer; reacties, feedback en geschiedenis blijven bewaard.
  router.delete('/projects/:id/members/:userId', (req, res) => {
    const { project } = access.project(req, req.params.id, 'manage');
    const row = memberOf(project.id, req.params.userId);
    db.tx(() => {
      db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(project.id, row.user_id);
      reconcileAssignees(db, access);
    });
    res.json({ members: list(project.id) });
  });
}

module.exports = { memberRoutes, parseExpiry, checkRole };
