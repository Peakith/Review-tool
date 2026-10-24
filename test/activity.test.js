'use strict';
// Bouwronde 4, deel B: klantactiviteit (waarneming, ontdubbeling, afscherming, opruimen).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeVideo, startServer, client, upload, rid, setupAdmin, addMember } = require('./helpers');
const { purgeOldActivity } = require('../server/activity');

let srv;
let admin;
let file;
const key = { 'x-reviewer-key': 'activiteit-key-0000001' };
const tokenOf = (url) => new URL(url).pathname.split('/').pop();
const rows = (projectId) => srv.db.prepare('SELECT * FROM client_activity WHERE project_id = ? ORDER BY id').all(projectId);

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  file = makeVideo(srv.dataDir, 'act.mp4', 2);
});
after(() => srv.close());

async function project(name) {
  const projectId = (await admin.post('/api/projects', { name })).data.id;
  const created = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title: `${name} film` })).data;
  await admin.post(`/api/versions/${created.versionId}/ready`);
  await admin.post(`/api/versions/${created.versionId}/share`, { requestId: rid() });
  await admin.patch(`/api/videos/${created.videoId}`, { approverName: 'Joris', approverEmail: 'joris@klant.nl' });
  const approver = tokenOf((await admin.post(`/api/videos/${created.videoId}/links`, { role: 'approver' })).data.url);
  const download = tokenOf((await admin.post(`/api/videos/${created.videoId}/links`, { role: 'reviewer', label: 'Marketing', allowDownload: true })).data.url);
  const v = (await admin.get(`/api/videos/${created.videoId}`)).data;
  const reviewer = tokenOf(v.links.find((l) => l.role === 'reviewer' && l.label === 'Reviewlink').url);
  return { projectId, videoId: created.videoId, versionId: created.versionId, approver, reviewer, download };
}
const play = (token, versionId, extra = {}) => client(srv.base).post(`/api/review/${token}/activity`, { type: 'playback_started', versionId, requestId: rid(), ...extra });

test('gebeurtenissen worden vastgelegd met video, exacte versie en bron; geen tokens of IP', async () => {
  const p = await project('Waarneming');
  const guest = client(srv.base);
  assert.equal((await guest.get(`/api/review/${p.reviewer}`)).status, 200);
  assert.equal((await play(p.reviewer, p.versionId, { visitorName: '  Eva   Jansen ' })).data.recorded, true);
  await client(srv.base).get(`/api/review/${p.approver}`);
  await play(p.approver, p.versionId, { visitorName: 'Iemand anders' });
  const portal = tokenOf((await admin.post(`/api/projects/${p.projectId}/portal-link`)).data.link.url);
  await client(srv.base).get(`/api/portal/${portal}`);
  const r = rows(p.projectId);
  assert.deepEqual(r.map((x) => x.type), ['review_opened', 'playback_started', 'review_opened', 'playback_started', 'portal_opened']);
  assert.equal(r[1].version_id, p.versionId);
  assert.equal(r[1].visitor_name, 'Eva Jansen');
  assert.equal(r[1].source_label, 'Via reviewlink');
  assert.equal(r[3].source_label, 'Via akkoordlink van Joris');
  assert.equal(r[3].visitor_name, null, 'bij een akkoordlink geen opgegeven naam');
  assert.equal(r[4].source, 'portal');
  // Geen tokens, IP-adressen of apparaatgegevens
  const cols = srv.db.prepare('PRAGMA table_info(client_activity)').all().map((c) => c.name);
  for (const bad of ['ip', 'user_agent', 'token', 'fingerprint']) assert.ok(!cols.includes(bad), bad);
  const dump = JSON.stringify(srv.db.prepare('SELECT * FROM client_activity').all());
  for (const t of [p.reviewer, p.approver, portal]) assert.ok(!dump.includes(t), 'geen token opgeslagen');
  assert.ok(!dump.includes('127.0.0.1'));
  // Overzicht voor het team
  const ov = (await admin.get(`/api/projects/${p.projectId}/activity`)).data;
  assert.equal(ov.items.length, 5);
  const playRow = ov.items.find((i) => i.type === 'playback_started' && i.visitorName);
  assert.equal(playRow.label, 'Afspelen gestart');
  assert.equal(playRow.visitorNameVerified, false);
  assert.equal(playRow.versionNumber, 1);
  assert.equal(playRow.video.title, 'Waarneming film');
  assert.equal((await admin.get(`/api/projects/${p.projectId}/activity?type=playback_started`)).data.items.length, 2);
  assert.equal((await admin.get(`/api/projects/${p.projectId}/activity?video=${p.videoId}`)).data.items.length, 4);
  assert.equal((await admin.get(`/api/projects/${p.projectId}/activity?type=bestaatniet`)).status, 400);
});

