'use strict';
const { now } = require('../db');
const auth = require('../auth');
const { HttpError } = require('../status');
const { intParam } = require('../access');
const { safeFileHeaders } = require('../files');
const { posterKey } = require('../views');
const { brandDto, sharedVersions } = require('../client');
const { recordActivity, clientSource } = require('../activity');
const linkguard = require('../linkguard');
const { VISIBILITY, LANGUAGES, clientProject, clientPortalDto, portalProjects } = require('../clientportal');

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NO_STORE = 'private, no-store';
const VISIBILITY_LABELS = { active: 'Actief', completed: 'Afgerond (ingeklapt)', off: 'Klanttoegang uit' };

/** Klantkant: het klantportaal (klant → projecten → video's en opleveringen) en ontgrendelen met een wachtwoord. */
function clientPortalRoutes(router, db, config, { storage }) {
  router.use('/client/:token', (req, res, next) => {
    const token = String(req.params.token || '');
    const link = TOKEN.test(token) ? db.prepare('SELECT * FROM client_links WHERE token = ?').get(token) : null;
    linkguard.guard(db, req, 'client', link);
    req.clientLink = link;
    req.client = db.prepare('SELECT * FROM clients WHERE id = ?').get(link.client_id);
    if (!req.client) return next(new HttpError(404, 'Dit klantportaal bestaat niet meer.', 'not_found'));
    if (!link.last_used_at || Date.now() - Date.parse(link.last_used_at) > 60_000) {
      db.prepare('UPDATE client_links SET last_used_at = ? WHERE id = ?').run(now(), link.id);
    }
    next();
  });

  router.get('/client/:token', (req, res) => {
    const dto = clientPortalDto(db, req.client, req.clientLink);
    for (const p of dto.projects) recordActivity(db, req, { projectId: p.id, type: 'portal_opened', src: clientSource(req.clientLink) });
    res.json({ ...dto, linkExpiresAt: req.clientLink.expires_at || null });
  });

  // Alleen de thumbnail van de gepubliceerde versie; nooit van een intern concept.
  router.get('/client/:token/projects/:projectId/videos/:videoId/poster', async (req, res) => {
    const project = clientProject(db, req.clientLink, req.params.projectId);
    const video = db.prepare('SELECT * FROM videos WHERE id = ? AND project_id = ? AND trashed_at IS NULL').get(Number(req.params.videoId), project.id);
    const ver = video ? sharedVersions(db, video.id)[0] : null;
    if (!ver || !ver.has_poster) throw new HttpError(404, 'Geen voorvertoning');
    await storage.send(res, posterKey(ver), { 'Content-Type': 'image/jpeg', 'Cache-Control': NO_STORE });
  });

  // Projectcover voor de klant: alleen uit een gedeelde versie van een project dat bij deze klant hoort.
  router.get('/client/:token/projects/:projectId/cover', async (req, res) => {
    const project = clientProject(db, req.clientLink, req.params.projectId);
    await require('../covers').sendCover(res, storage, db, project, { sharedOnly: true });
  });

  router.get('/client/:token/projects/:projectId/briefing/:itemId/file', async (req, res) => {
    const project = clientProject(db, req.clientLink, req.params.projectId);
    const item = db.prepare("SELECT * FROM briefing_items WHERE id = ? AND project_id = ? AND kind = 'file' AND visibility = 'client' AND trashed_at IS NULL")
      .get(Number(req.params.itemId), project.id);
    if (!item) throw new HttpError(404, 'Dit bestand is niet beschikbaar.');
    await storage.send(res, item.file_key, safeFileHeaders({ mime: item.file_mime, filename: item.file_name, download: req.query.download === '1' }));
  });

  // Wachtwoord invoeren. Het wachtwoord gaat alleen in de body (nooit in de URL) en wordt niet gelogd.
  router.post('/unlock/:kind/:token', (req, res) => {
    res.json(linkguard.unlock(db, config, req, res, req.params.kind, req.params.token, req.body?.password));
  });
}

