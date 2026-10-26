'use strict';
// Bouwronde 6: rollen, projectkoppelingen met einddatum en de strikt alleen-lezen freelancer.
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
let A; // project van de freelancer
let B; // ander project
let fien; // freelancer
let fienId;
let producer;
let producerId;
const key = { 'x-reviewer-key': 'rollen-key-00000001' };

const expectStatus = async (promise, status, label) => {
  const r = await promise;
  assert.equal(r.status, status, `${label}: verwacht ${status}, kreeg ${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`);
  return r;
};

/** Klant plaatst reacties via de reviewlink en verstuurt (optioneel) de feedback. */
async function clientFeedback(target, bodies, { send = true } = {}) {
  const guest = client(srv.base);
  const ids = [];
  for (const body of bodies) {
    const r = await guest.post(`/api/review/${target.token}/versions/${target.versionId}/comments`, { body, timecode: 1, timecodeEnd: 2, authorName: 'Eva Klant', requestId: rid(), annotation: { v: 1, shapes: [{ t: 'rect', c: '#ff4d4f', a: [0.1, 0.1], b: [0.4, 0.4] }] } }, key);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    ids.push(r.data.id);
  }
  if (send) assert.equal((await guest.post(`/api/review/${target.token}/versions/${target.versionId}/feedback`, { authorName: 'Eva Klant', requestId: rid() }, key)).status, 200);
  return ids;
}

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  file = makeVideo(srv.dataDir, 'clip.mp4');
  A = await sharedVideo(admin, file, { name: 'Project Freelance', title: 'Video met feedback' });
  B = await sharedVideo(admin, file, { name: 'Project Geheim', title: 'Geheime video' });
  ({ client: producer, id: producerId } = await addMember(srv, admin, { email: 'pl@studio.nl', name: 'Pien Projectleider', projects: [{ projectId: A.projectId, role: 'producer' }] }));
  ({ client: fien, id: fienId } = await addMember(srv, admin, { email: 'fien@freelance.nl', name: 'Fien Freelancer', role: 'freelancer', projects: [{ projectId: A.projectId, role: 'freelancer' }] }));
});
after(() => srv.close());

