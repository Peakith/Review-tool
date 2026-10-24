'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeVideo, startServer, client, upload, rid, setupAdmin, sharedVideo } = require('./helpers');

let srv;
let admin;
let file;

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  file = makeVideo(srv.dataDir, 'clip.mp4');
});
after(() => srv.close());

const mediaPath = (versionId) => path.join(srv.config.mediaDir, srv.db.prepare('SELECT stored_name FROM versions WHERE id = ?').get(versionId).stored_name);
const key = { 'x-reviewer-key': 'prullenbak-key-00001' };

test('prullenbak: geen toegang via klantlink of media; terugzetten herstelt, ingetrokken links blijven ingetrokken', async () => {
  const s = await sharedVideo(admin, file, { name: 'Prullenbak', title: 'Weggooi-video' });
  await admin.patch(`/api/videos/${s.videoId}`, { approverName: 'Joris', approverEmail: 'joris@klant.nl' });
  const approverToken = new URL((await admin.post(`/api/videos/${s.videoId}/links`, { role: 'approver' })).data.url).pathname.split('/').pop();
  const extra = (await admin.post(`/api/videos/${s.videoId}/links`, { role: 'reviewer', label: 'Ingetrokken' })).data;
  const extraToken = new URL(extra.url).pathname.split('/').pop();
  await admin.post(`/api/links/${extra.id}/revoke`);
  const guest = client(srv.base);
  await guest.post(`/api/review/${s.token}/versions/${s.versionId}/comments`, { body: 'Reactie', timecode: 1, authorName: 'Eva', requestId: rid() }, key);

  assert.equal((await admin.del(`/api/videos/${s.videoId}`)).status, 200);
  // Bestanden staan nog op schijf, maar zijn niet meer bereikbaar.
  assert.ok(fs.existsSync(mediaPath(s.versionId)));
  for (const url of [`/api/review/${s.token}`, `/api/review/${s.token}/versions/${s.versionId}/media`, `/api/review/${s.token}/versions/${s.versionId}/poster`, `/api/review/${approverToken}`]) {
    assert.equal((await guest.get(url)).status, 410, `klant ${url}`);
  }
  for (const url of [`/api/videos/${s.videoId}`, `/api/versions/${s.versionId}/media`, `/api/versions/${s.versionId}/poster`, `/api/versions/${s.versionId}/download`, `/api/versions/${s.versionId}/comments`]) {
    assert.equal((await admin.get(url)).status, 410, `team ${url}`);
  }
  const project = (await admin.get(`/api/projects/${s.projectId}`)).data;
  assert.equal(project.videos.length, 0, 'niet in het projectoverzicht');

  // Terugzetten
  assert.equal((await admin.post('/api/trash/restore', { type: 'video', id: s.videoId })).status, 200);
  assert.equal((await guest.get(`/api/review/${s.token}`)).status, 200, 'reviewlink werkt weer');
  assert.equal((await guest.get(`/api/review/${approverToken}`)).status, 200, 'akkoordlink werkt weer');
  assert.equal((await guest.get(`/api/review/${extraToken}`)).status, 410, 'ingetrokken link blijft ingetrokken');
  const comments = (await guest.get(`/api/review/${s.token}/versions/${s.versionId}/comments`, key)).data;
  assert.equal(comments[0].body, 'Reactie', 'reacties terug');
  assert.equal((await guest.get(`/api/review/${s.token}/versions/${s.versionId}/media`)).status, 200);
});

test('versie in de prullenbak: klant ziet de vorige gedeelde versie; enige versie kan niet', async () => {
  const s = await sharedVideo(admin, file, { name: 'Versies', title: 'Twee versies' });
  assert.equal((await admin.del(`/api/versions/${s.versionId}`)).status, 409, 'enige versie');
  const v2 = (await admin.post(`/api/videos/${s.videoId}/versions`, { uploadId: await upload(admin, file, { videoId: s.videoId }) })).data;
  await admin.post(`/api/versions/${v2.versionId}/ready`);
  await admin.post(`/api/versions/${v2.versionId}/share`);
  const guest = client(srv.base);
  assert.equal((await guest.get(`/api/review/${s.token}`)).data.versions[0].number, 2);
  assert.equal((await admin.del(`/api/versions/${v2.versionId}`)).status, 200);
  const r = (await guest.get(`/api/review/${s.token}`)).data;
  assert.deepEqual(r.versions.map((v) => v.number), [1]);
  assert.equal((await guest.get(`/api/review/${s.token}/versions/${v2.versionId}/media`)).status, 404);
  const team = (await admin.get(`/api/videos/${s.videoId}`)).data;
  assert.deepEqual(team.versions.map((v) => v.number), [1]);
  assert.equal(team.trashedVersionCount, 1);
  // Nieuwe upload krijgt geen hergebruikt nummer
  const v3 = (await admin.post(`/api/videos/${s.videoId}/versions`, { uploadId: await upload(admin, file, { videoId: s.videoId }) })).data;
  assert.equal(v3.number, 3);
  await admin.post('/api/trash/restore', { type: 'version', id: v2.versionId });
  assert.deepEqual((await admin.get(`/api/videos/${s.videoId}`)).data.versions.map((v) => v.number), [3, 2, 1]);
});

