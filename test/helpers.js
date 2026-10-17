'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createApp } = require('../server/app');

function makeVideo(dir, name, seconds = 2) {
  const file = path.join(dir, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=25:duration=${seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  return file;
}

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
  const { app, db, config } = createApp({ dataDir, chunkBytes: 4096 });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, db, config, dataDir,
    async close() {
      await new Promise((r) => server.close(r));
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
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
  };
}

async function upload(c, file) {
  const buf = fs.readFileSync(file);
  const init = await c.post('/api/uploads', { filename: path.basename(file), size: buf.length });
  if (init.status !== 201) throw new Error(JSON.stringify(init.data));
  const { id, chunkSize } = init.data;
  for (let offset = 0; offset < buf.length; offset += chunkSize) {
    const r = await c.put(`/api/uploads/${id}?offset=${offset}`, buf.subarray(offset, offset + chunkSize));
    if (r.status !== 200) throw new Error(JSON.stringify(r.data));
  }
  return id;
}

module.exports = { makeVideo, startServer, client, upload };
