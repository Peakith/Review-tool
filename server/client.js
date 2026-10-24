'use strict';
const { versionDto, approvalDto } = require('./views');

/**
 * Wat een klant te zien krijgt. Deze functies worden gebruikt door de klantlinks, het
 * klantportaal én door de voorbeeldweergave voor het team, zodat het team precies ziet wat de
 * klant ziet. Alleen gepubliceerde (gedeelde) versies; nooit concepten, interne notities of
 * interne briefingonderdelen.
 */

// Soort oplevering. Een verbeterde montage is een nieuwe versie van dezelfde oplevering.
const KINDS = {
  main: 'Hoofdvideo',
  teaser: 'Teaser',
  cutdown: 'Cutdown',
  social: 'Social',
  other: 'Overig',
};
const ASPECTS = ['16:9', '9:16', '1:1', '4:5', '4:3', '21:9'];

/** Beeldverhouding uit de afmetingen, als die dicht bij een gangbare verhouding ligt. */
function detectAspect(width, height) {
  if (!width || !height) return null;
  const r = width / height;
  for (const a of ASPECTS) {
    const [x, y] = a.split(':').map(Number);
    if (Math.abs(r - x / y) / (x / y) < 0.03) return a;
  }
  return null;
}

/** Type, beeldverhouding en kanaal van een video (oplevering). */
function videoMeta(video, version) {
  const detected = version ? detectAspect(version.width, version.height) : null;
  const aspect = video.aspect_ratio || detected;
  const [x, y] = (aspect || '').split(':').map(Number);
  return {
    kind: video.kind || null,
    kindLabel: KINDS[video.kind] || null,
    aspect: aspect || null,
    aspectDetected: !video.aspect_ratio && !!detected,
    orientation: x && y ? (x > y ? 'liggend' : x < y ? 'staand' : 'vierkant') : null,
    channel: video.channel || '',
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

function brandDto(db, brandId) {
  const b = brandId ? db.prepare('SELECT * FROM brands WHERE id = ?').get(brandId) : null;
  if (!b) return null;
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    accent: HEX.test(b.accent_color) ? b.accent_color : null,
    // Versie in de URL, zodat een nieuw logo direct zichtbaar is.
    logoUrl: b.logo_key ? `/api/brands/${b.id}/logo?v=${encodeURIComponent(b.updated_at)}` : null,
  };
}

/** Reviewronde en "wat is aangepast" bij een gepubliceerde versie (voor de klant). */
function clientRound(db, version) {
  const r = version.round_id ? db.prepare('SELECT * FROM review_rounds WHERE id = ?').get(version.round_id) : null;
  return {
    round: r ? { number: r.number, deadline: r.deadline_at, note: r.client_note } : null,
    changeNote: version.change_note || '',
  };
}

/**
 * Goedkeuring zoals de klant die ziet: naam en moment (geen e-mailadres). Heeft het team de status
 * daarna gecorrigeerd, dan geldt de goedkeuring als ingetrokken; de klant ziet dat en waarom er een
 * nieuwe goedkeuring nodig is (zelfde regel als bij opleveringen).
 */
function clientApproval(db, versionId) {
  const a = approvalDto(db, versionId);
  if (!a) return null;
  const left = db.prepare("SELECT created_at FROM status_events WHERE version_id = ? AND to_status != 'approved' AND created_at >= ? ORDER BY id LIMIT 1").get(versionId, a.at);
  return { name: a.name, at: a.at, revoked: !!left, revokedAt: left?.created_at || null };
}

const sharedVersions = (db, videoId) =>
  db.prepare('SELECT * FROM versions WHERE video_id = ? AND shared_at IS NOT NULL AND trashed_at IS NULL ORDER BY number DESC').all(videoId);

/** Gegevens voor de reviewpagina van één video, zoals de klant die ziet. */
function clientVideoInfo(db, { video, project, role = 'reviewer', allowDownload = false, approverName = null, archived = false, portal = null }) {
  const versions = sharedVersions(db, video.id);
  return {
    archived,
    title: video.title,
    project: { name: project.name, clientName: project.client_name },
    brand: brandDto(db, project.brand_id),
    meta: videoMeta(video, versions[0]),
    role,
    allowDownload,
    approver: video.approver_name ? { name: video.approver_name } : null,
    // De persoon met de akkoordlink is geverifieerd via die persoonlijke link.
    identity: role === 'approver' ? { name: approverName, verified: true } : null,
    versions: versions.map((v, i) => ({ ...versionDto(v), isLatest: i === 0, approval: clientApproval(db, v.id), ...clientRound(db, v) })),
    totalShared: versions.length,
    // Kwam de klant via het klantportaal, dan kan hij terug naar het overzicht.
    portal,
  };
}

/** Briefingonderdelen die met de klant gedeeld zijn. fileUrl(item) bepaalt het downloadadres. */
function sharedBriefing(db, projectId, fileUrl) {
  return db.prepare("SELECT * FROM briefing_items WHERE project_id = ? AND visibility = 'client' AND trashed_at IS NULL ORDER BY id").all(projectId)
    .map((b) => ({
      id: b.id,
      kind: b.kind,
      title: b.title,
      body: b.kind === 'text' ? b.body : '',
      url: b.kind === 'link' ? b.url : null,
      file: b.kind === 'file' ? { name: b.file_name, mime: b.file_mime, size: b.file_size, url: fileUrl(b) } : null,
    }));
}

/**
 * Het klantportaal van een project: alle video's met een gepubliceerde versie, met de status
 * van díe versie. Een nieuwe interne versie verandert hier niets aan tot het team publiceert.
 * videoLink(video) geeft het adres waarmee de klant de video opent; posterUrl(version) de thumbnail.
 */
function portalDto(db, project, { videoLink, posterUrl, fileUrl }) {
  const archivedProject = !!project.archived_at;
  const videos = [];
  for (const v of db.prepare('SELECT * FROM videos WHERE project_id = ? AND trashed_at IS NULL ORDER BY created_at, id').all(project.id)) {
    const shared = sharedVersions(db, v.id);
    const ver = shared[0];
    if (!ver) continue; // nog niets gepubliceerd: bestaat voor de klant niet
    const approval = clientApproval(db, ver.id);
    videos.push({
      id: v.id,
      title: v.title,
      meta: videoMeta(v, ver),
      version: { number: ver.number, status: ver.status, sharedAt: ver.shared_at, duration: ver.duration_seconds, width: ver.width, height: ver.height, hasPoster: !!ver.has_poster },
      posterUrl: ver.has_poster ? posterUrl(v, ver) : null,
      approval,
      round: clientRound(db, ver).round,
      approverName: v.approver_name || null,
      archived: archivedProject || !!v.archived_at,
      href: videoLink(v),
    });
  }
  const order = { main: 0, teaser: 1, cutdown: 2, social: 3, other: 4 };
  videos.sort((a, b) => (order[a.meta.kind] ?? 5) - (order[b.meta.kind] ?? 5) || a.id - b.id);
  return {
    project: { name: project.name, clientName: project.client_name, intro: project.portal_intro || '' },
    brand: brandDto(db, project.brand_id),
    archived: archivedProject,
    briefing: sharedBriefing(db, project.id, fileUrl),
    videos,
  };
}

module.exports = { clientRound, KINDS, ASPECTS, detectAspect, videoMeta, brandDto, clientVideoInfo, portalDto, sharedVersions, HEX };
