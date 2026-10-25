'use strict';
const { HttpError } = require('./status');

/**
 * Toegangsrechten voor het team. Elke teamroute haalt project, video of versie op via
 * deze functies; daarmee worden rechten, einddatum, prullenbak en archief altijd op de server
 * gecontroleerd, ook als iemand een URL rechtstreeks opvraagt.
 *
 * Accountrollen: beheerder (admin) mag alles in alle projecten. Teamleden (member) en freelancers
 * hebben alleen toegang tot projecten waaraan ze expliciet zijn gekoppeld. Per project een rol;
 * hogere niveaus omvatten de lagere:
 *   feedback — Freelancer: alleen klantfeedback bekijken, via de eigen alleen-lezen routes
 *   read     — Meekijker: projectinformatie bekijken, niets wijzigen
 *   view     — (oud niveau) + reageren en reacties afhandelen
 *   upload   — Editor: + video's en versies uploaden, reageren, feedbacktaken
 *   publish  — (oud niveau) + publiceren en delen
 *   manage   — Projectleider: + project beheren, personen koppelen, publiceren, delen, opleveren
 * Een freelanceraccount heeft in elk gekoppeld project altijd en alleen "feedback", wat er ook in
 * de koppeling staat. Een koppeling met een verstreken einddatum geeft geen enkele toegang meer.
 * Teamleden, merken, opslag, back-ups en definitief verwijderen zijn alleen voor beheerders.
 */
const LEVELS = ['feedback', 'read', 'view', 'upload', 'publish', 'manage'];
const LEVEL_LABELS = {
  feedback: 'Klantfeedback bekijken',
  read: 'Bekijken',
  view: 'Bekijken en reageren',
  upload: 'Uploaden en reageren',
  publish: 'Publiceren en delen',
  manage: 'Beheren',
};
/** Projectrollen zoals ze in de app heten, met het niveau dat erbij hoort. */
const PROJECT_ROLES = {
  producer: { level: 'manage', label: 'Projectleider' },
  editor: { level: 'upload', label: 'Editor' },
  meekijker: { level: 'read', label: 'Meekijker' },
  freelancer: { level: 'feedback', label: 'Freelancer' },
};
const roleOfLevel = (level) => ({ manage: 'producer', publish: 'editor', upload: 'editor', view: 'meekijker', read: 'meekijker', feedback: 'freelancer' })[level] || null;
const rank = (level) => LEVELS.indexOf(level);
const atLeast = (level, need) => !!level && rank(level) >= rank(need);
const activeAt = (row, at = new Date().toISOString()) => !!row && (!row.expires_at || row.expires_at > at);

const intParam = (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, 'Niet gevonden');
  return n;
};

function createAccess(db) {
  const memberRow = (user, projectId) => db.prepare('SELECT level, expires_at FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, user.id);
  const effective = (user, row) => (activeAt(row) ? (user.isFreelancer || user.role === 'freelancer' ? 'feedback' : row.level) : null);

  /** Huidig niveau in dit project, of null (geen of verlopen koppeling). Bij elk verzoek opnieuw bepaald. */
  function levelFor(user, projectId) {
    if (user.isAdmin) return 'manage';
    return effective(user, memberRow(user, projectId));
  }
  const canAccess = (user, projectId, need = 'read') => atLeast(levelFor(user, projectId), need);

  function check(user, project, need) {
    const row = user.isAdmin ? null : memberRow(user, project.id);
    const level = user.isAdmin ? 'manage' : effective(user, row);
    if (!level) {
      // Verlopen koppeling: duidelijke melding (het project bestond voor deze persoon al).
      if (row && !activeAt(row)) throw new HttpError(403, 'Je toegang tot dit project is verlopen. Vraag de projectleider om je toegang te verlengen.', 'access_expired');
      // Geen toegang: we zeggen niet of het project bestaat.
      throw new HttpError(404, 'Project niet gevonden');
    }
    if (!atLeast(level, need)) {
      throw new HttpError(403, `Hiervoor heb je in dit project het recht “${LEVEL_LABELS[need]}” nodig. Vraag een beheerder of de projectleider om je rechten aan te passen.`, 'forbidden');
    }
    return level;
  }

  const trashedError = (what) => new HttpError(410, `${what} staat in de prullenbak. Een beheerder kan het terugzetten.`);
  const archivedError = (what) => new HttpError(409, `${what} is gearchiveerd en daarom alleen te bekijken. Haal het eerst uit het archief.`);
  // Lezen (GET) met niveau "view" is voor iedereen vanaf Meekijker; wijzigen vraagt echt "view".
  const needFor = (req, need) => (need === 'view' && (req.method === 'GET' || req.method === 'HEAD') ? 'read' : need);

  function project(req, id, need, opts = {}) {
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(intParam(id));
    if (!p) throw new HttpError(404, 'Project niet gevonden');
    const level = check(req.user, p, needFor(req, need));
    if (p.trashed_at && !opts.allowTrashed) throw trashedError('Dit project');
    if (opts.write && p.archived_at) throw archivedError('Dit project');
    return { project: p, level };
  }

  function video(req, id, need, opts = {}) {
    const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(intParam(id));
    if (!v) throw new HttpError(404, 'Video niet gevonden');
    const { project: p, level } = project(req, v.project_id, need, opts);
    if (v.trashed_at && !opts.allowTrashed) throw trashedError('Deze video');
    if (opts.write && v.archived_at) throw archivedError('Deze video');
    return { video: v, project: p, level };
  }

  function version(req, id, need, opts = {}) {
    const ver = db.prepare('SELECT * FROM versions WHERE id = ?').get(intParam(id));
    if (!ver) throw new HttpError(404, 'Versie niet gevonden');
    const ctx = video(req, ver.video_id, need, opts);
    if (ver.trashed_at && !opts.allowTrashed) throw trashedError('Deze versie');
    return { version: ver, ...ctx };
  }

  function requireAdmin(req) {
    if (!req.user.isAdmin) throw new HttpError(403, 'Alleen een beheerder kan dit doen.');
  }

  /**
   * Projecten waar deze gebruiker nu toegang toe heeft, met niveau (null = alle, voor beheerders).
   * Standaard vanaf "read": projecten waarin iemand alleen freelancer is, tellen voor de gewone
   * teamoverzichten (zoeken, dashboard, taken, klanten) niet mee.
   */
  function projectIdsFor(user, need = 'read') {
    if (user.isAdmin) return null; // alle
    const at = new Date().toISOString();
    const out = new Map();
    for (const r of db.prepare('SELECT project_id, level, expires_at FROM project_members WHERE user_id = ?').all(user.id)) {
      if (!activeAt(r, at)) continue;
      const level = effective(user, r);
      if (atLeast(level, need)) out.set(r.project_id, level);
    }
    return out;
  }

  return { levelFor, canAccess, project, video, version, requireAdmin, projectIdsFor };
}

module.exports = { createAccess, LEVELS, LEVEL_LABELS, PROJECT_ROLES, roleOfLevel, atLeast, activeAt, intParam };
