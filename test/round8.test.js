'use strict';
// Bouwronde 8: freelancer met ingetrokken toegang (overal weg, ook inbox, tellers, zoeken, media en
// favorieten), goedkeuren los van definitief vrijgeven in het klantportaal, en foutpagina's in de
// vaste donkere stijl.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeVideo, startServer, client, rid, setupAdmin, addMember, sharedVideo } = require('./helpers');

let srv;
let admin;
let A;
let fien;
let fienId;
let clientToken;
const key = { 'x-reviewer-key': 'ronde8-key-00000001' };

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  const file = makeVideo(srv.dataDir, 'clip.mp4', 3);
  A = await sharedVideo(admin, file, { name: 'Project Ronde 8', title: 'Hoofdfilm' });
  ({ client: fien, id: fienId } = await addMember(srv, admin, { email: 'fien@ronde8.nl', name: 'Fien', role: 'freelancer', projects: [{ projectId: A.projectId, role: 'freelancer' }] }));
  await admin.patch(`/api/videos/${A.videoId}`, { approverName: 'Joris', approverEmail: 'joris@klant.nl' });
  const clientId = (await admin.post('/api/clients', { name: 'Klant Ronde 8' })).data.id;
  await admin.put(`/api/projects/${A.projectId}/client`, { clientId });
  clientToken = (await admin.post(`/api/clients/${clientId}/links`, {})).data.url.split('/').pop();
});
after(() => srv.close());

test('freelancer met ingetrokken toegang: weg uit overzicht, zoeken, inbox, tellers, favorieten en media', async () => {
  // Klantfeedback geeft de freelancer een melding; de freelancer zet het project vast.
  const guest = client(srv.base);
  await guest.post(`/api/review/${A.token}/versions/${A.versionId}/comments`, { body: 'Logo groter', timecode: 1, authorName: 'Eva', requestId: rid() }, key);
  await guest.post(`/api/review/${A.token}/versions/${A.versionId}/feedback`, { authorName: 'Eva', requestId: rid() }, key);
  assert.ok((await fien.get('/api/inbox/count')).data.unread >= 1, 'melding vóór intrekken');
  assert.equal((await fien.put(`/api/pins/${A.projectId}`, { pinned: true })).status, 200);
  assert.equal((await fien.get('/api/freelance/search?q=Hoofd')).data.groups.videos.items.length, 1);

  // Toegang intrekken (ontkoppelen), niet verlopen.
  assert.equal((await admin.put(`/api/users/${fienId}/projects`, { projects: [] })).status, 200);
  const o = await fien.get('/api/freelance/overview');
  assert.ok(o.status >= 400 || o.data.projects.length === 0, 'overzicht leeg');
  assert.ok((await fien.get(`/api/freelance/projects/${A.projectId}`)).status >= 400, 'project');
  assert.ok((await fien.get(`/api/freelance/videos/${A.videoId}`)).status >= 400, 'video');
  assert.ok((await fien.get(`/api/freelance/versions/${A.versionId}/poster`)).status >= 400, 'thumbnail');
  assert.ok((await fien.get(`/api/freelance/versions/${A.versionId}/hls/master.m3u8`)).status >= 400, 'afspeellijst');
  assert.ok((await fien.get(`/api/freelance/projects/${A.projectId}/cover`)).status >= 400, 'omslag');
  const s = await fien.get('/api/freelance/search?q=Hoofd');
  assert.ok(s.status >= 400 || (s.data.groups.videos.items.length === 0 && s.data.groups.projects.items.length === 0), 'zoeken');
  assert.equal((await fien.get('/api/inbox/count')).data.unread, 0, 'teller');
  assert.equal((await fien.get('/api/inbox')).data.items.length, 0, 'inbox');
  assert.equal((await fien.put(`/api/pins/${A.projectId}`, { pinned: false })).status, 404, 'favoriet niet meer aan te raken');
  // Ook na opnieuw koppelen: geen verborgen extra rechten, wel weer alleen-lezen toegang.
  await admin.put(`/api/users/${fienId}/projects`, { projects: [{ projectId: A.projectId, role: 'freelancer' }] });
  assert.equal((await fien.post(`/api/versions/${A.versionId}/comments`, { body: 'x', timecode: 1 })).status, 403);
  assert.equal((await fien.get(`/api/versions/${A.versionId}/download`)).status, 403);
});

test('klantportaal: goedgekeurd en definitief vrijgegeven blijven gescheiden', async () => {
  const guest = client(srv.base);
  let v = (await guest.get(`/api/client/${clientToken}`)).data.projects[0].videos[0];
  assert.equal(v.released, null, 'nog niets vrijgegeven');
  const ap = (await admin.post(`/api/videos/${A.videoId}/links`, { role: 'approver' })).data.url.split('/').pop();
  assert.equal((await guest.post(`/api/review/${ap}/versions/${A.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key)).status, 200);
  v = (await guest.get(`/api/client/${clientToken}`)).data.projects[0].videos[0];
  assert.equal(v.version.status, 'approved');
  assert.equal(v.released, null, 'goedgekeurd is nog geen download');
  assert.equal((await guest.get(`/api/client/${clientToken}`)).data.projects[0].delivery, null);
  assert.equal((await admin.post(`/api/projects/${A.projectId}/deliveries`, { items: [{ versionId: A.versionId }], confirm: true, requestId: rid() })).status, 201);
  const p = (await guest.get(`/api/client/${clientToken}`)).data.projects[0];
  assert.deepEqual(p.videos[0].released, { versionNumber: 1 });
  assert.equal(p.delivery.count, 1);
});

test('onbekend adres: donkere foutpagina (HTML), API blijft JSON', async () => {
  const page = await fetch(`${srv.base}/bestaat-niet`, { headers: { accept: 'text/html' } });
  assert.equal(page.status, 404);
  const html = await page.text();
  assert.match(html, /<html lang="nl" data-theme="dark">/);
  assert.match(html, /Deze pagina bestaat niet/);
  assert.match(page.headers.get('content-security-policy') || '', /default-src/);
  const api = await admin.get('/api/bestaat-niet');
  assert.equal(api.status, 404);
  assert.equal(api.data.error, 'Niet gevonden');
  // Geen klantpagina in licht thema meer: elke pagina start donker.
  // Ook na herladen van een freelancerpagina (/account gaf voorheen een witte "Cannot GET").
  assert.equal((await fetch(`${srv.base}/account`)).status, 200);
  for (const url of [`/k/${clientToken}`, `/r/${A.token}`, '/login', '/account']) {
    const r = await (await fetch(`${srv.base}${url}`)).text();
    assert.match(r, /data-theme="dark"/, url);
    assert.match(r, /<meta name="color-scheme" content="dark">/, url);
  }
});
