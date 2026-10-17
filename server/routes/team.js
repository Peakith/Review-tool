'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { now } = require('../db');
const { STATUSES, HttpError, changeStatus } = require('../status');
const auth = require('../auth');
const { normalizeTitle, titleFromFilename, downloadFilename, contentDisposition } = require('../media');
const { versionDto, versionFileDto, commentDtos, eventDtos, approvalDto, roundDtos } = require('../views');

function teamRoutes(router, db, config, { finalize }) {
  const actor = (req) => ({ actorType: 'team', actorLabel: req.user.name, userId: req.user.id });

  const intParam = (value) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, 'Niet gevonden');
    return n;
  };
  const getProject = (id) => {
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(intParam(id));
    if (!p) throw new HttpError(404, 'Project niet gevonden');
    return p;
  };
  const getVideo = (id) => {
    const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(intParam(id));
    if (!v) throw new HttpError(404, 'Video niet gevonden');
    return v;
  };
  const getVersion = (id) => {
    const v = db.prepare('SELECT * FROM versions WHERE id = ?').get(intParam(id));
    if (!v) throw new HttpError(404, 'Versie niet gevonden');
    return v;
  };
  const latestVersion = (videoId) => db.prepare('SELECT * FROM versions WHERE video_id = ? ORDER BY number DESC LIMIT 1').get(videoId);

  const linkUrl = (req, token) => `${config.publicUrl || `${req.protocol}://${req.get('host')}`}/r/${token}`;

  const latestShared = (videoId) =>
    db.prepare('SELECT * FROM versions WHERE video_id = ? AND shared_at IS NOT NULL ORDER BY number DESC LIMIT 1').get(videoId);
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
    const poster = db.prepare('SELECT id FROM versions WHERE video_id = ? AND has_poster = 1 ORDER BY number DESC LIMIT 1').get(v.id);
    return {
      id: v.id,
      title: v.title,
      approverName: v.approver_name,
      updatedAt: v.updated_at,
      lastActivityAt: videoActivity(v),
      versionCount: latest?.number || 0,
      latestVersion: latest ? versionDto(latest) : null,
      sharedVersion: shared ? versionDto(shared) : null,
      latestSharedNumber: shared?.number || null,
      posterVersionId: poster?.id || null,
      openComments: shared ? openClientComments(shared.id) : 0,
    };
  }

  // ---------- Team & accounts ----------

  router.get('/users', (req, res) => {
    res.json(db.prepare('SELECT id, email, name, created_at AS createdAt FROM users ORDER BY name').all());
  });

  router.post('/users', (req, res) => {
    const id = auth.createUser(db, req.body || {});
    res.status(201).json({ id });
  });

  // ---------- Projecten ----------

  router.get('/projects', (req, res) => {
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    const result = projects.map((p) => {
      const videos = db.prepare('SELECT * FROM videos WHERE project_id = ?').all(p.id).map(videoSummary);
      const statusCounts = Object.fromEntries(Object.keys(STATUSES).map((st) => [st, 0]));
      for (const v of videos) if (v.latestVersion) statusCounts[v.latestVersion.status] += 1;
      videos.sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)));
      const lastActivityAt = [p.created_at, ...videos.map((v) => v.lastActivityAt)].filter(Boolean).sort().at(-1);
      return {
        id: p.id,
        name: p.name,
        clientName: p.client_name,
        createdAt: p.created_at,
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
    const name = normalizeTitle(req.body?.name);
    if (!name) throw new HttpError(400, 'Geef het project een naam');
    const clientName = String(req.body?.clientName || '').trim().slice(0, 200);
    const info = db.prepare('INSERT INTO projects (name, client_name, created_by, created_at) VALUES (?, ?, ?, ?)')
      .run(name, clientName, req.user.id, now());
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  router.patch('/projects/:id', (req, res) => {
    const p = getProject(req.params.id);
    const name = req.body?.name !== undefined ? normalizeTitle(req.body.name) : p.name;
    if (!name) throw new HttpError(400, 'Geef het project een naam');
    const clientName = req.body?.clientName !== undefined ? String(req.body.clientName).trim().slice(0, 200) : p.client_name;
    db.prepare('UPDATE projects SET name = ?, client_name = ? WHERE id = ?').run(name, clientName, p.id);
    res.json({ ok: true });
  });

  router.get('/projects/:id', (req, res) => {
    const p = getProject(req.params.id);
    const videos = db.prepare('SELECT * FROM videos WHERE project_id = ? ORDER BY created_at DESC').all(p.id);
    res.json({
      id: p.id,
      name: p.name,
      clientName: p.client_name,
      createdAt: p.created_at,
      videos: videos.map(videoSummary),
    });
  });

  router.delete('/projects/:id', (req, res) => {
    const p = getProject(req.params.id);
    const files = db.prepare('SELECT ver.stored_name FROM versions ver JOIN videos v ON v.id = ver.video_id WHERE v.project_id = ?').all(p.id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
    for (const f of files) {
      fs.rm(path.join(config.mediaDir, f.stored_name), { force: true }, () => {});
      fs.rm(path.join(config.mediaDir, `${f.stored_name}.jpg`), { force: true }, () => {});
    }
    res.json({ ok: true });
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
    const p = getProject(req.params.id);
    const file = await finalize(req.body?.uploadId, req.user);
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
    const video = getVideo(req.params.id);
    const file = await finalize(req.body?.uploadId, req.user);
    // Nieuwe versie: titel, deel-links en akkoordgever blijven bij de video.
    const result = db.tx(() => insertVersion(video.id, file, req.user));
    res.status(201).json(result);
  });

  router.get('/videos/:id', (req, res) => {
    const v = getVideo(req.params.id);
    const project = db.prepare('SELECT id, name, client_name FROM projects WHERE id = ?').get(v.project_id);
    const versions = db.prepare('SELECT * FROM versions WHERE video_id = ? ORDER BY number DESC').all(v.id);
    const links = db.prepare('SELECT * FROM share_links WHERE video_id = ? ORDER BY created_at DESC').all(v.id);
    const shared = latestShared(v.id);
    res.json({
      id: v.id,
      title: v.title,
      approverName: v.approver_name,
      approverEmail: v.approver_email,
      project: { id: project.id, name: project.name, clientName: project.client_name },
      createdAt: v.created_at,
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
      links: links.map((l) => ({
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
    const v = getVideo(req.params.id);
    const body = req.body || {};
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

  router.delete('/videos/:id', (req, res) => {
    const v = getVideo(req.params.id);
    const files = db.prepare('SELECT stored_name FROM versions WHERE video_id = ?').all(v.id);
    db.prepare('DELETE FROM videos WHERE id = ?').run(v.id);
    for (const f of files) {
      fs.rm(path.join(config.mediaDir, f.stored_name), { force: true }, () => {});
      fs.rm(path.join(config.mediaDir, `${f.stored_name}.jpg`), { force: true }, () => {});
    }
    res.json({ ok: true });
  });

  // ---------- Statussen ----------

  router.post('/versions/:id/ready', (req, res) => {
    const ver = getVersion(req.params.id);
    if (ver.status !== 'concept') throw new HttpError(409, 'Alleen een concept kan op "Klaar voor review" worden gezet');
    db.tx(() => changeStatus(db, ver.id, 'ready_for_review', { event: 'ready', ...actor(req) }));
    res.json({ ok: true });
  });

  router.post('/versions/:id/share', (req, res) => {
    const ver = getVersion(req.params.id);
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
    const ver = getVersion(req.params.id);
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
    const video = getVideo(videoId);
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
    const video = getVideo(req.params.id);
    const role = req.body?.role === 'approver' ? 'approver' : 'reviewer';
    const link = db.tx(() => createLink(video.id, { role, label: req.body?.label, allowDownload: !!req.body?.allowDownload }, req.user));
    res.status(201).json({ id: link.id, url: linkUrl(req, link.token) });
  });

  router.post('/links/:id/revoke', (req, res) => {
    const link = db.prepare('SELECT * FROM share_links WHERE id = ?').get(intParam(req.params.id));
    if (!link) throw new HttpError(404, 'Link niet gevonden');
    if (!link.revoked_at) db.prepare('UPDATE share_links SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(now(), req.user.id, link.id);
    res.json({ ok: true });
  });

  // ---------- Reacties (team) ----------

  router.get('/versions/:id/comments', (req, res) => {
    const ver = getVersion(req.params.id);
    res.json(commentDtos(db, ver.id));
  });

  router.post('/versions/:id/comments', (req, res) => {
    const ver = getVersion(req.params.id);
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

  // Afvinken wijzigt nooit de status van een versie.
  router.post('/comments/:id/resolve', (req, res) => {
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(intParam(req.params.id));
    if (!c) throw new HttpError(404, 'Reactie niet gevonden');
    const resolved = req.body?.resolved !== false;
    db.prepare('UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ?')
      .run(resolved ? now() : null, resolved ? req.user.id : null, c.id);
    res.json({ ok: true });
  });

  router.delete('/comments/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(intParam(req.params.id));
    if (!c) throw new HttpError(404, 'Reactie niet gevonden');
    if (c.user_id !== req.user.id) throw new HttpError(403, 'Je kunt alleen je eigen reacties verwijderen');
    db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
    res.json({ ok: true });
  });

  // ---------- Media ----------

  router.get('/versions/:id/media', (req, res) => {
    const ver = getVersion(req.params.id);
    res.sendFile(path.join(config.mediaDir, ver.stored_name), { headers: { 'Content-Type': ver.mime_type, 'Cache-Control': 'private, max-age=3600' } });
  });

  router.get('/versions/:id/poster', (req, res) => {
    const ver = getVersion(req.params.id);
    if (!ver.has_poster) throw new HttpError(404, 'Geen voorvertoning');
    res.sendFile(path.join(config.mediaDir, `${ver.stored_name}.jpg`), { headers: { 'Cache-Control': 'private, max-age=86400' } });
  });

  router.get('/versions/:id/download', (req, res) => {
    const ver = getVersion(req.params.id);
    const video = getVideo(ver.video_id);
    const name = downloadFilename(`${video.title} - v${ver.number}`, ver.extension);
    res.sendFile(path.join(config.mediaDir, ver.stored_name), {
      headers: { 'Content-Type': ver.mime_type, 'Content-Disposition': contentDisposition(name) },
    });
  });
}

module.exports = { teamRoutes };
