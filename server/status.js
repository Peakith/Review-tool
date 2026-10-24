'use strict';
const { now } = require('./db');

const STATUSES = {
  concept: 'Concept',
  ready_for_review: 'Klaar voor review',
  in_review: 'In review',
  changes_requested: 'Aanpassingen nodig',
  approved: 'Goedgekeurd',
};

const EVENTS = {
  upload: 'Nieuwe upload',
  manual: 'Handmatige wijziging door team',
  ready: 'Klaargezet voor review',
  shared: 'Gedeeld met klant',
  feedback_submitted: 'Feedback verstuurd door klant',
  approved: 'Goedgekeurd door akkoordgever',
};

// Statussen waarin een klant feedback kan versturen of kan goedkeuren.
const OPEN_FOR_CLIENT = new Set(['in_review', 'changes_requested']);

class HttpError extends Error {
  /** code: vaste aanduiding voor de klantpagina's (bijv. 'password_required'), zodat die de melding kunnen vertalen. */
  constructor(status, message, code = null, extra = null) {
    super(message);
    this.status = status;
    if (code) this.code = code;
    if (extra) this.extra = extra;
  }
}

/**
 * Enige plek waar een versiestatus verandert. Legt altijd vast wie of welke
 * gebeurtenis de wijziging veroorzaakte, met tijdstip.
 */
function changeStatus(db, versionId, toStatus, { event, actorType, actorLabel, userId = null, shareLinkId = null, note = '' }) {
  if (!STATUSES[toStatus]) throw new HttpError(400, 'Onbekende status');
  if (!EVENTS[event]) throw new Error(`Onbekende statusgebeurtenis: ${event}`);
  const version = db.prepare('SELECT id, status FROM versions WHERE id = ?').get(versionId);
  if (!version) throw new HttpError(404, 'Versie niet gevonden');
  const at = now();
  db.prepare('UPDATE versions SET status = ? WHERE id = ?').run(toStatus, versionId);
  db.prepare(`INSERT INTO status_events
    (version_id, from_status, to_status, event, actor_type, actor_label, actor_user_id, share_link_id, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(versionId, version.status, toStatus, event, actorType, actorLabel, userId, shareLinkId, note, at);
  return { from: version.status, to: toStatus, at };
}

module.exports = { STATUSES, EVENTS, OPEN_FOR_CLIENT, HttpError, changeStatus };
