import {
  h, mount, icon, button, busy, api, statusPill, STATUS, STATUS_LABELS, toast, confirmDialog, openDialog, field,
  formatDate, relativeDate, formatBytes, timecode, copyText, emptyState, errorState, skeletonRows, plural, draftStore,
  newRequestId, formatDeadline, isPast, localToIso, isoToLocal,
} from '/shared/util.js';
import { createPlayer } from '/shared/player.js';
import { renderComments, markersFrom, commentCounts } from '/shared/comments.js';
import { createComposer } from '/shared/composer.js';
import { configureUploads, enqueue, checkFile, suggestTitle, createUploadTray, onUploadsChange } from './uploads.js';
import { viewTeam, viewStorage, viewTrash, viewArchive, viewBrands, can, menuButton } from './admin.js';
import { viewBriefing } from './briefing.js';
import { taskDialog, taskChip, viewFeedback, viewMyTasks } from './tasks.js';

const root = document.getElementById('root');
let session = null;
let cleanup = () => {};
let shellEl = null;
let pageEl = null;
let sidebarProjects = null;

// ---------- Router ----------

function navigate(path, { replace = false } = {}) {
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
  try {
    if (!session) session = await api('GET', '/api/session');
  } catch (err) {
    mount(root, h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' }, errorState(err, () => route()))));
    return;
  }
  if (!session.user) { shellEl = null; return session.needsSetup ? viewSetup() : viewLogin(); }
  configureUploads(session);
  ensureShell();
  const path = location.pathname;
  let m;
  const views = [
    [/^\/projecten\/(\d+)$/, (id) => viewProject(Number(id)), 'projects'],
    [/^\/projecten\/(\d+)\/briefing$/, (id) => viewProject(Number(id), 'briefing'), 'projects'],
    [/^\/projecten\/(\d+)\/feedback$/, (id) => viewProject(Number(id), 'feedback'), 'projects'],
    [/^\/taken$/, () => viewMyTasks(ctx()), 'tasks'],
    [/^\/merken$/, () => (session.user.isAdmin ? viewBrands(ctx()) : viewNotFound()), 'brands'],
    [/^\/video\/(\d+)$/, (id) => viewVideo(Number(id)), 'projects'],
    [/^\/team$/, () => viewTeam(ctx()), 'team'],
    [/^\/opslag$/, () => (session.user.isAdmin ? viewStorage(ctx()) : viewNotFound()), 'storage'],
    [/^\/prullenbak$/, () => viewTrash(ctx()), 'trash'],
    [/^\/archief$/, () => viewArchive(ctx()), 'archive'],
    [/^\/?$/, () => viewProjects(), 'projects'],
  ];
  const match = views.find(([re]) => (m = path.match(re)));
  const [, render, section] = match || [null, () => viewNotFound(), 'projects'];
  setActiveNav(section);
  mount(pageEl, h('div', { class: 'loading-page' }, h('div', { class: 'spinner', role: 'status', 'aria-label': 'Laden' })));
  try {
    await render(...(m ? m.slice(1) : []));
  } catch (err) {
    if (err.status === 401) { session = null; return route(); }
    mount(pageEl, h('div', { class: 'page' },
      pageHeader({ title: err.status === 404 ? 'Niet gevonden' : 'Er ging iets mis' }),
      errorState(err, () => route()),
      h('p', { class: 'muted', style: null }, h('a', { href: '/', 'data-nav': true }, '← Terug naar projecten'))));
  }
  pageEl.focus({ preventScroll: true });
}

/** Gedeelde context voor de beheerschermen (admin.js). */
const ctx = () => ({ session, pageEl, pageHeader, navigate, refresh: () => route() });

function viewNotFound() {
  document.title = 'Niet gevonden — Studio Review';
  mount(pageEl, h('div', { class: 'page' }, pageHeader({ title: 'Pagina niet gevonden' }),
    emptyState({ icon: 'folder', title: 'Deze pagina bestaat niet', text: 'Misschien is het project of de video verwijderd.', action: button('Naar projecten', { variant: 'primary', onClick: () => navigate('/') }) })));
}

// ---------- Shell: vaste zijbalk ----------

function ensureShell() {
  if (shellEl && root.contains(shellEl)) { refreshSidebar(); return; }
  const tray = createUploadTray({
    openItem: (item) => navigate(item.target.kind === 'video' ? `/video/${item.result.videoId}` : `/video/${item.target.videoId}?v=${item.result.versionId}`),
  });
  sidebarProjects = h('nav', { class: 'side-projects', 'aria-label': 'Recente projecten' });
  const menuBtn = button('', { icon: 'grid', variant: 'ghost', 'aria-label': 'Menu', class: 'btn btn-ghost btn-icon menu-btn', onClick: () => shellEl.classList.toggle('nav-open') });
  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'side-top' },
      h('a', { href: '/', 'data-nav': true, class: 'brand' }, h('span', { class: 'brand-mark' }, icon('play')), h('span', {}, 'Studio Review')),
      menuBtn),
    h('div', { class: 'side-scroll' },
      h('nav', { class: 'side-nav', 'aria-label': 'Hoofdmenu' },
        h('a', { href: '/', 'data-nav': true, dataset: { section: 'projects' } }, icon('folder'), 'Projecten'),
        h('a', { href: '/taken', 'data-nav': true, dataset: { section: 'tasks' } }, icon('tasks'), 'Mijn taken', h('span', { class: 'side-count', id: 'my-task-count', hidden: true })),
        h('a', { href: '/archief', 'data-nav': true, dataset: { section: 'archive' } }, icon('history'), 'Archief'),
        h('a', { href: '/prullenbak', 'data-nav': true, dataset: { section: 'trash' } }, icon('trash'), 'Prullenbak'),
        session.user.isAdmin
          ? h('a', { href: '/team', 'data-nav': true, dataset: { section: 'team' } }, icon('users'), 'Team & rechten')
          : h('a', { href: '/team', 'data-nav': true, dataset: { section: 'team' } }, icon('users'), 'Mijn account'),
        session.user.isAdmin ? h('a', { href: '/merken', 'data-nav': true, dataset: { section: 'brands' } }, icon('palette'), 'Merken') : null,
        session.user.isAdmin ? h('a', { href: '/opslag', 'data-nav': true, dataset: { section: 'storage' } }, icon('server'), 'Opslag & back-ups') : null),
      h('div', { class: 'side-label' }, 'Recent'),
      sidebarProjects),
    h('div', { class: 'side-foot' },
      systemStatus(),
      h('div', { class: 'side-version', title: 'Versie van deze installatie' }, `Studio Review ${session.version?.label || ''}`),
      h('div', { class: 'side-user' },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(session.user.name)),
        h('div', { class: 'side-user-text' }, h('div', { class: 'truncate' }, session.user.name), h('div', { class: 'truncate small muted' }, session.user.email)),
        button('', { icon: 'logout', variant: 'ghost', size: 'sm', 'aria-label': 'Uitloggen', title: 'Uitloggen', onClick: logout }))));
  pageEl = h('main', { class: 'page-host', id: 'main', tabindex: '-1' });
  shellEl = h('div', { class: 'app' },
    h('a', { class: 'skip-link', href: '#main' }, 'Naar inhoud'),
    sidebar,
    h('div', { class: 'main-col' }, systemBanner(), pageEl),
    tray);
  shellEl.addEventListener('click', (e) => { if (e.target.closest('.side-nav a, .side-projects a')) shellEl.classList.remove('nav-open'); });
  mount(root, shellEl);
  refreshSidebar();
}

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

function setActiveNav(section) {
  shellEl.querySelectorAll('.side-nav a').forEach((a) => a.classList.toggle('is-active', a.dataset.section === section && (section !== 'projects' || location.pathname === '/')));
  shellEl.querySelectorAll('.side-projects a').forEach((a) => {
    const id = a.dataset.project;
    a.classList.toggle('is-active', location.pathname.startsWith(`/projecten/${id}`) || a.dataset.current === 'true');
  });
}

async function refreshSidebar(currentProjectId) {
  api('GET', '/api/my/tasks').then((r) => {
    const el = document.getElementById('my-task-count');
    if (el) { el.textContent = String(r.items.length); el.hidden = !r.items.length; }
  }).catch(() => {});
  try {
    const projects = await api('GET', '/api/projects');
    mount(sidebarProjects, projects.length
      ? projects.slice(0, 12).map((p) => h('a', {
        href: `/projecten/${p.id}`, 'data-nav': true, dataset: { project: p.id, current: String(p.id === currentProjectId) },
        class: location.pathname === `/projecten/${p.id}` || p.id === currentProjectId ? 'is-active' : '',
        title: p.name,
      }, h('span', { class: 'truncate' }, p.name), needsAttention(p) ? h('span', { class: 'side-dot', title: 'Actie nodig' }) : null))
      : h('p', { class: 'side-empty' }, 'Nog geen projecten'));
  } catch { /* zijbalk is niet kritisch */ }
}

/** Waarschuwt als er serveronderdelen ontbreken. */
function systemBanner() {
  const m = session.media;
  const sys = session.system;
  if (sys && !sys.storage.ok) {
    return h('div', { class: 'system-banner is-error', role: 'alert' }, icon('alert'),
      h('span', {}, h('strong', {}, 'Opslag niet bereikbaar. '), sys.storage.reason));
  }
  if (sys?.dataInAppDir && session.user.isAdmin) {
    return h('div', { class: 'system-banner' }, icon('alert'),
      h('span', {}, h('strong', {}, 'Je gegevens staan nog in de programmamap. '), 'Bij een update met een nieuwe ZIP blijven ze daar achter. Verhuis ze eenmalig: stop de app en kies "verhuizen" bij de startknop, of voer ', h('code', {}, 'npm run verhuis'), ' uit.'));
  }
  if (!m) return null;
  if (!m.uploadsEnabled) {
    return h('div', { class: 'system-banner is-error', role: 'alert' }, icon('alert'),
      h('span', {}, h('strong', {}, 'Uploaden is uitgeschakeld. '), 'ffprobe (onderdeel van ffmpeg) is niet gevonden, dus de inhoud van bestanden kan niet worden gecontroleerd. Bestaande video’s en reviews werken gewoon. Installeer ffmpeg (brew install ffmpeg) en start de app opnieuw.'));
  }
  if (m.unverifiedAllowed && !m.ffprobe) {
    return h('div', { class: 'system-banner is-error', role: 'alert' }, icon('alert'), 'Uploads worden zonder inhoudscontrole geaccepteerd (ALLOW_UNVERIFIED_UPLOADS). Niet geschikt voor productie.');
  }
  if (!m.ffmpeg) return h('div', { class: 'system-banner' }, icon('info'), 'ffmpeg ontbreekt: nieuwe uploads krijgen geen thumbnail.');
  return null;
}

function systemStatus() {
  const m = session.media;
  const ok = m && m.ffprobe && m.ffmpeg;
  return h('a', { href: '/team', 'data-nav': true, class: `side-status${ok ? '' : ' is-warn'}`, title: ok ? 'ffprobe en ffmpeg gevonden' : 'Er ontbreekt een onderdeel' },
    h('span', { class: 'status-dot' }), ok ? 'Systeem in orde' : 'Systeem: actie nodig');
}

async function logout() {
  await api('POST', '/api/logout').catch(() => {});
  session = null;
  shellEl = null;
  navigate('/', { replace: true });
}

function pageHeader({ crumbs = [], title, meta, actions }) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'page-head-main' },
      crumbs.length ? h('nav', { class: 'crumbs', 'aria-label': 'Kruimelpad' }, crumbs.map((c, i) => [
        i ? h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, icon('chevronRight')) : null,
        h('a', { href: c.href, 'data-nav': true, class: 'truncate', title: c.label }, c.label)])) : null,
      typeof title === 'string' ? h('h1', { class: 'page-title' }, title) : title,
      meta ? h('div', { class: 'page-meta' }, meta) : null),
    actions ? h('div', { class: 'page-actions' }, actions) : null);
}

// ---------- Inloggen ----------

