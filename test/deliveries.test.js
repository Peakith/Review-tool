'use strict';
// Bouwronde 4, deel A: definitieve opleveringen (vrijgeven, vervangen, terugnemen, links en toegang).
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeVideo, startServer, client, upload, rid, setupAdmin, addMember } = require('./helpers');
const { createBackup, restoreBackup } = require('../server/backup');

let srv;
let admin;
let file;
let file2;
const key = { 'x-reviewer-key': 'oplever-reviewer-key-01' };
const tokenOf = (url) => new URL(url).pathname.split('/').pop();

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  file = makeVideo(srv.dataDir, 'eind.mp4', 2);
  file2 = makeVideo(srv.dataDir, 'eind2.mp4', 3);
});
after(() => srv.close());

/** Project met video (v1 gedeeld) en akkoordgever met akkoordlink. */
async function project(name = 'Oplevering') {
  const projectId = (await admin.post('/api/projects', { name, clientName: 'Klant BV' })).data.id;
  const created = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title: 'Hoofdfilm' })).data;
  await admin.post(`/api/versions/${created.versionId}/ready`);
  await admin.post(`/api/versions/${created.versionId}/share`, { requestId: rid() });
  await admin.patch(`/api/videos/${created.videoId}`, { approverName: 'Joris', approverEmail: 'joris@klant.nl' });
  const approver = tokenOf((await admin.post(`/api/videos/${created.videoId}/links`, { role: 'approver' })).data.url);
  const v = (await admin.get(`/api/videos/${created.videoId}`)).data;
  const reviewer = tokenOf(v.links.find((l) => l.role === 'reviewer').url);
  return { projectId, videoId: created.videoId, v1: created.versionId, approver, reviewer };
}
const approve = (token, versionId, number) => client(srv.base).post(`/api/review/${token}/versions/${versionId}/approve`, { confirm: true, versionNumber: number, requestId: rid() }, key);
const release = (c, projectId, items, extra = {}) => c.post(`/api/projects/${projectId}/deliveries`, { items, confirm: true, requestId: rid(), ...extra });
async function newVersion(p, f = file2) {
  const r = (await admin.post(`/api/videos/${p.videoId}/versions`, { uploadId: await upload(admin, f, { videoId: p.videoId }) })).data;
  return r.versionId;
}
async function deliveryLink(projectId) {
  return tokenOf((await admin.post(`/api/projects/${projectId}/delivery-link`)).data.link.url);
}

test('goedgekeurde versie bewust vrijgeven; downloadnaam en inhoud kloppen; herhaald verzoek telt één keer', async () => {
  const p = await project();
  assert.equal((await approve(p.approver, p.v1, 1)).status, 200);
  const cand = (await admin.get(`/api/projects/${p.projectId}/delivery-candidates`)).data.videos[0];
  assert.equal(cand.versions[0].eligible, true);
  assert.equal(cand.versions[0].approval.name, 'Joris');
  assert.equal(cand.versions[0].file.filename, 'eind.mp4', 'oorspronkelijke uploadnaam (bouwronde 5)');

  assert.equal((await admin.post(`/api/projects/${p.projectId}/deliveries`, { items: [{ versionId: p.v1 }], requestId: rid() })).status, 400, 'zonder bevestiging');
  const requestId = rid();
  const r = await release(admin, p.projectId, [{ versionId: p.v1 }], { requestId });
  assert.equal(r.status, 201);
  assert.equal(r.data.released.length, 1);
  const again = await release(admin, p.projectId, [{ versionId: p.v1 }], { requestId });
  assert.equal(again.status, 200);
  assert.equal(again.data.replayed, true);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM deliveries WHERE project_id = ?').get(p.projectId).n, 1);
  // Nogmaals vrijgeven (nieuw verzoek) van dezelfde, beschikbare versie: niets verandert.
  const same = await release(admin, p.projectId, [{ versionId: p.v1 }]);
  assert.deepEqual([same.data.released.length, same.data.unchanged.length], [0, 1]);

  const token = await deliveryLink(p.projectId);
  const page = await client(srv.base).get(`/api/delivery/${token}`);
  assert.equal(page.status, 200);
  assert.equal(page.data.items.length, 1);
  const item = page.data.items[0];
  assert.equal(item.title, 'Hoofdfilm');
  assert.equal(item.versionNumber, 1);
  assert.equal(item.format, 'MP4');
  assert.equal(item.size, fs.statSync(file).size);
  assert.ok(item.releasedAt && item.available && item.posterUrl);
  const dl = await client(srv.base).get(item.downloadUrl);
  assert.equal(dl.status, 200);
  assert.ok(Buffer.compare(dl.data, fs.readFileSync(file)) === 0, 'identieke inhoud');
  assert.match(dl.headers.get('content-disposition'), /filename\*=UTF-8''eind\.mp4$/);
  assert.equal(dl.headers.get('content-type'), 'video/mp4');
  // Grote bestanden: gestreamd met Range-ondersteuning (niet in één keer in het geheugen).
  const part = await client(srv.base).get(item.downloadUrl, { range: 'bytes=0-99' });
  assert.equal(part.status, 206);
  assert.equal(part.data.length, 100);
  // Het overzicht voor het team noemt geen nieuwere versie.
  const team = (await admin.get(`/api/projects/${p.projectId}/deliveries`)).data;
  assert.equal(team.active.length, 1);
  assert.equal(team.active[0].newer.internal, null);
  assert.equal((await admin.get(`/api/videos/${p.videoId}`)).data.delivery.versionNumber, 1);
});

