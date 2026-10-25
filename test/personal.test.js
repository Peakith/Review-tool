'use strict';
// Bouwronde 5, fase A: persoonlijke voorkeuren, dashboard, globaal zoeken, oorspronkelijke
// bestandsnamen en handmatige thumbnails. Steeds met meerdere accounts en beperkte rechten.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeVideo, startServer, client, upload, rid, setupAdmin, addMember } = require('./helpers');
const { createBackup } = require('../server/backup');

let srv;
let admin;
let free; // freelancer met alleen toegang tot project A (upload)
let viewer; // alleen bekijken in project A
let A;
let B;
const key = { 'x-reviewer-key': 'persoonlijk-key-000001' };
const tokenOf = (url) => new URL(url).pathname.split('/').pop();

async function project(name, title, filename) {
  const dir = fs.mkdtempSync(path.join(srv.dataDir, 'src-'));
  const file = path.join(dir, filename);
  fs.copyFileSync(makeVideo(dir, 'bron.mp4', 2), file);
  const projectId = (await admin.post('/api/projects', { name, clientName: `${name} BV` })).data.id;
  const created = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title })).data;
  await admin.post(`/api/versions/${created.versionId}/ready`);
  await admin.post(`/api/versions/${created.versionId}/share`, { requestId: rid() });
  const v = (await admin.get(`/api/videos/${created.videoId}`)).data;
  return { projectId, videoId: created.videoId, versionId: created.versionId, file, reviewer: tokenOf(v.links.find((l) => l.role === 'reviewer').url) };
}

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  A = await project('Zomercampagne', 'Zomercampagne — hoofdvideo', 'SB_Campagne_Edit_v03.mp4');
  B = await project('Geheim project', 'Geheime lancering', 'GEHEIM_master.mp4');
  free = (await addMember(srv, admin, { email: 'freelancer@agency.nl', name: 'Fien Freelancer', projects: [{ projectId: A.projectId, level: 'upload' }] })).client;
  viewer = (await addMember(srv, admin, { email: 'kijker@agency.nl', name: 'Kees Kijker', projects: [{ projectId: A.projectId, level: 'view' }] })).client;
  // Feedback en reacties in beide projecten
  for (const p of [A, B]) {
    const g = client(srv.base);
    await g.post(`/api/review/${p.reviewer}/versions/${p.versionId}/comments`, { body: `Logo groter in ${p === A ? 'zomer' : 'geheim'} 50%_korting`, timecode: 1, authorName: 'Eva', requestId: rid() }, key);
    await g.post(`/api/review/${p.reviewer}/versions/${p.versionId}/feedback`, { authorName: 'Eva', requestId: rid() }, key);
  }
  await admin.post(`/api/versions/${B.versionId}/comments`, { body: 'Interne notitie geheim budget', timecode: 0.5 });
  await admin.post(`/api/projects/${B.projectId}/briefing`, { kind: 'text', title: 'Geheime briefing', body: 'Budget en planning' });
  await admin.post(`/api/projects/${A.projectId}/briefing`, { kind: 'text', title: 'Zomerbriefing', body: 'Toon: luchtig, logo groter' });
});
after(() => srv.close());

