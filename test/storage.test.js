'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startServer, client, setupAdmin, makeVideo, sharedVideo } = require('./helpers');
const { build } = require('../server/build');

test('onvoldoende schijfruimte: upload wordt vooraf geweigerd met concrete melding', async () => {
  const srv = await startServer({ minFreeBytes: 1e15 }); // reserve groter dan elke schijf
  try {
    const admin = await setupAdmin(srv);
    const projectId = (await admin.post('/api/projects', { name: 'Vol' })).data.id;
    const r = await admin.post('/api/uploads', { filename: 'film.mp4', size: 1024 * 1024, projectId });
    assert.equal(r.status, 507);
    assert.match(r.data.error, /Onvoldoende schijfruimte/);
    assert.match(r.data.error, /reserve/);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM uploads').get().n, 0, 'geen upload gestart');
  } finally {
    await srv.close();
  }
});

test('lopende uploads tellen mee bij de ruimtecontrole', async () => {
  const srv = await startServer({ maxUploadBytes: Number.MAX_SAFE_INTEGER });
  try {
    const admin = await setupAdmin(srv);
    const projectId = (await admin.post('/api/projects', { name: 'Ruimte' })).data.id;
    const disk = await srv.created.storage.freeBytes();
    // Eén upload die bijna alle vrije ruimte claimt; een tweede past dan niet meer.
    const first = await admin.post('/api/uploads', { filename: 'a.mp4', size: Math.floor(disk.free * 0.8), projectId });
    assert.equal(first.status, 201);
    const second = await admin.post('/api/uploads', { filename: 'b.mp4', size: Math.floor(disk.free * 0.5), projectId });
    assert.equal(second.status, 507);
    assert.match(second.data.error, /lopende uploads/);
  } finally {
    await srv.close();
  }
});

test('externe schijf ontbreekt: duidelijke melding, geen map op de interne schijf', async () => {
  const missing = '/Volumes/StudioReviewTestSchijf/media';
  const srv = await startServer({ mediaDir: missing, mediaConfigured: true, uploadTmpDir: `${missing}/.uploads-tmp` });
  try {
    const admin = await setupAdmin(srv);
    const health = (await client(srv.base).get('/api/health')).data;
    assert.equal(health.storage, 'niet bereikbaar');
    const session = (await admin.get('/api/session')).data;
    assert.equal(session.system.storage.ok, false);
    assert.match(session.system.storage.reason, /externe schijf “StudioReviewTestSchijf” is niet aangesloten/);
    const projectId = (await admin.post('/api/projects', { name: 'Extern' })).data.id;
    const up = await admin.post('/api/uploads', { filename: 'film.mp4', size: 1000, projectId });
    assert.equal(up.status, 503);
    assert.match(up.data.error, /niet aangesloten/);
    assert.ok(!fs.existsSync('/Volumes/StudioReviewTestSchijf'), 'er is geen map aangemaakt');
    const report = (await admin.get('/api/storage')).data;
    assert.equal(report.storage.ok, false);
  } finally {
    await srv.close();
  }
});

test('cache: HTML altijd controleren, bestanden per build, ook geïmporteerde modules', async () => {
  const srv = await startServer();
  try {
    const b = build();
    const page = await fetch(`${srv.base}/`);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    const html = await page.text();
    assert.ok(html.includes(`/assets/${b}/app/app.js`), 'script per build');
    assert.ok(html.includes(`/assets/${b}/shared/styles.css`), 'stylesheet per build');
    const map = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/)[1]);
    assert.equal(map.imports['/shared/'], `/assets/${b}/shared/`, 'geïmporteerde modules via import map');
    assert.match(page.headers.get('content-security-policy'), /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    assert.match(html, /<meta name="app-version" content="\d+\.\d+\.\d+ \(build [0-9a-f]{8}\)">/);

    const asset = await fetch(`${srv.base}/assets/${b}/shared/util.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control'), /immutable/);
    const old = await fetch(`${srv.base}/assets/00000000/shared/util.js`);
    assert.equal(old.headers.get('cache-control'), 'no-store', 'oude build-URL wordt niet vastgelegd');
    const legacy = await fetch(`${srv.base}/shared/util.js`);
    assert.equal(legacy.headers.get('cache-control'), 'no-cache', 'oude paden worden altijd gecontroleerd');
    const review = await fetch(`${srv.base}/r/eenwillekeurigetokenvanlengte`);
    assert.ok((await review.text()).includes(`/assets/${b}/review/review.js`));

    // Media voor het team: wel controleren bij elk gebruik (prullenbak/rechten direct effect)
    const admin = await setupAdmin(srv);
    const s = await sharedVideo(admin, makeVideo(srv.dataDir, 'c.mp4'));
    const media = await fetch(`${srv.base}/api/versions/${s.versionId}/media`, { headers: { cookie: admin.cookie() } });
    assert.equal(media.headers.get('cache-control'), 'private, no-cache');
    const session = (await admin.get('/api/session')).data;
    assert.equal(session.version.build, b);
  } finally {
    await srv.close();
  }
});
