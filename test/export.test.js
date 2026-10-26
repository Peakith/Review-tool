'use strict';
// Bouwronde 3, deel C: feedbackexport (PDF en CSV), afscherming en leesbaarheid.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeVideo, startServer, client, upload, rid, setupAdmin, addMember } = require('./helpers');
const { cell } = require('../server/export');

let srv;
let admin;
let projectId;
let video;
let token;
let portalToken;
let concept;
const key = { 'x-reviewer-key': 'export-reviewer-key-0001' };
const SPECIAL = 'Prijs: € 1.250, "logo" — groter\nTweede regel; met puntkomma en ë/ï';
const FORMULAS = ['=HYPERLINK("http://kwaad.example")', '+31 6 1234 5678', '-5+3', '@SUM(A1)'];

/** Eenvoudige CSV-lezer (RFC 4180, met ; als scheiding) om de export echt te parsen. */
function parseCsv(text, sep = ';') {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; } else if (ch === '\r' && text[i + 1] === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const get = async (url, c = admin) => {
  const res = await fetch(`${srv.base}${url}`, { headers: { cookie: c?.cookie?.() || '' } });
  return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
};
const pdfText = (buf) => {
  const f = path.join(srv.dataDir, `x-${Date.now()}.pdf`);
  fs.writeFileSync(f, buf);
  return execFileSync('pdftotext', ['-layout', f, '-']).toString();
};

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  const brand = (await admin.get('/api/brands')).data.find((b) => b.slug === 'moviemates');
  projectId = (await admin.post('/api/projects', { name: 'Exportproject', clientName: 'Bakkerij Jansen', brandId: brand.id })).data.id;
  const file = makeVideo(srv.dataDir, 'clip.mp4', 6);
  video = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title: 'Campagnefilm — Hoofdvideo' })).data;
  await admin.post(`/api/versions/${video.versionId}/ready`);
  await admin.post(`/api/versions/${video.versionId}/share`, { round: 'new', requestId: rid() });
  token = new URL((await admin.get(`/api/videos/${video.videoId}`)).data.links[0].url).pathname.split('/').pop();
  const guest = client(srv.base);
  const say = (body, extra = {}) => guest.post(`/api/review/${token}/versions/${video.versionId}/comments`, { body, timecode: 1, authorName: 'Eva', requestId: rid(), ...extra }, key);
  const special = (await say(SPECIAL)).data.id;
  for (const f of FORMULAS) await say(f);
  await say('Muziek zachter', { timecode: 2, timecodeEnd: 4 });
  await say('Zie tekening', { timecode: 3, annotation: { v: 1, shapes: [{ t: 'rect', c: '#ffd60a', a: [0.2, 0.2], b: [0.6, 0.6] }] } });
  await guest.post(`/api/review/${token}/versions/${video.versionId}/feedback`, { authorName: 'Eva', requestId: rid() }, key);
  await admin.post(`/api/versions/${video.versionId}/comments`, { body: 'GEHEIM: budget is op', timecode: 1 }); // intern
  await admin.post(`/api/versions/${video.versionId}/comments`, { body: 'Passen we aan', parentId: special }); // zichtbaar antwoord
  await admin.post(`/api/versions/${video.versionId}/comments`, { body: 'GEHEIM antwoord', parentId: special, internal: true });
  await admin.post(`/api/comments/${special}/task`, { priority: 'high', note: 'GEHEIME taaknotitie', dueDate: '2026-11-05' });
  // Nieuwe interne versie met een reactie: nooit in een klantexport
  const v2 = (await admin.post(`/api/videos/${video.videoId}/versions`, { uploadId: await upload(admin, file, { videoId: video.videoId }) })).data;
  await admin.post(`/api/versions/${v2.versionId}/comments`, { body: 'GEHEIM: reactie op concept v2', timecode: 1, internal: false });
  // Video die nooit is gepubliceerd
  concept = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title: 'Interne montage GEHEIM' })).data;
  portalToken = new URL((await admin.post(`/api/projects/${projectId}/portal-link`)).data.link.url).pathname.split('/').pop();
});
after(() => srv.close());