test('voorkeuren per gebruiker: thema en dashboard los per account, gevalideerd', async () => {
  assert.equal((await admin.get('/api/session')).data.theme, 'dark', 'standaard donker');
  assert.equal((await admin.put('/api/me/preferences', { theme: 'light' })).status, 200);
  assert.equal((await free.put('/api/me/preferences', { theme: 'system' })).status, 200);
  assert.equal((await admin.get('/api/session')).data.theme, 'light');
  assert.equal((await free.get('/api/session')).data.theme, 'system');
  assert.equal((await viewer.get('/api/session')).data.theme, 'dark');
  assert.equal((await free.put('/api/me/preferences', { theme: 'roze' })).status, 400);
  // Dashboard: standaard vier blokken (bouwronde 7: Aandacht nodig, Vastgezet, Inbox, Bij de klant)
  const d = (await free.get('/api/me/preferences')).data.dashboard.widgets.map((w) => w.id);
  assert.deepEqual(d, ['attention', 'pinned', 'inbox', 'waiting']);
  // Freelancer (geen publicatierecht, geen beheerder): geen klantactiviteit of opslag
  const avail = (await free.get('/api/dashboard')).data.available.map((w) => w.id);
  assert.ok(!avail.includes('storage') && !avail.includes('activity'), avail.join());
  assert.equal((await free.put('/api/me/preferences', { dashboard: { widgets: [{ id: 'storage' }] } })).status, 400);
  assert.ok((await admin.get('/api/dashboard')).data.available.some((w) => w.id === 'storage'));
  // Toevoegen, verplaatsen, formaat, verbergen
  const layout = [{ id: 'recent', size: 'wide' }, { id: 'tasks', size: 'normal' }, { id: 'uploads', size: 'normal' }];
  assert.equal((await free.put('/api/me/preferences', { dashboard: { widgets: layout } })).status, 200);
  assert.deepEqual((await free.get('/api/me/preferences')).data.dashboard.widgets, layout);
  assert.deepEqual((await viewer.get('/api/me/preferences')).data.dashboard.widgets.map((w) => w.id), ['attention', 'pinned', 'inbox', 'waiting'], 'ander account ongewijzigd');
  assert.equal((await free.put('/api/me/preferences', { dashboard: { widgets: [{ id: 'tasks' }, { id: 'tasks' }] } })).status, 400, 'geen dubbele blokken');
  assert.equal((await free.put('/api/me/preferences', { dashboard: null })).status, 200, 'standaard herstellen');
});

test('dashboard toont alleen gegevens uit toegestane projecten', async () => {
  // Een taak voor de freelancer in A, en een (onzichtbare) taak in B
  const cA = srv.db.prepare("SELECT c.id FROM comments c JOIN versions v ON v.id = c.version_id WHERE v.id = ? AND c.author_type = 'guest'").get(A.versionId).id;
  const cB = srv.db.prepare("SELECT c.id FROM comments c JOIN versions v ON v.id = c.version_id WHERE v.id = ? AND c.author_type = 'guest'").get(B.versionId).id;
  const freeId = srv.db.prepare("SELECT id FROM users WHERE email = 'freelancer@agency.nl'").get().id;
  assert.equal((await admin.post(`/api/comments/${cA}/task`, { assigneeId: freeId })).status, 201);
  await admin.post(`/api/comments/${cB}/task`, {});
  await free.put('/api/me/preferences', { dashboard: { widgets: ['tasks', 'feedback', 'waiting', 'recent', 'uploads'].map((id) => ({ id })) } });
  const d = (await free.get('/api/dashboard')).data.data;
  const dump = JSON.stringify(d);
  assert.ok(!/Geheim|geheim/.test(dump), `lek: ${dump.slice(0, 300)}`);
  assert.equal(d.tasks.total, 1);
  assert.equal(d.feedback.items.length, 1);
  assert.equal(d.feedback.items[0].projectId, A.projectId);
  assert.deepEqual(d.recent.items.map((p) => p.id), [A.projectId]);
  // De beheerder ziet beide projecten
  await admin.put('/api/me/preferences', { dashboard: { widgets: [{ id: 'feedback' }, { id: 'recent' }, { id: 'activity' }, { id: 'storage' }] } });
  const ad = (await admin.get('/api/dashboard')).data.data;
  assert.equal(ad.feedback.items.length, 2);
  assert.ok(ad.storage.ok && ad.storage.disk.free > 0);
});

