'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { makeVideo, startServer, client, upload, rid, setupAdmin, addMember, sharedVideo } = require('./helpers');
const { openDb } = require('../server/db');

let srv;
let admin;
let file;
let A; // project waar de freelancer toegang toe krijgt
let B; // project zonder toegang

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  file = makeVideo(srv.dataDir, 'clip.mp4');
  A = await sharedVideo(admin, file, { name: 'Project A', title: 'Video A' });
  B = await sharedVideo(admin, file, { name: 'Project B', title: 'Video B' });
});
after(() => srv.close());

const expectStatus = async (promise, status, label) => {
  const r = await promise;
  assert.equal(r.status, status, `${label}: verwacht ${status}, kreeg ${r.status} ${JSON.stringify(r.data)?.slice(0, 160)}`);
  return r;
};

describe('rechten per project', () => {
  test('geen toegang tot een ander project, ook niet rechtstreeks via URL', async () => {
    const { client: f } = await addMember(srv, admin, { email: 'geen@freelance.nl', projects: [{ projectId: A.projectId, level: 'view' }] });
    const list = (await f.get('/api/projects')).data;
    assert.deepEqual(list.map((p) => p.name), ['Project A']);
    for (const [url, label] of [
      [`/api/projects/${B.projectId}`, 'project'],
      [`/api/videos/${B.videoId}`, 'video'],
      [`/api/versions/${B.versionId}/media`, 'videobestand'],
      [`/api/versions/${B.versionId}/poster`, 'thumbnail'],
      [`/api/versions/${B.versionId}/download`, 'download'],
      [`/api/versions/${B.versionId}/comments`, 'reacties'],
    ]) await expectStatus(f.get(url), 404, label);
    await expectStatus(f.post(`/api/versions/${B.versionId}/comments`, { body: 'x' }), 404, 'reageren');
    await expectStatus(f.post('/api/uploads', { filename: 'x.mp4', size: 100, projectId: B.projectId }), 404, 'upload naar B');
    // Upload zonder doel is alleen voor beheerders
    await expectStatus(f.post('/api/uploads', { filename: 'x.mp4', size: 100 }), 400, 'upload zonder doel');
  });

  test('bekijken/reageren: wel kijken en reageren, niets wijzigen', async () => {
    const { client: f } = await addMember(srv, admin, { email: 'kijk@freelance.nl', projects: [{ projectId: A.projectId, level: 'view' }] });
    await expectStatus(f.get(`/api/versions/${A.versionId}/media`), 200, 'media');
    await expectStatus(f.get(`/api/versions/${A.versionId}/poster`), 200, 'thumbnail');
    const c = await expectStatus(f.post(`/api/versions/${A.versionId}/comments`, { body: 'Mooi', timecode: 1 }), 201, 'reactie');
    await expectStatus(f.post(`/api/comments/${c.data.id}/resolve`, { resolved: true }), 200, 'afhandelen');
    const video = (await f.get(`/api/videos/${A.videoId}`)).data;
    assert.equal(video.myLevel, 'view');
    assert.deepEqual(video.links, [], 'links (klanttoegang) niet zichtbaar');
    await expectStatus(f.post('/api/uploads', { filename: 'x.mp4', size: 100, projectId: A.projectId }), 403, 'upload');
    await expectStatus(f.patch(`/api/videos/${A.videoId}`, { title: 'Nieuw' }), 403, 'titel');
    await expectStatus(f.post(`/api/videos/${A.videoId}/links`, { role: 'reviewer' }), 403, 'link maken');
    await expectStatus(f.post(`/api/versions/${A.versionId}/status`, { status: 'approved', note: 'x' }), 403, 'status corrigeren');
    await expectStatus(f.del(`/api/videos/${A.videoId}`), 403, 'prullenbak');
    await expectStatus(f.post('/api/projects', { name: 'Eigen project' }), 403, 'project maken');
    for (const url of ['/api/storage', '/api/backups', '/api/system']) await expectStatus(f.get(url), 403, url);
    const users = (await f.get('/api/users')).data;
    assert.equal(users.length, 1, 'ziet alleen zichzelf');
  });

  test('uploaden: video en versie toevoegen, titel, klaarzetten; niet publiceren', async () => {
    const { client: f } = await addMember(srv, admin, { email: 'upload@freelance.nl', projects: [{ projectId: A.projectId, level: 'upload' }] });
    const created = await expectStatus(f.post(`/api/projects/${A.projectId}/videos`, { uploadId: await upload(f, file, { projectId: A.projectId }), title: 'Van freelancer' }), 201, 'video');
    await expectStatus(f.post(`/api/videos/${A.videoId}/versions`, { uploadId: await upload(f, file, { videoId: A.videoId }) }), 201, 'nieuwe versie');
    await expectStatus(f.patch(`/api/videos/${created.data.videoId}`, { title: 'Hernoemd' }), 200, 'titel');
    await expectStatus(f.post(`/api/versions/${created.data.versionId}/ready`), 200, 'klaarzetten');
    await expectStatus(f.post(`/api/versions/${created.data.versionId}/share`), 403, 'publiceren');
    await expectStatus(f.patch(`/api/videos/${A.videoId}`, { approverName: 'X' }), 403, 'akkoordgever');
    // Een upload voor video A mag niet in een ander project worden gebruikt
    const id = await upload(f, file, { videoId: A.videoId });
    await expectStatus(f.post(`/api/projects/${A.projectId}/videos`, { uploadId: id, title: 'x' }), 400, 'upload voor ander doel');
  });

  test('publiceren/delen: delen en links, maar niet beheren', async () => {
    const { client: f } = await addMember(srv, admin, { email: 'publish@freelance.nl', projects: [{ projectId: A.projectId, level: 'publish' }] });
    const v = (await f.get(`/api/videos/${A.videoId}`)).data;
    assert.ok(v.links.length > 0, 'ziet links');
    const latest = v.versions[0];
    await f.post(`/api/versions/${latest.id}/ready`);
    await expectStatus(f.post(`/api/versions/${latest.id}/share`), 200, 'publiceren');
    await expectStatus(f.post(`/api/videos/${A.videoId}/links`, { role: 'reviewer' }), 201, 'link maken');
    await expectStatus(f.post(`/api/versions/${latest.id}/status`, { status: 'approved', note: 'x' }), 403, 'status corrigeren');
    await expectStatus(f.post(`/api/projects/${A.projectId}/archive`, {}), 403, 'archiveren');
  });

  test('beheren: corrigeren, archiveren en prullenbak; definitief verwijderen alleen beheerder', async () => {
    const extra = await sharedVideo(admin, file, { name: 'Project C', title: 'Video C' });
    const { client: f } = await addMember(srv, admin, { email: 'manage@freelance.nl', projects: [{ projectId: extra.projectId, level: 'manage' }] });
    await expectStatus(f.post(`/api/versions/${extra.versionId}/status`, { status: 'approved', note: 'telefonisch akkoord' }), 200, 'corrigeren');
    await expectStatus(f.del(`/api/videos/${extra.videoId}`), 200, 'prullenbak');
    const trash = (await f.get('/api/trash')).data;
    assert.equal(trash.canPurge, false);
    assert.ok(trash.items.some((i) => i.type === 'video' && i.id === extra.videoId));
    await expectStatus(f.get(`/api/trash/video/${extra.videoId}/purge-preview`), 403, 'voorbeeld definitief verwijderen');
    await expectStatus(f.post(`/api/trash/video/${extra.videoId}/purge`, { confirm: true, expectedFiles: 2 }), 403, 'definitief verwijderen');
    await expectStatus(f.post('/api/trash/restore', { type: 'video', id: extra.videoId }), 200, 'terugzetten');
    await expectStatus(f.get(`/api/projects/${A.projectId}`), 404, 'ander project');
  });

  test('rechten intrekken werkt direct, ook voor lopende sessies', async () => {
    const { client: f, id } = await addMember(srv, admin, { email: 'tijdelijk@freelance.nl', projects: [{ projectId: A.projectId, level: 'view' }] });
    await expectStatus(f.get(`/api/versions/${A.versionId}/media`), 200, 'voor intrekken');
    await expectStatus(admin.put(`/api/users/${id}/projects`, { projects: [] }), 200, 'intrekken');
    await expectStatus(f.get(`/api/versions/${A.versionId}/media`), 404, 'na intrekken');
    await expectStatus(admin.patch(`/api/users/${id}`, { disabled: true }), 200, 'uitschakelen');
    await expectStatus(f.get('/api/projects'), 401, 'sessie beëindigd');
    await expectStatus(client(srv.base).post('/api/login', { email: 'tijdelijk@freelance.nl', password: 'een-lang-wachtwoord' }), 403, 'inloggen');
  });

  test('er blijft altijd een beheerder', async () => {
    const me = (await admin.get('/api/session')).data.user;
    await expectStatus(admin.patch(`/api/users/${me.id}`, { role: 'member' }), 409, 'laatste beheerder degraderen');
    await expectStatus(admin.patch(`/api/users/${me.id}`, { disabled: true }), 409, 'laatste beheerder uitschakelen');
    const { id } = await addMember(srv, admin, { email: 'tweede@agency.nl', role: 'admin' });
    await expectStatus(admin.patch(`/api/users/${me.id}`, { role: 'member' }), 200, 'nu wel');
    await expectStatus(admin.get('/api/storage'), 403, 'geen beheerder meer');
    // terugzetten voor de overige tests
    const other = client(srv.base);
    await other.post('/api/login', { email: 'tweede@agency.nl', password: 'een-lang-wachtwoord' });
    await expectStatus(other.patch(`/api/users/${me.id}`, { role: 'admin' }), 200, 'weer beheerder');
    assert.ok(id);
  });

  test('klantlinks en akkoordgever werken ongewijzigd', async () => {
    const guest = client(srv.base);
    const h = { 'x-reviewer-key': 'rechten-key-0000001' };
    await expectStatus(guest.get(`/api/review/${B.token}`), 200, 'klantlink');
    await expectStatus(guest.post(`/api/review/${B.token}/versions/${B.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, h), 403, 'gast keurt niet goed');
  });
});

test('bestaande accounts worden na de update beheerder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-oud-'));
  try {
    // Database zoals vóór deze versie: users-tabel zonder rol.
    const old = new DatabaseSync(path.join(dir, 'review.db'));
    old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL); INSERT INTO users VALUES (1, 'oud@agency.nl', 'Oud', 'x', '2026-01-01');");
    old.close();
    const db = openDb({ dataDir: dir, dbFile: path.join(dir, 'review.db') });
    const u = db.prepare('SELECT role, disabled_at FROM users WHERE id = 1').get();
    assert.equal(u.role, 'admin');
    assert.equal(u.disabled_at, null);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
