'use strict';
const { now } = require('../db');
const auth = require('../auth');
const { HttpError, STATUSES } = require('../status');
const { intParam } = require('../access');
const { contentDisposition } = require('../media');
const { posterKey } = require('../views');
const {
  validApproval, releaseProblem, deliveryState, activeDeliveries, activeDeliveryOf, fileInfo,
  clientDeliveryDto, downloadableDelivery, REASON_TEAM,
} = require('../deliveries');
const { recordActivity, deliverySource, portalSource, clientSource, isFirstRequest } = require('../activity');
const linkguard = require('../linkguard');
const { assertClientAccess, clientLanguage, clientProject } = require('../clientportal');

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const NO_STORE = 'private, no-store';
const userName = (db, id) => (id ? db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || 'onbekend' : null);

/** Stuurt het bestand van een oplevering (gestreamd, met echte extensie en zichtbare titel). */
async function sendDeliveryFile(storage, res, found) {
  const info = fileInfo(found.video, found.version);
  await storage.send(res, found.version.stored_name, { 'Content-Type': found.version.mime_type, 'Content-Disposition': contentDisposition(info.filename), 'Cache-Control': NO_STORE });
}

function notAvailable(found) {
  if (!found) return new HttpError(404, 'Dit bestand is niet (meer) beschikbaar via deze link.');
  if (!found.state.available) return new HttpError(410, 'Dit bestand is tijdelijk niet beschikbaar. Neem contact op met het productieteam.');
  return null;
}

/** Klantkant: opleverpagina via de afzonderlijke opleverlink en via het klantportaal. */
function deliveryClientRoutes(router, db, config, { storage }) {
  router.use('/delivery/:token', (req, res, next) => {
    const token = String(req.params.token || '');
    const link = TOKEN.test(token) ? db.prepare('SELECT * FROM delivery_links WHERE token = ?').get(token) : null;
    linkguard.guard(db, req, 'delivery', link);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(link.project_id);
    if (!project || project.trashed_at) return next(new HttpError(410, 'Dit project is niet meer beschikbaar. Neem contact op met het productieteam.', 'gone'));
    assertClientAccess(project);
    req.deliveryLink = link;
    req.project = project;
    if (!link.last_used_at || Date.now() - Date.parse(link.last_used_at) > 60_000) {
      db.prepare('UPDATE delivery_links SET last_used_at = ? WHERE id = ?').run(now(), link.id);
    }
    next();
  });

  const pages = [
    // [routeprefix, bron, url-basis, terug naar]
    { prefix: '/delivery/:token', src: (req) => deliverySource(req.deliveryLink), base: (req) => `/api/delivery/${req.deliveryLink.token}/files`, back: () => null },
    { prefix: '/portal/:token/delivery', src: (req) => portalSource(req.projectLink), base: (req) => `/api/portal/${req.projectLink.token}/delivery`, back: (req) => `/p/${req.projectLink.token}` },
    { prefix: '/client/:token/projects/:projectId/delivery', src: (req) => clientSource(req.clientLink), base: (req) => `/api/client/${req.clientLink.token}/projects/${req.project.id}/delivery`, back: (req) => `/k/${req.clientLink.token}` },
  ];
  // Via het klantportaal: alleen projecten die (nog) bij deze klant horen en niet op "uit" staan.
  router.use('/client/:token/projects/:projectId/delivery', (req, res, next) => {
    req.project = clientProject(db, req.clientLink, req.params.projectId);
    next();
  });
  for (const page of pages) {
    const filePath = page.prefix === '/delivery/:token' ? '/delivery/:token/files/:deliveryId' : `${page.prefix}/:deliveryId`;
    router.get(page.prefix, (req, res) => {
      const base = page.base(req);
      const dto = clientDeliveryDto(db, req.project, { poster: (d) => `${base}/${d.id}/poster`, download: (d) => `${base}/${d.id}/download` });
      recordActivity(db, req, { projectId: req.project.id, type: 'delivery_opened', src: page.src(req) });
      const own = req.deliveryLink || req.projectLink || req.clientLink;
      res.json({ ...dto, language: clientLanguage(db, req.project), linkExpiresAt: own?.expires_at || null, portal: page.back(req) ? { url: page.back(req) } : null });
    });
    // Thumbnail telt niet als klantactie.
    router.get(`${filePath}/poster`, async (req, res) => {
      const found = downloadableDelivery(db, req.project.id, req.params.deliveryId);
      const err = notAvailable(found);
      if (err) throw err;
      if (!found.version.has_poster) throw new HttpError(404, 'Geen voorvertoning');
      await storage.send(res, posterKey(found.version), { 'Content-Type': 'image/jpeg', 'Cache-Control': NO_STORE });
    });
    router.get(`${filePath}/download`, async (req, res) => {
      const found = downloadableDelivery(db, req.project.id, req.params.deliveryId);
      const err = notAvailable(found);
      if (err) throw err;
      // Alleen het eerste verzoek telt (geen vervolgdelen of HEAD) en hooguit eens per venster.
      if (isFirstRequest(req)) {
        recordActivity(db, req, { projectId: req.project.id, type: 'download_requested', videoId: found.video.id, versionId: found.version.id, deliveryId: found.delivery.id, src: page.src(req) });
      }
      await sendDeliveryFile(storage, res, found);
    });
  }
}

