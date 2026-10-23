'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeVideo, startServer, client, upload, rid, setupAdmin, addMember, sharedVideo } = require('./helpers');
const { listBackups, verifyBackup, restoreBackup, createBackup } = require('../server/backup');
const { createApp } = require('../server/app');
const { migrate } = require('../scripts/migrate-data');
const { resolveDataDir, loadConfig, isInside } = require('../server/config');

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const key = { 'x-reviewer-key': 'backup-key-000000001' };

/** Vult een server met account, freelancer, project, twee versies, reacties, feedback, links en goedkeuring. */
async function fill(srv) {
  const admin = await setupAdmin(srv);
  const file = makeVideo(srv.dataDir, 'clip.mp4');
  const s = await sharedVideo(admin, file, { name: 'Back-upproject', title: 'Campagnefilm — Hoofdvideo' });
  await addMember(srv, admin, { email: 'freelance@agency.nl', projects: [{ projectId: s.projectId, level: 'upload' }] });
  const guest = client(srv.base);
  await guest.post(`/api/review/${s.token}/versions/${s.versionId}/comments`, { body: 'Logo groter', timecode: 1, authorName: 'Eva', requestId: rid() }, key);
  await guest.post(`/api/review/${s.token}/versions/${s.versionId}/feedback`, { authorName: 'Eva', requestId: rid() }, key);
  const v2 = (await admin.post(`/api/videos/${s.videoId}/versions`, { uploadId: await upload(admin, file, { videoId: s.videoId }) })).data;
  await admin.post(`/api/versions/${v2.versionId}/comments`, { body: 'Interne notitie', timecode: 0.5 });
  return { admin, ...s, v2 };
}

