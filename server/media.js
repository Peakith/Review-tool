'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');

// Formaten die de eerste versie accepteert. Er wordt niet getranscodeerd:
// het bestand wordt afgespeeld zoals het is geüpload.
const FORMATS = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

function extensionOf(filename) {
  const ext = path.extname(String(filename || '')).slice(1).toLowerCase();
  return FORMATS[ext] ? ext : null;
}

/** "klant_campagne_edit_v03.mp4" -> "klant campagne edit v03" (alleen als voorstel). */
function titleFromFilename(filename) {
  const base = path.basename(String(filename || ''));
  const withoutExt = base.replace(/\.[a-z0-9]{2,5}$/i, '');
  return withoutExt.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Naamloze video';
}

function normalizeTitle(title) {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.slice(0, 200);
}

/** Bestandsnaam voor downloads: zichtbare titel + echte extensie van het bestand. */
function downloadFilename(title, extension) {
  let safe = String(title || 'video')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (!safe) safe = 'video';
  const suffix = `.${extension}`;
  if (safe.toLowerCase().endsWith(suffix)) safe = safe.slice(0, -suffix.length);
  return `${safe}${suffix}`;
}

function contentDisposition(filename) {
  const ascii = filename.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'video';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function run(cmd, args, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

let toolsAvailable;
async function hasFfmpeg() {
  if (toolsAvailable === undefined) {
    try {
      await run('ffprobe', ['-version'], 5000);
      await run('ffmpeg', ['-version'], 5000);
      toolsAvailable = true;
    } catch {
      toolsAvailable = false;
    }
  }
  return toolsAvailable;
}

/**
 * Leest technische gegevens uit. Geeft null terug als ffprobe niet beschikbaar
 * is; gooit een fout als het bestand geen leesbare video bevat.
 */
async function probe(file) {
  if (!(await hasFfmpeg())) return null;
  let out;
  try {
    out = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  } catch {
    throw new Error('Het bestand kon niet als video worden gelezen. Controleer of het een geldig videobestand is.');
  }
  const data = JSON.parse(out);
  const video = (data.streams || []).find((s) => s.codec_type === 'video');
  if (!video) throw new Error('Het bestand bevat geen videospoor.');
  const duration = Number(data.format?.duration || video.duration);
  return {
    duration: Number.isFinite(duration) ? duration : null,
    width: video.width || null,
    height: video.height || null,
    codec: video.codec_name,
  };
}

async function makePoster(file, posterFile, duration) {
  if (!(await hasFfmpeg())) return false;
  const at = duration ? Math.min(1, duration / 3) : 0;
  try {
    await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', posterFile], 120_000);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  FORMATS, extensionOf, titleFromFilename, normalizeTitle, downloadFilename,
  contentDisposition, probe, makePoster, hasFfmpeg,
};