test('weigeren: zonder recht, zonder klantgoedkeuring, handmatig label, ander project', async () => {
  const p = await project('Weigeren');
  const other = await project('Ander project');
  const viewer = await addMember(srv, admin, { email: 'kijker@agency.nl', projects: [{ projectId: p.projectId, level: 'view' }] });
  const uploader = await addMember(srv, admin, { email: 'uploader@agency.nl', projects: [{ projectId: p.projectId, level: 'upload' }] });
  const outsider = await addMember(srv, admin, { email: 'buiten@agency.nl', projects: [] });
  await approve(p.approver, p.v1, 1);
  assert.equal((await release(viewer.client, p.projectId, [{ versionId: p.v1 }])).status, 403);
  assert.equal((await release(uploader.client, p.projectId, [{ versionId: p.v1 }])).status, 403);
  assert.equal((await release(outsider.client, p.projectId, [{ versionId: p.v1 }])).status, 404);
  assert.equal((await outsider.client.get(`/api/projects/${p.projectId}/deliveries`)).status, 404);
  assert.equal((await viewer.client.get(`/api/projects/${p.projectId}/delivery-candidates`)).status, 403);
  // De teamlid met alleen bekijken ziet het overzicht wel, maar niet de opleverlink.
  await deliveryLink(p.projectId);
  const seen = (await viewer.client.get(`/api/projects/${p.projectId}/deliveries`)).data;
  assert.equal(seen.link, null);
  assert.equal(seen.linkActive, true);

  // Niet goedgekeurd (in review)
  const r1 = await release(admin, other.projectId, [{ versionId: other.v1 }]);
  assert.equal(r1.status, 409);
  assert.match(r1.data.error, /Nog niet goedgekeurd/);
  // Handmatig op Goedgekeurd zonder klantgoedkeuring
  await admin.post(`/api/versions/${other.v1}/status`, { status: 'approved', note: 'Telefonisch akkoord' });
  const r2 = await release(admin, other.projectId, [{ versionId: other.v1 }]);
  assert.equal(r2.status, 409);
  assert.match(r2.data.error, /statuslabel vervangt geen klantgoedkeuring/);
  const cand = (await admin.get(`/api/projects/${other.projectId}/delivery-candidates`)).data.videos[0].versions[0];
  assert.equal(cand.eligible, false);
  // Versie van een ander project via dit project
  const r3 = await release(admin, p.projectId, [{ versionId: other.v1 }]);
  assert.equal(r3.status, 409);
  assert.match(r3.data.error, /hoort niet bij dit project/);
  // Eén fout in een selectie: niets vrijgegeven
  const r4 = await release(admin, p.projectId, [{ versionId: p.v1 }, { versionId: other.v1 }]);
  assert.equal(r4.status, 409);
  assert.equal(r4.data.details.length, 1);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM deliveries WHERE project_id = ?').get(p.projectId).n, 0);
});

