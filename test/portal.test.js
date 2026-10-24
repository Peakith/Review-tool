'use strict';
// Klantportaal (projectlink): alleen gepubliceerde informatie, geen goedkeuringsrechten,
// intrekken/vervangen, interne reacties en bestaande links/goedkeuringen blijven werken.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { makeVideo, startServer, client, upload, rid, setupAdmin, addMember } = require('./helpers');

let srv;
let admin;
let files;
let projectId;
let main; // hoofdvideo, v1 gepubliceerd, v2 intern concept
let teaser; // gepubliceerd
let concept; // nooit gepubliceerd
let directToken; // gewone reviewlink van de hoofdvideo

const key = (n) => `reviewer-key-${String(n).padStart(8, '0')}`;
const tokenOf = (url) => new URL(url, 'http://x').pathname.split('/').pop();

async function newVideo(file, title) {
  const created = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title })).data;
  return created;
}
async function publish(versionId) {
  assert.equal((await admin.post(`/api/versions/${versionId}/ready`)).status, 200);
  assert.equal((await admin.post(`/api/versions/${versionId}/share`)).status, 200);
}

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  files = {
    wide: makeVideo(srv.dataDir, 'hoofd.mp4'),
    wide2: makeVideo(srv.dataDir, 'hoofd_v2.mp4', 3),
    vertical: makeVideo(srv.dataDir, 'social.mp4', 2, '180x320'),
  };
  projectId = (await admin.post('/api/projects', { name: 'Campagne', clientName: 'Klant BV' })).data.id;
  main = await newVideo(files.wide, 'Hoofdvideo');
  await publish(main.versionId);
  const v2 = (await admin.post(`/api/videos/${main.videoId}/versions`, { uploadId: await upload(admin, files.wide2, { videoId: main.videoId }) })).data;
  main.v2 = v2.versionId; // blijft intern
  teaser = await newVideo(files.vertical, 'Social 9:16');
  await publish(teaser.versionId);
  concept = await newVideo(files.wide, 'Interne montage');
  const video = (await admin.get(`/api/videos/${main.videoId}`)).data;
  directToken = tokenOf(video.links.find((l) => l.role === 'reviewer').url);
});
after(() => srv.close());

async function portalLink() {
  const r = await admin.post(`/api/projects/${projectId}/portal-link`);
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.data));
  return tokenOf(r.data.link.url);
}

