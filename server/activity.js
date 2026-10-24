'use strict';
const { now } = require('./db');
const auth = require('./auth');

/**
 * Passieve klantactiviteit: alleen wat de server zelf waarnam via een klantlink.
 *
 * - Labels beschrijven de waargenomen gebeurtenis, niet meer: “Afspelen gestart” is niet
 *   “volledig bekeken”, “Download aangevraagd” is niet “bestand opgeslagen”.
 * - Thumbnails, videodeelverzoeken (Range), voorladen en de voorbeeldweergave van het team tellen
 *   niet mee. Een ingelogd teamlid dat een klantlink opent, telt ook niet mee.
 * - Herhalingen worden begrensd: per link, soort en bron hooguit één gebeurtenis per venster, en een
 *   herhaald verzoek met dezelfde request-id wordt herkend.
 * - Er worden geen tokens, IP-adressen of apparaatkenmerken bewaard.
 * - Activiteit verandert nooit een status, taak of goedkeuring.
 */
const TYPES = {
  portal_opened: 'Klantportaal geopend',
  review_opened: 'Reviewpagina geopend',
  playback_started: 'Afspelen gestart',
  delivery_opened: 'Opleverpagina geopend',
  download_requested: 'Download aangevraagd',
};

// Binnen dit venster telt dezelfde gebeurtenis via dezelfde link maar één keer.
const WINDOW_MINUTES = { portal_opened: 30, review_opened: 30, playback_started: 30, delivery_opened: 30, download_requested: 5 };

const DEFAULT_RETENTION_DAYS = 90;
const RETENTION_RANGE = [7, 730];

/** Bron van een reviewlink (gewone reviewlink, persoonlijke akkoordlink of via het klantportaal). */
function shareLinkSource(link) {
  if (link.client_link_id && link.role === 'approver') return { source: 'approver_link', linkKey: `client:${link.client_link_id}`, label: `Via persoonlijk klantportaal van ${link.approver_name}` };
  if (link.client_link_id) return { source: 'portal', linkKey: `client:${link.client_link_id}`, label: 'Via klantportaal (klant)' };
  if (link.project_link_id) return { source: 'portal', linkKey: `portal:${link.project_link_id}`, label: 'Via klantportaal (projectlink)' };
  if (link.role === 'approver') return { source: 'approver_link', linkKey: `share:${link.id}`, label: `Via akkoordlink van ${link.approver_name}` };
  return { source: 'review_link', linkKey: `share:${link.id}`, label: link.label && link.label !== 'Reviewlink' ? `Via reviewlink “${link.label}”` : 'Via reviewlink' };
}
const portalSource = (link) => ({ source: 'portal', linkKey: `portal:${link.id}`, label: 'Via klantportaal (projectlink)' });
const clientSource = (link) => (link.approver_email
  ? { source: 'approver_link', linkKey: `client:${link.id}`, label: `Via persoonlijk klantportaal van ${link.approver_name}` }
  : { source: 'portal', linkKey: `client:${link.id}`, label: 'Via klantportaal (klant)' });
const deliverySource = (link) => ({ source: 'delivery_link', linkKey: `delivery:${link.id}`, label: 'Via opleverlink' });

/** Is dit een eerste (deel van een) download, en niet een vervolgverzoek of HEAD? */
function isFirstRequest(req) {
  if (req.method !== 'GET') return false;
  const range = req.get('range');
  return !range || /^bytes=0-/.test(range.trim());
}

const cleanName = (value) => {
  const n = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return n || null;
};

/**
 * Legt een gebeurtenis vast. De aanroeper heeft al gecontroleerd dat de link toegang heeft tot
 * project, video, versie en oplevering. Geeft { recorded, reason }.
 */
function recordActivity(db, req, { projectId, type, videoId = null, versionId = null, deliveryId = null, src, visitorName = null, requestId = null }) {
  if (!TYPES[type]) throw new Error(`Onbekende activiteit: ${type}`);
  if (auth.sessionUser(db, req)) return { recorded: false, reason: 'team' };
  if (requestId && db.prepare('SELECT 1 FROM client_activity WHERE link_key = ? AND request_id = ?').get(src.linkKey, requestId)) {
    return { recorded: false, reason: 'replayed' };
  }
  const since = new Date(Date.now() - WINDOW_MINUTES[type] * 60_000).toISOString();
  const recent = db.prepare(`SELECT 1 FROM client_activity WHERE link_key = ? AND type = ? AND created_at >= ?
    AND video_id IS ? AND version_id IS ? AND delivery_id IS ? LIMIT 1`).get(src.linkKey, type, since, videoId, versionId, deliveryId);
  if (recent) return { recorded: false, reason: 'recent' };
  db.prepare(`INSERT INTO client_activity (project_id, video_id, version_id, delivery_id, type, source, link_key, source_label, visitor_name, request_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(projectId, videoId, versionId, deliveryId, type, src.source, src.linkKey, src.label.slice(0, 200), src.source === 'approver_link' ? null : cleanName(visitorName), requestId, now());
  return { recorded: true, reason: null };
}

function retentionDays(db) {
  const v = Number(db.prepare("SELECT value FROM settings WHERE key = 'activity_retention_days'").get()?.value);
  return Number.isInteger(v) && v >= RETENTION_RANGE[0] && v <= RETENTION_RANGE[1] ? v : DEFAULT_RETENTION_DAYS;
}

/** Ruimt passieve activiteit op die ouder is dan de bewaartermijn. Raakt geen andere tabel aan. */
function purgeOldActivity(db, { days = retentionDays(db), at = Date.now() } = {}) {
  const cutoff = new Date(at - days * 86_400_000).toISOString();
  return Number(db.prepare('DELETE FROM client_activity WHERE created_at < ?').run(cutoff).changes);
}

module.exports = {
  TYPES, WINDOW_MINUTES, DEFAULT_RETENTION_DAYS, RETENTION_RANGE,
  shareLinkSource, portalSource, clientSource, deliverySource, isFirstRequest, recordActivity, retentionDays, purgeOldActivity,
};
