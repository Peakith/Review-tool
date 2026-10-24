'use strict';
const { now } = require('./db');
const auth = require('./auth');
const { HttpError } = require('./status');
const { portalDto, sharedVersions, brandDto } = require('./client');
const { activeDeliveries } = require('./deliveries');

/**
 * Klanten en hun portaal.
 *
 * - Een project hoort alleen bij een klant als het team dat expliciet heeft gekoppeld (projects.client_id).
 * - Klanttoegang per project: 'active' (zichtbaar), 'completed' (zichtbaar, ingeklapt als afgerond) of
 *   'off' (verborgen en extern geblokkeerd: ook oude project-, review-, akkoord- en opleverlinks en
 *   directe media-adressen). Weer aanzetten herstelt geen links die los waren ingetrokken; die
 *   blijven ingetrokken.
 * - Een klantportaallink geeft alleen goedkeuringsrechten als het een persoonlijke link is
 *   (approver_email) én die persoon de aangewezen akkoordgever van de video is.
 */
const VISIBILITY = ['active', 'completed', 'off'];
const LANGUAGES = ['nl', 'en'];

/** Klanttoegang uit: geen enkele externe link geeft dan toegang tot dit project. */
function assertClientAccess(project) {
  if (project && project.client_visibility === 'off') {
    throw new HttpError(410, 'Dit project is op dit moment niet beschikbaar. Neem contact op met het productieteam.', 'client_access_off');
  }
}

/** Taal van de klantweergave: die van de gekoppelde klant, anders Nederlands. */
function clientLanguage(db, project) {
  const lang = project?.client_id ? db.prepare('SELECT language FROM clients WHERE id = ?').get(project.client_id)?.language : null;
  return LANGUAGES.includes(lang) ? lang : 'nl';
}

const sameEmail = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Is de houder van deze klantportaallink de aangewezen akkoordgever van deze video? */
const isDesignatedApprover = (clientLink, video) => !!clientLink.approver_email && sameEmail(clientLink.approver_email, video.approver_email);

/**
 * Een afgeleide reviewlink via het klantportaal krijgt zijn rol op het moment van gebruik:
 * akkoordgever alleen als de persoonlijke link bij de huidige akkoordgever van de video hoort.
 * Wisselt het team van akkoordgever, dan vervalt dat recht direct.
 */
function effectiveClientShare(link, clientLink, video) {
  if (isDesignatedApprover(clientLink, video)) {
    return { ...link, role: 'approver', approver_name: video.approver_name, approver_email: video.approver_email };
  }
  return { ...link, role: 'reviewer', approver_name: '', approver_email: '' };
}

/** Reviewlink voor één video via een klantportaallink (eenmalig aangemaakt, daarna hergebruikt). */
function clientReviewToken(db, clientLink, videoId) {
  return db.tx(() => {
    const rows = db.prepare('SELECT token, revoked_at FROM share_links WHERE client_link_id = ? AND video_id = ? ORDER BY id DESC').all(clientLink.id, videoId);
    const active = rows.find((r) => !r.revoked_at);
    if (active) return active.token;
    if (rows.length) return null; // los ingetrokken: niet stilzwijgend opnieuw openen
    const token = auth.randomToken(24);
    db.prepare(`INSERT INTO share_links (video_id, token, role, label, allow_download, created_by, created_at, client_link_id)
      VALUES (?, ?, 'reviewer', 'Via klantportaal', 0, ?, ?, ?)`).run(videoId, token, clientLink.created_by, now(), clientLink.id);
    return token;
  });
}

/** Projecten die een klant in het portaal ziet: gekoppeld, niet weggegooid en klanttoegang niet uit. */
const portalProjects = (db, clientId) => db.prepare(`SELECT * FROM projects WHERE client_id = ? AND trashed_at IS NULL AND client_visibility != 'off'
  ORDER BY CASE client_visibility WHEN 'active' THEN 0 ELSE 1 END, created_at DESC, id DESC`).all(clientId);

/** Project via een klantportaallink: alleen als het (nog) bij deze klant hoort en zichtbaar is. */
function clientProject(db, clientLink, projectId) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(projectId));
  if (!p || p.client_id !== clientLink.client_id) throw new HttpError(404, 'Dit project is niet beschikbaar via deze link.', 'not_found');
  if (p.trashed_at) throw new HttpError(410, 'Dit project is niet meer beschikbaar. Neem contact op met het productieteam.', 'gone');
  assertClientAccess(p);
  return p;
}

const visibleDeliveries = (db, projectId) => activeDeliveries(db, projectId).filter((d) => !db.prepare('SELECT trashed_at FROM videos WHERE id = ?').get(d.video_id)?.trashed_at).length;

/** Het klantportaal: klant → projecten → gepubliceerde video's en opleveringen. */
function clientPortalDto(db, client, clientLink) {
  const base = `/api/client/${clientLink.token}`;
  const projects = portalProjects(db, client.id).map((p) => {
    const dto = portalDto(db, p, {
      videoLink: (v) => {
        const t = clientReviewToken(db, clientLink, v.id);
        return t ? `/r/${t}` : null;
      },
      posterUrl: (v) => `${base}/projects/${p.id}/videos/${v.id}/poster`,
      fileUrl: (b) => `${base}/projects/${p.id}/briefing/${b.id}/file`,
    });
    const deliveries = visibleDeliveries(db, p.id);
    return {
      id: p.id,
      ...dto.project,
      completed: p.client_visibility === 'completed',
      archived: dto.archived,
      brand: dto.brand,
      briefing: dto.briefing,
      videos: dto.videos.map((v) => ({ ...v, canApprove: isDesignatedApprover(clientLink, db.prepare('SELECT approver_email FROM videos WHERE id = ?').get(v.id)) })),
      delivery: deliveries ? { count: deliveries, url: `/k/${clientLink.token}/oplevering/${p.id}` } : null,
    };
  });
  return {
    client: { name: client.name },
    brand: brandDto(db, client.brand_id),
    language: LANGUAGES.includes(client.language) ? client.language : 'nl',
    identity: clientLink.approver_email ? { name: clientLink.approver_name, personal: true } : null,
    projects,
  };
}

/**
 * Vorige/volgende binnen het portaal waar de reviewlink uit voortkwam (projectlink of klantlink):
 * alleen gepubliceerde, bereikbare video's van hetzelfde project. Een losse review- of akkoordlink
 * houdt zijn oorspronkelijke bereik (één video) en krijgt dus geen navigatie.
 */
function portalNeighbours(db, project, currentVideoId, linkFor) {
  const order = { main: 0, teaser: 1, cutdown: 2, social: 3, other: 4 };
  const vids = db.prepare('SELECT * FROM videos WHERE project_id = ? AND trashed_at IS NULL ORDER BY created_at, id').all(project.id)
    .filter((v) => sharedVersions(db, v.id).length)
    .sort((a, b) => (order[a.kind] ?? 5) - (order[b.kind] ?? 5) || a.id - b.id);
  const i = vids.findIndex((v) => v.id === currentVideoId);
  if (i < 0 || vids.length < 2) return null;
  const item = (v) => {
    if (!v) return null;
    const token = linkFor(v.id);
    return token ? { title: v.title, href: `/r/${token}` } : null;
  };
  return { index: i + 1, total: vids.length, prev: item(vids[i - 1]), next: item(vids[i + 1]) };
}

module.exports = {
  VISIBILITY, LANGUAGES, assertClientAccess, clientLanguage, isDesignatedApprover, effectiveClientShare,
  clientReviewToken, portalProjects, clientProject, clientPortalDto, portalNeighbours, sameEmail,
};
