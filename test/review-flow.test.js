'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeVideo, startServer, client, upload, rid, SETUP_TOKEN } = require('./helpers');

let srv;
let team;
let videoFiles;
let projectId;

before(async () => {
  srv = await startServer();
  const dir = path.join(srv.dataDir, 'fixtures');
  fs.mkdirSync(dir);
  videoFiles = {
    v1: makeVideo(dir, 'klant_campagne_edit_v03.mp4'),
    v2: makeVideo(dir, 'klant_campagne_edit_v04.mp4', 3),
  };
  team = client(srv.base);
  const setup = await team.post('/api/setup', { setupToken: SETUP_TOKEN, email: 'team@agency.nl', name: 'Sanne', password: 'een-lang-wachtwoord' });
  assert.equal(setup.status, 201);
  const p = await team.post('/api/projects', { name: 'Campagne 2026', clientName: 'Klant BV' });
  projectId = p.data.id;
});

after(() => srv.close());

const reviewerKey = (n) => `reviewer-key-${String(n).padStart(8, '0')}`;

async function newVideo(title = 'Campagnefilm — Hoofdvideo') {
  const uploadId = await upload(team, videoFiles.v1);
  const r = await team.post(`/api/projects/${projectId}/videos`, { uploadId, title });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

async function shareLatest(videoId) {
  const video = (await team.get(`/api/videos/${videoId}`)).data;
  const ver = video.versions[0];
  assert.equal((await team.post(`/api/versions/${ver.id}/ready`)).status, 200);
  assert.equal((await team.post(`/api/versions/${ver.id}/share`)).status, 200);
  return (await team.get(`/api/videos/${videoId}`)).data;
}

async function approverLink(videoId) {
  await team.patch(`/api/videos/${videoId}`, { approverName: 'Joris de Klant', approverEmail: 'joris@klant.nl' });
  const r = await team.post(`/api/videos/${videoId}/links`, { role: 'approver' });
  assert.equal(r.status, 201);
  return new URL(r.data.url).pathname.split('/').pop();
}

const tokenOf = (video, role = 'reviewer') => new URL(video.links.find((l) => l.role === role && !l.revokedAt).url).pathname.split('/').pop();

test('interne omgeving vereist een account', async () => {
  const anon = client(srv.base);
  assert.equal((await anon.get('/api/projects')).status, 401);
  assert.equal((await anon.post('/api/setup', { setupToken: SETUP_TOKEN, email: 'x@y.nl', name: 'X', password: 'nog-een-wachtwoord' })).status, 409);
  const login = await anon.post('/api/login', { email: 'team@agency.nl', password: 'fout-wachtwoord' });
  assert.equal(login.status, 401);
});

test('wijzigende verzoeken zonder CSRF-header worden geweigerd', async () => {
  const r = await fetch(`${srv.base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"x"}' });
  assert.equal(r.status, 403);
});

test('nieuwe upload begint als Concept en titel bevat geen extensie', async () => {
  const uploadId = await upload(team, videoFiles.v1);
  const r = await team.post(`/api/projects/${projectId}/videos`, { uploadId });
  const video = (await team.get(`/api/videos/${r.data.videoId}`)).data;
  assert.equal(video.title, 'klant campagne edit v03');
  assert.ok(!video.title.includes('.mp4'));
  assert.equal(video.versions[0].status, 'concept');
  assert.equal(video.versions[0].file.originalFilename, 'klant_campagne_edit_v03.mp4');
  assert.equal(video.versions[0].events[0].event, 'upload');
});

test('niet-ondersteunde bestanden en ongeldige video worden geweigerd', async () => {
  const bad = await team.post('/api/uploads', { filename: 'film.avi', size: 100 });
  assert.equal(bad.status, 400);
  const fake = path.join(srv.dataDir, 'nep.mp4');
  fs.writeFileSync(fake, 'dit is geen video');
  const uploadId = await upload(team, fake);
  const r = await team.post(`/api/projects/${projectId}/videos`, { uploadId, title: 'Nep' });
  assert.equal(r.status, 422);
});

test('titelwijziging breekt geen bestanden, links, reacties of versiegeschiedenis', async () => {
  const { videoId } = await newVideo();
  const before = await shareLatest(videoId);
  const token = tokenOf(before);
  const ver = before.versions[0];
  const client1 = client(srv.base);
  await client1.post(`/api/review/${token}/versions/${ver.id}/comments`, { body: 'Logo te klein', timecode: 1.2, authorName: 'Eva' }, { 'x-reviewer-key': reviewerKey(1) });
  const mediaBefore = await team.get(`/api/versions/${ver.id}/media`);

  const rename = await team.patch(`/api/videos/${videoId}`, { title: 'Campagnefilm — Definitief' });
  assert.equal(rename.status, 200);

  const after = (await team.get(`/api/videos/${videoId}`)).data;
  assert.equal(after.title, 'Campagnefilm — Definitief');
  assert.deepEqual(after.links.map((l) => l.url), before.links.map((l) => l.url));
  assert.equal(after.versions[0].file.originalFilename, ver.file.originalFilename);
  assert.deepEqual(after.versions[0].events, ver.events);
  const stored = srv.db.prepare('SELECT stored_name FROM versions WHERE id = ?').get(ver.id).stored_name;
  assert.ok(fs.existsSync(path.join(srv.config.mediaDir, stored)));

  const mediaAfter = await team.get(`/api/versions/${ver.id}/media`);
  assert.equal(mediaAfter.status, 200);
  assert.ok(mediaAfter.data.equals(mediaBefore.data));

  const review = await client1.get(`/api/review/${token}`);
  assert.equal(review.status, 200);
  assert.equal(review.data.title, 'Campagnefilm — Definitief');
  const comments = await client1.get(`/api/review/${token}/versions/${ver.id}/comments`);
  assert.equal(comments.data[0].body, 'Logo te klein');

  // Download krijgt titel + echte extensie
  const dl = await team.get(`/api/versions/${ver.id}/download`);
  assert.equal(dl.status, 200);
  const disp = dl.headers.get('content-disposition');
  assert.match(disp, /filename\*=UTF-8''Campagnefilm%20%E2%80%94%20Definitief%20-%20v1\.mp4/);

  // Een titel met .mp4 erin krijgt bij download geen dubbele extensie
  await team.patch(`/api/videos/${videoId}`, { title: 'Teaser.mp4' });
  assert.equal((await team.get(`/api/videos/${videoId}`)).data.title, 'Teaser.mp4');
  const empty = await team.patch(`/api/videos/${videoId}`, { title: '   ' });
  assert.equal(empty.status, 400);
});

test('reactie opslaan, pagina openen en afvinken wijzigen de status niet; feedback versturen wel', async () => {
  const { videoId } = await newVideo();
  const video = await shareLatest(videoId);
  const ver = video.versions[0];
  assert.equal(ver.status, 'in_review');
  const token = tokenOf(video);
  const guest = client(srv.base);
  const h = { 'x-reviewer-key': reviewerKey(2) };

  await guest.get(`/api/review/${token}`);
  const c = await guest.post(`/api/review/${token}/versions/${ver.id}/comments`, { body: 'Muziek zachter', timecode: 0.5, authorName: 'Eva' }, h);
  assert.equal(c.status, 201);
  const noName = await guest.post(`/api/review/${token}/versions/${ver.id}/comments`, { body: 'x', authorName: ' ' }, h);
  assert.equal(noName.status, 400);
  await team.post(`/api/comments/${c.data.id}/resolve`, { resolved: true });
  let status = (await team.get(`/api/videos/${videoId}`)).data.versions[0].status;
  assert.equal(status, 'in_review');

  // gast kan niet goedkeuren
  const approve = await guest.post(`/api/review/${token}/versions/${ver.id}/approve`, { requestId: rid(), confirm: true, versionNumber: 1 }, h);
  assert.equal(approve.status, 403);

  const fb = await guest.post(`/api/review/${token}/versions/${ver.id}/feedback`, { requestId: rid(), authorName: 'Eva', message: 'Zie opmerkingen' }, h);
  assert.equal(fb.status, 200);
  assert.equal(fb.data.commentCount, 1);
  const after = (await team.get(`/api/videos/${videoId}`)).data.versions[0];
  assert.equal(after.status, 'changes_requested');
  const last = after.events.at(-1);
  assert.equal(last.event, 'feedback_submitted');
  assert.equal(last.actorType, 'guest');
  assert.match(last.actorLabel, /Eva \(opgegeven naam\)/);
  assert.ok(last.at);

  // lege feedbackronde wordt geweigerd
  const emptyRound = await guest.post(`/api/review/${token}/versions/${ver.id}/feedback`, { requestId: rid(), authorName: 'Eva' }, h);
  assert.equal(emptyRound.status, 400);
});

test('goedkeuring geldt alleen voor de bekeken versie; nieuwe versie bewaart feedback en goedkeuring', async () => {
  const { videoId } = await newVideo();
  let video = await shareLatest(videoId);
  const v1 = video.versions[0];
  const approverToken = await approverLink(videoId);
  const approver = client(srv.base);
  const h = { 'x-reviewer-key': reviewerKey(3) };

  const info = (await approver.get(`/api/review/${approverToken}`)).data;
  assert.equal(info.role, 'approver');
  assert.deepEqual(info.identity, { name: 'Joris de Klant', verified: true });

  await approver.post(`/api/review/${approverToken}/versions/${v1.id}/comments`, { body: 'Mooi!', timecode: 1 }, h);
  const noConfirm = await approver.post(`/api/review/${approverToken}/versions/${v1.id}/approve`, { requestId: rid(), versionNumber: 1 }, h);
  assert.equal(noConfirm.status, 400);
  const wrongVersion = await approver.post(`/api/review/${approverToken}/versions/${v1.id}/approve`, { requestId: rid(), confirm: true, versionNumber: 2 }, h);
  assert.equal(wrongVersion.status, 409);
  const ok = await approver.post(`/api/review/${approverToken}/versions/${v1.id}/approve`, { requestId: rid(), confirm: true, versionNumber: 1 }, h);
  assert.equal(ok.status, 200);

  // Nieuwe versie uploaden onder dezelfde video
  const uploadId = await upload(team, videoFiles.v2);
  const nv = await team.post(`/api/videos/${videoId}/versions`, { uploadId });
  assert.equal(nv.status, 201);
  assert.equal(nv.data.number, 2);

  video = (await team.get(`/api/videos/${videoId}`)).data;
  const [v2, v1After] = video.versions;
  assert.equal(video.title, 'Campagnefilm — Hoofdvideo', 'nieuwe versie neemt titel over');
  assert.equal(v2.status, 'concept', 'nieuwe versie is niet automatisch goedgekeurd');
  assert.equal(v2.approval, null);
  assert.equal(v1After.status, 'approved');
  assert.equal(v1After.approval.name, 'Joris de Klant');
  assert.equal(v1After.commentCount, 1);

  // Klant ziet nog v1 zolang v2 niet is gedeeld
  let review = (await approver.get(`/api/review/${approverToken}`)).data;
  assert.equal(review.versions[0].number, 1);

  await team.post(`/api/versions/${v2.id}/ready`);
  await team.post(`/api/versions/${v2.id}/share`);
  review = (await approver.get(`/api/review/${approverToken}`)).data;
  assert.equal(review.versions[0].number, 2, 'zelfde link toont nieuwste gedeelde versie');
  assert.equal(review.versions[0].isLatest, true);
  assert.equal(review.versions[0].status, 'in_review');
  assert.equal(review.versions[1].status, 'approved');

  // Oude versie kan niet opnieuw goedgekeurd of becommentarieerd worden
  const oldApprove = await approver.post(`/api/review/${approverToken}/versions/${v1.id}/approve`, { requestId: rid(), confirm: true, versionNumber: 1 }, h);
  assert.equal(oldApprove.status, 409);
  const v1Comments = (await approver.get(`/api/review/${approverToken}/versions/${v1.id}/comments`)).data;
  assert.equal(v1Comments.length, 1);
  const v2Comments = (await approver.get(`/api/review/${approverToken}/versions/${v2.id}/comments`)).data;
  assert.equal(v2Comments.length, 0);

  // Goedkeuren van v2 laat v1 ongemoeid
  await approver.post(`/api/review/${approverToken}/versions/${v2.id}/approve`, { requestId: rid(), confirm: true, versionNumber: 2 }, h);
  const approvals = srv.db.prepare('SELECT version_id FROM approvals WHERE version_id IN (?, ?) ORDER BY id').all(v1.id, v2.id);
  assert.deepEqual(approvals.map((a) => a.version_id), [v1.id, v2.id]);
});

test('team kan status handmatig corrigeren; wijziging wordt gelogd', async () => {
  const { videoId } = await newVideo();
  const video = await shareLatest(videoId);
  const ver = video.versions[0];
  const r = await team.post(`/api/versions/${ver.id}/status`, { status: 'approved', note: 'Akkoord per telefoon' });
  assert.equal(r.status, 200);
  const after = (await team.get(`/api/videos/${videoId}`)).data.versions[0];
  assert.equal(after.status, 'approved');
  const ev = after.events.at(-1);
  assert.equal(ev.event, 'manual');
  assert.equal(ev.actorLabel, 'Sanne');
  assert.equal(ev.note, 'Akkoord per telefoon');
  assert.equal(after.approval, null, 'handmatige correctie is geen klantgoedkeuring');
});

test('ingetrokken klantlink geeft geen toegang meer, ook niet tot media', async () => {
  const { videoId } = await newVideo();
  const video = await shareLatest(videoId);
  const ver = video.versions[0];
  const link = video.links.find((l) => l.role === 'reviewer');
  const token = tokenOf(video);
  const guest = client(srv.base);
  assert.equal((await guest.get(`/api/review/${token}/versions/${ver.id}/media`)).status, 200);

  assert.equal((await team.post(`/api/links/${link.id}/revoke`)).status, 200);

  assert.equal((await guest.get(`/api/review/${token}`)).status, 410);
  assert.equal((await guest.get(`/api/review/${token}/versions/${ver.id}/media`)).status, 410);
  assert.equal((await guest.get(`/api/review/${token}/versions/${ver.id}/comments`)).status, 410);
  const c = await guest.post(`/api/review/${token}/versions/${ver.id}/comments`, { body: 'x', authorName: 'Eva' }, { 'x-reviewer-key': reviewerKey(4) });
  assert.equal(c.status, 410);
  const fb = await guest.post(`/api/review/${token}/versions/${ver.id}/feedback`, { requestId: rid(), authorName: 'Eva', message: 'x' }, { 'x-reviewer-key': reviewerKey(4) });
  assert.equal(fb.status, 410);
  assert.equal((await guest.get('/api/review/bestaatnietbestaatnietbestaatniet')).status, 404);
});

test('link geeft geen toegang tot andere video of ongedeelde versie', async () => {
  const a = await newVideo('Video A');
  const b = await newVideo('Video B');
  const videoA = await shareLatest(a.videoId);
  const tokenA = tokenOf(videoA);
  const guest = client(srv.base);
  // Versie van video B via link van A
  const vB = (await team.get(`/api/videos/${b.videoId}`)).data.versions[0];
  assert.equal((await guest.get(`/api/review/${tokenA}/versions/${vB.id}/media`)).status, 404);
  // Nieuwe, nog niet gedeelde versie van A
  const uploadId = await upload(team, videoFiles.v2);
  const nv = await team.post(`/api/videos/${a.videoId}/versions`, { uploadId });
  assert.equal((await guest.get(`/api/review/${tokenA}/versions/${nv.data.versionId}/media`)).status, 404);
  // Download alleen als de link dat toestaat
  assert.equal((await guest.get(`/api/review/${tokenA}/versions/${videoA.versions[0].id}/download`)).status, 403);
});

test('andere akkoordgever trekt oude akkoordlink in', async () => {
  const { videoId } = await newVideo();
  await shareLatest(videoId);
  const oldToken = await approverLink(videoId);
  await team.patch(`/api/videos/${videoId}`, { approverName: 'Iemand Anders', approverEmail: 'anders@klant.nl' });
  assert.equal((await client(srv.base).get(`/api/review/${oldToken}`)).status, 410);
});

test('upload hervat na een afgebroken blok', async () => {
  const buf = fs.readFileSync(videoFiles.v1);
  const init = await team.post('/api/uploads', { filename: 'hervat.mp4', size: buf.length });
  const { id, chunkSize } = init.data;
  await team.put(`/api/uploads/${id}?offset=0`, buf.subarray(0, chunkSize));
  const wrong = await team.put(`/api/uploads/${id}?offset=${chunkSize * 2}`, buf.subarray(0, 10));
  assert.equal(wrong.status, 409);
  assert.equal(wrong.data.receivedBytes, chunkSize);
  const status = await team.get(`/api/uploads/${id}`);
  for (let offset = status.data.receivedBytes; offset < buf.length; offset += chunkSize) {
    await team.put(`/api/uploads/${id}?offset=${offset}`, buf.subarray(offset, offset + chunkSize));
  }
  const r = await team.post(`/api/projects/${projectId}/videos`, { uploadId: id, title: 'Hervat' });
  assert.equal(r.status, 201);
});
