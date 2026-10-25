'use strict';
// Bouwronde 6: identieke uploads herkennen op inhoud, alleen binnen het eigen project.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeVideo, startServer, upload, setupAdmin, addMember } = require('./helpers');
const { startHashBackfill } = require('../server/filehash');

let srv;
let admin;
let editor;
let A;
let B;
let C;
let original;
let renamed;
let sameNameOther;
let first;

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  original = makeVideo(srv.dataDir, 'Montage_v03.mp4', 2);
  // Zelfde inhoud, andere naam.
  renamed = path.join(srv.dataDir, 'Kopie van montage FINAL.mp4');
  fs.copyFileSync(original, renamed);
  // Zelfde naam, andere inhoud.
  fs.mkdirSync(path.join(srv.dataDir, 'ander'));
  sameNameOther = makeVideo(path.join(srv.dataDir, 'ander'), 'Montage_v03.mp4', 3);
  A = (await admin.post('/api/projects', { name: 'Project A' })).data.id;
  B = (await admin.post('/api/projects', { name: 'Project B (geheim)' })).data.id;
  C = (await admin.post('/api/projects', { name: 'Project C' })).data.id;
  first = (await admin.post(`/api/projects/${A}/videos`, { uploadId: await upload(admin, original, { projectId: A }), title: 'Hoofdfilm' })).data;
  await admin.post(`/api/projects/${B}/videos`, { uploadId: await upload(admin, original, { projectId: B }), title: 'Geheime film' });
  ({ client: editor } = await addMember(srv, admin, { email: 'ed@dup.nl', name: 'Ed', projects: [{ projectId: A, role: 'editor' }, { projectId: C, role: 'editor' }] }));
});
after(() => srv.close());

const check = async (c, id) => {
  const r = await c.post(`/api/uploads/${id}/check-duplicate`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.duplicates;
};

test('zelfde inhoud met een andere naam wordt herkend (met video en versie)', async () => {
  assert.match(srv.db.prepare('SELECT sha256 FROM versions WHERE id = ?').get(first.versionId).sha256, /^[a-f0-9]{64}$/);
  const id = await upload(editor, renamed, { projectId: A });
  const d = await check(editor, id);
  assert.deepEqual(d.map((x) => [x.videoTitle, x.versionNumber, x.originalFilename]), [['Hoofdfilm', 1, 'Montage_v03.mp4']]);
  // Herhaald verzoek: zelfde antwoord, de hash wordt niet opnieuw berekend.
  const stored = srv.db.prepare('SELECT sha256 FROM uploads WHERE id = ?').get(id).sha256;
  assert.ok(stored);
  assert.deepEqual(await check(editor, id), d);
  // Annuleren verwijdert alleen de tijdelijke upload; de bestaande video blijft.
  assert.equal((await editor.del(`/api/uploads/${id}`)).status, 200);
  assert.equal(fs.existsSync(path.join(srv.config.uploadTmpDir, `${id}.part`)), false);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM versions WHERE id = ? AND trashed_at IS NULL').get(first.versionId).n, 1);
});

test('zelfde naam met andere inhoud wordt niet gemeld', async () => {
  const id = await upload(editor, sameNameOther, { projectId: A });
  assert.deepEqual(await check(editor, id), []);
});

test('geen informatie over andere of ontoegankelijke projecten', async () => {
  // Hetzelfde bestand staat in B (geen toegang) en A (wel toegang), maar de upload is voor C.
  const id = await upload(editor, original, { projectId: C });
  const d = await check(editor, id);
  assert.deepEqual(d, []);
  // Andermans upload kan niet gecontroleerd worden.
  assert.equal((await admin.post(`/api/uploads/${id}/check-duplicate`, {})).status, 404);
});

test('bewust doorgaan: normale versie met de oorspronkelijke bestandsnaam; meldt zichzelf nooit', async () => {
  const id = await upload(editor, renamed, { projectId: A });
  assert.equal((await check(editor, id)).length, 1);
  const created = (await editor.post(`/api/projects/${A}/videos`, { uploadId: id, title: 'Toch nog een keer' })).data;
  const ver = srv.db.prepare('SELECT original_filename, source_upload_id, sha256 FROM versions WHERE id = ?').get(created.versionId);
  assert.equal(ver.original_filename, 'Kopie van montage FINAL.mp4');
  assert.equal(ver.source_upload_id, id);
  // Na afronden bestaat de upload niet meer: een herhaalde controle meldt geen duplicaat van zichzelf.
  assert.equal((await editor.post(`/api/uploads/${id}/check-duplicate`, {})).status, 404);
  // Een volgende identieke upload ziet nu beide.
  const next = await upload(editor, original, { projectId: A });
  assert.equal((await check(editor, next)).length, 2);
  // Ook als nieuwe versie van een bestaande video (zelfde project).
  const asVersion = await upload(editor, original, { videoId: first.videoId });
  assert.equal((await check(editor, asVersion)).length, 2);
});

test('oudere versies krijgen op de achtergrond alsnog een hash', async () => {
  srv.db.prepare('UPDATE versions SET sha256 = NULL').run();
  const job = startHashBackfill({ db: srv.db, storage: srv.created.storage, delayMs: 0 });
  const until = Date.now() + 15_000;
  while (srv.db.prepare('SELECT COUNT(*) AS n FROM versions WHERE sha256 IS NULL').get().n && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  job.stop();
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM versions WHERE sha256 IS NULL').get().n, 0);
  const id = await upload(editor, renamed, { projectId: A });
  assert.ok((await check(editor, id)).length >= 2);
});