test('geen dubbele of technische schijngebeurtenissen; teamvoorbeeld en ingelogd team tellen niet', async () => {
  const p = await project('Ontdubbelen');
  const guest = client(srv.base);
  // Herhaald openen binnen het venster: één keer
  for (let i = 0; i < 3; i++) await guest.get(`/api/review/${p.reviewer}`);
  // Retry met dezelfde request-id: één keer; nieuw verzoek binnen venster: ook niet nog eens
  const requestId = rid();
  assert.equal((await play(p.reviewer, p.versionId, { requestId })).data.recorded, true);
  assert.equal((await play(p.reviewer, p.versionId, { requestId })).data.recorded, false);
  assert.equal((await play(p.reviewer, p.versionId)).data.recorded, false);
  // Thumbnail, mediadeelverzoeken en reacties ophalen tellen niet
  await guest.get(`/api/review/${p.reviewer}/versions/${p.versionId}/poster`);
  await guest.get(`/api/review/${p.reviewer}/versions/${p.versionId}/media`, { range: 'bytes=0-' });
  await guest.get(`/api/review/${p.reviewer}/versions/${p.versionId}/media`, { range: 'bytes=500-' });
  await guest.get(`/api/review/${p.reviewer}/versions/${p.versionId}/comments`, key);
  // Download: alleen het eerste verzoek, niet een vervolgdeel of HEAD
  const dl = `/api/review/${p.download}/versions/${p.versionId}/download`;
  await guest.get(dl, { range: 'bytes=1000-' });
  await fetch(srv.base + dl, { method: 'HEAD' });
  assert.equal(rows(p.projectId).filter((x) => x.type === 'download_requested').length, 0);
  await guest.get(dl);
  await guest.get(dl);
  assert.equal(rows(p.projectId).filter((x) => x.type === 'download_requested').length, 1);
  assert.deepEqual(rows(p.projectId).map((x) => x.type).sort(), ['download_requested', 'playback_started', 'review_opened']);
  // Teamvoorbeeld: niets. Een ingelogd teamlid dat de klantlink opent (eigen testbezoek): apart
  // gemarkeerd als teambezoek (bouwronde 5), niet als klantactiviteit.
  const clientRows = () => rows(p.projectId).filter((x) => !x.team);
  const n = clientRows().length;
  await admin.get(`/api/preview/videos/${p.videoId}`);
  await admin.get(`/api/projects/${p.projectId}/portal-preview`);
  assert.equal(rows(p.projectId).length, n, 'voorbeeldweergave registreert niets');
  await admin.get(`/api/review/${p.approver}`);
  const teamPlay = (await admin.post(`/api/review/${p.approver}/activity`, { type: 'playback_started', versionId: p.versionId, requestId: rid() })).data;
  assert.equal(teamPlay.recorded, true);
  assert.equal(clientRows().length, n, 'telt niet als klantactiviteit');
  assert.deepEqual(rows(p.projectId).filter((x) => x.team).map((x) => x.type), ['review_opened', 'playback_started']);
  const ov = (await admin.get(`/api/projects/${p.projectId}/activity`)).data;
  assert.equal(ov.items.some((i) => i.team), false, 'standaard verborgen');
  assert.equal(ov.teamVisits, 2);
  const withTeam = (await admin.get(`/api/projects/${p.projectId}/activity?team=1`)).data;
  assert.equal(withTeam.items.filter((i) => i.team).length, 2);
  assert.match(withTeam.items.find((i) => i.team).sourceLabel, /Ingelogd teamlid/);
  // Andere soorten via de client worden geweigerd
  assert.equal((await client(srv.base).post(`/api/review/${p.reviewer}/activity`, { type: 'download_requested', versionId: p.versionId })).status, 400);
});

