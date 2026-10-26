'use strict';
// Bouwronde 5, fase C: persoonlijke inbox. Gebeurtenissen, per-gebruiker gelezen-status, volgen,
// voorkeuren, geen dubbele meldingen bij herhaalpogingen en rechtencontrole bij maken, tonen en openen.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeVideo, startServer, client, upload, rid, setupAdmin, addMember } = require('./helpers');

let srv;
let admin;
let edith; // editor (upload) in project A
let fien; // freelancer (view) in project A, geen toegang tot B
let A;
let B;
const key = { 'x-reviewer-key': 'inbox-reviewer-key-0001' };
const tokenOf = (url) => new URL(url, 'http://x').pathname.split('/').pop();
const inbox = async (c, q = '') => (await c.get(`/api/inbox${q}`)).data;

async function project(name) {
  const id = (await admin.post('/api/projects', { name })).data.id;
  const file = makeVideo(srv.dataDir, `${name}.mp4`, 2);
  const v = (await admin.post(`/api/projects/${id}/videos`, { uploadId: await upload(admin, file, { projectId: id }), title: `Film ${name}` })).data;
  await admin.post(`/api/versions/${v.versionId}/ready`);
  await admin.post(`/api/versions/${v.versionId}/share`, { requestId: rid() });
  await admin.patch(`/api/videos/${v.videoId}`, { approverName: 'Joris', approverEmail: 'joris@klant.nl' });
  const token = tokenOf((await admin.get(`/api/videos/${v.videoId}`)).data.links.find((l) => l.role === 'reviewer').url);
  return { id, ...v, token };
}

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  A = await project('A');
  B = await project('B');
  edith = await addMember(srv, admin, { email: 'edith@studio.nl', name: 'Edith Editor', projects: [{ projectId: A.id, level: 'upload' }] });
  fien = await addMember(srv, admin, { email: 'fien@studio.nl', name: 'Fien Freelancer', projects: [{ projectId: A.id, level: 'view' }] });
});
after(() => srv.close());

test('project volgen: wie het project maakt volgt het automatisch; anderen kiezen zelf', async () => {
  assert.equal((await admin.get(`/api/follows/project/${A.id}`)).data.following, true);
  assert.equal((await edith.client.get(`/api/follows/project/${A.id}`)).data.following, false);
  assert.equal((await edith.client.put(`/api/follows/project/${A.id}`, { follow: true })).data.following, true);
  assert.equal((await fien.client.get(`/api/follows/project/${B.id}`)).status, 404, 'geen toegang tot B');
});

test('klantfeedback en goedkeuring: melding voor volgers, één keer, ook bij herhaalpoging', async () => {
  const guest = client(srv.base);
  await guest.post(`/api/review/${A.token}/versions/${A.versionId}/comments`, { body: 'Logo groter', timecode: 1, authorName: 'Eva', requestId: rid() }, key);
  const id = rid();
  assert.equal((await guest.post(`/api/review/${A.token}/versions/${A.versionId}/feedback`, { authorName: 'Eva', requestId: id }, key)).status, 200);
  assert.equal((await guest.post(`/api/review/${A.token}/versions/${A.versionId}/feedback`, { authorName: 'Eva', requestId: id }, key)).data.replayed, true);
  const e = await inbox(edith.client);
  const fb = e.items.filter((n) => n.type === 'feedback');
  assert.equal(fb.length, 1, 'geen dubbele melding bij een herhaald verzoek');
  assert.match(fb[0].title, /Eva stuurde feedback op Film A \(versie 1\)/);
  assert.equal(fb[0].href, `/video/${A.videoId}?v=${A.versionId}`);
  assert.equal((await inbox(admin)).items.filter((n) => n.type === 'feedback').length, 1);
  assert.equal((await inbox(fien.client)).items.length, 0, 'Fien volgt het project niet');
  // Goedkeuring
  await admin.post(`/api/versions/${A.versionId}/status`, { status: 'in_review', note: 'Opnieuw open' });
  const approver = tokenOf((await admin.post(`/api/videos/${A.videoId}/links`, { role: 'approver' })).data.url);
  const aid = rid();
  await guest.post(`/api/review/${approver}/versions/${A.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: aid }, key);
  await guest.post(`/api/review/${approver}/versions/${A.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: aid }, key);
  const ap = (await inbox(edith.client)).items.filter((n) => n.type === 'approval');
  assert.equal(ap.length, 1);
  assert.match(ap[0].title, /Joris keurde Film A versie 1 goed/);
  // Goedkeuring ingetrokken door de beheerder: Edith krijgt melding, de beheerder zelf niet
  await admin.post(`/api/versions/${A.versionId}/status`, { status: 'changes_requested', note: 'Muziek moet anders' });
  assert.equal((await inbox(edith.client)).items.filter((n) => n.type === 'approval_revoked').length, 1);
  assert.equal((await inbox(admin)).items.filter((n) => n.type === 'approval_revoked').length, 0, 'geen melding over je eigen actie');
});

