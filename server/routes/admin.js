'use strict';
const { sideFiles } = require('../versionfiles');
const os = require('node:os');
const { now } = require('../db');
const { HttpError } = require('../status');
const auth = require('../auth');
const { roleOfLevel, intParam } = require('../access');
const { parseExpiry, checkRole } = require('./members');
const { diskFree } = require('../storage');
const { createBackup, listBackups } = require('../backup');
const { versionInfo } = require('../build');
const { reconcileAssignees } = require('./tasks');

function adminRoutes(router, db, config, { access, storage, uploads }) {
  // ---------- Teamleden en rechten ----------

  const userDto = (u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    disabled: !!u.disabled_at,
    createdAt: u.created_at,
    projects: db.prepare(`SELECT pm.project_id AS projectId, pm.level, pm.expires_at AS expiresAt, p.name FROM project_members pm
      JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = ? ORDER BY p.name`).all(u.id)
      .map((m) => ({ ...m, role: u.role === 'freelancer' ? 'freelancer' : roleOfLevel(m.level), expired: !!m.expiresAt && m.expiresAt <= new Date().toISOString() })),
  });
  const accountRole = (value, fallback) => (['admin', 'member', 'freelancer'].includes(value) ? value : fallback);
  const activeAdmins = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL").get().n;
  const getUser = (id) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(intParam(id));
    if (!u) throw new HttpError(404, 'Teamlid niet gevonden');
    return u;
  };

  /**
   * Alle projectkoppelingen van één persoon in één keer (Team & rechten). Per project een rol
   * (producer, editor, meekijker, freelancer) en optioneel een einddatum. Bestaande einddatums
   * blijven staan als de lijst er geen noemt.
   */
  function setMemberships(userId, list) {
    if (!Array.isArray(list)) throw new HttpError(400, 'Ongeldige lijst met projecten');
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    const old = new Map(db.prepare('SELECT * FROM project_members WHERE user_id = ?').all(userId).map((m) => [m.project_id, m]));
    db.prepare('DELETE FROM project_members WHERE user_id = ?').run(userId);
    if (u.role === 'admin') return; // beheerders hebben overal toegang
    for (const item of list) {
      const role = item?.role || (item?.level ? roleOfLevel(item.level) : null);
      if (!role) continue;
      const level = checkRole(role, u.role);
      const p = db.prepare('SELECT id FROM projects WHERE id = ?').get(intParam(item.projectId));
      if (!p) throw new HttpError(400, 'Onbekend project in de lijst');
      const prev = old.get(p.id);
      const expiresAt = item.expiresAt !== undefined ? parseExpiry(item.expiresAt, { allowPast: !!prev && item.expiresAt === prev.expires_at }) : (prev?.expires_at || null);
      db.prepare('INSERT INTO project_members (project_id, user_id, level, created_at, expires_at, added_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(p.id, userId, level, prev?.created_at || now(), expiresAt, prev?.added_by ?? null, now());
      // Freelancers volgen hun project automatisch (meldingen over verstuurde klantfeedback).
      if (u.role === 'freelancer') db.prepare("INSERT OR IGNORE INTO follows (user_id, kind, target_id, state, auto, created_at) VALUES (?, 'project', ?, 'on', 1, ?)").run(userId, p.id, now());
    }
  }

  /** Accountrol wijzigen: koppelingen gaan mee, zonder dat iemand er rechten bij krijgt. */
  function applyAccountRole(userId, from, to) {
    if (from === to) return;
    if (to === 'freelancer') db.prepare("UPDATE project_members SET level = 'feedback', updated_at = ? WHERE user_id = ?").run(now(), userId);
    // Van freelancer naar teamlid: begint als Meekijker (alleen kijken); daarna bewust uitbreiden.
    if (from === 'freelancer' && to === 'member') db.prepare("UPDATE project_members SET level = 'read', updated_at = ? WHERE user_id = ?").run(now(), userId);
  }

  router.get('/users', (req, res) => {
    const rows = req.user.isAdmin
      ? db.prepare('SELECT * FROM users ORDER BY disabled_at IS NOT NULL, name').all()
      : db.prepare('SELECT * FROM users WHERE id = ?').all(req.user.id);
    res.json(rows.map(userDto));
  });

  router.post('/users', (req, res) => {
    access.requireAdmin(req);
    const role = accountRole(req.body?.role, 'member');
    const id = db.tx(() => {
      const userId = auth.createUser(db, { ...(req.body || {}), role });
      if (req.body?.projects) setMemberships(userId, req.body.projects);
      return userId;
    });
    res.status(201).json({ id });
  });

  router.patch('/users/:id', (req, res) => {
    access.requireAdmin(req);
    const u = getUser(req.params.id);
    const body = req.body || {};
    const role = body.role !== undefined ? accountRole(body.role, u.role) : u.role;
    const disabled = body.disabled !== undefined ? !!body.disabled : !!u.disabled_at;
    const name = body.name !== undefined ? String(body.name).trim().slice(0, 200) : u.name;
    if (!name) throw new HttpError(400, 'Vul een naam in');
    // Er moet altijd minstens één actieve beheerder overblijven.
    const losesAdmin = u.role === 'admin' && !u.disabled_at && (role !== 'admin' || disabled);
    if (losesAdmin && activeAdmins() <= 1) {
      throw new HttpError(409, 'Dit is de laatste actieve beheerder. Maak eerst iemand anders beheerder.');
    }
    db.tx(() => {
      db.prepare('UPDATE users SET name = ?, role = ?, disabled_at = ? WHERE id = ?').run(name, role, disabled ? (u.disabled_at || now()) : null, u.id);
      applyAccountRole(u.id, u.role, role);
      if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      reconcileAssignees(db, access);
    });
    res.json({ ok: true });
  });

  router.post('/users/:id/password', (req, res) => {
    const u = getUser(req.params.id);
    if (u.id !== req.user.id) access.requireAdmin(req);
    auth.setPassword(db, u.id, String(req.body?.password || ''));
    res.json({ ok: true });
  });

  router.put('/users/:id/projects', (req, res) => {
    access.requireAdmin(req);
    const u = getUser(req.params.id);
    db.tx(() => { setMemberships(u.id, req.body?.projects || []); reconcileAssignees(db, access); });
    res.json({ ok: true });
  });

  // ---------- Prullenbak ----------

  /** Alle bestanden (video + thumbnail, en bijlagen) binnen een item, met werkelijke grootte. */
  async function filesOf(type, id) {
    if (type === 'briefing') {
      const b = db.prepare("SELECT * FROM briefing_items WHERE id = ? AND kind = 'file'").get(id);
      return b ? [{ key: b.file_key, label: b.title, kind: 'bijlage', originalFilename: b.file_name, bytes: await storage.size(b.file_key) }] : [];
    }
    const sql = {
      project: 'SELECT ver.*, v.title FROM versions ver JOIN videos v ON v.id = ver.video_id WHERE v.project_id = ?',
      video: 'SELECT ver.*, v.title FROM versions ver JOIN videos v ON v.id = ver.video_id WHERE v.id = ?',
      version: 'SELECT ver.*, v.title FROM versions ver JOIN videos v ON v.id = ver.video_id WHERE ver.id = ?',
    }[type];
    const files = [];
    for (const ver of db.prepare(sql).all(id)) {
      const label = `${ver.title} · versie ${ver.number}`;
      files.push({ key: ver.stored_name, label, kind: 'video', originalFilename: ver.original_filename, bytes: await storage.size(ver.stored_name) });
      for (const f of sideFiles(db, ver)) {
        const bytes = await storage.size(f.key);
        if (bytes !== null || !f.optional) files.push({ key: f.key, label, kind: f.kind, bytes });
      }
    }
    if (type === 'project') {
      for (const b of db.prepare("SELECT * FROM briefing_items WHERE project_id = ? AND kind = 'file'").all(id)) {
        files.push({ key: b.file_key, label: b.title, kind: 'bijlage', originalFilename: b.file_name, bytes: await storage.size(b.file_key) });
      }
      // Eigen frame als projectcover (indien gekozen).
      const cover = db.prepare('SELECT cover_key FROM projects WHERE id = ?').get(id)?.cover_key;
      if (cover) files.push({ key: cover, label: 'Projectcover', kind: 'cover', bytes: await storage.size(cover), optional: true });
    }
    return files;
  }
  const sumBytes = (files) => files.reduce((n, f) => n + (f.bytes || 0), 0);

  const TABLES = { project: 'projects', video: 'videos', version: 'versions', briefing: 'briefing_items' };

  /** Zoekt een item in de prullenbak en controleert of de gebruiker het mag beheren. */
  function trashItem(req, type, id) {
    if (type === 'project') {
      const { project } = access.project(req, id, 'manage', { allowTrashed: true });
      if (!project.trashed_at) throw new HttpError(409, 'Dit project staat niet in de prullenbak.');
      return { row: project, projectId: project.id };
    }
    if (type === 'video') {
      const { video, project } = access.video(req, id, 'manage', { allowTrashed: true });
      if (!video.trashed_at) throw new HttpError(409, 'Deze video staat niet in de prullenbak.');
      return { row: video, projectId: project.id, parentTrashed: !!project.trashed_at };
    }
    if (type === 'version') {
      const { version, video, project } = access.version(req, id, 'manage', { allowTrashed: true });
      if (!version.trashed_at) throw new HttpError(409, 'Deze versie staat niet in de prullenbak.');
      return { row: version, projectId: project.id, parentTrashed: !!(video.trashed_at || project.trashed_at) };
    }
    if (type === 'briefing') {
      const item = db.prepare('SELECT * FROM briefing_items WHERE id = ?').get(intParam(id));
      if (!item) throw new HttpError(404, 'Onderdeel niet gevonden');
      const { project } = access.project(req, item.project_id, 'manage', { allowTrashed: true });
      if (!item.trashed_at) throw new HttpError(409, 'Dit onderdeel staat niet in de prullenbak.');
      return { row: item, projectId: project.id, parentTrashed: !!project.trashed_at };
    }
    throw new HttpError(400, 'Onbekend type');
  }

  router.get('/trash', async (req, res) => {
    const allowed = access.projectIdsFor(req.user);
    const mayManage = (projectId) => !allowed || allowed.get(projectId) === 'manage';
    const name = (id) => (id ? db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || 'onbekend' : 'onbekend');
    const items = [];
    for (const p of db.prepare('SELECT * FROM projects WHERE trashed_at IS NOT NULL').all()) {
      if (!mayManage(p.id)) continue;
      const files = await filesOf('project', p.id);
      items.push({ type: 'project', id: p.id, title: p.name, context: p.client_name, trashedAt: p.trashed_at, trashedBy: name(p.trashed_by), bytes: sumBytes(files), fileCount: files.length,
        detail: `${db.prepare('SELECT COUNT(*) AS n FROM videos WHERE project_id = ?').get(p.id).n} video('s)` });
    }
    for (const v of db.prepare('SELECT v.*, p.name AS project_name FROM videos v JOIN projects p ON p.id = v.project_id WHERE v.trashed_at IS NOT NULL AND p.trashed_at IS NULL').all()) {
      if (!mayManage(v.project_id)) continue;
      const files = await filesOf('video', v.id);
      items.push({ type: 'video', id: v.id, title: v.title, context: v.project_name, trashedAt: v.trashed_at, trashedBy: name(v.trashed_by), bytes: sumBytes(files), fileCount: files.length,
        detail: `${db.prepare('SELECT COUNT(*) AS n FROM versions WHERE video_id = ?').get(v.id).n} versie(s)` });
    }
    for (const ver of db.prepare(`SELECT ver.*, v.title, v.project_id, p.name AS project_name FROM versions ver JOIN videos v ON v.id = ver.video_id JOIN projects p ON p.id = v.project_id
      WHERE ver.trashed_at IS NOT NULL AND v.trashed_at IS NULL AND p.trashed_at IS NULL`).all()) {
      if (!mayManage(ver.project_id)) continue;
      const files = await filesOf('version', ver.id);
      items.push({ type: 'version', id: ver.id, title: `${ver.title} · versie ${ver.number}`, context: ver.project_name, trashedAt: ver.trashed_at, trashedBy: name(ver.trashed_by), bytes: sumBytes(files), fileCount: files.length, detail: ver.original_filename });
    }
    for (const b of db.prepare(`SELECT b.*, p.name AS project_name FROM briefing_items b JOIN projects p ON p.id = b.project_id
      WHERE b.trashed_at IS NOT NULL AND p.trashed_at IS NULL`).all()) {
      if (!mayManage(b.project_id)) continue;
      const files = await filesOf('briefing', b.id);
      items.push({ type: 'briefing', id: b.id, title: b.title, context: b.project_name, trashedAt: b.trashed_at, trashedBy: name(b.trashed_by), bytes: sumBytes(files), fileCount: files.length,
        detail: { text: 'Briefingtekst', link: 'Referentielink', file: `Bijlage · ${b.file_name}` }[b.kind] });
    }
    items.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
    res.json({ items, totalBytes: sumBytes(items), canPurge: req.user.isAdmin, autoPurge: false });
  });

  // Terugzetten brengt gegevens en relaties terug. Ingetrokken links blijven ingetrokken:
  // de prullenbak verandert niets aan links, alleen aan de bereikbaarheid.
  router.post('/trash/restore', (req, res) => {
    const { type, id } = req.body || {};
    const item = trashItem(req, type, id);
    if (item.parentTrashed) throw new HttpError(409, 'Het bovenliggende project of de video staat ook in de prullenbak. Zet dat eerst terug.');
    const table = TABLES[type];
    db.prepare(`UPDATE ${table} SET trashed_at = NULL, trashed_by = NULL WHERE id = ?`).run(item.row.id);
    res.json({ ok: true });
  });

  // Vooraf laten zien wat er definitief verdwijnt en hoeveel ruimte dat vrijmaakt.
  router.get('/trash/:type/:id/purge-preview', async (req, res) => {
    access.requireAdmin(req);
    const { type } = req.params;
    const id = intParam(req.params.id);
    trashItem(req, type, id);
    const files = await filesOf(type, id);
    const deliveries = deliveriesFor(type, id);
    // Bestanden die (actief) zijn opgeleverd, apart markeren in het overzicht.
    const delivered = new Set(deliveries.filter((d) => d.active).map((d) => d.storedName));
    for (const f of files) if (delivered.has(f.key)) f.inDelivery = true;
    res.json({ type, id, files, fileCount: files.length, totalBytes: sumBytes(files), ...relatedCounts(type, id),
      deliveries: deliveries.map(({ storedName, ...d }) => d) });
  });

  /** Opleveringen (actief en eerder) die bij definitief verwijderen mee verdwijnen. */
  function deliveriesFor(type, id) {
    if (type === 'briefing') return [];
    const where = { project: 'd.project_id = ?', video: 'd.video_id = ?', version: 'd.version_id = ?' }[type];
    return db.prepare(`SELECT d.*, v.title, ver.number, ver.stored_name FROM deliveries d JOIN videos v ON v.id = d.video_id JOIN versions ver ON ver.id = d.version_id
      WHERE ${where} ORDER BY d.released_at DESC`).all(id).map((d) => ({
      title: d.title, versionNumber: d.number, releasedAt: d.released_at, active: !d.withdrawn_at, storedName: d.stored_name,
    }));
  }

  function relatedCounts(type, id) {
    if (type === 'briefing') return { versions: 0, comments: 0, links: 0, briefing: 1 };
    const where = { project: 'v.project_id = ?', video: 'v.id = ?', version: 'ver.id = ?' }[type];
    const base = `FROM versions ver JOIN videos v ON v.id = ver.video_id WHERE ${where}`;
    return {
      versions: db.prepare(`SELECT COUNT(*) AS n ${base}`).get(id).n,
      comments: db.prepare(`SELECT COUNT(*) AS n FROM comments WHERE version_id IN (SELECT ver.id ${base})`).get(id).n,
      links: type === 'version' ? 0 : db.prepare(`SELECT COUNT(*) AS n FROM share_links WHERE video_id IN (SELECT v.id FROM videos v WHERE ${where.replace('ver.id', 'v.id')})`).get(id).n,
      briefing: type === 'project' ? db.prepare('SELECT COUNT(*) AS n FROM briefing_items WHERE project_id = ?').get(id).n : 0,
    };
  }

  // Definitief verwijderen: alleen beheerder, alleen vanuit de prullenbak, met bevestiging van het voorbeeld.
  router.post('/trash/:type/:id/purge', async (req, res) => {
    access.requireAdmin(req);
    const { type } = req.params;
    const id = intParam(req.params.id);
    trashItem(req, type, id);
    const files = await filesOf(type, id);
    if (req.body?.confirm !== true || Number(req.body?.expectedFiles) !== files.length) {
      throw new HttpError(409, 'Bevestig het definitief verwijderen na het bekijken van het overzicht. De inhoud is intussen gewijzigd; open het overzicht opnieuw.');
    }
    const table = TABLES[type];
    db.tx(() => {
      if (type === 'project') db.prepare('DELETE FROM uploads WHERE project_id = ?').run(id);
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    });
    const failed = [];
    for (const f of files) {
      try { await storage.remove(f.key); } catch { failed.push(f.key); }
    }
    res.json({ ok: true, freedBytes: sumBytes(files), removedFiles: files.length - failed.length, failedFiles: failed });
  });

  // ---------- Opslag ----------

  router.get('/storage', async (req, res) => {
    access.requireAdmin(req);
    const st = storage.status();
    const rows = db.prepare(`SELECT ver.id, ver.video_id, ver.number, ver.stored_name, ver.has_poster, ver.custom_poster, ver.trashed_at AS ver_trashed,
        v.project_id, v.trashed_at AS video_trashed, v.archived_at AS video_archived,
        p.name AS project_name, p.trashed_at AS project_trashed, p.archived_at AS project_archived
      FROM versions ver JOIN videos v ON v.id = ver.video_id JOIN projects p ON p.id = v.project_id`).all();
    const latest = new Map(db.prepare('SELECT video_id, MAX(number) AS n FROM versions WHERE trashed_at IS NULL GROUP BY video_id').all().map((r) => [r.video_id, r.n]));
    const projects = new Map();
    const totals = { active: 0, oldVersions: 0, archived: 0, trash: 0, attachments: 0, brands: 0 };
    let missingFiles = 0;
    // Afspeelversies (kwaliteiten) apart, zodat zichtbaar is wat ze kosten (ook in de categorieën meegeteld).
    let variantBytes = 0;
    for (const r of rows) {
      let bytes = 0;
      if (st.ok) {
        const vSize = await storage.size(r.stored_name);
        if (vSize === null) missingFiles++;
        bytes += vSize || 0;
        for (const f of sideFiles(db, r)) {
          const n = (await storage.size(f.key)) || 0;
          bytes += n;
          if (f.kind === 'variant') variantBytes += n;
        }
      }
      const category = (r.ver_trashed || r.video_trashed || r.project_trashed) ? 'trash'
        : (r.video_archived || r.project_archived) ? 'archived'
          : latest.get(r.video_id) === r.number ? 'active' : 'oldVersions';
      totals[category] += bytes;
      if (!projects.has(r.project_id)) {
        projects.set(r.project_id, { id: r.project_id, name: r.project_name, archived: !!r.project_archived, trashed: !!r.project_trashed, active: 0, oldVersions: 0, archived_: 0, trash: 0, attachments: 0, total: 0, versions: 0 });
      }
      const p = projects.get(r.project_id);
      p[category === 'archived' ? 'archived_' : category] += bytes;
      p.total += bytes;
      p.versions++;
    }
    for (const p of db.prepare('SELECT id, name, archived_at, trashed_at FROM projects').all()) {
      if (!projects.has(p.id)) projects.set(p.id, { id: p.id, name: p.name, archived: !!p.archived_at, trashed: !!p.trashed_at, active: 0, oldVersions: 0, archived_: 0, trash: 0, attachments: 0, total: 0, versions: 0 });
    }
    // Bijlagen (briefing en referenties) per project.
    for (const b of db.prepare(`SELECT b.file_key, b.trashed_at, b.project_id, p.trashed_at AS project_trashed, p.archived_at AS project_archived
      FROM briefing_items b JOIN projects p ON p.id = b.project_id WHERE b.kind = 'file'`).all()) {
      const bytes = st.ok ? (await storage.size(b.file_key)) || 0 : 0;
      const category = b.trashed_at || b.project_trashed ? 'trash' : b.project_archived ? 'archived' : 'attachments';
      totals[category] += bytes;
      const pr = projects.get(b.project_id);
      if (pr) {
        pr[category === 'archived' ? 'archived_' : category] += bytes;
        pr.total += bytes;
      }
    }
    let brandBytes = 0;
    for (const b of db.prepare('SELECT logo_key FROM brands WHERE logo_key IS NOT NULL').all()) brandBytes += st.ok ? (await storage.size(b.logo_key)) || 0 : 0;
    totals.brands = brandBytes;
    const tmp = await uploads.tmpUsage();
    const media = st.ok ? await storage.usage() : null;
    const disk = st.ok ? await storage.freeBytes() : null;
    const dataDisk = await diskFree(config.dataDir).catch(() => null);
    const backupDisk = await diskFree(config.backupDir).catch(() => null);
    res.json({
      storage: { ...st, configured: config.mediaConfigured },
      reserveBytes: config.minFreeBytes,
      disk,
      totals: { ...totals, tmp: tmp.bytes, variants: variantBytes, all: totals.active + totals.oldVersions + totals.archived + totals.trash + totals.attachments + totals.brands + tmp.bytes },
      mediaDirBytes: media?.bytes ?? null,
      missingFiles,
      tmp,
      projects: [...projects.values()].map(({ archived_, ...p }) => ({ ...p, archivedBytes: archived_ })).sort((a, b) => b.total - a.total),
      locations: {
        data: { path: config.dataDir, source: config.dataSource, free: dataDisk?.free ?? null },
        media: { path: config.mediaDir, configured: config.mediaConfigured, free: disk?.free ?? null },
        backups: { path: config.backupDir, free: backupDisk?.free ?? null, problem: config.backupDirInsideData ? 'De back-upmap ligt binnen de gegevensmap; kies een andere map met BACKUP_DIR.' : null },
        uploadsTmp: { path: config.uploadTmpDir },
      },
    });
  });

  // ---------- Back-ups ----------

  let job = null;
  router.get('/backups', async (req, res) => {
    access.requireAdmin(req);
    res.json({ dir: config.backupDir, problem: config.backupDirInsideData ? 'De back-upmap ligt binnen de gegevensmap.' : null, job, backups: await listBackups(config.backupDir) });
  });

  router.post('/backups', (req, res) => {
    access.requireAdmin(req);
    if (job?.state === 'bezig') throw new HttpError(409, 'Er wordt al een back-up gemaakt.');
    job = { state: 'bezig', startedAt: now(), startedBy: req.user.name, phase: 'start', done: 0, total: 0, bytes: 0 };
    createBackup({ db, config, storage, label: String(req.body?.label || ''), onProgress: (p) => Object.assign(job, p) })
      .then((r) => { job = { ...job, state: 'klaar', finishedAt: now(), name: r.name, complete: r.manifest.complete }; })
      .catch((err) => { job = { ...job, state: 'mislukt', finishedAt: now(), error: err.message }; });
    res.status(202).json({ ok: true, job });
  });

  // ---------- Systeem ----------

  // Melding na het terugzetten van een back-up wegklikken (alleen beheerder).
  // Melding na de update naar bouwronde 6: wiens rechten zijn omgezet (nooit uitgebreid).
  router.get('/system/roles-notice', (req, res) => {
    access.requireAdmin(req);
    let notice = null;
    try { notice = JSON.parse(db.prepare("SELECT value FROM app_meta WHERE key = 'roles-v6-notice'").get()?.value || 'null'); } catch { notice = null; }
    res.json({ notice });
  });
  router.post('/system/roles-notice/dismiss', (req, res) => {
    access.requireAdmin(req);
    db.prepare("DELETE FROM app_meta WHERE key = 'roles-v6-notice'").run();
    res.json({ ok: true });
  });

  router.post('/system/restore-notice/dismiss', (req, res) => {
    access.requireAdmin(req);
    db.prepare("DELETE FROM app_meta WHERE key = 'restore-notice'").run();
    res.json({ ok: true });
  });

  router.get('/system', (req, res) => {
    access.requireAdmin(req);
    res.json({
      ...versionInfo(),
      node: process.versions.node,
      platform: `${os.type()} ${os.release()}`,
      appDir: config.appDir,
      root: config.root,
      settingsFile: config.settingsFile,
      dataDir: config.dataDir,
      dataSource: config.dataSource,
      legacyDataDir: config.legacyDataDir,
      mediaDir: config.mediaDir,
      backupDir: config.backupDir,
      port: config.port,
    });
  });
}

module.exports = { adminRoutes };
