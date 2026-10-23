'use strict';
const { HttpError } = require('./status');

/**
 * Toegangsrechten voor het team. Elke teamroute haalt project, video of versie op via
 * deze functies; daarmee worden rechten, prullenbak en archief altijd op de server
 * gecontroleerd, ook als iemand een URL rechtstreeks opvraagt.
 *
 * Rollen: beheerder (admin) mag alles in alle projecten. Andere teamleden hebben per
 * project een niveau; hogere niveaus omvatten de lagere:
 *   view    — bekijken, afspelen, downloaden, reageren en reacties afhandelen
 *   upload  — + video's en nieuwe versies uploaden, titels wijzigen, klaarzetten
 *   publish — + publiceren naar de klant, links en akkoordgever beheren
 *   manage  — + project bewerken, status corrigeren, archiveren, naar prullenbak
 * Definitief verwijderen, teamleden, opslag en back-ups zijn alleen voor beheerders.
 */
const LEVELS = ['view', 'upload', 'publish', 'manage'];
const LEVEL_LABELS = {
  view: 'Bekijken en reageren',
  upload: 'Uploaden',
  publish: 'Publiceren en delen',
  manage: 'Beheren',
};
const rank = (level) => LEVELS.indexOf(level);
const atLeast = (level, need) => rank(level) >= rank(need);

const intParam = (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, 'Niet gevonden');
  return n;
};

function createAccess(db) {
  function levelFor(user, projectId) {
    if (user.isAdmin) return 'manage';
    return db.prepare('SELECT level FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, user.id)?.level || null;
  }

  function check(user, project, need, { write = false, allowTrashed = false } = {}) {
    const level = levelFor(user, project.id);
    // Geen toegang: we zeggen niet of het project bestaat.
    if (!level) throw new HttpError(404, 'Project niet gevonden');
    if (!atLeast(level, need)) {
      throw new HttpError(403, `Hiervoor heb je in dit project het recht “${LEVEL_LABELS[need]}” nodig. Vraag een beheerder om je rechten aan te passen.`);
    }
    return level;
  }

  const trashedError = (what) => new HttpError(410, `${what} staat in de prullenbak. Een beheerder kan het terugzetten.`);
  const archivedError = (what) => new HttpError(409, `${what} is gearchiveerd en daarom alleen te bekijken. Haal het eerst uit het archief.`);

  function project(req, id, need, opts = {}) {
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(intParam(id));
    if (!p) throw new HttpError(404, 'Project niet gevonden');
    const level = check(req.user, p, need, opts);
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

  /** Projecten waar deze gebruiker toegang toe heeft (met niveau). */
  function projectIdsFor(user) {
    if (user.isAdmin) return null; // alle
    return new Map(db.prepare('SELECT project_id, level FROM project_members WHERE user_id = ?').all(user.id).map((r) => [r.project_id, r.level]));
  }

  return { levelFor, project, video, version, requireAdmin, projectIdsFor };
}

module.exports = { createAccess, LEVELS, LEVEL_LABELS, atLeast, intParam };