async function waitForJob(admin) {
  for (let i = 0; i < 100; i++) {
    const r = (await admin.get('/api/backups')).data;
    if (r.job && r.job.state !== 'bezig') return r;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('back-up duurde te lang');
}

test('back-up tijdens gebruik, controleren en terugzetten met account, project, versie, reacties en reviewlink', async () => {
  const srv = await startServer();
  let restoredSrv;
  try {
    const d = await fill(srv);
    const mediaV1 = path.join(srv.config.mediaDir, srv.db.prepare('SELECT stored_name FROM versions WHERE id = ?').get(d.versionId).stored_name);
    const originalHash = sha(mediaV1);

    // Back-up via de app (draait gewoon door)
    assert.equal((await d.admin.post('/api/backups', { label: 'test' })).status, 202);
    const status = await waitForJob(d.admin);
    assert.equal(status.job.state, 'klaar', status.job.error);
    const [b] = status.backups;
    assert.equal(b.status, 'volledig');
    assert.ok(!isInside(b.dir, srv.config.dataDir), 'back-up staat buiten de gegevensmap');
    assert.deepEqual({ users: b.counts.users, projects: b.counts.projects, versions: b.counts.versions, comments: b.counts.comments }, { users: 2, projects: 1, versions: 2, comments: 2 });
    assert.equal(b.fileCount, 4, '2 video\'s + 2 thumbnails');
    const check = await verifyBackup(b.dir, { deep: true });
    assert.ok(check.ok, check.problems.join('; '));
    const manifest = JSON.parse(fs.readFileSync(path.join(b.dir, 'manifest.json'), 'utf8'));
    assert.ok(manifest.createdAt && manifest.appVersion && manifest.complete === true);

    // Daarna "ongeluk": video definitief weg
    await d.admin.del(`/api/videos/${d.videoId}`);
    const files = (await d.admin.get(`/api/trash/video/${d.videoId}/purge-preview`)).data.fileCount;
    await d.admin.post(`/api/trash/video/${d.videoId}/purge`, { confirm: true, expectedFiles: files });
    assert.ok(!fs.existsSync(mediaV1));

    // Herstel vereist een gestopte app; daarna terugzetten
    const dataDir = srv.config.dataDir;
    const backupDir = srv.config.backupDir;
    srv.created.stop();
    await new Promise((r) => setTimeout(r, 50));
    srv.db.close();
    srv.db.close = () => {};
    const r = await restoreBackup({ backupPath: b.dir, dataDir, mediaDir: path.join(dataDir, 'media') });
    assert.ok(r.keptData && fs.existsSync(path.join(r.keptData, 'review.db')), 'vorige gegevens bewaard');

    // App opnieuw starten op de herstelde gegevens
    const { app, db, stop } = createApp({ dataDir, backupDir, minFreeBytes: 0, env: { ...process.env, STUDIO_REVIEW_HOME: `${dataDir}-home` } });
    const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    restoredSrv = { server, db, stop };
    const base = `http://127.0.0.1:${server.address().port}`;
    const admin = client(base);
    assert.equal((await admin.post('/api/login', { email: 'beheer@agency.nl', password: 'een-lang-wachtwoord' })).status, 200, 'account terug');
    const freelancer = client(base);
    assert.equal((await freelancer.post('/api/login', { email: 'freelance@agency.nl', password: 'een-lang-wachtwoord' })).status, 200, 'freelancer terug');
    assert.equal((await freelancer.get('/api/projects')).data.length, 1, 'rechten terug');
    const video = (await admin.get(`/api/videos/${d.videoId}`)).data;
    assert.equal(video.title, 'Campagnefilm — Hoofdvideo');
    assert.deepEqual(video.versions.map((v) => v.number), [2, 1]);
    const media = await fetch(`${base}/api/versions/${d.versionId}/media`, { headers: { cookie: admin.cookie() } });
    assert.equal(media.status, 200);
    assert.equal(crypto.createHash('sha256').update(Buffer.from(await media.arrayBuffer())).digest('hex'), originalHash, 'videobestand identiek');
    const guest = client(base);
    const review = await guest.get(`/api/review/${d.token}`);
    assert.equal(review.status, 200, 'reviewlink werkt');
    const comments = (await guest.get(`/api/review/${d.token}/versions/${d.versionId}/comments`, key)).data;
    assert.equal(comments[0].body, 'Logo groter');
    assert.equal(comments[0].sent, true, 'feedbackronde terug');
    const internal = (await admin.get(`/api/versions/${d.v2.versionId}/comments`)).data;
    assert.equal(internal[0].body, 'Interne notitie');
  } finally {
    if (restoredSrv) { restoredSrv.stop(); await new Promise((r) => restoredSrv.server.close(r)); restoredSrv.db.close(); }
    await srv.close();
  }
});

test('beschadigde of onvolledige back-up wordt herkend en niet teruggezet', async () => {
  const srv = await startServer();
  try {
    const d = await fill(srv);
    const { manifest, dir } = await createBackup({ db: srv.db, config: srv.config, storage: srv.created.storage });
    assert.equal(manifest.complete, true);
    // Een bestand in de back-up wijzigen
    const victim = path.join(dir, 'media', manifest.files[0].key);
    fs.appendFileSync(victim, 'x');
    const check = await verifyBackup(dir);
    assert.equal(check.ok, false);
    assert.ok(check.problems.some((p) => p.includes(manifest.files[0].key)));
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'herstel-'));
    await assert.rejects(restoreBackup({ backupPath: dir, dataDir: path.join(target, 'data'), mediaDir: path.join(target, 'data', 'media') }), /niet in orde/);
    assert.ok(!fs.existsSync(path.join(target, 'data')), 'niets teruggezet');
    fs.rmSync(target, { recursive: true, force: true });

    // Ontbrekend bronbestand → back-up gemarkeerd als onvolledig
    fs.rmSync(path.join(srv.config.mediaDir, srv.db.prepare('SELECT stored_name FROM versions WHERE id = ?').get(d.versionId).stored_name));
    const second = await createBackup({ db: srv.db, config: srv.config, storage: srv.created.storage });
    assert.equal(second.manifest.complete, false);
    const list = await listBackups(srv.config.backupDir);
    assert.ok(list.some((b) => b.name === second.name && b.status === 'onvolledig'));

    // Back-upmap binnen de gegevensmap wordt geweigerd
    await assert.rejects(createBackup({ db: srv.db, config: { ...srv.config, backupDirInsideData: true }, storage: srv.created.storage }), /binnen de gegevensmap/);
  } finally {
    await srv.close();
  }
});

test('grote bestanden worden gestreamd, niet in het geheugen geladen', async () => {
  const srv = await startServer();
  try {
    await setupAdmin(srv);
    // 400 MB (sparse) bestand als "video" registreren
    const big = 'groot0000000000000000000.mp4';
    const size = 400 * 1024 * 1024;
    fs.mkdirSync(srv.config.mediaDir, { recursive: true });
    const fd = fs.openSync(path.join(srv.config.mediaDir, big), 'w');
    fs.ftruncateSync(fd, size);
    fs.closeSync(fd);
    srv.db.exec(`INSERT INTO projects (name, created_at) VALUES ('Groot', '2026-01-01');
      INSERT INTO videos (project_id, title, created_at, updated_at) VALUES (last_insert_rowid(), 'Groot', '2026-01-01', '2026-01-01');
      INSERT INTO versions (video_id, number, original_filename, stored_name, extension, mime_type, size_bytes, status, created_at)
        VALUES (last_insert_rowid(), 1, 'groot.mp4', '${big}', 'mp4', 'video/mp4', ${size}, 'concept', '2026-01-01');`);
    global.gc?.();
    const startRss = process.memoryUsage().rss;
    let peak = startRss;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
    const r = await createBackup({ db: srv.db, config: srv.config, storage: srv.created.storage });
    clearInterval(timer);
    assert.equal(r.manifest.files.find((f) => f.key === big).bytes, size);
    assert.ok(peak - startRss < 150 * 1024 * 1024, `geheugengebruik steeg ${(peak - startRss) / 1024 / 1024} MB voor een bestand van 400 MB`);
  } finally {
    await srv.close();
  }
});