function authScreen({ title, intro, fields, submitLabel, onSubmit }) {
  const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, h('span', { class: 'btn-label' }, submitLabel));
  const form = h('form', { class: 'auth-card', onSubmit: async (e) => {
    e.preventDefault();
    const restore = busy(submit);
    error.hidden = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)));
      session = null;
      navigate('/', { replace: true }); // ook ?setup= verdwijnt uit de adresbalk
    } catch (err) {
      mount(error, icon('alert'), h('span', {}, err.message));
      error.hidden = false;
      restore();
    }
  } },
  h('div', { class: 'brand brand-center' }, h('span', { class: 'brand-mark' }, icon('play')), h('span', {}, 'Studio Review')),
  h('h1', {}, title),
  intro ? h('p', { class: 'muted' }, intro) : null,
  error,
  fields.map(([name, label, type, extra = {}, hint]) => field(label, h('input', { name, type, required: true, ...extra }), hint)),
  submit);
  mount(root, h('div', { class: 'auth-wrap' }, form));
  form.querySelector('input:not([value]), input[value=""]')?.focus() || form.querySelector('input')?.focus();
}

function viewLogin() {
  document.title = 'Inloggen — Studio Review';
  authScreen({
    title: 'Inloggen',
    intro: 'Log in met je teamaccount.',
    fields: [['email', 'E-mailadres', 'email', { autocomplete: 'username' }], ['password', 'Wachtwoord', 'password', { autocomplete: 'current-password' }]],
    submitLabel: 'Inloggen',
    onSubmit: (data) => api('POST', '/api/login', data),
  });
}

function viewSetup() {
  document.title = 'Eerste account — Studio Review';
  authScreen({
    title: 'Welkom',
    intro: 'Maak het eerste teamaccount aan. Collega’s voeg je daarna toe via Team.',
    fields: [
      ['setupToken', 'Installatiecode', 'text', { autocomplete: 'off', spellcheck: 'false', value: new URLSearchParams(location.search).get('setup') || '' },
        'Staat in het serverlog bij het starten (of in SETUP_TOKEN). Zo kan alleen de beheerder het eerste account aanmaken.'],
      ['name', 'Naam', 'text', { autocomplete: 'name' }],
      ['email', 'E-mailadres', 'email', { autocomplete: 'username' }],
      ['password', 'Wachtwoord', 'password', { autocomplete: 'new-password', minlength: '10' }, 'Minimaal 10 tekens.'],
    ],
    submitLabel: 'Account aanmaken',
    onSubmit: (data) => api('POST', '/api/setup', data),
  });
}

// ---------- Projecten ----------

const toShareCount = (c) => (c.concept || 0) + (c.ready_for_review || 0);
function needsAttention(p) {
  return (p.statusCounts.changes_requested || 0) > 0 || p.openComments > 0;
}

/** Eén zin over wat er in het project speelt, op volgorde van urgentie. */
function projectSignal(p) {
  const c = p.statusCounts;
  if (!p.videoCount) return { cls: 'is-muted', icon: 'upload', text: 'Nog geen video’s' };
  if (c.changes_requested) return { cls: 'is-changes', icon: 'wrench', text: `Feedback binnen · ${plural(c.changes_requested, 'video', 'video’s')} aanpassen` };
  if (p.openComments) return { cls: 'is-review', icon: 'chat', text: `${plural(p.openComments, 'open reactie', 'open reacties')} van de klant` };
  if (toShareCount(c)) return { cls: 'is-ready', icon: 'flag', text: `${plural(toShareCount(c), 'video', 'video’s')} nog niet gedeeld` };
  if (c.in_review) return { cls: 'is-muted', icon: 'eye', text: 'Wacht op de klant' };
  return { cls: 'is-approved', icon: 'checkCircle', text: 'Alles goedgekeurd' };
}

const PROJECT_FILTERS = [
  { key: 'all', label: 'Alle', test: () => true },
  { key: 'action', label: 'Actie nodig', test: (p) => needsAttention(p) || toShareCount(p.statusCounts) > 0 },
  { key: 'waiting', label: 'Wacht op klant', test: (p) => p.statusCounts.in_review > 0 },
  { key: 'approved', label: 'Goedgekeurd', test: (p) => p.videoCount > 0 && p.statusCounts.approved === p.videoCount },
];

async function viewProjects() {
  document.title = 'Projecten — Studio Review';
  // Alleen beheerders maken projecten; teamleden zien de projecten waar ze toegang toe hebben.
  const newBtn = session.user.isAdmin ? button('Nieuw project', { icon: 'plus', variant: 'primary', onClick: newProjectDialog }) : null;
  mount(pageEl, h('div', { class: 'page' }, pageHeader({ title: 'Projecten', actions: newBtn }),
    h('div', { class: 'project-grid' }, skeletonRows(3, 'skeleton-card'))));
  const projects = await api('GET', '/api/projects');

  if (!projects.length) {
    mount(pageEl, h('div', { class: 'page' }, pageHeader({ title: 'Projecten' }), session.user.isAdmin ? onboarding() : h('div', { class: 'card' }, emptyState({
      icon: 'lock', title: 'Nog geen projecten voor jou',
      text: 'Je ziet hier de projecten waar een beheerder je toegang toe geeft. Vraag de beheerder om je aan een project toe te voegen.',
    }))));
    return;
  }

  const params = new URLSearchParams(location.search);
  const state = { q: params.get('q') || '', filter: params.get('filter') || 'all', sort: params.get('sort') || 'activity' };
  const grid = h('div', { class: 'project-grid' });
  const filterBar = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Filter projecten' });
  const search = h('input', { type: 'search', placeholder: 'Zoek op project of klant', value: state.q, 'aria-label': 'Zoek projecten' });
  const sort = h('select', { 'aria-label': 'Sorteren' },
    h('option', { value: 'activity' }, 'Laatste activiteit'), h('option', { value: 'name' }, 'Naam (A–Z)'), h('option', { value: 'created' }, 'Nieuwste project'));
  sort.value = state.sort;

  const sync = () => {
    const q = new URLSearchParams();
    if (state.q) q.set('q', state.q);
    if (state.filter !== 'all') q.set('filter', state.filter);
    if (state.sort !== 'activity') q.set('sort', state.sort);
    history.replaceState(null, '', `/${q.toString() ? `?${q}` : ''}`);
  };
  function draw() {
    const term = state.q.trim().toLowerCase();
    const searched = projects.filter((p) => !term || `${p.name} ${p.clientName}`.toLowerCase().includes(term));
    mount(filterBar, PROJECT_FILTERS.map((f) => h('button', {
      type: 'button', 'aria-pressed': String(state.filter === f.key),
      onClick: () => { state.filter = f.key; sync(); draw(); },
    }, f.label, h('span', { class: 'seg-count' }, searched.filter(f.test).length))));
    const shown = searched.filter(PROJECT_FILTERS.find((f) => f.key === state.filter)?.test || (() => true));
    shown.sort(state.sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'nl')
      : state.sort === 'created' ? (a, b) => b.createdAt.localeCompare(a.createdAt)
        : (a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)));
    if (!shown.length) {
      mount(grid, h('div', { class: 'grid-empty' }, emptyState({
        icon: 'search', compact: true, title: 'Geen projecten gevonden',
        text: term ? `Er is geen project dat overeenkomt met “${state.q}” binnen dit filter.` : 'Er zijn geen projecten binnen dit filter.',
        action: button('Zoeken en filters wissen', { onClick: () => { state.q = ''; search.value = ''; state.filter = 'all'; sync(); draw(); } }),
      })));
      return;
    }
    mount(grid, shown.map(projectCard));
  }
  search.addEventListener('input', () => { state.q = search.value; sync(); draw(); });
  sort.addEventListener('change', () => { state.sort = sort.value; sync(); draw(); });

  mount(pageEl, h('div', { class: 'page' },
    pageHeader({ title: 'Projecten', meta: `${plural(projects.length, 'project', 'projecten')} · ${plural(projects.reduce((n, p) => n + p.videoCount, 0), 'video', 'video’s')}`, actions: newBtn }),
    h('div', { class: 'toolbar' },
      h('div', { class: 'search toolbar-search' }, icon('search'), search),
      filterBar,
      h('label', { class: 'toolbar-sort' }, h('span', { class: 'visually-hidden' }, 'Sorteren'), sort)),
    grid));
  draw();
  const onSlash = (e) => { if (e.key === '/' && !e.target.closest('input, textarea')) { e.preventDefault(); search.focus(); } };
  document.addEventListener('keydown', onSlash);
  cleanup = () => document.removeEventListener('keydown', onSlash);
}

function onboarding() {
  return h('section', { class: 'onboarding' },
    h('div', { class: 'empty-icon' }, icon('film')),
    h('h2', {}, 'Begin met je eerste project'),
    h('p', { class: 'muted' }, 'Een project bundelt de video’s voor één klant of opdracht.'),
    h('ol', { class: 'steps' },
      h('li', {}, h('span', { class: 'step-num' }, '1'), h('div', {}, h('strong', {}, 'Maak een project'), h('span', {}, 'Bijvoorbeeld “Voorjaarscampagne 2026”.'))),
      h('li', {}, h('span', { class: 'step-num' }, '2'), h('div', {}, h('strong', {}, 'Upload je video’s'), h('span', {}, 'Sleep bestanden in het project; ze blijven intern tot je ze deelt.'))),
      h('li', {}, h('span', { class: 'step-num' }, '3'), h('div', {}, h('strong', {}, 'Deel en ontvang feedback'), h('span', {}, 'De klant reageert op tijdstip en keurt goed, zonder account.')))),
    button('Eerste project aanmaken', { icon: 'plus', variant: 'primary', size: 'lg', onClick: newProjectDialog }));
}

function posterImg(versionId, alt = '') {
  if (!versionId) return h('div', { class: 'poster-empty' }, icon('film'));
  const img = h('img', { src: `/api/versions/${versionId}/poster`, alt, loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(h('div', { class: 'poster-empty' }, icon('film'))));
  return img;
}

function projectCard(p) {
  const s = projectSignal(p);
  const statusOrder = ['changes_requested', 'in_review', 'ready_for_review', 'concept', 'approved'];
  return h('a', { class: 'project-card', href: `/projecten/${p.id}`, 'data-nav': true, 'aria-label': `${p.name}${p.clientName ? `, ${p.clientName}` : ''}` },
    h('div', { class: `project-cover cover-${Math.min(p.posters.length, 3)}` },
      p.posters.length ? p.posters.map((id) => posterImg(id)) : h('div', { class: 'poster-empty' }, icon('folder')),
      p.openComments ? h('span', { class: 'cover-badge', title: 'Open reacties van de klant' }, icon('chat'), p.openComments) : null),
    h('div', { class: 'project-body' },
      h('div', { class: 'project-titles' },
        h('h2', { class: 'project-name', title: p.name }, p.name),
        h('div', { class: 'project-client truncate' }, p.clientName || 'Geen klant ingevuld')),
      h('div', { class: 'project-meta small muted' },
        h('span', {}, plural(p.videoCount, 'video', 'video’s')), h('span', { 'aria-hidden': 'true' }, '·'),
        h('span', { title: formatDate(p.lastActivityAt) }, `actief ${relativeDate(p.lastActivityAt)}`)),
      p.videoCount ? h('div', { class: 'status-row' }, statusOrder.filter((st) => p.statusCounts[st]).map((st) =>
        h('span', { class: `pill pill-sm pill-${st}`, title: STATUS[st].label }, icon(STATUS[st].icon), `${p.statusCounts[st]} ${STATUS[st].label.toLowerCase()}`))) : null,
      h('div', { class: `project-signal ${s.cls}` }, icon(s.icon), s.text)));
}

async function projectDialog({ title, project, submitLabel }) {
  const name = h('input', { name: 'name', required: true, maxlength: '200', placeholder: 'Bijv. Voorjaarscampagne 2026', value: project?.name || '', autofocus: true });
  const client = h('input', { name: 'clientName', maxlength: '200', placeholder: 'Bijv. Bakkerij Jansen', value: project?.clientName || '' });
  const brands = await api('GET', '/api/brands').catch(() => []);
  const brand = h('select', { name: 'brandId', 'aria-label': 'Merk' },
    h('option', { value: '' }, 'Geen merk (standaard Studio Review)'),
    brands.map((b) => h('option', { value: b.id }, b.name)));
  brand.value = project?.brandId ? String(project.brandId) : '';
  const intro = h('textarea', { name: 'portalIntro', rows: '3', maxlength: '2000', placeholder: 'Bijv. “Hoi! Hier vind je alle video’s voor de voorjaarscampagne. Laat per video je feedback achter.”' });
  intro.value = project?.portalIntro || '';
  const rounds = h('input', { type: 'number', min: '1', max: '50', step: '1', inputmode: 'numeric', value: project?.roundsIncluded ?? '', placeholder: 'Bijv. 2', class: 'input-narrow' });
  const draftKey = `project-dialog-${project?.id || 'nieuw'}`;
  if (!project && draftStore.get(draftKey)) intro.value = draftStore.get(draftKey);
  intro.addEventListener('input', () => draftStore.set(draftKey, intro.value));
  let result = null;
  await openDialog({
    title,
    body: [
      field('Projectnaam', name),
      field('Klant', client, 'Zichtbaar voor de klant boven de video’s.'),
      field('Merk', brand, 'Bepaalt logo, naam en accentkleur van de klantweergave (portaal en reviewlinks). Merken beheer je onder “Merken”.'),
      field('Introductie in het klantportaal (optioneel)', intro, 'Korte tekst bovenaan het portaal. Alleen zichtbaar via de projectlink.'),
      field('Afgesproken reviewrondes per video (optioneel)', rounds, 'Wordt per video bijgehouden. Bij meer rondes verschijnt een waarschuwing; er wordt niets geblokkeerd. Per video kun je afwijken.'),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'),
      h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, submitLabel))],
    onSubmit: async () => {
      try {
        result = { name: name.value, clientName: client.value, brandId: brand.value ? Number(brand.value) : null, portalIntro: intro.value, roundsIncluded: rounds.value ? Number(rounds.value) : null };
        result.response = project
          ? await api('PATCH', `/api/projects/${project.id}`, result)
          : await api('POST', '/api/projects', result);
        draftStore.set(draftKey, '');
      } catch (err) { toast(`${err.message} Je invoer is bewaard.`, 'error'); result = null; return false; }
    },
  });
  return result;
}

