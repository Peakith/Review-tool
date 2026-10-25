'use strict';
// Bouwronde 3, deel A: feedbacktaken en reviewrondes.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { makeVideo, startServer, client, upload, rid, setupAdmin, addMember } = require('./helpers');

let srv;
let admin;
let file;
let projectId;
let otherProjectId;
const key = { 'x-reviewer-key': 'tasks-reviewer-key-0001' };
const tokenOf = (url) => new URL(url, 'http://x').pathname.split('/').pop();

async function videoWithFeedback(title, comments = ['Logo groter']) {
  const c = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title })).data;
  await admin.post(`/api/versions/${c.versionId}/ready`);
  await admin.post(`/api/versions/${c.versionId}/share`, { requestId: rid() });
  const token = tokenOf((await admin.get(`/api/videos/${c.videoId}`)).data.links.find((l) => l.role === 'reviewer').url);
  const guest = client(srv.base);
  const ids = [];
  for (const body of comments) ids.push((await guest.post(`/api/review/${token}/versions/${c.versionId}/comments`, { body, timecode: 1, authorName: 'Eva', requestId: rid() }, key)).data.id);
  await guest.post(`/api/review/${token}/versions/${c.versionId}/feedback`, { authorName: 'Eva', requestId: rid() }, key);
  return { ...c, token, commentIds: ids, guest };
}

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  file = makeVideo(srv.dataDir, 'clip.mp4');
  projectId = (await admin.post('/api/projects', { name: 'Takenproject', roundsIncluded: 2 })).data.id;
  otherProjectId = (await admin.post('/api/projects', { name: 'Ander project' })).data.id;
});
after(() => srv.close());

