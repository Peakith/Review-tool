'use strict';
// Bouwronde 6: "Vraag aan klant" — delen, beantwoorden via de klantomgeving, idempotent, afgeschermd.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeVideo, startServer, client, upload, rid, setupAdmin, addMember, sharedVideo } = require('./helpers');

let srv;
let admin;
let file;
let A;
let B;
let clientId;
let general; // token algemene klantportaallink
let personal; // token persoonlijke link (akkoordgever)
let editor;
let producer;

const tokenOf = (url) => url.split('/').pop();
const expectStatus = async (promise, status, label) => {
  const r = await promise;
  assert.equal(r.status, status, `${label}: verwacht ${status}, kreeg ${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`);
  return r;
};

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  file = makeVideo(srv.dataDir, 'clip.mp4');
  A = await sharedVideo(admin, file, { name: 'Project Vragen', title: 'Hoofdfilm' });
  B = await sharedVideo(admin, file, { name: 'Project Ander', title: 'Andere film' });
  clientId = (await admin.post('/api/clients', { name: 'Bakkerij Vraag', language: 'nl' })).data.id;
  await admin.put(`/api/projects/${A.projectId}/client`, { clientId });
  await admin.patch(`/api/videos/${A.videoId}`, { approverName: 'Joris', approverEmail: 'joris@bakker.nl' });
  general = tokenOf((await admin.post(`/api/clients/${clientId}/links`, {})).data.url);
  personal = tokenOf((await admin.post(`/api/clients/${clientId}/links`, { approverName: 'Joris', approverEmail: 'joris@bakker.nl' })).data.url);
  ({ client: editor } = await addMember(srv, admin, { email: 'ed@q.nl', name: 'Ed', projects: [{ projectId: A.projectId, role: 'editor' }] }));
  ({ client: producer } = await addMember(srv, admin, { email: 'pl@q.nl', name: 'Pien', projects: [{ projectId: A.projectId, role: 'producer' }] }));
});
after(() => srv.close());

test('delen: alleen met publicatierechten, over project of exacte gedeelde versie; herhaald verzoek maakt geen tweede vraag', async () => {
  await expectStatus(editor.post(`/api/projects/${A.projectId}/questions`, { body: 'Mag dit?' }), 403, 'editor');
  const requestId = rid();
  const q = await expectStatus(producer.post(`/api/projects/${A.projectId}/questions`, { body: 'Klopt de spelling van “Bakkerij”?', videoId: A.videoId, versionId: A.versionId, requestId }), 201, 'vraag');
  const again = await expectStatus(producer.post(`/api/projects/${A.projectId}/questions`, { body: 'Klopt de spelling van “Bakkerij”?', videoId: A.videoId, versionId: A.versionId, requestId }), 200, 'herhaald');
  assert.equal(again.data.question.id, q.data.question.id);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM client_questions').get().n, 1);
  assert.equal(q.data.question.versionNumber, 1);
  // Interne versie (niet gedeeld) kan niet gekozen worden.
  const v2 = (await admin.post(`/api/videos/${A.videoId}/versions`, { uploadId: await upload(admin, file, { videoId: A.videoId }) })).data.versionId;
  await expectStatus(producer.post(`/api/projects/${A.projectId}/questions`, { body: 'x', videoId: A.videoId, versionId: v2 }), 400, 'interne versie');
  await expectStatus(producer.post(`/api/projects/${A.projectId}/questions`, { body: 'x', videoId: B.videoId }), 400, 'video uit ander project');
  await expectStatus(producer.post(`/api/projects/${B.projectId}/questions`, { body: 'x' }), 404, 'ander project');
});

