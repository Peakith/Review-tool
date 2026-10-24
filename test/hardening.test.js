'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeVideo, startServer, client, upload, rid, SETUP_TOKEN } = require('./helpers');

const key = (n) => ({ 'x-reviewer-key': `hardening-key-${String(n).padStart(6, '0')}` });
const tokenFromUrl = (url) => new URL(url).pathname.split('/').pop();

async function setupTeam(srv) {
  const team = client(srv.base);
  const r = await team.post('/api/setup', { setupToken: SETUP_TOKEN, email: 'team@agency.nl', name: 'Sanne', password: 'een-lang-wachtwoord' });
  assert.equal(r.status, 201);
  return team;
}

describe('eerste account', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(() => srv.close());

  test('zonder of met verkeerde installatiecode kan niemand het eerste account claimen', async () => {
    const visitor = client(srv.base);
    const body = { email: 'indringer@x.nl', name: 'X', password: 'een-lang-wachtwoord' };
    assert.equal((await visitor.post('/api/setup', body)).status, 403);
    assert.equal((await visitor.post('/api/setup', { ...body, setupToken: 'gok' })).status, 403);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
    assert.equal((await visitor.get('/api/projects')).status, 401);
  });

  test('met de juiste code lukt het één keer', async () => {
    const admin = client(srv.base);
    const ok = await admin.post('/api/setup', { setupToken: SETUP_TOKEN, email: 'beheer@agency.nl', name: 'Beheer', password: 'een-lang-wachtwoord' });
    assert.equal(ok.status, 201);
    assert.equal((await admin.get('/api/projects')).status, 200);
    const again = await client(srv.base).post('/api/setup', { setupToken: SETUP_TOKEN, email: 'b@x.nl', name: 'B', password: 'een-lang-wachtwoord' });
    assert.equal(again.status, 409);
  });

  test('zonder SETUP_TOKEN genereert de server zelf een onvoorspelbare code', async () => {
    const other = await startServer({ setupToken: null });
    try {
      assert.ok(other.created.setupToken.length >= 20);
      assert.notEqual(other.created.setupToken, SETUP_TOKEN);
      const r = await client(other.base).post('/api/setup', { setupToken: SETUP_TOKEN, email: 'a@b.nl', name: 'A', password: 'een-lang-wachtwoord' });
      assert.equal(r.status, 403);
    } finally {
      await other.close();
    }
  });
});

