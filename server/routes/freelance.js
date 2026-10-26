'use strict';
const { HttpError } = require('../status');
const { intParam, activeAt } = require('../access');
const { commentDtos, posterKey } = require('../views');
const { sharedVersions, videoMeta } = require('../client');
const { hlsRoutes, playbackInfo } = require('../variants');
const { coverDto, sendCover, pinnedSet } = require('../covers');

/**
 * Freelanceromgeving: strikt alleen-lezen.
 *
 * Een freelancer ziet in expliciet gekoppelde projecten (zolang de koppeling geldt) alleen wat de
 * klant ook ziet: gepubliceerde versies, de afspeelversies daarvan, de thumbnail en de verstuurde
 * klantfeedback met tijdcodes, bereiken en tekeningen. Nooit: interne notities of taken,
 * ongepubliceerde versies, originelen, exports, opleverpakketten, klantlinks of klantgegevens.
 *
 * Alle overige teamroutes zijn voor freelanceraccounts dicht (zie freelanceGate). Elke aanvraag
 * controleert opnieuw de koppeling en de einddatum; een open pagina krijgt bij de volgende aanvraag
 * een duidelijke melding.
 */

/** Alleen deze teamroutes mag een freelanceraccount gebruiken; al het andere geeft 403. */
const ALLOWED = [
  ['GET', /^\/freelance(\/|$)/],
  ['GET', /^\/inbox(\/count|\/preferences)?$/],
  ['PUT', /^\/inbox\/preferences$/],
  ['POST', /^\/inbox\/(\d+\/(open|read)|read-all)$/],
  ['GET', /^\/me\/preferences$/],
  ['PUT', /^\/me\/preferences$/],
  ['POST', /^\/users\/\d+\/password$/],
  ['PUT', /^\/pins\/\d+$/],
];

function freelanceGate(req, res, next) {
  if (!req.user?.isFreelancer) return next();
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (ALLOWED.some(([m, re]) => m === method && re.test(req.path))) return next();
  next(new HttpError(403, 'Als freelancer kun je alleen klantfeedback bekijken in projecten waaraan je bent gekoppeld.', 'freelancer_read_only'));
}

