'use strict';
// Bouwronde 5, fase B: klanten en klantportaal, klanttoegang per project, eenvoudiger goedkeuren via
// een persoonlijke portaallink, taal, vorige/volgende en linkbeveiliging (wachtwoord, vervaldatum).
const fs = require('node:fs');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { makeVideo, startServer, client, upload, rid, setupAdmin, addMember } = require('./helpers');
const { createBackup, restoreBackup } = require('../server/backup');

let srv;
let admin;
let file;
let clientId;
let otherClientId;
let A; // project A (actief) van klant: hoofdvideo (akkoordgever Joris), teaser (akkoordgever Sanne), concept (niet gepubliceerd)
let B; // project B (afgerond) van klant
let C; // project C: zelfde klantnaam, maar NIET gekoppeld
let D; // project D: andere klant
const key = { 'x-reviewer-key': 'klant-reviewer-key-0001' };
const tokenOf = (url) => new URL(url, 'http://x').pathname.split('/').pop();

async function project(name, clientName = 'Bakkerij Jansen') {
  return (await admin.post('/api/projects', { name, clientName })).data.id;
}
async function video(projectId, title, { publish = true, approver = null } = {}) {
  const created = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title })).data;
  if (publish) {
    assert.equal((await admin.post(`/api/versions/${created.versionId}/ready`)).status, 200);
    assert.equal((await admin.post(`/api/versions/${created.versionId}/share`, { requestId: rid() })).status, 200);
  }
  if (approver) assert.equal((await admin.patch(`/api/videos/${created.videoId}`, { approverName: approver[0], approverEmail: approver[1] })).status, 200);
  return created;
}
const reviewToken = async (videoId) => tokenOf((await admin.get(`/api/videos/${videoId}`)).data.links.find((l) => l.role === 'reviewer').url);
async function clientLink(id, body = {}) {
  const r = await admin.post(`/api/clients/${id}/links`, body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { ...r.data, token: tokenOf(r.data.url) };
}
/** Portaal openen en de video (op titel) teruggeven, met het token van de afgeleide reviewlink. */
async function portalVideo(guest, token, title) {
  const p = (await guest.get(`/api/client/${token}`)).data;
  for (const pr of p.projects) {
    const v = pr.videos.find((x) => x.title === title);
    if (v) return { ...v, token: v.href ? tokenOf(v.href) : null, project: pr };
  }
  return null;
}

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  file = makeVideo(srv.dataDir, 'klant.mp4', 2);
  clientId = (await admin.post('/api/clients', { name: 'Bakkerij Jansen', language: 'nl' })).data.id;
  otherClientId = (await admin.post('/api/clients', { name: 'Garage Pietersen', language: 'en' })).data.id;
  A = { id: await project('Voorjaarscampagne') };
  A.main = await video(A.id, 'Hoofdfilm', { approver: ['Joris Bakker', 'joris@jansen.nl'] });
  A.teaser = await video(A.id, 'Teaser', { approver: ['Sanne Smit', 'sanne@jansen.nl'] });
  A.concept = await video(A.id, 'Interne montage', { publish: false });
  B = { id: await project('Kerstfilm 2025') };
  B.main = await video(B.id, 'Kerstfilm');
  C = { id: await project('Niet gekoppeld') };
  C.main = await video(C.id, 'Losse video');
  D = { id: await project('Werkplaats', 'Garage Pietersen') };
  D.main = await video(D.id, 'Werkplaatsfilm');
  for (const p of [A, B]) assert.equal((await admin.put(`/api/projects/${p.id}/client`, { clientId })).status, 200);
  assert.equal((await admin.put(`/api/projects/${D.id}/client`, { clientId: otherClientId })).status, 200);
  assert.equal((await admin.put(`/api/projects/${B.id}/client-visibility`, { visibility: 'completed' })).status, 200);
});
after(() => srv.close());