test('klant ziet de vraag onder acties; antwoord met identiteit, idempotent; status en goedkeuring ongewijzigd', async () => {
  const guest = client(srv.base);
  const portal = (await expectStatus(guest.get(`/api/client/${general}`), 200, 'portaal')).data;
  assert.equal(portal.questions.length, 1);
  const q = portal.questions[0];
  assert.equal(q.status, 'open');
  assert.equal(q.projectName, 'Project Vragen');
  assert.ok(!JSON.stringify(q).includes('Pien'), 'geen teamgegevens bij de klant');
  const statusBefore = srv.db.prepare('SELECT status FROM versions WHERE id = ?').get(A.versionId).status;
  await expectStatus(guest.post(`/api/client/${general}/questions/${q.id}/answer`, { answer: 'Ja, klopt.' }), 400, 'zonder naam');
  const requestId = rid();
  const r = await expectStatus(guest.post(`/api/client/${general}/questions/${q.id}/answer`, { answer: 'Ja, klopt.', name: 'Eva', requestId }), 200, 'antwoord');
  assert.deepEqual([r.data.question.status, r.data.question.answer.name, r.data.question.answer.verified], ['answered', 'Eva', false]);
  // Herhaald verzoek: zelfde antwoord, geen tweede melding.
  const sent = srv.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'question_answered'").get().n;
  assert.ok(sent >= 1, 'melding aan vraagsteller (en volgers)');
  await expectStatus(guest.post(`/api/client/${general}/questions/${q.id}/answer`, { answer: 'Ja, klopt.', name: 'Eva', requestId }), 200, 'herhaald');
  await expectStatus(guest.post(`/api/client/${general}/questions/${q.id}/answer`, { answer: 'Nee toch', name: 'Iemand', requestId: rid() }), 409, 'tweede antwoord');
  assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'question_answered'").get().n, sent, 'geen extra meldingen bij herhalen');
  assert.equal(srv.db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM notifications WHERE type = 'question_answered'").get().n, sent, 'per persoon één melding');
  assert.equal(srv.db.prepare('SELECT status FROM versions WHERE id = ?').get(A.versionId).status, statusBefore, 'videostatus ongewijzigd');
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM approvals').get().n, 0, 'geen goedkeuring');
  const inbox = (await producer.get('/api/inbox')).data.items;
  assert.ok(inbox.some((n) => n.type === 'question_answered' && /Eva/.test(n.title)));
});

test('persoonlijke link: geverifieerde naam; goedkeuren beantwoordt geen open vraag', async () => {
  const q = (await producer.post(`/api/projects/${A.projectId}/questions`, { body: 'Welke muziek kies je?', videoId: A.videoId, requestId: rid() })).data.question;
  const guest = client(srv.base);
  const portal = (await guest.get(`/api/client/${personal}`)).data;
  const reviewToken = tokenOf(portal.projects[0].videos[0].href);
  const key = { 'x-reviewer-key': 'vraag-akkoord-00001' };
  await expectStatus(guest.post(`/api/review/${reviewToken}/versions/${A.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key), 200, 'goedkeuren');
  assert.equal(srv.db.prepare('SELECT status FROM client_questions WHERE id = ?').get(q.id).status, 'open', 'vraag blijft open na goedkeuring');
  const r = await expectStatus(guest.post(`/api/client/${personal}/questions/${q.id}/answer`, { answer: 'Nummer twee', name: 'Verzonnen naam', requestId: rid() }), 200, 'antwoord');
  assert.deepEqual([r.data.question.answer.name, r.data.question.answer.verified], ['Joris', true], 'naam van de persoonlijke link, niet de ingevulde');
});

test('afscherming: andere klant of project, ingetrokken link, klanttoegang uit en ingetrokken vraag', async () => {
  const q = (await producer.post(`/api/projects/${A.projectId}/questions`, { body: 'Nog een vraag', requestId: rid() })).data.question;
  const guest = client(srv.base);
  // Vraag van een ander project via deze link.
  const other = (await admin.post(`/api/projects/${B.projectId}/questions`, { body: 'Geheim', requestId: rid() })).data.question;
  await expectStatus(guest.post(`/api/client/${general}/questions/${other.id}/answer`, { answer: 'x', name: 'x' }), 404, 'ander project');
  assert.ok(!JSON.stringify((await guest.get(`/api/client/${general}`)).data).includes('Geheim'));
  // Projectlink van B ziet de vraag van A niet en kan hem niet beantwoorden.
  const portalB = tokenOf((await admin.post(`/api/projects/${B.projectId}/portal-link`, {})).data.link.url);
  assert.ok(!JSON.stringify((await guest.get(`/api/portal/${portalB}`)).data).includes('Nog een vraag'));
  await expectStatus(guest.post(`/api/portal/${portalB}/questions/${q.id}/answer`, { answer: 'x', name: 'x' }), 404, 'via projectlink van ander project');
  // Klanttoegang uit.
  await admin.put(`/api/projects/${A.projectId}/client-visibility`, { visibility: 'off' });
  await expectStatus(guest.post(`/api/client/${general}/questions/${q.id}/answer`, { answer: 'x', name: 'x' }), 410, 'klanttoegang uit');
  await admin.put(`/api/projects/${A.projectId}/client-visibility`, { visibility: 'active' });
  // Ingetrokken vraag.
  await expectStatus(editor.post(`/api/questions/${q.id}/withdraw`), 403, 'editor trekt niet in');
  await expectStatus(producer.post(`/api/questions/${q.id}/withdraw`), 200, 'intrekken');
  await expectStatus(guest.post(`/api/client/${general}/questions/${q.id}/answer`, { answer: 'x', name: 'x' }), 410, 'ingetrokken vraag');
  // Ingetrokken klantlink.
  const link = srv.db.prepare('SELECT id FROM client_links WHERE token = ?').get(general);
  await admin.post(`/api/client-links/${link.id}/revoke`, {});
  const q2 = (await producer.post(`/api/projects/${A.projectId}/questions`, { body: 'Na intrekken', requestId: rid() })).data.question;
  const r = await guest.post(`/api/client/${general}/questions/${q2.id}/answer`, { answer: 'x', name: 'x' });
  assert.ok([404, 410].includes(r.status), `ingetrokken link: ${r.status}`);
});