test('nieuwe conceptversie: oud eindbestand blijft beschikbaar; team ziet nieuwere versies', async () => {
  const p = await project('Nieuwe versie');
  await approve(p.approver, p.v1, 1);
  await release(admin, p.projectId, [{ versionId: p.v1 }]);
  const token = await deliveryLink(p.projectId);
  const v2 = await newVersion(p);
  let team = (await admin.get(`/api/projects/${p.projectId}/deliveries`)).data.active[0];
  assert.equal(team.versionNumber, 1);
  assert.deepEqual(team.newer.internal, { number: 2, status: 'concept', statusLabel: 'Concept' });
  assert.equal(team.newer.published, null);
  const page = (await client(srv.base).get(`/api/delivery/${token}`)).data;
  assert.equal(page.items[0].versionNumber, 1);
  assert.equal((await client(srv.base).get(page.items[0].downloadUrl)).status, 200);
  // Gepubliceerde nieuwere versie: zichtbaar voor het team, oplevering ongewijzigd.
  await admin.post(`/api/versions/${v2}/ready`);
  await admin.post(`/api/versions/${v2}/share`, { requestId: rid() });
  team = (await admin.get(`/api/projects/${p.projectId}/deliveries`)).data.active[0];
  assert.equal(team.newer.published.number, 2);
  assert.equal(team.available, true);
  const dl = await client(srv.base).get((await client(srv.base).get(`/api/delivery/${token}`)).data.items[0].downloadUrl);
  assert.ok(Buffer.compare(dl.data, fs.readFileSync(file)) === 0, 'nog steeds het oude eindbestand');
});

test('eindbestand bewust vervangen; oude oplevering niet meer te downloaden; geschiedenis', async () => {
  const p = await project('Vervangen');
  await approve(p.approver, p.v1, 1);
  const first = (await release(admin, p.projectId, [{ versionId: p.v1 }])).data.released[0];
  const token = await deliveryLink(p.projectId);
  const oldUrl = (await client(srv.base).get(`/api/delivery/${token}`)).data.items[0].downloadUrl;
  const v2 = await newVersion(p);
  await admin.post(`/api/versions/${v2}/ready`);
  await admin.post(`/api/versions/${v2}/share`, { requestId: rid() });
  // Nog niet goedgekeurd: kan niet vervangen
  assert.equal((await release(admin, p.projectId, [{ versionId: v2, replace: true }])).status, 409);
  await approve(p.approver, v2, 2);
  const noConfirm = await release(admin, p.projectId, [{ versionId: v2 }]);
  assert.equal(noConfirm.status, 409);
  assert.equal(noConfirm.data.details[0].needsReplace, true);
  const r = await release(admin, p.projectId, [{ versionId: v2, replace: true }]);
  assert.equal(r.status, 201);
  const page = (await client(srv.base).get(`/api/delivery/${token}`)).data;
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].versionNumber, 2);
  assert.equal((await client(srv.base).get(oldUrl)).status, 404, 'oude oplevering');
  const dl = await client(srv.base).get(page.items[0].downloadUrl);
  assert.ok(Buffer.compare(dl.data, fs.readFileSync(file2)) === 0);
  assert.match(dl.headers.get('content-disposition'), /filename\*=UTF-8''eind2\.mp4$/);
  const hist = (await admin.get(`/api/projects/${p.projectId}/deliveries`)).data.history;
  const old = hist.find((d) => d.id === first);
  assert.equal(old.withdrawnReason, 'Vervangen door versie 2');
  assert.equal(old.replacedByNumber, 2);
  assert.equal(old.withdrawnBy, 'Beheer');
});