/** Teamkant: vrijgeven, terugnemen, vervangen, opleverlink en voorbeeld. */
function deliveryTeamRoutes(router, db, config, { access, storage, notifier }) {
  const origin = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;
  const activeLink = (projectId) => db.prepare('SELECT * FROM delivery_links WHERE project_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1').get(projectId);
  const linkDto = (req, l) => (l ? { id: l.id, url: `${origin(req)}/o/${l.token}`, createdAt: l.created_at, lastUsedAt: l.last_used_at, protection: linkguard.protectionDto(l) } : null);
  const localOnly = (req) => /^(localhost|127\.|\[::1\])/.test(new URL(origin(req)).host);

  /** Nieuwere versies dan de opgeleverde: de nieuwste interne en de nieuwste gepubliceerde. */
  function newerVersions(videoId, number) {
    const internal = db.prepare('SELECT number, status FROM versions WHERE video_id = ? AND number > ? AND trashed_at IS NULL ORDER BY number DESC LIMIT 1').get(videoId, number);
    const published = db.prepare('SELECT number, status FROM versions WHERE video_id = ? AND number > ? AND trashed_at IS NULL AND shared_at IS NOT NULL ORDER BY number DESC LIMIT 1').get(videoId, number);
    const dto = (v) => (v ? { number: v.number, status: v.status, statusLabel: STATUSES[v.status] } : null);
    return { internal: dto(internal), published: dto(published) };
  }

  /** Welke andere links geven (volgens hun eigen rechten) nog toegang tot deze bestanden? */
  function otherAccess(projectId) {
    const count = (sql) => db.prepare(sql).get(projectId).n;
    const base = 'FROM share_links s JOIN videos v ON v.id = s.video_id WHERE v.project_id = ? AND v.trashed_at IS NULL AND s.revoked_at IS NULL AND s.project_link_id IS NULL AND s.client_link_id IS NULL';
    return {
      portalLinkActive: !!db.prepare('SELECT 1 FROM project_links WHERE project_id = ? AND revoked_at IS NULL').get(projectId),
      reviewLinksWithDownload: count(`SELECT COUNT(*) AS n ${base} AND s.role = 'reviewer' AND s.allow_download = 1`),
      reviewLinks: count(`SELECT COUNT(*) AS n ${base} AND s.role = 'reviewer'`),
      approverLinks: count(`SELECT COUNT(*) AS n ${base} AND s.role = 'approver'`),
    };
  }

  function deliveryRow(d) {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(d.video_id);
    const version = db.prepare('SELECT * FROM versions WHERE id = ?').get(d.version_id);
    const approval = db.prepare('SELECT approver_name, created_at FROM approvals WHERE id = ?').get(d.approval_id);
    const state = deliveryState(db, d, { version, video });
    return {
      id: d.id,
      videoId: d.video_id,
      versionId: d.version_id,
      versionNumber: version.number,
      title: video.title,
      videoTrashed: !!video.trashed_at,
      releasedAt: d.released_at,
      releasedBy: userName(db, d.released_by),
      approval: approval ? { name: approval.approver_name, at: approval.created_at } : null,
      available: state.available,
      reason: state.reason,
      reasonText: state.reason ? REASON_TEAM[state.reason] : null,
      newer: newerVersions(d.video_id, version.number),
      file: fileInfo(video, version),
      withdrawnAt: d.withdrawn_at,
      withdrawnBy: userName(db, d.withdrawn_by),
      withdrawnReason: d.withdrawn_reason,
      replacedByNumber: d.replaced_by ? db.prepare('SELECT ver.number FROM deliveries x JOIN versions ver ON ver.id = x.version_id WHERE x.id = ?').get(d.replaced_by)?.number ?? null : null,
    };
  }

  router.get('/projects/:id/deliveries', (req, res) => {
    const { project: p, level } = access.project(req, req.params.id, 'view');
    const mayShare = level === 'publish' || level === 'manage';
    const all = db.prepare('SELECT * FROM deliveries WHERE project_id = ? ORDER BY released_at DESC, id DESC').all(p.id);
    res.json({
      note: p.delivery_note || '',
      myLevel: level,
      archived: !!p.archived_at,
      active: activeDeliveries(db, p.id).map(deliveryRow),
      history: all.map(deliveryRow),
      // Links alleen voor wie mag delen: de URL geeft klanttoegang.
      link: mayShare ? linkDto(req, activeLink(p.id)) : null,
      linkActive: !!activeLink(p.id),
      linkHistory: mayShare ? db.prepare('SELECT * FROM delivery_links WHERE project_id = ? ORDER BY id DESC').all(p.id).map((l) => ({
        id: l.id, createdAt: l.created_at, createdBy: userName(db, l.created_by), revokedAt: l.revoked_at, revokedBy: userName(db, l.revoked_by), lastUsedAt: l.last_used_at,
      })) : [],
      otherAccess: otherAccess(p.id),
      localOnly: localOnly(req),
    });
  });

  // Welke versies kunnen worden vrijgegeven? Per video alle versies met hun goedkeuringsstatus.
  router.get('/projects/:id/delivery-candidates', (req, res) => {
    const { project: p } = access.project(req, req.params.id, 'publish');
    const videos = db.prepare('SELECT * FROM videos WHERE project_id = ? AND trashed_at IS NULL ORDER BY created_at, id').all(p.id).map((v) => {
      const current = activeDeliveryOf(db, v.id);
      const versions = db.prepare('SELECT * FROM versions WHERE video_id = ? AND trashed_at IS NULL ORDER BY number DESC').all(v.id).map((ver) => {
        const a = validApproval(db, ver);
        return {
          id: ver.id,
          number: ver.number,
          status: ver.status,
          statusLabel: STATUSES[ver.status],
          eligible: !!a,
          approval: a ? { name: a.approver_name, at: a.created_at } : null,
          problem: a ? null : releaseProblem(db, ver),
          file: fileInfo(v, ver),
        };
      });
      return {
        id: v.id,
        title: v.title,
        archived: !!v.archived_at,
        current: current ? deliveryRow(current) : null,
        versions,
      };
    });
    res.json({ videos });
  });

  /**
   * Bewust vrijgeven. items: [{ versionId, replace }]. Elke versie moet een geldige klantgoedkeuring
   * hebben; anders wordt niets vrijgegeven. Vervangt het de huidige oplevering van die video door
   * een andere versie, dan moet replace: true expliciet zijn meegestuurd.
   */
  router.post('/projects/:id/deliveries', (req, res) => {
    const { project: p } = access.project(req, req.params.id, 'publish', { write: true });
    const body = req.body || {};
    if (body.confirm !== true) throw new HttpError(400, 'Bevestig de vrijgave na het bekijken van het overzicht.');
    const requestId = /^[A-Za-z0-9_-]{8,64}$/.test(String(body.requestId || '')) ? String(body.requestId) : null;
    if (!requestId) throw new HttpError(400, 'Ontbrekende request-id. Ververs de pagina en probeer het opnieuw.');
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw new HttpError(400, 'Kies minstens één goedgekeurde versie om vrij te geven.');
    if (items.length > 200) throw new HttpError(400, 'Te veel versies tegelijk.');
    const result = db.tx(() => {
      const prior = db.prepare('SELECT id FROM deliveries WHERE project_id = ? AND request_id = ?').all(p.id, requestId);
      if (prior.length) return { replayed: true, released: prior.map((r) => r.id), unchanged: [] };
      const problems = [];
      const plan = [];
      const seenVideos = new Set();
      for (const item of items) {
        const ver = db.prepare('SELECT * FROM versions WHERE id = ?').get(Number(item?.versionId));
        const video = ver ? db.prepare('SELECT * FROM videos WHERE id = ?').get(ver.video_id) : null;
        if (!ver || !video || video.project_id !== p.id) { problems.push({ versionId: item?.versionId ?? null, error: 'Deze versie hoort niet bij dit project.' }); continue; }
        const label = `${video.title} · versie ${ver.number}`;
        if (video.trashed_at) { problems.push({ versionId: ver.id, title: label, error: 'De video staat in de prullenbak.' }); continue; }
        if (video.archived_at) { problems.push({ versionId: ver.id, title: label, error: 'De video is gearchiveerd. Haal hem eerst uit het archief.' }); continue; }
        if (seenVideos.has(video.id)) { problems.push({ versionId: ver.id, title: label, error: 'Per video kan één versie de oplevering zijn.' }); continue; }
        seenVideos.add(video.id);
        const approval = validApproval(db, ver);
        if (!approval) { problems.push({ versionId: ver.id, title: label, error: releaseProblem(db, ver) }); continue; }
        const current = activeDeliveryOf(db, video.id);
        if (current && current.version_id === ver.id && deliveryState(db, current).available) { plan.push({ unchanged: current.id }); continue; }
        if (current && current.version_id !== ver.id && item.replace !== true) {
          const curNumber = db.prepare('SELECT number FROM versions WHERE id = ?').get(current.version_id).number;
          problems.push({ versionId: ver.id, title: label, needsReplace: true, error: `Vervangt de huidige oplevering (versie ${curNumber}). Bevestig het vervangen.` });
          continue;
        }
        plan.push({ ver, video, approval, current });
      }
      if (problems.length) {
        const err = new HttpError(409, problems.length === 1 ? problems[0].error : `${problems.length} versies kunnen niet worden vrijgegeven. Er is niets vrijgegeven.`);
        err.details = problems;
        throw err;
      }
      const at = now();
      const released = [];
      const unchanged = [];
      for (const step of plan) {
        if (step.unchanged) { unchanged.push(step.unchanged); continue; }
        if (step.current) {
          const reason = step.current.version_id === step.ver.id ? 'Opnieuw vrijgegeven na een nieuwe goedkeuring' : `Vervangen door versie ${step.ver.number}`;
          db.prepare('UPDATE deliveries SET withdrawn_at = ?, withdrawn_by = ?, withdrawn_reason = ? WHERE id = ?').run(at, req.user.id, reason, step.current.id);
        }
        const id = Number(db.prepare(`INSERT INTO deliveries (project_id, video_id, version_id, approval_id, released_by, released_at, request_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(p.id, step.video.id, step.ver.id, step.approval.id, req.user.id, at, requestId).lastInsertRowid);
        if (step.current) db.prepare('UPDATE deliveries SET replaced_by = ? WHERE id = ?').run(id, step.current.id);
        released.push(id);
      }
      return { replayed: false, released, unchanged };
    });
    if (!result.replayed) for (const id of result.released) notifier.emit('deliveryChanged', { deliveryId: id, action: 'released', actorUserId: req.user.id, actorLabel: req.user.name });
    res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
  });

  // Terugnemen: de oplevering verdwijnt van de opleverpagina; downloads stoppen direct.
  router.post('/deliveries/:id/withdraw', (req, res) => {
    const d = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(intParam(req.params.id));
    if (!d) throw new HttpError(404, 'Oplevering niet gevonden');
    access.project(req, d.project_id, 'publish', { allowTrashed: true });
    if (req.body?.confirm !== true) throw new HttpError(400, 'Bevestig het terugnemen.');
    const reason = String(req.body?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!reason) throw new HttpError(400, 'Geef een reden; die wordt in de oplevergeschiedenis bewaard.');
    if (d.withdrawn_at) return res.json({ ok: true, already: true });
    db.prepare('UPDATE deliveries SET withdrawn_at = ?, withdrawn_by = ?, withdrawn_reason = ? WHERE id = ? AND withdrawn_at IS NULL').run(now(), req.user.id, reason, d.id);
    notifier.emit('deliveryChanged', { deliveryId: d.id, action: 'withdrawn', actorUserId: req.user.id, actorLabel: req.user.name });
    res.json({ ok: true });
  });

  router.put('/projects/:id/delivery-note', (req, res) => {
    const { project: p } = access.project(req, req.params.id, 'publish', { write: true });
    const note = String(req.body?.note ?? '').trim().slice(0, 2000);
    db.prepare('UPDATE projects SET delivery_note = ? WHERE id = ?').run(note, p.id);
    res.json({ ok: true, note });
  });

  // Opleverlink maken, of met { replace: true } vervangen (de oude werkt daarna niet meer).
  router.post('/projects/:id/delivery-link', (req, res) => {
    const { project: p } = access.project(req, req.params.id, 'publish', { write: true });
    const result = db.tx(() => {
      const current = activeLink(p.id);
      if (current && req.body?.replace !== true) return { link: current, created: false };
      if (current) db.prepare('UPDATE delivery_links SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(now(), req.user.id, current.id);
      const info = db.prepare('INSERT INTO delivery_links (project_id, token, created_by, created_at) VALUES (?, ?, ?, ?)').run(p.id, auth.randomToken(24), req.user.id, now());
      return { link: db.prepare('SELECT * FROM delivery_links WHERE id = ?').get(Number(info.lastInsertRowid)), created: true, replaced: !!current };
    });
    res.status(result.created ? 201 : 200).json({ link: linkDto(req, result.link), created: result.created, replaced: !!result.replaced });
  });

  // Intrekken mag ook bij een gearchiveerd project of een project in de prullenbak.
  router.post('/projects/:id/delivery-link/revoke', (req, res) => {
    const { project: p } = access.project(req, req.params.id, 'publish', { allowTrashed: true });
    const current = activeLink(p.id);
    if (current) db.prepare('UPDATE delivery_links SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(now(), req.user.id, current.id);
    res.json({ ok: true, revoked: !!current });
  });

  // Voorbeeld voor het team: precies de klantopbouw, alleen-lezen (geen downloads, geen activiteit).
  router.get('/projects/:id/delivery-preview', (req, res) => {
    const { project: p } = access.project(req, req.params.id, 'view');
    const dto = clientDeliveryDto(db, p, {
      poster: (d) => `/api/versions/${d.version_id}/poster`,
      download: () => null,
    });
    res.json({ ...dto, portal: { url: `/voorbeeld/project/${p.id}` }, preview: { projectId: p.id, linkActive: !!activeLink(p.id) } });
  });
}

module.exports = { deliveryClientRoutes, deliveryTeamRoutes };
