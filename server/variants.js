'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { now } = require('./db');
const { resolveTools } = require('./media');
const { HttpError } = require('./status');

/**
 * Afspeelversies (kwaliteiten) per videoversie.
 *
 * - Alleen niveaus die de bron echt heeft: 4K (2160), 1440p, 1080p en 720p, gemeten aan de korte zijde
 *   van het beeld zoals het wordt getoond (rotatie en niet-vierkante pixels meegerekend). Een bron
 *   kleiner dan 720p krijgt één versie op eigen formaat.
 * - Volgorde: eerst 720p (of het enige niveau), zodat afspelen snel kan; daarna de hogere niveaus.
 * - H.264 (High) + AAC stereo 48 kHz in fragmented MP4, als HLS-afspeellijst met één bestand per
 *   kwaliteit. Sleutelbeelden elke 2 seconden, zodat wisselen van kwaliteit naadloos kan.
 * - Beeldverhouding, rotatie en geluid blijven behouden; het origineel wordt nooit aangeraakt.
 * - HDR-bronnen (PQ/HLG) worden zonder omzetting naar 8-bit SDR gecodeerd en kunnen flets ogen; het
 *   origineel blijft de referentie. Dat staat bij de versie vermeld.
 * - Verwerking op de achtergrond met voortgang, beperkte gelijktijdigheid, automatisch één nieuwe
 *   poging en een controle op vrije schijfruimte vóór elk niveau.
 */
const LEVELS = [2160, 1440, 1080, 720];
const LABELS = { 2160: '4K', 1440: '1440p', 1080: '1080p', 720: '720p' };
const label = (level) => LABELS[level] || `${level}p`;
// Bovengrens bitrate per niveau (bits/s); de kwaliteit zelf wordt met CRF geregeld.
const MAXRATE = { 2160: 20e6, 1440: 10e6, 1080: 6e6, 720: 3.5e6 };
const maxrateFor = (level) => MAXRATE[level] || Math.max(1e6, Math.round(3.5e6 * (level / 720) ** 2));
const AUTO_RETRIES = 1;

const keysFor = (stored, level) => ({ media: `${stored}.v${level}.m4s`, playlist: `${stored}.v${level}.m3u8` });

/** Welke niveaus maken we voor een bron met deze korte zijde? (oplopend: eerst het snelste) */
function planLevels(short) {
  const fit = LEVELS.filter((l) => l <= short + 8);
  if (!fit.length) return [Math.max(2, short - (short % 2))];
  return fit.sort((a, b) => a - b);
}

function runCapture(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `exit ${code}`))));
  });
}

/** Gegevens van de bron zoals die getoond wordt. */
async function probeSource(file, ffprobe) {
  const data = JSON.parse(await runCapture(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]));
  const v = (data.streams || []).find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  if (!v) throw new Error('Geen videospoor gevonden.');
  const a = (data.streams || []).find((s) => s.codec_type === 'audio');
  let rotation = Number(v.tags?.rotate || 0);
  for (const sd of v.side_data_list || []) if (sd.rotation !== undefined) rotation = Number(sd.rotation);
  rotation = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  const [sn, sd] = String(v.sample_aspect_ratio || '1:1').split(':').map(Number);
  const sar = sn > 0 && sd > 0 ? sn / sd : 1;
  let width = Math.round(v.width * sar);
  let height = v.height;
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  const [fn, fd] = String(v.avg_frame_rate || v.r_frame_rate || '25/1').split('/').map(Number);
  const fps = fn > 0 && fd > 0 ? fn / fd : 25;
  const transfer = v.color_transfer || '';
  return {
    width, height, short: Math.min(width, height), rotation, sar, fps: Math.round(fps * 1000) / 1000,
    duration: Number(data.format?.duration || v.duration) || 0,
    hasAudio: !!a, audioChannels: a?.channels || 0,
    hdr: ['smpte2084', 'arib-std-b67'].includes(transfer), colorTransfer: transfer || null,
    pixFmt: v.pix_fmt || null, codec: v.codec_name,
  };
}