describe('feedbacktaken', () => {
  test('taak maken: geen dubbele taak bij opnieuw klikken of gelijktijdige verzoeken', async () => {
    const v = await videoWithFeedback('Taakvideo', ['Logo groter', 'Muziek zachter']);
    const { id: editorId } = await addMember(srv, admin, { email: 'editor@b.nl', name: 'Edith Editor', projects: [{ projectId, level: 'upload' }] });
    const first = await admin.post(`/api/comments/${v.commentIds[0]}/task`, { assigneeId: editorId, priority: 'high', dueDate: '2026-11-03', note: 'Logo staat in de map Assets' });
    assert.equal(first.status, 201);
    assert.equal(first.data.task.assigneeName, 'Edith Editor');
    const again = await admin.post(`/api/comments/${v.commentIds[0]}/task`, { assigneeId: editorId });
    assert.equal(again.status, 200);
    assert.equal(again.data.existing, true);
    assert.equal(again.data.task.id, first.data.task.id);
    const parallel = await Promise.all([1, 2, 3, 4].map(() => admin.post(`/api/comments/${v.commentIds[1]}/task`, { priority: 'low' })));
    assert.equal(new Set(parallel.map((r) => r.data.task.id)).size, 1, 'gelijktijdige verzoeken → één taak');
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM comment_tasks').get().n, 2);
    // Relatie met reactie, video, versie en tijdcode
    const overview = (await admin.get(`/api/projects/${projectId}/feedback`)).data;
    const item = overview.items.find((i) => i.commentId === v.commentIds[0]);
    assert.deepEqual([item.videoId, item.versionId, item.timecode, item.task.priority, item.task.dueDate], [v.videoId, v.versionId, 1, 'high', '2026-11-03']);
    // Ongeldige invoer
    assert.equal((await admin.post(`/api/comments/${v.commentIds[0]}/task`, { priority: 'urgent' })).status, 200, 'bestaande taak komt terug; geen tweede');
    assert.equal((await admin.patch(`/api/tasks/${first.data.task.id}`, { dueDate: '2026-02-30' })).status, 400);
    assert.equal((await admin.patch(`/api/tasks/${first.data.task.id}`, { priority: 'urgent' })).status, 400);
  });

  test('toewijzen alleen aan iemand met toegang tot het project', async () => {
    const v = await videoWithFeedback('Toegangvideo');
    const { id: outsider } = await addMember(srv, admin, { email: 'buiten@b.nl', name: 'Buiten', projects: [{ projectId: otherProjectId, level: 'manage' }] });
    const r = await admin.post(`/api/comments/${v.commentIds[0]}/task`, { assigneeId: outsider });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /geen toegang tot dit project/);
    const assignees = (await admin.get(`/api/projects/${projectId}/assignees`)).data.map((u) => u.name);
    assert.ok(!assignees.includes('Buiten') && assignees.includes('Beheer'));
  });

  test('één afhandelstatus: taak en reactie lopen altijd gelijk', async () => {
    const v = await videoWithFeedback('Statusvideo');
    const cid = v.commentIds[0];
    const t = (await admin.post(`/api/comments/${cid}/task`, {})).data.task;
    const state = async () => {
      const c = (await admin.get(`/api/versions/${v.versionId}/comments`)).data.find((x) => x.id === cid);
      return [c.resolved, c.task.status];
    };
    assert.deepEqual(await state(), [false, 'open']);
    await admin.patch(`/api/tasks/${t.id}`, { status: 'in_progress' });
    assert.deepEqual(await state(), [false, 'in_progress']);
    await admin.patch(`/api/tasks/${t.id}`, { status: 'done' });
    assert.deepEqual(await state(), [true, 'done']);
    await admin.post(`/api/comments/${cid}/resolve`, { resolved: false });
    assert.deepEqual(await state(), [false, 'open'], 'heropenen van de reactie heropent de taak');
    await admin.post(`/api/comments/${cid}/resolve`, { resolved: true });
    assert.deepEqual(await state(), [true, 'done'], 'afvinken van de reactie handelt de taak af');
    // Taak maken op een al afgehandelde reactie heropent die (anders zou "afgehandeld" + "taak open" ontstaan)
    const v2 = await videoWithFeedback('Statusvideo 2');
    await admin.post(`/api/comments/${v2.commentIds[0]}/resolve`, { resolved: true });
    await admin.post(`/api/comments/${v2.commentIds[0]}/task`, {});
    const c2 = (await admin.get(`/api/versions/${v2.versionId}/comments`)).data[0];
    assert.deepEqual([c2.resolved, c2.task.status], [false, 'open']);
    // Afhandelen verandert de videostatus niet
    assert.equal(srv.db.prepare('SELECT status FROM versions WHERE id = ?').get(v.versionId).status, 'changes_requested');
  });

  // Bouwronde 6: taken gaan naar Editors of Projectleiders; een Meekijker kan niets aan taken wijzigen.
  test('rechten: editor wijzigt taak; meekijker niet; klant ziet niets van taken', async () => {
    const v = await videoWithFeedback('Rechtenvideo');
    const { client: viewer, id: viewerId } = await addMember(srv, admin, { email: 'kijker@b.nl', name: 'Kijker', projects: [{ projectId, role: 'editor' }] });
    const { client: other } = await addMember(srv, admin, { email: 'ander@b.nl', name: 'Ander', projects: [{ projectId, role: 'meekijker' }] });
    const t = (await admin.post(`/api/comments/${v.commentIds[0]}/task`, { assigneeId: viewerId, note: 'Interne toelichting: budget op' })).data.task;
    assert.equal((await viewer.patch(`/api/tasks/${t.id}`, { status: 'in_progress' })).status, 200);
    assert.equal((await viewer.patch(`/api/tasks/${t.id}`, { priority: 'high' })).status, 200);
    assert.equal((await other.patch(`/api/tasks/${t.id}`, { status: 'done' })).status, 403, 'meekijker wijzigt geen status');
    assert.equal((await other.post(`/api/comments/${v.commentIds[0]}/task`, {})).status, 403, 'meekijker maakt geen taak');
    assert.equal((await admin.patch(`/api/tasks/${t.id}`, { assigneeId: (await other.get('/api/session')).data.user.id })).status, 400, 'meekijker kan geen taak krijgen');
    const mine = (await viewer.get('/api/my/tasks')).data.items;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].task.note, 'Interne toelichting: budget op');
    // Klant: geen taakgegevens, ook niet in de JSON
    const seen = JSON.stringify((await v.guest.get(`/api/review/${v.token}/versions/${v.versionId}/comments`, key)).data);
    assert.ok(!seen.includes('task') && !seen.includes('budget op') && !seen.includes('Kijker'));
    // Buitenstaander kan niet bij taken of overzicht
    const { client: outsider } = await addMember(srv, admin, { email: 'buiten2@b.nl', projects: [{ projectId: otherProjectId, level: 'manage' }] });
    assert.equal((await outsider.patch(`/api/tasks/${t.id}`, { status: 'done' })).status, 404);
    assert.equal((await outsider.get(`/api/projects/${projectId}/feedback`)).status, 404);
    assert.equal((await outsider.post(`/api/comments/${v.commentIds[0]}/task`, {})).status, 404);
  });

  test('toegang ingetrokken: taak wordt losgekoppeld met toelichting, en verdwijnt uit “Mijn taken”', async () => {
    const v = await videoWithFeedback('Intrekvideo');
    const { client: freek, id: freekId } = await addMember(srv, admin, { email: 'freek@b.nl', name: 'Freek', projects: [{ projectId, level: 'upload' }] });
    const t = (await admin.post(`/api/comments/${v.commentIds[0]}/task`, { assigneeId: freekId })).data.task;
    assert.equal((await freek.get('/api/my/tasks')).data.items.length, 1);
    assert.equal((await admin.put(`/api/users/${freekId}/projects`, { projects: [] })).status, 200);
    const task = srv.db.prepare('SELECT * FROM comment_tasks WHERE id = ?').get(t.id);
    assert.equal(task.assignee_id, null);
    assert.match(task.unassigned_note, /Freek heeft geen toegang meer/);
    assert.equal((await freek.get('/api/my/tasks')).data.items.length, 0);
    assert.equal((await freek.patch(`/api/tasks/${t.id}`, { status: 'done' })).status, 404);
    const unassigned = (await admin.get(`/api/projects/${projectId}/feedback?assignee=none`)).data.items;
    assert.ok(unassigned.some((i) => i.task?.id === t.id && /geen toegang/.test(i.task.unassignedNote)));
    // Uitschakelen werkt hetzelfde
    const { id: annaId } = await addMember(srv, admin, { email: 'anna@b.nl', name: 'Anna', projects: [{ projectId, level: 'upload' }] });
    await admin.patch(`/api/tasks/${t.id}`, { assigneeId: annaId });
    await admin.patch(`/api/users/${annaId}`, { disabled: true });
    assert.match(srv.db.prepare('SELECT unassigned_note FROM comment_tasks WHERE id = ?').get(t.id).unassigned_note, /Anna is uitgeschakeld/);
  });

  test('overzicht: filters op verantwoordelijke, video, prioriteit en status; prullenbak telt niet mee', async () => {
    const a = await videoWithFeedback('Filter A', ['A1', 'A2']);
    const b = await videoWithFeedback('Filter B', ['B1']);
    const { id: uid } = await addMember(srv, admin, { email: 'filter@b.nl', name: 'Filter', projects: [{ projectId, level: 'upload' }] });
    await admin.post(`/api/comments/${a.commentIds[0]}/task`, { assigneeId: uid, priority: 'high' });
    const t2 = (await admin.post(`/api/comments/${b.commentIds[0]}/task`, { priority: 'low' })).data.task;
    await admin.patch(`/api/tasks/${t2.id}`, { status: 'in_progress' });
    const get = async (q) => (await admin.get(`/api/projects/${projectId}/feedback?${q}`)).data.items.map((i) => i.body).filter((x) => /^[AB]\d$/.test(x)).sort();
    assert.deepEqual(await get(`assignee=${uid}`), ['A1']);
    assert.deepEqual(await get(`video=${a.videoId}`), ['A1', 'A2']);
    assert.deepEqual(await get('priority=low'), ['B1']);
    assert.deepEqual(await get('status=in_progress'), ['B1']);
    assert.deepEqual(await get('status=open'), ['A1', 'A2']);
    await admin.post(`/api/comments/${a.commentIds[1]}/resolve`, { resolved: true });
    assert.deepEqual(await get(''), ['A1', 'B1'], 'standaard: alleen niet-afgehandelde');
    assert.deepEqual(await get('status=done'), ['A2']);
    await admin.del(`/api/videos/${b.videoId}`);
    assert.deepEqual(await get('status=all'), ['A1', 'A2']);
    assert.equal((await admin.get(`/api/projects/${projectId}/feedback?status=onzin`)).status, 400);
  });
});

