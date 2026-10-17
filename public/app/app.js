import { h, api, statusPill, STATUS_LABELS, toast, confirmDialog, formatDate, relativeDate, formatBytes, timecode, copyText } from '/shared/util.js';
import { createPlayer, icon } from '/shared/player.js';
import { renderComments, markersFrom } from '/shared/comments.js';
import { createComposer } from '/shared/composer.js';
import { uploadFile } from './uploader.js';

const root = document.getElementById('root');
let session = null;
let cleanup = () => {};

// ---------- Router ----------

function navigate(path, replace = false) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  route();
}
window.addEventListener('popstate', route);
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-nav]');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    navigate(a.getAttribute('href'));
  }
});

async function route() {
  cleanup();
  cleanup = () => {};
  if (!session) session = await api('GET', '/api/session');
  if (!session.user) return session.needsSetup ? viewSetup() : viewLogin();
  const path = location.pathname;
  let m;
  try {
    if ((m = path.match(/^\/projecten\/(\d+)$/))) return await viewProject(Number(m[1]));
    if ((m = path.match(/^\/video\/(\d+)$/))) return await viewVideo(Number(m[1]));
    if (path === '/team') return await viewTeam();
    return await viewProjects();
  } catch (err) {
    if (err.status === 401) { session = null; return route(); }
    shell(h('div', { class: 'page' }, h('div', { class: 'notice notice-error' }, err.message), h('a', { href: '/', 'data-nav': true }, '← Terug naar projecten')));
  }
}

function shell(content, { wide = false } = {}) {
  const nav = h('header', { class: 'topbar' },
    h('div', { class: 'topbar-inner' },
      h('a', { href: '/', 'data-nav': true, class: 'brand' }, h('span', { class: 'brand-mark' }), 'Studio Review'),
      h('nav', { class: 'topnav' },
        h('a', { href: '/', 'data-nav': true, class: location.pathname === '/' || location.pathname.startsWith('/projecten') ? 'is-active' : '' }, 'Projecten'),
        h('a', { href: '/team', 'data-nav': true, class: location.pathname === '/team' ? 'is-active' : '' }, 'Team')),
      h('div', { class: 'topbar-user' },
        h('span', { class: 'muted small' }, session.user.name),
        h('button', { class: 'btn btn-small btn-ghost', onClick: logout }, 'Uitloggen'))));
  root.replaceChildren(nav, h('main', { class: wide ? 'main main-wide' : 'main' }, content));
  window.scrollTo(0, 0);
}

async function logout() {
  await api('POST', '/api/logout');
  session = null;
  navigate('/', true);
}

// ---------- Inloggen ----------

function authForm({ title, intro, fields, submitLabel, onSubmit }) {
  const error = h('p', { class: 'form-error', hidden: true });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, submitLabel);
  const form = h('form', { class: 'auth-card', onSubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    error.hidden = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)));
      session = null;
      navigate(location.pathname === '/login' ? '/' : location.pathname, true);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      btn.disabled = false;
    }
  } },
  h('div', { class: 'brand brand-center' }, h('span', { class: 'brand-mark' }), 'Studio Review'),
  h('h1', {}, title),
  intro ? h('p', { class: 'muted' }, intro) : null,
  error,
  fields.map(([name, label, type, extra = {}]) => h('label', { class: 'field' }, h('span', {}, label), h('input', { name, type, required: true, ...extra }))),
  btn);
  root.replaceChildren(h('div', { class: 'auth-wrap' }, form));
  form.querySelector('input')?.focus();
}

function viewLogin() {
  document.title = 'Inloggen — Studio Review';
  authForm({
    title: 'Inloggen',
    fields: [['email', 'E-mailadres', 'email', { autocomplete: 'username' }], ['password', 'Wachtwoord', 'password', { autocomplete: 'current-password' }]],
    submitLabel: 'Inloggen',
    onSubmit: (data) => api('POST', '/api/login', data),
  });
}

function viewSetup() {
  document.title = 'Eerste account — Studio Review';
  authForm({
    title: 'Welkom',
    intro: 'Maak het eerste teamaccount aan. Daarna kun je collega’s toevoegen via “Team”.',
    fields: [['name', 'Naam', 'text', { autocomplete: 'name' }], ['email', 'E-mailadres', 'email', { autocomplete: 'username' }],
      ['password', 'Wachtwoord (min. 10 tekens)', 'password', { autocomplete: 'new-password', minlength: '10' }]],
    submitLabel: 'Account aanmaken',
    onSubmit: (data) => api('POST', '/api/setup', data),
  });
}