test('taak toegewezen, @vermelding en antwoord in een gevolgd gesprek', async () => {
  const guest = client(srv.base);
  const cid = (await guest.post(`/api/review/${A.token}/versions/${A.versionId}/comments`, { body: 'Kleur iets warmer', timecode: 2, authorName: 'Eva', requestId: rid() }, key)).data.id;
  const t = await admin.post(`/api/comments/${cid}/task`, { assigneeId: edith.id });
  assert.equal(t.status, 201);
  assert.equal((await admin.post(`/api/comments/${cid}/task`, { assigneeId: edith.id })).status, 200, 'tweede keer: bestaande taak');
  let e = await inbox(edith.client);
  const tasks = e.items.filter((n) => n.type === 'task_assigned');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].href, `/video/${A.videoId}?v=${A.versionId}&c=${cid}`);
  // Vermelding (op naam en op e-mailnaam), niet voor wie geen toegang heeft
  await admin.post(`/api/versions/${A.versionId}/comments`, { body: 'Kunnen @Edith Editor en @fien hiernaar kijken?', parentId: cid });
  e = await inbox(edith.client);
  assert.equal(e.items.filter((n) => n.type === 'mention').length, 1);
  assert.equal(e.items.filter((n) => n.type === 'reply').length, 0, 'geen dubbele melding (vermelding gaat voor)');
  assert.equal((await inbox(fien.client)).items.filter((n) => n.type === 'mention').length, 1);
  await admin.post(`/api/versions/${B.versionId}/comments`, { body: 'Hé @fien' });
  assert.equal((await inbox(fien.client)).items.filter((n) => n.type === 'mention').length, 1, 'Fien heeft geen toegang tot B: geen melding');
  // Antwoord van de klant in het gesprek: Edith (taak) en beheerder (schreef erin) krijgen het
  await guest.post(`/api/review/${A.token}/versions/${A.versionId}/comments`, { body: 'Ja graag', parentId: cid, authorName: 'Eva', requestId: rid() }, key);
  assert.equal((await inbox(edith.client)).items.filter((n) => n.type === 'reply').length, 1);
  assert.equal((await inbox(admin)).items.filter((n) => n.type === 'reply').length, 1);
  // Gesprek niet meer volgen
  assert.equal((await admin.put(`/api/follows/comment/${cid}`, { follow: false })).data.following, false);
  await guest.post(`/api/review/${A.token}/versions/${A.versionId}/comments`, { body: 'Nog iets', parentId: cid, authorName: 'Eva', requestId: rid() }, key);
  assert.equal((await inbox(admin)).items.filter((n) => n.type === 'reply').length, 1, 'geen nieuwe melding na ontvolgen');
  assert.equal((await inbox(edith.client)).items.filter((n) => n.type === 'reply').length, 2);
});

test('gelezen/ongelezen per gebruiker, openen, alles gelezen', async () => {
  const e = await inbox(edith.client);
  const before_ = (await inbox(admin)).unread;
  const first = e.items[0];
  const opened = await edith.client.post(`/api/inbox/${first.id}/open`);
  assert.equal(opened.status, 200);
  assert.equal(opened.data.href, first.href);
  assert.equal((await inbox(edith.client)).unread, e.unread - 1);
  assert.equal((await inbox(admin)).unread, before_, 'gelezen geldt alleen voor Edith');
  await edith.client.post(`/api/inbox/${first.id}/read`, { read: false });
  assert.equal((await inbox(edith.client)).unread, e.unread);
  assert.equal((await edith.client.get('/api/inbox/count')).data.unread, e.unread);
  assert.equal((await inbox(edith.client, '?filter=unread')).items.length, e.unread);
  assert.equal((await admin.post(`/api/inbox/${first.id}/open`)).status, 404, 'meldingen van een ander zijn niet te openen');
  await edith.client.post('/api/inbox/read-all');
  assert.equal((await inbox(edith.client)).unread, 0);
});

