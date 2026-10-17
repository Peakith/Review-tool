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
  // Terugval voor oudere clients: gangbare tekens omzetten, rest weglaten.
  const ascii = filename
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'video';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
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

// Paden naar ffprobe/ffmpeg zijn instelbaar (FFPROBE_PATH / FFMPEG_PATH).
const availability = new Map();
async function toolAvailable(cmd) {
  if (!availability.has(cmd)) {
    availability.set(cmd, run(cmd, ['-version'], 5000).then(() => true, () => false));
  }
  return availability.get(cmd);
}

/** Status van de externe hulpmiddelen, voor de startmelding, /api/health en de teamomgeving. */
async function toolStatus(tools) {
  const [ffprobe, ffmpeg] = await Promise.all([toolAvailable(tools.ffprobe), toolAvailable(tools.ffmpeg)]);
  return { ffprobe, ffmpeg };
}

// Containerfamilie die bij de extensie hoort (ffprobe format_name).
const CONTAINERS = {
  mp4: ['mov', 'mp4'],
  m4v: ['mov', 'mp4'],
  mov: ['mov', 'mp4'],
  webm: ['webm', 'matroska'],
};

/**
 * Controleert de inhoud en leest technische gegevens uit. Gooit een fout als
 * het bestand geen leesbare video is of niet bij de extensie past.
 */
async function probe(file, extension, tools) {
  let out;
  try {
    out = await run(tools.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  } catch {
    throw new Error('Het bestand kon niet als video worden gelezen. Controleer of het een geldig videobestand is.');
  }
  const data = JSON.parse(out);
  const formats = String(data.format?.format_name || '').split(',');
  if (!CONTAINERS[extension].some((f) => formats.includes(f))) {
    throw new Error(`De inhoud van het bestand past niet bij de extensie .${extension}.`);
  }
  const video = (data.streams || []).find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  if (!video) throw new Error('Het bestand bevat geen videospoor.');
  const audio = (data.streams || []).find((s) => s.codec_type === 'audio');
  const duration = Number(data.format?.duration || video.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('De duur van de video kon niet worden bepaald.');
  return {
    duration,
    width: video.width || null,
    height: video.height || null,
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name || null,
  };
}

async function makePoster(file, posterFile, duration, tools) {
  if (!(await toolAvailable(tools.ffmpeg))) return false;
  const at = duration ? Math.min(1, duration / 3) : 0;
  try {
    await run(tools.ffmpeg, ['-y', '-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', posterFile], 120_000);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  FORMATS, extensionOf, titleFromFilename, normalizeTitle, downloadFilename,
  contentDisposition, probe, makePoster, toolAvailable, toolStatus,
};