test('goedkeuring ingetrokken (statuscorrectie): downloads geblokkeerd tot nieuwe goedkeuring én nieuwe vrijgave', async () => {
  const p = await project('Ingetrokken');
  await approve(p.approver, p.v1, 1);
  await release(admin, p.projectId, [{ versionId: p.v1 }]);
  const token = await deliveryLink(p.projectId);
  const url = (await client(srv.base).get(`/api/delivery/${token}`)).data.items[0].downloadUrl;
  await admin.post(`/api/versions/${p.v1}/status`, { status: 'changes_requested', note: 'Klant trekt akkoord in: logo fout' });
  let page = (await client(srv.base).get(`/api/delivery/${token}`)).data.items[0];
  assert.equal(page.available, false);
  assert.equal(page.downloadUrl, null);
  assert.equal((await client(srv.base).get(url)).status, 410);
  const team = (await admin.get(`/api/projects/${p.projectId}/deliveries`)).data.active[0];
  assert.equal(team.reason, 'approval_revoked');
  // Handmatig terug op Goedgekeurd: herstelt niets
  await admin.post(`/api/versions/${p.v1}/status`, { status: 'approved', note: 'Per ongeluk' });
  assert.equal((await client(srv.base).get(url)).status, 410);
  const refused = await release(admin, p.projectId, [{ versionId: p.v1 }]);
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /ingetrokken/);
  // Opnieuw open voor review, akkoordgever keurt opnieuw goed: nog steeds geblokkeerd tot nieuwe vrijgave
  await admin.post(`/api/versions/${p.v1}/status`, { status: 'in_review', note: 'Opnieuw ter goedkeuring' });
  assert.equal((await approve(p.approver, p.v1, 1)).status, 200);
  assert.equal((await client(srv.base).get(url)).status, 410, 'nieuwe goedkeuring alleen is niet genoeg');
  const again = await release(admin, p.projectId, [{ versionId: p.v1 }]);
  assert.equal(again.status, 201);
  page = (await client(srv.base).get(`/api/delivery/${token}`)).data.items[0];
  assert.equal(page.available, true);
  assert.equal((await client(srv.base).get(page.downloadUrl)).status, 200);
  const hist = (await admin.get(`/api/projects/${p.projectId}/deliveries`)).data.history;
  assert.ok(hist.some((d) => d.withdrawnReason === 'Opnieuw vrijgegeven na een nieuwe goedkeuring'));
});

test('vrijgave terugnemen: met reden en bevestiging; downloads stoppen; geschiedenis blijft', async () => {
  const p = await project('Terugnemen');
  await approve(p.approver, p.v1, 1);
  const id = (await release(admin, p.projectId, [{ versionId: p.v1 }])).data.released[0];
  const token = await deliveryLink(p.projectId);
  const url = (await client(srv.base).get(`/api/delivery/${token}`)).data.items[0].downloadUrl;
  assert.equal((await admin.post(`/api/deliveries/${id}/withdraw`, { confirm: true })).status, 400, 'zonder reden');
  assert.equal((await admin.post(`/api/deliveries/${id}/withdraw`, { reason: 'Verkeerde mix' })).status, 400, 'zonder bevestiging');
  const viewer = await addMember(srv, admin, { email: 'kijker2@agency.nl', projects: [{ projectId: p.projectId, level: 'view' }] });
  assert.equal((await viewer.client.post(`/api/deliveries/${id}/withdraw`, { confirm: true, reason: 'x' })).status, 403);
  assert.equal((await admin.post(`/api/deliveries/${id}/withdraw`, { confirm: true, reason: 'Verkeerde mix' })).status, 200);
  assert.equal((await client(srv.base).get(`/api/delivery/${token}`)).data.items.length, 0);
  assert.equal((await client(srv.base).get(url)).status, 404);
  const hist = (await admin.get(`/api/projects/${p.projectId}/deliveries`)).data.history[0];
  assert.equal(hist.withdrawnReason, 'Verkeerde mix');
  // De goedkeuring en statusgeschiedenis zijn onaangeroerd
  const v = (await admin.get(`/api/videos/${p.videoId}`)).data.versions[0];
  assert.equal(v.status, 'approved');
  assert.equal(v.approval.name, 'Joris');
});

