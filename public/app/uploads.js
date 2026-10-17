// Uploadwachtrij: per bestand voortgang, verwerking, succes of een concrete fout.
// Uploads lopen door terwijl je door de app navigeert.
import { h, icon, api, formatBytes, timecode, button, mount } from '/shared/util.js';
import { createUpload, sendChunks, cancelUpload } from './uploader.js';

let seq = 0;
const items = [];
const listeners = new Set();
let running = false;
let session = null;

const emit = () => listeners.forEach((fn) => fn(items));
// Voortgang hooguit ~4× per seconde tekenen, zodat knoppen in het paneel klikbaar blijven.
let lastProgressEmit = 0;
const emitProgress = () => { const t = Date.now(); if (t - lastProgressEmit > 250) { lastProgressEmit = t; emit(); } };
export const onUploadsChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const activeUploads = () => items.filter((i) => ['queued', 'uploading', 'processing'].includes(i.state));

export function configureUploads(s) { session = s; }

window.addEventListener('beforeunload', (e) => {
  if (activeUploads().length) { e.preventDefault(); e.returnValue = ''; }
});

/** Controleert type en grootte vóór het uploaden; geeft een foutmelding of null. */
export function checkFile(file) {
  const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  if (!session.formats.includes(ext)) {
    return `“${file.name}” heeft geen ondersteund formaat. Gebruik ${session.formats.map((x) => '.' + x).join(', ')}.`;
  }
  if (file.size > session.maxUploadBytes) return `“${file.name}” is te groot (maximaal ${formatBytes(session.maxUploadBytes)}).`;
  if (!file.size) return `“${file.name}” is leeg.`;
  return null;
}

export function suggestTitle(filename) {
  return filename.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || 'Naamloze video';
}

/**
 * Zet een bestand in de wachtrij.
 * target: { kind: 'video', projectId, projectName, title } | { kind: 'version', videoId, videoTitle, nextNumber }
 */
export function enqueue(file, target, onDone) {
  const item = { key: ++seq, file, target, onDone, state: 'queued', progress: 0, sent: 0, error: null, retryable: false, uploadId: null, chunkSize: null, uploaded: false, result: null };
  items.unshift(item);
  emit();
  pump();
  return item;
}

export function retry(item) {
  item.state = 'queued';
  item.error = null;
  emit();
  pump();
}

export async function cancel(item) {
  item.controller?.abort();
  if (item.uploadId && !item.result) cancelUpload(item.uploadId);
  remove(item);
}

export function remove(item) {
  const i = items.indexOf(item);
  if (i >= 0) items.splice(i, 1);
  emit();
}

async function pump() {
  if (running) return;
  running = true;
  try {
    let item;
    while ((item = items.slice().reverse().find((i) => i.state === 'queued'))) await process(item);
  } finally {
    running = false;
  }
}

async function process(item) {
  item.controller = new AbortController();
  item.state = 'uploading';
  item.started = Date.now();
  item.startBytes = item.sent;
  emit();
  try {
    if (!item.uploaded) {
      if (!item.uploadId) {
        const init = await createUpload(item.file);
        item.uploadId = init.id;
        item.chunkSize = init.chunkSize;
      }
      await sendChunks(item.file, item.uploadId, item.chunkSize, {
        signal: item.controller.signal,
        onProgress: (fraction, sent) => { item.progress = fraction; item.sent = sent; item.note = null; emitProgress(); },
        onRetry: (n, wait) => { item.note = `Verbinding onderbroken, nieuwe poging over ${Math.round(wait / 1000)} s…`; emit(); },
      });
      item.uploaded = true;
    }
    item.state = 'processing';
    emit();
    const t = item.target;
    item.result = t.kind === 'video'
      ? await api('POST', `/api/projects/${t.projectId}/videos`, { uploadId: item.uploadId, title: t.title }, {}, { timeout: 300_000 })
      : await api('POST', `/api/videos/${t.videoId}/versions`, { uploadId: item.uploadId }, {}, { timeout: 300_000 });
    item.state = 'done';
    emit();
    item.onDone?.(item);
  } catch (err) {
    if (err.aborted) return;
    item.state = 'error';
    item.error = err.message;
    // Upload verlopen of onbekend: opnieuw beginnen. Inhoud afgekeurd (422) of te groot: niet zinvol om te herhalen.
    if (err.status === 404 || (err.status === 400 && /niet gevonden|verlopen/i.test(err.message))) {
      item.uploadId = null; item.uploaded = false; item.sent = 0; item.progress = 0;
    }
    item.retryable = ![413, 422].includes(err.status) && !/ondersteund/i.test(err.message);
    if (err.status === 422) item.error = `${err.message} Exporteer het bestand opnieuw (bij voorkeur H.264 in MP4) en upload het nog eens.`;
    emit();
  }
}

