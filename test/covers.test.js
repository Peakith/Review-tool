'use strict';
// Bouwronde 7: projectcovers (automatisch, thumbnail, frame) en persoonlijk vastzetten.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeVideo, startServer, client, upload, rid, setupAdmin, addMember, sharedVideo } = require('./helpers');

let srv;
let admin;
let file;
let A; // project met gedeelde v1 en interne v2
let B; // ander project
let v2;
let producer;
let editor;
let fien; // freelancer op A
let fienId;
let clientToken;

const bytesOf = async (c, url) => {
  const r = await fetch(`${srv.base}${url}`, { headers: c ? { cookie: c.cookie() } : {} });
  return { status: r.status, body: r.ok ? Buffer.from(await r.arrayBuffer()).toString('base64') : null };
};

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  file = makeVideo(srv.dataDir, 'clip.mp4', 3);
  A = await sharedVideo(admin, file, { name: 'Project Cover', title: 'Hoofdfilm' });
  B = await sharedVideo(admin, file, { name: 'Ander project', title: 'Andere film' });
  const other = makeVideo(srv.dataDir, 'anders.mp4', 3, '320x240');
  v2 = (await admin.post(`/api/videos/${A.videoId}/versions`, { uploadId: await upload(admin, other, { videoId: A.videoId }) })).data;
  ({ client: producer } = await addMember(srv, admin, { email: 'pl@cover.nl', name: 'Pien', projects: [{ projectId: A.projectId, role: 'producer' }] }));
  ({ client: editor } = await addMember(srv, admin, { email: 'ed@cover.nl', name: 'Ed', projects: [{ projectId: A.projectId, role: 'editor' }, { projectId: B.projectId, role: 'editor' }] }));
  ({ client: fien, id: fienId } = await addMember(srv, admin, { email: 'fien@cover.nl', name: 'Fien', role: 'freelancer', projects: [{ projectId: A.projectId, role: 'freelancer' }] }));
  const clientId = (await admin.post('/api/clients', { name: 'Klant Cover' })).data.id;
  await admin.put(`/api/projects/${A.projectId}/client`, { clientId });
  clientToken = (await admin.post(`/api/clients/${clientId}/links`, {})).data.url.split('/').pop();
});
after(() => srv.close());

test('automatisch: team ziet de nieuwste versie, klant en freelancer alleen de gedeelde', async () => {
  const p = (await admin.get(`/api/projects/${A.projectId}`)).data;
  assert.equal(p.cover.mode, 'auto');
  assert.equal(p.cover.versionId, v2.versionId, 'team: nieuwste (interne) versie');
  const team = await bytesOf(admin, p.cover.url);
  const v2poster = await bytesOf(admin, `/api/versions/${v2.versionId}/poster`);
  const v1poster = await bytesOf(admin, `/api/versions/${A.versionId}/poster`);
  assert.equal(team.body, v2poster.body);
  const portal = (await client(srv.base).get(`/api/client/${clientToken}`)).data;
  const clientCover = await bytesOf(null, portal.projects[0].cover.url);
  assert.equal(clientCover.body, v1poster.body, 'klant: alleen uit de gedeelde versie');
  assert.ok(!('versionId' in portal.projects[0].cover) || portal.projects[0].cover.versionId === undefined);
  const fl = (await fien.get('/api/freelance/overview')).data.projects[0];
  assert.equal((await bytesOf(fien, fl.cover.url)).body, v1poster.body, 'freelancer: alleen gedeeld');
});