describe('versieflow en herhaalde verzoeken', () => {
  let srv;
  let team;
  let files;
  let projectId;

  before(async () => {
    srv = await startServer();
    team = await setupTeam(srv);
    const dir = path.join(srv.dataDir, 'fixtures');
    fs.mkdirSync(dir);
    files = { v1: makeVideo(dir, 'v1.mp4'), v2: makeVideo(dir, 'v2.mp4', 3) };
    projectId = (await team.post('/api/projects', { name: 'Test' })).data.id;
  });
  after(() => srv.close());

  async function sharedVideoWithApprover() {
    const created = await team.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(team, files.v1), title: 'Hoofdvideo' });
    const videoId = created.data.videoId;
    const v1 = created.data.versionId;
    await team.post(`/api/versions/${v1}/ready`);
    await team.post(`/api/versions/${v1}/share`);
    await team.patch(`/api/videos/${videoId}`, { approverName: 'Joris', approverEmail: 'joris@klant.nl' });
    const approverToken = tokenFromUrl((await team.post(`/api/videos/${videoId}/links`, { role: 'approver' })).data.url);
    const video = (await team.get(`/api/videos/${videoId}`)).data;
    const reviewerToken = tokenFromUrl(video.links.find((l) => l.role === 'reviewer').url);
    return { videoId, v1, approverToken, reviewerToken };
  }
  const statusOf = async (versionId, videoId) => (await team.get(`/api/videos/${videoId}`)).data.versions.find((v) => v.id === versionId);

  test('klant blijft versie 1 zien tot versie 2 expliciet is gedeeld; feedback blijft bewaard en v2 is niet goedgekeurd', async () => {
    const { videoId, v1, reviewerToken, approverToken } = await sharedVideoWithApprover();
    const guest = client(srv.base);

    // Feedback én goedkeuring op versie 1
    await guest.post(`/api/review/${reviewerToken}/versions/${v1}/comments`, { body: 'Logo groter', timecode: 1, authorName: 'Eva', requestId: rid() }, key(1));
    await guest.post(`/api/review/${reviewerToken}/versions/${v1}/feedback`, { authorName: 'Eva', requestId: rid() }, key(1));
    const approver = client(srv.base);
    assert.equal((await approver.post(`/api/review/${approverToken}/versions/${v1}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key(2))).status, 200);

    // Versie 2 als concept
    const nv = await team.post(`/api/videos/${videoId}/versions`, { uploadId: await upload(team, files.v2) });
    const v2 = nv.data.versionId;
    assert.equal((await statusOf(v2, videoId)).status, 'concept');

    for (const token of [reviewerToken, approverToken]) {
      const r = (await client(srv.base).get(`/api/review/${token}`)).data;
      assert.deepEqual(r.versions.map((v) => v.number), [1], 'klant ziet alleen versie 1');
      assert.equal(r.versions[0].isLatest, true);
    }
    assert.equal((await guest.get(`/api/review/${reviewerToken}/versions/${v2}/media`)).status, 404, 'concept niet opvraagbaar');
    assert.equal((await guest.post(`/api/review/${reviewerToken}/versions/${v2}/comments`, { body: 'x', authorName: 'Eva', requestId: rid() }, key(1))).status, 404);

    // Klaar voor review is nog steeds niet gedeeld
    await team.post(`/api/versions/${v2}/ready`);
    assert.deepEqual((await guest.get(`/api/review/${reviewerToken}`)).data.versions.map((v) => v.number), [1]);

    // Expliciet delen
    await team.post(`/api/versions/${v2}/share`);
    const r = (await guest.get(`/api/review/${reviewerToken}`)).data;
    assert.deepEqual(r.versions.map((v) => v.number), [2, 1]);
    assert.equal(r.versions[0].status, 'in_review');
    assert.equal(r.versions[0].approval, null, 'versie 2 is niet goedgekeurd');
    assert.equal(r.versions[1].status, 'approved');
    assert.equal(r.versions[1].approval.name, 'Joris');

    const v1Comments = (await guest.get(`/api/review/${reviewerToken}/versions/${v1}/comments`)).data;
    assert.equal(v1Comments.length, 1);
    assert.equal(v1Comments[0].body, 'Logo groter');
    assert.equal(v1Comments[0].pending, false);
    assert.equal(v1Comments[0].sent, true, 'hoort bij verstuurde feedbackronde');
    assert.equal((await guest.get(`/api/review/${reviewerToken}/versions/${v2}/comments`)).data.length, 0);
    const teamV1 = await statusOf(v1, videoId);
    assert.equal(teamV1.rounds.length, 1);
    assert.deepEqual(teamV1.events.map((e) => e.to), ['concept', 'ready_for_review', 'in_review', 'changes_requested', 'approved']);
  });

  test('herhaald feedbackverzoek overschrijft geen handmatige correctie; nieuwe feedback wel toegestaan', async () => {
    const { videoId, v1, reviewerToken } = await sharedVideoWithApprover();
    const guest = client(srv.base);
    await guest.post(`/api/review/${reviewerToken}/versions/${v1}/comments`, { body: 'A', timecode: 0.5, authorName: 'Eva', requestId: rid() }, key(3));
    const feedback = { authorName: 'Eva', message: 'Zie opmerking', requestId: rid() };
    const first = await guest.post(`/api/review/${reviewerToken}/versions/${v1}/feedback`, feedback, key(3));
    assert.equal(first.data.status, 'changes_requested');
    assert.equal(first.data.replayed, false);

    await team.post(`/api/versions/${v1}/status`, { status: 'in_review', note: 'Per abuis' });
    const eventsBefore = (await statusOf(v1, videoId)).events.length;

    const replay = await guest.post(`/api/review/${reviewerToken}/versions/${v1}/feedback`, feedback, key(3));
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.status, 'in_review');
    const after = await statusOf(v1, videoId);
    assert.equal(after.status, 'in_review');
    assert.equal(after.events.length, eventsBefore, 'geen nieuwe statusgebeurtenis');
    assert.equal(after.rounds.length, 1, 'geen extra feedbackronde');
    assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM comments WHERE version_id = ? AND body = 'Zie opmerking'").get(v1).n, 1, 'toelichting niet dubbel');

    // Een nieuwe, echte feedbackronde mag de status wel weer wijzigen
    await guest.post(`/api/review/${reviewerToken}/versions/${v1}/comments`, { body: 'B', timecode: 1, authorName: 'Eva', requestId: rid() }, key(3));
    const fresh = await guest.post(`/api/review/${reviewerToken}/versions/${v1}/feedback`, { authorName: 'Eva', requestId: rid() }, key(3));
    assert.equal(fresh.data.status, 'changes_requested');
    assert.equal((await statusOf(v1, videoId)).rounds.length, 2);
  });

  test('herhaald feedbackverzoek na goedkeuring laat de goedkeuring staan', async () => {
    const { videoId, v1, reviewerToken, approverToken } = await sharedVideoWithApprover();
    const guest = client(srv.base);
    const feedback = { authorName: 'Eva', message: 'Kleine dingen', requestId: rid() };
    await guest.post(`/api/review/${reviewerToken}/versions/${v1}/feedback`, feedback, key(4));
    await client(srv.base).post(`/api/review/${approverToken}/versions/${v1}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key(5));
    assert.equal((await statusOf(v1, videoId)).status, 'approved');

    const replay = await guest.post(`/api/review/${reviewerToken}/versions/${v1}/feedback`, feedback, key(4));
    assert.equal(replay.data.replayed, true);
    assert.equal((await statusOf(v1, videoId)).status, 'approved');

    // Nieuwe feedback op een goedgekeurde versie is volgens de regels niet meer mogelijk
    const fresh = await guest.post(`/api/review/${reviewerToken}/versions/${v1}/feedback`, { authorName: 'Eva', message: 'Toch nog iets', requestId: rid() }, key(4));
    assert.equal(fresh.status, 409);
    assert.equal((await statusOf(v1, videoId)).status, 'approved');
  });

  test('herhaalde goedkeuring overschrijft geen latere handmatige correctie', async () => {
    const { videoId, v1, approverToken } = await sharedVideoWithApprover();
    const approver = client(srv.base);
    const approve = { confirm: true, versionNumber: 1, requestId: rid() };
    assert.equal((await approver.post(`/api/review/${approverToken}/versions/${v1}/approve`, approve, key(6))).data.replayed, false);
    await team.post(`/api/versions/${v1}/status`, { status: 'changes_requested', note: 'Klant belde: toch aanpassen' });

    const replay = await approver.post(`/api/review/${approverToken}/versions/${v1}/approve`, approve, key(6));
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal((await statusOf(v1, videoId)).status, 'changes_requested');
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM approvals WHERE version_id = ?').get(v1).n, 1);

    // Een nieuwe, expliciete goedkeuring is wel toegestaan
    const fresh = await approver.post(`/api/review/${approverToken}/versions/${v1}/approve`, { confirm: true, versionNumber: 1, requestId: rid() }, key(6));
    assert.equal(fresh.data.status, 'approved');
  });

  test('herhaalde reactie wordt niet dubbel opgeslagen; feedback en goedkeuring vereisen een request-id', async () => {
    const { v1, reviewerToken, approverToken } = await sharedVideoWithApprover();
    const guest = client(srv.base);
    const comment = { body: 'Eén keer', timecode: 1, authorName: 'Eva', requestId: rid() };
    const a = await guest.post(`/api/review/${reviewerToken}/versions/${v1}/comments`, comment, key(7));
    const b = await guest.post(`/api/review/${reviewerToken}/versions/${v1}/comments`, comment, key(7));
    assert.equal(a.data.id, b.data.id);
    assert.equal(b.data.replayed, true);
    assert.equal((await guest.post(`/api/review/${reviewerToken}/versions/${v1}/feedback`, { authorName: 'Eva', message: 'x' }, key(7))).status, 400);
    assert.equal((await guest.post(`/api/review/${approverToken}/versions/${v1}/approve`, { confirm: true, versionNumber: 1 }, key(7))).status, 400);
  });
});