describe('freelancer: alleen klantfeedback bekijken', () => {
  let sent;
  let draftOnly;
  before(async () => {
    sent = await clientFeedback(A, ['Logo groter graag', 'Muziek zachter']);
    // Team: interne notitie, intern antwoord op een klantreactie en een zichtbaar antwoord.
    await admin.post(`/api/versions/${A.versionId}/comments`, { body: 'INTERN: budget is op', timecode: 1 });
    await admin.post(`/api/versions/${A.versionId}/comments`, { body: 'INTERN-ANTWOORD: niet doen', parentId: sent[0], internal: true });
    await admin.post(`/api/versions/${A.versionId}/comments`, { body: 'Zichtbaar antwoord: komt goed', parentId: sent[0], internal: false });
    // Klant plaatst nog een reactie maar verstuurt die (nog) niet.
    draftOnly = await clientFeedback(A, ['CONCEPT: nog niet verstuurd'], { send: false });
    // Interne nieuwe versie (niet gepubliceerd) in het project van de freelancer.
    await admin.post(`/api/videos/${A.videoId}/versions`, { uploadId: await upload(admin, file, { videoId: A.videoId }) });
  });

  test('startpagina en project: alleen gekoppelde projecten en gepubliceerde video’s', async () => {
    const o = (await expectStatus(fien.get('/api/freelance/overview'), 200, 'overzicht')).data;
    assert.deepEqual(o.projects.map((p) => p.name), ['Project Freelance']);
    assert.equal(o.projects[0].feedback, 2);
    const p = (await expectStatus(fien.get(`/api/freelance/projects/${A.projectId}`), 200, 'project')).data;
    assert.equal(p.videos.length, 1);
    assert.deepEqual(p.videos[0].versions.map((v) => v.number), [1], 'alleen de gepubliceerde versie');
    await expectStatus(fien.get(`/api/freelance/projects/${B.projectId}`), 404, 'ander project');
  });

  test('video: verstuurde klantfeedback met tijdcode, bereik en tekening; niets interns', async () => {
    const r = await expectStatus(fien.get(`/api/freelance/videos/${A.videoId}`), 200, 'video');
    const v = r.data;
    assert.equal(v.version.number, 1);
    assert.equal(v.playback.original, false, 'nooit het origineel');
    assert.deepEqual(v.comments.map((c) => c.body).sort(), ['Logo groter graag', 'Muziek zachter']);
    const first = v.comments.find((c) => c.body === 'Logo groter graag');
    assert.equal(first.timecode, 1);
    assert.equal(first.timecodeEnd, 2);
    assert.ok(first.annotation?.shapes?.length, 'tekening');
    assert.deepEqual(first.replies.map((x) => x.body), ['Zichtbaar antwoord: komt goed']);
    const json = JSON.stringify(v);
    for (const secret of ['INTERN', 'CONCEPT', 'task', 'resolved', 'token', 'reviewer_key', 'userId', '/media', '/download']) {
      assert.ok(!json.includes(secret), `geen “${secret}” in de gegevens`);
    }
    assert.ok(draftOnly.length === 1);
  });

  test('directe verzoeken: reageren, uploaden, wijzigen, downloaden en interne gegevens geweigerd', async () => {
    const forbidden = [
      ['get', '/api/projects'], ['get', `/api/projects/${A.projectId}`], ['get', `/api/videos/${A.videoId}`],
      ['get', `/api/versions/${A.versionId}/comments`], ['get', `/api/versions/${A.versionId}/media`], ['get', `/api/versions/${A.versionId}/download`],
      ['get', `/api/versions/${A.versionId}/poster`], ['get', `/api/versions/${A.versionId}/hls/master.m3u8`],
      ['get', `/api/projects/${A.projectId}/export.pdf`], ['get', `/api/videos/${A.videoId}/export.csv`], ['get', `/api/projects/${A.projectId}/feedback`],
      ['get', `/api/projects/${A.projectId}/deliveries`], ['get', `/api/projects/${A.projectId}/briefing`], ['get', `/api/projects/${A.projectId}/activity`],
      ['get', '/api/search?q=video'], ['get', '/api/dashboard'], ['get', '/api/clients'], ['get', '/api/users'], ['get', '/api/my/tasks'],
      ['get', `/api/projects/${A.projectId}/members`], ['get', '/api/trash'], ['get', '/api/storage'], ['get', `/api/projects/${A.projectId}/portal-preview`],
      ['post', `/api/versions/${A.versionId}/comments`, { body: 'van freelancer', timecode: 1 }],
      ['post', `/api/comments/${(await admin.get(`/api/versions/${A.versionId}/comments`)).data[0].id}/resolve`, { resolved: true }],
      ['post', '/api/uploads', { filename: 'x.mp4', size: 100, projectId: A.projectId }],
      ['post', `/api/videos/${A.videoId}/versions`, { uploadId: 'x' }],
      ['patch', `/api/videos/${A.videoId}`, { title: 'Hack' }],
      ['post', `/api/versions/${A.versionId}/status`, { status: 'approved', note: 'x' }],
      ['post', `/api/versions/${A.versionId}/share`, {}],
      ['post', `/api/videos/${A.videoId}/links`, { role: 'reviewer' }],
      ['post', `/api/projects/${A.projectId}/deliveries`, { items: [{ versionId: A.versionId }], confirm: true, requestId: rid() }],
      ['post', `/api/projects/${A.projectId}/members`, { userId: fienId, role: 'freelancer' }],
      ['put', `/api/follows/project/${A.projectId}`, { follow: false }],
    ];
    for (const [m, url, body] of forbidden) {
      const r = await fien[m === 'del' ? 'del' : m](url, body);
      assert.equal(r.status, 403, `${m.toUpperCase()} ${url}: verwacht 403, kreeg ${r.status}`);
      assert.ok(!JSON.stringify(r.data).includes('Project Geheim'));
    }
    // Media van de freelancer-route: alleen gepubliceerde versie in eigen project.
    const latest = srv.db.prepare('SELECT id FROM versions WHERE video_id = ? ORDER BY number DESC').get(A.videoId).id;
    await expectStatus(fien.get(`/api/freelance/versions/${latest}/poster`), 404, 'thumbnail van interne versie');
    await expectStatus(fien.get(`/api/freelance/versions/${B.versionId}/poster`), 404, 'thumbnail van ander project');
    await expectStatus(fien.get(`/api/freelance/versions/${B.versionId}/hls/master.m3u8`), 404, 'afspeellijst van ander project');
    await expectStatus(fien.get(`/api/freelance/versions/${A.versionId}/poster`), 200, 'thumbnail gepubliceerde versie');
    // Eigen voorkeuren en wachtwoord mogen wel.
    await expectStatus(fien.put('/api/me/preferences', { theme: 'light' }), 200, 'voorkeuren');
    await expectStatus(fien.post(`/api/users/${producerId}/password`, { password: 'nog-een-lang-wachtwoord' }), 403, 'wachtwoord van een ander');
    await expectStatus(fien.post(`/api/users/${fienId}/password`, { password: 'een-lang-wachtwoord' }), 200, 'eigen wachtwoord');
    // Wachtwoord wijzigen beëindigt sessies: opnieuw inloggen.
    await expectStatus(fien.post('/api/login', { email: 'fien@freelance.nl', password: 'een-lang-wachtwoord' }), 200, 'opnieuw inloggen');
  });

  test('oude projectrechten overschrijven de freelancerbeperking niet', async () => {
    srv.db.prepare("UPDATE project_members SET level = 'manage' WHERE user_id = ? AND project_id = ?").run(fienId, A.projectId);
    await expectStatus(fien.get(`/api/videos/${A.videoId}`), 403, 'video via teamroute');
    await expectStatus(fien.post(`/api/versions/${A.versionId}/comments`, { body: 'x' }), 403, 'reageren');
    await expectStatus(fien.get(`/api/freelance/videos/${A.videoId}`), 200, 'eigen alleen-lezen route werkt nog');
    srv.db.prepare("UPDATE project_members SET level = 'feedback' WHERE user_id = ? AND project_id = ?").run(fienId, A.projectId);
    // Een freelanceraccount kan via de API geen andere rol krijgen, en Freelancer is alleen voor freelancers.
    await expectStatus(admin.put(`/api/users/${fienId}/projects`, { projects: [{ projectId: A.projectId, role: 'editor' }] }), 400, 'freelancer als editor');
    const { id: memberId } = await addMember(srv, admin, { email: 'teamlid@studio.nl' });
    await expectStatus(admin.put(`/api/users/${memberId}/projects`, { projects: [{ projectId: A.projectId, role: 'freelancer' }] }), 400, 'teamlid als freelancer');
  });

  test('meldingen: alleen verstuurde klantfeedback, niet over interne zaken', async () => {
    const before = (await fien.get('/api/inbox')).data.items.length;
    await clientFeedback(A, ['Nieuwe klantopmerking']);
    await admin.post(`/api/versions/${A.versionId}/comments`, { body: '@Fien Freelancer kijk even', timecode: 1 });
    const inbox = (await expectStatus(fien.get('/api/inbox'), 200, 'inbox')).data;
    assert.equal(inbox.items.length, before + 1);
    assert.ok(inbox.items.every((n) => n.type === 'feedback'), 'alleen klantfeedback');
    await expectStatus(fien.post(`/api/inbox/${inbox.items[0].id}/read`, { read: true }), 200, 'gelezen markeren');
  });
});