// ---------- Projecten ----------

const GROUPS = [
  { key: 'prep', label: 'In voorbereiding', statuses: ['concept', 'ready_for_review'], cls: 'concept' },
  { key: 'waiting', label: 'Wacht op feedback', statuses: ['in_review'], cls: 'in_review' },
  { key: 'changes', label: 'Aanpassingen nodig', statuses: ['changes_requested'], cls: 'changes_requested' },
  { key: 'approved', label: 'Goedgekeurd', statuses: ['approved'], cls: 'approved' },
];

async function viewProjects() {
  document.title = 'Projecten — Studio Review';
  const projects = await api('GET', '/api/projects');

  const list = projects.length
    ? h('div', { class: 'project-grid' }, projects.map((p) => h('a', { class: 'project-card', href: `/projecten/${p.id}`, 'data-nav': true },
      h('div', { class: 'project-card-head' },
        h('h2', {}, p.name),
        p.clientName ? h('div', { class: 'muted small' }, p.clientName) : null),
      h('div', { class: 'project-card-count muted small' }, `${p.videoCount} video${p.videoCount === 1 ? '' : '’s'}`),
      h('div', { class: 'stat-row' }, GROUPS.map((g) => {
        const n = g.statuses.reduce((s, st) => s + (p.statusCounts[st] || 0), 0);
        return h('div', { class: `stat stat-${g.cls}${n ? '' : ' is-zero'}` }, h('strong', {}, n), h('span', {}, g.label));
      })))))
    : h('div', { class: 'empty-state' },
      h('h2', {}, 'Nog geen projecten'),
      h('p', { class: 'muted' }, 'Maak een project aan voor een klant of opdracht, en upload daarin de video’s.'));

  shell(h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h1', {}, 'Projecten'),
      h('button', { class: 'btn btn-primary', onClick: newProjectDialog }, '+ Nieuw project')),
    list));
}

function newProjectDialog() {
  const name = h('input', { name: 'name', required: true, placeholder: 'Bijv. Voorjaarscampagne 2026' });
  const client = h('input', { name: 'clientName', placeholder: 'Bijv. Klant BV' });
  const dialog = h('dialog', { class: 'dialog' },
    h('form', { method: 'dialog', onSubmit: async (e) => {
      if (e.submitter?.value !== 'ok') return;
      e.preventDefault();
      try {
        const { id } = await api('POST', '/api/projects', { name: name.value, clientName: client.value });
        dialog.close();
        navigate(`/projecten/${id}`);
      } catch (err) { toast(err.message, 'error'); }
    } },
    h('h2', {}, 'Nieuw project'),
    h('label', { class: 'field' }, h('span', {}, 'Projectnaam'), name),
    h('label', { class: 'field' }, h('span', {}, 'Klant'), client),
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'),
      h('button', { class: 'btn btn-primary', value: 'ok' }, 'Project aanmaken'))));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

