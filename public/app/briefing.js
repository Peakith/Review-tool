// Briefing en referenties binnen een project: tekst, links en bijlagen. Elk onderdeel is
// intern (standaard) of gedeeld met de klant; dat is overal zichtbaar met icoon én tekst.
import {
  h, mount, icon, button, busy, api, toast, confirmDialog, emptyState, errorState, formatDate, formatBytes, draftStore,
} from '/shared/util.js';
import { createUpload, sendChunks, cancelUpload } from './uploader.js';
import { can, menuButton } from './admin.js';

const ATTACHMENT_LIMITS = { pdf: 100, png: 30, jpg: 30, jpeg: 30, webp: 30, gif: 30, mp4: null, m4v: null, mov: null, webm: null };
const ACCEPT = Object.keys(ATTACHMENT_LIMITS).map((e) => `.${e}`).join(',');

const visibilityBadge = (v) => (v === 'client'
  ? h('span', { class: 'badge badge-visible', title: 'De klant ziet dit in het klantportaal' }, icon('eye'), 'Klant ziet dit')
  : h('span', { class: 'badge badge-internal', title: 'Alleen zichtbaar voor het team' }, icon('lock'), 'Intern'));

const fileKind = (mime) => (mime === 'application/pdf' ? ['doc', 'PDF'] : mime.startsWith('image/') ? ['image', 'Afbeelding'] : ['film', 'Video']);