async function newProjectDialog() {
  const r = await projectDialog({ title: 'Nieuw project', submitLabel: 'Project aanmaken' });
  if (!r) return;
  toast(`Project “${r.name.trim()}” aangemaakt. Sleep er nu je eerste video in.`, 'success');
  navigate(`/projecten/${r.response.id}`);
}

// ---------- Project ----------

const VIDEO_FILTERS = [
  { key: 'all', label: 'Alle', test: () => true },
  { key: 'share', label: 'Nog te delen', test: (v) => ['concept', 'ready_for_review'].includes(v.latestVersion?.status) },
  { key: 'waiting', label: 'Wacht op klant', test: (v) => v.latestVersion?.status === 'in_review' },
  { key: 'feedback', label: 'Feedback binnen', test: (v) => v.latestVersion?.status === 'changes_requested' || v.openComments > 0 },
  { key: 'approved', label: 'Goedgekeurd', test: (v) => v.latestVersion?.status === 'approved' },
];

function pickFiles({ multiple }) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: session.formats.map((f) => `.${f}`).join(','), multiple, class: 'visually-hidden' });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

function uploadsDisabled() {
  if (session.media && !session.media.uploadsEnabled) {
    toast('Uploaden is uitgeschakeld omdat ffprobe ontbreekt. Zie Team › Systeem.', 'error');
    return true;
  }
  return false;
}

/** Nieuwe video('s) in een project: elk bestand wordt een eigen video. */
function addVideos(project, files, onDone) {
  if (uploadsDisabled()) return;
  for (const file of files) {
    const problem = checkFile(file);
    if (problem) { toast(problem, 'error'); continue; }
    enqueue(file, { kind: 'video', projectId: project.id, projectName: project.name, title: suggestTitle(file.name) }, onDone);
  }
}

/** Sleepzone voor een element. onFiles(files) bij loslaten. */
function makeDropTarget(el, onFiles, label) {
  let depth = 0;
  const overlay = h('div', { class: 'drop-overlay', 'aria-hidden': 'true' }, icon('upload', { size: 28 }), h('strong', {}, label));
  el.append(overlay);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  el.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; el.classList.add('is-dragging'); e.preventDefault(); });
  el.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) el.classList.remove('is-dragging'); });
  el.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    el.classList.remove('is-dragging');
    onFiles([...e.dataTransfer.files]);
  });
}

const TRASH_URL = { project: (id) => `/api/projects/${id}`, video: (id) => `/api/videos/${id}`, version: (id) => `/api/versions/${id}` };
const TRASH_WHAT = { project: 'Het project', video: 'De video', version: 'Deze versie' };

/** Naar de prullenbak, met bevestiging vooraf en "Ongedaan maken" achteraf. */
async function moveToTrash(type, id, name, after) {
  const ok = await confirmDialog({
    title: `“${name}” naar de prullenbak?`,
    body: h('div', {},
      h('p', {}, `${TRASH_WHAT[type]} verdwijnt uit de overzichten en is niet meer bereikbaar via klantlinks of directe links.`),
      h('p', { class: 'muted' }, 'De bestanden blijven bewaard tot een beheerder ze definitief verwijdert. Terugzetten kan via de prullenbak.')),
    confirmLabel: 'Naar prullenbak', danger: true,
  });
  if (!ok) return;
  try {
    await api('DELETE', TRASH_URL[type](id));
    toast(`“${name}” staat in de prullenbak.`, 'success', { action: { label: 'Ongedaan maken', onClick: async () => {
      try { await api('POST', '/api/trash/restore', { type, id }); toast(`“${name}” is teruggezet.`, 'success'); route(); } catch (err) { toast(err.message, 'error'); }
    } } });
    after();
  } catch (err) { toast(err.message, 'error'); }
}

async function setArchived(type, id, name, archived) {
  try {
    await api('POST', `/api/${type === 'project' ? 'projects' : 'videos'}/${id}/archive`, { archived });
    toast(archived ? `“${name}” is gearchiveerd. Bestanden blijven bewaard; klanten kunnen nog kijken maar niet reageren.` : `“${name}” is weer actief.`, 'success');
    route();
  } catch (err) { toast(err.message, 'error'); }
}

const KIND_ORDER = [['main', 'Hoofdvideo'], ['teaser', 'Teasers'], ['cutdown', 'Cutdowns'], ['social', 'Social'], ['other', 'Overig'], [null, 'Zonder type']];

async function viewProject(id, tab = 'videos') {
  const params = new URLSearchParams(location.search);
  const showArchived = params.get('archief') === '1';
  const project = await api('GET', `/api/projects/${id}${showArchived ? '?archived=1' : ''}`);
  document.title = `${project.name} — Studio Review`;
  refreshSidebar(project.id);
  const archived = !!project.archivedAt;
  const mayUpload = can(project.myLevel, 'upload') && !archived;
  const mayManage = can(project.myLevel, 'manage');
  const state = { q: '', filter: params.get('filter') || 'all' };
  const listEl = h('div', { class: 'video-list', role: 'list' });
  const filterBar = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Filter video’s' });
  const search = h('input', { type: 'search', placeholder: 'Zoek een video', 'aria-label': 'Zoek video’s' });

  const reload = async () => {
    if (!location.pathname.endsWith(`/projecten/${id}`)) return;
    const fresh = await api('GET', `/api/projects/${id}${showArchived ? '?archived=1' : ''}`).catch(() => null);
    if (fresh) { project.videos = fresh.videos; draw(); refreshSidebar(project.id); }
  };
  const onDone = () => reload();
  const chooseFiles = async () => { const files = await pickFiles({ multiple: true }); if (files.length) addVideos(project, files, onDone); };

  function draw() {
    const term = state.q.trim().toLowerCase();
    const searched = project.videos.filter((v) => !term || v.title.toLowerCase().includes(term));
    mount(filterBar, VIDEO_FILTERS.map((f) => h('button', {
      type: 'button', 'aria-pressed': String(state.filter === f.key),
      onClick: () => { state.filter = f.key; history.replaceState(null, '', f.key === 'all' ? location.pathname : `?filter=${f.key}`); draw(); },
    }, f.label, h('span', { class: 'seg-count' }, searched.filter(f.test).length))));
    if (!project.videos.length && !mayUpload) {
      mount(listEl, h('div', { class: 'card' }, emptyState({ icon: 'film', compact: true, title: 'Nog geen video’s', text: archived ? 'Dit project is gearchiveerd.' : 'Er staan nog geen video’s in dit project.' })));
      return;
    }
    if (!project.videos.length) {
      mount(listEl, h('button', { type: 'button', class: 'dropzone-big', onClick: chooseFiles },
        h('div', { class: 'empty-icon' }, icon('upload')),
        h('strong', {}, 'Sleep video’s hierheen of klik om bestanden te kiezen'),
        h('span', { class: 'muted' }, `${session.formats.map((f) => f.toUpperCase()).join(', ')} · tot ${formatBytes(session.maxUploadBytes)} per bestand · aanbevolen: H.264 in MP4`),
        h('span', { class: 'muted small' }, 'Elke upload wordt een eigen video en blijft intern (Concept) tot je hem deelt.')));
      return;
    }
    const shown = searched.filter(VIDEO_FILTERS.find((f) => f.key === state.filter)?.test || (() => true))
      .sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)));
    if (!shown.length) {
      mount(listEl, emptyState({ icon: 'search', compact: true, title: 'Geen video’s gevonden', text: 'Pas je zoekterm of filter aan.',
        action: button('Filters wissen', { onClick: () => { state.q = ''; search.value = ''; state.filter = 'all'; draw(); } }) }));
      return;
    }
    // Opleveringen gegroepeerd per type, zodra er types zijn ingevuld.
    if (project.videos.some((v) => v.meta?.kind)) {
      mount(listEl, KIND_ORDER.map(([kind, label]) => {
        const rows = shown.filter((v) => (v.meta?.kind || null) === kind);
        return rows.length ? h('div', { class: 'kind-group', role: 'group', 'aria-label': label },
          h('h2', { class: 'kind-head' }, label, h('span', { class: 'seg-count' }, rows.length)),
          rows.map((v) => videoRow(v, reload, { mayUpload, mayManage }))) : null;
      }));
      return;
    }
    mount(listEl, shown.map((v) => videoRow(v, reload, { mayUpload, mayManage })));
  }
  search.addEventListener('input', () => { state.q = search.value; draw(); });

  const isVideos = tab === 'videos';
  const tabLink = (key, href, iconName, label, extra) => h('a', { href, 'data-nav': true, class: tab === key ? 'is-active' : '', 'aria-current': tab === key ? 'page' : null }, icon(iconName), label, extra);
  const tabs = h('nav', { class: 'page-tabs', 'aria-label': 'Projectonderdelen' },
    h('a', { href: `/projecten/${project.id}`, 'data-nav': true, class: isVideos ? 'is-active' : '', 'aria-current': isVideos ? 'page' : null }, icon('film'), 'Video’s', h('span', { class: 'seg-count' }, project.videos.length)),
    tabLink('feedback', `/projecten/${project.id}/feedback`, 'tasks', 'Feedback & taken', project.openFeedback ? h('span', { class: 'seg-count' }, project.openFeedback) : null),
    h('a', { href: `/projecten/${project.id}/briefing`, 'data-nav': true, class: tab === 'briefing' ? 'is-active' : '', 'aria-current': tab === 'briefing' ? 'page' : null }, icon('clipboard'), 'Briefing & referenties',
      h('span', { class: 'seg-count', dataset: { count: 'briefing' } }, project.briefingCount),
      h('span', { class: 'badge badge-visible', title: 'Onderdelen die de klant kan bekijken', dataset: { count: 'shared' }, hidden: !project.sharedBriefingCount }, icon('eye'), h('span', {}, project.sharedBriefingCount))));
  const briefingHost = h('div', {});

  const content = h('div', { class: 'page page-drop' },
    pageHeader({
      crumbs: [{ label: 'Projecten', href: '/' }],
      title: h('h1', { class: 'page-title', title: project.name }, project.name),
      meta: [
        project.clientName ? h('span', {}, project.clientName) : null,
        h('span', {}, plural(project.videos.length, 'video', 'video’s')),
        brandChip(project.brand),
      ],
      actions: [
        mayManage ? menuButton([
          ['Project bewerken…', () => editProject(project), { icon: 'edit' }],
          archived ? ['Uit archief halen', () => setArchived('project', project.id, project.name, false), { icon: 'refresh' }]
            : ['Archiveren', () => setArchived('project', project.id, project.name, true), { icon: 'history' }],
          ['Naar prullenbak…', () => moveToTrash('project', project.id, project.name, () => navigate('/')), { icon: 'trash', danger: true }],
        ], 'Projectacties') : null,
        h('a', { class: 'btn btn-secondary', href: `/voorbeeld/project/${project.id}`, target: '_blank', rel: 'noopener', title: 'Bekijk het portaal precies zoals de klant het ziet' }, icon('eye'), h('span', { class: 'btn-label' }, 'Klantweergave')),
        can(project.myLevel, 'publish') ? button('Klantportaal', { icon: 'globe', onClick: () => portalDialog(project), 'aria-label': 'Klantportaal: projectlink delen of beheren' }) : null,
        mayUpload && isVideos ? button('Nieuwe video', { icon: 'upload', variant: 'primary', onClick: chooseFiles, title: 'Een nieuwe, losse video aan dit project toevoegen' }) : null,
      ],
    }),
    archived ? h('div', { class: 'notice notice-info page-notice' }, icon('history'),
      h('span', {}, h('strong', {}, 'Dit project is gearchiveerd. '), 'Alles blijft bewaard en is te bekijken, maar uploaden, publiceren en reageren kan niet. Klanten kunnen hun links nog openen.'),
      mayManage ? button('Uit archief halen', { size: 'sm', onClick: () => setArchived('project', project.id, project.name, false) }) : null) : null,
    !can(project.myLevel, 'upload') && !archived ? h('p', { class: 'small muted page-notice' }, icon('lock'), `Je rechten in dit project: ${({ view: 'bekijken en reageren', publish: 'publiceren en delen' })[project.myLevel] || project.myLevel}.`) : null,
    tabs,
    isVideos ? [
      project.videos.length ? h('div', { class: 'toolbar' }, h('div', { class: 'search toolbar-search' }, icon('search'), search), filterBar) : null,
      listEl,
      project.archivedVideoCount || showArchived ? h('p', { class: 'small' }, h('a', { href: showArchived ? location.pathname : `${location.pathname}?archief=1`, 'data-nav': true },
        showArchived ? 'Gearchiveerde video’s verbergen' : `${plural(project.archivedVideoCount, 'gearchiveerde video', 'gearchiveerde video’s')} tonen`)) : null,
      project.videos.length && mayUpload ? h('p', { class: 'drop-hint small muted' }, icon('upload'), 'Tip: sleep bestanden op deze pagina om nieuwe video’s toe te voegen. Een nieuwe versie van een bestaande video upload je vanaf die video.') : null,
    ] : briefingHost);
  if (mayUpload && isVideos) makeDropTarget(content, (files) => addVideos(project, files, onDone), 'Loslaten om als nieuwe video’s toe te voegen');
  mount(pageEl, content);
  if (isVideos) draw();
  else if (tab === 'feedback') {
    await viewFeedback({ project, host: briefingHost, session });
  } else {
    // Aantallen in het tabblad actueel houden na toevoegen, delen of weggooien.
    const onCounts = (total, shared) => {
      tabs.querySelector('[data-count=briefing]').textContent = String(total);
      const badge = tabs.querySelector('[data-count=shared]');
      badge.hidden = !shared;
      badge.lastChild.textContent = String(shared);
    };
    cleanup = await viewBriefing({ project, host: briefingHost, session, onCounts }) || (() => {});
  }
}

