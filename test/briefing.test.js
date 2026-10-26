'use strict';
// Briefing en referenties: zichtbaarheid per onderdeel, rechten, bestandscontrole en veilige
// headers, prullenbak, opslagoverzicht en back-up/herstel van bijlagen.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeVideo, startServer, client, setupAdmin, addMember } = require('./helpers');
const { createBackup, verifyBackup, restoreBackup } = require('../server/backup');
const { createApp } = require('../server/app');

let srv;
let admin;
let projectId;
let otherProjectId;
let portal;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0ff0000000049454e44ae426082', 'hex');

/** Bijlage uploaden zoals de browser: upload starten, blokken sturen, onderdeel aanmaken. */
async function attach(c, pid, filename, buf, extra = {}) {
  const init = await c.post('/api/uploads', { filename, size: buf.length, projectId: pid, purpose: 'attachment' });
  if (init.status !== 201) return init;
  const { id, chunkSize } = init.data;
  for (let offset = 0; offset < buf.length; offset += chunkSize) {
    const r = await c.put(`/api/uploads/${id}?offset=${offset}`, buf.subarray(offset, offset + chunkSize));
    assert.equal(r.status, 200);
  }
  return c.post(`/api/projects/${pid}/briefing`, { kind: 'file', uploadId: id, ...extra });
}

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  projectId = (await admin.post('/api/projects', { name: 'Briefingproject' })).data.id;
  otherProjectId = (await admin.post('/api/projects', { name: 'Ander project' })).data.id;
  portal = new URL((await admin.post(`/api/projects/${projectId}/portal-link`)).data.link.url).pathname.split('/').pop();
});
after(() => srv.close());