export async function viewBriefing({ project, host, session, onCounts = () => {} }) {
  const state = { items: [], level: project.myLevel, archived: !!project.archivedAt, form: null, uploads: [] };
  const mayEdit = () => can(state.level, 'upload') && !state.archived;
  const mayShare = () => can(state.level, 'publish') && !state.archived;
  const listEl = h('div', { class: 'brief-team' });
  const formHost = h('div', {});
  let alive = true;

  async function load() {
    mount(listEl, h('div', { class: 'skeleton skeleton-row', 'aria-hidden': 'true' }), h('div', { class: 'skeleton skeleton-row', 'aria-hidden': 'true' }));
    try {
      const r = await api('GET', `/api/projects/${project.id}/briefing`);
      state.items = r.items;
      state.level = r.myLevel;
      state.archived = r.archived;
      onCounts(r.items.length, r.items.filter((i) => i.visibility === 'client').length);
      draw();
    } catch (err) {
      mount(listEl, errorState(err, load));
    }
  }

  function draw() {
    if (!alive) return;
    const shared = state.items.filter((i) => i.visibility === 'client');
    const internal = state.items.filter((i) => i.visibility !== 'client');
    const uploads = state.uploads.map(uploadRow);
    if (!state.items.length && !uploads.length) {
      mount(listEl, h('div', { class: 'card' }, emptyState({
        icon: 'clipboard', compact: true, title: 'Nog geen briefing of referenties',
        text: mayEdit() ? 'Voeg de briefing toe als tekst, plak links naar moodboards of voorbeelden, of upload een PDF, afbeelding of referentievideo. Alles is eerst intern.' : 'Er is voor dit project nog niets toegevoegd.',
      })));
      return;
    }
    mount(listEl,
      uploads.length ? h('div', { class: 'brief-uploads' }, uploads) : null,
      group('Zichtbaar voor de klant', 'eye', shared, 'Niets gedeeld. De klant ziet in het portaal dus geen briefing of referenties.'),
      group('Alleen intern', 'lock', internal, 'Geen interne onderdelen.'));
  }

  function group(title, iconName, items, emptyText) {
    return h('section', { class: 'brief-group' },
      h('h2', { class: 'kind-head' }, icon(iconName), title, h('span', { class: 'seg-count' }, items.length)),
      items.length ? items.map(itemCard) : h('p', { class: 'small muted brief-empty' }, emptyText));
  }

  function itemCard(item) {
    const [fIcon, fLabel] = item.file ? fileKind(item.file.mime) : [];
    const iconName = item.kind === 'text' ? 'clipboard' : item.kind === 'link' ? 'link' : fIcon;
    const actions = [];
    if (item.visibility === 'internal' && mayShare()) {
      actions.push(button('Delen met klant', { icon: 'eye', size: 'sm', onClick: (e) => setVisibility(e.currentTarget, item, 'client') }));
    } else if (item.visibility === 'client' && mayEdit()) {
      actions.push(button('Intern maken', { icon: 'lock', size: 'sm', onClick: (e) => setVisibility(e.currentTarget, item, 'internal') }));
    }
    const menu = mayEdit() ? menuButton([
      item.kind !== 'file' ? ['Bewerken', () => openForm(item.kind, item), { icon: 'edit' }] : ['Naam wijzigen', () => openForm('file', item), { icon: 'edit' }],
      ['Naar prullenbak…', () => trash(item), { icon: 'trash', danger: true }],
    ], `Acties voor ${item.title}`) : null;
    let content = null;
    if (item.kind === 'text') content = h('p', { class: 'brief-body' }, item.body);
    if (item.kind === 'link') content = h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', class: 'brief-url truncate' }, icon('external'), item.url);
    if (item.kind === 'file') {
      content = h('div', { class: 'brief-file' },
        h('span', { class: 'small muted' }, `${fLabel} · ${formatBytes(item.file.size)} · ${item.file.name}`),
        h('a', { class: 'btn btn-sm btn-secondary', href: item.file.url, target: '_blank', rel: 'noopener' }, icon('eye'), h('span', { class: 'btn-label' }, 'Openen')),
        h('a', { class: 'btn btn-sm btn-ghost', href: `${item.file.url}?download=1`, 'aria-label': `${item.title} downloaden`, title: 'Downloaden' }, icon('download')));
    }
    return h('article', { class: `brief-card is-${item.visibility}`, id: `brief-${item.id}` },
      h('div', { class: 'brief-icon' }, icon(iconName)),
      h('div', { class: 'brief-main' },
        h('div', { class: 'brief-head' }, h('h3', { class: 'truncate', title: item.title }, item.title), visibilityBadge(item.visibility)),
        content,
        h('div', { class: 'small muted' }, `${item.createdBy || 'Onbekend'} · ${formatDate(item.createdAt)}`)),
      h('div', { class: 'brief-side' }, actions, menu));
  }

  async function setVisibility(btn, item, visibility) {
    const restore = busy(btn);
    try {
      await api('PATCH', `/api/briefing/${item.id}`, { visibility });
      toast(visibility === 'client' ? `“${item.title}” is nu zichtbaar in het klantportaal.` : `“${item.title}” is weer intern.`, 'success');
      await load();
    } catch (err) { toast(err.message, 'error'); restore(); }
  }

  async function trash(item) {
    const ok = await confirmDialog({
      title: `“${item.title}” naar de prullenbak?`,
      body: h('div', {}, h('p', {}, 'Het onderdeel verdwijnt uit het project en is niet meer zichtbaar voor de klant.'),
        h('p', { class: 'muted' }, item.kind === 'file' ? 'Het bestand blijft bewaard tot een beheerder het definitief verwijdert. Terugzetten kan via de prullenbak.' : 'Terugzetten kan via de prullenbak.')),
      confirmLabel: 'Naar prullenbak', danger: true,
    });
    if (!ok) return;
    try {
      await api('DELETE', `/api/briefing/${item.id}`);
      toast(`“${item.title}” staat in de prullenbak.`, 'success', { action: { label: 'Ongedaan maken', onClick: async () => {
        try { await api('POST', '/api/trash/restore', { type: 'briefing', id: item.id }); await load(); } catch (err) { toast(err.message, 'error'); }
      } } });
      await load();
    } catch (err) { toast(err.message, 'error'); }
  }

  // ---- Toevoegen / bewerken ----
  function openForm(kind, item = null) {
    if (kind === 'file' && !item) { pickFiles(); return; }
    const draftKey = `brief-${project.id}-${kind}-${item?.id || 'nieuw'}`;
    const draft = (() => { try { return JSON.parse(draftStore.get(draftKey) || 'null'); } catch { return null; } })();
    const title = h('input', { type: 'text', maxlength: '200', value: draft?.title ?? item?.title ?? '', placeholder: kind === 'text' ? 'Bijv. Briefing' : kind === 'link' ? 'Bijv. Moodboard' : '' });
    const body = kind === 'text' ? h('textarea', { rows: '7', maxlength: '20000', placeholder: 'Doel, doelgroep, kernboodschap, toon, deadlines…' }) : null;
    if (body) body.value = draft?.body ?? item?.body ?? '';
    const url = kind === 'link' ? h('input', { type: 'url', maxlength: '2000', value: draft?.url ?? item?.url ?? '', placeholder: 'https://' }) : null;
    const share = !item && mayShare() ? h('input', { type: 'checkbox' }) : null;
    const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
    const save = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, h('span', { class: 'btn-label' }, item ? 'Opslaan' : 'Toevoegen'));
    const remember = () => draftStore.set(draftKey, JSON.stringify({ title: title.value, body: body?.value, url: url?.value }));
    [title, body, url].forEach((el) => el?.addEventListener('input', remember));
    const form = h('form', { class: 'card brief-form', onSubmit: async (e) => {
      e.preventDefault();
      error.hidden = true;
      const restore = busy(save);
      try {
        const payload = { title: title.value };
        if (body) payload.body = body.value;
        if (url) payload.url = url.value;
        if (item) await api('PATCH', `/api/briefing/${item.id}`, payload);
        else await api('POST', `/api/projects/${project.id}/briefing`, { kind, ...payload, visibility: share?.checked ? 'client' : 'internal' });
        draftStore.set(draftKey, '');
        toast(item ? 'Opgeslagen' : `Toegevoegd${share?.checked ? ' en gedeeld met de klant' : ' (intern)'}`, 'success');
        closeForm();
        await load();
      } catch (err) {
        // Ingevulde tekst blijft staan (en is ook na verversen bewaard).
        mount(error, icon('alert'), h('span', {}, `${err.message} Je tekst is bewaard.`));
        error.hidden = false;
        restore();
      }
    } },
    h('h3', {}, item ? 'Bewerken' : kind === 'text' ? 'Briefing toevoegen' : 'Link toevoegen'),
    error,
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Titel'), title),
    body ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tekst'), body) : null,
    url ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Link'), url) : null,
    share ? h('label', { class: 'check' }, share, 'Direct delen met de klant (zichtbaar in het portaal)') : !item ? h('p', { class: 'small muted' }, icon('lock'), ' Wordt intern toegevoegd.') : null,
    h('div', { class: 'brief-form-actions' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: closeForm }, 'Annuleren'), save));
    state.form = form;
    mount(formHost, form);
    (body || url || title).focus();
  }
  function closeForm() { state.form = null; mount(formHost); }

  function pickFiles() {
    const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, class: 'visually-hidden' });
    input.addEventListener('change', () => { [...input.files].forEach(uploadFile); input.remove(); });
    document.body.append(input);
    input.click();
  }

  function checkFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!(ext in ATTACHMENT_LIMITS)) return `“${file.name}” kan niet als bijlage. Toegestaan: PDF, afbeelding (PNG, JPG, WebP, GIF) of video (MP4, MOV, WebM).`;
    const max = (ATTACHMENT_LIMITS[ext] ? ATTACHMENT_LIMITS[ext] * 1024 ** 2 : session.maxUploadBytes);
    if (file.size > max) return `“${file.name}” is te groot (maximaal ${formatBytes(max)}).`;
    return null;
  }

  async function uploadFile(file) {
    const problem = checkFile(file);
    if (problem) { toast(problem, 'error'); return; }
    const u = { file, progress: 0, state: 'bezig', error: null, controller: new AbortController() };
    state.uploads.push(u);
    draw();
    try {
      const created = await createUpload(file, { projectId: project.id, purpose: 'attachment' });
      u.id = created.id;
      await sendChunks(file, created.id, created.chunkSize, { signal: u.controller.signal, onProgress: (f) => { u.progress = f; drawProgress(u); } });
      u.state = 'controleren';
      drawProgress(u);
      await api('POST', `/api/projects/${project.id}/briefing`, { kind: 'file', uploadId: created.id, title: file.name.replace(/\.[^.]+$/, '') });
      state.uploads = state.uploads.filter((x) => x !== u);
      toast(`“${file.name}” is toegevoegd (intern).`, 'success');
      await load();
    } catch (err) {
      if (err.aborted) { state.uploads = state.uploads.filter((x) => x !== u); if (u.id) cancelUpload(u.id); draw(); return; }
      u.state = 'fout';
      u.error = err.message;
      draw();
    }
  }

  function drawProgress(u) {
    const el = u.el;
    if (!el) return;
    el.querySelector('.progress-bar')?.style.setProperty('width', `${Math.round(u.progress * 100)}%`);
    el.querySelector('.progress')?.classList.toggle('is-indeterminate', u.state === 'controleren');
    const st = el.querySelector('.brief-upload-state');
    if (st) st.textContent = u.state === 'controleren' ? 'Bestand wordt gecontroleerd…' : `${Math.round(u.progress * 100)}%`;
  }

  function uploadRow(u) {
    const fill = h('div', { class: 'progress-bar' });
    fill.style.setProperty('width', `${Math.round(u.progress * 100)}%`);
    u.el = h('div', { class: `brief-upload${u.state === 'fout' ? ' is-error' : ''}` },
      icon(u.state === 'fout' ? 'alert' : 'upload'),
      h('div', { class: 'brief-main' },
        h('div', { class: 'truncate' }, h('strong', {}, u.file.name), ' ', h('span', { class: 'small muted' }, formatBytes(u.file.size))),
        u.state === 'fout' ? h('div', { class: 'small' }, u.error) : h('div', { class: `progress${u.state === 'controleren' ? ' is-indeterminate' : ''}` }, fill),
        u.state !== 'fout' ? h('div', { class: 'small muted brief-upload-state' }, `${Math.round(u.progress * 100)}%`) : null),
      u.state === 'fout'
        ? [button('Opnieuw', { size: 'sm', icon: 'refresh', onClick: () => { state.uploads = state.uploads.filter((x) => x !== u); uploadFile(u.file); } }),
          button('', { size: 'sm', icon: 'x', variant: 'ghost', 'aria-label': 'Sluiten', onClick: () => { state.uploads = state.uploads.filter((x) => x !== u); draw(); } })]
        : button('', { size: 'sm', icon: 'x', variant: 'ghost', 'aria-label': 'Upload annuleren', onClick: () => u.controller.abort() }));
    return u.el;
  }

  const addBar = mayEdit() ? h('div', { class: 'brief-add' },
    h('span', { class: 'small muted' }, 'Toevoegen:'),
    button('Briefingtekst', { icon: 'clipboard', size: 'sm', onClick: () => openForm('text') }),
    button('Link', { icon: 'link', size: 'sm', onClick: () => openForm('link') }),
    button('Bestand', { icon: 'upload', size: 'sm', onClick: () => openForm('file'), title: 'PDF, afbeelding of referentievideo' })) : null;

  mount(host,
    h('div', { class: 'notice notice-info brief-intro' }, icon('info'),
      h('span', {}, 'Nieuwe onderdelen zijn ', h('strong', {}, 'intern'), '. Kies per onderdeel “Delen met klant” om het in het klantportaal te tonen. ',
        h('a', { href: `/voorbeeld/project/${project.id}`, target: '_blank', rel: 'noopener' }, 'Bekijk als klant'), '.')),
    addBar, formHost, listEl);

  // Bestanden op de pagina slepen = als bijlage toevoegen.
  if (mayEdit()) {
    host.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
    host.addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); [...e.dataTransfer.files].forEach(uploadFile); });
  }
  await load();
  return () => { alive = false; state.uploads.forEach((u) => u.state === 'bezig' && u.controller.abort()); };
}