/** RFC 6381-codecnaam van de gemaakte H.264-stroom (bijv. avc1.640028). */
async function codecsOf(file, ffprobe, hasAudio) {
  const data = JSON.parse(await runCapture(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', file]));
  const v = data.streams.find((s) => s.codec_type === 'video');
  const profile = { Baseline: 0x42, 'Constrained Baseline': 0x42, Main: 0x4d, High: 0x64 }[v.profile] || 0x64;
  const avc = `avc1.${profile.toString(16).padStart(2, '0')}00${Number(v.level || 40).toString(16).padStart(2, '0')}`;
  return { codecs: hasAudio ? `${avc},mp4a.40.2` : avc, width: v.width, height: v.height };
}

function createVariants({ db, config, storage }) {
  const running = new Map(); // versionId → child process
  let stopped = false;
  let tools = null;
  const getTools = async () => (tools ||= await resolveTools(config.tools));

  const jobOf = (versionId) => db.prepare('SELECT * FROM media_jobs WHERE version_id = ?').get(versionId);
  const variantsOf = (versionId) => db.prepare('SELECT * FROM version_variants WHERE version_id = ? ORDER BY level DESC').all(versionId);
  const STOPPED = Object.assign(new Error('gestopt'), { stopped: true });
  const update = (versionId, fields) => {
    if (stopped) throw STOPPED; // database kan al gesloten zijn
    const keys = Object.keys(fields);
    db.prepare(`UPDATE media_jobs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE version_id = ?`).run(...keys.map((k) => fields[k]), now(), versionId);
  };

  /** Taak toevoegen (bestaat hij al, dan verandert er niets). */
  function enqueue(versionId) {
    if (stopped) return;
    db.prepare("INSERT OR IGNORE INTO media_jobs (version_id, status, created_at, updated_at) VALUES (?, 'queued', ?, ?)").run(versionId, now(), now());
    setImmediate(pump);
  }

  /** Opnieuw proberen na een fout (handmatig). */
  function retry(versionId) {
    const j = jobOf(versionId);
    if (!j) { enqueue(versionId); return; }
    if (j.status === 'running' || j.status === 'queued') return;
    update(versionId, { status: 'queued', attempts: 0, error: null, progress: 0 });
    setImmediate(pump);
  }

  /** Bij het starten: onderbroken taken opnieuw in de rij en oudere versies alsnog verwerken. */
  function start() {
    fs.rmSync(path.join(config.mediaDir, '.variants-tmp'), { recursive: true, force: true });
    db.prepare("UPDATE media_jobs SET status = 'queued', updated_at = ? WHERE status = 'running'").run(now());
    const missing = db.prepare(`SELECT ver.id FROM versions ver WHERE ver.trashed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM media_jobs j WHERE j.version_id = ver.id)`).all();
    for (const r of missing) db.prepare("INSERT OR IGNORE INTO media_jobs (version_id, status, created_at, updated_at) VALUES (?, 'queued', ?, ?)").run(r.id, now(), now());
    setImmediate(pump);
    return missing.length;
  }

  function pump() {
    // Uitgeschakeld (alleen voor tests en ontwikkeling): taken worden wel genoteerd, niet uitgevoerd.
    if (stopped || config.variants === false) return;
    while (running.size < config.variantConcurrency) {
      // Gepubliceerde versies eerst (klanten wachten erop), daarna de nieuwste.
      const next = db.prepare(`SELECT j.version_id FROM media_jobs j JOIN versions ver ON ver.id = j.version_id
        WHERE j.status = 'queued' AND ver.trashed_at IS NULL ${running.size ? `AND j.version_id NOT IN (${[...running.keys()].join(',')})` : ''}
        ORDER BY ver.shared_at IS NULL, ver.id DESC LIMIT 1`).get();
      if (!next) return;
      running.set(next.version_id, null);
      runJob(next.version_id).catch((err) => { if (!stopped) console.error('Afspeelversie maken mislukt:', err); }).finally(() => {
        running.delete(next.version_id);
        if (stopped) return;
        notifyIdle();
        setImmediate(pump);
      });
    }
  }

  async function runJob(versionId) {
    if (stopped) return;
    const ver = db.prepare('SELECT * FROM versions WHERE id = ?').get(versionId);
    if (!ver) return;
    const job = jobOf(versionId);
    update(versionId, { status: 'running', attempts: job.attempts + 1, error: null });
    const t = await getTools();
    try {
      if (!t.ffmpeg || !t.ffprobe) throw Object.assign(new Error('ffmpeg ontbreekt op deze computer; afspeelversies kunnen niet worden gemaakt.'), { final: true });
      const src = storage.localPath(ver.stored_name);
      const info = await probeSource(src, t.ffprobe);
      const levels = planLevels(info.short);
      update(versionId, { levels: JSON.stringify(levels), source_info: JSON.stringify(info) });
      const done = new Set(variantsOf(versionId).map((v) => v.level));
      for (let i = 0; i < levels.length; i++) {
        const level = levels[i];
        if (done.has(level)) continue;
        if (stopped) throw Object.assign(new Error('gestopt'), { stopped: true });
        await checkSpace(level, info.duration);
        update(versionId, { current_level: level });
        await encode(ver, info, level, t, (f) => update(versionId, { progress: Math.min(0.999, (i + f) / levels.length) }));
      }
      update(versionId, { status: 'done', progress: 1, current_level: null, finished_at: now() });
    } catch (err) {
      if (stopped) return; // afsluiten: de taak blijft 'running' en gaat bij de volgende start terug in de rij
      if (err.stopped) { update(versionId, { status: 'queued', current_level: null }); return; }
      const fresh = jobOf(versionId);
      const again = !err.final && fresh.attempts <= AUTO_RETRIES;
      update(versionId, { status: again ? 'queued' : 'failed', error: String(err.message || err).slice(0, 500), current_level: null });
    }
  }

  async function checkSpace(level, duration) {
    const estimate = Math.ceil((maxrateFor(level) + 160e3) / 8 * duration * 1.1);
    const disk = await storage.freeBytes();
    if (disk && disk.free - estimate < config.minFreeBytes) {
      const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`;
      throw Object.assign(new Error(`Te weinig vrije schijfruimte voor de ${label(level)}-versie (geschat ${gb(estimate)} nodig, ${gb(disk.free)} vrij, minimaal ${gb(config.minFreeBytes)} moet vrij blijven).`), { final: true });
    }
  }

  async function encode(ver, info, level, t, onProgress) {
    const keys = keysFor(ver.stored_name, level);
    // Tijdelijk in een verborgen map op dezelfde schijf; pas na afloop (atomair) op de echte naam.
    const tmpDir = path.join(config.mediaDir, '.variants-tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpTag = `v${ver.id}-${level}-${Date.now()}`;
    const tmpMedia = path.join(tmpDir, `${tmpTag}.m4s`);
    const tmpList = path.join(tmpDir, `${tmpTag}.m3u8`);
    const landscape = info.width >= info.height;
    // Niet-vierkante pixels eerst rechtzetten, daarna de korte zijde op het niveau (even afmetingen).
    const vf = [info.sar !== 1 ? 'scale=trunc(iw*sar/2)*2:ih,setsar=1' : null, landscape ? `scale=-2:${level}` : `scale=${level}:-2`, 'setsar=1'].filter(Boolean).join(',');
    const rate = maxrateFor(level);
    const args = ['-y', '-v', 'error', '-nostdin', '-i', storage.localPath(ver.stored_name),
      '-map', '0:v:0', ...(info.hasAudio ? ['-map', '0:a:0'] : []),
      '-vf', vf, '-c:v', 'libx264', '-preset', config.variantPreset, '-crf', '20', '-maxrate', String(rate), '-bufsize', String(rate * 2),
      '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*2)', '-sc_threshold', '0',
      ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000'] : []),
      '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4', '-hls_flags', 'single_file',
      '-hls_segment_filename', tmpMedia, '-progress', 'pipe:1', tmpList];
    await new Promise((resolve, reject) => {
      const p = spawn(t.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      running.set(ver.id, p);
      let err = '';
      let buf = '';
      p.stdout.on('data', (d) => {
        buf += d;
        const m = [...buf.matchAll(/out_time_us=(\d+)/g)].pop();
        if (m && info.duration) onProgress(Math.min(1, Number(m[1]) / 1e6 / info.duration));
        if (buf.length > 4096) buf = buf.slice(-1024);
      });
      p.stderr.on('data', (d) => { err += d; if (err.length > 8192) err = err.slice(-4096); });
      p.on('error', reject);
      p.on('close', (code, signal) => {
        if (stopped) return reject(Object.assign(new Error('gestopt'), { stopped: true }));
        if (code === 0) return resolve();
        reject(new Error(`ffmpeg stopte (${signal || code}): ${err.trim().split('\n').slice(-2).join(' ')}`));
      });
    }).catch(async (e) => { await fsp.rm(tmpMedia, { force: true }); await fsp.rm(tmpList, { force: true }); throw e; });
    // Afspeellijst verwijst naar de tijdelijke naam; de server zet die bij het serveren om.
    const playlist = (await fsp.readFile(tmpList, 'utf8')).split(path.basename(tmpMedia)).join('seg.m4s');
    await fsp.writeFile(tmpList, playlist);
    const out = await codecsOf(tmpMedia, t.ffprobe, info.hasAudio);
    const size = (await fsp.stat(tmpMedia)).size;
    if (stopped) throw STOPPED;
    await fsp.rename(tmpMedia, storage.localPath(keys.media));
    await fsp.rename(tmpList, storage.localPath(keys.playlist));
    if (stopped) throw STOPPED;
    const bandwidth = Math.ceil((size * 8) / Math.max(0.5, info.duration) * 1.25);
    db.prepare(`INSERT OR REPLACE INTO version_variants (version_id, level, width, height, bandwidth, codecs, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(ver.id, level, out.width, out.height, bandwidth, out.codecs, size, now());
    onProgress(1);
  }

  // Wachten tot de rij leeg is (voor tests en het afsluiten).
  const idleWaiters = [];
  function notifyIdle() {
    if (stopped) { while (idleWaiters.length) idleWaiters.shift()(); return; }
    if (running.size || db.prepare("SELECT 1 FROM media_jobs WHERE status = 'queued'").get()) return;
    while (idleWaiters.length) idleWaiters.shift()();
  }
  function whenIdle() {
    return new Promise((resolve) => {
      idleWaiters.push(resolve);
      setImmediate(() => { pump(); notifyIdle(); });
    });
  }

  function stop() {
    stopped = true;
    for (const p of running.values()) p?.kill('SIGKILL');
  }

  /** Status voor het team en (beperkt) voor de klant. */
  function statusOf(versionId) {
    const j = jobOf(versionId);
    const variants = variantsOf(versionId);
    let planned = [];
    try { planned = JSON.parse(j?.levels || '[]'); } catch { planned = []; }
    let source = null;
    try { source = j?.source_info ? JSON.parse(j.source_info) : null; } catch { source = null; }
    return {
      status: j?.status || 'none',
      progress: j?.progress || 0,
      currentLevel: j?.current_level || null,
      error: j?.error || null,
      attempts: j?.attempts || 0,
      planned: planned.map((l) => ({ level: l, label: label(l) })),
      levels: variants.map((v) => ({ level: v.level, label: label(v.level), width: v.width, height: v.height, size: v.size_bytes })),
      hdr: !!source?.hdr,
      bytes: variants.reduce((n, v) => n + v.size_bytes, 0),
    };
  }

  return { enqueue, retry, start, stop, whenIdle, statusOf, variantsOf, jobOf };
}

/** Wat een speler moet weten: beschikbare kwaliteiten en of er nog verwerkt wordt. */
function playbackInfo(db, versionId) {
  const levels = db.prepare('SELECT level, width, height FROM version_variants WHERE version_id = ? ORDER BY level DESC').all(versionId)
    .map((v) => ({ level: v.level, label: label(v.level), width: v.width, height: v.height }));
  const j = db.prepare('SELECT status, progress FROM media_jobs WHERE version_id = ?').get(versionId);
  return { levels, preparing: !!j && ['queued', 'running'].includes(j.status), failed: j?.status === 'failed', progress: j?.progress || 0 };
}

/** Hoofdafspeellijst met alleen de kwaliteiten die klaar zijn. */
function masterPlaylist(variants, fps) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (const v of [...variants].sort((a, b) => a.level - b.level)) {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},RESOLUTION=${v.width}x${v.height},CODECS="${v.codecs}"${fps ? `,FRAME-RATE=${Number(fps).toFixed(3)}` : ''}`);
    lines.push(`${v.level}/index.m3u8`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * HLS-routes onder een prefix. versionOf(req) geeft de versie na de rechtencontrole van de aanroeper.
 * Bestanden worden nooit gecachet (ingetrokken of uitgezet betekent direct geen toegang).
 */
function hlsRoutes(router, prefix, { db, storage, versionOf }) {
  const NO_STORE = 'private, no-store';
  const fpsOf = (versionId) => { try { return JSON.parse(db.prepare('SELECT source_info FROM media_jobs WHERE version_id = ?').get(versionId)?.source_info || '{}').fps; } catch { return null; } };
  const variant = (ver, level) => {
    const v = db.prepare('SELECT * FROM version_variants WHERE version_id = ? AND level = ?').get(ver.id, Number(level));
    if (!v) throw new HttpError(404, 'Deze kwaliteit is (nog) niet beschikbaar.', 'not_found');
    return v;
  };
  router.get(`${prefix}/hls/master.m3u8`, (req, res) => {
    const ver = versionOf(req);
    const list = db.prepare('SELECT * FROM version_variants WHERE version_id = ?').all(ver.id);
    if (!list.length) throw new HttpError(404, 'De afspeelversies worden nog voorbereid.', 'preparing');
    res.set({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': NO_STORE }).send(masterPlaylist(list, fpsOf(ver.id)));
  });
  router.get(`${prefix}/hls/:level/index.m3u8`, async (req, res) => {
    const ver = versionOf(req);
    variant(ver, req.params.level);
    await storage.send(res, keysFor(ver.stored_name, Number(req.params.level)).playlist, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': NO_STORE });
  });
  // Eén bestand per kwaliteit; de speler vraagt delen op met Range.
  router.get(`${prefix}/hls/:level/seg.m4s`, async (req, res) => {
    const ver = versionOf(req);
    variant(ver, req.params.level);
    await storage.send(res, keysFor(ver.stored_name, Number(req.params.level)).media, { 'Content-Type': 'video/mp4', 'Cache-Control': NO_STORE });
  });
}

module.exports = { createVariants, hlsRoutes, playbackInfo, masterPlaylist, planLevels, probeSource, keysFor, label, LEVELS };
