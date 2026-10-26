'use strict';
// Bouwronde 5, fase D: afspeelversies (kwaliteiten) en downloadrechten.
// Echte codering met ffmpeg: een 4K-bron, een lagere bron, staand beeld, rotatie, zonder geluid en
// niet-vierkante pixels. Daarna de toegang: zonder downloadrecht nooit het origineel, wel de varianten,
// en dezelfde controles (wachtwoord, verlopen, ingetrokken, klanttoegang uit) op alle afspeelbestanden.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, upload, rid, setupAdmin } = require('./helpers');
const { createBackup, verifyBackup } = require('../server/backup');
const { planLevels } = require('../server/variants');

let srv;
let admin;
let projectId;
const ffprobe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString());
const tokenOf = (url) => new URL(url, 'http://x').pathname.split('/').pop();

function source(name, { size, seconds = 2, audio = true, extra = [], post = null }) {
  const file = path.join(srv.dataDir, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=25:duration=${seconds}`,
    ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`] : []),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', ...extra, ...(audio ? ['-c:a', 'aac', '-shortest'] : []), file]);
  if (post) {
    const out = `${file}.tmp.mp4`;
    execFileSync('ffmpeg', ['-y', '-v', 'error', ...post, '-i', file, '-c', 'copy', out]);
    fs.renameSync(out, file);
  }
  return file;
}
async function addVideo(file, title) {
  const v = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title })).data;
  return v;
}
const variantsOf = (versionId) => srv.db.prepare('SELECT * FROM version_variants WHERE version_id = ? ORDER BY level').all(versionId);
const storedOf = (versionId) => srv.db.prepare('SELECT stored_name FROM versions WHERE id = ?').get(versionId).stored_name;

const V = {};
before(async () => {
  srv = await startServer({ variants: true });
  admin = await setupAdmin(srv);
  projectId = (await admin.post('/api/projects', { name: 'Kwaliteit' })).data.id;
  V.uhd = await addVideo(source('uhd.mp4', { size: '3840x2160' }), '4K bron');
  V.hd = await addVideo(source('hd.mp4', { size: '1280x720' }), 'HD bron');
  V.vertical = await addVideo(source('staand.mp4', { size: '1080x1920' }), 'Staand');
  V.rotated = await addVideo(source('gedraaid.mp4', { size: '1280x720', post: ['-display_rotation', '90'] }), 'Gedraaid');
  V.small = await addVideo(source('klein.mp4', { size: '320x180', audio: false }), 'Klein zonder geluid');
  V.anamorphic = await addVideo(source('pal.mp4', { size: '720x576', extra: ['-vf', 'setsar=16/15'] }), 'Niet-vierkante pixels');
  await srv.created.variants.whenIdle();
});
after(() => srv.close());

test('niveauplanning: alleen wat de bron heeft, eerst het laagste', () => {
  assert.deepEqual(planLevels(2160), [720, 1080, 1440, 2160]);
  assert.deepEqual(planLevels(1080), [720, 1080]);
  assert.deepEqual(planLevels(1200), [720, 1080]);
  assert.deepEqual(planLevels(720), [720]);
  assert.deepEqual(planLevels(576), [576]);
  assert.deepEqual(planLevels(181), [180]);
});

test('4K-bron: 720p, 1080p, 1440p en 4K, met behoud van beeldverhouding, duur en geluid', async () => {
  const list = variantsOf(V.uhd.versionId);
  assert.deepEqual(list.map((v) => [v.level, v.width, v.height]), [[720, 1280, 720], [1080, 1920, 1080], [1440, 2560, 1440], [2160, 3840, 2160]]);
  for (const v of list) {
    const file = srv.created.storage.localPath(`${storedOf(V.uhd.versionId)}.v${v.level}.m4s`);
    const p = ffprobe(file);
    const video = p.streams.find((s) => s.codec_type === 'video');
    const audio = p.streams.find((s) => s.codec_type === 'audio');
    assert.equal(video.codec_name, 'h264');
    assert.equal(video.pix_fmt, 'yuv420p');
    assert.ok(audio && audio.codec_name === 'aac' && audio.channels === 2 && Number(audio.sample_rate) === 48000, 'geluid behouden');
    assert.ok(Math.abs(Number(p.format.duration) - 2) < 0.15, `duur ${p.format.duration}`);
    // Profiel volgt wat x264 werkelijk maakte (in de tests met de snelste instelling).
    assert.match(v.codecs, /^avc1\.[0-9a-f]{6},mp4a\.40\.2$/);
    assert.equal(v.size_bytes, fs.statSync(file).size);
  }
  const team = (await admin.get(`/api/videos/${V.uhd.videoId}`)).data;
  const pb = team.versions[0].playback;
  assert.equal(pb.status, 'done');
  assert.deepEqual(pb.levels.map((l) => l.label), ['4K', '1440p', '1080p', '720p']);
  assert.ok(pb.bytes > 0);
  assert.equal(pb.hdr, false);
});