test('globaal zoeken: groepen, fragmenten, juiste link en geen informatie uit andere projecten', async () => {
  const r = (await admin.get('/api/search?q=logo groter')).data.groups;
  assert.equal(r.comments.total, 2);
  const c = r.comments.items.find((i) => /zomer/.test(i.snippet));
  assert.match(c.href, new RegExp(`^/video/${A.videoId}\\?v=${A.versionId}&c=\\d+$`));
  assert.equal(r.briefing.total, 1, 'briefingtekst gevonden');
  // Oorspronkelijke bestandsnaam
  const f = (await admin.get('/api/search?q=SB_Campagne')).data.groups.files;
  assert.equal(f.items[0].title, 'SB_Campagne_Edit_v03.mp4');
  assert.equal(f.items[0].href, `/video/${A.videoId}?v=${A.versionId}`);
  // Freelancer: niets uit project B, ook geen aantallen of fragmenten
  for (const q of ['geheim', 'GEHEIM_master', 'budget', 'lancering', 'Geheim project BV']) {
    const groups = (await free.get(`/api/search?q=${encodeURIComponent(q)}`)).data.groups;
    for (const [g, v] of Object.entries(groups)) assert.equal(v.total, 0, `${q} → ${g}: ${JSON.stringify(v.items)}`);
  }
  const mine = (await free.get('/api/search?q=zomer')).data.groups;
  assert.ok(mine.projects.total === 1 && mine.videos.total === 1);
  // LIKE-tekens worden letterlijk gezocht
  assert.equal((await admin.get('/api/search?q=50%25_k')).data.groups.comments.total, 2);
  assert.equal((await admin.get('/api/search?q=%25%25')).data.groups.comments.total, 0);
  // Prullenbak telt niet mee
  await admin.del(`/api/videos/${B.videoId}`);
  assert.equal((await admin.get('/api/search?q=Geheime lancering')).data.groups.videos.total, 0);
  await admin.post('/api/trash/restore', { type: 'video', id: B.videoId });
  assert.equal((await admin.get('/api/search?q=x')).data.groups.projects, undefined, 'te korte zoekterm');
  assert.equal((await client(srv.base).get('/api/search?q=geheim')).status, 401);
});

test('opgeslagen zoekopdrachten zijn persoonlijk en geven bij gebruik alleen toegestane resultaten', async () => {
  const s = await free.post('/api/saved-searches', { name: 'Geheim', query: 'geheim', filters: { types: ['comments', 'videos'] } });
  assert.equal(s.status, 201);
  assert.equal((await free.get('/api/saved-searches')).data.length, 1);
  assert.equal((await admin.get('/api/saved-searches')).data.length, 0, 'niet zichtbaar voor anderen');
  assert.equal((await admin.del(`/api/saved-searches/${s.data.id}`)).status, 404, 'niet te verwijderen door anderen');
  const saved = (await free.get('/api/saved-searches')).data[0];
  const groups = (await free.get(`/api/search?q=${encodeURIComponent(saved.query)}&types=${saved.filters.types.join(',')}`)).data.groups;
  assert.deepEqual(Object.keys(groups).sort(), ['comments', 'videos']);
  assert.ok(Object.values(groups).every((g) => g.total === 0));
  assert.equal((await free.del(`/api/saved-searches/${s.data.id}`)).status, 200);
});

test('downloads gebruiken de oorspronkelijke uploadnaam, ook na een titelwijziging, met veilige headers', async () => {
  await admin.patch(`/api/videos/${A.videoId}`, { title: 'Zomercampagne — hoofdvideo "def"' });
  const team = await fetch(`${srv.base}/api/versions/${A.versionId}/download`, { headers: { cookie: admin.cookie() } });
  assert.equal(team.status, 200);
  assert.match(team.headers.get('content-disposition'), /filename="SB_Campagne_Edit_v03\.mp4"; filename\*=UTF-8''SB_Campagne_Edit_v03\.mp4/);
  assert.ok(Buffer.compare(Buffer.from(await team.arrayBuffer()), fs.readFileSync(A.file)) === 0);
  // Reviewlink met download aan
  const dl = tokenOf((await admin.post(`/api/videos/${A.videoId}/links`, { role: 'reviewer', allowDownload: true })).data.url);
  const viaLink = await fetch(`${srv.base}/api/review/${dl}/versions/${A.versionId}/download`);
  assert.match(viaLink.headers.get('content-disposition'), /SB_Campagne_Edit_v03\.mp4/);
  // Bijzondere tekens in de oorspronkelijke naam
  const dir = fs.mkdtempSync(path.join(srv.dataDir, 'tekens-'));
  const special = path.join(dir, 'Café & co — "def" v2.mp4');
  fs.copyFileSync(A.file, special);
  const v2 = (await admin.post(`/api/videos/${A.videoId}/versions`, { uploadId: await upload(admin, special, { videoId: A.videoId }) })).data.versionId;
  const r = await fetch(`${srv.base}/api/versions/${v2}/download`, { headers: { cookie: admin.cookie() } });
  const cd = r.headers.get('content-disposition');
  assert.match(cd, /^attachment; filename="Cafe & co - -def- v2\.mp4"; filename\*=UTF-8''Caf%C3%A9%20%26%20co%20%E2%80%94%20-def-%20v2\.mp4$/, cd);
  assert.ok(!/[\r\n]/.test(cd));
  A.v2 = v2;
});

