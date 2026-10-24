import {
  h, mount, icon, button, busy, api, statusPill, STATUS, STATUS_LABELS, toast, confirmDialog, openDialog, field,
  formatDate, relativeDate, formatBytes, timecode, copyText, emptyState, errorState, skeletonRows, plural, draftStore,
  newRequestId, formatDeadline, isPast, localToIso, isoToLocal,
} from '/shared/util.js';
import { createPlayer } from '/shared/player.js';
import { renderComments, markersFrom, commentCounts } from '/shared/comments.js';
import { createComposer } from '/shared/composer.js';
import { configureUploads, enqueue, checkFile, suggestTitle, createUploadTray, onUploadsChange } from './uploads.js';
import { can, menuButton } from './admin.js';
import { viewDashboard } from './dashboard.js';
import { searchBox, viewSearch } from './search.js';
import { viewSettings, settingsSection, saveTheme } from './settings.js';
import { THEMES, applyTheme, themePref } from '/shared/theme.js';
import { viewBriefing } from './briefing.js';
import { taskDialog, taskChip, viewFeedback, viewMyTasks } from './tasks.js';
import { createCompare } from '/shared/compare.js';
import { exportDialog } from './export.js';
import { viewDeliveries } from './deliveries.js';
import { viewActivity } from './activity.js';
import { protectionBadges, protectionButton } from './linkprotect.js';
import { viewClients, viewClient, clientSection } from './clients.js';
import { brandChip } from './brandchip.js';

const root = document.getElementById('root');
let session = null;
let cleanup = () => {};
let shellEl = null;
let pageEl = null;

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
  // Thema van dit account (ook direct na inloggen, zonder herladen).
  if (session.theme && session.theme !== themePref()) applyTheme(session.theme);
  configureUploads(session);
  ensureShell();
  const path = location.pathname;
  let m;
  const views = [
    [/^\/$/, () => viewDashboard({ ...ctx(), onboarding }), 'dashboard'],
    [/^\/projecten$/, () => viewProjects(), 'projects'],
    [/^\/zoeken$/, () => viewSearch(ctx()), 'search'],
    [/^\/(instellingen(\/[a-z]+)?|team|merken|opslag|prullenbak|archief)$/, () => viewSettings(ctx(), settingsSection(location.pathname, session)), 'settings'],
    [/^\/projecten\/(\d+)$/, (id) => viewProject(Number(id)), 'projects'],
    [/^\/projecten\/(\d+)\/briefing$/, (id) => viewProject(Number(id), 'briefing'), 'projects'],
    [/^\/projecten\/(\d+)\/feedback$/, (id) => viewProject(Number(id), 'feedback'), 'projects'],
    [/^\/projecten\/(\d+)\/oplevering$/, (id) => viewProject(Number(id), 'delivery'), 'projects'],
    [/^\/projecten\/(\d+)\/activiteit$/, (id) => viewProject(Number(id), 'activity'), 'projects'],
    [/^\/taken$/, () => viewMyTasks(ctx()), 'tasks'],
    [/^\/klanten$/, () => viewClients(ctx()), 'clients'],
    [/^\/klanten\/(\d+)$/, (id) => viewClient(ctx(), Number(id)), 'clients'],
    [/^\/video\/(\d+)$/, (id) => viewVideo(Number(id)), 'projects'],
    [/^\/video\/(\d+)\/vergelijk$/, (id) => viewCompare(Number(id)), 'projects'],
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
      h('p', { class: 'muted', style: null }, h('a', { href: '/projecten', 'data-nav': true }, '← Terug naar projecten'))));
  }
  pageEl.focus({ preventScroll: true });
}

/** Gedeelde context voor de beheerschermen (admin.js). */
const ctx = () => ({ session, pageEl, pageHeader, navigate, refresh: () => route() });

function viewNotFound() {
  document.title = 'Niet gevonden — Studio Review';
  mount(pageEl, h('div', { class: 'page' }, pageHeader({ title: 'Pagina niet gevonden' }),
    emptyState({ icon: 'folder', title: 'Deze pagina bestaat niet', text: 'Misschien is het project of de video verwijderd.', action: button('Naar projecten', { variant: 'primary', onClick: () => navigate('/projecten') }) })));
}

// ---------- Shell: vaste zijbalk ----------

