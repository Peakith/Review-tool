'use strict';
const { STATUSES } = require('./status');
const { videoMeta, brandDto } = require('./client');
const { originalDownloadName } = require('./media');

/**
 * Definitieve opleveringen.
 *
 * Een oplevering verwijst naar één exacte versie én naar de klantgoedkeuring die bij het vrijgeven
 * gold. Er wordt geen bestand gekopieerd: de download is het bestaande bestand van die versie.
 *
 * Wanneer telt een goedkeuring (en mag een versie worden vrijgegeven)?
 *  1. De akkoordgever heeft precies deze versie goedgekeurd via de persoonlijke akkoordlink
 *     (een rij in `approvals`). Een handmatig op “Goedgekeurd” gezette status zonder zo’n
 *     goedkeuring telt niet.
 *  2. De versie staat nu op “Goedgekeurd”.
 *  3. Na die goedkeuring is de status niet (handmatig) naar iets anders gecorrigeerd. Gebeurde dat
 *     wel, dan geldt de goedkeuring als ingetrokken, ook als iemand de status daarna handmatig
 *     terugzet op “Goedgekeurd”. Er is dan een nieuwe goedkeuring door de akkoordgever nodig
 *     (zet de versie daarvoor op “In review”) en daarna opnieuw een bewuste vrijgave.
 *
 * Een actieve oplevering is alleen downloadbaar zolang de goedkeuring waarmee hij is vrijgegeven
 * nog geldt en de versie (en video) niet in de prullenbak staan.
 */

const latestApproval = (db, versionId) =>
  db.prepare('SELECT * FROM approvals WHERE version_id = ? ORDER BY id DESC LIMIT 1').get(versionId);

/** Statuscorrectie weg van “Goedgekeurd” na (of tegelijk met) een tijdstip. */
const leftApprovedSince = (db, versionId, at) =>
  db.prepare("SELECT * FROM status_events WHERE version_id = ? AND to_status != 'approved' AND created_at >= ? ORDER BY id LIMIT 1").get(versionId, at);

/** De geldige klantgoedkeuring van een versie, of null. */
function validApproval(db, version) {
  if (!version || version.trashed_at || version.status !== 'approved') return null;
  const a = latestApproval(db, version.id);
  if (!a) return null;
  return leftApprovedSince(db, version.id, a.created_at) ? null : a;
}

/** Waarom deze versie (nog) niet kan worden vrijgegeven, in gewone taal; null = kan wel. */
function releaseProblem(db, version) {
  if (version.trashed_at) return 'Deze versie staat in de prullenbak.';
  const a = latestApproval(db, version.id);
  if (!a) {
    return version.status === 'approved'
      ? 'Handmatig op “Goedgekeurd” gezet, maar er is geen goedkeuring van de akkoordgever vastgelegd. Een statuslabel vervangt geen klantgoedkeuring.'
      : `Nog niet goedgekeurd door de akkoordgever (status: ${STATUSES[version.status]}).`;
  }
  const left = leftApprovedSince(db, version.id, a.created_at);
  if (left) {
    return `De goedkeuring van ${a.approver_name} is ingetrokken: de status is daarna gecorrigeerd naar “${STATUSES[left.to_status]}”. Er is een nieuwe goedkeuring door de akkoordgever nodig.`;
  }
  if (version.status !== 'approved') return `De versie staat niet op Goedgekeurd (status: ${STATUSES[version.status]}).`;
  return null;
}

/**
 * Staat van een oplevering. reason: null (beschikbaar) | withdrawn | approval_revoked | trashed.
 */
function deliveryState(db, d, { version, video } = {}) {
  if (d.withdrawn_at) return { available: false, reason: 'withdrawn' };
  const ver = version || db.prepare('SELECT * FROM versions WHERE id = ?').get(d.version_id);
  const vid = video || db.prepare('SELECT * FROM videos WHERE id = ?').get(d.video_id);
  if (!ver || !vid || ver.trashed_at || vid.trashed_at) return { available: false, reason: 'trashed' };
  const a = validApproval(db, ver);
  if (!a || a.id !== d.approval_id) return { available: false, reason: 'approval_revoked' };
  return { available: true, reason: null };
}