// ---------- Weergave ----------

function describe(item) {
  const t = item.target;
  return t.kind === 'video' ? `Nieuwe video in ${t.projectName}` : `Versie ${t.nextNumber} van “${t.videoTitle}”`;
}

function statusLine(item) {
  if (item.state === 'queued') return 'In de wachtrij…';
  if (item.state === 'processing') return 'Bestand wordt gecontroleerd en verwerkt…';
  if (item.state === 'done') return item.target.kind === 'video' ? 'Klaar · staat als Concept in het project' : 'Klaar · nieuwe versie staat intern als Concept';
  if (item.state === 'error') return item.error;
  if (item.note) return item.note;
  const secs = (Date.now() - item.started) / 1000;
  const speed = secs > 1 ? (item.sent - item.startBytes) / secs : 0;
  const remaining = speed ? (item.file.size - item.sent) / speed : 0;
  return `${Math.floor(item.progress * 100)}% · ${formatBytes(item.sent)} van ${formatBytes(item.file.size)}${speed ? ` · nog ca. ${timecode(remaining)}` : ''}`;
}

/** Zwevend paneel met alle uploads. openItem(item) navigeert naar het resultaat. */
export function createUploadTray({ openItem }) {
  const list = h('div', { class: 'tray-list' });
  const title = h('strong', {}, 'Uploads');
  let collapsed = false;
  const toggle = button('', { icon: 'chevronDown', variant: 'ghost', size: 'sm', 'aria-label': 'Uploadpaneel in- of uitklappen', onClick: () => { collapsed = !collapsed; render(items); } });
  const el = h('section', { class: 'upload-tray', 'aria-label': 'Uploads', hidden: true },
    h('header', { class: 'tray-head' }, icon('upload'), title, h('span', { class: 'pc-spacer' }), toggle), list);

  function render(all) {
    el.hidden = !all.length;
    el.classList.toggle('is-collapsed', collapsed);
    const active = all.filter((i) => ['queued', 'uploading', 'processing'].includes(i.state)).length;
    const failed = all.filter((i) => i.state === 'error').length;
    title.textContent = active ? `Uploaden (${active})` : failed ? `Uploads · ${failed} mislukt` : 'Uploads voltooid';
    mount(list, ...all.map((item) => h('div', { class: `tray-item is-${item.state}` },
      h('div', { class: 'tray-item-head' },
        icon(item.state === 'done' ? 'checkCircle' : item.state === 'error' ? 'alert' : 'film'),
        h('div', { class: 'tray-item-text' },
          h('div', { class: 'truncate tray-name', title: item.file.name }, item.file.name),
          h('div', { class: 'truncate small muted' }, describe(item)))),
      ['uploading', 'queued', 'processing'].includes(item.state)
        ? h('div', { class: `progress${item.state === 'processing' ? ' is-indeterminate' : ''}` }, progressBar(item))
        : null,
      h('div', { class: `tray-status${item.state === 'error' ? ' is-error' : ''}`, role: item.state === 'error' ? 'alert' : null }, statusLine(item)),
      h('div', { class: 'tray-actions' },
        item.state === 'error' && item.retryable ? button('Opnieuw proberen', { icon: 'refresh', size: 'sm', onClick: () => retry(item) }) : null,
        item.state === 'done' ? button('Openen', { size: 'sm', onClick: () => { openItem(item); } }) : null,
        ['uploading', 'queued'].includes(item.state) ? button('Annuleren', { size: 'sm', variant: 'ghost', onClick: () => cancel(item) }) : null,
        ['done', 'error'].includes(item.state) ? button('Sluiten', { size: 'sm', variant: 'ghost', onClick: () => remove(item) }) : null))));
  }
  function progressBar(item) {
    const bar = h('div', { class: 'progress-bar' });
    bar.style.width = `${(item.progress * 100).toFixed(1)}%`;
    return bar;
  }
  onUploadsChange(render);
  return el;
}