/** Teamkant: klanten, koppelen van projecten, klanttoegang per project, klantportaallinks en linkbeveiliging. */
function clientTeamRoutes(router, db, config, { access }) {
  const origin = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;
  const userName = (id) => (id ? db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || 'onbekend' : null);
  const getClient = (id) => {
    const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(intParam(id));
    if (!c) throw new HttpError(404, 'Klant niet gevonden');
    return c;
  };
  /** Projecten van deze klant die deze gebruiker mag zien (met niveau). */
  const visibleProjects = (user, clientId) => {
    const ids = access.projectIdsFor(user);
    return db.prepare('SELECT * FROM projects WHERE client_id = ? AND trashed_at IS NULL ORDER BY archived_at IS NOT NULL, created_at DESC').all(clientId)
      .filter((p) => !ids || ids.has(p.id))
      .map((p) => ({ project: p, level: ids ? ids.get(p.id) : 'manage' }));
  };

  function cleanClient(body, current = {}) {
    const name = body.name !== undefined ? String(body.name).replace(/\s+/g, ' ').trim().slice(0, 120) : current.name;
    if (!name) throw new HttpError(400, 'Geef de klant een naam.');
    const language = body.language !== undefined ? String(body.language) : (current.language || 'nl');
    if (!LANGUAGES.includes(language)) throw new HttpError(400, 'Kies Nederlands of Engels als standaardtaal.');
    let brandId = current.brand_id ?? null;
    if (body.brandId !== undefined) {
      brandId = body.brandId === null || body.brandId === '' ? null : Number(body.brandId);
      if (brandId !== null && !db.prepare('SELECT id FROM brands WHERE id = ?').get(brandId)) throw new HttpError(400, 'Onbekend merk');
    }
    return { name, language, brandId };
  }

  const linkDto = (req, l) => ({
    id: l.id,
    label: l.label,
    personal: !!l.approver_email,
    approverName: l.approver_name || null,
    approverEmail: l.approver_email || null,
    url: l.revoked_at ? null : `${origin(req)}/k/${l.token}`,
    createdAt: l.created_at,
    createdBy: userName(l.created_by),
    revokedAt: l.revoked_at,
    revokedBy: userName(l.revoked_by),
    lastUsedAt: l.last_used_at,
    protection: linkguard.protectionDto(l),
  });

  router.get('/clients', (req, res) => {
    const ids = access.projectIdsFor(req.user);
    const rows = db.prepare('SELECT * FROM clients ORDER BY name COLLATE NOCASE').all().map((c) => {
      const projects = visibleProjects(req.user, c.id);
      return {
        id: c.id,
        name: c.name,
        language: c.language,
        brand: brandDto(db, c.brand_id),
        projectCount: projects.length,
        activeProjectCount: projects.filter(({ project: p }) => !p.archived_at && p.client_visibility === 'active').length,
        activeLinks: req.user.isAdmin ? db.prepare('SELECT COUNT(*) AS n FROM client_links WHERE client_id = ? AND revoked_at IS NULL').get(c.id).n : null,
        createdAt: c.created_at,
      };
    // Teamleden zien alleen klanten met minstens één project waar ze toegang toe hebben.
    }).filter((c) => !ids || c.projectCount > 0);
    res.json({ clients: rows, canCreate: req.user.isAdmin });
  });

  router.post('/clients', (req, res) => {
    access.requireAdmin(req);
    const c = cleanClient(req.body || {});
    const info = db.prepare('INSERT INTO clients (name, brand_id, language, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(c.name, c.brandId, c.language, req.user.id, now());
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  router.get('/clients/:id', (req, res) => {
    const c = getClient(req.params.id);
    const projects = visibleProjects(req.user, c.id);
    if (!req.user.isAdmin && !projects.length) throw new HttpError(404, 'Klant niet gevonden');
    const ids = access.projectIdsFor(req.user);
    // Nog niet gekoppelde projecten die deze gebruiker mag koppelen (recht “Beheren”).
    const assignable = db.prepare('SELECT id, name, client_name, client_id FROM projects WHERE trashed_at IS NULL AND (client_id IS NULL OR client_id != ?) ORDER BY archived_at IS NOT NULL, created_at DESC').all(c.id)
      .filter((p) => !ids || ids.get(p.id) === 'manage')
      .map((p) => ({ id: p.id, name: p.name, clientName: p.client_name, otherClient: p.client_id ? db.prepare('SELECT name FROM clients WHERE id = ?').get(p.client_id)?.name || null : null }));
    res.json({
      id: c.id,
      name: c.name,
      language: c.language,
      brandId: c.brand_id,
      brand: brandDto(db, c.brand_id),
      createdAt: c.created_at,
      isAdmin: req.user.isAdmin,
      projects: projects.map(({ project: p, level }) => ({
        id: p.id,
        name: p.name,
        archived: !!p.archived_at,
        visibility: p.client_visibility,
        visibilityLabel: VISIBILITY_LABELS[p.client_visibility],
        myLevel: level,
        canManage: level === 'manage',
        videoCount: db.prepare('SELECT COUNT(*) AS n FROM videos WHERE project_id = ? AND trashed_at IS NULL').get(p.id).n,
        publishedCount: db.prepare(`SELECT COUNT(DISTINCT v.id) AS n FROM videos v JOIN versions ver ON ver.video_id = v.id
          WHERE v.project_id = ? AND v.trashed_at IS NULL AND ver.shared_at IS NOT NULL AND ver.trashed_at IS NULL`).get(p.id).n,
      })),
      // Projecten die alleen een beheerder ziet, worden voor anderen niet genoemd.
      hiddenProjects: req.user.isAdmin ? 0 : db.prepare('SELECT COUNT(*) AS n FROM projects WHERE client_id = ? AND trashed_at IS NULL').get(c.id).n - projects.length,
      assignable,
      // Links geven klanttoegang tot alle zichtbare projecten van deze klant: alleen voor beheerders.
      links: req.user.isAdmin ? db.prepare('SELECT * FROM client_links WHERE client_id = ? ORDER BY revoked_at IS NOT NULL, id DESC').all(c.id).map((l) => linkDto(req, l)) : [],
      portalProjects: portalProjects(db, c.id).length,
      localOnly: /^(localhost|127\.|\[::1\])/.test(new URL(origin(req)).host),
    });
  });

  router.patch('/clients/:id', (req, res) => {
    access.requireAdmin(req);
    const current = getClient(req.params.id);
    const c = cleanClient(req.body || {}, current);
    db.prepare('UPDATE clients SET name = ?, brand_id = ?, language = ? WHERE id = ?').run(c.name, c.brandId, c.language, current.id);
    res.json({ ok: true });
  });

  // Verwijderen kan alleen zonder gekoppelde projecten; de klantportaallinks worden ingetrokken.
  router.delete('/clients/:id', (req, res) => {
    access.requireAdmin(req);
    const c = getClient(req.params.id);
    if (db.prepare('SELECT 1 FROM projects WHERE client_id = ?').get(c.id)) throw new HttpError(409, 'Koppel eerst alle projecten (ook in archief en prullenbak) los van deze klant.');
    db.tx(() => {
      const at = now();
      for (const l of db.prepare('SELECT id FROM client_links WHERE client_id = ?').all(c.id)) {
        db.prepare('UPDATE share_links SET revoked_at = ?, revoked_by = ? WHERE client_link_id = ? AND revoked_at IS NULL').run(at, req.user.id, l.id);
      }
      db.prepare('DELETE FROM client_links WHERE client_id = ?').run(c.id);
      db.prepare('DELETE FROM clients WHERE id = ?').run(c.id);
    });
    res.json({ ok: true });
  });

  // Project koppelen aan (of losmaken van) een klant. Alleen expliciet, door wie het project beheert.
  router.put('/projects/:id/client', (req, res) => {
    const { project: p } = access.project(req, req.params.id, 'manage', { allowTrashed: true });
    const clientId = req.body?.clientId === null || req.body?.clientId === '' ? null : getClient(req.body?.clientId).id;
    db.prepare('UPDATE projects SET client_id = ? WHERE id = ?').run(clientId, p.id);
    res.json({ ok: true, clientId });
  });

  // Klanttoegang per project. "Uit" blokkeert alle externe links; weer aanzetten heropent geen los ingetrokken links.
  router.put('/projects/:id/client-visibility', (req, res) => {
    const { project: p } = access.project(req, req.params.id, 'manage', { allowTrashed: true });
    const visibility = String(req.body?.visibility || '');
    if (!VISIBILITY.includes(visibility)) throw new HttpError(400, 'Kies Actief, Afgerond of Klanttoegang uit.');
    db.prepare('UPDATE projects SET client_visibility = ? WHERE id = ?').run(visibility, p.id);
    res.json({ ok: true, visibility });
  });

  router.post('/clients/:id/links', (req, res) => {
    access.requireAdmin(req);
    const c = getClient(req.params.id);
    const body = req.body || {};
    const label = String(body.label || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const approverName = String(body.approverName || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const approverEmail = String(body.approverEmail || '').trim().toLowerCase().slice(0, 200);
    if (approverEmail && !EMAIL.test(approverEmail)) throw new HttpError(400, 'Ongeldig e-mailadres voor de akkoordgever.');
    if (approverEmail && !approverName) throw new HttpError(400, 'Vul ook de naam van de akkoordgever in.');
    const link = db.tx(() => {
      const token = auth.randomToken(24);
      const info = db.prepare(`INSERT INTO client_links (client_id, token, label, approver_name, approver_email, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(c.id, token, label || (approverEmail ? `Persoonlijk: ${approverName}` : 'Klantportaal'), approverEmail ? approverName : '', approverEmail, req.user.id, now());
      let l = db.prepare('SELECT * FROM client_links WHERE id = ?').get(Number(info.lastInsertRowid));
      if (body.password || body.expiresAt) l = linkguard.setProtection(db, 'client', l, { password: body.password || undefined, expiresAt: body.expiresAt || undefined });
      return l;
    });
    res.status(201).json(linkDto(req, link));
  });

  // Intrekken: ook de reviewlinks die via dit portaal zijn ontstaan. Een nieuwe link maken heropent die niet.
  router.post('/client-links/:id/revoke', (req, res) => {
    access.requireAdmin(req);
    const l = db.prepare('SELECT * FROM client_links WHERE id = ?').get(intParam(req.params.id));
    if (!l) throw new HttpError(404, 'Link niet gevonden');
    const at = now();
    db.tx(() => {
      db.prepare('UPDATE client_links SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL').run(at, req.user.id, l.id);
      db.prepare('UPDATE share_links SET revoked_at = ?, revoked_by = ? WHERE client_link_id = ? AND revoked_at IS NULL').run(at, req.user.id, l.id);
    });
    res.json({ ok: true });
  });

  /**
   * Wachtwoord en/of vervaldatum van een klantlink. Een nieuw of verwijderd wachtwoord maakt eerdere
   * ontgrendelingen ongeldig. Afgeleide reviewlinks (via een portaal) hebben geen eigen beveiliging:
   * daarvoor geldt die van de portaallink.
   */
  router.put('/link-protection/:kind/:id', (req, res) => {
    const kind = req.params.kind;
    const table = linkguard.TABLES[kind];
    if (!table) throw new HttpError(404, 'Onbekende soort link');
    const link = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(intParam(req.params.id));
    if (!link) throw new HttpError(404, 'Link niet gevonden');
    if (kind === 'share') {
      access.video(req, link.video_id, 'publish', { allowTrashed: true });
      if (link.project_link_id || link.client_link_id) throw new HttpError(400, 'Deze link hoort bij een klantportaal. Stel de beveiliging in op de portaallink.');
    } else if (kind === 'project' || kind === 'delivery') {
      access.project(req, link.project_id, 'publish', { allowTrashed: true });
    } else {
      access.requireAdmin(req);
    }
    if (link.revoked_at) throw new HttpError(409, 'Deze link is ingetrokken.');
    const updated = linkguard.setProtection(db, kind, link, req.body || {});
    res.json({ ok: true, protection: linkguard.protectionDto(updated) });
  });
}

module.exports = { clientPortalRoutes, clientTeamRoutes, VISIBILITY_LABELS };