test('voorkeuren: soort uitzetten = geen nieuwe meldingen van die soort', async () => {
  const prefs = (await edith.client.get('/api/inbox/preferences')).data.preferences;
  assert.ok(prefs.every((p) => p.on));
  assert.equal((await edith.client.put('/api/inbox/preferences', { feedback: false })).status, 200);
  assert.equal((await edith.client.put('/api/inbox/preferences', { onbekend: true })).status, 400);
  const guest = client(srv.base);
  await admin.post(`/api/versions/${A.versionId}/status`, { status: 'in_review', note: 'Opnieuw open' });
  await guest.post(`/api/review/${A.token}/versions/${A.versionId}/comments`, { body: 'Nog een punt', timecode: 1, authorName: 'Eva', requestId: rid() }, key);
  await guest.post(`/api/review/${A.token}/versions/${A.versionId}/feedback`, { authorName: 'Eva', requestId: rid() }, key);
  assert.equal((await inbox(edith.client)).items.filter((n) => n.type === 'feedback').length, 1, 'geen nieuwe feedbackmelding');
  assert.equal((await inbox(admin)).items.filter((n) => n.type === 'feedback').length, 2);
  // Andere voorkeuren opslaan raakt de meldingsvoorkeuren niet
  await edith.client.put('/api/me/preferences', { dashboard: { widgets: [{ id: 'inbox' }] } });
  assert.equal((await edith.client.get('/api/inbox/preferences')).data.preferences.find((p) => p.key === 'feedback').on, false);
});

test('toegang kwijt: meldingen verdwijnen uit de inbox en zijn niet meer te openen', async () => {
  const e = await inbox(edith.client);
  assert.ok(e.items.length > 0);
  const anyId = e.items[0].id;
  await admin.put(`/api/users/${edith.id}/projects`, { projects: [] });
  const after_ = await inbox(edith.client);
  assert.equal(after_.items.length, 0);
  assert.equal(after_.unread, 0);
  assert.equal((await edith.client.get('/api/inbox/count')).data.unread, 0);
  assert.equal(JSON.stringify(after_).includes('Film A'), false, 'geen inhoud meer zichtbaar');
  assert.equal((await edith.client.post(`/api/inbox/${anyId}/open`)).status, 404);
  // Toegang terug: de meldingen zijn er weer
  await admin.put(`/api/users/${edith.id}/projects`, { projects: [{ projectId: A.id, level: 'upload' }] });
  assert.ok((await inbox(edith.client)).items.length > 0);
});

test('oplevering vrijgeven en terugnemen: melding voor volgers', async () => {
  const guest = client(srv.base);
  await admin.post(`/api/versions/${B.versionId}/status`, { status: 'in_review', note: 'x' }).catch(() => {});
  const approver = tokenOf((await admin.post(`/api/videos/${B.videoId}/links`, { role: 'approver' })).data.url);
  await guest.post(`/api/review/${approver}/versions/${B.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key);
  const mgr = await addMember(srv, admin, { email: 'mgr@studio.nl', name: 'Max Manager', projects: [{ projectId: B.id, level: 'publish' }] });
  await mgr.client.put(`/api/follows/project/${B.id}`, { follow: true });
  const r = await admin.post(`/api/projects/${B.id}/deliveries`, { items: [{ versionId: B.versionId }], confirm: true, requestId: rid() });
  assert.equal(r.status, 201);
  const m = await inbox(mgr.client);
  const d = m.items.filter((n) => n.type === 'delivery');
  assert.equal(d.length, 1);
  assert.equal(d[0].href, `/projecten/${B.id}/oplevering`);
  await admin.post(`/api/deliveries/${r.data.released[0]}/withdraw`, { confirm: true, reason: 'Verkeerde mix' });
  assert.equal((await inbox(mgr.client)).items.filter((n) => n.type === 'delivery').length, 2);
});