describe('reviewrondes', () => {
  test('publiceren: ronde 1, bij huidige ronde of nieuwe ronde; opnieuw proberen maakt geen extra ronde', async () => {
    const c = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title: 'Rondevideo' })).data;
    await admin.post(`/api/versions/${c.versionId}/ready`);
    assert.equal((await admin.post(`/api/versions/${c.versionId}/share`, { round: 'current' })).status, 400, 'nog geen ronde om bij aan te sluiten');
    const req1 = rid();
    const s1 = await admin.post(`/api/versions/${c.versionId}/share`, { round: 'new', requestId: req1, deadline: '2026-11-10T16:00:00.000Z', roundNote: 'Graag vóór dinsdag' });
    assert.equal(s1.data.roundNumber, 1);
    const replay = await admin.post(`/api/versions/${c.versionId}/share`, { round: 'new', requestId: req1 });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    const rounds = () => srv.db.prepare('SELECT COUNT(*) AS n FROM review_rounds WHERE video_id = ?').get(c.videoId).n;
    assert.equal(rounds(), 1);
    assert.equal((await admin.post(`/api/versions/${c.versionId}/share`, { round: 'new', requestId: rid() })).status, 409, 'nieuwe requestId op al gedeelde versie: geweigerd, geen ronde');
    assert.equal(rounds(), 1);

    // Upload, reacties en feedback maken nooit een ronde
    const token = tokenOf((await admin.get(`/api/videos/${c.videoId}`)).data.links.find((l) => l.role === 'reviewer').url);
    const guest = client(srv.base);
    await guest.post(`/api/review/${token}/versions/${c.versionId}/comments`, { body: 'x', timecode: 1, authorName: 'Eva', requestId: rid() }, key);
    const fbReq = rid();
    await guest.post(`/api/review/${token}/versions/${c.versionId}/feedback`, { authorName: 'Eva', requestId: fbReq }, key);
    await guest.post(`/api/review/${token}/versions/${c.versionId}/feedback`, { authorName: 'Eva', requestId: fbReq }, key);
    const v2 = (await admin.post(`/api/videos/${c.videoId}/versions`, { uploadId: await upload(admin, file, { videoId: c.videoId }) })).data;
    assert.equal(rounds(), 1);

    // v2 bij dezelfde ronde
    await admin.post(`/api/versions/${v2.versionId}/ready`);
    const s2 = await admin.post(`/api/versions/${v2.versionId}/share`, { round: 'current', changeNote: 'Logo vergroot', requestId: rid() });
    assert.equal(s2.data.roundNumber, 1);
    // v3 start ronde 2, v4 ronde 3 (boven de afspraak van 2)
    const v3 = (await admin.post(`/api/videos/${c.videoId}/versions`, { uploadId: await upload(admin, file, { videoId: c.videoId }) })).data;
    await admin.post(`/api/versions/${v3.versionId}/ready`);
    assert.equal((await admin.post(`/api/versions/${v3.versionId}/share`, { round: 'new', changeNote: 'Muziek zachter\nTitels aangepast', requestId: rid() })).data.roundNumber, 2);
    const v4 = (await admin.post(`/api/videos/${c.videoId}/versions`, { uploadId: await upload(admin, file, { videoId: c.videoId }) })).data;
    await admin.post(`/api/versions/${v4.versionId}/ready`);
    assert.equal((await admin.post(`/api/versions/${v4.versionId}/share`, { round: 'new', requestId: rid() })).data.roundNumber, 3);
    const video = (await admin.get(`/api/videos/${c.videoId}`)).data;
    assert.deepEqual(video.rounds.map((r) => [r.number, r.versions.map((x) => x.number).sort()]), [[1, [1, 2]], [2, [3]], [3, [4]]]);
    assert.deepEqual(video.roundsIncluded, { count: 2, source: 'project' });
    assert.equal(video.rounds[0].submissions, 1, 'herhaald feedbackverzoek telt één keer');
    // Afwijkend aantal per video
    await admin.patch(`/api/videos/${c.videoId}`, { roundsIncluded: 4 });
    assert.deepEqual((await admin.get(`/api/videos/${c.videoId}`)).data.roundsIncluded, { count: 4, source: 'video' });
    assert.equal((await admin.patch(`/api/videos/${c.videoId}`, { roundsIncluded: 0 })).status, 400);
    assert.equal((await admin.patch(`/api/projects/${projectId}`, { roundsIncluded: 'veel' })).status, 400);

    // Klant ziet ronde, deadline en wat er is aangepast bij de juiste versie
    const info = (await guest.get(`/api/review/${token}`)).data;
    const byNum = Object.fromEntries(info.versions.map((v) => [v.number, v]));
    assert.equal(byNum[3].changeNote, 'Muziek zachter\nTitels aangepast');
    assert.equal(byNum[3].round.number, 2);
    assert.equal(byNum[1].round.deadline, '2026-11-10T16:00:00.000Z');
    assert.equal(byNum[2].changeNote, 'Logo vergroot');
    assert.equal(byNum[1].changeNote, '');
    // Ongeldige deadline (zonder tijdzone = dubbelzinnig)
    assert.equal((await admin.patch(`/api/rounds/${video.rounds[0].id}`, { deadline: '2026-11-10 16:00' })).status, 400);
  });

  test('verstreken deadline: geen goedkeuring, feedback blijft mogelijk, status ongewijzigd', async () => {
    const c = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title: 'Deadlinevideo' })).data;
    await admin.post(`/api/versions/${c.versionId}/ready`);
    await admin.post(`/api/versions/${c.versionId}/share`, { round: 'new', deadline: '2020-01-01T09:00:00.000Z', requestId: rid() });
    const token = tokenOf((await admin.get(`/api/videos/${c.videoId}`)).data.links.find((l) => l.role === 'reviewer').url);
    const guest = client(srv.base);
    assert.equal((await guest.get(`/api/review/${token}`)).data.versions[0].status, 'in_review');
    assert.equal((await guest.post(`/api/review/${token}/versions/${c.versionId}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key)).status, 403, 'reviewlink keurt nooit goed');
    await guest.post(`/api/review/${token}/versions/${c.versionId}/comments`, { body: 'Nog iets', timecode: 1, authorName: 'Eva', requestId: rid() }, key);
    const fb = await guest.post(`/api/review/${token}/versions/${c.versionId}/feedback`, { authorName: 'Eva', requestId: rid() }, key);
    assert.equal(fb.data.status, 'changes_requested');
    // Handmatige correctie blijft mogelijk, met reden
    assert.equal((await admin.post(`/api/versions/${c.versionId}/status`, { status: 'in_review' })).status, 400);
    assert.equal((await admin.post(`/api/versions/${c.versionId}/status`, { status: 'in_review', note: 'Klant belde' })).status, 200);
  });

  test('bestaande gedeelde versies krijgen achteraf geen verzonnen ronde', async () => {
    // Zoals na een update: een versie die vóór deze versie is gedeeld (round_id leeg)
    const c = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title: 'Oude video' })).data;
    await admin.post(`/api/versions/${c.versionId}/ready`);
    await admin.post(`/api/versions/${c.versionId}/share`);
    srv.db.prepare('UPDATE versions SET round_id = NULL WHERE id = ?').run(c.versionId);
    srv.db.prepare('DELETE FROM review_rounds WHERE video_id = ?').run(c.videoId);
    const v = (await admin.get(`/api/videos/${c.videoId}`)).data;
    assert.deepEqual(v.rounds, []);
    assert.deepEqual(v.unroundedSharedVersions, [1]);
    const info = (await client(srv.base).get(`/api/review/${tokenOf(v.links[0].url)}`)).data;
    assert.equal(info.versions[0].round, null);
  });
});

test('back-up en herstel: taken, rondes, bereiken en tekeningen komen mee terug', async () => {
  const { createBackup, restoreBackup, verifyBackup } = require('../server/backup');
  const { createApp } = require('../server/app');
  const fs = require('node:fs');
  const path = require('node:path');
  const s2 = await startServer();
  let restored;
  try {
    const a = await setupAdmin(s2);
    const pid = (await a.post('/api/projects', { name: 'Back-up rondes', roundsIncluded: 3 })).data.id;
    const f = makeVideo(s2.dataDir, 'b.mp4', 4);
    const c = (await a.post(`/api/projects/${pid}/videos`, { uploadId: await upload(a, f, { projectId: pid }), title: 'Video' })).data;
    await a.post(`/api/versions/${c.versionId}/ready`);
    await a.post(`/api/versions/${c.versionId}/share`, { round: 'new', deadline: '2026-12-01T10:00:00.000Z', roundNote: 'Graag voor december', changeNote: 'Eerste versie', requestId: rid() });
    const cm = (await a.post(`/api/versions/${c.versionId}/comments`, { body: 'Bereik met tekening', timecode: 1, timecodeEnd: 2.5, annotation: { v: 1, shapes: [{ t: 'rect', c: '#ffd60a', a: [0.1, 0.1], b: [0.5, 0.5] }] } })).data;
    await a.post(`/api/comments/${cm.id}/task`, { priority: 'high', dueDate: '2026-11-20', note: 'Interne toelichting', status: 'in_progress' });
    const b = await createBackup({ db: s2.db, config: s2.config, storage: s2.created.storage });
    assert.equal(b.manifest.counts.review_rounds, 1);
    assert.equal(b.manifest.counts.comment_tasks, 1);
    assert.ok((await verifyBackup(b.dir)).ok);
    const dataDir = `${s2.dataDir}-hersteld`;
    await restoreBackup({ backupPath: b.dir, dataDir, mediaDir: path.join(dataDir, 'media') });
    restored = createApp({ dataDir, backupDir: `${dataDir}-b`, minFreeBytes: 0, env: { ...process.env, STUDIO_REVIEW_HOME: `${dataDir}-h`, DATA_DIR: '' } });
    const listener = await new Promise((r) => { const l = restored.app.listen(0, () => r(l)); });
    restored.close = () => new Promise((r) => listener.close(r));
    const r = client(`http://127.0.0.1:${listener.address().port}`);
    await r.post('/api/login', { email: 'beheer@agency.nl', password: 'een-lang-wachtwoord' });
    const v = (await r.get(`/api/videos/${c.videoId}`)).data;
    assert.deepEqual([v.rounds[0].number, v.rounds[0].deadline, v.rounds[0].clientNote, v.versions[0].changeNote, v.roundsIncluded.count], [1, '2026-12-01T10:00:00.000Z', 'Graag voor december', 'Eerste versie', 3]);
    const com = (await r.get(`/api/versions/${c.versionId}/comments`)).data[0];
    assert.deepEqual([com.timecode, com.timecodeEnd, com.annotation.shapes[0].t, com.task.status, com.task.note, com.resolved], [1, 2.5, 'rect', 'in_progress', 'Interne toelichting', false]);
  } finally {
    if (restored) { restored.stop(); await restored.close(); restored.db.close(); }
    for (const d of ['-hersteld', '-hersteld-b', '-hersteld-h']) fs.rmSync(`${s2.dataDir}${d}`, { recursive: true, force: true });
    await s2.close();
  }
});

test('definitief verwijderen ruimt taken en rondes mee op', async () => {
  const c = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title: 'Weg ermee' })).data;
  await admin.post(`/api/versions/${c.versionId}/ready`);
  await admin.post(`/api/versions/${c.versionId}/share`, { round: 'new', requestId: rid() });
  const cm = (await admin.post(`/api/versions/${c.versionId}/comments`, { body: 'x', timecode: 1 })).data;
  await admin.post(`/api/comments/${cm.id}/task`, {});
  await admin.del(`/api/videos/${c.videoId}`);
  const prev = (await admin.get(`/api/trash/video/${c.videoId}/purge-preview`)).data;
  assert.equal((await admin.post(`/api/trash/video/${c.videoId}/purge`, { confirm: true, expectedFiles: prev.fileCount })).status, 200);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM comment_tasks WHERE comment_id = ?').get(cm.id).n, 0);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM review_rounds WHERE video_id = ?').get(c.videoId).n, 0);
});