function ensureShell() {
  if (shellEl && root.contains(shellEl)) { refreshSidebar(); return; }
  const tray = createUploadTray({
    openItem: (item) => navigate(item.target.kind === 'video' ? `/video/${item.result.videoId}` : `/video/${item.target.videoId}?v=${item.result.versionId}`),
  });
  const menuBtn = button('', { icon: 'grid', variant: 'ghost', 'aria-label': 'Menu', class: 'btn btn-ghost btn-icon menu-btn', onClick: () => shellEl.classList.toggle('nav-open') });
  const navLink = (href, section, iconName, label, extra) => h('a', { href, 'data-nav': true, dataset: { section } }, icon(iconName), h('span', { class: 'nav-label' }, label), extra);
  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'side-top' },
      h('a', { href: '/', 'data-nav': true, class: 'brand' }, h('span', { class: 'brand-mark' }, icon('play')), h('span', {}, 'Studio Review')),
      menuBtn),
    h('div', { class: 'side-scroll' },
      searchBox({ navigate }),
      h('nav', { class: 'side-nav', 'aria-label': 'Hoofdmenu' },
        navLink('/', 'dashboard', 'grid', 'Dashboard'),
        navLink('/projecten', 'projects', 'folder', 'Projecten'),
        navLink('/klanten', 'clients', 'users', 'Klanten')),
      h('nav', { class: 'side-nav side-nav-secondary', 'aria-label': 'Snel naar' },
        navLink('/taken', 'tasks', 'tasks', 'Mijn taken', h('span', { class: 'side-count', id: 'my-task-count', hidden: true })))),
    h('div', { class: 'side-foot' },
      h('nav', { class: 'side-nav', 'aria-label': 'Instellingen' }, navLink('/instellingen', 'settings', 'wrench', 'Instellingen')),
      systemStatus(),
      profileMenu(),
      h('div', { class: 'side-version', title: 'Versie van deze installatie' }, `Studio Review ${session.version?.label || ''}`)));
  pageEl = h('main', { class: 'page-host', id: 'main', tabindex: '-1' });
  shellEl = h('div', { class: 'app' },
    h('a', { class: 'skip-link', href: '#main' }, 'Naar inhoud'),
    sidebar,
    h('div', { class: 'main-col' }, systemBanner(), pageEl),
    tray);
  shellEl.addEventListener('click', (e) => { if (e.target.closest('.side-nav a, .suggest-item')) shellEl.classList.remove('nav-open'); });
  mount(root, shellEl);
  refreshSidebar();
}