/** Merk van een project als klein label (kleurstip + naam). */
function brandChip(brand) {
  if (!brand) return null;
  const dot = h('span', { class: 'brand-dot', 'aria-hidden': 'true' });
  if (brand.accent) dot.style.setProperty('background', brand.accent);
  return h('span', { class: 'brand-chip', title: 'Merk van de klantweergave' }, dot, brand.name);
}

function videoRow(v, reload, { mayUpload, mayManage }) {
  const lv = v.latestVersion;
  const sv = v.sharedVersion;
  const titleText = h('a', { href: `/video/${v.id}`, 'data-nav': true, class: 'video-row-title', title: v.title }, v.title);
  const renameBtn = mayUpload && !v.archivedAt ? button('', { icon: 'edit', variant: 'ghost', size: 'sm', 'aria-label': `Titel van “${v.title}” wijzigen`, onClick: (e) => { e.preventDefault(); startRename(); } }) : null;
  const titleWrap = h('div', { class: 'video-row-titlewrap' }, titleText, renameBtn);

  function startRename() {
    const input = h('input', { type: 'text', value: v.title, maxlength: '200', 'aria-label': 'Nieuwe titel', class: 'inline-input' });
    let saving = false;
    const restoreTitle = () => mount(titleWrap, titleText, renameBtn);
    const save = async () => {
      if (saving) return;
      const value = input.value.trim();
      if (!value || value === v.title) { restoreTitle(); return; }
      saving = true;
      input.disabled = true;
      try {
        await api('PATCH', `/api/videos/${v.id}`, { title: value });
        v.title = value;
        toast('Titel bijgewerkt. Bestanden, links en reacties blijven ongewijzigd.', 'success');
        reload();
      } catch (err) { toast(err.message, 'error'); saving = false; input.disabled = false; input.focus(); }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); saving = true; restoreTitle(); }
    });
    input.addEventListener('blur', save);
    titleWrap.replaceChildren(input);
    input.focus();
    input.select();
  }

  const meta = [v.meta?.kindLabel, v.meta?.aspect, v.meta?.channel].filter(Boolean).join(' · ');
  return h('div', { class: 'video-row', role: 'listitem', onClick: (e) => { if (!e.target.closest('button, input, a, .menu-wrap')) navigate(`/video/${v.id}`); } },
    h('a', { href: `/video/${v.id}`, 'data-nav': true, class: `thumb${v.meta?.orientation === 'staand' ? ' is-portrait' : ''}`, tabindex: '-1', 'aria-hidden': 'true' },
      posterImg(v.posterVersionId),
      lv?.duration ? h('span', { class: 'thumb-duration' }, timecode(lv.duration)) : null),
    h('div', { class: 'video-row-main' },
      titleWrap,
      meta ? h('div', { class: 'video-row-meta small muted' }, meta) : null,
      h('div', { class: 'video-versions' },
        h('span', { class: 'ver-chip', title: 'Nieuwste versie intern' }, h('span', { class: 'muted' }, 'Intern'), ` v${lv?.number ?? '–'}`, lv ? statusPill(lv.status, { small: true }) : null),
        h('span', { class: `ver-chip${sv ? '' : ' is-none'}`, title: 'Versie die de klant via de link ziet' }, icon('eye'),
          sv ? [h('span', { class: 'muted' }, 'Klant ziet'), ` v${sv.number}`] : h('span', { class: 'muted' }, 'Nog niet gedeeld')))),
    h('div', { class: 'video-row-side' },
      v.archivedAt ? h('span', { class: 'badge badge-neutral' }, icon('history'), 'Gearchiveerd') : null,
      v.openComments ? h('span', { class: 'badge badge-warn', title: 'Open reacties van de klant' }, icon('chat'), `${v.openComments} open`) : null,
      h('span', { class: 'small muted', title: formatDate(v.lastActivityAt) }, relativeDate(v.lastActivityAt)),
      mayManage ? menuButton([
        v.archivedAt ? ['Uit archief halen', () => setArchived('video', v.id, v.title, false), { icon: 'refresh' }]
          : ['Archiveren', () => setArchived('video', v.id, v.title, true), { icon: 'history' }],
        ['Naar prullenbak…', () => moveToTrash('video', v.id, v.title, reload), { icon: 'trash', danger: true }],
      ], `Acties voor ${v.title}`) : null,
      icon('chevronRight')));
}

async function editProject(project) {
  const r = await projectDialog({ title: 'Project bewerken', project, submitLabel: 'Opslaan' });
  if (r) { toast('Project bijgewerkt', 'success'); return route(); }
}

// ---------- Video: reviewwerkplek ----------