async function viewProject(id) {
  const project = await api('GET', `/api/projects/${id}`);
  document.title = `${project.name} — Studio Review`;
  const params = new URLSearchParams(location.search);
  let filter = params.get('filter') || 'all';

  const counts = Object.fromEntries(GROUPS.map((g) => [g.key, project.videos.filter((v) => v.latestVersion && g.statuses.includes(v.latestVersion.status)).length]));
  const listEl = h('div', { class: 'video-list' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });

  function drawTabs() {
    tabs.replaceChildren(
      ...[{ key: 'all', label: 'Alle', n: project.videos.length }, ...GROUPS.map((g) => ({ ...g, n: counts[g.key] }))].map((t) =>
        h('button', {
          class: `tab${filter === t.key ? ' is-active' : ''}`, role: 'tab', 'aria-selected': String(filter === t.key),
          onClick: () => { filter = t.key; history.replaceState(null, '', `?filter=${t.key}`); drawTabs(); drawList(); },
        }, t.label, h('span', { class: 'tab-count' }, t.n))));
  }

  function drawList() {
    const group = GROUPS.find((g) => g.key === filter);
    const videos = project.videos.filter((v) => !group || (v.latestVersion && group.statuses.includes(v.latestVersion.status)));
    if (!videos.length) {
      listEl.replaceChildren(h('div', { class: 'empty-state' },
        h('p', { class: 'muted' }, project.videos.length ? 'Geen video’s met deze status.' : 'Nog geen video’s in dit project. Upload de eerste video om te beginnen.')));
      return;
    }
    listEl.replaceChildren(...videos.map((v) => {
      const lv = v.latestVersion;
      return h('a', { class: 'video-row', href: `/video/${v.id}`, 'data-nav': true },
        h('div', { class: 'thumb' }, lv?.hasPoster ? h('img', { src: `/api/versions/${lv.id}/poster`, alt: '', loading: 'lazy' }) : h('span', { class: 'thumb-empty' }, icon('play'))),
        h('div', { class: 'video-row-main' },
          h('div', { class: 'video-row-title' }, v.title),
          h('div', { class: 'muted small' },
            `Versie ${v.versionCount}`,
            v.latestSharedNumber && v.latestSharedNumber !== v.versionCount ? ` · klant ziet versie ${v.latestSharedNumber}` : '',
            lv?.duration ? ` · ${timecode(lv.duration)}` : '',
            ` · bijgewerkt ${relativeDate(v.updatedAt)}`)),
        h('div', { class: 'video-row-meta' },
          v.openComments ? h('span', { class: 'comment-count', title: 'Open reacties van de klant op de nieuwste versie' }, `${v.openComments} open`) : null,
          lv ? statusPill(lv.status) : null));
    }));
  }

  const nameEl = h('h1', {}, project.name);
  shell(h('div', { class: 'page' },
    h('div', { class: 'crumbs' }, h('a', { href: '/', 'data-nav': true }, 'Projecten'), ' / '),
    h('div', { class: 'page-head' },
      h('div', {}, nameEl, project.clientName ? h('div', { class: 'muted' }, project.clientName) : null),
      h('div', { class: 'page-actions' },
        h('button', { class: 'btn btn-ghost btn-small', onClick: () => editProjectDialog(project) }, 'Bewerken'),
        h('button', { class: 'btn btn-primary', onClick: () => uploadDialog({ projectId: project.id }) }, '+ Video uploaden'))),
    tabs,
    listEl));
  drawTabs();
  drawList();
}