const REASON_TEAM = {
  withdrawn: 'Teruggenomen',
  approval_revoked: 'Geblokkeerd: de goedkeuring van deze versie is ingetrokken. Nieuwe downloads zijn niet mogelijk tot de akkoordgever opnieuw goedkeurt en jullie opnieuw vrijgeven.',
  trashed: 'Geblokkeerd: de versie of video staat in de prullenbak.',
};

const activeDeliveries = (db, projectId) =>
  db.prepare('SELECT * FROM deliveries WHERE project_id = ? AND withdrawn_at IS NULL ORDER BY released_at, id').all(projectId);

const activeDeliveryOf = (db, videoId) =>
  db.prepare('SELECT * FROM deliveries WHERE video_id = ? AND withdrawn_at IS NULL').get(videoId);

/** Wat de klant per bestand ziet (en wat het team in het overzicht “wat de klant krijgt” ziet). */
function fileInfo(video, version) {
  return {
    title: video.title,
    meta: videoMeta(video, version),
    format: version.extension.toUpperCase(),
    mimeType: version.mime_type,
    size: version.size_bytes,
    duration: version.duration_seconds,
    width: version.width,
    height: version.height,
    versionNumber: version.number,
    hasPoster: !!version.has_poster,
    filename: originalDownloadName(version, video),
  };
}

/**
 * De opleverpagina zoals de klant die ziet. Alleen actieve opleveringen van video’s die niet in de
 * prullenbak staan; een geblokkeerde oplevering staat er wel, maar zonder download.
 * urls: { poster(delivery), download(delivery) }
 */
function clientDeliveryDto(db, project, urls) {
  const items = [];
  for (const d of activeDeliveries(db, project.id)) {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(d.video_id);
    const version = db.prepare('SELECT * FROM versions WHERE id = ?').get(d.version_id);
    if (!video || !version || video.trashed_at) continue; // weggegooid: bestaat voor de klant niet
    const state = deliveryState(db, d, { version, video });
    const info = fileInfo(video, version);
    items.push({
      id: d.id,
      ...info,
      releasedAt: d.released_at,
      available: state.available,
      posterUrl: state.available && info.hasPoster ? urls.poster(d) : null,
      downloadUrl: state.available ? urls.download(d) : null,
    });
  }
  const order = { main: 0, teaser: 1, cutdown: 2, social: 3, other: 4 };
  items.sort((a, b) => (order[a.meta.kind] ?? 5) - (order[b.meta.kind] ?? 5) || a.releasedAt.localeCompare(b.releasedAt) || a.id - b.id);
  return {
    project: { name: project.name, clientName: project.client_name, note: project.delivery_note || '' },
    brand: brandDto(db, project.brand_id),
    archived: !!project.archived_at,
    items,
  };
}

/** Een actieve, beschikbare oplevering van dit project (voor downloads en thumbnails), anders null. */
function downloadableDelivery(db, projectId, deliveryId) {
  const id = Number(deliveryId);
  if (!Number.isSafeInteger(id)) return null;
  const d = db.prepare('SELECT * FROM deliveries WHERE id = ? AND project_id = ? AND withdrawn_at IS NULL').get(id, projectId);
  if (!d) return null;
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(d.video_id);
  const version = db.prepare('SELECT * FROM versions WHERE id = ?').get(d.version_id);
  const state = deliveryState(db, d, { version, video });
  return { delivery: d, video, version, state };
}

/**
 * Inhoud van het opleverpakket (ZIP) van een project: alleen actieve opleveringen met een geldige
 * vrijgave en goedkeuring, precies die versies, onder hun oorspronkelijke bestandsnaam. Komen namen
 * dubbel voor, dan krijgt elk zo'n bestand een eigen map met de videotitel. Plus een kort overzicht.
 */
