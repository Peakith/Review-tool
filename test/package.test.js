'use strict';
// Bouwronde 5, fase D: opleverpakket als ZIP. Alleen exacte, vrijgegeven en goedgekeurde versies,
// oorspronkelijke namen, dubbele namen in eigen mappen, overzicht, rechten, intrekken tijdens het
// downloaden en geheugengebruik bij een groot bestand. Controle met de standaard `unzip`.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeVideo, startServer, client, upload, rid, setupAdmin } = require('./helpers');

let srv;
let admin;
let P;
const key = { 'x-reviewer-key': 'pakket-reviewer-key-001' };
const tokenOf = (url) => new URL(url).pathname.split('/').pop();
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Video met eigen bestandsnaam, gepubliceerd, goedgekeurd door de akkoordgever en vrijgegeven. */
async function released(projectId, fileName, title, { release = true } = {}) {
  const file = makeVideo(srv.dataDir, fileName, 1);
  const v = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title })).data;
  await admin.post(`/api/versions/${v.versionId}/ready`);
  await admin.post(`/api/versions/${v.versionId}/share`, { requestId: rid() });
  await admin.patch(`/api/videos/${v.videoId}`, { approverName: 'Joris', approverEmail: 'joris@klant.nl' });
  const approver = tokenOf((await admin.post(`/api/videos/${v.videoId}/links`, { role: 'approver' })).data.url);
  assert.equal((await client(srv.base).post(`/api/review/${approver}/versions/${v.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key)).status, 200);
  if (release) assert.equal((await admin.post(`/api/projects/${projectId}/deliveries`, { items: [{ versionId: v.versionId }], confirm: true, requestId: rid() })).status, 201);
  return { ...v, file };
}
function saveZip(buf, name) {
  const f = path.join(srv.dataDir, name);
  fs.writeFileSync(f, buf);
  return f;
}
const names = (zip) => execFileSync('unzip', ['-Z1', zip]).toString().trim().split('\n');

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  const projectId = (await admin.post('/api/projects', { name: 'Zomer: campagne/2026', clientName: 'Bakkerij Jansen' })).data.id;
  P = { projectId };
  // Een dubbele naam (twee video's met eind.mp4), bijzondere tekens, en één niet vrijgegeven video.
  P.a = await released(projectId, 'eind.mp4', 'Hoofdfilm');
  P.b = await released(projectId, 'eind (1).mp4', 'Teaser');
  P.c = await released(projectId, 'Ä film – définitief #1.mp4', 'Social');
  P.d = await released(projectId, 'niet-vrijgegeven.mp4', 'Concept', { release: false });
  // Tweede video met exact dezelfde oorspronkelijke naam als A
  P.e = await released(projectId, 'eind.mp4', 'Cutdown');
  P.link = tokenOf((await admin.post(`/api/projects/${projectId}/delivery-link`)).data.link.url);
});
after(() => srv.close());

test('inhoud: alleen vrijgegeven versies, oorspronkelijke namen, dubbele namen in mappen, overzicht', async () => {
  const guest = client(srv.base);
  const page = (await guest.get(`/api/delivery/${P.link}`)).data;
  assert.equal(page.package.count, 4);
  assert.equal(page.package.url, `/api/delivery/${P.link}/package.zip`);
  const r = await guest.get(page.package.url);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  assert.equal(Number(r.headers.get('content-length')), r.data.length, 'grootte vooraf exact bekend');
  assert.match(r.headers.get('content-disposition'), /filename\*=UTF-8''Zomer-%20campagne-2026%20-%20oplevering\.zip/);
  const zip = saveZip(r.data, 'pakket.zip');
  execFileSync('unzip', ['-tq', zip]); // gooit bij een fout (CRC, structuur)
  const list = names(zip).sort();
  assert.deepEqual(list, ['Cutdown/eind.mp4', 'Hoofdfilm/eind.mp4', 'Overzicht.txt', 'eind (1).mp4', 'Ä film – définitief #1.mp4'].sort());
  // Inhoud byte voor byte gelijk aan de exacte versie
  for (const [entry, v] of [['Hoofdfilm/eind.mp4', P.a], ['Ä film – définitief #1.mp4', P.c]]) {
    const stored = srv.db.prepare('SELECT stored_name FROM versions WHERE id = ?').get(v.versionId).stored_name;
    assert.equal(sha(execFileSync('unzip', ['-p', zip, entry])), sha(fs.readFileSync(srv.created.storage.localPath(stored))), entry);
  }
  const overview = execFileSync('unzip', ['-p', zip, 'Overzicht.txt']).toString();
  assert.match(overview, /Definitieve oplevering: Zomer: campagne\/2026/);
  assert.match(overview, /Hoofdfilm\/eind\.mp4\r\n {2}Video: Hoofdfilm · versie 1\r\n {2}Goedgekeurd door: Joris, /);
  assert.ok(!overview.includes('niet-vrijgegeven') && !list.some((n) => n.includes('niet-vrijgegeven')));
  // HEAD: alleen de kopregels, geen activiteit
  const head = await fetch(`${srv.base}${page.package.url}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(r.data.length));
});

