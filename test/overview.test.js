'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeVideo, startServer, client, upload, rid, SETUP_TOKEN } = require('./helpers');
const { backfillPosters } = require('../server/maintenance');

let srv;
let team;
let file;

before(async () => {
  srv = await startServer();
  team = client(srv.base);
  await team.post('/api/setup', { setupToken: SETUP_TOKEN, email: 'team@agency.nl', name: 'Sanne', password: 'een-lang-wachtwoord' });
  file = makeVideo(srv.dataDir, 'clip.mp4');
});
after(() => srv.close());

test('leeg account: geen projecten', async () => {
  assert.deepEqual((await team.get('/api/projects')).data, []);
});

test('projectoverzicht toont echte activiteit, open feedback en thumbnails', async () => {
  const empty = (await team.post('/api/projects', { name: 'Leeg project' })).data.id;
  const projectId = (await team.post('/api/projects', { name: 'Campagne', clientName: 'Klant BV' })).data.id;
  const a = (await team.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(team, file), title: 'Hoofdvideo' })).data;
  const b = (await team.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(team, file), title: 'Teaser' })).data;
  await team.post(`/api/versions/${a.versionId}/ready`);
  await team.post(`/api/versions/${a.versionId}/share`);
  const video = (await team.get(`/api/videos/${a.videoId}`)).data;
  const token = new URL(video.links[0].url).pathname.split('/').pop();
  const guest = client(srv.base);
  const h = { 'x-reviewer-key': 'overzicht-key-000001' };
  await guest.post(`/api/review/${token}/versions/${a.versionId}/comments`, { body: 'Een', timecode: 1, authorName: 'Eva', requestId: rid() }, h);
  await guest.post(`/api/review/${token}/versions/${a.versionId}/comments`, { body: 'Twee', timecode: 1.5, authorName: 'Eva', requestId: rid() }, h);

  const list = (await team.get('/api/projects')).data;
  assert.equal(list[0].id, projectId, 'meest recente activiteit bovenaan');
  const p = list.find((x) => x.id === projectId);
  assert.equal(p.videoCount, 2);
  assert.equal(p.statusCounts.in_review, 1);
  assert.equal(p.statusCounts.concept, 1);
  assert.equal(p.openComments, 2);
  assert.equal(p.posters.length, 2);
  assert.ok(p.lastActivityAt >= p.createdAt);
  const e = list.find((x) => x.id === empty);
  assert.equal(e.videoCount, 0);
  assert.equal(e.openComments, 0);
  assert.deepEqual(e.posters, []);

  // Afhandelen verlaagt het aantal open reacties, zonder statuswijziging
  const comments = (await team.get(`/api/versions/${a.versionId}/comments`)).data;
  await team.post(`/api/comments/${comments[0].id}/resolve`, { resolved: true });
  const after = (await team.get('/api/projects')).data.find((x) => x.id === projectId);
  assert.equal(after.openComments, 1);
  assert.equal(after.statusCounts.in_review, 1);

  // Project: interne nieuwste versie versus wat de klant ziet
  const nv = (await team.post(`/api/videos/${a.videoId}/versions`, { uploadId: await upload(team, file) })).data;
  const detail = (await team.get(`/api/projects/${projectId}`)).data;
  const row = detail.videos.find((v) => v.id === a.videoId);
  assert.equal(row.latestVersion.number, 2);
  assert.equal(row.latestVersion.status, 'concept');
  assert.equal(row.sharedVersion.number, 1);
  assert.equal(row.sharedVersion.status, 'in_review');
  assert.equal(row.openComments, 1);
  assert.ok(row.posterVersionId);
  assert.equal(detail.videos.find((v) => v.id === b.videoId).sharedVersion, null);

  const vd = (await team.get(`/api/videos/${a.videoId}`)).data;
  assert.equal(vd.clientVersionId, a.versionId);
  assert.deepEqual(vd.versions.map((v) => [v.number, v.isLatest, v.isClientVersion]), [[2, true, false], [1, false, true]]);
  assert.equal(vd.versions[1].openComments, 1);
  assert.equal(vd.versions[0].id, nv.versionId);
});

test('handmatige correctie vereist een reden', async () => {
  const projectId = (await team.post('/api/projects', { name: 'Reden' })).data.id;
  const { versionId } = (await team.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(team, file), title: 'X' })).data;
  const noReason = await team.post(`/api/versions/${versionId}/status`, { status: 'approved' });
  assert.equal(noReason.status, 400);
  assert.match(noReason.data.error, /reden/);
  assert.equal((await team.post(`/api/versions/${versionId}/status`, { status: 'approved', note: '   ' })).status, 400);
  assert.equal((await team.post(`/api/versions/${versionId}/status`, { status: 'approved', note: 'Akkoord per mail' })).status, 200);
});

test('ontbrekende thumbnails worden achteraf aangemaakt', async () => {
  const projectId = (await team.post('/api/projects', { name: 'Thumbs' })).data.id;
  const { versionId } = (await team.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(team, file), title: 'Y' })).data;
  const row = srv.db.prepare('SELECT stored_name FROM versions WHERE id = ?').get(versionId);
  fs.rmSync(path.join(srv.config.mediaDir, `${row.stored_name}.jpg`));
  srv.db.prepare('UPDATE versions SET has_poster = 0 WHERE id = ?').run(versionId);
  assert.equal((await team.get(`/api/versions/${versionId}/poster`)).status, 404);

  const result = await backfillPosters(srv.db, srv.config, srv.created.storage);
  assert.ok(result.created >= 1);
  assert.equal((await team.get(`/api/versions/${versionId}/poster`)).status, 200);
});