function packageContents(db, project, { language = 'nl', localPath, sizeOf }) {
  const en = language === 'en';
  const files = [];
  for (const d of activeDeliveries(db, project.id)) {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(d.video_id);
    const version = db.prepare('SELECT * FROM versions WHERE id = ?').get(d.version_id);
    if (!video || !version || video.trashed_at) continue;
    if (!deliveryState(db, d, { version, video }).available) continue;
    const approval = db.prepare('SELECT approver_name, created_at FROM approvals WHERE id = ?').get(d.approval_id);
    files.push({ delivery: d, video, version, approval, filename: originalDownloadName(version, video) });
  }
  const order = { main: 0, teaser: 1, cutdown: 2, social: 3, other: 4 };
  files.sort((a, b) => (order[a.video.kind] ?? 5) - (order[b.video.kind] ?? 5) || a.delivery.released_at.localeCompare(b.delivery.released_at) || a.delivery.id - b.delivery.id);
  const clean = (t) => String(t || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120) || 'video';
  const count = new Map();
  for (const f of files) count.set(f.filename.toLowerCase(), (count.get(f.filename.toLowerCase()) || 0) + 1);
  const used = new Set();
  for (const f of files) {
    let name = f.filename;
    if (count.get(f.filename.toLowerCase()) > 1) {
      let folder = clean(f.video.title);
      if (used.has(`${folder}/${name}`.toLowerCase())) folder = `${folder} (${en ? 'version' : 'versie'} ${f.version.number})`;
      for (let i = 2; used.has(`${folder}/${name}`.toLowerCase()); i++) folder = `${clean(f.video.title)} (${i})`;
      name = `${folder}/${name}`;
    }
    used.add(name.toLowerCase());
    f.path = name;
  }
  const zone = (iso) => new Date(iso).toLocaleString(en ? 'en-GB' : 'nl-NL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const lines = [
    en ? `Final delivery: ${project.name}` : `Definitieve oplevering: ${project.name}`,
    project.client_name ? (en ? `For: ${project.client_name}` : `Voor: ${project.client_name}`) : null,
    en ? `Package created: ${zone(new Date().toISOString())}` : `Pakket gemaakt: ${zone(new Date().toISOString())}`,
    '',
    en ? 'Each file is exactly the approved version listed below, unchanged.' : 'Elk bestand is precies de goedgekeurde versie hieronder, ongewijzigd.',
    '',
  ].filter((l) => l !== null);
  for (const f of files) {
    lines.push(f.path);
    lines.push(`  ${en ? 'Video' : 'Video'}: ${f.video.title} · ${en ? 'version' : 'versie'} ${f.version.number}`);
    if (f.approval) lines.push(`  ${en ? 'Approved by' : 'Goedgekeurd door'}: ${f.approval.approver_name}, ${zone(f.approval.created_at)}`);
    lines.push(`  ${en ? 'Released' : 'Vrijgegeven'}: ${zone(f.delivery.released_at)}`);
    lines.push(`  ${en ? 'Size' : 'Grootte'}: ${f.version.size_bytes} bytes`);
    lines.push('');
  }
  const overview = Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
  const entries = files.map((f) => ({ name: f.path, path: localPath(f.version.stored_name), size: sizeOf(f), deliveryId: f.delivery.id }));
  entries.push({ name: en ? 'Overview.txt' : 'Overzicht.txt', buffer: overview, size: overview.length });
  return { files, entries, zipName: `${clean(project.name)} - ${en ? 'delivery' : 'oplevering'}.zip` };
}

module.exports = {
  validApproval, releaseProblem, deliveryState, activeDeliveries, activeDeliveryOf, fileInfo,
  clientDeliveryDto, downloadableDelivery, packageContents, REASON_TEAM,
};
