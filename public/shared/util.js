// Gedeelde bouwstenen voor team- en klantpagina. Alle tekst gaat via textContent,
// zodat ingevoerde titels en reacties nooit als HTML worden uitgevoerd.
import { tr, locale } from './i18n.js';
import { icon } from './icons.js';

export { icon };

/** Maakt een element. null/undefined/false-kinderen worden overgeslagen. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) el.value = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

const clean = (children) => children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false)
  .map((c) => (c instanceof Node ? c : document.createTextNode(String(c))));

/** append() zonder dat null als tekst "null" in de pagina belandt. */
export function append(parent, ...children) { parent.append(...clean(children)); return parent; }
/** replaceChildren() met dezelfde bescherming. */
export function mount(parent, ...children) { parent.replaceChildren(...clean(children)); return parent; }

// ---------- Knoppen ----------

/** Knop met optioneel icoon. variant: primary | secondary | ghost | danger | approve */
export function button(label, { icon: iconName, variant = 'secondary', size, type = 'button', onClick, title, ...rest } = {}) {
  return h('button', {
    type,
    class: `btn btn-${variant}${size ? ` btn-${size}` : ''}${label ? '' : ' btn-icon'}`,
    title: title || (!label ? rest['aria-label'] : undefined),
    onClick,
    ...rest,
  }, iconName ? icon(iconName) : null, label ? h('span', { class: 'btn-label' }, label) : null);
}

/** Zet een knop in "bezig"-stand en voorkomt dubbel klikken. Geeft een herstelfunctie terug. */
export function busy(btn, text) {
  const label = btn.querySelector('.btn-label');
  const original = label?.textContent;
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.setAttribute('aria-busy', 'true');
  if (label && text) label.textContent = text;
  return () => {
    btn.disabled = false;
    btn.classList.remove('is-busy');
    btn.removeAttribute('aria-busy');
    if (label && original !== undefined) label.textContent = original;
  };
}

// ---------- Status ----------

export const STATUS = {
  concept: { label: 'Concept', icon: 'dashed', hint: 'Alleen intern zichtbaar' },
  ready_for_review: { label: 'Klaar voor review', icon: 'flag', hint: 'Klaar om met de klant te delen' },
  in_review: { label: 'In review', icon: 'eye', hint: 'De klant kan bekijken en reageren' },
  changes_requested: { label: 'Aanpassingen nodig', icon: 'wrench', hint: 'De klant heeft feedback verstuurd' },
  approved: { label: 'Goedgekeurd', icon: 'checkCircle', hint: 'Goedgekeurd door de akkoordgever' },
};
export const STATUS_LABELS = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.label]));

/** Statuslabel met icoon én tekst, zodat het ook zonder kleur te begrijpen is. */
export function statusPill(status, { small = false } = {}) {
  const s = STATUS[status] || { label: status, icon: 'info' };
  return h('span', { class: `pill pill-${status}${small ? ' pill-sm' : ''}`, title: s.hint }, icon(s.icon), h('span', {}, s.label));
}

// ---------- Opmaak ----------

export function timecode(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '';
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

// Datumnotatie volgt de taal van de pagina (klantpagina's kunnen Engels zijn; het team ziet altijd Nederlands).
const fmtCache = new Map();
const fmt = (opts) => {
  const key = `${locale()}|${JSON.stringify(opts)}`;
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat(locale(), opts));
  return fmtCache.get(key);
};
const DATE = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
export const formatDate = (iso) => (iso ? fmt(DATE).format(new Date(iso)) : '');
/** Datum en tijd mét tijdzone ("12 nov 2026, 14:05 CET"), voor klantpagina's en vervaldatums. */
export const formatDateZone = (iso) => (iso ? fmt({ ...DATE, timeZoneName: 'short' }).format(new Date(iso)) : '');