describe('briefing en referenties', () => {
  test('nieuwe onderdelen zijn intern; alleen gedeelde onderdelen zijn voor de klant zichtbaar en opvraagbaar', async () => {
    const text = (await admin.post(`/api/projects/${projectId}/briefing`, { kind: 'text', title: 'Briefing', body: 'Doelgroep: jonge ouders. Budget: geheim.' })).data;
    assert.equal(text.visibility, 'internal');
    const link = (await admin.post(`/api/projects/${projectId}/briefing`, { kind: 'link', url: 'https://example.com/moodboard', title: 'Moodboard' })).data;
    const pdf = (await attach(admin, projectId, 'Script v2.pdf', PDF)).data;
    assert.equal(pdf.visibility, 'internal');
    const png = (await attach(admin, projectId, 'Referentie.png', PNG, { visibility: 'client' })).data;
    assert.equal(png.visibility, 'client');

    const guest = client(srv.base);
    let p = (await guest.get(`/api/portal/${portal}`)).data;
    assert.deepEqual(p.briefing.map((b) => b.title), ['Referentie.png']);
    assert.ok(!JSON.stringify(p).includes('geheim'));
    // Direct opvragen van een intern bestand via het portaal: bestaat niet
    assert.equal((await guest.get(`/api/portal/${portal}/briefing/${pdf.id}/file`)).status, 404);
    assert.equal((await guest.get(`/api/portal/${portal}/briefing/${text.id}/file`)).status, 404);
    // Teamroute zonder sessie: geen toegang
    assert.equal((await guest.get(`/api/briefing/${pdf.id}/file`)).status, 401);
    // Gedeeld bestand wel, met veilige headers
    const r = await fetch(`${srv.base}${p.briefing[0].file.url}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /sandbox/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(r.headers.get('content-disposition'), /^inline; filename="Referentie.png"/);

    // Delen en weer intern maken
    assert.equal((await admin.patch(`/api/briefing/${text.id}`, { visibility: 'client' })).status, 200);
    assert.equal((await admin.patch(`/api/briefing/${link.id}`, { visibility: 'client' })).status, 200);
    p = (await guest.get(`/api/portal/${portal}`)).data;
    assert.ok(p.briefing.some((b) => b.body.includes('jonge ouders')));
    assert.equal(p.briefing.find((b) => b.kind === 'link').url, 'https://example.com/moodboard');
    assert.equal((await admin.patch(`/api/briefing/${text.id}`, { visibility: 'internal' })).status, 200);
    assert.ok(!JSON.stringify((await guest.get(`/api/portal/${portal}`)).data).includes('jonge ouders'));
    // Voorbeeldweergave voor het team toont hetzelfde als de klant
    const preview = (await admin.get(`/api/projects/${projectId}/portal-preview`)).data;
    assert.deepEqual(preview.briefing.map((b) => b.title).sort(), p.briefing.map((b) => b.title).sort().filter((t) => t !== 'Briefing'));
  });

  test('rechten: geen toegang = 404; bekijken = lezen; uploaden = intern toevoegen; delen vraagt publiceren', async () => {
    const pdf = (await attach(admin, projectId, 'Contract.pdf', PDF)).data;
    const { client: none } = await addMember(srv, admin, { email: 'geen@b.nl', projects: [{ projectId: otherProjectId, level: 'manage' }] });
    assert.equal((await none.get(`/api/projects/${projectId}/briefing`)).status, 404);
    assert.equal((await none.get(`/api/briefing/${pdf.id}/file`)).status, 404);
    assert.equal((await none.patch(`/api/briefing/${pdf.id}`, { visibility: 'client' })).status, 404);

    const { client: view } = await addMember(srv, admin, { email: 'kijk@b.nl', projects: [{ projectId, level: 'view' }] });
    assert.equal((await view.get(`/api/projects/${projectId}/briefing`)).status, 200);
    assert.equal((await view.get(`/api/briefing/${pdf.id}/file`)).status, 200);
    assert.equal((await view.post(`/api/projects/${projectId}/briefing`, { kind: 'text', body: 'x' })).status, 403);
    assert.equal((await view.post('/api/uploads', { filename: 'a.pdf', size: 10, projectId, purpose: 'attachment' })).status, 403);

    const { client: up } = await addMember(srv, admin, { email: 'upload@b.nl', projects: [{ projectId, level: 'upload' }] });
    assert.equal((await up.post(`/api/projects/${projectId}/briefing`, { kind: 'text', body: 'Notitie' })).status, 201);
    assert.equal((await up.post(`/api/projects/${projectId}/briefing`, { kind: 'text', body: 'Voor klant', visibility: 'client' })).status, 403);
    assert.equal((await up.patch(`/api/briefing/${pdf.id}`, { visibility: 'client' })).status, 403);
    // Bijlage van een ander project gebruiken mag niet
    const init = (await admin.post('/api/uploads', { filename: 'x.pdf', size: PDF.length, projectId: otherProjectId, purpose: 'attachment' })).data;
    await admin.put(`/api/uploads/${init.id}?offset=0`, PDF);
    assert.equal((await admin.post(`/api/projects/${projectId}/briefing`, { kind: 'file', uploadId: init.id })).status, 400);
  });

  test('bestandstype en grootte worden gecontroleerd; geen HTML, SVG of vermomde bestanden', async () => {
    const bad = async (name, buf, status) => {
      const r = await attach(admin, projectId, name, buf);
      assert.equal(r.status, status, `${name}: ${JSON.stringify(r.data)}`);
    };
    await bad('pagina.html', Buffer.from('<html><script>alert(1)</script></html>'), 400);
    await bad('logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 400);
    await bad('nep.pdf', Buffer.from('<html><script>alert(document.cookie)</script></html>'), 422);
    await bad('nep.png', PDF, 422);
    await bad('programma.exe', Buffer.from('MZ'), 400);
    const tooBig = await admin.post('/api/uploads', { filename: 'groot.png', size: 31 * 1024 * 1024, projectId, purpose: 'attachment' });
    assert.equal(tooBig.status, 413);
    assert.match(tooBig.data.error, /te groot/);
    // Een vermomd bestand blijft niet achter in de tijdelijke map
    assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM uploads WHERE purpose = 'attachment'").get().n, 1, 'alleen de bewust niet afgeronde upload uit de vorige test');
    // Links: alleen http(s)
    assert.equal((await admin.post(`/api/projects/${projectId}/briefing`, { kind: 'link', url: 'javascript:alert(1)' })).status, 400);
    assert.equal((await admin.post(`/api/projects/${projectId}/briefing`, { kind: 'link', url: 'geen link' })).status, 400);
    // Een bijlage-upload kan niet als video worden gebruikt (en andersom)
    const init = (await admin.post('/api/uploads', { filename: 'ref.mp4', size: 100, projectId, purpose: 'attachment' })).data;
    assert.equal((await admin.post(`/api/projects/${projectId}/videos`, { uploadId: init.id })).status, 400);
  });

  test('referentievideo als bijlage; prullenbak blokkeert toegang; terugzetten; definitief verwijderen ruimt op', async () => {
    const mp4 = fs.readFileSync(makeVideo(srv.dataDir, 'referentie.mp4'));
    const item = (await attach(admin, projectId, 'Referentie stijl.mp4', mp4, { visibility: 'client' })).data;
    assert.equal(item.file.mime, 'video/mp4');
    const guest = client(srv.base);
    const fileUrl = (await guest.get(`/api/portal/${portal}`)).data.briefing.find((b) => b.id === item.id).file.url;
    const range = await fetch(`${srv.base}${fileUrl}`, { headers: { range: 'bytes=0-99' } });
    assert.equal(range.status, 206, 'afspelen met spoelen (Range) werkt');

    assert.equal((await admin.del(`/api/briefing/${item.id}`)).status, 200);
    assert.equal((await guest.get(fileUrl)).status, 404, 'klant: weg');
    assert.equal((await admin.get(`/api/briefing/${item.id}/file`)).status, 410, 'team: in prullenbak');
    const trash = (await admin.get('/api/trash')).data;
    const entry = trash.items.find((i) => i.type === 'briefing' && i.id === item.id);
    assert.ok(entry && entry.bytes === mp4.length);
    assert.equal((await admin.post('/api/trash/restore', { type: 'briefing', id: item.id })).status, 200);
    assert.equal((await guest.get(fileUrl)).status, 200, 'na terugzetten weer bereikbaar');

    await admin.del(`/api/briefing/${item.id}`);
    const prev = (await admin.get(`/api/trash/briefing/${item.id}/purge-preview`)).data;
    assert.equal(prev.fileCount, 1);
    assert.equal(prev.totalBytes, mp4.length);
    const key = srv.db.prepare('SELECT file_key FROM briefing_items WHERE id = ?').get(item.id).file_key;
    assert.ok(fs.existsSync(path.join(srv.config.mediaDir, key)));
    const purge = await admin.post(`/api/trash/briefing/${item.id}/purge`, { confirm: true, expectedFiles: 1 });
    assert.equal(purge.status, 200);
    assert.equal(purge.data.freedBytes, mp4.length);
    assert.ok(!fs.existsSync(path.join(srv.config.mediaDir, key)));
  });
});

test('bijlagen tellen mee in het opslaggebruik en gaan mee in back-up en herstel', async () => {
  const s = await startServer();
  let restored;
  try {
    const a = await setupAdmin(s);
    const pid = (await a.post('/api/projects', { name: 'Opslag' })).data.id;
    const item = (await attach(a, pid, 'Moodboard.pdf', PDF, {})).data;
    const shared = (await attach(a, pid, 'Logo klant.png', PNG, { visibility: 'client' })).data;
    const report = (await a.get('/api/storage')).data;
    assert.equal(report.totals.attachments, PDF.length + PNG.length);
    assert.equal(report.projects.find((p) => p.id === pid).attachments, PDF.length + PNG.length);
    assert.ok(report.totals.all >= PDF.length + PNG.length);

    const b = await createBackup({ db: s.db, config: s.config, storage: s.created.storage });
    assert.equal(b.manifest.complete, true);
    const keys = s.db.prepare('SELECT file_key FROM briefing_items').all().map((r) => r.file_key);
    assert.deepEqual(b.manifest.files.map((f) => f.key).sort(), keys.sort());
    assert.equal(b.manifest.counts.briefing_items, 2);
    assert.ok((await verifyBackup(b.dir)).ok);

    // Herstellen in een lege map en daar opstarten
    const dataDir = `${s.dataDir}-hersteld`;
    await restoreBackup({ backupPath: b.dir, dataDir, mediaDir: path.join(dataDir, 'media') });
    restored = createApp({ dataDir, backupDir: `${dataDir}-backups`, minFreeBytes: 0, env: { ...process.env, STUDIO_REVIEW_HOME: `${dataDir}-home`, DATA_DIR: '' } });
    const server = await new Promise((res) => { const l = restored.app.listen(0, () => res(l)); });
    restored.close = () => new Promise((r) => server.close(r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const c = client(base);
    assert.equal((await c.post('/api/login', { email: 'beheer@agency.nl', password: 'een-lang-wachtwoord' })).status, 200);
    const list = (await c.get(`/api/projects/${pid}/briefing`)).data.items;
    assert.deepEqual(list.map((i) => i.file.name).sort(), ['Logo klant.png', 'Moodboard.pdf']);
    const pdf = await fetch(`${base}/api/briefing/${item.id}/file`, { headers: { cookie: c.cookie() } });
    assert.equal(pdf.status, 200);
    assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), PDF);
    assert.equal(list.find((i) => i.id === shared.id).visibility, 'client', 'zichtbaarheid hersteld');
  } finally {
    if (restored) { restored.stop(); await restored.close(); restored.db.close(); fs.rmSync(`${s.dataDir}-hersteld`, { recursive: true, force: true }); }
    await s.close();
  }
});