function editProjectDialog(project) {
  const name = h('input', { value: project.name, required: true });
  const client = h('input', { value: project.clientName });
  const dialog = h('dialog', { class: 'dialog' },
    h('form', { method: 'dialog', onSubmit: async (e) => {
      const action = e.submitter?.value;
      if (action === 'cancel') return;
      e.preventDefault();
      try {
        if (action === 'delete') {
          dialog.close();
          const sure = await confirmDialog({ title: 'Project verwijderen?', body: 'Alle video’s, versies, reacties en deel-links in dit project worden definitief verwijderd.', confirmLabel: 'Definitief verwijderen', danger: true });
          if (!sure) return;
          await api('DELETE', `/api/projects/${project.id}`);
          return navigate('/');
        }
        await api('PATCH', `/api/projects/${project.id}`, { name: name.value, clientName: client.value });
        dialog.close();
        route();
      } catch (err) { toast(err.message, 'error'); }
    } },
    h('h2', {}, 'Project bewerken'),
    h('label', { class: 'field' }, h('span', {}, 'Projectnaam'), name),
    h('label', { class: 'field' }, h('span', {}, 'Klant'), client),
    h('div', { class: 'dialog-actions dialog-actions-split' },
      h('button', { class: 'btn btn-ghost link-danger', value: 'delete', formnovalidate: true }, 'Verwijderen'),
      h('span', { class: 'pc-spacer' }),
      h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'),
      h('button', { class: 'btn btn-primary', value: 'ok' }, 'Opslaan'))));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

// ---------- Uploaden ----------

function suggestTitle(filename) {
  return filename.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Upload-dialoog voor een nieuwe video ({projectId}) of een nieuwe versie ({video}). */
function uploadDialog({ projectId, video }) {
  const accept = session.formats.map((f) => `.${f}`).join(',');
  const fileInput = h('input', { type: 'file', accept, class: 'visually-hidden', id: 'upload-file' });
  const titleInput = h('input', { type: 'text', placeholder: 'Bijv. Campagnefilm — Hoofdvideo', maxlength: '200' });
  const fileInfo = h('div', { class: 'drop-info' }, h('strong', {}, 'Kies een videobestand'), h('span', { class: 'muted small' }, 'of sleep het hierheen'));
  const drop = h('label', { class: 'dropzone', for: 'upload-file' }, fileInfo);
  const bar = h('div', { class: 'progress-bar' });
  const progressText = h('div', { class: 'small muted' });
  const progress = h('div', { class: 'progress', hidden: true }, h('div', { class: 'progress-track' }, bar), progressText);
  const error = h('div', { class: 'notice notice-error', hidden: true });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit', disabled: true }, video ? 'Nieuwe versie uploaden' : 'Uploaden');
  const cancel = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Annuleren');
  let file = null;
  let controller = null;
  let titleTouched = false;

  titleInput.addEventListener('input', () => { titleTouched = true; });

  function pick(f) {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    error.hidden = true;
    if (!session.formats.includes(ext)) {
      error.textContent = `Dit bestandstype wordt niet ondersteund. Gebruik ${session.formats.map((x) => '.' + x).join(', ')}.`;
      error.hidden = false;
      return;
    }
    if (f.size > session.maxUploadBytes) {
      error.textContent = `Het bestand is te groot (maximaal ${formatBytes(session.maxUploadBytes)}).`;
      error.hidden = false;
      return;
    }
    file = f;
    fileInfo.replaceChildren(h('strong', {}, f.name), h('span', { class: 'muted small' }, `${formatBytes(f.size)} · technische bestandsnaam, niet zichtbaar voor de klant`));
    if (!video && !titleTouched) titleInput.value = suggestTitle(f.name);
    submit.disabled = false;
  }
  fileInput.addEventListener('change', () => pick(fileInput.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); pick(e.dataTransfer.files[0]); });

  const form = h('form', { onSubmit: async (e) => {
    e.preventDefault();
    if (!file) return;
    submit.disabled = true;
    fileInput.disabled = true;
    titleInput.disabled = true;
    progress.hidden = false;
    error.hidden = true;
    controller = new AbortController();
    const started = Date.now();
    try {
      const uploadId = await uploadFile(file, {
        signal: controller.signal,
        onProgress: (fraction, sent) => {
          bar.style.width = `${(fraction * 100).toFixed(1)}%`;
          const secs = (Date.now() - started) / 1000;
          const speed = secs > 1 ? sent / secs : 0;
          const remaining = speed ? (file.size - sent) / speed : 0;
          progressText.textContent = `${Math.floor(fraction * 100)}% · ${formatBytes(sent)} van ${formatBytes(file.size)}${speed ? ` · nog ca. ${timecode(remaining)}` : ''}`;
        },
        onRetry: (n, wait) => { progressText.textContent = `Verbinding onderbroken, nieuwe poging ${n} over ${Math.round(wait / 1000)} s…`; },
      });
      progressText.textContent = 'Bestand wordt gecontroleerd en verwerkt…';
      const result = video
        ? await api('POST', `/api/videos/${video.id}/versions`, { uploadId })
        : await api('POST', `/api/projects/${projectId}/videos`, { uploadId, title: titleInput.value });
      dialog.close();
      toast(video ? `Versie ${result.number} is geüpload als concept` : 'Video is geüpload als concept', 'success');
      navigate(`/video/${video ? video.id : result.videoId}?v=${result.versionId}`);
    } catch (err) {
      if (err.aborted) return;
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
      fileInput.disabled = false;
      titleInput.disabled = false;
      progress.hidden = true;
    }
  } },
  h('h2', {}, video ? 'Nieuwe versie uploaden' : 'Video uploaden'),
  video ? h('p', { class: 'muted' }, 'De nieuwe versie komt onder “', h('strong', {}, video.title), '” en neemt deze titel, de deel-links en de akkoordgever over. Ze start als Concept; de klant ziet haar pas als je haar deelt.') : null,
  fileInput,
  drop,
  !video ? h('label', { class: 'field' }, h('span', {}, 'Zichtbare titel'), titleInput,
    h('span', { class: 'hint' }, 'Deze titel ziet de klant. Je kunt hem later altijd aanpassen; de bestandsnaam blijft ongewijzigd.')) : null,
  h('p', { class: 'small muted' }, `Ondersteund: ${session.formats.map((x) => x.toUpperCase()).join(', ')} tot ${formatBytes(session.maxUploadBytes)}. Aanbevolen: H.264 in MP4 voor afspelen in alle browsers.`),
  progress,
  error,
  h('div', { class: 'dialog-actions' }, cancel, submit));

  const dialog = h('dialog', { class: 'dialog dialog-wide' }, form);
  cancel.addEventListener('click', async () => {
    if (controller && !submit.disabled) return dialog.close();
    if (controller) {
      const stop = await confirmDialog({ title: 'Upload annuleren?', body: 'De upload wordt gestopt en het gedeeltelijke bestand verwijderd.', confirmLabel: 'Upload stoppen', cancelLabel: 'Doorgaan', danger: true });
      if (!stop) return;
      controller.abort();
    }
    dialog.close();
  });
  dialog.addEventListener('cancel', (e) => { if (controller && submit.disabled) e.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

// ---------- Video ----------

async function viewVideo(id) {
  const video = await api('GET', `/api/videos/${id}`);
  document.title = `${video.title} — Studio Review`;
  const requested = Number(new URLSearchParams(location.search).get('v'));
  const version = video.versions.find((v) => v.id === requested) || video.versions[0];
  const isLatest = version.id === video.versions[0].id;
  let comments = await api('GET', `/api/versions/${version.id}/comments`);
  let activeId = null;

  const player = createPlayer({
    src: `/api/versions/${version.id}/media`,
    poster: version.hasPoster ? `/api/versions/${version.id}/poster` : undefined,
    duration: version.duration,
  });
  cleanup = () => player.destroy();
  player.onMarkerClick((cid) => { activeId = cid; draw(); document.getElementById(`comment-${cid}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });

  const commentsEl = h('div', { class: 'comments' });
  const reload = async () => { comments = await api('GET', `/api/versions/${version.id}/comments`); draw(); };
  function draw() {
    renderComments(commentsEl, comments, {
      mode: 'team',
      canWrite: true,
      activeId,
      isOwnTeamComment: (c) => c.authorType === 'team' && c.authorName === session.user.name,
      onSeek: (t, cid) => { player.seek(t); activeId = cid; draw(); },
      onReply: async (parentId, body) => { try { await api('POST', `/api/versions/${version.id}/comments`, { parentId, body }); await reload(); } catch (err) { toast(err.message, 'error'); } },
      onResolve: async (cid, resolved) => { try { await api('POST', `/api/comments/${cid}/resolve`, { resolved }); await reload(); } catch (err) { toast(err.message, 'error'); } },
      onDelete: async (cid) => { try { await api('DELETE', `/api/comments/${cid}`); await reload(); } catch (err) { toast(err.message, 'error'); } },
    });
    player.setMarkers(markersFrom(comments, activeId));
  }
  const composer = createComposer({
    player,
    placeholder: 'Interne notitie of reactie bij dit moment…',
    onSubmit: async (body, tc) => {
      try { await api('POST', `/api/versions/${version.id}/comments`, { body, timecode: tc }); await reload(); } catch (err) { toast(err.message, 'error'); return false; }
    },
  });

  const refresh = () => route();

  shell(h('div', { class: 'video-page' },
    h('div', { class: 'crumbs' },
      h('a', { href: '/', 'data-nav': true }, 'Projecten'), ' / ',
      h('a', { href: `/projecten/${video.project.id}`, 'data-nav': true }, video.project.name), ' / '),
    titleEditor(video),
    h('div', { class: 'video-layout' },
      h('section', { class: 'video-main' },
        !isLatest ? h('div', { class: 'notice notice-warn' }, `Je bekijkt een oudere versie (Versie ${version.number}). `,
          h('a', { href: `/video/${video.id}`, 'data-nav': true }, `Naar Versie ${video.versions[0].number} →`)) : null,
        player.el,
        h('div', { class: 'stage-meta small muted' },
          h('span', {}, `Versie ${version.number} · ${version.file.originalFilename} · ${formatBytes(version.file.size)}${version.width ? ` · ${version.width}×${version.height}` : ''}`),
          h('a', { class: 'btn btn-small btn-ghost', href: `/api/versions/${version.id}/download` }, 'Download')),
        h('div', { class: 'video-comments' },
          composer.el,
          h('h2', { class: 'panel-title' }, 'Reacties op Versie ', version.number),
          commentsEl)),
      h('aside', { class: 'video-side' },
        versionsCard(video, version),
        statusCard(video, version, isLatest, refresh),
        approverCard(video, refresh),
        linksCard(video, refresh),
        historyCard(version),
        dangerCard(video))),
  ), { wide: true });
  draw();
}

function titleEditor(video) {
  const display = h('h1', { class: 'video-title' }, video.title);
  const edit = h('button', { class: 'btn btn-small btn-ghost', title: 'Titel wijzigen' }, 'Titel wijzigen');
  const wrap = h('div', { class: 'title-row' }, display, edit);
  edit.addEventListener('click', () => {
    const input = h('input', { type: 'text', value: video.title, maxlength: '200', class: 'title-input', 'aria-label': 'Zichtbare titel' });
    const save = h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Opslaan');
    const cancel = h('button', { class: 'btn btn-ghost btn-small', type: 'button', onClick: () => route() }, 'Annuleren');
    const form = h('form', { class: 'title-form', onSubmit: async (e) => {
      e.preventDefault();
      try {
        await api('PATCH', `/api/videos/${video.id}`, { title: input.value });
        toast('Titel bijgewerkt. Bestanden, links en reacties zijn ongewijzigd.', 'success');
        route();
      } catch (err) { toast(err.message, 'error'); }
    } }, input, save, cancel,
    h('div', { class: 'hint' }, 'Alleen de zichtbare titel verandert. Er wordt geen extensie toegevoegd; bij downloaden krijgt het bestand automatisch de juiste extensie.'));
    wrap.replaceWith(form);
    input.focus();
    input.select();
  });
  return wrap;
}

function card(title, ...children) {
  return h('section', { class: 'card' }, h('h3', { class: 'card-title' }, title), ...children);
}

function versionsCard(video, current) {
  return card('Versies',
    h('ol', { class: 'version-list' }, video.versions.map((v) => h('li', {},
      h('a', { href: `/video/${video.id}?v=${v.id}`, 'data-nav': true, class: `version-item${v.id === current.id ? ' is-current' : ''}` },
        h('span', { class: 'version-num' }, `v${v.number}`),
        h('span', { class: 'version-info' },
          h('span', { class: 'small' }, formatDate(v.createdAt)),
          h('span', { class: 'small muted' }, v.sharedAt ? 'Gedeeld met klant' : 'Niet gedeeld', v.commentCount ? ` · ${v.commentCount} reacties` : '')),
        statusPill(v.status))))),
    h('button', { class: 'btn btn-block', onClick: () => uploadDialog({ video }) }, '+ Nieuwe versie uploaden'));
}

function statusCard(video, version, isLatest, refresh) {
  const act = async (fn, msg) => { try { await fn(); toast(msg, 'success'); refresh(); } catch (err) { toast(err.message, 'error'); } };
  const steps = [];
  if (version.status === 'concept') {
    steps.push(h('button', { class: 'btn btn-primary btn-block', onClick: () => act(() => api('POST', `/api/versions/${version.id}/ready`), 'Versie staat klaar voor review') }, 'Zet op “Klaar voor review”'));
  }
  if (version.status === 'ready_for_review') {
    steps.push(isLatest
      ? h('button', { class: 'btn btn-primary btn-block', onClick: async () => {
        const ok = await confirmDialog({ title: `Versie ${version.number} delen met de klant?`, body: 'De klant ziet deze versie via de bestaande reviewlink(s). De status wordt “In review”.', confirmLabel: 'Delen met klant' });
        if (ok) act(() => api('POST', `/api/versions/${version.id}/share`), 'Gedeeld met de klant — status is nu In review');
      } }, 'Delen met klant')
      : h('p', { class: 'small muted' }, 'Alleen de nieuwste versie kan worden gedeeld.'));
  }

  const select = h('select', { 'aria-label': 'Nieuwe status' }, Object.entries(STATUS_LABELS).map(([k, label]) => h('option', { value: k, selected: k === version.status }, label)));
  const note = h('input', { type: 'text', placeholder: 'Reden (optioneel)', maxlength: '500' });
  const correction = h('details', { class: 'correction' },
    h('summary', {}, 'Status handmatig corrigeren'),
    h('form', { class: 'correction-form', onSubmit: (e) => {
      e.preventDefault();
      act(() => api('POST', `/api/versions/${version.id}/status`, { status: select.value, note: note.value }), 'Status gecorrigeerd');
    } }, select, note, h('button', { class: 'btn btn-small', type: 'submit' }, 'Status opslaan'),
    h('p', { class: 'small muted' }, 'Wordt vastgelegd met jouw naam en tijdstip. Een handmatige “Goedgekeurd” is geen klantgoedkeuring.')));

  const lastRound = version.rounds.at(-1);
  return card(`Status van Versie ${version.number}`,
    h('div', { class: 'status-now' }, statusPill(version.status)),
    version.approval ? h('div', { class: 'notice notice-ok' }, `Goedgekeurd door ${version.approval.name} (${version.approval.email || 'akkoordgever'}) op ${formatDate(version.approval.at)}`) : null,
    lastRound ? h('div', { class: 'notice notice-warn' },
      h('div', {}, `Feedback verstuurd door ${lastRound.reviewerName}${lastRound.verified ? ' (akkoordgever, geverifieerd)' : ' (opgegeven naam)'} op ${formatDate(lastRound.at)} · ${lastRound.commentCount} reactie(s)`),
      version.rounds.length > 1 ? h('div', { class: 'small' }, `${version.rounds.length} feedbackrondes in totaal`) : null) : null,
    steps,
    version.status === 'in_review' ? h('p', { class: 'small muted' }, 'Wacht op feedback of goedkeuring van de klant.') : null,
    version.status === 'changes_requested' && isLatest ? h('p', { class: 'small muted' }, 'Verwerk de feedback en upload een nieuwe versie.') : null,
    correction);
}

function approverCard(video, refresh) {
  const name = h('input', { type: 'text', value: video.approverName, placeholder: 'Naam', 'aria-label': 'Naam akkoordgever' });
  const email = h('input', { type: 'email', value: video.approverEmail, placeholder: 'E-mailadres', 'aria-label': 'E-mail akkoordgever' });
  const activeLink = video.links.find((l) => l.role === 'approver' && !l.revokedAt);
  return card('Akkoordgever',
    h('p', { class: 'small muted' }, 'Eén persoon per video mag goedkeuren. Deze persoon krijgt een eigen, persoonlijke link; andere reviewers kunnen alleen feedback geven.'),
    h('form', { class: 'stack', onSubmit: async (e) => {
      e.preventDefault();
      if ((video.approverName || video.approverEmail) && activeLink && (name.value !== video.approverName || email.value !== video.approverEmail)) {
        const ok = await confirmDialog({ title: 'Akkoordgever wijzigen?', body: 'De huidige persoonlijke akkoordlink wordt ingetrokken. Maak daarna een nieuwe link aan voor de nieuwe akkoordgever.', confirmLabel: 'Wijzigen' });
        if (!ok) return;
      }
      try { await api('PATCH', `/api/videos/${video.id}`, { approverName: name.value, approverEmail: email.value }); toast('Akkoordgever opgeslagen', 'success'); refresh(); } catch (err) { toast(err.message, 'error'); }
    } }, name, email, h('button', { class: 'btn btn-small', type: 'submit' }, 'Opslaan')),
    video.approverName
      ? (activeLink
        ? linkRow(activeLink, refresh)
        : h('button', { class: 'btn btn-block', onClick: async () => {
          try { const l = await api('POST', `/api/videos/${video.id}/links`, { role: 'approver' }); await copyText(l.url); toast('Akkoordlink aangemaakt en gekopieerd', 'success'); refresh(); } catch (err) { toast(err.message, 'error'); }
        } }, 'Maak persoonlijke akkoordlink'))
      : null);
}

function linkRow(link, refresh) {
  return h('div', { class: `link-row${link.revokedAt ? ' is-revoked' : ''}` },
    h('div', { class: 'link-row-head' },
      h('strong', { class: 'small' }, link.role === 'approver' ? `Akkoordlink · ${link.approverName}` : (link.label || 'Reviewlink')),
      link.allowDownload ? h('span', { class: 'badge badge-guest' }, 'download aan') : null,
      link.revokedAt ? h('span', { class: 'badge badge-guest' }, 'ingetrokken') : null),
    h('input', { type: 'text', readonly: true, value: link.url, class: 'link-url', onFocus: (e) => e.target.select(), 'aria-label': 'Deel-link' }),
    h('div', { class: 'link-row-foot small muted' },
      h('span', {}, link.revokedAt ? `Ingetrokken ${formatDate(link.revokedAt)}` : (link.lastUsedAt ? `Laatst geopend ${relativeDate(link.lastUsedAt)}` : 'Nog niet geopend')),
      !link.revokedAt ? h('span', { class: 'link-row-actions' },
        h('button', { class: 'link-btn link-strong', onClick: async () => { await copyText(link.url); toast('Link gekopieerd'); } }, 'Kopiëren'),
        h('button', { class: 'link-btn link-danger', onClick: async () => {
          const ok = await confirmDialog({ title: 'Link intrekken?', body: 'Wie deze link heeft, krijgt direct geen toegang meer. Reacties en goedkeuringen blijven bewaard.', confirmLabel: 'Intrekken', danger: true });
          if (!ok) return;
          try { await api('POST', `/api/links/${link.id}/revoke`); toast('Link ingetrokken'); refresh(); } catch (err) { toast(err.message, 'error'); }
        } }, 'Intrekken')) : null));
}

function linksCard(video, refresh) {
  const reviewerLinks = video.links.filter((l) => l.role === 'reviewer');
  const active = reviewerLinks.filter((l) => !l.revokedAt);
  const revoked = reviewerLinks.filter((l) => l.revokedAt);
  const label = h('input', { type: 'text', placeholder: 'Label, bijv. “Marketingteam”', maxlength: '100' });
  const allowDownload = h('input', { type: 'checkbox' });
  return card('Reviewlinks',
    h('p', { class: 'small muted' }, 'Klanten openen de nieuwste gedeelde versie zonder account. De link blijft gelijk bij nieuwe versies en titelwijzigingen.'),
    active.length ? active.map((l) => linkRow(l, refresh)) : h('p', { class: 'small' }, 'Nog geen actieve reviewlink.'),
    h('details', { class: 'correction' },
      h('summary', {}, 'Nieuwe reviewlink'),
      h('form', { class: 'stack', onSubmit: async (e) => {
        e.preventDefault();
        try {
          const l = await api('POST', `/api/videos/${video.id}/links`, { role: 'reviewer', label: label.value, allowDownload: allowDownload.checked });
          await copyText(l.url);
          toast('Reviewlink aangemaakt en gekopieerd', 'success');
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }, label, h('label', { class: 'small check' }, allowDownload, ' Klant mag downloaden'), h('button', { class: 'btn btn-small', type: 'submit' }, 'Link aanmaken'))),
    revoked.length ? h('details', { class: 'correction' }, h('summary', {}, `Ingetrokken links (${revoked.length})`), revoked.map((l) => linkRow(l, refresh))) : null);
}

function historyCard(version) {
  return card(`Statusgeschiedenis Versie ${version.number}`,
    h('ol', { class: 'timeline' }, [...version.events].reverse().map((e) => h('li', {},
      h('div', { class: 'timeline-head' }, statusPill(e.to), h('time', { class: 'small muted', datetime: e.at }, formatDate(e.at))),
      h('div', { class: 'small' }, e.eventLabel, ' · ', h('strong', {}, e.actorLabel)),
      e.note ? h('div', { class: 'small muted' }, e.note) : null))));
}

function dangerCard(video) {
  return h('div', { class: 'danger-zone' },
    h('button', { class: 'link-btn link-danger', onClick: async () => {
      const ok = await confirmDialog({ title: 'Video verwijderen?', body: `“${video.title}” met alle versies, reacties en links wordt definitief verwijderd.`, confirmLabel: 'Definitief verwijderen', danger: true });
      if (!ok) return;
      await api('DELETE', `/api/videos/${video.id}`);
      navigate(`/projecten/${video.project.id}`);
    } }, 'Video verwijderen'));
}

// ---------- Team ----------

async function viewTeam() {
  document.title = 'Team — Studio Review';
  const users = await api('GET', '/api/users');
  const form = h('form', { class: 'card stack', onSubmit: async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/users', Object.fromEntries(new FormData(form)));
      toast('Teamlid toegevoegd. Deel het wachtwoord via een veilig kanaal.', 'success');
      route();
    } catch (err) { toast(err.message, 'error'); }
  } },
  h('h3', { class: 'card-title' }, 'Teamlid toevoegen'),
  h('label', { class: 'field' }, h('span', {}, 'Naam'), h('input', { name: 'name', required: true })),
  h('label', { class: 'field' }, h('span', {}, 'E-mailadres'), h('input', { name: 'email', type: 'email', required: true })),
  h('label', { class: 'field' }, h('span', {}, 'Tijdelijk wachtwoord (min. 10 tekens)'), h('input', { name: 'password', type: 'password', minlength: '10', required: true, autocomplete: 'new-password' })),
  h('button', { class: 'btn btn-primary', type: 'submit' }, 'Toevoegen'));

  shell(h('div', { class: 'page page-narrow' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Team')),
    h('div', { class: 'card' }, h('ul', { class: 'user-list' }, users.map((u) => h('li', {}, h('strong', {}, u.name), h('span', { class: 'muted small' }, u.email))))),
    form));
}

route();