test('opleverlink intrekken en vervangen, ook voor directe downloadverzoeken; andere links', async () => {
  const p = await project('Links');
  const other = await project('Ander');
  await approve(p.approver, p.v1, 1);
  await approve(other.approver, other.v1, 1);
  const pid = (await release(admin, p.projectId, [{ versionId: p.v1 }])).data.released[0];
  const oid = (await release(admin, other.projectId, [{ versionId: other.v1 }])).data.released[0];
  const first = await deliveryLink(p.projectId);
  assert.equal(await deliveryLink(p.projectId), first, 'zonder vervangen blijft de link gelijk');
  const page = (await client(srv.base).get(`/api/delivery/${first}`)).data;
  const url = page.items[0].downloadUrl;
  const poster = page.items[0].posterUrl;
  // Alleen opleveringen van dit project; geen andere bronnen via deze link.
  assert.equal((await client(srv.base).get(`/api/delivery/${first}/files/${oid}/download`)).status, 404, 'ander project');
  assert.equal((await client(srv.base).get(`/api/review/${first}`)).status, 404, 'opleverlink is geen reviewlink');
  assert.equal((await client(srv.base).get(`/api/portal/${first}`)).status, 404, 'opleverlink is geen projectlink');
  assert.equal((await client(srv.base).get(`/api/review/${first}/versions/${p.v1}/media`)).status, 404);
  assert.ok([401, 404].includes((await client(srv.base).get(`/api/delivery/${first}/export.pdf`)).status), 'geen feedbackexport');
  // Interne concepten: een nieuwe interne versie is niet bereikbaar
  const v2 = await newVersion(p);
  const internalDelivery = srv.db.prepare('SELECT MAX(id) AS n FROM deliveries').get().n + 1;
  assert.equal((await client(srv.base).get(`/api/delivery/${first}/files/${internalDelivery}/download`)).status, 404);
  assert.ok(!JSON.stringify((await client(srv.base).get(`/api/delivery/${first}`)).data).includes(`"versionNumber":2`), String(v2));

  const replaced = await admin.post(`/api/projects/${p.projectId}/delivery-link`, { replace: true });
  assert.equal(replaced.data.replaced, true);
  const second = tokenOf(replaced.data.link.url);
  assert.equal((await client(srv.base).get(`/api/delivery/${first}`)).status, 410);
  assert.equal((await client(srv.base).get(url)).status, 410, 'directe download via oude link');
  assert.equal((await client(srv.base).get(poster)).status, 410);
  assert.equal((await client(srv.base).get(`/api/delivery/${second}`)).status, 200);
  await admin.post(`/api/projects/${p.projectId}/delivery-link/revoke`);
  assert.equal((await client(srv.base).get(`/api/delivery/${second}/files/${pid}/download`)).status, 410);

  // Klantportaal: toont de opleverpagina ook, volgens zijn eigen rechten
  const portal = tokenOf((await admin.post(`/api/projects/${p.projectId}/portal-link`)).data.link.url);
  const pd = await client(srv.base).get(`/api/portal/${portal}`);
  assert.deepEqual(pd.data.delivery, { count: 1, url: `/p/${portal}/oplevering` });
  const viaPortal = (await client(srv.base).get(`/api/portal/${portal}/delivery`)).data;
  assert.equal(viaPortal.items.length, 1);
  assert.equal((await client(srv.base).get(viaPortal.items[0].downloadUrl)).status, 200);
  assert.equal((await client(srv.base).get(`/api/portal/${portal}/delivery/${oid}/download`)).status, 404);
  const team = (await admin.get(`/api/projects/${p.projectId}/deliveries`)).data;
  assert.equal(team.otherAccess.portalLinkActive, true);
  assert.equal(team.linkActive, false);
  assert.equal(team.linkHistory.length, 2);
  await admin.post(`/api/projects/${p.projectId}/portal-link/revoke`);
  assert.equal((await client(srv.base).get(viaPortal.items[0].downloadUrl)).status, 410);
  // Reviewlink zonder download geeft geen download; de akkoordlink ook niet
  assert.equal((await client(srv.base).get(`/api/review/${p.reviewer}/versions/${p.v1}/download`)).status, 403);
  assert.equal((await client(srv.base).get(`/api/review/${p.approver}/versions/${p.v1}/download`)).status, 403);
});