describe('uploads: inhoudscontrole en opruimen', () => {
  test('zonder ffprobe worden uploads geweigerd en is dat zichtbaar', async () => {
    const srv = await startServer({ tools: { ffprobe: '/bestaat/niet/ffprobe', ffmpeg: '/bestaat/niet/ffmpeg' } });
    try {
      const team = await setupTeam(srv);
      const r = await team.post('/api/uploads', { filename: 'film.mp4', size: 1000 });
      assert.equal(r.status, 503);
      assert.match(r.data.error, /ffprobe/);
      const health = (await client(srv.base).get('/api/health')).data;
      assert.equal(health.status, 'degraded');
      assert.equal(health.ffprobe, 'ontbreekt');
      assert.equal(health.uploads, 'uitgeschakeld');
      const session = (await team.get('/api/session')).data;
      assert.equal(session.media.uploadsEnabled, false);
    } finally {
      await srv.close();
    }
  });

  test('ALLOW_UNVERIFIED_UPLOADS staat uploads zonder controle alleen expliciet toe', async () => {
    const srv = await startServer({ allowUnverifiedUploads: true, tools: { ffprobe: '/bestaat/niet/ffprobe', ffmpeg: '/bestaat/niet/ffmpeg' } });
    try {
      const team = await setupTeam(srv);
      assert.equal((await team.post('/api/uploads', { filename: 'film.mp4', size: 1000 })).status, 201);
      assert.match((await client(srv.base).get('/api/health')).data.uploads, /zonder controle/);
    } finally {
      await srv.close();
    }
  });

  test('inhoud die niet bij de extensie past wordt geweigerd', async () => {
    const srv = await startServer();
    try {
      const team = await setupTeam(srv);
      const projectId = (await team.post('/api/projects', { name: 'P' })).data.id;
      const webm = path.join(srv.dataDir, 'echt.webm');
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=1', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', webm]);
      const disguised = path.join(srv.dataDir, 'vermomd.mp4');
      fs.copyFileSync(webm, disguised);
      const r = await team.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(team, disguised), title: 'x' });
      assert.equal(r.status, 422);
      assert.match(r.data.error, /extensie/);
      const ok = await team.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(team, webm), title: 'webm' });
      assert.equal(ok.status, 201);
      assert.equal((await client(srv.base).get('/api/health')).data.status, 'ok');
    } finally {
      await srv.close();
    }
  });

  test('verlopen uploads en losse bestanden worden opgeruimd, actieve uploads blijven staan', async () => {
    const srv = await startServer({ uploadExpiryHours: 24 });
    try {
      const team = await setupTeam(srv);
      const projectId = (await team.post('/api/projects', { name: 'P' })).data.id;
      const video = makeVideo(srv.dataDir, 'clip.mp4');
      const buf = fs.readFileSync(video);
      const start = async (name) => {
        const { id, chunkSize } = (await team.post('/api/uploads', { filename: name, size: buf.length })).data;
        await team.put(`/api/uploads/${id}?offset=0`, buf.subarray(0, chunkSize));
        return { id, chunkSize };
      };
      const stale = await start('oud.mp4');
      const active = await start('actief.mp4');
      const inflight = await start('bezig.mp4');
      const old = new Date(Date.now() - 48 * 3600_000).toISOString();
      srv.db.prepare('UPDATE uploads SET updated_at = ? WHERE id IN (?, ?)').run(old, stale.id, inflight.id);

      const tmp = srv.config.uploadTmpDir;
      const oldOrphan = path.join(tmp, 'a'.repeat(32) + '.part');
      const newOrphan = path.join(tmp, 'b'.repeat(32) + '.part');
      fs.writeFileSync(oldOrphan, 'x');
      fs.writeFileSync(newOrphan, 'x');
      const oldTime = new Date(Date.now() - 48 * 3600_000);
      fs.utimesSync(oldOrphan, oldTime, oldTime);

      // Blok voor "bezig" dat nog binnenkomt terwijl het opruimen draait
      let push;
      const body = new ReadableStream({ start(c) { push = c; } });
      const pending = fetch(`${srv.base}/api/uploads/${inflight.id}?offset=${inflight.chunkSize}`, {
        method: 'PUT', body, duplex: 'half',
        headers: { 'x-requested-with': 'review-tool', 'content-type': 'application/octet-stream', cookie: team.cookie() },
      });
      push.enqueue(new Uint8Array(buf.subarray(inflight.chunkSize, inflight.chunkSize + 100)));
      await new Promise((r) => setTimeout(r, 150));

      const result = await srv.created.uploads.cleanupExpired();
      assert.equal(result.removed, 1);
      assert.equal(result.orphans, 1);

      push.enqueue(new Uint8Array(buf.subarray(inflight.chunkSize + 100, inflight.chunkSize * 2)));
      push.close();
      assert.equal((await pending).status, 200, 'actief blok werd niet onderbroken');

      assert.equal((await team.get(`/api/uploads/${stale.id}`)).status, 404);
      assert.ok(!fs.existsSync(path.join(tmp, `${stale.id}.part`)));
      assert.ok(!fs.existsSync(oldOrphan));
      assert.ok(fs.existsSync(newOrphan));
      assert.equal((await team.get(`/api/uploads/${inflight.id}`)).status, 200);

      // De actieve upload kan gewoon worden afgemaakt
      for (let offset = active.chunkSize; offset < buf.length; offset += active.chunkSize) {
        await team.put(`/api/uploads/${active.id}?offset=${offset}`, buf.subarray(offset, offset + active.chunkSize));
      }
      const done = await team.post(`/api/projects/${projectId}/videos`, { uploadId: active.id, title: 'Actief' });
      assert.equal(done.status, 201);
    } finally {
      await srv.close();
    }
  });
});
