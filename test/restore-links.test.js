'use strict';
// Afronding bouwronde 4: klantlinks bij het terugzetten van een back-up.
// Standaard worden alle review-, akkoord-, project- en opleverlinks ongeldig; alleen bewust kunnen
// de links uit de back-up weer gaan werken. Goedkeuringen, reacties, opleveringen en geschiedenis
// blijven in beide gevallen intact.
const fs = require('node:fs');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeVideo, startServer, client, upload, rid, setupAdmin } = require('./helpers');
const { createBackup, restoreBackup, activeLinkCounts } = require('../server/backup');

let srv;
let admin;
let d; // gegevens uit de bron
let backup;
const key = { 'x-reviewer-key': 'herstel-reviewer-key-01' };
const tokenOf = (url) => new URL(url).pathname.split('/').pop();
const FORMAL = ['approvals', 'comments', 'feedback_rounds', 'status_events', 'deliveries', 'review_rounds', 'versions', 'videos', 'projects', 'users'];
const counts = (db) => Object.fromEntries(FORMAL.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  const file = makeVideo(srv.dataDir, 'herstel.mp4', 2);
  const projectId = (await admin.post('/api/projects', { name: 'Herstel' })).data.id;
  const created = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title: 'Film' })).data;
  await admin.post(`/api/versions/${created.versionId}/ready`);
  await admin.post(`/api/versions/${created.versionId}/share`, { requestId: rid() });
  await admin.patch(`/api/videos/${created.videoId}`, { approverName: 'Joris', approverEmail: 'joris@klant.nl' });
  const approver = tokenOf((await admin.post(`/api/videos/${created.videoId}/links`, { role: 'approver' })).data.url);
  const reviewer = tokenOf((await admin.get(`/api/videos/${created.videoId}`)).data.links.find((l) => l.role === 'reviewer').url);
  const guest = client(srv.base);
  await guest.post(`/api/review/${reviewer}/versions/${created.versionId}/comments`, { body: 'Mooi zo', timecode: 1, authorName: 'Eva', requestId: rid() }, key);
  assert.equal((await guest.post(`/api/review/${approver}/versions/${created.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key)).status, 200);
  await admin.post(`/api/projects/${projectId}/deliveries`, { items: [{ versionId: created.versionId }], confirm: true, requestId: rid() });
  const portal = tokenOf((await admin.post(`/api/projects/${projectId}/portal-link`)).data.link.url);
  await client(srv.base).get(`/api/portal/${portal}`); // maakt een reviewlink via het portaal
  const delivery = tokenOf((await admin.post(`/api/projects/${projectId}/delivery-link`)).data.link.url);
  d = { projectId, videoId: created.videoId, versionId: created.versionId, approver, reviewer, portal, delivery };
  backup = await createBackup({ db: srv.db, config: srv.config, storage: srv.created.storage, label: 'links' });
  d.before = counts(srv.db);
  // Ná de back-up: de reviewlink belandde bij de verkeerde persoon en is ingetrokken.
  const reviewerId = srv.db.prepare('SELECT id FROM share_links WHERE token = ?').get(reviewer).id;
  await admin.post(`/api/links/${reviewerId}/revoke`);
});
after(() => srv.close());

/** Zet de back-up terug in een lege map (schone installatie, zonder kennis van later) en start daar. */
async function restoreFresh(links) {
  const dataDir = fs.mkdtempSync(`${srv.dataDir}-herstel-`);
  fs.rmSync(dataDir, { recursive: true });
  const r = await restoreBackup({ backupPath: backup.dir, dataDir, mediaDir: `${dataDir}/media`, ...(links ? { links } : {}) });
  const s = await startServer({ dataDir });
  const team = client(s.base);
  assert.equal((await team.post('/api/login', { email: 'beheer@agency.nl', password: 'een-lang-wachtwoord' })).status, 200);
  return { r, s, team };
}

test('vooraf: de back-up laat zien hoeveel klantlinks er per soort geldig zijn', () => {
  const c = activeLinkCounts(`${backup.dir}/review.db`);
  // reviewlink + reviewlink via het portaal, akkoordlink, projectlink, opleverlink
  assert.deepEqual(c, { reviewLinks: 2, approverLinks: 1, projectLinks: 1, deliveryLinks: 1, total: 5 });
});

test('standaard (schone installatie): alle klantlinks ongeldig, historie intact, nieuwe links werken', async () => {
  const { r, s, team } = await restoreFresh();
  try {
    assert.equal(r.links.mode, 'invalidate');
    assert.equal(r.links.counts.total, 5);
    const guest = client(s.base);
    for (const [url, what] of [
      [`/api/review/${d.reviewer}`, 'reviewlink'],
      [`/api/review/${d.approver}`, 'akkoordlink'],
      [`/api/portal/${d.portal}`, 'projectlink'],
      [`/api/delivery/${d.delivery}`, 'opleverlink'],
      [`/api/review/${d.reviewer}/versions/${d.versionId}/media`, 'media via reviewlink'],
    ]) assert.equal((await guest.get(url)).status, 410, what);
    const dl = s.db.prepare('SELECT id FROM deliveries LIMIT 1').get().id;
    assert.equal((await guest.get(`/api/delivery/${d.delivery}/files/${dl}/download`)).status, 410, 'directe download');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM share_links WHERE revoked_at IS NULL').get().n, 0);
    // Geen historie verloren: goedkeuring, reactie, oplevering, statusgeschiedenis
    assert.deepEqual(counts(s.db), d.before);
    const video = (await team.get(`/api/videos/${d.videoId}`)).data;
    assert.equal(video.versions[0].approval.name, 'Joris');
    assert.equal(video.versions[0].releasable, true, 'goedkeuring telt nog');
    const del = (await team.get(`/api/projects/${d.projectId}/deliveries`)).data;
    assert.equal(del.active.length, 1);
    assert.equal(del.active[0].available, true, 'oplevering blijft geldig; alleen de link is weg');
    assert.equal(del.linkActive, false);
    assert.ok((await team.get(`/api/versions/${d.versionId}/comments`)).data.some((c) => c.body === 'Mooi zo'));
    // Melding voor de beheerder
    const notice = (await team.get('/api/session')).data.system.restoreNotice;
    assert.equal(notice.links, 'invalidate');
    assert.equal(notice.linkCounts.total, 5);
    assert.equal(notice.backupCreatedAt, backup.manifest.createdAt);
    // Nieuwe links aanmaken en delen werkt
    const newDelivery = tokenOf((await team.post(`/api/projects/${d.projectId}/delivery-link`)).data.link.url);
    assert.equal((await guest.get(`/api/delivery/${newDelivery}/files/${dl}/download`)).status, 200);
    const newPortal = tokenOf((await team.post(`/api/projects/${d.projectId}/portal-link`)).data.link.url);
    assert.equal((await guest.get(`/api/portal/${newPortal}`)).status, 200);
    const newApprover = tokenOf((await team.post(`/api/videos/${d.videoId}/links`, { role: 'approver' })).data.url);
    assert.equal((await guest.get(`/api/review/${newApprover}`)).status, 200);
    // Wegklikken van de melding
    assert.equal((await team.post('/api/system/restore-notice/dismiss')).status, 200);
    assert.equal((await team.get('/api/session')).data.system.restoreNotice, null);
  } finally { await s.close(); }
});

test('bewuste keuze: links uit de back-up werken weer, ook een later ingetrokken link', async () => {
  const { r, s, team } = await restoreFresh('keep');
  try {
    assert.equal(r.links.mode, 'keep');
    const guest = client(s.base);
    assert.equal((await guest.get(`/api/review/${d.reviewer}`)).status, 200, 'de later ingetrokken link werkt weer: daarom is dit geen standaard');
    assert.equal((await guest.get(`/api/delivery/${d.delivery}`)).status, 200);
    assert.deepEqual(counts(s.db), d.before);
    assert.equal((await team.get('/api/session')).data.system.restoreNotice.links, 'keep');
  } finally { await s.close(); }
});

test('onbekende keuze wordt geweigerd; niets veranderd', async () => {
  const dataDir = `${srv.dataDir}-onbekend`;
  await assert.rejects(restoreBackup({ backupPath: backup.dir, dataDir, mediaDir: `${dataDir}/media`, links: 'misschien' }), /Onbekende keuze/);
  assert.ok(!fs.existsSync(dataDir));
});

test('zonder herstel (gewone herstart, zoals na een ZIP-update) blijven links ongemoeid', async () => {
  // De bron draait gewoon door: de projectlink en akkoordlink werken nog, de ingetrokken reviewlink niet.
  const guest = client(srv.base);
  assert.equal((await guest.get(`/api/portal/${d.portal}`)).status, 200);
  assert.equal((await guest.get(`/api/review/${d.approver}`)).status, 200);
  assert.equal((await guest.get(`/api/review/${d.reviewer}`)).status, 410);
  assert.equal((await admin.get('/api/session')).data.system.restoreNotice, null);
});

test('npm run herstel: toont vooraf de links en de keuze; standaard ongeldig maken, alternatief alleen expliciet', async () => {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const run = (dataDir, extra = []) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'scripts', 'restore.js'), backup.dir, '--ja', ...extra], {
    env: { ...process.env, DATA_DIR: dataDir, MEDIA_DIR: '', BACKUP_DIR: `${dataDir}-b`, STUDIO_REVIEW_HOME: `${dataDir}-h`, NON_INTERACTIVE: '1' }, encoding: 'utf8',
  });
  const a = `${srv.dataDir}-cli-a`;
  const b = `${srv.dataDir}-cli-b`;
  try {
    const out = run(a);
    assert.match(out, /Klantlinks in deze back-up die nog geldig waren: 5/);
    assert.match(out, /reviewlinks 2 · akkoordlinks 1 · projectlinks \(klantportaal\) 1 · opleverlinks 1/);
    assert.match(out, /Veilig \(standaard\): alle klantlinks ongeldig maken/);
    assert.match(out, /nieuwe links aan en deelt die opnieuw/);
    assert.match(out, /Klantlinks: 5 ongeldig gemaakt/);
    const { DatabaseSync } = require('node:sqlite');
    const dbA = new DatabaseSync(`${a}/review.db`, { readOnly: true });
    assert.equal(dbA.prepare('SELECT COUNT(*) AS n FROM share_links WHERE revoked_at IS NULL').get().n, 0);
    dbA.close();
    const out2 = run(b, ['--links=herstellen']);
    assert.match(out2, /eerder ingetrokken links kunnen weer toegang geven/i);
    const dbB = new DatabaseSync(`${b}/review.db`, { readOnly: true });
    assert.equal(dbB.prepare('SELECT COUNT(*) AS n FROM share_links WHERE revoked_at IS NULL').get().n, 3);
    dbB.close();
    assert.throws(() => run(`${srv.dataDir}-cli-c`, ['--links=soms']), /--links=ongeldig/);
  } finally {
    for (const dir of [a, b]) for (const sfx of ['', '-b', '-h']) fs.rmSync(`${dir}${sfx}`, { recursive: true, force: true });
  }
});