describe('klanten (team)', () => {
  test('alleen expliciet gekoppelde projecten; nooit op basis van een overeenkomende klantnaam', async () => {
    const c = (await admin.get(`/api/clients/${clientId}`)).data;
    assert.deepEqual(c.projects.map((p) => p.name).sort(), ['Kerstfilm 2025', 'Voorjaarscampagne']);
    assert.ok(c.assignable.some((p) => p.id === C.id), 'project met dezelfde klantnaam staat alleen bij “koppelen”');
    assert.equal(c.projects.find((p) => p.id === B.id).visibility, 'completed');
    const proj = (await admin.get(`/api/projects/${A.id}`)).data;
    assert.deepEqual(proj.client, { id: clientId, name: 'Bakkerij Jansen' });
    assert.equal(proj.clientVisibility, 'active');
  });

  test('rechten: freelancer ziet alleen klanten en projecten waar hij toegang toe heeft, geen links', async () => {
    const free = await addMember(srv, admin, { email: 'free@studio.nl', projects: [{ projectId: A.id, level: 'view' }] });
    const list = (await free.client.get('/api/clients')).data;
    assert.deepEqual(list.clients.map((c) => c.name), ['Bakkerij Jansen'], 'Garage Pietersen is onzichtbaar');
    assert.equal(list.clients[0].projectCount, 1);
    assert.equal(list.clients[0].activeLinks, null);
    const detail = (await free.client.get(`/api/clients/${clientId}`)).data;
    assert.deepEqual(detail.projects.map((p) => p.id), [A.id]);
    assert.equal(detail.hiddenProjects, 1);
    assert.deepEqual(detail.links, []);
    assert.deepEqual(detail.assignable, [], 'met alleen “bekijken” kan hij niets koppelen');
    assert.equal(JSON.stringify(detail).includes('Kerstfilm'), false, 'geen namen van projecten zonder toegang');
    assert.equal((await free.client.get(`/api/clients/${otherClientId}`)).status, 404);
    assert.equal((await free.client.post('/api/clients', { name: 'X' })).status, 403);
    assert.equal((await free.client.post(`/api/clients/${clientId}/links`, {})).status, 403);
    assert.equal((await free.client.put(`/api/projects/${A.id}/client`, { clientId: null })).status, 403);
    assert.equal((await free.client.put(`/api/projects/${A.id}/client-visibility`, { visibility: 'off' })).status, 403);
    assert.equal((await free.client.put(`/api/projects/${D.id}/client`, { clientId })).status, 404);
    // Met “Beheren” op een eigen project mag hij dat project koppelen.
    const mgr = await addMember(srv, admin, { email: 'mgr@studio.nl', projects: [{ projectId: C.id, level: 'manage' }] });
    const own = (await mgr.client.get('/api/clients')).data;
    assert.deepEqual(own.clients, [], 'nog geen gekoppeld project: geen klanten zichtbaar');
    assert.equal((await mgr.client.put(`/api/projects/${C.id}/client-visibility`, { visibility: 'active' })).status, 200);
  });

  test('ongeldige invoer wordt geweigerd', async () => {
    assert.equal((await admin.post('/api/clients', { name: '' })).status, 400);
    assert.equal((await admin.post('/api/clients', { name: 'X', language: 'de' })).status, 400);
    assert.equal((await admin.put(`/api/projects/${A.id}/client-visibility`, { visibility: 'verborgen' })).status, 400);
    assert.equal((await admin.put(`/api/projects/${A.id}/client`, { clientId: 9999 })).status, 404);
    assert.equal((await admin.post(`/api/clients/${clientId}/links`, { approverEmail: 'geen-adres' })).status, 400);
    assert.equal((await admin.post(`/api/clients/${clientId}/links`, { approverEmail: 'a@b.nl' })).status, 400, 'naam ontbreekt');
    assert.equal((await admin.del(`/api/clients/${clientId}`)).status, 409, 'nog projecten gekoppeld');
  });
});