test('lagere bron, staand, gedraaid, klein zonder geluid en niet-vierkante pixels', async () => {
  assert.deepEqual(variantsOf(V.hd.versionId).map((v) => [v.level, v.width, v.height]), [[720, 1280, 720]], 'geen opgeschaalde 1080p');
  assert.deepEqual(variantsOf(V.vertical.versionId).map((v) => [v.level, v.width, v.height]), [[720, 720, 1280], [1080, 1080, 1920]], 'staand: korte zijde bepaalt het niveau');
  assert.deepEqual(variantsOf(V.rotated.versionId).map((v) => [v.level, v.width, v.height]), [[720, 720, 1280]], 'rotatie toegepast: staand beeld');
  const small = variantsOf(V.small.versionId);
  assert.deepEqual(small.map((v) => [v.level, v.width, v.height]), [[180, 320, 180]]);
  assert.match(small[0].codecs, /^avc1\.[0-9a-f]{6}$/, 'zonder geluid: geen audiocodec in de afspeellijst');
  const pal = variantsOf(V.anamorphic.versionId);
  assert.deepEqual(pal.map((v) => [v.level, v.width, v.height]), [[576, 768, 576]], '16:15-pixels rechtgezet naar 768×576');
  const out = ffprobe(srv.created.storage.localPath(`${storedOf(V.anamorphic.versionId)}.v576.m4s`)).streams[0];
  assert.ok(['1:1', undefined].includes(out.sample_aspect_ratio), out.sample_aspect_ratio);
});