function freelanceRoutes(router, db, config, { storage }) {
  const onlyFreelancer = (req) => {
    if (!req.user.isFreelancer) throw new HttpError(404, 'Niet gevonden');
  };

  /** Geldige koppeling van deze freelancer met dit project (bij elke aanvraag opnieuw). */
  function membership(req, projectId) {
    onlyFreelancer(req);
    const m = db.prepare('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, req.user.id);
    if (!m) throw new HttpError(404, 'Je hebt geen toegang (meer) tot dit project.', 'no_access');
    if (!activeAt(m)) throw new HttpError(403, 'Je toegang tot dit project is verlopen. Vraag de projectleider om je toegang te verlengen.', 'access_expired');
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!p || p.trashed_at) throw new HttpError(404, 'Dit project is niet meer beschikbaar.', 'gone');
    return { member: m, project: p };
  }

  /** Gepubliceerde, niet weggegooide versie in een geldig gekoppeld project. */
  function sharedVersion(req, id) {
    onlyFreelancer(req);
    const ver = db.prepare('SELECT * FROM versions WHERE id = ?').get(intParam(id));
    if (!ver || ver.trashed_at || !ver.shared_at) throw new HttpError(404, 'Deze versie is niet beschikbaar.', 'not_found');
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(ver.video_id);
    if (!video || video.trashed_at) throw new HttpError(404, 'Deze video is niet beschikbaar.', 'not_found');
    const ctx = membership(req, video.project_id);
    return { version: ver, video, ...ctx };
  }

  /** Klantfeedback zoals de klant die ziet, zonder interne onderdelen en zonder concepten. */
  function clientFeedback(versionId) {
    const strip = (c) => ({
      id: c.id, parentId: c.parentId, body: c.body, timecode: c.timecode, timecodeEnd: c.timecodeEnd, annotation: c.annotation,
      authorName: c.authorName, authorType: c.authorType, verified: c.verified, createdAt: c.createdAt,
    });
    return commentDtos(db, versionId, { includeInternal: false })
      .filter((c) => c.authorType !== 'team' && c.sent)
      .map((c) => ({ ...strip(c), replies: c.replies.filter((r) => r.authorType === 'team' || !r.pending).map(strip) }));
  }
  const feedbackCount = (versionId) => db.prepare("SELECT COUNT(*) AS n FROM comments WHERE version_id = ? AND internal = 0 AND author_type != 'team' AND round_id IS NOT NULL AND parent_id IS NULL").get(versionId).n;
  const expiry = (m) => (m.expires_at ? { expiresAt: m.expires_at, timeZone: config.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone } : null);

  function videosOf(project) {
    return db.prepare('SELECT * FROM videos WHERE project_id = ? AND trashed_at IS NULL ORDER BY created_at, id').all(project.id)
      .map((v) => {
        const ver = sharedVersions(db, v.id)[0];
        if (!ver) return null; // nog niet gepubliceerd: bestaat voor een freelancer niet
        return {
          id: v.id, title: v.title, meta: videoMeta(v, ver),
          version: { id: ver.id, number: ver.number, duration: ver.duration_seconds, posterUrl: ver.has_poster ? `/api/freelance/versions/${ver.id}/poster` : null },
          versions: sharedVersions(db, v.id).map((x) => ({ id: x.id, number: x.number, feedback: feedbackCount(x.id) })),
          feedback: feedbackCount(ver.id),
        };
      }).filter(Boolean);
  }

  // Startpagina: gekoppelde projecten (alleen geldige koppelingen) met aantallen klantfeedback.
  router.get('/freelance/overview', (req, res) => {
    onlyFreelancer(req);
    const pins = pinnedSet(db, req.user.id);
    const at = new Date().toISOString();
    const projects = db.prepare(`SELECT p.*, pm.expires_at AS member_expires_at FROM project_members pm JOIN projects p ON p.id = pm.project_id
      WHERE pm.user_id = ? AND p.trashed_at IS NULL ORDER BY p.created_at DESC, p.id DESC`).all(req.user.id)
      .filter((p) => activeAt({ expires_at: p.member_expires_at }, at))
      .map((p) => {
        const videos = videosOf(p);
        return { id: p.id, name: p.name, clientName: p.client_name || '', archived: !!p.archived_at, ...expiry({ expires_at: p.member_expires_at }), videoCount: videos.length, feedback: videos.reduce((n, v) => n + v.feedback, 0),
          cover: coverDto(db, p, `/api/freelance/projects/${p.id}/cover`, { sharedOnly: true }), pinned: pins.has(p.id) };
      });
    // Vastgezette projecten eerst (alleen geldige koppelingen staan in deze lijst).
    projects.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    res.json({ projects });
  });

  // Zoeken (⌘K) binnen de geldige koppelingen: projectnamen en titels van gepubliceerde video's.
  router.get('/freelance/search', (req, res) => {
    onlyFreelancer(req);
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
    const at = new Date().toISOString();
    const projects = db.prepare(`SELECT p.*, pm.expires_at AS member_expires_at FROM project_members pm JOIN projects p ON p.id = pm.project_id
      WHERE pm.user_id = ? AND p.trashed_at IS NULL ORDER BY p.created_at DESC`).all(req.user.id).filter((p) => activeAt({ expires_at: p.member_expires_at }, at));
    const hit = (t) => !q || String(t || '').toLowerCase().includes(q);
    const out = { projects: [], videos: [] };
    for (const p of projects) {
      if (hit(p.name) || hit(p.client_name)) out.projects.push({ title: p.name, sub: p.client_name || '', href: `/projecten/${p.id}` });
      for (const v of videosOf(p)) if (q && hit(v.title)) out.videos.push({ title: v.title, sub: `${p.name} · klant ziet v${v.version.number}`, href: `/video/${v.id}` });
    }
    res.json({ q, groups: { projects: { items: out.projects.slice(0, 8) }, videos: { items: out.videos.slice(0, 8) } } });
  });

  router.get('/freelance/projects/:id', (req, res) => {
    const { project, member } = membership(req, intParam(req.params.id));
    res.json({ project: { id: project.id, name: project.name, clientName: project.client_name || '', archived: !!project.archived_at, ...expiry(member),
      cover: coverDto(db, project, `/api/freelance/projects/${project.id}/cover`, { sharedOnly: true }), pinned: pinnedSet(db, req.user.id).has(project.id) }, videos: videosOf(project) });
  });

  // Cover alleen uit een gedeelde versie (nooit een intern frame), bij een geldige koppeling.
  router.get('/freelance/projects/:id/cover', async (req, res) => {
    const { project } = membership(req, intParam(req.params.id));
    await sendCover(res, storage, db, project, { sharedOnly: true });
  });

  // Eén video: gepubliceerde versies en klantfeedback bij de gekozen (of nieuwste gepubliceerde) versie.
  router.get('/freelance/videos/:id', (req, res) => {
    onlyFreelancer(req);
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(intParam(req.params.id));
    if (!video || video.trashed_at) throw new HttpError(404, 'Deze video is niet beschikbaar.', 'not_found');
    const { project, member } = membership(req, video.project_id);
    const shared = sharedVersions(db, video.id);
    if (!shared.length) throw new HttpError(404, 'Deze video is niet beschikbaar.', 'not_found');
    const wanted = Number(req.query.v);
    const ver = shared.find((x) => x.id === wanted) || shared[0];
    const pb = playbackInfo(db, ver.id);
    res.json({
      project: { id: project.id, name: project.name, ...expiry(member) },
      video: { id: video.id, title: video.title, meta: videoMeta(video, ver) },
      version: { id: ver.id, number: ver.number, duration: ver.duration_seconds, width: ver.width, height: ver.height, posterUrl: ver.has_poster ? `/api/freelance/versions/${ver.id}/poster` : null },
      versions: shared.map((x) => ({ id: x.id, number: x.number, feedback: feedbackCount(x.id) })),
      // Alleen afspeelversies; nooit het origineel.
      playback: { levels: pb.levels, preparing: pb.preparing, failed: pb.failed, progress: pb.progress, original: false },
      comments: clientFeedback(ver.id),
      // Gedeelde vragen aan de klant over deze video (context), alleen lezen.
      questions: require('../questions').visibleQuestions(db, [project.id]).filter((q) => q.video_id === video.id)
        .map((q) => { const d = require('../questions').questionDto(db, q); return { id: d.id, body: d.body, status: d.status, versionNumber: d.versionNumber, createdAt: d.createdAt, answer: d.answer }; }),
    });
  });

  router.get('/freelance/versions/:id/poster', async (req, res) => {
    const { version } = sharedVersion(req, req.params.id);
    if (!version.has_poster) throw new HttpError(404, 'Geen voorvertoning');
    await storage.send(res, posterKey(version), { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' });
  });

  hlsRoutes(router, '/freelance/versions/:id', { db, storage, versionOf: (req) => sharedVersion(req, req.params.id).version });
}

module.exports = { freelanceRoutes, freelanceGate, FREELANCE_ALLOWED: ALLOWED };