/** Profielmenu: thema (klein), instellingen en uitloggen. */
function profileMenu() {
  const menu = h('div', { class: 'menu profile-menu', role: 'menu', hidden: true });
  const trigger = h('button', { type: 'button', class: 'side-user', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Profielmenu van ${session.user.name}` },
    h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(session.user.name)),
    h('span', { class: 'side-user-text' }, h('span', { class: 'truncate' }, session.user.name), h('span', { class: 'truncate small muted' }, session.user.email)),
    icon('chevronDown'));
  const close = () => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside); };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  function draw() {
    mount(menu,
      h('div', { class: 'menu-label' }, 'Thema'),
      THEMES.map(([key, label]) => h('button', {
        type: 'button', class: 'menu-item', role: 'menuitemradio', 'aria-checked': String(themePref() === key),
        onClick: async () => { await saveTheme(key); draw(); },
      }, h('span', { class: 'menu-check', 'aria-hidden': 'true' }, themePref() === key ? icon('check') : null), label)),
      h('div', { class: 'menu-sep', role: 'separator' }),
      h('a', { class: 'menu-item', role: 'menuitem', href: '/instellingen/account', 'data-nav': true, onClick: close }, icon('users'), 'Mijn account'),
      h('a', { class: 'menu-item', role: 'menuitem', href: '/instellingen', 'data-nav': true, onClick: close }, icon('wrench'), 'Instellingen'),
      h('button', { type: 'button', class: 'menu-item', role: 'menuitem', onClick: () => { close(); logout(); } }, icon('logout'), 'Uitloggen'),
      h('div', { class: 'menu-foot small muted' }, `Studio Review ${session.version?.label || ''}`));
  }
  trigger.addEventListener('click', () => {
    if (!menu.hidden) return close();
    draw();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('click', outside));
    menu.querySelector('.menu-item')?.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('.menu-item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { close(); trigger.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  const wrap = h('div', { class: 'profile-wrap' }, menu, trigger);
  return wrap;
}

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

function setActiveNav(section) {
  shellEl.querySelectorAll('.side-nav a').forEach((a) => a.classList.toggle('is-active', a.dataset.section === section));
}

async function refreshSidebar() {
  api('GET', '/api/my/tasks').then((r) => {
    const el = document.getElementById('my-task-count');
    if (el) { el.textContent = String(r.items.length); el.hidden = !r.items.length; }
  }).catch(() => {});
}

/** Waarschuwt als er serveronderdelen ontbreken. */
function systemBanner() {
  const m = session.media;
  const sys = session.system;
  if (sys && !sys.storage.ok) {
    return h('div', { class: 'system-banner is-error', role: 'alert' }, icon('alert'),
      h('span', {}, h('strong', {}, 'Opslag niet bereikbaar. '), sys.storage.reason));
  }
  if (sys?.restoreNotice) {
    const n = sys.restoreNotice;
    const dismiss = button('Begrepen', { size: 'sm', onClick: async (e) => {
      const restore = busy(e.currentTarget);
      try { await api('POST', '/api/system/restore-notice/dismiss'); sys.restoreNotice = null; e.target.closest('.system-banner')?.remove(); } catch (err) { toast(err.message, 'error'); restore(); }
    } });
    return h('div', { class: `system-banner${n.links === 'keep' ? ' is-error' : ''}`, role: 'status' }, icon(n.links === 'keep' ? 'alert' : 'info'),
      h('span', {}, h('strong', {}, `Back-up van ${formatDate(n.backupCreatedAt)} teruggezet. `),
        n.links === 'keep'
          ? `De klantlinks uit de back-up werken weer (${n.linkCounts?.total ?? 0}). Links die je na die back-up had ingetrokken, kunnen dus weer toegang geven. Controleer ze en trek ze zo nodig opnieuw in.`
          : `Alle ${n.linkCounts?.total ?? 0} klantlinks (review-, akkoord-, project-, oplever- en klantportaallinks) zijn ongeldig gemaakt. Maak nieuwe links aan en deel ze opnieuw. Goedkeuringen, reacties en opleveringen zijn bewaard.`),
      dismiss);
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
    history.replaceState(null, '', `/projecten${q.toString() ? `?${q}` : ''}`);
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
    grid,
    h('nav', { class: 'projects-foot small', 'aria-label': 'Meer projecten' },
      h('a', { href: '/instellingen/archief', 'data-nav': true }, icon('history'), ' Gearchiveerde projecten'),
      h('a', { href: '/instellingen/prullenbak', 'data-nav': true }, icon('trash'), ' Prullenbak'))));
  draw();
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
async function moveToTrash(type, id, name, after, { deliveryWarning = null } = {}) {
  const ok = await confirmDialog({
    title: `“${name}” naar de prullenbak?`,
    body: h('div', {},
      deliveryWarning ? h('div', { class: 'notice notice-warn' }, icon('package'), h('span', {}, h('strong', {}, 'Dit is een definitieve oplevering. '), deliveryWarning)) : null,
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
    tabLink('feedback', `/projecten/${project.id}/feedback`, 'tasks', 'Feedback', project.openFeedback ? h('span', { class: 'seg-count' }, project.openFeedback) : null),
    h('a', { href: `/projecten/${project.id}/briefing`, 'data-nav': true, class: tab === 'briefing' ? 'is-active' : '', 'aria-current': tab === 'briefing' ? 'page' : null }, icon('clipboard'), 'Briefing',
      h('span', { class: 'seg-count', dataset: { count: 'briefing' } }, project.briefingCount),
      h('span', { class: 'badge badge-visible', title: 'Onderdelen die de klant kan bekijken', dataset: { count: 'shared' }, hidden: !project.sharedBriefingCount }, icon('eye'), h('span', {}, project.sharedBriefingCount))),
    tabLink('delivery', `/projecten/${project.id}/oplevering`, 'package', 'Oplevering', h('span', { class: 'seg-count', dataset: { count: 'delivery' } }, project.deliveryCount)),
    can(project.myLevel, 'publish') ? tabLink('activity', `/projecten/${project.id}/activiteit`, 'activity', 'Activiteit') : null);
  const briefingHost = h('div', {});

  const content = h('div', { class: 'page page-drop' },
    pageHeader({
      crumbs: [{ label: 'Projecten', href: '/projecten' }],
      title: h('h1', { class: 'page-title', title: project.name }, project.name),
      meta: [
        project.client ? h('a', { href: `/klanten/${project.client.id}`, 'data-nav': true, title: 'Gekoppelde klant' }, icon('users'), ' ', project.client.name)
          : project.clientName ? h('span', {}, project.clientName) : null,
        project.clientVisibility === 'completed' ? h('span', { class: 'badge badge-neutral', title: 'In het klantportaal ingeklapt onder “Afgeronde projecten”' }, 'afgerond voor klant') : null,
        project.clientVisibility === 'off' ? h('span', { class: 'badge badge-danger', title: 'Geen enkele klantlink werkt voor dit project' }, icon('lock'), 'klanttoegang uit') : null,
        h('span', {}, plural(project.videos.length, 'video', 'video’s')),
        brandChip(project.brand),
      ],
      actions: [
        mayUpload && isVideos ? button('Nieuwe video', { icon: 'upload', variant: 'primary', onClick: chooseFiles, title: 'Een nieuwe, losse video aan dit project toevoegen' }) : null,
        can(project.myLevel, 'publish') ? menuButton([
          ['Klantportaal (projectlink)…', () => portalDialog(project), { icon: 'globe' }],
          ['Opleverlink en oplevering', () => navigate(`/projecten/${project.id}/oplevering`), { icon: 'package' }],
          ['Klantweergave bekijken', () => window.open(`/voorbeeld/project/${project.id}`, '_blank', 'noopener'), { icon: 'eye' }],
          mayManage ? ['Klant en klanttoegang…', () => clientSection(project, () => route()), { icon: 'users' }] : null,
        ].filter(Boolean), 'Delen', { label: 'Delen', icon: 'link' }) : null,
        menuButton([
          project.videos.length ? ['Feedback exporteren…', () => exportDialog({ projectId: project.id, videos: project.videos }), { icon: 'fileDown' }] : null,
          ['Klantweergave bekijken', () => window.open(`/voorbeeld/project/${project.id}`, '_blank', 'noopener'), { icon: 'eye' }],
          mayManage ? ['Project bewerken…', () => editProject(project), { icon: 'edit' }] : null,
          mayManage ? (archived ? ['Uit archief halen', () => setArchived('project', project.id, project.name, false), { icon: 'refresh' }]
            : ['Archiveren', () => setArchived('project', project.id, project.name, true), { icon: 'history' }]) : null,
          mayManage ? ['Naar prullenbak…', () => moveToTrash('project', project.id, project.name, () => navigate('/projecten'), { deliveryWarning: project.deliveryCount ? `Dit project heeft ${plural(project.deliveryCount, 'vrijgegeven bestand', 'vrijgegeven bestanden')}. Zolang het in de prullenbak staat, werken de opleverlink en het klantportaal niet.` : null }), { icon: 'trash', danger: true }] : null,
        ].filter(Boolean), 'Projectacties'),
      ],
    }),
    archived ? h('div', { class: 'notice notice-info page-notice' }, icon('history'),
      h('span', {}, h('strong', {}, 'Dit project is gearchiveerd. '), 'Alles blijft bewaard en is te bekijken, maar uploaden, publiceren en reageren kan niet. Klanten kunnen hun links nog openen.'),
      mayManage ? button('Uit archief halen', { size: 'sm', onClick: () => setArchived('project', project.id, project.name, false) }) : null) : null,
    project.clientVisibility === 'off' ? h('div', { class: 'notice notice-warn page-notice' }, icon('lock'),
      h('span', {}, h('strong', {}, 'Klanttoegang staat uit. '), 'Geen enkele klantlink werkt voor dit project: klantportaal, projectlink, review- en akkoordlinks, opleverlink en directe bestandsadressen.'),
      mayManage ? button('Wijzigen', { size: 'sm', onClick: () => clientSection(project, () => route()) }) : null) : null,
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
  } else if (tab === 'delivery') {
    await viewDeliveries({ project, host: briefingHost, onCount: (n) => { tabs.querySelector('[data-count=delivery]').textContent = String(n); } });
  } else if (tab === 'activity') {
    await viewActivity({ project, host: briefingHost });
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
      v.delivery ? h('span', { class: `badge ${v.delivery.available ? 'badge-ok' : 'badge-warn'}`, title: v.delivery.available ? 'Definitief vrijgegeven aan de klant' : v.delivery.reasonText }, icon(v.delivery.available ? 'package' : 'lock'), `Opgeleverd v${v.delivery.versionNumber}`) : null,
      h('span', { class: 'small muted', title: formatDate(v.lastActivityAt) }, relativeDate(v.lastActivityAt)),
      mayManage ? menuButton([
        v.archivedAt ? ['Uit archief halen', () => setArchived('video', v.id, v.title, false), { icon: 'refresh' }]
          : ['Archiveren', () => setArchived('video', v.id, v.title, true), { icon: 'history' }],
        ['Naar prullenbak…', () => moveToTrash('video', v.id, v.title, reload, { deliveryWarning: v.delivery ? 'Zolang de video in de prullenbak staat, verdwijnt het bestand van de opleverpagina van de klant.' : null }), { icon: 'trash', danger: true }],
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
  // Een reactie kiezen: naar het moment, en een eventuele tekening tonen op het stilstaande beeld.
  const focusComment = (c) => { player.pause(); player.showAnnotation(c?.annotation || null); };
  player.onMarkerClick((cid) => { activeId = cid; filter = 'all'; selectTab('comments'); drawComments(); scrollToComment(cid); focusComment(comments.find((x) => x.id === cid)); });

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
      onSeek: (t, cid, c) => { player.seek(t); activeId = cid; drawComments(); focusComment(c); },
      onPlayRange: (start, end, cid) => { activeId = cid; drawComments(); player.showAnnotation(null); player.playRange(start, end); },
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
    onSubmit: async (body, tc, { timecodeEnd, annotation } = {}) => {
      try {
        await api('POST', `/api/versions/${version.id}/comments`, { body, timecode: tc, timecodeEnd, annotation, internal: !shareWithClient });
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
    ['info', 'Info', null],
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
    // Info: vaste secties voor eigenschappen, rondes en geschiedenis van deze versie.
    info: h('div', { class: 'tabpanel', role: 'tabpanel', id: 'tabpanel-info', 'aria-labelledby': 'tab-info' }, h('div', { class: 'panel-scroll info-panel' },
      h('section', { class: 'info-section', id: 'info-props', 'aria-labelledby': 'info-props-h' }, h('h3', { id: 'info-props-h' }, 'Eigenschappen'), propertiesBlock(video, version, may, player, refresh)),
      h('section', { class: 'info-section', id: 'info-rounds', 'aria-labelledby': 'info-rounds-h' }, h('h3', { id: 'info-rounds-h' }, 'Reviewrondes', video.rounds.length ? h('span', { class: 'seg-count' }, video.rounds.length) : null), roundsList(video, refresh, may)),
      h('section', { class: 'info-section', id: 'info-history', 'aria-labelledby': 'info-history-h' }, h('h3', { id: 'info-history-h' }, `Geschiedenis van versie ${version.number}`), historyList(version)))),
  };
  function selectTab(key) {
    tab = key;
    // Het gekozen tabblad hoort bij het adres, zodat het na verversen of een actie open blijft.
    const q = new URLSearchParams(location.search);
    if (key === 'comments') q.delete('tab'); else q.set('tab', key);
    history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
    tabButtons.forEach((b) => { const on = b.id === `tab-${key}`; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    Object.entries(panels).forEach(([k, p]) => { p.hidden = k !== key; });
  }

  // ---- Kop ----
  const versionSelect = h('select', { class: 'version-select', 'aria-label': 'Kies versie' },
    video.versions.map((v) => h('option', { value: v.id }, `Versie ${v.number} · ${STATUS_LABELS[v.status]}${v.isLatest ? ' · nieuwste' : ''}${v.isClientVersion ? ' · bij klant' : ''}`)));
  versionSelect.value = String(version.id);
  versionSelect.addEventListener('change', () => navigate(`/video/${video.id}?v=${versionSelect.value}`));

  const shareBtn = can(level, 'publish') ? button('Delen', { icon: 'link', onClick: () => shareDialog(video, refresh) }) : null;
  if (archived) composer.setDisabled(true, 'Gearchiveerd: reageren is niet meer mogelijk.');

  const content = h('div', { class: 'workspace page-drop' },
    pageHeader({
      crumbs: [{ label: 'Projecten', href: '/projecten' }, { label: video.project.name, href: `/projecten/${video.project.id}` }],
      title: titleEditor(video, may('upload')),
      meta: [
        statusPill(version.status, { small: true }),
        h('span', { class: 'meta-item' }, icon('eye'), h('span', { class: 'muted' }, ' Klant ziet: '), clientVersion ? `Versie ${clientVersion.number}` : 'nog niets gedeeld'),
        video.delivery ? h('a', { class: `meta-item delivery-chip${video.delivery.available ? '' : ' is-blocked'}`, href: `/projecten/${video.project.id}/oplevering`, 'data-nav': true, title: video.delivery.available ? 'Definitief vrijgegeven aan de klant' : video.delivery.reasonText },
          icon(video.delivery.available ? 'package' : 'lock'), h('span', { class: 'muted' }, ' Opgeleverd: '), `Versie ${video.delivery.versionNumber}`, video.delivery.available ? '' : ' (geblokkeerd)') : null,
        roundIndicator(video),
      ],
      actions: [versionSelect, shareBtn, moreMenu(video, version, { level, archived, refresh })],
    }),
    archived ? h('div', { class: 'notice notice-info page-notice' }, icon('history'), h('span', {}, h('strong', {}, 'Gearchiveerd. '), 'Deze video is alleen te bekijken. Klanten kunnen hun link nog openen, maar niet meer reageren of goedkeuren.')) : null,
    publishBar(video, version, latest, clientVersion, refresh, may),
    h('div', { class: 'workspace-grid' },
      h('section', { class: 'stage', 'aria-label': 'Video' }, player.el),
      h('aside', { class: 'side-panel', 'aria-label': 'Reacties en details' },
        h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Paneel' }, tabButtons),
        Object.values(panels))));
  if (may('upload')) makeDropTarget(content, (files) => newVersionDialog(video, files[0]), `Loslaten als nieuwe versie (Versie ${latest.number + 1})`);
  mount(pageEl, content);
  // Oude adressen (?tab=rounds / ?tab=history) openen het Info-paneel bij de juiste sectie.
  const section = { rounds: 'info-rounds', history: 'info-history' }[tab];
  selectTab(section ? 'info' : ['comments', 'versions', 'info'].includes(tab) ? tab : 'comments');
  if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' });
  drawComments();
  // Vanuit een overzicht: direct naar de reactie en het juiste moment.
  const focusId = Number(new URLSearchParams(location.search).get('c'));
  const focus = comments.find((c) => c.id === focusId);
  if (focus) {
    activeId = focus.id;
    drawComments();
    if (focus.timecode !== null && focus.timecode !== undefined) { player.seek(focus.timecode); if (focus.annotation) player.video.addEventListener('loadedmetadata', () => focusComment(focus), { once: true }); }
    setTimeout(() => scrollToComment(focus.id), 50);
  }

  const poll = setInterval(() => {
    if (document.visibilityState === 'visible' && !document.querySelector('.reply-box:not([hidden]) textarea, dialog[open]')) reloadComments().catch(() => {});
  }, 30_000);
  cleanup = () => { clearInterval(poll); player.destroy(); composer.destroy(); };
}

const KIND_LABELS = { main: 'Hoofdvideo', teaser: 'Teaser', cutdown: 'Cutdown', social: 'Social', other: 'Overig' };
const ASPECTS = ['16:9', '9:16', '1:1', '4:5', '4:3', '21:9'];

/** Info › Eigenschappen: gegevens van de video, het bestand van deze versie en de thumbnail. */
function propertiesBlock(video, version, may, player, refresh) {
  const f = version.file;
  const posterImgEl = h('img', { class: 'info-poster', alt: `Thumbnail van versie ${version.number}`, src: `/api/versions/${version.id}/poster?t=${f.customPoster ? f.customPosterTime : 'auto'}` });
  posterImgEl.addEventListener('error', () => posterImgEl.replaceWith(h('div', { class: 'info-poster poster-empty' }, icon('film'))));
  const setFrame = async (btn) => {
    const at = player.currentTime();
    const restore = busy(btn);
    try {
      await api('POST', `/api/versions/${version.id}/poster`, { time: Math.round(at * 100) / 100 });
      toast(`Thumbnail van versie ${version.number} ingesteld op ${timecode(at)}. Het videobestand blijft ongewijzigd.`, 'success');
      refresh();
    } catch (err) { toast(err.message, 'error'); restore(); }
  };
  const resetFrame = async (btn) => {
    const restore = busy(btn);
    try { await api('DELETE', `/api/versions/${version.id}/poster`); toast('Thumbnail staat weer op automatisch', 'success'); refresh(); } catch (err) { toast(err.message, 'error'); restore(); }
  };
  const row = (label, value) => h('div', { class: 'info-row' }, h('dt', {}, label), h('dd', {}, value));
  return h('div', { class: 'info-props' },
    h('dl', { class: 'info-list' },
      row('Oplevering', deliveryMeta(video, may('upload'))),
      row('Afgesproken rondes', video.roundsIncluded?.count ? `${video.roundsIncluded.count} ${video.roundsIncluded.source === 'video' ? '(voor deze video)' : '(projectstandaard)'}` : h('span', { class: 'muted' }, 'niet ingesteld')),
      row('Oorspronkelijke naam', h('span', { class: 'info-filename', title: 'Deze naam krijgt het bestand bij downloaden, ook als je de titel wijzigt.' }, f.originalFilename)),
      row('Bestand', [f.extension.toUpperCase(), formatBytes(f.size), version.width ? `${version.width}×${version.height}` : null, version.duration ? timecode(version.duration) : null].filter(Boolean).join(' · ')),
      row('Geüpload', formatDate(version.createdAt))),
    h('div', { class: 'info-thumb' },
      posterImgEl,
      h('div', { class: 'info-thumb-text' },
        h('strong', {}, 'Thumbnail'),
        h('p', { class: 'small muted' }, f.customPoster ? `Zelf gekozen frame op ${timecode(f.customPosterTime)} van versie ${version.number}.` : 'Automatisch gekozen frame.'),
        may('upload') ? h('div', { class: 'info-thumb-actions' },
          button('Huidig frame gebruiken', { size: 'sm', icon: 'image', title: 'Pauzeer de video op het gewenste beeld', onClick: (e) => setFrame(e.currentTarget) }),
          f.customPoster ? button('Automatisch', { size: 'sm', variant: 'ghost', onClick: (e) => resetFrame(e.currentTarget) }) : null) : null)));
}

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

// ---------- Versies vergelijken (team) ----------

async function viewCompare(id) {
  const video = await api('GET', `/api/videos/${id}`);
  document.title = `Vergelijken: ${video.title} — Studio Review`;
  refreshSidebar(video.project.id);
  const params = new URLSearchParams(location.search);
  const versions = video.versions.map((v) => ({
    id: v.id, number: v.number, label: `Versie ${v.number}`,
    sub: `${STATUS_LABELS[v.status]} · ${v.isClientVersion ? 'klant ziet deze' : v.sharedAt ? 'gepubliceerd' : 'intern, niet gepubliceerd'}${v.roundNumber ? ` · ronde ${v.roundNumber}` : ''}`,
    src: `/api/versions/${v.id}/media`, poster: v.hasPoster ? `/api/versions/${v.id}/poster` : undefined, duration: v.duration,
  }));
  if (versions.length < 2) throw Object.assign(new Error('Deze video heeft maar één versie; er valt nog niets te vergelijken.'), { status: 404 });
  const cmp = createCompare({
    versions, a: Number(params.get('a')), b: Number(params.get('b')),
    onChange: ({ a, b }) => history.replaceState(null, '', `${location.pathname}?a=${a}&b=${b}`),
  });
  mount(pageEl, h('div', { class: 'page page-wide' },
    pageHeader({
      crumbs: [{ label: 'Projecten', href: '/projecten' }, { label: video.project.name, href: `/projecten/${video.project.id}` }, { label: video.title, href: `/video/${video.id}` }],
      title: 'Versies vergelijken',
      meta: [h('span', {}, video.title), h('span', { class: 'muted' }, 'Alleen-lezen: reageren doe je in de werkplek')],
      actions: [h('a', { class: 'btn btn-secondary', href: `/video/${video.id}`, 'data-nav': true }, icon('arrowLeft'), h('span', { class: 'btn-label' }, 'Terug naar de werkplek'))],
    }),
    cmp.el));
  cleanup = () => cmp.destroy();
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
  }
  if (version.status === 'approved') {
    const delivered = video.delivery?.versionId === version.id;
    text = version.releasable
      ? [h('strong', {}, `Goedgekeurd door ${version.approval.name}`), ` op ${formatDate(version.approval.at)}. Deze goedkeuring geldt alleen voor Versie ${version.number}.`,
        delivered ? (video.delivery.available ? ' Deze versie is definitief opgeleverd.' : ' De oplevering is geblokkeerd.') : ' Nog niet definitief vrijgegeven.']
      : version.approval
        ? [h('strong', {}, 'Goedkeuring niet meer geldig. '), version.releaseProblem]
        : [h('strong', {}, 'Handmatig op Goedgekeurd gezet.'), ' Er is geen klantgoedkeuring vastgelegd voor deze versie, dus definitief vrijgeven kan niet.'];
    actions = version.releasable && may('publish') && !(delivered && video.delivery.available)
      ? [h('a', { class: 'btn btn-primary', href: `/projecten/${video.project.id}/oplevering?vrijgeven=${version.id}`, 'data-nav': true }, icon('package'), h('span', { class: 'btn-label' }, delivered ? 'Opnieuw vrijgeven…' : 'Definitief vrijgeven…'))]
      : delivered ? [h('a', { class: 'btn btn-secondary', href: `/projecten/${video.project.id}/oplevering`, 'data-nav': true }, icon('package'), h('span', { class: 'btn-label' }, 'Naar oplevering'))] : [];
    if (!isLatest) {
      text = [h('span', {}, `Oudere versie (intern nieuwste: Versie ${latest.number}). `), ...text];
      actions.push(button(`Naar Versie ${latest.number}`, { icon: 'arrowLeft', onClick: () => navigate(`/video/${video.id}`) }));
    }
  }
  return h('section', { class: `publish-bar is-${version.status}${isLatest ? '' : ' is-old'}`, 'aria-label': 'Status en volgende stap' },
    h('p', { class: 'publish-text' }, h('span', { class: 'publish-version' }, `Versie ${version.number}`), ' ', text),
    actions.length ? h('div', { class: 'publish-actions' }, actions) : null);
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

function moreMenu(video, version, { level, archived, refresh }) {
  const back = () => navigate(`/projecten/${video.project.id}`);
  const other = video.versions.find((v) => v.id !== version.id);
  const items = [
    can(level, 'upload') && !archived ? ['Nieuwe versie uploaden…', () => newVersionDialog(video), { icon: 'layers' }] : null,
    other ? ['Versies vergelijken', () => navigate(`/video/${video.id}/vergelijk?a=${other.id}&b=${version.id}`), { icon: 'compare' }] : null,
    ['Klantweergave bekijken', () => window.open(`/voorbeeld/video/${video.id}`, '_blank', 'noopener'), { icon: 'eye' }],
    [`Download Versie ${version.number}`, () => { location.href = `/api/versions/${version.id}/download`; }, { icon: 'download' }],
    ['Feedback exporteren…', () => exportDialog({ projectId: video.project.id, videos: [{ id: video.id, title: video.title }] }), { icon: 'fileDown' }],
    can(level, 'upload') && !archived ? ['Gegevens wijzigen…', () => detailsDialog(video), { icon: 'edit' }] : null,
    can(level, 'manage') && !archived ? [`Status van Versie ${version.number} corrigeren…`, () => statusDialog(video, version, refresh), { icon: 'flag' }] : null,
  ];
  if (can(level, 'manage')) {
    if (video.versions.length > 1) {
      items.push([`Versie ${version.number} naar prullenbak…`, () => moveToTrash('version', version.id, `${video.title} · versie ${version.number}`, () => navigate(`/video/${video.id}`),
        { deliveryWarning: video.delivery?.versionId === version.id ? 'Zolang deze versie in de prullenbak staat, kan de klant het bestand niet downloaden.' : null }), { icon: 'layers', danger: true }]);
    }
    items.push(archived
      ? ['Video uit archief halen', () => setArchived('video', video.id, video.title, false), { icon: 'refresh' }]
      : ['Video archiveren', () => setArchived('video', video.id, video.title, true), { icon: 'history' }]);
    items.push(['Video naar prullenbak…', () => moveToTrash('video', video.id, video.title, back,
      { deliveryWarning: video.delivery ? 'Zolang de video in de prullenbak staat, verdwijnt het bestand van de opleverpagina van de klant.' : null }), { icon: 'trash', danger: true }]);
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
          v.isClientVersion ? h('span', { class: 'badge badge-accent' }, icon('eye'), 'Klant ziet deze') : null,
          video.delivery?.versionId === v.id ? h('span', { class: `badge ${video.delivery.available ? 'badge-ok' : 'badge-warn'}` }, icon('package'), video.delivery.available ? 'Opgeleverd' : 'Oplevering geblokkeerd') : null),
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

async function statusDialog(video, version, refresh) {
  // Een correctie geldt alleen voor precies deze versie; laat zien wat dat betekent voor goedkeuring en oplevering.
  const delivered = video.delivery && video.delivery.versionId === version.id;
  const otherDelivery = video.delivery && video.delivery.versionId !== version.id ? video.delivery : null;
  const impact = h('div', { class: 'status-impact' });
  const drawImpact = () => {
    const to = select.value;
    const notes = [];
    if (version.releasable && to !== 'approved') {
      notes.push(h('div', { class: 'notice notice-warn' }, icon('alert'), h('span', {}, h('strong', {}, `Dit trekt de goedkeuring van ${version.approval.name} voor Versie ${version.number} in. `),
        delivered ? 'De definitieve oplevering van deze versie wordt geblokkeerd: nieuwe downloads zijn niet meer mogelijk. ' : '',
        'Terugzetten op Goedgekeurd herstelt dat niet; daarvoor is een nieuwe goedkeuring door de akkoordgever nodig (en daarna opnieuw vrijgeven).')));
    }
    if (to === 'approved' && !version.releasable) {
      notes.push(h('div', { class: 'notice notice-info' }, icon('info'), h('span', {}, 'Een handmatige “Goedgekeurd” is alleen een label: het telt niet als klantgoedkeuring en maakt definitief vrijgeven niet mogelijk.')));
    }
    if (otherDelivery) {
      notes.push(h('p', { class: 'small muted' }, icon('package'), ` De definitieve oplevering is Versie ${otherDelivery.versionNumber}. Die verandert niet door een correctie op Versie ${version.number}.`));
    }
    mount(impact, notes);
  };
  const select = h('select', { 'aria-label': 'Nieuwe status', required: true },
    Object.entries(STATUS_LABELS).map(([k, label]) => h('option', { value: k, disabled: k === version.status }, `${label}${k === version.status ? ' (huidig)' : ''}`)));
  select.value = Object.keys(STATUS_LABELS).find((k) => k !== version.status);
  const reason = h('textarea', { rows: '2', required: true, maxlength: '500', placeholder: 'Bijv. “Klant gaf telefonisch akkoord”' });
  select.addEventListener('change', drawImpact);
  drawImpact();
  await openDialog({
    title: `Status van Versie ${version.number} van “${video.title}” corrigeren`,
    body: [
      h('p', {}, 'Gebruik dit alleen om een fout te herstellen. De wijziging geldt ', h('strong', {}, `alleen voor Versie ${version.number}`), ' (huidige status: ', STATUS_LABELS[version.status], ') en wordt met jouw naam, tijdstip en reden in de geschiedenis van die versie bewaard. Andere versies en hun goedkeuringen blijven ongewijzigd.'),
      field('Nieuwe status', select),
      impact,
      field('Reden (verplicht)', reason),
      h('p', { class: 'small muted' }, 'Een handmatige “Goedgekeurd” is geen goedkeuring door de akkoordgever. Zichtbaarheid voor de klant verandert hier niet; delen doe je met “Publiceren naar klant”.'),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Status opslaan'))],
    onSubmit: async () => {
      try {
        await api('POST', `/api/versions/${version.id}/status`, { status: select.value, note: reason.value });
        toast(`Status van Versie ${version.number} gecorrigeerd naar ${STATUS_LABELS[select.value]}`, 'success');
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
      protectionBadges(link.protection),
      h('span', { class: 'small muted link-used' }, link.lastUsedAt ? `geopend ${relativeDate(link.lastUsedAt)}` : 'nog niet geopend')),
    h('div', { class: 'link-copy' },
      h('input', { type: 'text', readonly: true, value: link.url, class: 'link-url', 'aria-label': 'Deel-link', onFocus: (e) => e.target.select() }),
      button('Kopiëren', { icon: 'copy', size: 'sm', onClick: async () => { await copyText(link.url); toast('Link gekopieerd', 'success'); } }),
      button('', { icon: 'trash', size: 'sm', variant: 'ghost', 'aria-label': 'Link intrekken', title: 'Intrekken', onClick: async () => {
        const ok = await confirmDialog({ title: 'Link intrekken?', body: 'Wie deze link heeft, krijgt direct geen toegang meer, ook niet tot het videobestand. Reacties en goedkeuringen blijven bewaard.', confirmLabel: 'Intrekken', danger: true });
        if (!ok) return;
        try { await api('POST', `/api/links/${link.id}/revoke`); toast('Link ingetrokken', 'success'); dialogDone(); } catch (err) { toast(err.message, 'error'); }
      } })),
    h('div', { class: 'link-row-foot' }, protectionButton('share', link, dialogDone)));

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
        h('div', { class: 'link-row-head' }, h('strong', {}, 'Projectlink'), protectionBadges(l.protection), h('span', { class: 'small muted link-used' }, l.lastUsedAt ? `geopend ${relativeDate(l.lastUsedAt)}` : 'nog niet geopend')),
        h('div', { class: 'link-copy' },
          h('input', { type: 'text', readonly: true, value: l.url, class: 'link-url', 'aria-label': 'Projectlink', onFocus: (e) => e.target.select() }),
          button('Kopiëren', { icon: 'copy', size: 'sm', onClick: async () => { await copyText(l.url); toast('Projectlink gekopieerd', 'success'); } }),
          h('a', { class: 'btn btn-sm btn-ghost', href: l.url, target: '_blank', rel: 'noopener', title: 'Openen als klant (nieuw tabblad)' }, icon('external'), h('span', { class: 'visually-hidden' }, 'Openen')))),
      localNote, facts,
      h('div', { class: 'portal-actions' }, previewLink(project), h('span', { class: 'spacer' }), protectionButton('project', l, draw), replace, revoke),
      h('p', { class: 'small muted' }, `Gemaakt ${formatDate(l.createdAt)}. Intrekken of vervangen raakt de afzonderlijke review- en akkoordlinks per video niet${st.separateVideoLinks ? ` (nu ${st.separateVideoLinks} actief)` : ''}.`));
  }
  draw();
  await done;
}

const previewLink = (project) => h('a', { class: 'btn btn-sm btn-secondary', href: `/voorbeeld/project/${project.id}`, target: '_blank', rel: 'noopener' }, icon('eye'), h('span', { class: 'btn-label' }, 'Bekijk als klant'));

// Uploads die klaar zijn, verversen het zijbalkoverzicht.
onUploadsChange((all) => { if (all.some((i) => i.state === 'done' && !i.counted)) { all.forEach((i) => { if (i.state === 'done') i.counted = true; }); refreshSidebar(); } });

route();