describe('CSV', () => {
  test('standaard: alleen klantzichtbare feedback van gepubliceerde versies; leesbaar en veilig', async () => {
    const r = await get(`/api/projects/${projectId}/export.csv`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv; charset=utf-8/);
    assert.match(r.headers.get('content-disposition'), /Feedback - Exportproject - 2 video's\.csv/);
    const text = r.buf.toString('utf8');
    assert.equal(text.charCodeAt(0), 0xfeff, 'UTF-8 BOM voor Excel/Numbers');
    assert.ok(!text.includes('GEHEIM'), 'geen interne notities, taken, concepten of interne versies');
    const rows = parseCsv(text.slice(1));
    const head = rows[0];
    assert.ok(!head.includes('Interne toelichting'));
    const col = (name) => head.indexOf(name);
    const body = rows.slice(1).map((r) => r[col('Reactie')]);
    assert.ok(body.includes(SPECIAL), 'komma’s, aanhalingstekens, puntkomma’s, regeleinden en bijzondere tekens blijven intact');
    for (const f of FORMULAS) assert.ok(body.includes(`'${f}`), `formule onschadelijk: ${f}`);
    const range = rows.find((r) => r[col('Reactie')] === 'Muziek zachter');
    assert.deepEqual([range[col('Tijdcode')], range[col('Tot')]], ['0:02', '0:04']);
    assert.equal(rows.find((r) => r[col('Reactie')] === 'Zie tekening')[col('Tekening')], 'ja');
    const reply = rows.find((r) => r[col('Reactie')] === 'Passen we aan');
    assert.match(reply[col('Soort')], /^Antwoord op \d+$/);
    assert.equal(rows.find((r) => r[col('Reactie')] === SPECIAL)[col('Reviewronde')], '1');
    assert.equal(rows.find((r) => r[col('Reactie')] === SPECIAL)[col('Afhandelstatus')], 'Open');
    assert.ok(rows.every((r) => r.length === head.length), 'elke regel heeft evenveel kolommen');
  });

  test('intern (expliciet): interne notities, taken en concepten, duidelijk gemarkeerd', async () => {
    const r = await get(`/api/projects/${projectId}/export.csv?intern=1`);
    assert.match(r.headers.get('content-disposition'), /INTERN\.csv/);
    const text = r.buf.toString('utf8');
    for (const s of ['GEHEIM: budget is op', 'GEHEIME taaknotitie', 'GEHEIM antwoord', 'GEHEIM: reactie op concept v2']) assert.ok(text.includes(s), s);
    const rows = parseCsv(text.slice(1));
    const head = rows[0];
    assert.ok(head.includes('Zichtbaarheid') && head.includes('Verantwoordelijke'));
    assert.equal(rows.find((r) => r.includes('GEHEIM: budget is op'))[head.indexOf('Zichtbaarheid')], 'Intern');
    assert.equal(rows.find((r) => r.includes(SPECIAL))[head.indexOf('Prioriteit')], 'Hoog');
  });

  test('selectie van video’s en komma als scheiding', async () => {
    const r = await get(`/api/projects/${projectId}/export.csv?videos=${video.videoId}&scheiding=komma`);
    const rows = parseCsv(r.buf.toString('utf8').slice(1), ',');
    assert.ok(rows.slice(1).every((x) => x[1] === 'Campagnefilm — Hoofdvideo'));
    assert.equal((await get(`/api/projects/${projectId}/export.csv?videos=99999`)).status, 404);
  });

  test('formulebescherming per cel', () => {
    assert.equal(cell('=1+1'), '"\'=1+1"');
    assert.equal(cell('Gewoon "tekst"'), '"Gewoon ""tekst"""');
    assert.equal(cell(12), '"12"');
  });
});

describe('PDF', () => {
  test('overzichtelijke PDF met branding, versie, ronde, tijdcodes, antwoorden en tekening', async () => {
    const r = await get(`/api/videos/${video.videoId}/export.pdf`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.equal(r.buf.subarray(0, 5).toString(), '%PDF-');
    const t = pdfText(r.buf);
    for (const s of ['Moviemates', 'Feedback · Exportproject', 'Campagnefilm — Hoofdvideo', 'Versie 1', 'reviewronde 1', 'Eva (Klant)', '0:02–0:04', 'Muziek zachter', 'Passen we aan', 'Tekening op 0:03', 'Pagina 1 van']) {
      assert.ok(t.includes(s), `PDF bevat “${s}”`);
    }
    assert.ok(t.includes('Prijs: € 1.250, "logo" — groter'), 'bijzondere tekens in de PDF');
    assert.ok(!t.includes('GEHEIM') && !t.includes('INTERN'), 'geen interne gegevens');
    assert.ok(r.buf.includes('/Subtype /Image'), 'videobeeld bij de tekening');
  });

  test('interne PDF is op elke pagina als INTERN gemarkeerd', async () => {
    const r = await get(`/api/projects/${projectId}/export.pdf?intern=1`);
    const t = pdfText(r.buf);
    assert.ok(t.includes('INTERN — bevat interne notities en taken'));
    assert.ok(t.includes('GEHEIM: budget is op') && t.includes('GEHEIME taaknotitie'));
    const pages = t.split('\f').filter((p) => p.trim());
    assert.ok(pages.every((p) => p.includes('INTERN — niet delen met de klant')), 'markering op elke pagina');
  });
});

describe('afscherming', () => {
  test('klant: export via reviewlink en portaal bevat nooit interne gegevens, ook niet met ?intern=1', async () => {
    for (const url of [`/api/review/${token}/export.csv?intern=1`, `/api/review/${token}/export.pdf?intern=1`, `/api/portal/${portalToken}/export.csv?intern=1`, `/api/portal/${portalToken}/export.pdf?intern=1`]) {
      const r = await get(url, null);
      assert.equal(r.status, 200, url);
      const text = url.endsWith('csv?intern=1') ? r.buf.toString('utf8') : pdfText(r.buf);
      assert.ok(!text.includes('GEHEIM') && !text.includes('INTERN'), `geen interne gegevens: ${url}`);
      assert.ok(text.includes('Muziek zachter'), url);
    }
    // Portaal: alleen gepubliceerde video's (de interne montage niet)
    const csv = (await get(`/api/portal/${portalToken}/export.csv`, null)).buf.toString('utf8');
    assert.ok(!csv.includes('Interne montage'));
  });

  test('rechten: geen toegang → 404; ingetrokken link → 410; prullenbak → 410', async () => {
    const { client: other } = await addMember(srv, admin, { email: 'buiten@x.nl', projects: [] });
    assert.equal((await get(`/api/projects/${projectId}/export.pdf`, other)).status, 404);
    assert.equal((await get(`/api/videos/${video.videoId}/export.csv`, other)).status, 404);
    assert.equal((await get(`/api/projects/${projectId}/export.csv`, null)).status, 401);
    const { client: viewer } = await addMember(srv, admin, { email: 'kijker@x.nl', projects: [{ projectId, level: 'view' }] });
    assert.equal((await get(`/api/projects/${projectId}/export.csv`, viewer)).status, 200);
    await admin.post(`/api/projects/${projectId}/portal-link/revoke`);
    assert.equal((await get(`/api/portal/${portalToken}/export.csv`, null)).status, 410);
    await admin.del(`/api/videos/${video.videoId}`);
    assert.equal((await get(`/api/review/${token}/export.pdf`, null)).status, 410);
    assert.equal((await get(`/api/videos/${video.videoId}/export.pdf`)).status, 410);
    await admin.post('/api/trash/restore', { type: 'video', id: video.videoId });
    void concept;
  });
});
