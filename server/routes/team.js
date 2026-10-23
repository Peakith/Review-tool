'use strict';
const { now } = require('../db');
const { STATUSES, HttpError, changeStatus } = require('../status');
const auth = require('../auth');
const { normalizeTitle, titleFromFilename, downloadFilename, contentDisposition } = require('../media');
const { versionDto, versionFileDto, commentDtos, eventDtos, approvalDto, roundDtos } = require('../views');
const { intParam } = require('../access');

// Media voor het team: wel cachen, maar bij elk gebruik opnieuw laten controleren, zodat
// een item in de prullenbak of ingetrokken toegang direct effect heeft.
const MEDIA_CACHE = 'private, no-cache';

function teamRoutes(router, db, config, { finalize, access, storage }) {
  const actor = (req) => ({ actorType: 'team', actorLabel: req.user.name, userId: req.user.id });

  // Actieve (niet-weggegooide) versies; nummering telt weggegooide versies wel mee.
  const latestVersion = (videoId) => db.prepare('SELECT * FROM versions WHERE video_id = ? AND trashed_at IS NULL ORDER BY number DESC LIMIT 1').get(videoId);
  const latestShared = (videoId) =>
    db.prepare('SELECT * FROM versions WHERE video_id = ? AND shared_at IS NOT NULL AND trashed_at IS NULL ORDER BY number DESC LIMIT 1').get(videoId);

  const linkUrl = (req, token) => `${config.publicUrl || `${req.protocol}://${req.get('host')}`}/r/${token}`;

  // Open klantreacties: hoofdreacties van klant of akkoordgever die het team nog niet heeft afgehandeld.
  const openClientComments = (versionId) => db.prepare(
    "SELECT COUNT(*) AS n FROM comments WHERE version_id = ? AND parent_id IS NULL AND resolved_at IS NULL AND author_type != 'team'",
  ).get(versionId).n;
  const videoActivity = (video) => db.prepare(`SELECT MAX(at) AS at FROM (
      SELECT ? AS at
      UNION ALL SELECT MAX(c.created_at) FROM comments c JOIN versions v ON v.id = c.version_id WHERE v.video_id = ?
      UNION ALL SELECT MAX(e.created_at) FROM status_events e JOIN versions v ON v.id = e.version_id WHERE v.video_id = ?
    )`).get(video.updated_at, video.id, video.id).at;

  /** Samenvatting van een video voor overzichten: interne nieuwste versie én wat de klant ziet. */
  function videoSummary(v) {
    const latest = latestVersion(v.id);
    const shared = latestShared(v.id);
    const poster = db.prepare('SELECT id FROM versions WHERE video_id = ? AND has_poster = 1 AND trashed_at IS NULL ORDER BY number DESC LIMIT 1').get(v.id);
    return {
      id: v.id,
      title: v.title,
      approverName: v.approver_name,
      updatedAt: v.updated_at,
      archivedAt: v.archived_at,
      lastActivityAt: videoActivity(v),
      versionCount: db.prepare('SELECT COUNT(*) AS n FROM versions WHERE video_id = ? AND trashed_at IS NULL').get(v.id).n,
      latestVersion: latest ? versionDto(latest) : null,
      sharedVersion: shared ? versionDto(shared) : null,
      latestSharedNumber: shared?.number || null,
      posterVersionId: poster?.id || null,
      openComments: shared ? openClientComments(shared.id) : 0,
    };
  }

  // ---------- Projecten ----------

  router.get('/projects', (req, res) => {
    const allowed = access.projectIdsFor(req.user);
    const includeArchived = req.query.archived === '1';
    const projects = db.prepare('SELECT * FROM projects WHERE trashed_at IS NULL ORDER BY created_at DESC').all()
      .filter((p) => (!allowed || allowed.has(p.id)) && (includeArchived || !p.archived_at));
    const result = projects.map((p) => {
      const videos = db.prepare('SELECT * FROM videos WHERE project_id = ? AND trashed_at IS NULL AND archived_at IS NULL').all(p.id).map(videoSummary);
      const statusCounts = Object.fromEntries(Object.keys(STATUSES).map((st) => [st, 0]));
      for (const v of videos) if (v.latestVersion) statusCounts[v.latestVersion.status] += 1;
      videos.sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)));
      const lastActivityAt = [p.created_at, ...videos.map((v) => v.lastActivityAt)].filter(Boolean).sort().at(-1);
      return {
        id: p.id,
        name: p.name,
        clientName: p.client_name,
        createdAt: p.created_at,
        archivedAt: p.archived_at,
        myLevel: allowed ? allowed.get(p.id) : 'manage',
        lastActivityAt,
        videoCount: videos.length,
        statusCounts,
        openComments: videos.reduce((n, v) => n + v.openComments, 0),
        posters: videos.filter((v) => v.posterVersionId).slice(0, 3).map((v) => v.posterVersionId),
      };
    });
    result.sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)));
    res.json(result);
  });

  router.post('/projects', (req, res) => {
    access.requireAdmin(req);
    const name = normalizeTitle(req.body?.name);
    if (!name) throw new HttpError(400, 'Geef het project een naam');
    const clientName = String(req.body?.clientName || '').trim().slice(0, 200);
    const info = db.prepare('INSERT INTO projects (name, client_name, created_by, created_at) VALUES (?, ?, ?, ?)')
      .run(name, clientName, req.user.id, now());
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  router.patch('/projects/:id', (req, res) => {
    const { project: p } = access.project(req, req.params.id, 'manage', { write: true });
    const name = req.body?.name !== undefined ? normalizeTitle(req.body.name) : p.name;
    if (!name) throw new HttpError(400, 'Geef het project een naam');
    const clientName = req.body?.clientName !== undefined ? String(req.body.clientName).trim().slice(0, 200) : p.client_name;
    db.prepare('UPDATE projects SET name = ?, client_name = ? WHERE id = ?').run(name, clientName, p.id);
    res.json({ ok: true });
  });

  router.get('/projects/:id', (req, res) => {
    const { project: p, level } = access.project(req, req.params.id, 'view');
    const includeArchived = req.query.archived === '1';
    const videos = db.prepare(`SELECT * FROM videos WHERE project_id = ? AND trashed_at IS NULL ${includeArchived ? '' : 'AND archived_at IS NULL'} ORDER BY created_at DESC`).all(p.id);
    res.json({
      id: p.id,
      name: p.name,
      clientName: p.client_name,
      createdAt: p.created_at,
      archivedAt: p.archived_at,
      myLevel: level,
      archivedVideoCount: db.prepare('SELECT COUNT(*) AS n FROM videos WHERE project_id = ? AND trashed_at IS NULL AND archived_at IS NOT NULL').get(p.id).n,
      videos: videos.map(videoSummary),
    });
  });

  // Archiveren: blijft bewaard (ook de bestanden), verdwijnt uit het actieve overzicht en wordt alleen-lezen.
  router.post('/projects/:id/archive', (req, res) => {
    const { project: p } = access.project(req, req.params.id, 'manage');
    const archived = req.body?.archived !== false;
    db.prepare('UPDATE projects SET archived_at = ?, archived_by = ? WHERE id = ?').run(archived ? now() : null, archived ? req.user.id : null, p.id);
    res.json({ ok: true, archived });
  });

  // "Verwijderen" verplaatst naar de prullenbak; definitief verwijderen is een aparte beheeractie.
  router.delete('/projects/:id', (req, res) => {
    const { project: p } = access.project(req, req.params.id, 'manage');
    db.prepare('UPDATE projects SET trashed_at = ?, trashed_by = ? WHERE id = ?').run(now(), req.user.id, p.id);
    res.json({ ok: true, trashed: true });
  });

  // ---------- Video's & versies ----------

  function insertVersion(videoId, file, user) {
    const number = (db.prepare('SELECT MAX(number) AS n FROM versions WHERE video_id = ?').get(videoId).n || 0) + 1;
    const info = db.prepare(`INSERT INTO versions
      (video_id, number, original_filename, stored_name, extension, mime_type, size_bytes, duration_seconds, width, height, has_poster, status, uploaded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'concept', ?, ?)`)
      .run(videoId, number, file.originalFilename, file.storedName, file.extension, file.mimeType, file.size,
        file.duration, file.width, file.height, file.hasPoster ? 1 : 0, user.id, now());
    const versionId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO status_events (version_id, from_status, to_status, event, actor_type, actor_label, actor_user_id, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)')
      .run(versionId, 'concept', 'upload', 'team', user.name, user.id, now());
    db.prepare('UPDATE videos SET updated_at = ? WHERE id = ?').run(now(), videoId);
    return { versionId, number };
  }

  router.post('/projects/:id/videos', async (req, res) => {
    const { project: p } = access.project(req, req.params.id, 'upload', { write: true });
    const file = await finalize(req.body?.uploadId, req.user, { projectId: p.id });
    // De titel is vrij te kiezen; zonder titel stellen we er een voor zonder extensie.
    const title = normalizeTitle(req.body?.title) || titleFromFilename(file.originalFilename);
    const result = db.tx(() => {
      const info = db.prepare('INSERT INTO videos (project_id, title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(p.id, title, req.user.id, now(), now());
      const videoId = Number(info.lastInsertRowid);
      return { videoId, ...insertVersion(videoId, file, req.user) };
    });
    res.status(201).json(result);
  });

  router.post('/videos/:id/versions', async (req, res) => {
    const { video } = access.video(req, req.params.id, 'upload', { write: true });
    const file = await finalize(req.body?.uploadId, req.user, { videoId: video.id, projectId: video.project_id });
    // Nieuwe versie: titel, deel-links en akkoordgever blijven bij de video.
    const result = db.tx(() => insertVersion(video.id, file, req.user));
    res.status(201).json(result);
  });

  router.get('/videos/:id', (req, res) => {
    const { video: v, project, level } = access.video(req, req.params.id, 'view');
    const versions = db.prepare('SELECT * FROM versions WHERE video_id = ? AND trashed_at IS NULL ORDER BY number DESC').all(v.id);
    const links = db.prepare('SELECT * FROM share_links WHERE video_id = ? ORDER BY created_at DESC').all(v.id);
    const shared = latestShared(v.id);
    res.json({
      id: v.id,
      title: v.title,
      approverName: v.approver_name,
      approverEmail: v.approver_email,
      project: { id: project.id, name: project.name, clientName: project.client_name, archivedAt: project.archived_at },
      createdAt: v.created_at,
      archivedAt: v.archived_at || project.archived_at || null,
      myLevel: level,
      trashedVersionCount: db.prepare('SELECT COUNT(*) AS n FROM versions WHERE video_id = ? AND trashed_at IS NOT NULL').get(v.id).n,
      // De versie die klanten via hun link zien (nieuwste gedeelde), los van de interne nieuwste.
      clientVersionId: shared?.id || null,
      versions: versions.map((ver, i) => ({
        ...versionDto(ver),
        isLatest: i === 0,
        isClientVersion: ver.id === shared?.id,
        openComments: openClientComments(ver.id),
        file: versionFileDto(ver),
        events: eventDtos(db, ver.id),
        approval: approvalDto(db, ver.id),
        rounds: roundDtos(db, ver.id),
        commentCount: db.prepare('SELECT COUNT(*) AS n FROM comments WHERE version_id = ?').get(ver.id).n,
      })),
      // Links alleen voor wie mag delen: de URL's geven klanttoegang.
      links: level === 'view' || level === 'upload' ? [] : links.map((l) => ({
        id: l.id,
        role: l.role,
        label: l.label,
        approverName: l.approver_name,
        approverEmail: l.approver_email,
        allowDownload: !!l.allow_download,
        url: linkUrl(req, l.token),
        createdAt: l.created_at,
        revokedAt: l.revoked_at,
        lastUsedAt: l.last_used_at,
      })),
    });
  });

  router.patch('/videos/:id', (req, res) => {
    const body = req.body || {};
    const changesApprover = body.approverName !== undefined || body.approverEmail !== undefined;
    // Titel wijzigen: uploaden. Akkoordgever wijzigen: publiceren/delen.
    const { video: v } = access.video(req, req.params.id, changesApprover ? 'publish' : 'upload', { write: true });
    let title = v.title;
    if (body.title !== undefined) {
      // Alleen de zichtbare titel verandert; bestanden, links en versies niet.
      title = normalizeTitle(body.title);
      if (!title) throw new HttpError(400, 'De titel mag niet leeg zijn');
    }
    const approverName = body.approverName !== undefined ? String(body.approverName).trim().slice(0, 200) : v.approver_name;
    const approverEmail = body.approverEmail !== undefined ? String(body.approverEmail).trim().slice(0, 200) : v.approver_email;
    if (approverEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approverEmail)) throw new HttpError(400, 'Vul een geldig e-mailadres voor de akkoordgever in');
    db.tx(() => {
      db.prepare('UPDATE videos SET title = ?, approver_name = ?, approver_email = ?, updated_at = ? WHERE id = ?')
        .run(title, approverName, approverEmail, now(), v.id);
      if (approverName !== v.approver_name || approverEmail !== v.approver_email) {
        // Andere akkoordgever: oude persoonlijke akkoordlinks verliezen hun geldigheid.
        db.prepare("UPDATE share_links SET revoked_at = ?, revoked_by = ? WHERE video_id = ? AND role = 'approver' AND revoked_at IS NULL")
          .run(now(), req.user.id, v.id);
      }
    });
    res.json({ ok: true, title });
  });

  router.post('/videos/:id/archive', (req, res) => {
    const { video: v } = access.video(req, req.params.id, 'manage');
    const archived = req.body?.archived !== false;
    db.prepare('UPDATE videos SET archived_at = ?, archived_by = ? WHERE id = ?').run(archived ? now() : null, archived ? req.user.id : null, v.id);
    res.json({ ok: true, archived });
  });

  router.delete('/videos/:id', (req, res) => {
    const { video: v } = access.video(req, req.params.id, 'manage');
    db.prepare('UPDATE videos SET trashed_at = ?, trashed_by = ? WHERE id = ?').run(now(), req.user.id, v.id);
    res.json({ ok: true, trashed: true });
  });

  // Eén versie naar de prullenbak (bijv. om ruimte vrij te maken). De video houdt minstens één versie.
  router.delete('/versions/:id', (req, res) => {
    const { version: ver } = access.version(req, req.params.id, 'manage');
    const others = db.prepare('SELECT COUNT(*) AS n FROM versions WHERE video_id = ? AND id != ? AND trashed_at IS NULL').get(ver.video_id, ver.id).n;
    if (!others) throw new HttpError(409, 'Dit is de enige versie van deze video. Zet in plaats daarvan de hele video in de prullenbak.');
    db.prepare('UPDATE versions SET trashed_at = ?, trashed_by = ? WHERE id = ?').run(now(), req.user.id, ver.id);
    res.json({ ok: true, trashed: true });
  });

  // ---------- Statussen ----------

  router.post('/versions/:id/ready', (req, res) => {
    const { version: ver } = access.version(req, req.params.id, 'upload', { write: true });
    if (ver.status !== 'concept') throw new HttpError(409, 'Alleen een concept kan op "Klaar voor review" worden gezet');
    db.tx(() => changeStatus(db, ver.id, 'ready_for_review', { event: 'ready', ...actor(req) }));
    res.json({ ok: true });
  });

  router.post('/versions/:id/share', (req, res) => {
    const { version: ver } = access.version(req, req.params.id, 'publish', { write: true });
    if (ver.status !== 'ready_for_review') throw new HttpError(409, 'Zet de versie eerst op "Klaar voor review"');
    const latest = latestVersion(ver.video_id);
    if (latest.id !== ver.id) throw new HttpError(409, 'Alleen de nieuwste versie kan worden gedeeld');
    let createdLink = null;
    db.tx(() => {
      db.prepare('UPDATE versions SET shared_at = ? WHERE id = ?').run(now(), ver.id);
      changeStatus(db, ver.id, 'in_review', { event: 'shared', ...actor(req) });
      const active = db.prepare("SELECT id FROM share_links WHERE video_id = ? AND role = 'reviewer' AND revoked_at IS NULL").get(ver.video_id);
      if (!active) {
        createdLink = createLink(ver.video_id, { role: 'reviewer', label: 'Reviewlink' }, req.user);
      }
    });
    res.json({ ok: true, createdLink: !!createdLink });
  });

  router.post('/versions/:id/status', (req, res) => {
    const { version: ver } = access.version(req, req.params.id, 'manage', { write: true });
    const status = String(req.body?.status || '');
    if (!STATUSES[status]) throw new HttpError(400, 'Onbekende status');
    if (status === ver.status) throw new HttpError(409, 'De versie heeft deze status al');
    const note = String(req.body?.note || '').trim().slice(0, 500);
    if (!note) throw new HttpError(400, 'Geef een reden voor de handmatige correctie; die wordt in de geschiedenis bewaard.');
    db.tx(() => changeStatus(db, ver.id, status, { event: 'manual', note, ...actor(req) }));
    res.json({ ok: true });
  });

  // ---------- Deel-links ----------

  function createLink(videoId, { role, label, allowDownload }, user) {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
    let approverName = '';
    let approverEmail = '';
    if (role === 'approver') {
      if (!video.approver_name) throw new HttpError(400, 'Wijs eerst een akkoordgever aan voor deze video');
      approverName = video.approver_name;
      approverEmail = video.approver_email;
      // Eén aangewezen akkoordgever per video: er is altijd hooguit één geldige akkoordlink.
      db.prepare("UPDATE share_links SET revoked_at = ?, revoked_by = ? WHERE video_id = ? AND role = 'approver' AND revoked_at IS NULL")
        .run(now(), user.id, videoId);
    }
    const token = auth.randomToken(24);
    const info = db.prepare(`INSERT INTO share_links (video_id, token, role, label, approver_name, approver_email, allow_download, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(videoId, token, role, String(label || '').trim().slice(0, 100), approverName, approverEmail, allowDownload ? 1 : 0, user.id, now());
    return { id: Number(info.lastInsertRowid), token };
  }

  router.post('/videos/:id/links', (req, res) => {
    const { video } = access.video(req, req.params.id, 'publish', { write: true });
    const role = req.body?.role === 'approver' ? 'approver' : 'reviewer';
    const link = db.tx(() => createLink(video.id, { role, label: req.body?.label, allowDownload: !!req.body?.allowDownload }, req.user));
    res.status(201).json({ id: link.id, url: linkUrl(req, link.token) });
  });

  // Intrekken mag ook bij een gearchiveerd project of een video in de prullenbak: dat beperkt alleen toegang.
  router.post('/links/:id/revoke', (req, res) => {
    const link = db.prepare('SELECT * FROM share_links WHERE id = ?').get(intParam(req.params.id));
    if (!link) throw new HttpError(404, 'Link niet gevonden');
    access.video(req, link.video_id, 'publish', { allowTrashed: true });
    if (!link.revoked_at) db.prepare('UPDATE share_links SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(now(), req.user.id, link.id);
    res.json({ ok: true });
  });

  // ---------- Reacties (team) ----------

  router.get('/versions/:id/comments', (req, res) => {
    const { version: ver } = access.version(req, req.params.id, 'view');
    res.json(commentDtos(db, ver.id));
  });

  router.post('/versions/:id/comments', (req, res) => {
    const { version: ver } = access.version(req, req.params.id, 'view', { write: true });
    const body = String(req.body?.body || '').trim();
    if (!body) throw new HttpError(400, 'Een reactie mag niet leeg zijn');
    let parentId = null;
    let timecode = null;
    if (req.body?.parentId) {
      const parent = db.prepare('SELECT id, version_id, parent_id FROM comments WHERE id = ?').get(Number(req.body.parentId));
      if (!parent || parent.version_id !== ver.id) throw new HttpError(400, 'Reactie om op te antwoorden bestaat niet');
      parentId = parent.parent_id || parent.id;
    } else if (req.body?.timecode !== undefined && req.body?.timecode !== null) {
      timecode = Math.max(0, Number(req.body.timecode) || 0);
    }
    const info = db.prepare(`INSERT INTO comments (version_id, parent_id, body, timecode, author_name, author_type, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'team', ?, ?)`).run(ver.id, parentId, body.slice(0, 5000), timecode, req.user.name, req.user.id, now());
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  const getComment = (req) => {
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(intParam(req.params.id));
    if (!c) throw new HttpError(404, 'Reactie niet gevonden');
    access.version(req, c.version_id, 'view', { write: true });
    return c;
  };

  // Afvinken wijzigt nooit de status van een versie.
  router.post('/comments/:id/resolve', (req, res) => {
    const c = getComment(req);
    const resolved = req.body?.resolved !== false;
    db.prepare('UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ?')
      .run(resolved ? now() : null, resolved ? req.user.id : null, c.id);
    res.json({ ok: true });
  });

  router.delete('/comments/:id', (req, res) => {
    const c = getComment(req);
    if (c.user_id !== req.user.id) throw new HttpError(403, 'Je kunt alleen je eigen reacties verwijderen');
    db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
    res.json({ ok: true });
  });

  // ---------- Media ----------

  router.get('/versions/:id/media', async (req, res) => {
    const { version: ver } = access.version(req, req.params.id, 'view');
    await storage.send(res, ver.stored_name, { 'Content-Type': ver.mime_type, 'Cache-Control': MEDIA_CACHE });
  });

  router.get('/versions/:id/poster', async (req, res) => {
    const { version: ver } = access.version(req, req.params.id, 'view');
    if (!ver.has_poster) throw new HttpError(404, 'Geen voorvertoning');
    await storage.send(res, `${ver.stored_name}.jpg`, { 'Cache-Control': MEDIA_CACHE });
  });

  router.get('/versions/:id/download', async (req, res) => {
    const { version: ver, video } = access.version(req, req.params.id, 'view');
    const name = downloadFilename(`${video.title} - v${ver.number}`, ver.extension);
    await storage.send(res, ver.stored_name, { 'Content-Type': ver.mime_type, 'Content-Disposition': contentDisposition(name), 'Cache-Control': MEDIA_CACHE });
  });
}

module.exports = { teamRoutes };