test('downloadrecht: zonder geen origineel (ook niet via een ander adres); varianten via HLS met dezelfde controles', async () => {
  await admin.post(`/api/versions/${V.uhd.versionId}/ready`);
  await admin.post(`/api/versions/${V.uhd.versionId}/share`, { requestId: rid() });
  const video = (await admin.get(`/api/videos/${V.uhd.videoId}`)).data;
  const reviewer = video.links.find((l) => l.role === 'reviewer');
  assert.equal(reviewer.allowDownload, false, 'nieuwe reviewlink: standaard geen download');
  const t = tokenOf(reviewer.url);
  const guest = client(srv.base);
  const base = `/api/review/${t}/versions/${V.uhd.versionId}`;
  const info = (await guest.get(`/api/review/${t}`)).data;
  assert.equal(info.versions[0].playback.original, false);
  assert.deepEqual(info.versions[0].playback.levels.map((l) => l.label), ['4K', '1440p', '1080p', '720p']);
  const orig = await guest.get(`${base}/media`);
  assert.equal(orig.status, 403);
  assert.equal(orig.data.code, 'original_blocked');
  assert.equal((await guest.get(`${base}/download`)).status, 403);
  // Hoofdafspeellijst: alleen relatieve verwijzingen naar de kwaliteiten
  const master = await guest.get(`${base}/hls/master.m3u8`);
  assert.equal(master.status, 200);
  assert.match(master.headers.get('content-type'), /mpegurl/);
  assert.equal(master.headers.get('cache-control'), 'private, no-store');
  const text = master.data.toString();
  assert.equal((text.match(/#EXT-X-STREAM-INF/g) || []).length, 4);
  assert.match(text, /RESOLUTION=3840x2160,CODECS="avc1\.[0-9a-f]{6},mp4a\.40\.2",FRAME-RATE=25\.000\n2160\/index\.m3u8/);
  assert.ok(!text.includes(storedOf(V.uhd.versionId)), 'geen interne bestandsnamen');
  const list = (await guest.get(`${base}/hls/1080/index.m3u8`)).data.toString();
  assert.match(list, /#EXT-X-MAP:URI="seg\.m4s",BYTERANGE="\d+@0"/);
  assert.ok(!list.includes(storedOf(V.uhd.versionId)));
  const part = await guest.get(`${base}/hls/1080/seg.m4s`, { range: 'bytes=0-999' });
  assert.equal(part.status, 206);
  assert.equal(part.data.length, 1000);
  assert.equal((await guest.get(`${base}/hls/480/index.m3u8`)).status, 404, 'onbekend niveau');
  // Een interne (niet gepubliceerde) versie: ook de varianten niet
  const v2 = (await admin.post(`/api/videos/${V.uhd.videoId}/versions`, { uploadId: await upload(admin, path.join(srv.dataDir, 'hd.mp4'), { videoId: V.uhd.videoId }) })).data.versionId;
  await srv.created.variants.whenIdle();
  assert.equal((await guest.get(`/api/review/${t}/versions/${v2}/hls/master.m3u8`)).status, 404);
  assert.equal((await guest.get(`/api/review/${t}/versions/${v2}/hls/720/seg.m4s`)).status, 404);

  // Met downloadrecht: origineel wel
  const dl = (await admin.post(`/api/videos/${V.uhd.videoId}/links`, { role: 'reviewer', label: 'Met download', allowDownload: true })).data;
  const dlBase = `/api/review/${tokenOf(dl.url)}/versions/${V.uhd.versionId}`;
  assert.equal((await guest.get(`${dlBase}/media`, { range: 'bytes=0-9' })).status, 206);
  assert.equal((await client(srv.base).get(`/api/review/${tokenOf(dl.url)}`)).data.versions[0].playback.original, true);

  // Wachtwoord, verlopen, klanttoegang uit en ingetrokken: ook op afspeellijsten en segmenten
  const urls = [`${base}/hls/master.m3u8`, `${base}/hls/720/index.m3u8`, `${base}/hls/720/seg.m4s`];
  await admin.put(`/api/link-protection/share/${reviewer.id}`, { password: 'kwaliteit-1' });
  for (const u of urls) assert.equal((await client(srv.base).get(u)).status, 401, u);
  await admin.put(`/api/link-protection/share/${reviewer.id}`, { password: null });
  srv.db.prepare('UPDATE share_links SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', reviewer.id);
  for (const u of urls) assert.equal((await client(srv.base).get(u)).status, 410, u);
  srv.db.prepare('UPDATE share_links SET expires_at = NULL WHERE id = ?').run(reviewer.id);
  await admin.put(`/api/projects/${projectId}/client-visibility`, { visibility: 'off' });
  for (const u of urls) assert.equal((await client(srv.base).get(u)).data.code, 'client_access_off', u);
  await admin.put(`/api/projects/${projectId}/client-visibility`, { visibility: 'active' });
  assert.equal((await client(srv.base).get(urls[2], { range: 'bytes=0-9' })).status, 206);
  await admin.post(`/api/links/${reviewer.id}/revoke`);
  for (const u of urls) assert.equal((await client(srv.base).get(u)).status, 410, u);
  // Team: varianten en origineel
  assert.equal((await admin.get(`/api/versions/${V.uhd.versionId}/hls/master.m3u8`)).status, 200);
  assert.equal((await client(srv.base).get(`/api/versions/${V.uhd.versionId}/hls/master.m3u8`)).status, 401);
});

test('opslag, back-up en definitief verwijderen tellen de afspeelversies mee', async () => {
  const usage = (await admin.get('/api/storage')).data;
  const bytes = variantsOf(V.hd.versionId).reduce((n, v) => n + v.size_bytes, 0);
  assert.ok(bytes > 0);
  const all = srv.db.prepare('SELECT SUM(size_bytes) AS n FROM version_variants').get().n;
  assert.equal(usage.totals.variants >= all, true, 'opslagoverzicht toont de afspeelversies apart');
  assert.ok(usage.totals.all >= usage.totals.variants);
  const backup = await createBackup({ db: srv.db, config: srv.config, storage: srv.created.storage, label: 'varianten' });
  const manifest = JSON.parse(fs.readFileSync(path.join(backup.dir, 'manifest.json'), 'utf8'));
  const stored = storedOf(V.hd.versionId);
  assert.ok(manifest.files.some((f) => f.key === `${stored}.v720.m4s`) && manifest.files.some((f) => f.key === `${stored}.v720.m3u8`));
  assert.ok((await verifyBackup(backup.dir, { deep: true })).ok);
  // Definitief verwijderen: ook de varianten weg
  await admin.del(`/api/videos/${V.hd.videoId}`);
  const preview = (await admin.get(`/api/trash/video/${V.hd.videoId}/purge-preview`)).data;
  assert.ok(preview.files.some((f) => f.kind === 'variant'));
  await admin.post(`/api/trash/video/${V.hd.videoId}/purge`, { confirm: true, expectedFiles: preview.fileCount });
  assert.equal(fs.existsSync(srv.created.storage.localPath(`${stored}.v720.m4s`)), false);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM version_variants v JOIN versions x ON x.id = v.version_id WHERE x.stored_name = ?').get(stored).n, 0);
});

test('fout of te weinig ruimte: duidelijke melding, opnieuw proberen', async () => {
  const id = V.small.versionId;
  srv.db.prepare('DELETE FROM version_variants WHERE version_id = ?').run(id);
  srv.config.minFreeBytes = 1e18; // onmogelijk veel vrije ruimte vereist
  assert.equal((await admin.post(`/api/versions/${id}/playback/retry`)).status, 200);
  await srv.created.variants.whenIdle();
  let st = (await admin.get(`/api/versions/${id}/playback`)).data;
  assert.equal(st.status, 'failed');
  assert.match(st.error, /Te weinig vrije schijfruimte voor de 180p-versie/);
  srv.config.minFreeBytes = 0;
  await admin.post(`/api/versions/${id}/playback/retry`);
  await srv.created.variants.whenIdle();
  st = (await admin.get(`/api/versions/${id}/playback`)).data;
  assert.equal(st.status, 'done');
  assert.deepEqual(st.levels.map((l) => l.label), ['180p']);
  const viewer = client(srv.base);
  assert.equal((await viewer.post(`/api/versions/${id}/playback/retry`)).status, 401);
});