test('teruggenomen of ingetrokken goedkeuring: niet meer in het pakket', async () => {
  const d = srv.db.prepare('SELECT id FROM deliveries WHERE version_id = ? AND withdrawn_at IS NULL').get(P.b.versionId).id;
  await admin.post(`/api/deliveries/${d}/withdraw`, { confirm: true, reason: 'Verkeerde mix' });
  await admin.post(`/api/versions/${P.c.versionId}/status`, { status: 'changes_requested', note: 'Toch niet goed' });
  const r = await client(srv.base).get(`/api/delivery/${P.link}/package.zip`);
  assert.deepEqual(names(saveZip(r.data, 'pakket2.zip')).sort(), ['Cutdown/eind.mp4', 'Hoofdfilm/eind.mp4', 'Overzicht.txt']);
});

test('rechten: wachtwoord, verlopen, ingetrokken, klanttoegang uit en team alleen ingelogd', async () => {
  const url = `/api/delivery/${P.link}/package.zip`;
  const linkId = srv.db.prepare('SELECT id FROM delivery_links WHERE token = ?').get(P.link).id;
  await admin.put(`/api/link-protection/delivery/${linkId}`, { password: 'pakket-123' });
  assert.equal((await client(srv.base).get(url)).status, 401);
  const unlocked = client(srv.base);
  await unlocked.post(`/api/unlock/delivery/${P.link}`, { password: 'pakket-123' });
  assert.equal((await unlocked.get(url)).status, 200);
  await admin.put(`/api/link-protection/delivery/${linkId}`, { password: null });
  srv.db.prepare('UPDATE delivery_links SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', linkId);
  assert.equal((await client(srv.base).get(url)).data.code, 'expired');
  srv.db.prepare('UPDATE delivery_links SET expires_at = NULL WHERE id = ?').run(linkId);
  await admin.put(`/api/projects/${P.projectId}/client-visibility`, { visibility: 'off' });
  assert.equal((await client(srv.base).get(url)).data.code, 'client_access_off');
  await admin.put(`/api/projects/${P.projectId}/client-visibility`, { visibility: 'active' });
  assert.equal((await client(srv.base).get(`/api/projects/${P.projectId}/deliveries/package.zip`)).status, 401);
  assert.equal((await admin.get(`/api/projects/${P.projectId}/deliveries/package.zip`)).status, 200);
  // Via het klantportaal per klant
  const clientId = (await admin.post('/api/clients', { name: 'Bakkerij Jansen' })).data.id;
  await admin.put(`/api/projects/${P.projectId}/client`, { clientId });
  const cl = tokenOf((await admin.post(`/api/clients/${clientId}/links`, {})).data.url);
  const dp = (await client(srv.base).get(`/api/client/${cl}/projects/${P.projectId}/delivery`)).data;
  assert.equal(dp.package.url, `/api/client/${cl}/projects/${P.projectId}/delivery/package.zip`);
  assert.equal((await client(srv.base).get(dp.package.url)).status, 200);
});

/** Download met een trage lezer: na het eerste deel de link intrekken. */
function slowDownload(url, onFirstChunk) {
  return new Promise((resolve) => {
    let bytes = 0;
    let first = true;
    const req = http.get(url, (res) => {
      const total = Number(res.headers['content-length']);
      res.on('data', async (chunk) => {
        bytes += chunk.length;
        if (first) { first = false; res.pause(); await onFirstChunk(); res.resume(); }
      });
      res.on('end', () => resolve({ bytes, total, complete: res.complete }));
      res.on('aborted', () => resolve({ bytes, total, complete: false }));
      res.on('error', () => resolve({ bytes, total, complete: false }));
    });
    req.on('error', () => resolve({ bytes, total: null, complete: false }));
  });
}

test('groot bestand: gestreamd zonder het in het geheugen te laden; intrekken tijdens downloaden breekt af', async () => {
  // Het bestand van versie A vervangen door 300 MB (zelfde soort gebruik als een echte 4K-export).
  const stored = srv.db.prepare('SELECT stored_name FROM versions WHERE id = ?').get(P.a.versionId).stored_name;
  const big = srv.created.storage.localPath(stored);
  const fd = fs.openSync(big, 'w');
  const block = crypto.randomBytes(4 * 1024 * 1024);
  for (let i = 0; i < 75; i++) fs.writeSync(fd, block);
  fs.closeSync(fd);
  srv.db.prepare('UPDATE versions SET size_bytes = ? WHERE id = ?').run(fs.statSync(big).size, P.a.versionId);
  global.gc?.();
  const before_ = process.memoryUsage().rss;
  let peak = before_;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
  const r = await slowDownload(`${srv.base}/api/delivery/${P.link}/package.zip`, async () => {});
  clearInterval(timer);
  assert.equal(r.complete, true);
  assert.equal(r.bytes, r.total);
  assert.ok(r.total > 300 * 1024 * 1024);
  assert.ok(peak - before_ < 120 * 1024 * 1024, `geheugen steeg ${Math.round((peak - before_) / 1048576)} MB bij een pakket van ${Math.round(r.total / 1048576)} MB`);

  // Intrekken nadat het eerste deel binnen is: de server stopt vóór het volgende bestand.
  const aborted = await slowDownload(`${srv.base}/api/delivery/${P.link}/package.zip`, async () => {
    await admin.post(`/api/projects/${P.projectId}/delivery-link/revoke`);
  });
  assert.equal(aborted.complete, false, 'geen ogenschijnlijk compleet pakket na intrekken');
  assert.ok(aborted.bytes < aborted.total);
  assert.equal((await client(srv.base).get(`/api/delivery/${P.link}/package.zip`)).status, 410);
});