test('afscherming: geen activiteit voor een ander project, niet-gedeelde versie of ingetrokken link; overzicht alleen voor bevoegden', async () => {
  const a = await project('Project A');
  const b = await project('Project B');
  // Versie van project B via een link van project A
  assert.equal((await play(a.reviewer, b.versionId)).status, 404);
  // Niet-gedeelde (interne) nieuwe versie
  const v2 = (await admin.post(`/api/videos/${a.videoId}/versions`, { uploadId: await upload(admin, file, { videoId: a.videoId }) })).data.versionId;
  assert.equal((await play(a.reviewer, v2)).status, 404);
  assert.equal((await play(a.reviewer, 'abc')).status, 404);
  // Ingetrokken link
  const linkId = srv.db.prepare('SELECT id FROM share_links WHERE token = ?').get(a.download).id;
  await admin.post(`/api/links/${linkId}/revoke`);
  assert.equal((await play(a.download, a.versionId)).status, 410);
  assert.equal(rows(b.projectId).length, 0, 'project B heeft geen activiteit gekregen');
  assert.equal(rows(a.projectId).length, 0);
  // Teamoverzicht: zonder toegang 404, alleen bekijken/uploaden 403, publiceren wel
  const outsider = await addMember(srv, admin, { email: 'act-buiten@agency.nl', projects: [{ projectId: b.projectId, level: 'manage' }] });
  const viewer = await addMember(srv, admin, { email: 'act-kijker@agency.nl', projects: [{ projectId: a.projectId, level: 'upload' }] });
  const publisher = await addMember(srv, admin, { email: 'act-publiceer@agency.nl', projects: [{ projectId: a.projectId, level: 'publish' }] });
  assert.equal((await outsider.client.get(`/api/projects/${a.projectId}/activity`)).status, 404);
  assert.equal((await viewer.client.get(`/api/projects/${a.projectId}/activity`)).status, 403);
  assert.equal((await publisher.client.get(`/api/projects/${a.projectId}/activity`)).status, 200);
  assert.equal((await client(srv.base).get(`/api/projects/${a.projectId}/activity`)).status, 401);
});

test('activiteit verandert nooit een status, taak of goedkeuring', async () => {
  const p = await project('Geen gevolgen');
  const before = srv.db.prepare('SELECT status FROM versions WHERE id = ?').get(p.versionId).status;
  const events = srv.db.prepare('SELECT COUNT(*) AS n FROM status_events').get().n;
  await client(srv.base).get(`/api/review/${p.approver}`);
  await play(p.approver, p.versionId);
  await client(srv.base).get(`/api/review/${p.download}/versions/${p.versionId}/download`);
  assert.equal(srv.db.prepare('SELECT status FROM versions WHERE id = ?').get(p.versionId).status, before);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM status_events').get().n, events);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM approvals WHERE version_id = ?').get(p.versionId).n, 0);
});