test('verhuizen uit de programmamap: eerst back-up, gecontroleerde kopie, origineel blijft staan', async () => {
  const srv = await startServer();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verhuis-'));
  let moved;
  try {
    const d = await fill(srv);
    const source = srv.config.dataDir;
    // De bron draait nog: weigeren
    fs.writeFileSync(path.join(source, '.studio-review.lock'), JSON.stringify({ pid: process.pid, port: 1234 }));
    await assert.rejects(migrate({ source, target: path.join(root, 'gegevens'), backupDir: path.join(root, 'backups') }), /draait nog/);
    fs.rmSync(path.join(source, '.studio-review.lock'));

    srv.created.stop();
    srv.db.close();
    srv.db.close = () => {};
    const before = Object.fromEntries(fs.readdirSync(path.join(source, 'media')).map((f) => [f, sha(path.join(source, 'media', f))]));
    const dbBefore = sha(path.join(source, 'review.db'));

    // Doel met al gegevens: weigeren
    fs.mkdirSync(path.join(root, 'bezet'), { recursive: true });
    fs.copyFileSync(path.join(source, 'review.db'), path.join(root, 'bezet', 'review.db'));
    await assert.rejects(migrate({ source, target: path.join(root, 'bezet'), backupDir: path.join(root, 'backups') }), /al gegevens/);

    const target = path.join(root, 'gegevens');
    const r = await migrate({ source, target, backupDir: path.join(root, 'backups'), log: () => {} });
    assert.equal(r.counts.projects, 1);
    assert.ok(fs.existsSync(path.join(r.safetyBackup, 'review.db')), 'database-back-up vooraf');
    // Origineel ongewijzigd
    assert.equal(sha(path.join(source, 'review.db')), dbBefore);
    for (const [f, h] of Object.entries(before)) {
      assert.equal(sha(path.join(source, 'media', f)), h);
      assert.equal(sha(path.join(target, 'media', f)), h, `kopie van ${f} identiek`);
    }
    // De app kiest nu de vaste map
    assert.deepEqual(resolveDataDir({}, root, source), { dir: target, source: 'vast', legacyDir: source });
    const cfg = loadConfig({ env: { STUDIO_REVIEW_HOME: root } });
    assert.equal(cfg.dataDir, target);

    // En werkt
    const { app, db, stop } = createApp({ dataDir: target, backupDir: path.join(root, 'backups'), minFreeBytes: 0, env: { STUDIO_REVIEW_HOME: root } });
    const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    moved = { server, db, stop };
    const base = `http://127.0.0.1:${server.address().port}`;
    const admin = client(base);
    assert.equal((await admin.post('/api/login', { email: 'beheer@agency.nl', password: 'een-lang-wachtwoord' })).status, 200);
    assert.equal((await fetch(`${base}/api/versions/${d.versionId}/media`, { headers: { cookie: admin.cookie() } })).status, 200);
    assert.equal((await client(base).get(`/api/review/${d.token}`)).status, 200);
  } finally {
    if (moved) { moved.stop(); await new Promise((r) => moved.server.close(r)); moved.db.close(); }
    await srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('DATA_DIR gaat altijd voor; een nieuwe installatie gebruikt de vaste map', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paden-'));
  try {
    const legacy = path.join(root, 'app', 'data');
    assert.deepEqual(resolveDataDir({ DATA_DIR: '/ergens/anders' }, root, legacy), { dir: '/ergens/anders', source: 'DATA_DIR', legacyDir: null });
    assert.equal(resolveDataDir({}, root, legacy).dir, path.join(root, 'gegevens'));
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'review.db'), '');
    assert.deepEqual(resolveDataDir({}, root, legacy), { dir: legacy, source: 'programmamap', legacyDir: legacy });
    // Instellingenbestand in de vaste map wordt gelezen
    fs.writeFileSync(path.join(root, 'instellingen.env'), 'PORT=3456\nMIN_FREE_GB="2"\n');
    const cfg = loadConfig({ env: { STUDIO_REVIEW_HOME: root }, dataDir: path.join(root, 'x') });
    assert.equal(cfg.port, 3456);
    assert.equal(cfg.minFreeBytes, 2 * 1024 ** 3);
    assert.equal(loadConfig({ env: { STUDIO_REVIEW_HOME: root, PORT: '4000' }, dataDir: path.join(root, 'x') }).port, 4000, 'omgevingsvariabele gaat voor');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
