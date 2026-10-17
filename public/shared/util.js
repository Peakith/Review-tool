// Kleine hulpfuncties voor team- en klantpagina. Alle tekst gaat via textContent,
// zodat ingevoerde titels en reacties nooit als HTML worden uitgevoerd.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const STATUS_LABELS = {
  concept: 'Concept',
  ready_for_review: 'Klaar voor review',
  in_review: 'In review',
  changes_requested: 'Aanpassingen nodig',
  approved: 'Goedgekeurd',
};

export function statusPill(status) {
  return h('span', { class: `pill pill-${status}` }, STATUS_LABELS[status] || status);
}

export function timecode(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '';
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

const dateFmt = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const formatDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '');

export function relativeDate(iso) {
  if (!iso) return '';
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return 'zojuist';
  if (diff < 3600) return `${Math.floor(diff / 60)} min geleden`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} uur geleden`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d geleden`;
  return formatDate(iso);
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export async function api(method, url, body, extraHeaders = {}) {
  const headers = { 'x-requested-with': 'review-tool', ...extraHeaders };
  const opts = { method, headers, credentials: 'same-origin' };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw Object.assign(new Error('Geen verbinding met de server. Controleer je internetverbinding.'), { status: 0 });
  }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error(data?.error || `Er ging iets mis (${res.status})`), { status: res.status, data });
  return data;
}

let toastTimer;
export function toast(message, type = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `toast show toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, type === 'error' ? 6000 : 3000);
}

/** Bevestigingsvenster met eigen knoptekst. Resolvet naar true/false. */
export function confirmDialog({ title, body, confirmLabel = 'Bevestigen', cancelLabel = 'Annuleren', danger = false }) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog' },
      h('form', { method: 'dialog' },
        h('h2', {}, title),
        typeof body === 'string' ? h('p', {}, body) : body,
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn btn-ghost', value: 'cancel' }, cancelLabel),
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, value: 'ok' }, confirmLabel))));
    document.body.append(dialog);
    dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'ok'); dialog.remove(); });
    dialog.showModal();
  });
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = h('textarea', {}, text);
  document.body.append(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

/** Unieke id per gebruikersactie; bij een herhaalpoging wordt dezelfde id meegestuurd. */
export function newRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Zoals api(), maar probeert bij een verbroken verbinding opnieuw met exact
 * hetzelfde verzoek (inclusief requestId). De server herkent de herhaling.
 */
export async function apiWithRetry(method, url, body, extraHeaders = {}, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await api(method, url, body, extraHeaders);
    } catch (err) {
      if (err.status !== 0 || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}