test('omslag wijzigen: alleen projectleider/beheerder; intern frame lekt nooit naar klant of freelancer', async () => {
  assert.equal((await editor.put(`/api/projects/${A.projectId}/cover`, { mode: 'version', versionId: A.versionId })).status, 403);
  assert.equal((await fien.put(`/api/projects/${A.projectId}/cover`, { mode: 'auto' })).status, 403);
  assert.equal((await producer.put(`/api/projects/${A.projectId}/cover`, { mode: 'version', versionId: B.versionId })).status, 400, 'versie uit ander project');
  // Frame uit de interne v2
  const r = await producer.put(`/api/projects/${A.projectId}/cover`, { mode: 'frame', versionId: v2.versionId, time: 1.2 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.cover.mode, 'frame');
  const key = srv.db.prepare('SELECT cover_key FROM projects WHERE id = ?').get(A.projectId).cover_key;
  assert.match(key, /^cover-\d+-[a-f0-9]+\.jpg$/);
  const team = await bytesOf(producer, r.data.cover.url);
  assert.equal(team.status, 200);
  const v1poster = await bytesOf(admin, `/api/versions/${A.versionId}/poster`);
  const portal = (await client(srv.base).get(`/api/client/${clientToken}`)).data;
  assert.equal((await bytesOf(null, portal.projects[0].cover.url)).body, v1poster.body, 'klant krijgt het interne frame niet');
  assert.notEqual(team.body, v1poster.body);
  // Video's, thumbnails en titels blijven ongewijzigd.
  const v = (await admin.get(`/api/videos/${A.videoId}`)).data;
  assert.equal(v.title, 'Hoofdfilm');
  assert.equal(srv.db.prepare('SELECT custom_poster FROM versions WHERE id = ?').get(v2.versionId).custom_poster, 0);
  // Frame uit de gedeelde v1: de klant ziet nu ook dat frame.
  const r2 = await producer.put(`/api/projects/${A.projectId}/cover`, { mode: 'frame', versionId: A.versionId, time: 0.5 });
  const shared = await bytesOf(null, `/api/client/${clientToken}/projects/${A.projectId}/cover`);
  assert.equal(shared.body, (await bytesOf(producer, r2.data.cover.url)).body);
  assert.ok(!(await srv.created.storage.exists(key)), 'vorig frame-bestand opgeruimd');
  // Terug naar automatisch.
  const r3 = await producer.put(`/api/projects/${A.projectId}/cover`, { mode: 'auto' });
  assert.equal(r3.data.cover.mode, 'auto');
  assert.equal(srv.db.prepare('SELECT cover_key FROM projects WHERE id = ?').get(A.projectId).cover_key, null);
});

test('cover ophalen is afgeschermd; verdwenen bron valt terug op automatisch', async () => {
  assert.equal((await bytesOf(editor, `/api/projects/${A.projectId}/cover`)).status, 200);
  assert.equal((await bytesOf(fien, `/api/projects/${A.projectId}/cover`)).status, 403, 'freelancer niet via de teamroute');
  assert.equal((await bytesOf(fien, `/api/freelance/projects/${B.projectId}/cover`)).status, 404, 'freelancer: ander project');
  assert.equal((await bytesOf(null, `/api/client/${clientToken}/projects/${B.projectId}/cover`)).status, 404, 'klant: project van een ander');
  assert.equal((await bytesOf(null, `/api/projects/${A.projectId}/cover`)).status, 401);
  // Gekozen versie naar de prullenbak: terugval op automatisch.
  await producer.put(`/api/projects/${A.projectId}/cover`, { mode: 'version', versionId: v2.versionId });
  srv.db.prepare('UPDATE versions SET trashed_at = ? WHERE id = ?').run(new Date().toISOString(), v2.versionId);
  const p = (await admin.get(`/api/projects/${A.projectId}`)).data;
  assert.equal(p.cover.effective, 'auto');
  assert.equal(p.cover.versionId, A.versionId);
  srv.db.prepare('UPDATE versions SET trashed_at = NULL WHERE id = ?').run(v2.versionId);
  // Project zonder bruikbare thumbnail: geen cover (veilige terugval in de interface).
  const empty = (await admin.post('/api/projects', { name: 'Leeg' })).data.id;
  assert.equal((await admin.get(`/api/projects/${empty}`)).data.cover, null);
});

test('vastzetten: per gebruiker, nooit meer toegang, verdwijnt bij verlopen koppeling', async () => {
  assert.equal((await editor.put(`/api/pins/${A.projectId}`, { pinned: true })).status, 200);
  assert.equal((await editor.get('/api/projects')).data.find((p) => p.id === A.projectId).pinned, true);
  assert.equal((await producer.get('/api/projects')).data.find((p) => p.id === A.projectId).pinned, false, 'ander account ongewijzigd');
  const dash = (await editor.get('/api/dashboard')).data;
  assert.deepEqual(dash.data.pinned.items.map((p) => p.name), ['Project Cover']);
  // Geen toegang = niet vastzetten en geen bestaan prijsgeven.
  assert.equal((await producer.put(`/api/pins/${B.projectId}`, { pinned: true })).status, 404);
  // Freelancer: alleen geldig gekoppelde projecten.
  assert.equal((await fien.put(`/api/pins/${A.projectId}`, { pinned: true })).status, 200);
  assert.equal((await fien.put(`/api/pins/${B.projectId}`, { pinned: true })).status, 404);
  assert.equal((await fien.get('/api/freelance/overview')).data.projects[0].pinned, true);
  srv.db.prepare('UPDATE project_members SET expires_at = ? WHERE user_id = ?').run(new Date(Date.now() - 1000).toISOString(), fienId);
  assert.deepEqual((await fien.get('/api/freelance/overview')).data.projects, [], 'verlopen: ook uit de favorieten');
  assert.equal((await fien.put(`/api/pins/${A.projectId}`, { pinned: false })).status, 404);
  // Editor verliest toegang: uit het vastgezette blok, zonder extra toegang.
  await admin.put(`/api/users/${(await editor.get('/api/session')).data.user.id}/projects`, { projects: [{ projectId: B.projectId, role: 'editor' }] });
  assert.deepEqual((await editor.get('/api/dashboard')).data.data.pinned.items, []);
  assert.equal((await editor.get(`/api/projects/${A.projectId}`)).status, 404);
  // Losmaken
  await admin.put(`/api/pins/${B.projectId}`, { pinned: true });
  assert.equal((await admin.put(`/api/pins/${B.projectId}`, { pinned: false })).data.pinned, false);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM project_pins WHERE project_id = ?').get(B.projectId).n, 0);
  assert.ok(rid());
});