async function viewVideo(id) {
  const video = await api('GET', `/api/videos/${id}`);
  document.title = `${video.title} — Studio Review`;
  refreshSidebar(video.project.id);
  const requested = Number(new URLSearchParams(location.search).get('v'));
  const version = video.versions.find((v) => v.id === requested) || video.versions[0];
  const latest = video.versions[0];
  const clientVersion = video.versions.find((v) => v.isClientVersion) || null;
  let comments = await api('GET', `/api/versions/${version.id}/comments`);
  let activeId = null;
  let filter = 'all';
  let tab = new URLSearchParams(location.search).get('tab') || 'comments';

  const player = createPlayer({
    src: `/api/versions/${version.id}/media`,
    poster: version.hasPoster ? `/api/versions/${version.id}/poster` : undefined,
    duration: version.duration,
  });
  player.onMarkerClick((cid) => { activeId = cid; filter = 'all'; selectTab('comments'); drawComments(); scrollToComment(cid); });

  const commentsEl = h('div', { class: 'panel-scroll' });
  const filterBar = h('div', { class: 'segmented segmented-sm', role: 'group', 'aria-label': 'Filter reacties' });
  const tabCount = h('span', { class: 'tab-count' });
  const reloadComments = async () => { comments = await api('GET', `/api/versions/${version.id}/comments`); drawComments(); };
  const scrollToComment = (cid) => document.getElementById(`comment-${cid}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  function drawComments() {
    const n = commentCounts(comments);
    tabCount.textContent = n.open ? String(n.open) : '';
    mount(filterBar, [['all', 'Alle', n.all], ['open', 'Open', n.open], ['resolved', 'Afgehandeld', n.resolved]].map(([key, label, count]) =>
      h('button', { type: 'button', 'aria-pressed': String(filter === key), onClick: () => { filter = key; drawComments(); } }, label, h('span', { class: 'seg-count' }, count))));
    renderComments(commentsEl, comments, {
      mode: 'team',
      canWrite: true,
      filter,
      activeId,
      isOwnTeamComment: (c) => c.authorType === 'team' && c.userId === session.user.id,
      renderTask: taskChip,
      onTask: !archived && (can(level, 'upload') || comments.some((c) => c.task?.assigneeId === session.user.id))
        ? (c) => (c.task || can(level, 'upload') ? taskDialog({ comment: c, projectId: video.project.id, level, onDone: reloadComments }) : null) : null,
      canShare: can(level, 'publish'),
      onSeek: (t, cid) => { player.seek(t); activeId = cid; drawComments(); },
      onReply: async (parentId, body, { internal } = {}) => {
        try {
          await api('POST', `/api/versions/${version.id}/comments`, { parentId, body, internal });
          await reloadComments();
          toast(internal ? 'Intern antwoord geplaatst (de klant ziet dit niet)' : 'Antwoord geplaatst. De klant ziet dit bij deze versie.', 'success');
          return true;
        } catch (err) { toast(`${err.message} Je tekst is bewaard.`, 'error'); return false; }
      },
      onVisibility: async (cid, internal) => {
        try { await api('PATCH', `/api/comments/${cid}`, { internal }); await reloadComments(); toast(internal ? 'Reactie is nu intern' : 'De klant ziet deze reactie nu', 'success'); } catch (err) { toast(err.message, 'error'); drawComments(); }
      },
      onResolve: async (cid, resolved) => {
        try { await api('POST', `/api/comments/${cid}/resolve`, { resolved }); await reloadComments(); toast(resolved ? 'Reactie afgehandeld. De status van de versie blijft ongewijzigd.' : 'Reactie heropend', 'success'); } catch (err) { toast(err.message, 'error'); drawComments(); }
      },
      onDelete: async (cid) => {
        if (!(await confirmDialog({ title: 'Reactie verwijderen?', body: 'Je eigen reactie wordt definitief verwijderd.', confirmLabel: 'Verwijderen', danger: true }))) return drawComments();
        try { await api('DELETE', `/api/comments/${cid}`); await reloadComments(); toast('Reactie verwijderd'); } catch (err) { toast(err.message, 'error'); }
      },
    });
    player.setMarkers(markersFrom(comments, activeId));
  }

  const level = video.myLevel;
  const archived = !!video.archivedAt;
  // Wat mag deze gebruiker hier? (de server controleert dit ook; dit bepaalt alleen welke knoppen er staan)
  const may = (need) => can(level, need) && !archived;

  // Nieuwe teamnotities zijn standaard intern; expliciet kiezen om iets met de klant te delen.
  let shareWithClient = false;
  const visibilityToggle = h('div', { class: 'segmented segmented-sm composer-visibility', role: 'group', 'aria-label': 'Zichtbaarheid van je reactie' });
  const drawVisibility = () => mount(visibilityToggle,
    h('button', { type: 'button', 'aria-pressed': String(!shareWithClient), onClick: () => { shareWithClient = false; drawVisibility(); } }, icon('lock'), 'Intern'),
    h('button', { type: 'button', 'aria-pressed': String(shareWithClient), onClick: () => { shareWithClient = true; drawVisibility(); }, title: 'De klant ziet deze reactie bij deze versie (zodra die gepubliceerd is)' }, icon('eye'), 'Zichtbaar voor klant'));
  drawVisibility();
  const composer = createComposer({
    player,
    placeholder: 'Notitie bij dit moment…',
    draftKey: `team-draft-${version.id}`,
    before: visibilityToggle,
    onSubmit: async (body, tc) => {
      try {
        await api('POST', `/api/versions/${version.id}/comments`, { body, timecode: tc, internal: !shareWithClient });
        await reloadComments();
        toast(shareWithClient ? 'Reactie geplaatst; de klant ziet deze bij deze versie.' : 'Interne notitie geplaatst', 'success');
        shareWithClient = false;
        drawVisibility();
        return true;
      } catch (err) { toast(`${err.message} Je tekst is bewaard.`, 'error'); return false; }
    },
  });

  // ---- Panel met tabbladen ----
  const tabs = [
    ['comments', 'Reacties', tabCount],
    ['versions', 'Versies', h('span', { class: 'tab-count' }, video.versions.length)],
    ['rounds', 'Rondes', h('span', { class: 'tab-count' }, video.rounds.length || '')],
    ['history', 'Geschiedenis', null],
  ];
  const tabButtons = tabs.map(([key, label, extra]) => h('button', {
    type: 'button', role: 'tab', id: `tab-${key}`, 'aria-controls': `tabpanel-${key}`,
    onClick: () => selectTab(key),
    onKeydown: (e) => {
      const i = tabs.findIndex((t) => t[0] === key);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length][0];
        selectTab(next); document.getElementById(`tab-${next}`).focus(); e.preventDefault();
      }
    },
  }, label, extra));
  const refresh = () => route();
  const panels = {
    comments: h('div', { class: 'tabpanel tabpanel-comments', role: 'tabpanel', id: 'tabpanel-comments', 'aria-labelledby': 'tab-comments' },
      h('div', { class: 'panel-toolbar' }, filterBar), commentsEl, h('div', { class: 'panel-composer' }, composer.el)),
    versions: h('div', { class: 'tabpanel', role: 'tabpanel', id: 'tabpanel-versions', 'aria-labelledby': 'tab-versions' }, h('div', { class: 'panel-scroll' }, versionsList(video, version))),
    rounds: h('div', { class: 'tabpanel', role: 'tabpanel', id: 'tabpanel-rounds', 'aria-labelledby': 'tab-rounds' }, h('div', { class: 'panel-scroll' }, roundsList(video, refresh, may))),
    history: h('div', { class: 'tabpanel', role: 'tabpanel', id: 'tabpanel-history', 'aria-labelledby': 'tab-history' }, h('div', { class: 'panel-scroll' }, historyList(version))),
  };
  function selectTab(key) {
    tab = key;
    tabButtons.forEach((b) => { const on = b.id === `tab-${key}`; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    Object.entries(panels).forEach(([k, p]) => { p.hidden = k !== key; });
  }

  // ---- Kop ----
  const versionSelect = h('select', { class: 'version-select', 'aria-label': 'Kies versie' },
    video.versions.map((v) => h('option', { value: v.id }, `Versie ${v.number} · ${STATUS_LABELS[v.status]}${v.isLatest ? ' · nieuwste' : ''}${v.isClientVersion ? ' · bij klant' : ''}`)));
  versionSelect.value = String(version.id);
  versionSelect.addEventListener('change', () => navigate(`/video/${video.id}?v=${versionSelect.value}`));

  const shareBtn = can(level, 'publish') ? button('Delen', { icon: 'link', onClick: () => shareDialog(video, refresh) }) : null;
  const newVersionBtn = may('upload') ? button('Nieuwe versie', { icon: 'layers', onClick: () => newVersionDialog(video) }) : null;
  if (archived) composer.setDisabled(true, 'Gearchiveerd: reageren is niet meer mogelijk.');

  const content = h('div', { class: 'workspace page-drop' },
    pageHeader({
      crumbs: [{ label: 'Projecten', href: '/' }, { label: video.project.name, href: `/projecten/${video.project.id}` }],
      title: titleEditor(video, may('upload')),
      meta: [
        deliveryMeta(video, may('upload')),
        h('span', { class: 'meta-item' }, h('span', { class: 'muted' }, 'Intern nieuwste: '), `Versie ${latest.number}`),
        h('span', { class: 'meta-item' }, icon('eye'), h('span', { class: 'muted' }, ' Klant ziet: '), clientVersion ? `Versie ${clientVersion.number}` : 'nog niets gedeeld'),
        roundIndicator(video),
      ],
      actions: [versionSelect, newVersionBtn,
        h('a', { class: 'btn btn-secondary', href: `/voorbeeld/video/${video.id}`, target: '_blank', rel: 'noopener', title: 'Zo ziet de klant deze video (alleen gepubliceerde versies, zonder interne notities)' }, icon('eye'), h('span', { class: 'btn-label' }, 'Klantweergave')),
        shareBtn, moreMenu(video, version, { level, archived })],
    }),
    archived ? h('div', { class: 'notice notice-info page-notice' }, icon('history'), h('span', {}, h('strong', {}, 'Gearchiveerd. '), 'Deze video is alleen te bekijken. Klanten kunnen hun link nog openen, maar niet meer reageren of goedkeuren.')) : null,
    publishBar(video, version, latest, clientVersion, refresh, may),
    h('div', { class: 'workspace-grid' },
      h('section', { class: 'stage', 'aria-label': 'Video' },
        player.el,
        h('div', { class: 'stage-meta' },
          h('span', { class: 'truncate', title: version.file.originalFilename }, icon('film'), version.file.originalFilename),
          h('span', {}, [formatBytes(version.file.size), version.width ? `${version.width}×${version.height}` : null, version.duration ? timecode(version.duration) : null].filter(Boolean).join(' · ')),
          h('span', { class: 'kbd-hint' }, 'Spatie afspelen · ←/→ 5 s · , . beeld'))),
      h('aside', { class: 'side-panel', 'aria-label': 'Reacties en details' },
        h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Paneel' }, tabButtons),
        Object.values(panels))));
  if (may('upload')) makeDropTarget(content, (files) => newVersionDialog(video, files[0]), `Loslaten als nieuwe versie (Versie ${latest.number + 1})`);
  mount(pageEl, content);
  selectTab(['comments', 'versions', 'rounds', 'history'].includes(tab) ? tab : 'comments');
  drawComments();
  // Vanuit een overzicht: direct naar de reactie en het juiste moment.
  const focusId = Number(new URLSearchParams(location.search).get('c'));
  const focus = comments.find((c) => c.id === focusId);
  if (focus) {
    activeId = focus.id;
    drawComments();
    if (focus.timecode !== null && focus.timecode !== undefined) player.seek(focus.timecode);
    setTimeout(() => scrollToComment(focus.id), 50);
  }

  const poll = setInterval(() => {
    if (document.visibilityState === 'visible' && !document.querySelector('.reply-box:not([hidden]) textarea, dialog[open]')) reloadComments().catch(() => {});
  }, 30_000);
  cleanup = () => { clearInterval(poll); player.destroy(); composer.destroy(); };
}

const KIND_LABELS = { main: 'Hoofdvideo', teaser: 'Teaser', cutdown: 'Cutdown', social: 'Social', other: 'Overig' };
const ASPECTS = ['16:9', '9:16', '1:1', '4:5', '4:3', '21:9'];

/** Type · verhouding · kanaal van de oplevering, met een knop om ze aan te passen. */
function deliveryMeta(video, editable) {
  const m = video.meta || {};
  const parts = [m.kindLabel, m.aspect ? `${m.aspect}${m.aspectDetected ? ' (herkend)' : ''}` : null, m.channel].filter(Boolean);
  return h('span', { class: 'meta-item delivery-meta' },
    parts.length ? parts.join(' · ') : h('span', { class: 'muted' }, 'Type nog niet ingevuld'),
    editable ? h('button', { type: 'button', class: 'link-btn', onClick: () => detailsDialog(video) }, icon('edit'), parts.length ? 'Wijzigen' : 'Invullen') : null);
}

async function detailsDialog(video) {
  const kind = h('select', { 'aria-label': 'Type video' }, h('option', { value: '' }, 'Geen type'), Object.entries(KIND_LABELS).map(([k, l]) => h('option', { value: k }, l)));
  kind.value = video.kind || '';
  const aspect = h('select', { 'aria-label': 'Beeldverhouding' },
    h('option', { value: '' }, video.meta?.aspectDetected ? `Automatisch (${video.meta.aspect})` : 'Automatisch uit het bestand'),
    ASPECTS.map((a) => h('option', { value: a }, a)));
  aspect.value = video.aspectRatio || '';
  const channel = h('input', { type: 'text', maxlength: '80', value: video.channel || '', placeholder: 'Bijv. Instagram Reels, YouTube, tv-spot' });
  const rounds = h('input', { type: 'number', min: '1', max: '50', step: '1', inputmode: 'numeric', value: video.videoRoundsIncluded ?? '', class: 'input-narrow',
    placeholder: video.projectRoundsIncluded ? `${video.projectRoundsIncluded} (project)` : 'niet ingesteld' });
  await openDialog({
    title: 'Gegevens van deze oplevering',
    body: [
      h('p', { class: 'small muted' }, 'Elke oplevering (hoofdvideo, teaser, social…) is een eigen video. Een verbeterde montage upload je als nieuwe versie van dezelfde oplevering. De klant ziet deze gegevens alleen bij gepubliceerde video’s.'),
      h('div', { class: 'form-grid is-2' }, field('Type', kind), field('Beeldverhouding', aspect)),
      field('Bedoeld kanaal (optioneel)', channel),
      field('Afgesproken reviewrondes voor deze video', rounds, video.projectRoundsIncluded ? `Leeg = projectstandaard (${video.projectRoundsIncluded}). Vul alleen in als deze video afwijkt.` : 'Leeg = geen afspraak. De projectstandaard stel je in bij het project.'),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Opslaan'))],
    onSubmit: async () => {
      try {
        await api('PATCH', `/api/videos/${video.id}`, { kind: kind.value || null, aspectRatio: aspect.value || null, channel: channel.value, roundsIncluded: rounds.value ? Number(rounds.value) : null });
        toast('Gegevens opgeslagen', 'success');
        route();
      } catch (err) { toast(err.message, 'error'); return false; }
    },
  });
}

function titleEditor(video, editable) {
  const wrap = h('div', { class: 'title-edit' });
  const show = () => mount(wrap,
    h('h1', { class: 'page-title', title: video.title }, video.title),
    editable ? button('', { icon: 'edit', variant: 'ghost', size: 'sm', 'aria-label': 'Titel wijzigen', title: 'Titel wijzigen', onClick: edit }) : null);
  function edit() {
    const input = h('input', { type: 'text', value: video.title, maxlength: '200', class: 'title-input', 'aria-label': 'Zichtbare titel' });
    const save = h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, h('span', { class: 'btn-label' }, 'Opslaan'));
    const form = h('form', { class: 'title-form', onSubmit: async (e) => {
      e.preventDefault();
      if (!input.value.trim()) { input.classList.add('input-error'); input.focus(); return; }
      const restore = busy(save);
      try {
        await api('PATCH', `/api/videos/${video.id}`, { title: input.value });
        toast('Titel bijgewerkt. Bestanden, links en reacties zijn ongewijzigd.', 'success');
        route();
      } catch (err) { toast(err.message, 'error'); restore(); }
    } }, input, save, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: show }, 'Annuleren'),
    h('span', { class: 'field-hint' }, 'Alleen de zichtbare titel verandert, zonder bestandsextensie. Bij downloaden krijgt het bestand automatisch de juiste extensie.'));
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') show(); });
    mount(wrap, form);
    input.focus();
    input.select();
  }
  show();
  return wrap;
}

/** Vaste plek die zegt waar de geselecteerde versie staat en wat de volgende stap is. */
function publishBar(video, version, latest, clientVersion, refresh, may) {
  const isLatest = version.id === latest.id;
  const act = async (btn, fn, msg) => {
    const restore = busy(btn);
    try { await fn(); toast(msg, 'success'); refresh(); } catch (err) { toast(err.message, 'error'); restore(); }
  };
  let text;
  let actions = [];
  const round = version.rounds.at(-1);
  if (!isLatest) {
    text = [h('strong', {}, `Je bekijkt Versie ${version.number}, een oudere versie.`), ` De nieuwste versie intern is Versie ${latest.number}.`];
    actions = [button(`Naar Versie ${latest.number}`, { icon: 'arrowLeft', onClick: () => navigate(`/video/${video.id}`) })];
  } else if (version.status === 'concept') {
    text = [h('strong', {}, `Versie ${version.number} is intern.`), clientVersion ? ` Klanten zien nog Versie ${clientVersion.number}.` : ' Klanten zien nog niets.', ' Zet de versie klaar zodra hij gecontroleerd is.'];
    const b = button('Klaar voor review', { icon: 'flag', variant: 'primary', onClick: () => act(b, () => api('POST', `/api/versions/${version.id}/ready`), `Versie ${version.number} staat klaar om te delen`) });
    actions = may('upload') ? [b] : [];
  } else if (version.status === 'ready_for_review') {
    text = [h('strong', {}, `Versie ${version.number} is klaar, maar nog niet gedeeld.`), ` Na publiceren zien klanten via hun bestaande link Versie ${version.number}${clientVersion ? ` in plaats van Versie ${clientVersion.number}` : ''}, en wordt de status In review.`];
    const b = button(`Publiceren naar klant`, { icon: 'send', variant: 'primary', onClick: () => publishDialog(video, version, clientVersion, refresh) });
    actions = may('publish') ? [b] : [h('span', { class: 'small muted' }, icon('lock'), ' Publiceren doet een collega met publicatierechten.')];
  } else if (version.status === 'in_review') {
    text = [h('strong', {}, 'Klanten zien deze versie.'), ' Wacht op feedback of goedkeuring van de akkoordgever', video.approverName ? ` (${video.approverName})` : '', '.'];
    actions = may('publish') ? [button('Links bekijken', { icon: 'link', onClick: () => shareDialog(video, refresh) })] : [];
  } else if (version.status === 'changes_requested') {
    text = [h('strong', {}, 'Feedback ontvangen.'), round ? ` ${round.reviewerName}${round.verified ? ' (akkoordgever)' : ''} verstuurde ${plural(round.commentCount, 'reactie', 'reacties')} op ${formatDate(round.at)}.` : '', ' Verwerk de feedback en upload een nieuwe versie.'];
    actions = may('upload') ? [button('Nieuwe versie uploaden', { icon: 'layers', variant: 'primary', onClick: () => newVersionDialog(video) })] : [];
  } else if (version.status === 'approved') {
    text = version.approval
      ? [h('strong', {}, `Goedgekeurd door ${version.approval.name}`), ` op ${formatDate(version.approval.at)}. Deze goedkeuring geldt alleen voor Versie ${version.number}.`]
      : [h('strong', {}, 'Handmatig op Goedgekeurd gezet.'), ' Er is geen klantgoedkeuring vastgelegd voor deze versie.'];
  }
  const correct = may('manage') ? h('button', { type: 'button', class: 'link-btn', onClick: () => statusDialog(version, refresh) }, icon('edit'), 'Status corrigeren') : null;
  return h('section', { class: `publish-bar is-${version.status}${isLatest ? '' : ' is-old'}`, 'aria-label': 'Status en volgende stap' },
    h('div', { class: 'publish-status' }, h('span', { class: 'publish-version' }, `Versie ${version.number}`), statusPill(version.status)),
    h('p', { class: 'publish-text' }, text),
    h('div', { class: 'publish-actions' }, correct, actions));
}

// ---------- Reviewrondes ----------

/** "Ronde 2 · 3 afgesproken (per video)" met waarschuwing bij overschrijding. */
function roundIndicator(video) {
  const n = video.rounds.length;
  const inc = video.roundsIncluded?.count;
  if (!n && !inc) return null;
  const over = inc && n > inc;
  return h('span', { class: `meta-item round-meta${over ? ' is-over' : ''}`, title: 'Rondes worden per video bijgehouden' },
    icon(over ? 'alert' : 'history'),
    n ? `Ronde ${n}` : 'Nog geen ronde',
    inc ? h('span', { class: 'muted' }, ` · ${inc} afgesproken${video.roundsIncluded.source === 'video' ? ' voor deze video' : ' per video'}`) : null,
    over ? h('strong', {}, ` · ${n - inc} meer dan afgesproken`) : null);
}

function roundsList(video, refresh, may) {
  const inc = video.roundsIncluded?.count;
  const intro = h('p', { class: 'small muted rounds-intro' },
    'Rondes worden ', h('strong', {}, 'per video'), ' bijgehouden. Een nieuwe ronde start alleen als je dat bij het publiceren kiest.',
    inc ? ` Afgesproken: ${plural(inc, 'ronde', 'rondes')} ${video.roundsIncluded.source === 'video' ? 'voor deze video' : 'per video (projectstandaard)'}.` : ' Er is geen aantal rondes afgesproken (instellen bij het project).');
  const old = video.unroundedSharedVersions?.length
    ? h('p', { class: 'small muted' }, icon('info'), ` ${video.unroundedSharedVersions.length === 1 ? 'Versie' : 'Versies'} ${video.unroundedSharedVersions.join(', ')} ${video.unroundedSharedVersions.length === 1 ? 'is' : 'zijn'} gedeeld vóórdat rondes werden bijgehouden en ${video.unroundedSharedVersions.length === 1 ? 'hoort' : 'horen'} bij geen ronde.`)
    : null;
  if (!video.rounds.length) return h('div', { class: 'rounds' }, intro, old, emptyState({ icon: 'history', compact: true, title: 'Nog geen reviewronde', text: 'Bij het publiceren van een versie start je ronde 1.' }));
  return h('div', { class: 'rounds' }, intro, old, h('ol', { class: 'round-list' }, [...video.rounds].reverse().map((r) => h('li', { class: `round-item${inc && r.number > inc ? ' is-over' : ''}` },
    h('div', { class: 'round-head' },
      h('strong', {}, `Ronde ${r.number}`),
      inc && r.number > inc ? h('span', { class: 'badge badge-warn' }, icon('alert'), 'Boven afspraak') : null,
      may('publish') ? h('button', { type: 'button', class: 'link-btn', onClick: () => roundDialog(r, refresh) }, icon('edit'), 'Wijzigen') : null),
    h('div', { class: 'small' }, r.deadline
      ? h('span', { class: isPast(r.deadline) ? 'warn-text' : '' }, icon('clock'), ` Reactie gevraagd vóór ${formatDeadline(r.deadline)}${isPast(r.deadline) ? ' (verstreken; feedback blijft mogelijk)' : ''}`)
      : h('span', { class: 'muted' }, 'Geen deadline')),
    r.clientNote ? h('div', { class: 'small round-note' }, `Toelichting voor de klant: “${r.clientNote}”`) : null,
    h('div', { class: 'small muted' }, `${r.versions.length === 1 ? 'Versie' : 'Versies'} ${r.versions.map((x) => x.number).sort((a, b) => a - b).join(', ')} · ${plural(r.clientComments, 'klantreactie', 'klantreacties')} · ${plural(r.submissions, 'keer feedback verstuurd', 'keer feedback verstuurd')}`),
    h('div', { class: 'small muted' }, `Gestart ${formatDate(r.createdAt)}`)))));
}

/** Deadlinevelden (datum + tijd) met de tijdzone van deze computer erbij. */
function deadlineFields(iso) {
  const { date, time } = isoToLocal(iso);
  const d = h('input', { type: 'date', value: date, 'aria-label': 'Datum' });
  const t = h('input', { type: 'time', value: time || '17:00', 'aria-label': 'Tijd' });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Uitgeschreven bevestiging, zodat er geen twijfel is over dag/maand of AM/PM.
  const said = h('span', { class: 'small deadline-said', 'aria-live': 'polite' });
  const show = () => { said.textContent = d.value ? `= ${formatDeadline(localToIso(d.value, t.value))}` : `Geen deadline · tijdzone ${zone}`; };
  d.addEventListener('input', show);
  t.addEventListener('input', show);
  show();
  return { el: h('div', { class: 'deadline-fields' }, d, t, said), value: () => localToIso(d.value, t.value), clear: () => { d.value = ''; show(); } };
}

async function roundDialog(round, refresh) {
  const dl = deadlineFields(round.deadline);
  const note = h('textarea', { rows: '2', maxlength: '1000', placeholder: 'Bijv. “Let vooral op de nieuwe eindtitel.”' });
  note.value = round.clientNote || '';
  await openDialog({
    title: `Ronde ${round.number} wijzigen`,
    body: [field('Gewenste reactie vóór (optioneel)', dl.el, 'Alleen informatief: een verstreken datum keurt niets goed en sluit niets af.'), field('Toelichting voor de klant', note)],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Opslaan'))],
    onSubmit: async () => {
      try { await api('PATCH', `/api/rounds/${round.id}`, { deadline: dl.value(), clientNote: note.value }); toast('Ronde bijgewerkt', 'success'); refresh(); } catch (err) { toast(`${err.message} Je invoer is bewaard.`, 'error'); return false; }
    },
  });
}

/**
 * Publiceren: kies de ronde (bij de huidige of een nieuwe), optioneel een deadline en toelichting,
 * en beschrijf wat er is aangepast. Eén request-id per venster: opnieuw proberen na een
 * verbindingsfout publiceert niet dubbel en maakt geen extra ronde.
 */
async function publishDialog(video, version, clientVersion, refresh) {
  const last = video.rounds.at(-1);
  const inc = video.roundsIncluded?.count;
  const requestId = newRequestId();
  const draftKey = `publish-${version.id}`;
  const draft = (() => { try { return JSON.parse(draftStore.get(draftKey) || 'null'); } catch { return null; } })();
  let choice = draft?.choice || (last ? 'current' : 'new');
  const choiceBox = h('div', { class: 'round-choice', role: 'radiogroup', 'aria-label': 'Reviewronde' });
  const warn = h('div', {});
  const newFields = h('div', { class: 'round-new-fields' });
  const dl = deadlineFields(draft?.deadline || null);
  const roundNote = h('textarea', { rows: '2', maxlength: '1000', placeholder: 'Bijv. “Graag vóór vrijdag; let vooral op de muziek.”' });
  roundNote.value = draft?.roundNote || '';
  const changeNote = h('textarea', { rows: '3', maxlength: '2000', placeholder: clientVersion ? 'Bijv. “Logo in de eindtitel groter, muziek vanaf 0:12 zachter.”' : 'Optioneel bij een eerste versie' });
  changeNote.value = draft?.changeNote || '';
  const save = () => draftStore.set(draftKey, JSON.stringify({ choice, deadline: dl.value(), roundNote: roundNote.value, changeNote: changeNote.value }));
  [roundNote, changeNote].forEach((el) => el.addEventListener('input', save));

  const draw = () => {
    const nextNumber = (last?.number || 0) + 1;
    const opts = last
      ? [['current', `Bij ronde ${last.number} (huidige ronde)`, 'Bijvoorbeeld een kleine correctie binnen dezelfde ronde.'], ['new', `Ronde ${nextNumber} starten`, 'Een nieuwe feedbackronde voor de klant.']]
      : [['new', 'Ronde 1 starten', video.unroundedSharedVersions?.length ? 'Eerdere versies zijn gedeeld vóórdat rondes werden bijgehouden; die tellen hier niet mee.' : 'De eerste reviewronde van deze video.']];
    mount(choiceBox, opts.map(([k, label, hint]) => h('label', { class: `round-option${choice === k ? ' is-selected' : ''}` },
      h('input', { type: 'radio', name: 'round', value: k, checked: choice === k, onChange: () => { choice = k; save(); draw(); } }),
      h('span', {}, h('strong', {}, label), h('span', { class: 'small muted' }, hint)))));
    const willBe = choice === 'new' ? nextNumber : last?.number;
    mount(warn, inc && willBe > inc
      ? h('div', { class: 'notice notice-warn' }, icon('alert'), h('span', {}, h('strong', {}, `Dit wordt ronde ${willBe}; afgesproken ${inc === 1 ? 'is' : 'zijn'} ${plural(inc, 'ronde', 'rondes')} ${video.roundsIncluded.source === 'video' ? 'voor deze video' : 'per video'}. `), 'Publiceren kan gewoon; dit is alleen een signaal (bijvoorbeeld voor meerwerk).'))
      : null);
    mount(newFields, choice === 'new'
      ? [field('Gewenste reactie vóór (optioneel)', dl.el, 'Alleen informatief: na deze datum blijft feedback mogelijk en wordt niets automatisch goedgekeurd.'), field('Toelichting voor de klant bij deze ronde (optioneel)', roundNote)]
      : null);
  };
  draw();
  dl.el.addEventListener('change', save);

  let done = false;
  await openDialog({
    title: `Versie ${version.number} publiceren`,
    wide: true,
    body: [
      h('p', {}, `Klanten zien via hun links en het portaal voortaan Versie ${version.number}. De status wordt In review.`),
      h('h3', { class: 'dialog-sub' }, 'Reviewronde'),
      choiceBox, warn, newFields,
      field(clientVersion ? `Wat is er aangepast sinds Versie ${clientVersion.number}? (zichtbaar voor de klant)` : 'Toelichting bij deze versie (optioneel, zichtbaar voor de klant)', changeNote),
      clientVersion ? h('p', { class: 'small muted' }, `Versie ${clientVersion.number} en de feedback daarop blijven bewaard en zichtbaar als oudere versie.`) : null,
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, icon('send'), h('span', { class: 'btn-label' }, 'Publiceren'))],
    onSubmit: async () => {
      try {
        const r = await apiWithRetryTeam('POST', `/api/versions/${version.id}/share`, {
          round: choice, requestId, changeNote: changeNote.value,
          ...(choice === 'new' ? { deadline: dl.value(), roundNote: roundNote.value } : {}),
        });
        draftStore.set(draftKey, '');
        done = r;
      } catch (err) {
        toast(`${err.message} Je invoer is bewaard; probeer het opnieuw.`, 'error');
        return false;
      }
    },
  });
  if (done) { toast(`Versie ${version.number} is gepubliceerd in ronde ${done.roundNumber}. Klanten zien deze versie nu.`, 'success'); refresh(); }
}

/** Opnieuw proberen bij een verbroken verbinding, met hetzelfde verzoek (dezelfde requestId). */
async function apiWithRetryTeam(method, url, body) {
  for (let i = 1; ; i++) {
    try { return await api(method, url, body); } catch (err) {
      if (err.status !== 0 || i >= 3) throw err;
      await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
}

function moreMenu(video, version, { level, archived }) {
  const back = () => navigate(`/projecten/${video.project.id}`);
  const items = [[`Download Versie ${version.number}`, () => { location.href = `/api/versions/${version.id}/download`; }, { icon: 'download' }]];
  if (can(level, 'manage')) {
    if (video.versions.length > 1) {
      items.push([`Versie ${version.number} naar prullenbak…`, () => moveToTrash('version', version.id, `${video.title} · versie ${version.number}`, () => navigate(`/video/${video.id}`)), { icon: 'layers', danger: true }]);
    }
    items.push(archived
      ? ['Video uit archief halen', () => setArchived('video', video.id, video.title, false), { icon: 'refresh' }]
      : ['Video archiveren', () => setArchived('video', video.id, video.title, true), { icon: 'history' }]);
    items.push(['Video naar prullenbak…', () => moveToTrash('video', video.id, video.title, back), { icon: 'trash', danger: true }]);
  }
  return menuButton(items, 'Meer acties');
}

function versionsList(video, current) {
  return h('ol', { class: 'version-list' }, video.versions.map((v) => h('li', {},
    h('a', { href: `/video/${video.id}?v=${v.id}`, 'data-nav': true, class: `version-item${v.id === current.id ? ' is-current' : ''}`, 'aria-current': v.id === current.id ? 'true' : null },
      h('span', { class: 'version-num' }, `v${v.number}`),
      h('span', { class: 'version-info' },
        h('span', { class: 'version-tags' }, statusPill(v.status, { small: true }),
          v.isLatest ? h('span', { class: 'badge badge-neutral' }, 'Nieuwste') : null,
          v.isClientVersion ? h('span', { class: 'badge badge-accent' }, icon('eye'), 'Klant ziet deze') : null),
        h('span', { class: 'small muted' }, `Geüpload ${formatDate(v.createdAt)}`),
        h('span', { class: 'small muted' }, v.sharedAt ? `Gedeeld ${formatDate(v.sharedAt)}${v.roundNumber ? ` · ronde ${v.roundNumber}` : ''}` : 'Niet gedeeld', ' · ', plural(v.commentCount, 'reactie', 'reacties'),
          v.openComments ? ` (${v.openComments} open)` : ''),
        v.changeNote ? h('span', { class: 'small version-change' }, `Aangepast: ${v.changeNote}`) : null)))));
}

function historyList(version) {
  const items = [...version.events].reverse();
  return h('div', { class: 'history' },
    version.approval ? h('div', { class: 'notice notice-ok' }, icon('shield'), h('div', {}, h('strong', {}, `Goedgekeurd door ${version.approval.name}`), h('div', { class: 'small' }, `${version.approval.email} · ${formatDate(version.approval.at)}`))) : null,
    version.rounds.length ? h('div', { class: 'history-block' }, h('h3', {}, 'Verstuurde feedback'), version.rounds.map((r) => h('div', { class: 'round' },
      icon('send'), h('div', {}, h('div', {}, h('strong', {}, r.reviewerName), r.verified ? ' (akkoordgever)' : ' (opgegeven naam)', ` · ${plural(r.commentCount, 'reactie', 'reacties')}`),
        h('div', { class: 'small muted' }, formatDate(r.at)), r.message ? h('div', { class: 'small' }, `“${r.message}”`) : null)))) : null,
    h('div', { class: 'history-block' }, h('h3', {}, 'Statuswijzigingen'),
      h('ol', { class: 'timeline' }, items.map((e) => h('li', {},
        h('div', { class: 'timeline-head' }, statusPill(e.to, { small: true }), h('time', { class: 'small muted', datetime: e.at }, formatDate(e.at))),
        h('div', { class: 'small' }, e.eventLabel, ' · ', h('strong', {}, e.actorLabel)),
        e.note ? h('div', { class: 'small muted' }, `Reden: ${e.note}`) : null)))));
}

async function statusDialog(version, refresh) {
  const select = h('select', { 'aria-label': 'Nieuwe status', required: true },
    Object.entries(STATUS_LABELS).map(([k, label]) => h('option', { value: k, disabled: k === version.status }, `${label}${k === version.status ? ' (huidig)' : ''}`)));
  select.value = Object.keys(STATUS_LABELS).find((k) => k !== version.status);
  const reason = h('textarea', { rows: '2', required: true, maxlength: '500', placeholder: 'Bijv. “Klant gaf telefonisch akkoord”' });
  await openDialog({
    title: `Status van Versie ${version.number} corrigeren`,
    body: [
      h('p', {}, 'Gebruik dit alleen om een fout te herstellen. De wijziging wordt met jouw naam, tijdstip en reden in de geschiedenis bewaard.'),
      field('Nieuwe status', select),
      field('Reden (verplicht)', reason),
      h('p', { class: 'small muted' }, 'Een handmatige “Goedgekeurd” is geen goedkeuring door de akkoordgever. Zichtbaarheid voor de klant verandert hier niet; delen doe je met “Publiceren naar klant”.'),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Status opslaan'))],
    onSubmit: async () => {
      try {
        await api('POST', `/api/versions/${version.id}/status`, { status: select.value, note: reason.value });
        toast(`Status gecorrigeerd naar ${STATUS_LABELS[select.value]}`, 'success');
        refresh();
      } catch (err) { toast(err.message, 'error'); return false; }
    },
  });
}

/** "Nieuwe versie": altijd onder deze video, blijft intern tot publiceren. */
async function newVersionDialog(video, droppedFile) {
  if (uploadsDisabled()) return;
  const next = video.versions[0].number + 1;
  const client = video.versions.find((v) => v.isClientVersion);
  let file = droppedFile || null;
  const fileInfo = h('div', { class: 'drop-info' });
  const showFile = () => mount(fileInfo, file
    ? [icon('film'), h('div', {}, h('strong', { class: 'truncate' }, file.name), h('div', { class: 'small muted' }, `${formatBytes(file.size)} · technische bestandsnaam, niet zichtbaar voor de klant`))]
    : [icon('upload'), h('div', {}, h('strong', {}, 'Kies een bestand of sleep het hierheen'), h('div', { class: 'small muted' }, session.formats.map((f) => f.toUpperCase()).join(', ')))]);
  const choose = h('button', { type: 'button', class: 'dropzone', onClick: async () => { const [f] = await pickFiles({ multiple: false }); if (f) { file = f; showFile(); } } }, fileInfo);
  choose.addEventListener('dragover', (e) => e.preventDefault());
  choose.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) { file = e.dataTransfer.files[0]; showFile(); } });
  showFile();
  await openDialog({
    title: `Nieuwe versie van “${video.title}”`,
    body: [
      h('ul', { class: 'facts' },
        h('li', {}, icon('layers'), h('span', {}, 'Wordt ', h('strong', {}, `Versie ${next}`), ' en neemt titel, links en akkoordgever over.')),
        h('li', {}, icon('lock'), h('span', {}, 'Blijft ', h('strong', {}, 'intern (Concept)'), ' tot je hem publiceert.')),
        h('li', {}, icon('eye'), h('span', {}, client ? `Klanten blijven tot dan Versie ${client.number} zien.` : 'Klanten zien nog niets.')),
        h('li', {}, icon('history'), h('span', {}, 'Feedback en goedkeuring van eerdere versies blijven bewaard; de nieuwe versie is niet automatisch goedgekeurd.'))),
      choose,
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, `Uploaden als Versie ${next}`))],
    onSubmit: async () => {
      if (!file) { toast('Kies eerst een bestand.', 'error'); return false; }
      const problem = checkFile(file);
      if (problem) { toast(problem, 'error'); return false; }
      enqueue(file, { kind: 'version', videoId: video.id, videoTitle: video.title, nextNumber: next }, (item) => {
        toast(`Versie ${next} is geüpload en staat intern als Concept.`, 'success', { action: { label: 'Openen', onClick: () => navigate(`/video/${video.id}?v=${item.result.versionId}`) } });
        if (location.pathname === `/video/${video.id}`) navigate(`/video/${video.id}?v=${item.result.versionId}`, { replace: true });
      });
    },
  });
}

// ---------- Delen ----------

async function shareDialog(video, refresh) {
  const client = video.versions.find((v) => v.isClientVersion);
  const reviewerLinks = video.links.filter((l) => l.role === 'reviewer' && !l.revokedAt);
  const approverLink = video.links.find((l) => l.role === 'approver' && !l.revokedAt);
  const revoked = video.links.filter((l) => l.revokedAt);
  let changed = false;

  const linkRow = (link) => h('div', { class: 'link-row' },
    h('div', { class: 'link-row-head' },
      h('strong', { class: 'truncate' }, link.role === 'approver' ? link.approverName : (link.label || 'Reviewlink')),
      link.allowDownload ? h('span', { class: 'badge badge-neutral' }, icon('download'), 'download aan') : null,
      h('span', { class: 'small muted link-used' }, link.lastUsedAt ? `geopend ${relativeDate(link.lastUsedAt)}` : 'nog niet geopend')),
    h('div', { class: 'link-copy' },
      h('input', { type: 'text', readonly: true, value: link.url, class: 'link-url', 'aria-label': 'Deel-link', onFocus: (e) => e.target.select() }),
      button('Kopiëren', { icon: 'copy', size: 'sm', onClick: async () => { await copyText(link.url); toast('Link gekopieerd', 'success'); } }),
      button('', { icon: 'trash', size: 'sm', variant: 'ghost', 'aria-label': 'Link intrekken', title: 'Intrekken', onClick: async () => {
        const ok = await confirmDialog({ title: 'Link intrekken?', body: 'Wie deze link heeft, krijgt direct geen toegang meer, ook niet tot het videobestand. Reacties en goedkeuringen blijven bewaard.', confirmLabel: 'Intrekken', danger: true });
        if (!ok) return;
        try { await api('POST', `/api/links/${link.id}/revoke`); toast('Link ingetrokken', 'success'); dialogDone(); } catch (err) { toast(err.message, 'error'); }
      } })));

  let close;
  const dialogDone = () => { changed = true; close?.(); };

  const label = h('input', { type: 'text', placeholder: 'Label, bijv. “Marketingteam”', maxlength: '100' });
  const allowDownload = h('input', { type: 'checkbox' });
  const createReviewer = button('Reviewlink maken', { icon: 'plus', size: 'sm', onClick: async (e) => {
    const restore = busy(e.currentTarget);
    try {
      const l = await api('POST', `/api/videos/${video.id}/links`, { role: 'reviewer', label: label.value, allowDownload: allowDownload.checked });
      await copyText(l.url);
      toast('Reviewlink gemaakt en gekopieerd', 'success');
      dialogDone();
    } catch (err) { toast(err.message, 'error'); restore(); }
  } });

  const approverName = h('input', { type: 'text', value: video.approverName, placeholder: 'Naam', 'aria-label': 'Naam akkoordgever', maxlength: '200' });
  const approverEmail = h('input', { type: 'email', value: video.approverEmail, placeholder: 'E-mailadres', 'aria-label': 'E-mail akkoordgever', maxlength: '200' });
  const saveApprover = button(video.approverName ? 'Akkoordgever wijzigen' : 'Akkoordgever opslaan', { size: 'sm', onClick: async (e) => {
    const btn = e.currentTarget; // na de bevestigingsvraag (await) is currentTarget leeg
    if (!approverName.value.trim()) { approverName.classList.add('input-error'); approverName.focus(); return; }
    if (approverLink && (approverName.value !== video.approverName || approverEmail.value !== video.approverEmail)) {
      const ok = await confirmDialog({ title: 'Akkoordgever wijzigen?', body: 'De huidige persoonlijke akkoordlink wordt ingetrokken. Maak daarna een nieuwe akkoordlink voor de nieuwe akkoordgever.', confirmLabel: 'Wijzigen' });
      if (!ok) return;
    }
    const restore = busy(btn);
    try { await api('PATCH', `/api/videos/${video.id}`, { approverName: approverName.value, approverEmail: approverEmail.value }); toast('Akkoordgever opgeslagen', 'success'); dialogDone(); } catch (err) { toast(err.message, 'error'); restore(); }
  } });
  const createApprover = video.approverName && !approverLink ? button('Persoonlijke akkoordlink maken', { icon: 'shield', size: 'sm', variant: 'primary', onClick: async (e) => {
    const restore = busy(e.currentTarget);
    try { const l = await api('POST', `/api/videos/${video.id}/links`, { role: 'approver' }); await copyText(l.url); toast('Akkoordlink gemaakt en gekopieerd', 'success'); dialogDone(); } catch (err) { toast(err.message, 'error'); restore(); }
  } }) : null;

  const body = [
    video.portalLinkActive ? h('div', { class: 'notice notice-info' }, icon('globe'),
      h('span', {}, 'Deze video staat ook in het ', h('strong', {}, 'klantportaal'), ' van het project (zodra een versie gepubliceerd is). Die toegang beheer je via “Klantportaal” op de projectpagina; de links hieronder staan daar los van.')) : null,
    h('div', { class: `notice ${client ? 'notice-info' : 'notice-warn'}` }, icon(client ? 'eye' : 'lock'),
      h('span', {}, client ? [`Via deze links zien klanten `, h('strong', {}, `Versie ${client.number}`), ' (de nieuwste gedeelde versie). De links blijven gelijk bij nieuwe versies.']
        : 'Er is nog geen versie gepubliceerd. Wie een link opent, ziet een wachtmelding tot je een versie publiceert.')),
    h('section', { class: 'share-section' },
      h('div', { class: 'share-head' }, h('span', { class: 'share-icon' }, icon('globe')),
        h('div', {}, h('h3', {}, 'Reviewlink'), h('p', { class: 'small muted' }, 'Voor iedereen die mag meekijken. Bekijken, reageren en feedback versturen, zonder account. ', h('strong', {}, 'Kan niet goedkeuren.')))),
      reviewerLinks.length ? reviewerLinks.map(linkRow) : h('p', { class: 'small muted' }, 'Nog geen reviewlink. Bij publiceren wordt er automatisch een gemaakt.'),
      h('details', { class: 'share-more' }, h('summary', {}, 'Extra reviewlink maken'),
        h('div', { class: 'share-form' }, label, h('label', { class: 'check' }, allowDownload, 'Klant mag het bestand downloaden'), createReviewer))),
    h('section', { class: 'share-section is-approver' },
      h('div', { class: 'share-head' }, h('span', { class: 'share-icon' }, icon('shield')),
        h('div', {}, h('h3', {}, 'Akkoordlink'), h('p', { class: 'small muted' }, 'Persoonlijke link voor de ene aangewezen akkoordgever. ', h('strong', {}, 'Alleen met deze link kan een versie worden goedgekeurd.'), ' Deel hem alleen met die persoon.'))),
      h('div', { class: 'share-form share-form-row' }, approverName, approverEmail, saveApprover),
      approverLink ? linkRow(approverLink) : createApprover || h('p', { class: 'small muted' }, 'Vul eerst de akkoordgever in.')),
    revoked.length ? h('details', { class: 'share-more' }, h('summary', {}, `Ingetrokken links (${revoked.length})`),
      revoked.map((l) => h('div', { class: 'link-row is-revoked' }, h('strong', { class: 'small' }, l.role === 'approver' ? `Akkoordlink · ${l.approverName}` : (l.label || 'Reviewlink')), h('span', { class: 'small muted' }, ` · ingetrokken ${formatDate(l.revokedAt)}`)))) : null,
  ];

  const promise = openDialog({ title: `Delen: ${video.title}`, body, wide: true, actions: [h('button', { class: 'btn btn-primary', value: 'cancel' }, 'Klaar')] });
  close = () => document.querySelector('dialog[open]')?.close('');
  await promise;
  if (changed) { refresh(); setTimeout(() => shareDialogReopen(video.id), 50); }
}

async function shareDialogReopen(videoId) {
  if (location.pathname !== `/video/${videoId}`) return;
  try { const fresh = await api('GET', `/api/videos/${videoId}`); shareDialog(fresh, () => route()); } catch { /* pagina toont al de fout */ }
}

// ---------- Klantportaal (projectlink) ----------

async function portalDialog(project) {
  const box = h('div', { class: 'portal-dialog' }, h('div', { class: 'loading-page', style: null }, h('div', { class: 'spinner', role: 'status', 'aria-label': 'Laden' })));
  const done = openDialog({ title: `Klantportaal: ${project.name}`, body: box, wide: true, actions: [h('button', { class: 'btn btn-primary', value: 'cancel' }, 'Klaar')] });

  async function draw() {
    let st;
    try { st = await api('GET', `/api/projects/${project.id}/portal-link`); } catch (err) { mount(box, errorState(err, draw)); return; }
    const act = async (btn, fn, msg) => {
      const restore = busy(btn);
      try { const r = await fn(); if (msg) toast(msg, 'success'); await draw(); return r; } catch (err) { toast(err.message, 'error'); restore(); return null; }
    };
    const facts = h('ul', { class: 'facts' },
      h('li', {}, icon('eye'), h('span', {}, 'De klant ziet ', h('strong', {}, plural(st.publishedVideos, 'gepubliceerde video', 'gepubliceerde video’s')), ' met de status van de gepubliceerde versie, plus de briefingonderdelen die je deelt. Concepten, nieuwe interne versies en interne notities blijven verborgen.')),
      h('li', {}, icon('chat'), h('span', {}, 'Bekijken, reageren en feedback versturen kan zonder account.')),
      h('li', {}, icon('shield'), h('span', {}, h('strong', {}, 'Goedkeuren kan niet via de projectlink. '), 'Dat blijft per video via de persoonlijke akkoordlink (Delen bij de video).')));
    const localNote = st.localOnly ? h('div', { class: 'notice notice-warn' }, icon('alert'),
      h('span', {}, h('strong', {}, 'Werkt nu alleen op deze computer. '), 'De link begint met localhost: klanten buiten deze Mac kunnen hem nog niet openen. Daarvoor moet de app op een bereikbaar adres draaien (zie README, “Nog nodig voor livegebruik”). Je kunt het portaal wel zelf bekijken en testen.')) : null;

    if (!st.link) {
      const create = button('Projectlink maken', { icon: 'link', variant: 'primary', onClick: (e) => act(e.currentTarget, async () => {
        const r = await api('POST', `/api/projects/${project.id}/portal-link`);
        await copyText(r.link.url);
      }, 'Projectlink gemaakt en gekopieerd') });
      mount(box,
        h('p', {}, 'Eén vaste link waarmee de klant alle video’s van dit project op één overzichtspagina ziet.'),
        facts, localNote,
        st.revokedCount ? h('p', { class: 'small muted' }, `${plural(st.revokedCount, 'eerdere projectlink is', 'eerdere projectlinks zijn')} ingetrokken en werken niet meer.`) : null,
        h('div', { class: 'portal-actions' }, create, previewLink(project)));
      return;
    }
    const l = st.link;
    const replace = button('Vervangen…', { icon: 'refresh', size: 'sm', onClick: async (e) => {
      const btn = e.currentTarget; // na een await is currentTarget leeg
      const ok = await confirmDialog({ title: 'Projectlink vervangen?', body: h('div', {},
        h('p', {}, 'Er komt een nieuwe link. De huidige link en alle video’s die daarmee geopend zijn, werken direct niet meer.'),
        h('p', { class: 'muted' }, 'Gebruik dit als de link bij de verkeerde persoon terecht is gekomen. Reacties en feedback blijven bewaard. Deel daarna de nieuwe link.')), confirmLabel: 'Vervangen', danger: true });
      if (ok) act(btn, async () => { const r = await api('POST', `/api/projects/${project.id}/portal-link`, { replace: true }); await copyText(r.link.url); }, 'Nieuwe projectlink gemaakt en gekopieerd. De oude werkt niet meer.');
    } });
    const revoke = button('Intrekken…', { icon: 'trash', size: 'sm', variant: 'ghost', onClick: async (e) => {
      const btn = e.currentTarget;
      const ok = await confirmDialog({ title: 'Projectlink intrekken?', body: h('div', {},
        h('p', {}, 'Wie deze link heeft, ziet direct het portaal niet meer en kan de video’s die hij via het portaal opende niet meer bekijken of becommentariëren.'),
        h('p', {}, st.separateVideoLinks
          ? [h('strong', {}, `${plural(st.separateVideoLinks, 'afzonderlijke videolink blijft', 'afzonderlijke videolinks blijven')} werken`), ' (review- en akkoordlinks per video). Trek die zo nodig apart in via Delen bij de video.']
          : 'Er zijn geen afzonderlijke videolinks actief.'),
        h('p', { class: 'muted' }, 'Reacties, feedback en goedkeuringen blijven bewaard. Je kunt later een nieuwe projectlink maken.')), confirmLabel: 'Intrekken', danger: true });
      if (ok) act(btn, () => api('POST', `/api/projects/${project.id}/portal-link/revoke`), 'Projectlink ingetrokken');
    } });
    mount(box,
      h('div', { class: 'link-row' },
        h('div', { class: 'link-row-head' }, h('strong', {}, 'Projectlink'), h('span', { class: 'small muted link-used' }, l.lastUsedAt ? `geopend ${relativeDate(l.lastUsedAt)}` : 'nog niet geopend')),
        h('div', { class: 'link-copy' },
          h('input', { type: 'text', readonly: true, value: l.url, class: 'link-url', 'aria-label': 'Projectlink', onFocus: (e) => e.target.select() }),
          button('Kopiëren', { icon: 'copy', size: 'sm', onClick: async () => { await copyText(l.url); toast('Projectlink gekopieerd', 'success'); } }),
          h('a', { class: 'btn btn-sm btn-ghost', href: l.url, target: '_blank', rel: 'noopener', title: 'Openen als klant (nieuw tabblad)' }, icon('external'), h('span', { class: 'visually-hidden' }, 'Openen')))),
      localNote, facts,
      h('div', { class: 'portal-actions' }, previewLink(project), h('span', { class: 'spacer' }), replace, revoke),
      h('p', { class: 'small muted' }, `Gemaakt ${formatDate(l.createdAt)}. Intrekken of vervangen raakt de afzonderlijke review- en akkoordlinks per video niet${st.separateVideoLinks ? ` (nu ${st.separateVideoLinks} actief)` : ''}.`));
  }
  draw();
  await done;
}

const previewLink = (project) => h('a', { class: 'btn btn-sm btn-secondary', href: `/voorbeeld/project/${project.id}`, target: '_blank', rel: 'noopener' }, icon('eye'), h('span', { class: 'btn-label' }, 'Bekijk als klant'));

// Uploads die klaar zijn, verversen het zijbalkoverzicht.
onUploadsChange((all) => { if (all.some((i) => i.state === 'done' && !i.counted)) { all.forEach((i) => { if (i.state === 'done') i.counted = true; }); refreshSidebar(); } });

route();