test('archief, prullenbak, herstel en definitief-verwijderen-overzicht', async () => {
  const p = await project('Prullenbak');
  await approve(p.approver, p.v1, 1);
  const id = (await release(admin, p.projectId, [{ versionId: p.v1 }])).data.released[0];
  const token = await deliveryLink(p.projectId);
  const url = (await client(srv.base).get(`/api/delivery/${token}`)).data.items[0].downloadUrl;
  // Archief: bestanden blijven te downloaden, nieuwe vrijgave niet mogelijk
  await admin.post(`/api/projects/${p.projectId}/archive`);
  const arch = (await client(srv.base).get(`/api/delivery/${token}`)).data;
  assert.equal(arch.archived, true);
  assert.equal((await client(srv.base).get(url)).status, 200);
  assert.equal((await release(admin, p.projectId, [{ versionId: p.v1 }])).status, 409);
  await admin.post(`/api/projects/${p.projectId}/archive`, { archived: false });
  // Video in de prullenbak: verdwijnt van de pagina, download geblokkeerd; terugzetten brengt hem terug
  await admin.del(`/api/videos/${p.videoId}`);
  assert.equal((await client(srv.base).get(`/api/delivery/${token}`)).data.items.length, 0);
  assert.notEqual((await client(srv.base).get(url)).status, 200);
  await admin.post('/api/trash/restore', { type: 'video', id: p.videoId });
  assert.equal((await client(srv.base).get(url)).status, 200);
  // Project in de prullenbak: link werkt niet; na terugzetten weer wel
  await admin.del(`/api/projects/${p.projectId}`);
  assert.equal((await client(srv.base).get(`/api/delivery/${token}`)).status, 410);
  assert.equal((await client(srv.base).get(url)).status, 410);
  // Intrekken kan ook in de prullenbak; terugzetten activeert de ingetrokken link niet opnieuw
  assert.equal((await admin.post(`/api/projects/${p.projectId}/delivery-link/revoke`)).status, 200);
  await admin.post('/api/trash/restore', { type: 'project', id: p.projectId });
  assert.equal((await client(srv.base).get(`/api/delivery/${token}`)).status, 410);
  // Definitief verwijderen: het overzicht waarschuwt voor de oplevering
  const v2 = await newVersion(p);
  assert.ok(v2);
  await admin.del(`/api/versions/${p.v1}`);
  const preview = (await admin.get(`/api/trash/version/${p.v1}/purge-preview`)).data;
  assert.equal(preview.deliveries.length, 1);
  assert.equal(preview.deliveries[0].active, true);
  assert.ok(preview.files.find((f) => f.kind === 'video').inDelivery);
  const purge = await admin.post(`/api/trash/version/${p.v1}/purge`, { confirm: true, expectedFiles: preview.fileCount });
  assert.equal(purge.status, 200);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM deliveries WHERE id = ?').get(id).n, 0);
});