test('archief: bestanden blijven, alleen-lezen voor team en klant, terug te halen', async () => {
  const s = await sharedVideo(admin, file, { name: 'Archiefproject', title: 'Archiefvideo' });
  const before = fs.statSync(mediaPath(s.versionId)).size;
  assert.equal((await admin.post(`/api/projects/${s.projectId}/archive`, { archived: true })).status, 200);
  assert.ok(!(await admin.get('/api/projects')).data.some((p) => p.id === s.projectId), 'niet in actief overzicht');
  assert.ok((await admin.get('/api/projects?archived=1')).data.find((p) => p.id === s.projectId).archivedAt, 'wel in archief');
  assert.equal(fs.statSync(mediaPath(s.versionId)).size, before, 'bestand ongewijzigd');
  assert.equal((await admin.get(`/api/versions/${s.versionId}/media`)).status, 200, 'team kan nog kijken');
  assert.equal((await admin.post('/api/uploads', { filename: 'x.mp4', size: 10, projectId: s.projectId })).status, 409, 'geen uploads');
  assert.equal((await admin.post(`/api/versions/${s.versionId}/comments`, { body: 'x' })).status, 409, 'geen reacties');
  const guest = client(srv.base);
  const info = (await guest.get(`/api/review/${s.token}`)).data;
  assert.equal(info.archived, true);
  assert.equal((await guest.get(`/api/review/${s.token}/versions/${s.versionId}/media`)).status, 200, 'klant kan nog kijken');
  assert.equal((await guest.post(`/api/review/${s.token}/versions/${s.versionId}/comments`, { body: 'x', authorName: 'Eva', requestId: rid() }, key)).status, 409);
  assert.equal((await guest.post(`/api/review/${s.token}/versions/${s.versionId}/feedback`, { authorName: 'Eva', message: 'x', requestId: rid() }, key)).status, 409);
  assert.equal((await admin.post(`/api/projects/${s.projectId}/archive`, { archived: false })).status, 200);
  assert.equal((await guest.post(`/api/review/${s.token}/versions/${s.versionId}/comments`, { body: 'weer open', authorName: 'Eva', requestId: rid() }, key)).status, 201);
});

test('definitief verwijderen: eerst overzicht met bestanden en ruimte, daarna echt weg', async () => {
  const s = await sharedVideo(admin, file, { name: 'Definitief', title: 'Echt weg' });
  const v2 = (await admin.post(`/api/videos/${s.videoId}/versions`, { uploadId: await upload(admin, file, { videoId: s.videoId }) })).data;
  const files = [mediaPath(s.versionId), `${mediaPath(s.versionId)}.jpg`, mediaPath(v2.versionId), `${mediaPath(v2.versionId)}.jpg`];
  const expectedBytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);

  assert.equal((await admin.get(`/api/trash/project/${s.projectId}/purge-preview`)).status, 409, 'niet in prullenbak');
  await admin.del(`/api/projects/${s.projectId}`);
  const preview = (await admin.get(`/api/trash/project/${s.projectId}/purge-preview`)).data;
  assert.equal(preview.fileCount, 4);
  assert.equal(preview.totalBytes, expectedBytes);
  assert.equal(preview.versions, 2);
  assert.ok(preview.files.some((f) => f.kind === 'video' && f.originalFilename === 'clip.mp4'));

  assert.equal((await admin.post(`/api/trash/project/${s.projectId}/purge`, {})).status, 409, 'zonder bevestiging');
  assert.equal((await admin.post(`/api/trash/project/${s.projectId}/purge`, { confirm: true, expectedFiles: 3 })).status, 409, 'verouderd overzicht');
  assert.ok(files.every((f) => fs.existsSync(f)), 'nog niets verwijderd');
  const done = (await admin.post(`/api/trash/project/${s.projectId}/purge`, { confirm: true, expectedFiles: 4 })).data;
  assert.equal(done.freedBytes, expectedBytes);
  assert.ok(files.every((f) => !fs.existsSync(f)), 'bestanden weg');
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM videos WHERE project_id = ?').get(s.projectId).n, 0);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM share_links WHERE video_id = ?').get(s.videoId).n, 0);
  assert.equal((await client(srv.base).get(`/api/review/${s.token}`)).status, 404);
});

test('opslagoverzicht telt actieve, oude, gearchiveerde en weggegooide versies en tijdelijke uploads', async () => {
  const s = await sharedVideo(admin, file, { name: 'Opslag', title: 'Meet' });
  await admin.post(`/api/videos/${s.videoId}/versions`, { uploadId: await upload(admin, file, { videoId: s.videoId }) });
  const half = fs.readFileSync(file).subarray(0, 4096);
  const pending = (await admin.post('/api/uploads', { filename: 'half.mp4', size: 100000, projectId: s.projectId })).data;
  await admin.put(`/api/uploads/${pending.id}?offset=0`, half);
  const report = (await admin.get('/api/storage')).data;
  const p = report.projects.find((x) => x.id === s.projectId);
  const oldBytes = fs.statSync(mediaPath(s.versionId)).size + fs.statSync(`${mediaPath(s.versionId)}.jpg`).size;
  assert.equal(p.oldVersions, oldBytes, 'oude versie');
  assert.ok(p.active > 0);
  assert.ok(report.totals.tmp >= 4096, 'tijdelijke uploads');
  assert.ok(report.disk.free > 0 && report.disk.total > 0, 'vrije schijfruimte');
  const sum = report.totals.active + report.totals.oldVersions + report.totals.archived + report.totals.trash + report.totals.tmp;
  assert.equal(report.totals.all, sum);
  assert.equal(report.mediaDirBytes, report.totals.active + report.totals.oldVersions + report.totals.archived + report.totals.trash, 'som klopt met werkelijke bestanden');
});