describe('klantportaal', () => {
  test('klant → projecten → gepubliceerde video’s; afgerond ingeklapt; andere klanten en concepten onzichtbaar', async () => {
    const link = await clientLink(clientId);
    const guest = client(srv.base);
    const r = await guest.get(`/api/client/${link.token}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.client.name, 'Bakkerij Jansen');
    assert.equal(r.data.language, 'nl');
    assert.equal(r.data.identity, null);
    assert.deepEqual(r.data.projects.map((p) => [p.name, p.completed]), [['Voorjaarscampagne', false], ['Kerstfilm 2025', true]]);
    assert.deepEqual(r.data.projects[0].videos.map((v) => v.title).sort(), ['Hoofdfilm', 'Teaser']);
    const all = JSON.stringify(r.data);
    for (const hidden of ['Interne montage', 'Niet gekoppeld', 'Losse video', 'Werkplaats', 'joris@jansen.nl']) assert.equal(all.includes(hidden), false, hidden);
    // Thumbnail via het portaal; niet van een project van een andere klant
    const v = r.data.projects[0].videos[0];
    assert.equal((await guest.get(v.posterUrl)).status, 200);
    assert.equal((await guest.get(`/api/client/${link.token}/projects/${D.id}/videos/${D.main.videoId}/poster`)).status, 404);
    assert.equal((await guest.get(`/api/client/${link.token}/projects/${C.id}/videos/${C.main.videoId}/poster`)).status, 404);
  });

  test('algemene klantlink geeft nooit goedkeuringsrechten', async () => {
    const link = await clientLink(clientId);
    const guest = client(srv.base);
    const v = await portalVideo(guest, link.token, 'Hoofdfilm');
    assert.equal(v.canApprove, false);
    const info = (await guest.get(`/api/review/${v.token}`)).data;
    assert.equal(info.role, 'reviewer');
    const res = await guest.post(`/api/review/${v.token}/versions/${A.main.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key);
    assert.equal(res.status, 403);
  });

  test('persoonlijke link: alleen goedkeuren als aangewezen akkoordgever, exacte versie, idempotent', async () => {
    const link = await clientLink(clientId, { approverName: 'Joris Bakker', approverEmail: 'Joris@Jansen.nl' });
    assert.equal(link.personal, true);
    const guest = client(srv.base);
    const portal = (await guest.get(`/api/client/${link.token}`)).data;
    assert.deepEqual(portal.identity, { name: 'Joris Bakker', personal: true });
    const main = await portalVideo(guest, link.token, 'Hoofdfilm');
    const teaser = await portalVideo(guest, link.token, 'Teaser');
    assert.equal(main.canApprove, true);
    assert.equal(teaser.canApprove, false, 'Sanne is akkoordgever van de teaser');
    const info = (await guest.get(`/api/review/${main.token}`)).data;
    assert.equal(info.role, 'approver');
    assert.deepEqual(info.identity, { name: 'Joris Bakker', verified: true });
    assert.equal((await guest.get(`/api/review/${teaser.token}`)).data.role, 'reviewer');
    assert.equal((await guest.post(`/api/review/${teaser.token}/versions/${A.teaser.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key)).status, 403);
    // Verkeerd versienummer (verouderde pagina) wordt geweigerd
    assert.equal((await guest.post(`/api/review/${main.token}/versions/${A.main.versionId}/approve`, { confirm: true, versionNumber: 2, requestId: rid() }, key)).status, 409);
    const id = rid();
    const ok = await guest.post(`/api/review/${main.token}/versions/${A.main.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: id }, key);
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.status, 'approved');
    const again = await guest.post(`/api/review/${main.token}/versions/${A.main.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: id }, key);
    assert.equal(again.data.replayed, true);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM approvals WHERE version_id = ?').get(A.main.versionId).n, 1);
    const a = srv.db.prepare('SELECT * FROM approvals WHERE version_id = ?').get(A.main.versionId);
    assert.equal(a.approver_email, 'joris@jansen.nl');
    // Het team ziet de goedkeuring als echte klantgoedkeuring (vrijgeefbaar)
    const team = (await admin.get(`/api/videos/${A.main.videoId}`)).data;
    assert.equal(team.versions[0].releasable, true);
  });

  test('ingetrokken goedkeuring is voor de klant zichtbaar, en opnieuw goedkeuren kan', async () => {
    assert.equal((await admin.post(`/api/versions/${A.main.versionId}/status`, { status: 'in_review', note: 'Muziek moet nog worden vervangen' })).status, 200);
    const link = await clientLink(clientId, { approverName: 'Joris Bakker', approverEmail: 'joris@jansen.nl' });
    const guest = client(srv.base);
    const main = await portalVideo(guest, link.token, 'Hoofdfilm');
    const info = (await guest.get(`/api/review/${main.token}`)).data;
    assert.equal(info.versions[0].status, 'in_review');
    assert.equal(info.versions[0].approval.revoked, true);
    assert.ok(info.versions[0].approval.revokedAt);
    const ok = await guest.post(`/api/review/${main.token}/versions/${A.main.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key);
    assert.equal(ok.status, 200);
    const after_ = (await guest.get(`/api/review/${main.token}`)).data;
    assert.equal(after_.versions[0].approval.revoked, false);
  });

  test('andere akkoordgever aangewezen: persoonlijke link verliest direct het goedkeuringsrecht', async () => {
    const link = await clientLink(clientId, { approverName: 'Sanne Smit', approverEmail: 'sanne@jansen.nl' });
    const guest = client(srv.base);
    const teaser = await portalVideo(guest, link.token, 'Teaser');
    assert.equal((await guest.get(`/api/review/${teaser.token}`)).data.role, 'approver');
    await admin.patch(`/api/videos/${A.teaser.videoId}`, { approverName: 'Piet Klaassen', approverEmail: 'piet@jansen.nl' });
    assert.equal((await guest.get(`/api/review/${teaser.token}`)).data.role, 'reviewer');
    assert.equal((await guest.post(`/api/review/${teaser.token}/versions/${A.teaser.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key)).status, 403);
    await admin.patch(`/api/videos/${A.teaser.videoId}`, { approverName: 'Sanne Smit', approverEmail: 'sanne@jansen.nl' });
  });

  test('vorige/volgende alleen binnen het portaal; losse reviewlink houdt zijn bereik', async () => {
    const link = await clientLink(clientId);
    const guest = client(srv.base);
    const main = await portalVideo(guest, link.token, 'Hoofdfilm');
    const nav = (await guest.get(`/api/review/${main.token}`)).data.nav;
    assert.equal(nav.total, 2, 'concept telt niet mee');
    const other = nav.next || nav.prev;
    assert.equal(other.title, 'Teaser');
    assert.equal((await guest.get(`/api/review/${tokenOf(other.href)}`)).status, 200);
    assert.equal((await guest.get(`/api/review/${main.token}`)).data.portal.url, `/k/${link.token}`);
    const direct = await reviewToken(A.main.videoId);
    assert.equal((await guest.get(`/api/review/${direct}`)).data.nav, null);
    // Oude projectlink: navigatie binnen dat ene project
    const pl = tokenOf((await admin.post(`/api/projects/${A.id}/portal-link`)).data.link.url);
    const p = (await guest.get(`/api/portal/${pl}`)).data;
    const t = tokenOf(p.videos[0].href);
    assert.equal((await guest.get(`/api/review/${t}`)).data.nav.total, 2);
  });

  test('taal: standaardtaal van de klant op portaal-, review- en opleverpagina', async () => {
    const link = await clientLink(otherClientId);
    const guest = client(srv.base);
    const p = (await guest.get(`/api/client/${link.token}`)).data;
    assert.equal(p.language, 'en');
    assert.equal((await guest.get(`/api/review/${tokenOf(p.projects[0].videos[0].href)}`)).data.language, 'en');
    assert.equal((await guest.get(`/api/review/${await reviewToken(D.main.videoId)}`)).data.language, 'en', 'ook een losse reviewlink');
    assert.equal((await guest.get(`/api/review/${await reviewToken(C.main.videoId)}`)).data.language, 'nl', 'zonder klant: Nederlands');
    assert.equal((await admin.patch(`/api/clients/${otherClientId}`, { language: 'nl' })).status, 200);
    assert.equal((await guest.get(`/api/client/${link.token}`)).data.language, 'nl');
    await admin.patch(`/api/clients/${otherClientId}`, { language: 'en' });
  });
});

describe('klanttoegang per project', () => {
  test('“uit” blokkeert alle externe links en directe media; weer aan heropent geen los ingetrokken links', async () => {
    const link = await clientLink(clientId);
    const guest = client(srv.base);
    const viaPortal = await portalVideo(guest, link.token, 'Teaser');
    const direct = await reviewToken(A.teaser.videoId);
    const extra = (await admin.post(`/api/videos/${A.teaser.videoId}/links`, { role: 'reviewer', label: 'Extra' })).data;
    const extraToken = tokenOf(extra.url);
    const approverLink = tokenOf((await admin.post(`/api/videos/${A.teaser.videoId}/links`, { role: 'approver' })).data.url);
    const pl = tokenOf((await admin.post(`/api/projects/${A.id}/portal-link`)).data.link.url);
    const dl = tokenOf((await admin.post(`/api/projects/${A.id}/delivery-link`)).data.link.url);
    // Eén link los intrekken
    await admin.post(`/api/links/${extra.id}/revoke`);

    assert.equal((await admin.put(`/api/projects/${A.id}/client-visibility`, { visibility: 'off' })).status, 200);
    const p = (await guest.get(`/api/client/${link.token}`)).data;
    assert.deepEqual(p.projects.map((x) => x.name), ['Kerstfilm 2025'], 'project verborgen in het klantportaal');
    const ver = A.teaser.versionId;
    const urls = [
      `/api/review/${viaPortal.token}`, `/api/review/${direct}`, `/api/review/${approverLink}`,
      `/api/review/${direct}/versions/${ver}/media`, `/api/review/${direct}/versions/${ver}/poster`,
      `/api/review/${direct}/export.csv`, `/api/review/${viaPortal.token}/versions/${ver}/media`,
      `/api/portal/${pl}`, `/api/portal/${pl}/videos/${A.teaser.videoId}/poster`, `/api/portal/${pl}/export.csv`,
      `/api/delivery/${dl}`, `/api/client/${link.token}/projects/${A.id}/videos/${A.teaser.videoId}/poster`,
      `/api/client/${link.token}/projects/${A.id}/delivery`,
    ];
    for (const u of urls) {
      const r = await guest.get(u);
      assert.equal(r.status, 410, `${u} → ${r.status}`);
      assert.equal(r.data.code, 'client_access_off', u);
    }
    // Ook reageren kan niet
    assert.equal((await guest.post(`/api/review/${direct}/versions/${ver}/comments`, { body: 'x', timecode: 1, authorName: 'Eva', requestId: rid() }, key)).status, 410);
    // Het team kan gewoon verder
    assert.equal((await admin.get(`/api/videos/${A.teaser.videoId}`)).status, 200);

    assert.equal((await admin.put(`/api/projects/${A.id}/client-visibility`, { visibility: 'active' })).status, 200);
    for (const t of [viaPortal.token, direct, approverLink]) assert.equal((await guest.get(`/api/review/${t}`)).status, 200);
    assert.equal((await guest.get(`/api/portal/${pl}`)).status, 200);
    const revoked = await guest.get(`/api/review/${extraToken}`);
    assert.equal(revoked.status, 410);
    assert.equal(revoked.data.code, 'revoked', 'los ingetrokken link blijft ingetrokken');
  });

  test('afgerond: oude links blijven werken, in het portaal ingeklapt', async () => {
    const direct = await reviewToken(B.main.videoId);
    assert.equal((await client(srv.base).get(`/api/review/${direct}`)).status, 200);
  });

  test('project losgekoppeld: afgeleide klantlinks werken niet meer, losse links wel', async () => {
    const link = await clientLink(clientId);
    const guest = client(srv.base);
    const v = await portalVideo(guest, link.token, 'Kerstfilm');
    assert.equal((await guest.get(`/api/review/${v.token}`)).status, 200);
    await admin.put(`/api/projects/${B.id}/client`, { clientId: null });
    assert.equal((await guest.get(`/api/review/${v.token}`)).status, 404);
    assert.equal((await guest.get(`/api/review/${await reviewToken(B.main.videoId)}`)).status, 200);
    assert.equal((await guest.get(`/api/client/${link.token}`)).data.projects.some((p) => p.name === 'Kerstfilm 2025'), false);
    await admin.put(`/api/projects/${B.id}/client`, { clientId });
  });
});

describe('linkbeveiliging', () => {
  test('wachtwoord op een klantportaallink: geldt ook voor afgeleide reviewlinks en media; gehasht opgeslagen', async () => {
    const link = await clientLink(clientId, { password: 'geheim-123' });
    assert.equal(link.protection.hasPassword, true);
    const row = srv.db.prepare('SELECT * FROM client_links WHERE id = ?').get(link.id);
    assert.ok(row.password_hash && !row.password_hash.includes('geheim-123'));
    // Afgeleide link maken via een ontgrendelde sessie
    const unlocked = client(srv.base);
    const locked = await unlocked.get(`/api/client/${link.token}`);
    assert.equal(locked.status, 401);
    assert.equal(locked.data.code, 'password_required');
    assert.equal(JSON.stringify(locked.data).includes('Bakkerij'), false, 'niets van de inhoud zonder wachtwoord');
    const wrong = await unlocked.post(`/api/unlock/client/${link.token}`, { password: 'fout-fout' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.data.code, 'wrong_password');
    const ok = await unlocked.post(`/api/unlock/client/${link.token}`, { password: 'geheim-123' });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
    assert.equal(ok.headers.get('set-cookie').includes('geheim'), false);
    const v = await portalVideo(unlocked, link.token, 'Hoofdfilm');
    assert.equal((await unlocked.get(`/api/review/${v.token}`)).status, 200);
    // Bouwronde 5: link zonder downloadrecht krijgt het origineel niet (wel na de wachtwoordcontrole: 403, niet 401).
    assert.equal((await unlocked.get(`/api/review/${v.token}/versions/${A.main.versionId}/media`)).data.code, 'original_blocked');
    // Iemand anders met alleen de afgeleide link: wachtwoord nodig, ook voor media
    const stranger = client(srv.base);
    assert.equal((await stranger.get(`/api/review/${v.token}`)).status, 401);
    assert.equal((await stranger.get(`/api/review/${v.token}/versions/${A.main.versionId}/media`)).status, 401);
    // Ontgrendelen via de afgeleide link ontgrendelt de portaallink
    assert.equal((await stranger.post(`/api/unlock/share/${v.token}`, { password: 'geheim-123' })).status, 200);
    assert.equal((await stranger.get(`/api/review/${v.token}`)).status, 200);

    // Nieuw wachtwoord: eerdere ontgrendelingen werken niet meer
    assert.equal((await admin.put(`/api/link-protection/client/${link.id}`, { password: 'nieuw-wachtwoord' })).status, 200);
    assert.equal((await unlocked.get(`/api/client/${link.token}`)).status, 401);
    assert.equal((await stranger.get(`/api/review/${v.token}`)).status, 401);
    assert.equal((await unlocked.post(`/api/unlock/client/${link.token}`, { password: 'nieuw-wachtwoord' })).status, 200);
    assert.equal((await unlocked.get(`/api/client/${link.token}`)).status, 200);
    // Intrekken: ook de ontgrendelde sessie heeft geen toegang meer
    assert.equal((await admin.post(`/api/client-links/${link.id}/revoke`)).status, 200);
    assert.equal((await unlocked.get(`/api/client/${link.token}`)).status, 410);
    assert.equal((await unlocked.get(`/api/review/${v.token}`)).status, 410);
    assert.equal((await unlocked.get(`/api/review/${v.token}/versions/${A.main.versionId}/media`)).status, 410);
  });

  test('gokpogingen worden beperkt', async () => {
    const link = await clientLink(clientId, { password: 'raad-dit-niet' });
    const guest = client(srv.base);
    for (let i = 0; i < 8; i++) assert.equal((await guest.post(`/api/unlock/client/${link.token}`, { password: `fout-${i}` })).status, 403);
    const blocked = await guest.post(`/api/unlock/client/${link.token}`, { password: 'raad-dit-niet' });
    assert.equal(blocked.status, 429, 'ook het juiste wachtwoord wordt even geweigerd');
    assert.equal(blocked.data.code, 'too_many_attempts');
  });

  test('wachtwoord en vervaldatum op review-, akkoord-, project- en opleverlinks', async () => {
    const guest = client(srv.base);
    const shareId = srv.db.prepare('SELECT id FROM share_links WHERE token = ?').get(await reviewToken(C.main.videoId)).id;
    const shareToken = await reviewToken(C.main.videoId);
    assert.equal((await admin.put(`/api/link-protection/share/${shareId}`, { password: 'review-ww-1' })).status, 200);
    assert.equal((await guest.get(`/api/review/${shareToken}`)).status, 401);
    assert.equal((await guest.get(`/api/review/${shareToken}/versions/${C.main.versionId}/media`)).status, 401);
    assert.equal((await guest.get(`/api/review/${shareToken}/export.csv`)).status, 401);
    const dto = (await admin.get(`/api/videos/${C.main.videoId}`)).data.links.find((l) => l.id === shareId);
    assert.equal(dto.protection.hasPassword, true);
    assert.equal(JSON.stringify(dto).includes('review-ww-1'), false);
    assert.equal((await guest.post(`/api/unlock/share/${shareToken}`, { password: 'review-ww-1' })).status, 200);
    assert.equal((await guest.get(`/api/review/${shareToken}`)).status, 200);
    // Wachtwoord weer weg: open link
    assert.equal((await admin.put(`/api/link-protection/share/${shareId}`, { password: null })).status, 200);
    assert.equal((await client(srv.base).get(`/api/review/${shareToken}`)).status, 200);

    // Vervaldatum: moet in de toekomst en met tijdzone
    assert.equal((await admin.put(`/api/link-protection/share/${shareId}`, { expiresAt: '2020-01-01T00:00:00Z' })).status, 400);
    assert.equal((await admin.put(`/api/link-protection/share/${shareId}`, { expiresAt: '2099-01-01T12:00' })).status, 400, 'zonder tijdzone');
    const exp = await admin.put(`/api/link-protection/share/${shareId}`, { expiresAt: '2099-01-01T12:00:00+01:00' });
    assert.equal(exp.status, 200);
    assert.equal(exp.data.protection.expiresAt, '2099-01-01T11:00:00.000Z');
    assert.equal((await guest.get(`/api/review/${shareToken}`)).status, 200);
    // Verlopen (tijd verschuiven in de database)
    srv.db.prepare('UPDATE share_links SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', shareId);
    const expired = await guest.get(`/api/review/${shareToken}/versions/${C.main.versionId}/media`);
    assert.equal(expired.status, 410);
    assert.equal(expired.data.code, 'expired');
    assert.equal(expired.data.expiresAt, '2020-01-01T00:00:00.000Z');

    // Project- en opleverlink
    const pl = (await admin.post(`/api/projects/${C.id}/portal-link`)).data.link;
    assert.equal((await admin.put(`/api/link-protection/project/${pl.id}`, { password: 'portaal-ww' })).status, 200);
    assert.equal((await client(srv.base).get(`/api/portal/${tokenOf(pl.url)}`)).status, 401);
    assert.equal((await admin.get(`/api/projects/${C.id}/portal-link`)).data.link.protection.hasPassword, true);
    const p = await client(srv.base).get(`/api/portal/${tokenOf(pl.url)}`);
    assert.equal(JSON.stringify(p.data).includes('Losse video'), false);
    const dl = (await admin.post(`/api/projects/${C.id}/delivery-link`)).data.link;
    assert.equal((await admin.put(`/api/link-protection/delivery/${dl.id}`, { expiresAt: new Date(Date.now() + 86_400_000).toISOString() })).status, 200);
    assert.equal((await client(srv.base).get(`/api/delivery/${tokenOf(dl.url)}`)).status, 200);
    srv.db.prepare('UPDATE delivery_links SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', dl.id);
    assert.equal((await client(srv.base).get(`/api/delivery/${tokenOf(dl.url)}`)).status, 410);
    assert.ok((await admin.get(`/api/projects/${C.id}/deliveries`)).data.link.protection.expired);
  });

  test('verlopen akkoordlink verandert niets aan een gegeven goedkeuring', async () => {
    const before_ = srv.db.prepare('SELECT * FROM approvals WHERE version_id = ? ORDER BY id DESC').get(A.main.versionId);
    const approverId = (await admin.get(`/api/videos/${A.main.videoId}`)).data.links.find((l) => l.role === 'approver')?.id
      ?? (await admin.post(`/api/videos/${A.main.videoId}/links`, { role: 'approver' })).data.id;
    srv.db.prepare('UPDATE share_links SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', approverId);
    const after_ = srv.db.prepare('SELECT * FROM approvals WHERE version_id = ? ORDER BY id DESC').get(A.main.versionId);
    assert.deepEqual(after_, before_);
    assert.equal(srv.db.prepare('SELECT status FROM versions WHERE id = ?').get(A.main.versionId).status, 'approved');
  });

  test('rechten: beveiliging instellen vraagt “Publiceren en delen” (klantportaal: beheerder); afgeleide link heeft geen eigen beveiliging', async () => {
    const viewer = await addMember(srv, admin, { email: 'kijker@studio.nl', projects: [{ projectId: C.id, level: 'view' }] });
    const shareId = srv.db.prepare('SELECT id FROM share_links WHERE token = ?').get(await reviewToken(C.main.videoId)).id;
    assert.equal((await viewer.client.put(`/api/link-protection/share/${shareId}`, { password: 'abcdefg' })).status, 403);
    const link = await clientLink(clientId);
    assert.equal((await viewer.client.put(`/api/link-protection/client/${link.id}`, { password: 'abcdefg' })).status, 403);
    const v = await portalVideo(client(srv.base), link.token, 'Hoofdfilm');
    const derivedId = srv.db.prepare('SELECT id FROM share_links WHERE token = ?').get(v.token).id;
    assert.equal((await admin.put(`/api/link-protection/share/${derivedId}`, { password: 'abcdefg' })).status, 400);
    assert.equal((await admin.put(`/api/link-protection/client/${link.id}`, { password: 'kort' })).status, 400);
    assert.equal((await admin.put(`/api/link-protection/onbekend/1`, {})).status, 404);
  });
});

test('back-up terugzetten: klantportaallinks worden standaard ook ongeldig', async () => {
  const link = await clientLink(clientId);
  const backup = await createBackup({ db: srv.db, config: srv.config, storage: srv.created.storage, label: 'klanten' });
  assert.ok(backup.manifest.counts.clients >= 2);
  const dataDir = fs.mkdtempSync(`${srv.dataDir}-herstel-`);
  fs.rmSync(dataDir, { recursive: true });
  const r = await restoreBackup({ backupPath: backup.dir, dataDir, mediaDir: `${dataDir}/media` });
  assert.ok(r.links.counts.clientLinks >= 1);
  const s = await startServer({ dataDir });
  try {
    const res = await client(s.base).get(`/api/client/${link.token}`);
    assert.equal(res.status, 410);
    assert.equal(res.data.code, 'revoked');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM clients').get().n, srv.db.prepare('SELECT COUNT(*) AS n FROM clients').get().n, 'klanten zelf blijven bewaard');
  } finally {
    await s.close();
  }
});
