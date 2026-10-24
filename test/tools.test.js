'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Simuleert een Mac waar Homebrew-mappen niet in PATH staan: ffprobe moet dan toch
// gevonden worden in een van de vaste installatiemappen.
test('ffprobe/ffmpeg worden ook buiten PATH gevonden', async () => {
  const expected = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].map((d) => `${d}/ffprobe`).find((f) => fs.existsSync(f));
  if (!expected) return; // geen ffprobe in een vaste map op deze machine
  process.env.PATH = '/bestaat-niet';
  const { resolveTools } = require('../server/media');
  const tools = await resolveTools({ ffprobe: null, ffmpeg: null });
  assert.equal(tools.ffprobe, expected);
  assert.ok(tools.ffmpeg);
});

test('een expliciet ingesteld pad wordt niet stilletjes vervangen', async () => {
  const { resolveTools } = require('../server/media');
  const tools = await resolveTools({ ffprobe: '/bestaat/niet/ffprobe', ffmpeg: null });
  assert.equal(tools.ffprobe, null);
});