test('handmatige thumbnail per versie: kiezen, terug naar automatisch, geen uitlekken van een interne versie', async () => {
  const autoV2 = Buffer.from(await (await fetch(`${srv.base}/api/versions/${A.v2}/poster`, { headers: { cookie: admin.cookie() } })).arrayBuffer());
  assert.equal((await viewer.post(`/api/versions/${A.v2}/poster`, { time: 1 })).status, 403, 'alleen met uploadrecht');
  assert.equal((await free.post(`/api/versions/${A.v2}/poster`, { time: 99 })).status, 400, 'buiten de video');
  assert.equal((await free.post(`/api/versions/${A.v2}/poster`, { time: 1.5 })).status, 200);
  const custom = Buffer.from(await (await fetch(`${srv.base}/api/versions/${A.v2}/poster`, { headers: { cookie: admin.cookie() } })).arrayBuffer());
  assert.notEqual(crypto.createHash('sha1').update(custom).digest('hex'), crypto.createHash('sha1').update(autoV2).digest('hex'));
  const v = (await admin.get(`/api/videos/${A.videoId}`)).data.versions.find((x) => x.id === A.v2);
  assert.deepEqual([v.file.customPoster, v.file.customPosterTime], [true, 1.5]);
  // v2 is intern (niet gedeeld): niet bereikbaar via klantlinks; de klant ziet de thumbnail van v1
  assert.equal((await client(srv.base).get(`/api/review/${A.reviewer}/versions/${A.v2}/poster`)).status, 404);
  const v1Client = Buffer.from((await client(srv.base).get(`/api/review/${A.reviewer}/versions/${A.versionId}/poster`)).data);
  assert.notEqual(crypto.createHash('sha1').update(v1Client).digest('hex'), crypto.createHash('sha1').update(custom).digest('hex'));
  const portal = tokenOf((await admin.post(`/api/projects/${A.projectId}/portal-link`)).data.link.url);
  const pv = Buffer.from((await client(srv.base).get(`/api/portal/${portal}/videos/${A.videoId}/poster`)).data);
  assert.ok(Buffer.compare(pv, v1Client) === 0, 'portaal toont de thumbnail van de gepubliceerde v1');
  // Back-up bevat het eigen frame
  const b = await createBackup({ db: srv.db, config: srv.config, storage: srv.created.storage, label: 'thumb' });
  const v2row = srv.db.prepare('SELECT stored_name FROM versions WHERE id = ?').get(A.v2);
  assert.ok(b.manifest.files.some((f) => f.key === `${v2row.stored_name}.custom.jpg`));
  assert.equal(b.manifest.complete, true);
  // Terug naar automatisch
  assert.equal((await free.del(`/api/versions/${A.v2}/poster`)).status, 200);
  const back = Buffer.from(await (await fetch(`${srv.base}/api/versions/${A.v2}/poster`, { headers: { cookie: admin.cookie() } })).arrayBuffer());
  assert.ok(Buffer.compare(back, autoV2) === 0);
  assert.ok(!fs.existsSync(path.join(srv.config.mediaDir, `${v2row.stored_name}.custom.jpg`)));
  // Bronbestand onaangeroerd
  assert.equal(srv.db.prepare('SELECT size_bytes FROM versions WHERE id = ?').get(A.v2).size_bytes, fs.statSync(path.join(srv.config.mediaDir, v2row.stored_name)).size);
});