describe('klantportaal', () => {
  test('toont alleen gepubliceerde video’s, met de gepubliceerde versie en status', async () => {
    const token = await portalLink();
    const guest = client(srv.base);
    const p = (await guest.get(`/api/portal/${token}`)).data;
    assert.equal(p.project.name, 'Campagne');
    assert.deepEqual(p.videos.map((v) => v.title).sort(), ['Hoofdvideo', 'Social 9:16']);
    const m = p.videos.find((v) => v.title === 'Hoofdvideo');
    assert.equal(m.version.number, 1, 'interne v2 verandert de klantweergave niet');
    assert.equal(m.version.status, 'in_review');
    const s = p.videos.find((v) => v.title === 'Social 9:16');
    assert.equal(s.meta.aspect, '9:16', 'beeldverhouding herkend');
    assert.equal(s.meta.orientation, 'staand');
    const text = JSON.stringify(p);
    for (const secret of ['Interne montage', 'hoofd_v2.mp4', 'original', 'stored', 'email']) assert.ok(!text.includes(secret), `lekt niet: ${secret}`);
  });

  test('ongepubliceerde versies en video’s zijn ook via directe verzoeken niet op te vragen', async () => {
    const token = await portalLink();
    const guest = client(srv.base);
    const p = (await guest.get(`/api/portal/${token}`)).data;
    const derived = tokenOf(p.videos.find((v) => v.title === 'Hoofdvideo').href);
    for (const path of ['media', 'poster', 'comments']) {
      assert.equal((await guest.get(`/api/review/${derived}/versions/${main.v2}/${path}`)).status, 404, `interne v2 ${path}`);
      assert.equal((await guest.get(`/api/review/${derived}/versions/${concept.versionId}/${path}`)).status, 404, `concept-video ${path}`);
    }
    assert.equal((await guest.get(`/api/portal/${token}/videos/${concept.videoId}/poster`)).status, 404, 'poster van concept-video');
    const info = (await guest.get(`/api/review/${derived}`)).data;
    assert.deepEqual(info.versions.map((v) => v.number), [1]);
    // Bouwronde 5: afgeleide portaallink heeft geen downloadrecht; afspelen gaat via afspeelversies.
    assert.equal((await guest.get(`/api/review/${derived}/versions/${main.versionId}/media`)).data.code, 'original_blocked');
    // Na publiceren van v2 ziet de klant v2
    await publish(main.v2);
    const p2 = (await guest.get(`/api/portal/${token}`)).data;
    assert.equal(p2.videos.find((v) => v.title === 'Hoofdvideo').version.number, 2);
  });

  test('projectlink geeft geen goedkeuringsrechten', async () => {
    const token = await portalLink();
    const guest = client(srv.base);
    const p = (await guest.get(`/api/portal/${token}`)).data;
    const t = tokenOf(p.videos.find((v) => v.title === 'Social 9:16').href);
    const info = (await guest.get(`/api/review/${t}`)).data;
    assert.equal(info.role, 'reviewer');
    const r = await guest.post(`/api/review/${t}/versions/${teaser.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, { 'x-reviewer-key': key(1) });
    assert.equal(r.status, 403);
    // Wel reageren en feedback versturen
    assert.equal((await guest.post(`/api/review/${t}/versions/${teaser.versionId}/comments`, { body: 'Tekst groter', timecode: 1, authorName: 'Eva', requestId: rid() }, { 'x-reviewer-key': key(1) })).status, 201);
    const fb = await guest.post(`/api/review/${t}/versions/${teaser.versionId}/feedback`, { authorName: 'Eva', requestId: rid() }, { 'x-reviewer-key': key(1) });
    assert.equal(fb.status, 200);
    assert.equal(fb.data.status, 'changes_requested');
    assert.equal((await guest.get(`/api/portal/${token}`)).data.videos.find((v) => v.title === 'Social 9:16').version.status, 'changes_requested');
    // De afgeleide link staat niet tussen de links van de video (die beheer je via het portaal)
    const links = (await admin.get(`/api/videos/${teaser.videoId}`)).data.links;
    assert.ok(links.every((l) => tokenOf(l.url) !== t));
  });

  test('intrekken: portaal en via het portaal geopende video’s weg; afzonderlijke videolinks blijven', async () => {
    const token = await portalLink();
    const guest = client(srv.base);
    const derived = tokenOf((await guest.get(`/api/portal/${token}`)).data.videos[0].href);
    assert.equal((await admin.post(`/api/projects/${projectId}/portal-link/revoke`)).status, 200);
    assert.equal((await guest.get(`/api/portal/${token}`)).status, 410);
    assert.equal((await guest.get(`/api/review/${derived}`)).status, 410);
    assert.equal((await guest.get(`/api/review/${derived}/versions/${main.versionId}/media`)).status, 410);
    assert.equal((await guest.get(`/api/review/${directToken}`)).status, 200, 'gewone reviewlink werkt nog');
    const st = (await admin.get(`/api/projects/${projectId}/portal-link`)).data;
    assert.equal(st.link, null);
    assert.ok(st.separateVideoLinks >= 2, 'team ziet hoeveel losse videolinks er nog zijn');
  });

  test('vervangen: oude link werkt niet meer, nieuwe wel', async () => {
    const oldToken = await portalLink();
    const r = await admin.post(`/api/projects/${projectId}/portal-link`, { replace: true });
    assert.equal(r.status, 201);
    assert.equal(r.data.replaced, true);
    const newToken = tokenOf(r.data.link.url);
    const guest = client(srv.base);
    assert.equal((await guest.get(`/api/portal/${oldToken}`)).status, 410);
    assert.equal((await guest.get(`/api/portal/${newToken}`)).status, 200);
    assert.equal((await guest.get('/api/portal/bestaatnietbestaatnietbestaat')).status, 404);
  });

  test('alleen teamleden met publiceren/delen beheren de projectlink', async () => {
    const { client: f } = await addMember(srv, admin, { email: 'upload@freelance.nl', projects: [{ projectId, level: 'upload' }] });
    assert.equal((await f.get(`/api/projects/${projectId}/portal-link`)).status, 403);
    assert.equal((await f.post(`/api/projects/${projectId}/portal-link`)).status, 403);
    assert.equal((await f.post(`/api/projects/${projectId}/portal-link/revoke`)).status, 403);
    // Voorbeeldweergave mag wel (alleen-lezen, zelfde filters)
    const preview = (await f.get(`/api/projects/${projectId}/portal-preview`)).data;
    assert.ok(!JSON.stringify(preview).includes('Interne montage'));
    assert.ok(preview.videos.every((v) => v.href.startsWith('/voorbeeld/video/')));
  });

  test('prullenbak en archief: video weg uit portaal; project in prullenbak = portaal weg', async () => {
    const token = await portalLink();
    const guest = client(srv.base);
    await admin.del(`/api/videos/${teaser.videoId}`);
    assert.ok(!(await guest.get(`/api/portal/${token}`)).data.videos.some((v) => v.title === 'Social 9:16'));
    await admin.post('/api/trash/restore', { type: 'video', id: teaser.videoId });
    assert.ok((await guest.get(`/api/portal/${token}`)).data.videos.some((v) => v.title === 'Social 9:16'));
    await admin.post(`/api/projects/${projectId}/archive`, { archived: true });
    assert.equal((await guest.get(`/api/portal/${token}`)).data.archived, true);
    await admin.post(`/api/projects/${projectId}/archive`, { archived: false });
    await admin.del(`/api/projects/${projectId}`);
    assert.equal((await guest.get(`/api/portal/${token}`)).status, 410);
    await admin.post('/api/trash/restore', { type: 'project', id: projectId });
    assert.equal((await guest.get(`/api/portal/${token}`)).status, 200);
  });
});

describe('interne reacties', () => {
  test('teamnotities zijn standaard intern; antwoorden op klantreacties zichtbaar; omzetten kan', async () => {
    const vid = main.v2; // inmiddels gepubliceerd
    const guestKey = { 'x-reviewer-key': key(7) };
    const guest = client(srv.base);
    const clientComment = (await guest.post(`/api/review/${directToken}/versions/${vid}/comments`, { body: 'Logo te klein', timecode: 1, authorName: 'Eva', requestId: rid() }, guestKey)).data.id;
    const note = (await admin.post(`/api/versions/${vid}/comments`, { body: 'Intern: muziek nog licenseren', timecode: 2 })).data;
    assert.equal(note.internal, true);
    const reply = (await admin.post(`/api/versions/${vid}/comments`, { body: 'Passen we aan', parentId: clientComment })).data;
    assert.equal(reply.internal, false);
    const internalReply = (await admin.post(`/api/versions/${vid}/comments`, { body: 'Let op: oude huisstijl', parentId: clientComment, internal: true })).data;
    assert.equal(internalReply.internal, true);
    const forClient = (await admin.post(`/api/versions/${vid}/comments`, { body: 'Hier komt de eindtitel', timecode: 3, internal: false })).data;

    const seen = JSON.stringify((await guest.get(`/api/review/${directToken}/versions/${vid}/comments`, guestKey)).data);
    assert.ok(seen.includes('Logo te klein') && seen.includes('Passen we aan') && seen.includes('Hier komt de eindtitel'));
    assert.ok(!seen.includes('muziek nog licenseren') && !seen.includes('oude huisstijl'), 'interne notities niet zichtbaar');
    assert.ok(!seen.includes('"internal"'), 'zelfs het veld bestaat niet voor de klant');
    // Ook de voorbeeldweergave laat ze weg
    const preview = JSON.stringify((await admin.get(`/api/preview/videos/${main.videoId}/versions/${vid}/comments`)).data);
    assert.ok(!preview.includes('muziek nog licenseren'));
    // Klant kan niet antwoorden onder een interne notitie
    assert.equal((await guest.post(`/api/review/${directToken}/versions/${vid}/comments`, { body: 'x', parentId: note.id, authorName: 'Eva', requestId: rid() }, guestKey)).status, 400);
    // Omzetten: notitie zichtbaar maken en weer intern
    assert.equal((await admin.patch(`/api/comments/${note.id}`, { internal: false })).status, 200);
    assert.ok(JSON.stringify((await guest.get(`/api/review/${directToken}/versions/${vid}/comments`, guestKey)).data).includes('muziek nog licenseren'));
    assert.equal((await admin.patch(`/api/comments/${forClient.id}`, { internal: true })).status, 200);
    assert.ok(!JSON.stringify((await guest.get(`/api/review/${directToken}/versions/${vid}/comments`, guestKey)).data).includes('eindtitel'));
    // Team ziet alles, met zichtbaarheid
    const team = (await admin.get(`/api/versions/${vid}/comments`)).data;
    assert.ok(team.some((c) => c.internal === true) && team.some((c) => c.internal === false));
  });
});

describe('bestaande gegevens', () => {
  test('bestaande links, reacties en goedkeuringen blijven werken; akkoordlink keurt goed', async () => {
    const guest = client(srv.base);
    assert.equal((await guest.get(`/api/review/${directToken}`)).status, 200);
    await admin.patch(`/api/videos/${main.videoId}`, { approverName: 'Joris', approverEmail: 'joris@klant.nl' });
    const approver = tokenOf((await admin.post(`/api/videos/${main.videoId}/links`, { role: 'approver' })).data.url);
    const r = await guest.post(`/api/review/${approver}/versions/${main.v2}/approve`, { confirm: true, versionNumber: 2, requestId: rid() }, { 'x-reviewer-key': key(9) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const token = await portalLink();
    const card = (await guest.get(`/api/portal/${token}`)).data.videos.find((v) => v.title === 'Hoofdvideo');
    assert.equal(card.version.status, 'approved');
    assert.equal(card.approval.name, 'Joris');
    assert.ok(!('email' in card.approval), 'geen e-mailadres naar de klant');
  });

  test('oude teamnotities worden bij de update intern, antwoorden aan de klant blijven zichtbaar', () => {
    const { DatabaseSync } = require('node:sqlite');
    const { openDb } = require('../server/db');
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'review-migratie-'));
    try {
      // Database zoals vóór deze versie (zonder kolom internal en zonder app_meta)
      const old = new DatabaseSync(path.join(dir, 'review.db'));
      old.exec(`CREATE TABLE comments (id INTEGER PRIMARY KEY, version_id INTEGER, parent_id INTEGER, body TEXT, timecode REAL, author_name TEXT, author_type TEXT,
        user_id INTEGER, share_link_id INTEGER, reviewer_key TEXT, round_id INTEGER, resolved_at TEXT, resolved_by INTEGER, created_at TEXT);
        INSERT INTO comments (id, body, author_type, parent_id, author_name, created_at) VALUES (1, 'klant', 'guest', NULL, 'Eva', 'x'), (2, 'antwoord', 'team', 1, 'Sanne', 'x'), (3, 'notitie', 'team', NULL, 'Sanne', 'x');`);
      old.close();
      const db = openDb({ dataDir: dir, dbFile: path.join(dir, 'review.db') });
      const rows = Object.fromEntries(db.prepare('SELECT body, internal FROM comments').all().map((r) => [r.body, r.internal]));
      assert.deepEqual(rows, { klant: 0, antwoord: 0, notitie: 1 });
      // Tweede keer openen verandert niets meer (eenmalige stap)
      db.prepare('UPDATE comments SET internal = 0 WHERE id = 3').run();
      db.close();
      const again = openDb({ dataDir: dir, dbFile: path.join(dir, 'review.db') });
      assert.equal(again.prepare('SELECT internal FROM comments WHERE id = 3').get().internal, 0);
      again.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('opleveringen en merken', () => {
  test('type, beeldverhouding en kanaal; klant ziet alleen gepubliceerde', async () => {
    assert.equal((await admin.patch(`/api/videos/${teaser.videoId}`, { kind: 'social', channel: 'Instagram Reels' })).status, 200);
    assert.equal((await admin.patch(`/api/videos/${main.videoId}`, { kind: 'main', aspectRatio: '16:9' })).status, 200);
    assert.equal((await admin.patch(`/api/videos/${main.videoId}`, { kind: 'onzin' })).status, 400);
    assert.equal((await admin.patch(`/api/videos/${main.videoId}`, { aspectRatio: '7:3' })).status, 400);
    const project = (await admin.get(`/api/projects/${projectId}`)).data;
    const t = project.videos.find((v) => v.id === teaser.videoId);
    assert.equal(t.meta.kindLabel, 'Social');
    assert.equal(t.meta.channel, 'Instagram Reels');
    assert.equal(t.meta.aspect, '9:16');
    const token = await portalLink();
    const p = (await client(srv.base).get(`/api/portal/${token}`)).data;
    assert.equal(p.videos[0].title, 'Hoofdvideo', 'hoofdvideo eerst');
    assert.equal(p.videos.find((v) => v.id === teaser.videoId).meta.channel, 'Instagram Reels');
  });

  test('merk per project: naam, kleur en logo; geen SVG; standaard zonder merk', async () => {
    const guest = client(srv.base);
    const token = await portalLink();
    await admin.patch(`/api/projects/${projectId}`, { brandId: null });
    assert.equal((await guest.get(`/api/portal/${token}`)).data.brand, null, 'zonder merk de standaardweergave');
    const brands = (await admin.get('/api/brands')).data;
    assert.deepEqual(brands.map((b) => b.name).sort(), ['Moviemates', 'Studio Brutaal']);
    const mm = brands.find((b) => b.slug === 'moviemates');
    assert.equal((await admin.patch(`/api/projects/${projectId}`, { brandId: mm.id, portalIntro: 'Welkom! Hier vind je alle video’s.' })).status, 200);
    assert.equal((await admin.patch(`/api/projects/${projectId}`, { brandId: 999 })).status, 400);
    assert.equal((await admin.patch(`/api/brands/${mm.id}`, { accentColor: 'rood' })).status, 400);
    assert.equal((await admin.patch(`/api/brands/${mm.id}`, { accentColor: '#1E90FF' })).status, 200);
    let p = (await guest.get(`/api/portal/${token}`)).data;
    assert.equal(p.brand.name, 'Moviemates');
    assert.equal(p.brand.accent, '#1e90ff');
    assert.equal(p.brand.logoUrl, null, 'nog geen logo: nette standaard (naam)');
    assert.equal(p.project.intro, 'Welkom! Hier vind je alle video’s.');
    // Logo: SVG en nep-PNG geweigerd, echte PNG geaccepteerd
    const put = (body, type) => fetch(`${srv.base}/api/brands/${mm.id}/logo`, { method: 'PUT', headers: { cookie: admin.cookie(), 'x-requested-with': 'review-tool', 'content-type': type }, body });
    assert.equal((await put('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml')).status, 422);
    assert.equal((await put('<html><script>alert(1)</script></html>', 'image/png')).status, 422);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0ff0000000049454e44ae426082', 'hex');
    assert.equal((await put(png, 'image/png')).status, 200);
    assert.equal((await put(Buffer.alloc(3 * 1024 * 1024, 1), 'image/png')).status, 413);
    p = (await guest.get(`/api/portal/${token}`)).data;
    const logo = await fetch(`${srv.base}${p.brand.logoUrl}`);
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get('content-type'), 'image/png');
    assert.match(logo.headers.get('content-security-policy'), /sandbox/);
    // Alleen beheerders wijzigen merken
    const { client: f } = await addMember(srv, admin, { email: 'merk@freelance.nl', projects: [{ projectId, level: 'manage' }] });
    assert.equal((await f.patch(`/api/brands/${mm.id}`, { accentColor: '#000000' })).status, 403);
    // De reviewpagina toont hetzelfde merk
    const derived = tokenOf(p.videos[0].href);
    assert.equal((await guest.get(`/api/review/${derived}`)).data.brand.name, 'Moviemates');
    assert.equal((await guest.get(`/api/review/${directToken}`)).data.brand.name, 'Moviemates');
  });
});