test('back-up en herstel nemen opleveringen, opleverlinks en activiteit mee', async () => {
  const p = await project('Back-up');
  await approve(p.approver, p.v1, 1);
  await release(admin, p.projectId, [{ versionId: p.v1 }]);
  const token = await deliveryLink(p.projectId);
  await client(srv.base).get(`/api/delivery/${token}`); // activiteit
  const counts = Object.fromEntries(['deliveries', 'delivery_links', 'client_activity'].map((t) => [t, srv.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
  assert.ok(counts.client_activity >= 1);
  const b = await createBackup({ db: srv.db, config: srv.config, storage: srv.created.storage, label: 'oplever-test' });
  assert.equal(b.manifest.complete, true);
  for (const [t, n] of Object.entries(counts)) assert.equal(b.manifest.counts[t], n, t);
  // Opleveringen kopiëren geen bestanden: elk videobestand staat één keer in de back-up.
  const keys = b.manifest.files.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
  const target = path.join(srv.dataDir, '..', `${path.basename(srv.dataDir)}-hersteld`);
  const r = await restoreBackup({ backupPath: b.dir, dataDir: target, mediaDir: path.join(target, 'media') });
  assert.equal(r.manifest.counts.deliveries, counts.deliveries);
  const { DatabaseSync } = require('node:sqlite');
  const restored = new DatabaseSync(path.join(target, 'review.db'), { readOnly: true });
  try {
    for (const [t, n] of Object.entries(counts)) assert.equal(restored.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, n, t);
  } finally { restored.close(); fs.rmSync(target, { recursive: true, force: true }); }
});

test('teamvoorbeeld van de opleverpagina: alleen-lezen, zelfde inhoud, geen activiteit', async () => {
  const p = await project('Voorbeeld');
  await approve(p.approver, p.v1, 1);
  await release(admin, p.projectId, [{ versionId: p.v1 }]);
  await admin.put(`/api/projects/${p.projectId}/delivery-note`, { note: 'Hierbij de definitieve bestanden.' });
  const before = srv.db.prepare('SELECT COUNT(*) AS n FROM client_activity').get().n;
  const prev = (await admin.get(`/api/projects/${p.projectId}/delivery-preview`)).data;
  assert.equal(prev.project.note, 'Hierbij de definitieve bestanden.');
  assert.equal(prev.items.length, 1);
  assert.equal(prev.items[0].downloadUrl, null);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM client_activity').get().n, before);
  assert.equal((await client(srv.base).get(`/api/projects/${p.projectId}/delivery-preview`)).status, 401);
  // Lege opleverpagina
  const empty = await project('Leeg');
  const t = await deliveryLink(empty.projectId);
  assert.deepEqual((await client(srv.base).get(`/api/delivery/${t}`)).data.items, []);
  assert.equal((await client(srv.base).get(`/api/delivery/${'x'.repeat(32)}`)).status, 404);
});

test('statuscorrecties gelden per exacte versie: v2 corrigeren raakt de oplevering van v1 niet; v1 intrekken wel', async () => {
  const p = await project('Per versie');
  // v1 goedgekeurd en definitief vrijgegeven
  assert.equal((await approve(p.approver, p.v1, 1)).status, 200);
  const first = (await release(admin, p.projectId, [{ versionId: p.v1 }])).data.released[0];
  const token = await deliveryLink(p.projectId);
  const url = (await client(srv.base).get(`/api/delivery/${token}`)).data.items[0].downloadUrl;
  // v2 geüpload en gepubliceerd voor review
  const v2 = await newVersion(p);
  await admin.post(`/api/versions/${v2}/ready`);
  await admin.post(`/api/versions/${v2}/share`, { requestId: rid() });
  // Handmatige correcties op v2 (ook naar Goedgekeurd en weer terug): oplevering van v1 blijft beschikbaar
  for (const [status, note] of [['changes_requested', 'Klant belde: titel aanpassen'], ['approved', 'Per ongeluk'], ['in_review', 'Terug naar review']]) {
    assert.equal((await admin.post(`/api/versions/${v2}/status`, { status, note })).status, 200);
    assert.equal((await client(srv.base).get(url)).status, 200, `na correctie v2 → ${status}`);
  }
  assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM status_events WHERE event = 'manual' AND version_id = ?").get(p.v1).n, 0, 'geen correctie op v1 vastgelegd');
  assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM status_events WHERE event = 'manual' AND version_id = ?").get(v2).n, 3);
  assert.equal((await admin.get(`/api/projects/${p.projectId}/deliveries`)).data.active[0].available, true);
  // v2 handmatig "Goedgekeurd" geeft geen vrijgaverecht (geen klantgoedkeuring van v2)
  await admin.post(`/api/versions/${v2}/status`, { status: 'approved', note: 'Label' });
  assert.equal((await release(admin, p.projectId, [{ versionId: v2, replace: true }])).status, 409);
  // De goedkeuring van v1 intrekken (correctie op v1) blokkeert downloads van die oplevering
  assert.equal((await admin.post(`/api/versions/${p.v1}/status`, { status: 'changes_requested', note: 'Akkoord v1 ingetrokken' })).status, 200);
  assert.equal((await client(srv.base).get(url)).status, 410);
  assert.equal((await admin.get(`/api/projects/${p.projectId}/deliveries`)).data.active[0].reason, 'approval_revoked');
  // Een handmatig label “Goedgekeurd” op v1 herstelt het ingetrokken akkoord niet
  assert.equal((await admin.post(`/api/versions/${p.v1}/status`, { status: 'approved', note: 'Terugzetten' })).status, 200);
  assert.equal((await client(srv.base).get(url)).status, 410);
  const v1 = (await admin.get(`/api/videos/${p.videoId}`)).data.versions.find((v) => v.id === p.v1);
  assert.equal(v1.releasable, false);
  assert.match(v1.releaseProblem, /ingetrokken/);
  assert.equal((await release(admin, p.projectId, [{ versionId: p.v1 }])).status, 409);
  // De goedkeuring van v1 en de vrijgave blijven als historie bestaan
  assert.equal(v1.approval.name, 'Joris');
  assert.equal(srv.db.prepare('SELECT withdrawn_at FROM deliveries WHERE id = ?').get(first).withdrawn_at, null);
});