describe('tijdelijke toegang en personen koppelen', () => {
  let C;
  before(async () => {
    C = await sharedVideo(admin, file, { name: 'Project Tijdelijk', title: 'Tijdelijke video' });
  });

  test('projectleider koppelt een bestaande freelancer met einddatum; accounts maken alleen beheerder', async () => {
    // Projectleider van C maken via de beheerder.
    await expectStatus(admin.post(`/api/projects/${C.projectId}/members`, { userId: producerId, role: 'producer' }), 201, 'projectleider koppelen');
    const cands = (await expectStatus(producer.get(`/api/projects/${C.projectId}/member-candidates`), 200, 'kandidaten')).data;
    assert.ok(cands.some((u) => u.id === fienId && u.accountRole === 'freelancer'));
    assert.ok(!cands.some((u) => u.accountRole === 'admin'), 'beheerders hoeven niet gekoppeld');
    const until = new Date(Date.now() + 2 * 86400000).toISOString();
    const r = await expectStatus(producer.post(`/api/projects/${C.projectId}/members`, { userId: fienId, role: 'freelancer', expiresAt: until }), 201, 'koppelen');
    assert.equal(r.data.members.find((m) => m.userId === fienId).expiresAt, until);
    // Dubbelklik: zelfde koppeling, geen tweede.
    await expectStatus(producer.post(`/api/projects/${C.projectId}/members`, { userId: fienId, role: 'freelancer', expiresAt: until }), 200, 'herhaald verzoek');
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND user_id = ?').get(C.projectId, fienId).n, 1);
    await expectStatus(producer.post(`/api/projects/${C.projectId}/members`, { userId: fienId, role: 'editor' }), 400, 'freelancer als editor');
    await expectStatus(producer.post(`/api/projects/${C.projectId}/members`, { newAccount: { name: 'Nieuw', email: 'nieuw@x.nl', password: 'een-lang-wachtwoord', accountRole: 'freelancer' }, role: 'freelancer' }), 403, 'account maken als projectleider');
    await expectStatus(admin.post(`/api/projects/${C.projectId}/members`, { newAccount: { name: 'Nieuw', email: 'nieuw@x.nl', password: 'een-lang-wachtwoord', accountRole: 'freelancer' }, role: 'freelancer' }), 201, 'account maken als beheerder');
    await expectStatus(producer.post(`/api/projects/${C.projectId}/members`, { userId: fienId, role: 'freelancer', expiresAt: new Date(Date.now() + 5 * 86400000).toISOString() }), 409, 'al gekoppeld');
    await expectStatus(producer.get(`/api/projects/${B.projectId}/members`), 404, 'ander project');
    const o = (await fien.get('/api/freelance/overview')).data.projects.map((p) => p.name).sort();
    assert.deepEqual(o, ['Project Freelance', 'Project Tijdelijk']);
    assert.ok((await fien.get('/api/freelance/overview')).data.projects.find((p) => p.name === 'Project Tijdelijk').timeZone, 'tijdzone bij de einddatum');
  });

  test('verlopen: geen toegang, uit overzicht en meldingen; andere koppeling blijft; verlengen werkt', async () => {
    const pageOpen = (await expectStatus(fien.get(`/api/freelance/videos/${C.videoId}`), 200, 'pagina open')).data;
    assert.ok(pageOpen.video);
    // Einddatum verstrijkt (zonder opruimtaak): direct bij het volgende verzoek geen toegang.
    srv.db.prepare('UPDATE project_members SET expires_at = ? WHERE project_id = ? AND user_id = ?').run(new Date(Date.now() - 1000).toISOString(), C.projectId, fienId);
    const r = await expectStatus(fien.get(`/api/freelance/videos/${C.videoId}`), 403, 'na verlopen');
    assert.equal(r.data.code, 'access_expired');
    await expectStatus(fien.get(`/api/freelance/versions/${C.versionId}/poster`), 403, 'thumbnail na verlopen');
    await expectStatus(fien.get(`/api/freelance/versions/${C.versionId}/hls/master.m3u8`), 403, 'afspeellijst na verlopen');
    assert.deepEqual((await fien.get('/api/freelance/overview')).data.projects.map((p) => p.name), ['Project Freelance'], 'andere koppeling blijft');
    const inboxBefore = (await fien.get('/api/inbox')).data.items.length;
    await clientFeedback(C, ['Feedback na verlopen']);
    assert.equal((await fien.get('/api/inbox')).data.items.length, inboxBefore, 'geen nieuwe melding');
    // Video- en goedkeuringsstatus blijven ongewijzigd door het verlopen.
    assert.equal(srv.db.prepare('SELECT status FROM versions WHERE id = ?').get(C.versionId).status, 'changes_requested');
    // Bewust verlengen.
    await expectStatus(producer.patch(`/api/projects/${C.projectId}/members/${fienId}`, { expiresAt: '2001-01-01T00:00:00Z' }), 400, 'verlengen naar het verleden');
    await expectStatus(producer.patch(`/api/projects/${C.projectId}/members/${fienId}`, { expiresAt: new Date(Date.now() + 86400000).toISOString() }), 200, 'verlengen');
    await expectStatus(fien.get(`/api/freelance/videos/${C.videoId}`), 200, 'na verlengen');
    // Vroegtijdig intrekken en ontkoppelen.
    await expectStatus(producer.patch(`/api/projects/${C.projectId}/members/${fienId}`, { expiresAt: 'now' }), 200, 'nu intrekken');
    await expectStatus(fien.get(`/api/freelance/videos/${C.videoId}`), 403, 'na intrekken');
    await expectStatus(producer.del(`/api/projects/${C.projectId}/members/${fienId}`), 200, 'ontkoppelen');
    await expectStatus(fien.get(`/api/freelance/videos/${C.videoId}`), 404, 'na ontkoppelen');
    assert.ok(srv.db.prepare("SELECT COUNT(*) AS n FROM comments WHERE body = 'Feedback na verlopen'").get().n === 1, 'feedback blijft bewaard');
  });

  test('verlopen koppeling van een teamlid: ook zoeken en lijsten tonen het project niet meer', async () => {
    const { client: ed, id: edId } = await addMember(srv, admin, { email: 'ed@studio.nl', name: 'Ed Editor', projects: [{ projectId: C.projectId, role: 'editor' }] });
    assert.ok((await ed.get('/api/projects')).data.some((p) => p.id === C.projectId));
    srv.db.prepare('UPDATE project_members SET expires_at = ? WHERE project_id = ? AND user_id = ?').run(new Date(Date.now() - 1000).toISOString(), C.projectId, edId);
    assert.ok(!(await ed.get('/api/projects')).data.some((p) => p.id === C.projectId), 'projectlijst');
    const s = (await ed.get('/api/search?q=Tijdelijk')).data;
    assert.ok(!JSON.stringify(s).includes('Tijdelijke video'), 'zoeken');
    const r = await ed.get(`/api/videos/${C.videoId}`);
    assert.equal(r.status, 403);
    assert.equal(r.data.code, 'access_expired');
  });
});