export function relativeDate(iso) {
  if (!iso) return '';
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return tr('zojuist');
  if (diff < 3600) return tr('{n} min geleden', { n: Math.floor(diff / 60) });
  if (diff < 86400) return tr('{n} uur geleden', { n: Math.floor(diff / 3600) });
  if (diff < 2 * 86400) return tr('gisteren');
  if (diff < 7 * 86400) return tr('{n} dagen geleden', { n: Math.floor(diff / 86400) });
  return fmt({ day: 'numeric', month: 'short' }).format(new Date(iso));
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- Server ----------

/**
 * JSON-verzoek naar de API. Na `timeout` ms zonder antwoord volgt een duidelijke
 * fout (status 0), zodat de interface niet eindeloos blijft laden bij een trage verbinding.
 */
export async function api(method, url, body, extraHeaders = {}, { timeout = 30_000 } = {}) {
  const headers = { 'x-requested-with': 'review-tool', ...extraHeaders };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const opts = { method, headers, credentials: 'same-origin', signal: controller.signal };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    throw Object.assign(new Error(timedOut
      ? tr('De server reageert niet op tijd. Controleer je verbinding en probeer het opnieuw.')
      : tr('Geen verbinding met de server. Controleer je internetverbinding en probeer het opnieuw.')), { status: 0 });
  } finally {
    clearTimeout(timer);
  }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw Object.assign(new Error(data?.error ? tr(data.error) : tr('Er ging iets mis ({status}). Probeer het opnieuw.', { status: res.status })), { status: res.status, data, code: data?.code || null });
  return data;
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

// ---------- Terugkoppeling ----------

let toastHost;
/** Korte melding rechtsonder (mobiel: onderin). type: info | success | error */
export function toast(message, type = 'info', { action } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast toast-${type}` },
    icon(type === 'success' ? 'checkCircle' : type === 'error' ? 'alert' : 'info'),
    h('span', { class: 'toast-text' }, message),
    action ? h('button', { type: 'button', class: 'toast-action', onClick: () => { action.onClick(); el.remove(); } }, action.label) : null,
    h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Melding sluiten', onClick: () => el.remove() }, icon('x')));
  toastHost.append(el);
  // Hooguit drie meldingen tegelijk; de oudste verdwijnt eerst.
  while (toastHost.children.length > 3) toastHost.firstChild.remove();
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, type === 'error' ? 8000 : 4000);
}

/** Lege staat met icoon, uitleg en optionele actie. */
export function emptyState({ icon: iconName = 'info', title, text, action, compact = false }) {
  return h('div', { class: `empty${compact ? ' empty-compact' : ''}` },
    h('div', { class: 'empty-icon' }, icon(iconName)),
    title ? h('h2', { class: 'empty-title' }, title) : null,
    text ? h('p', { class: 'empty-text' }, text) : null,
    action || null);
}

/** Foutmelding met een concrete volgende stap. */
export function errorState(err, retry) {
  return h('div', { class: 'error-state', role: 'alert' },
    icon('alert'),
    h('div', {},
      h('strong', {}, err.status === 0 ? tr('Geen verbinding') : tr('Dit lukte niet')),
      h('p', {}, err.message)),
    retry ? button(tr('Opnieuw proberen'), { icon: 'refresh', onClick: retry }) : null);
}

export function skeletonRows(n = 3, cls = 'skeleton-row') {
  return Array.from({ length: n }, () => h('div', { class: `skeleton ${cls}`, 'aria-hidden': 'true' }));
}

/** Dialoog met eigen inhoud. Resolvet naar de waarde van de gekozen knop, of null. */
export function openDialog({ title, body, actions, wide = false, onSubmit }) {
  return new Promise((resolve) => {
    const form = h('form', { method: 'dialog', class: 'dialog-form' },
      h('header', { class: 'dialog-head' },
        h('h2', {}, title),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': tr('Sluiten'), onClick: () => dialog.close('') }, icon('x'))),
      h('div', { class: 'dialog-body' }, body),
      actions ? h('footer', { class: 'dialog-actions' }, actions) : null);
    const dialog = h('dialog', { class: `dialog${wide ? ' dialog-wide' : ''}` }, form);
    form.addEventListener('submit', async (e) => {
      const value = e.submitter?.value || '';
      if (value === 'cancel' || !onSubmit) return;
      e.preventDefault();
      const restore = e.submitter ? busy(e.submitter) : () => {};
      try {
        const keep = await onSubmit(value, form);
        if (keep !== false) dialog.close(value);
      } finally {
        restore();
      }
    });
    dialog.addEventListener('close', () => { resolve(dialog.returnValue || null); dialog.remove(); });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('[autofocus]')?.focus();
  });
}

/** Bevestigingsvenster met eigen knoptekst. Resolvet naar true/false. */
export async function confirmDialog({ title, body, confirmLabel = tr('Bevestigen'), cancelLabel = tr('Annuleren'), danger = false, variant }) {
  const result = await openDialog({
    title,
    body: typeof body === 'string' ? h('p', {}, body) : body,
    actions: [
      h('button', { class: 'btn btn-ghost', value: 'cancel' }, cancelLabel),
      h('button', { class: `btn btn-${variant || (danger ? 'danger' : 'primary')}`, value: 'ok', autofocus: true }, h('span', { class: 'btn-label' }, confirmLabel)),
    ],
  });
  return result === 'ok';
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  const ta = h('textarea', { class: 'visually-hidden' }, text);
  document.body.append(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

/** sessionStorage dat nooit een fout gooit (privémodus e.d.). */
export const draftStore = {
  get(key) { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } },
  set(key, value) { try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch { /* negeren */ } },
};

// ---------- Deadlines (datum + tijd, ondubbelzinnig met tijdzone) ----------


/** "di 10 nov 2026, 17:00 CET" — in de tijdzone van de kijker, met de naam van die tijdzone erbij. */
export const formatDeadline = (iso) => (iso ? fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso)) : '');
/** Een kalenderdag (JJJJ-MM-DD) zonder tijdstip, dus zonder verschuiving door tijdzones. */
export const formatDay = (day) => (day ? fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${day}T12:00:00`)) : '');
export const isPast = (iso) => !!iso && Date.parse(iso) < Date.now();
/** Lokale datum- en tijdvelden → ISO (UTC) voor de server. */
export const localToIso = (date, time) => (date ? new Date(`${date}T${time || '17:00'}`).toISOString() : null);
/** ISO → { date: 'JJJJ-MM-DD', time: 'UU:MM' } in lokale tijd, voor invoervelden. */
export function isoToLocal(iso) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}
