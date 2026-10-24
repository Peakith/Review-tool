'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createApp } = require('../server/app');

function makeVideo(dir, name, seconds = 2, size = '320x180') {
  const file = path.join(dir, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=25:duration=${seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  return file;
}

const SETUP_TOKEN = 'test-installatiecode-123';
const rid = () => require('node:crypto').randomBytes(12).toString('hex');

async function startServer(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
  // Alles in tijdelijke mappen, ook back-ups en instellingen (nooit de echte ~/Studio Review).
  const created = createApp({
    dataDir, backupDir: `${dataDir}-backups`, minFreeBytes: 0, chunkBytes: 4096, setupToken: SETUP_TOKEN,
    env: { ...process.env, STUDIO_REVIEW_HOME: `${dataDir}-home`, DATA_DIR: '', MEDIA_DIR: '', BACKUP_DIR: '' },
    ...overrides,
  });
  const { app, db, config } = created;
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, db, config, dataDir, created,
    async close() {
      created.stop();
      await new Promise((r) => server.close(r));
      db.close();
      for (const d of [dataDir, `${dataDir}-backups`, `${dataDir}-home`]) fs.rmSync(d, { recursive: true, force: true });
    },
  };
}

/** Kleine HTTP-client met cookie, zoals de browser. */
function client(base) {
  let cookie = '';
  async function request(method, url, body, extraHeaders = {}) {
    const headers = { 'x-requested-with': 'review-tool', ...extraHeaders };
    if (cookie) headers.cookie = cookie;
    let payload;
    if (Buffer.isBuffer(body)) {
      payload = body;
      headers['content-type'] = 'application/octet-stream';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, data };
  }
  return {
    get: (u, h) => request('GET', u, undefined, h),
    post: (u, b, h) => request('POST', u, b ?? {}, h),
    put: (u, b, h) => request('PUT', u, b, h),
    patch: (u, b) => request('PATCH', u, b),
    del: (u, h) => request('DELETE', u, undefined, h),
    cookie: () => cookie,
  };
}

async function upload(c, file, target = {}) {
  const buf = fs.readFileSync(file);
  const init = await c.post('/api/uploads', { filename: path.basename(file), size: buf.length, ...target });
  if (init.status !== 201) throw new Error(JSON.stringify(init.data));
  const { id, chunkSize } = init.data;
  for (let offset = 0; offset < buf.length; offset += chunkSize) {
    const r = await c.put(`/api/uploads/${id}?offset=${offset}`, buf.subarray(offset, offset + chunkSize));
    if (r.status !== 200) throw new Error(JSON.stringify(r.data));
  }
  return id;
}

/** Beheerder aanmaken en ingelogde client teruggeven. */
async function setupAdmin(srv, email = 'beheer@agency.nl') {
  const c = client(srv.base);
  const r = await c.post('/api/setup', { setupToken: SETUP_TOKEN, email, name: 'Beheer', password: 'een-lang-wachtwoord' });
  if (r.status !== 201) throw new Error(JSON.stringify(r.data));
  return c;
}

/** Teamlid aanmaken (door beheerder) en ingelogde client teruggeven. */
async function addMember(srv, admin, { email, name = 'Freelancer', role = 'member', projects = [] }) {
  const r = await admin.post('/api/users', { email, name, password: 'een-lang-wachtwoord', role, projects });
  if (r.status !== 201) throw new Error(JSON.stringify(r.data));
  const c = client(srv.base);
  const login = await c.post('/api/login', { email, password: 'een-lang-wachtwoord' });
  if (login.status !== 200) throw new Error(JSON.stringify(login.data));
  return { client: c, id: r.data.id };
}

/** Project met één video (gedeeld, met reviewlink) via de beheerder. */
async function sharedVideo(admin, file, { name = 'Project', title = 'Video' } = {}) {
  const projectId = (await admin.post('/api/projects', { name })).data.id;
  const created = (await admin.post(`/api/projects/${projectId}/videos`, { uploadId: await upload(admin, file, { projectId }), title })).data;
  await admin.post(`/api/versions/${created.versionId}/ready`);
  await admin.post(`/api/versions/${created.versionId}/share`);
  const video = (await admin.get(`/api/videos/${created.videoId}`)).data;
  const token = new URL(video.links.find((l) => l.role === 'reviewer').url).pathname.split('/').pop();
  return { projectId, videoId: created.videoId, versionId: created.versionId, token };
}

module.exports = { makeVideo, startServer, client, upload, rid, SETUP_TOKEN, setupAdmin, addMember, sharedVideo };