describe('migratie van oude rechten', () => {
  test('view → Meekijker, publish → Editor, upload/manage ongewijzigd; melding voor beheerders; beheerders blijven', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-rollen-'));
    try {
      const file0 = path.join(dir, 'review.db');
      const db0 = openDb({ dataDir: dir, dbFile: file0 });
      const at = new Date().toISOString();
      db0.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (1, 'b@x.nl', 'Beheer', 'x', 'admin', ?), (2, 'k@x.nl', 'Kijker', 'x', 'member', ?), (3, 'p@x.nl', 'Publiceer', 'x', 'member', ?), (4, 'u@x.nl', 'Uploader', 'x', 'member', ?), (5, 'm@x.nl', 'Manager', 'x', 'member', ?)").run(at, at, at, at, at);
      db0.prepare("INSERT INTO projects (id, name, client_name, created_by, created_at) VALUES (1, 'P', '', 1, ?)").run(at);
      for (const [u, l] of [[1, 'view'], [2, 'view'], [3, 'publish'], [4, 'upload'], [5, 'manage']]) db0.prepare('INSERT INTO project_members (project_id, user_id, level, created_at) VALUES (1, ?, ?, ?)').run(u, l, at);
      db0.exec("DELETE FROM app_meta WHERE key = 'roles-v6'");
      db0.close();
      const db = openDb({ dataDir: dir, dbFile: file0 });
      const levels = Object.fromEntries(db.prepare('SELECT user_id, level FROM project_members').all().map((r) => [r.user_id, r.level]));
      assert.deepEqual(levels, { 1: 'read', 2: 'read', 3: 'upload', 4: 'upload', 5: 'manage' });
      const notice = JSON.parse(db.prepare("SELECT value FROM app_meta WHERE key = 'roles-v6-notice'").get().value);
      assert.deepEqual(notice.changes.map((c) => [c.name, c.from, c.to]), [['Kijker', 'view', 'read'], ['Publiceer', 'publish', 'upload']], 'beheerder niet in de melding');
      assert.equal(db.prepare("SELECT role FROM users WHERE id = 1").get().role, 'admin', 'beheerder blijft beheerder');
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

assert.ok(DatabaseSync);