test('opruimen van oude activiteit zonder verlies van formele geschiedenis; instelbare bewaartermijn', async () => {
  const p = await project('Opruimen');
  // Formele geschiedenis: feedback, goedkeuring, statuscorrectie, oplevering
  const guest = client(srv.base);
  await guest.post(`/api/review/${p.reviewer}/versions/${p.versionId}/comments`, { body: 'Logo groter', timecode: 1, authorName: 'Eva', requestId: rid() }, key);
  await guest.post(`/api/review/${p.reviewer}/versions/${p.versionId}/feedback`, { authorName: 'Eva', requestId: rid() }, key);
  await admin.post(`/api/versions/${p.versionId}/status`, { status: 'in_review', note: 'Opnieuw ter review' });
  await client(srv.base).post(`/api/review/${p.approver}/versions/${p.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key);
  await admin.post(`/api/projects/${p.projectId}/deliveries`, { items: [{ versionId: p.versionId }], confirm: true, requestId: rid() });
  const delivery = tokenOf((await admin.post(`/api/projects/${p.projectId}/delivery-link`)).data.link.url);
  await client(srv.base).get(`/api/delivery/${delivery}`);
  await client(srv.base).get(`/api/review/${p.reviewer}`);
  const formal = () => ['comments', 'feedback_rounds', 'approvals', 'status_events', 'deliveries', 'delivery_links', 'share_links'].map((t) => srv.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  const before = formal();
  // Twee gebeurtenissen kunstmatig oud maken
  const ids = rows(p.projectId).map((r) => r.id);
  assert.ok(ids.length >= 2);
  srv.db.prepare('UPDATE client_activity SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 100 * 86_400_000).toISOString(), ids[0]);
  srv.db.prepare('UPDATE client_activity SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 40 * 86_400_000).toISOString(), ids[1]);
  assert.equal(purgeOldActivity(srv.db), 1, 'standaard 90 dagen');
  assert.deepEqual(formal(), before);
  // Termijn instellen (alleen beheerder, binnen grenzen); korter ruimt direct op
  const member = await addMember(srv, admin, { email: 'act-lid@agency.nl', projects: [{ projectId: p.projectId, level: 'manage' }] });
  assert.equal((await member.client.put('/api/settings/activity', { retentionDays: 30 })).status, 403);
  assert.equal((await admin.put('/api/settings/activity', { retentionDays: 3 })).status, 400);
  assert.equal((await admin.put('/api/settings/activity', { retentionDays: 'veel' })).status, 400);
  const set = await admin.put('/api/settings/activity', { retentionDays: 30 });
  assert.equal(set.status, 200);
  assert.equal(set.data.removed, 1);
  assert.equal((await admin.get('/api/settings/activity')).data.retentionDays, 30);
  assert.deepEqual(formal(), before);
  assert.equal((await admin.get(`/api/projects/${p.projectId}/activity`)).data.retentionDays, 30);
});

test('tijdlijn (bouwronde 5): formele feedback en goedkeuring uit hun eigen registratie, met bron en filters', async () => {
  const p = await project('Tijdlijn');
  const guest = client(srv.base);
  await guest.get(`/api/review/${p.reviewer}`);
  await guest.post(`/api/review/${p.reviewer}/versions/${p.versionId}/comments`, { body: 'Graag korter', timecode: 1, authorName: 'Eva', requestId: rid() }, key);
  await guest.post(`/api/review/${p.reviewer}/versions/${p.versionId}/feedback`, { authorName: 'Eva', requestId: rid() }, key);
  await admin.post(`/api/versions/${p.versionId}/status`, { status: 'in_review', note: 'Opnieuw' });
  await guest.post(`/api/review/${p.approver}/versions/${p.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key);
  const ov = (await admin.get(`/api/projects/${p.projectId}/activity`)).data;
  assert.deepEqual(ov.items.map((i) => i.type), ['approval_given', 'feedback_sent', 'review_opened']);
  const fb = ov.items[1];
  assert.equal(fb.label, 'Feedback verstuurd (formeel)');
  assert.equal(fb.sourceLabel, 'Via reviewlink');
  assert.equal(fb.visitorName, 'Eva');
  assert.equal(fb.visitorNameVerified, false);
  assert.equal(fb.detail, '1 reactie(s)');
  assert.equal(fb.href, `/video/${p.videoId}?v=${p.versionId}`);
  const ap = ov.items[0];
  assert.equal(ap.sourceLabel, 'Via akkoordlink van Joris');
  assert.equal(ap.visitorNameVerified, true);
  assert.equal(ap.versionNumber, 1);
  assert.equal(ov.counts.feedback_sent, 1);
  assert.equal(ov.counts.approval_given, 1);
  assert.deepEqual((await admin.get(`/api/projects/${p.projectId}/activity?type=approval_given`)).data.items.map((i) => i.type), ['approval_given']);
  assert.deepEqual((await admin.get(`/api/projects/${p.projectId}/activity?before=${encodeURIComponent(fb.at)}`)).data.items.map((i) => i.type), ['review_opened']);
  // Opruimen van passieve activiteit raakt formele acties niet
  purgeOldActivity(srv.db, { days: 7, at: Date.now() + 30 * 86_400_000 });
  assert.deepEqual((await admin.get(`/api/projects/${p.projectId}/activity`)).data.items.map((i) => i.type), ['approval_given', 'feedback_sent']);
});
