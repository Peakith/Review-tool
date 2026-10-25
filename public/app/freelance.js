// Freelanceromgeving: strikt alleen-lezen. Gekoppelde projecten, verstuurde klantfeedback en de
// eigen inbox. Geen knoppen om te reageren, uploaden, wijzigen, publiceren of downloaden; de server
// weigert dat ook (alle andere teamroutes zijn voor freelanceraccounts dicht).
import { h, mount, icon, button, api, emptyState, errorState, formatDateZone, relativeDate, plural, timecode, toast, busy } from '/shared/util.js';
import { createPlayer } from '/shared/player.js';
import { renderComments, markersFrom } from '/shared/comments.js';
import { THEMES, themePref } from '/shared/theme.js';
import { saveTheme } from './settings.js';
import { viewInbox, startInboxPolling, refreshInboxCount } from './inbox.js';
import { openPalette, paletteShortcut } from './palette.js';

let shell = null;
let pageEl = null;
let session = null;
let nav = null;
let leaveHook = () => {};

/** Einddatum van de toegang, altijd met tijdzone. */
const expiryText = (p) => (p.expiresAt ? `Toegang tot ${formatDateZone(p.expiresAt)}` : null);

/** Melding als de toegang intussen is verlopen of ingetrokken (bij verversen of het volgende verzoek). */
function accessError(err, retry) {
  const expired = err.data?.code === 'access_expired';
  const gone = err.status === 404;
  if (!expired && !gone) return errorState(err, retry);
  return emptyState({
    icon: 'lock',
    title: expired ? 'Je toegang tot dit project is verlopen' : 'Geen toegang (meer)',
    text: expired ? 'Vraag de projectleider om je toegang te verlengen.' : 'Dit project of deze video is niet (meer) voor je beschikbaar.',
    action: button('Naar mijn projecten', { variant: 'primary', onClick: () => nav('/') }),
  });
}

export async function routeFreelance({ root, session: s, navigate, pageHeader, logout }) {
  session = s;
  nav = navigate;
  leaveHook();
  leaveHook = () => {};
  if (!shell || !root.contains(shell)) buildShell(root, logout);
  const path = location.pathname;
  let m;
  const views = [
    [/^\/$/, () => viewStart(pageHeader), 'home'],
    [/^\/projecten\/(\d+)$/, (id) => viewProject(Number(id), pageHeader), 'home'],
    [/^\/video\/(\d+)$/, (id) => viewVideo(Number(id), pageHeader), 'home'],
    [/^\/inbox$/, () => viewInbox({ session, pageEl, pageHeader, navigate, refresh: () => navigate(location.pathname) }), 'inbox'],
    [/^\/account$/, () => viewAccount(pageHeader, logout), 'account'],
  ];
  const match = views.find(([re]) => (m = path.match(re)));
  shell.querySelectorAll('.side-nav a').forEach((a) => a.classList.toggle('is-active', !!match && a.dataset.section === match[2]));
  mount(pageEl, h('div', { class: 'loading-page' }, h('div', { class: 'spinner', role: 'status', 'aria-label': 'Laden' })));
  if (!match) {
    mount(pageEl, h('div', { class: 'page' }, pageHeader({ title: 'Niet beschikbaar' }),
      emptyState({ icon: 'lock', title: 'Deze pagina is niet beschikbaar in je rol', text: 'Als freelancer kun je klantfeedback bekijken in de projecten waaraan je bent gekoppeld.', action: button('Naar mijn projecten', { variant: 'primary', onClick: () => navigate('/') }) })));
    return;
  }
  try {
    await match[1](...m.slice(1));
  } catch (err) {
    if (err.status === 401) throw err;
    mount(pageEl, h('div', { class: 'page' }, accessError(err, () => navigate(location.pathname))));
  }
  refreshInboxCount();
  pageEl.focus({ preventScroll: true });
}

function buildShell(root, logout) {
  const link = (href, section, iconName, label, extra) => h('a', { href, 'data-nav': true, dataset: { section } }, icon(iconName), h('span', { class: 'nav-label' }, label), extra);
  pageEl = h('main', { class: 'page-host', id: 'main', tabindex: '-1' });
  const menuBtn = button('', { icon: 'grid', variant: 'ghost', 'aria-label': 'Menu', class: 'btn btn-ghost btn-icon menu-btn', onClick: () => shell.classList.toggle('nav-open') });
  shell = h('div', { class: 'app is-freelance' },
    h('a', { class: 'skip-link', href: '#main' }, 'Naar inhoud'),
    h('aside', { class: 'sidebar' },
      h('div', { class: 'side-top' }, h('a', { href: '/', 'data-nav': true, class: 'brand' }, h('span', { class: 'brand-mark' }, icon('play')), h('span', {}, 'Studio Review')), menuBtn),
      h('div', { class: 'side-scroll' },
        h('p', { class: 'side-role small' }, icon('eye'), 'Freelancer · alleen bekijken'),
        h('button', { type: 'button', class: 'side-palette', onClick: () => openPalette(), 'aria-keyshortcuts': 'Meta+K Control+K' }, icon('command'), h('span', { class: 'side-palette-label' }, 'Zoeken'), h('kbd', { class: 'side-kbd' }, paletteShortcut())),
        h('nav', { class: 'side-nav', 'aria-label': 'Hoofdmenu' },
          link('/', 'home', 'folder', 'Mijn projecten'),
          link('/inbox', 'inbox', 'inbox', 'Inbox', h('span', { class: 'side-count', id: 'inbox-count', hidden: true, 'aria-label': 'ongelezen' })))),
      h('div', { class: 'side-foot' },
        h('nav', { class: 'side-nav', 'aria-label': 'Account' }, link('/account', 'account', 'users', 'Mijn account')),
        h('div', { class: 'side-user' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, session.user.name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')),
          h('span', { class: 'side-user-text' }, h('span', { class: 'truncate' }, session.user.name), h('span', { class: 'truncate small muted' }, session.user.email))),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm side-logout', onClick: logout }, icon('logout'), h('span', { class: 'btn-label' }, 'Uitloggen')))),
    h('div', { class: 'main-col' }, pageEl));
  shell.addEventListener('click', (e) => { if (e.target.closest('.side-nav a')) shell.classList.remove('nav-open'); });
  mount(root, shell);
  startInboxPolling();
}

async function viewStart(pageHeader) {
  document.title = 'Mijn projecten — Studio Review';
  const [{ projects }, inbox] = await Promise.all([api('GET', '/api/freelance/overview'), api('GET', '/api/inbox?filter=unread').catch(() => ({ items: [] }))]);
  const total = projects.reduce((n, p) => n + p.feedback, 0);
  mount(pageEl, h('div', { class: 'page page-narrow' },
    pageHeader({ title: 'Klantfeedback', meta: [h('span', {}, projects.length ? `${plural(projects.length, 'project', 'projecten')} · ${plural(total, 'klantreactie', 'klantreacties')}` : 'Nog geen projecten')] }),
    h('p', { class: 'lede muted' }, 'Je kijkt mee met wat klanten terugsturen: tijdcodes, fragmenten en tekeningen. Reageren, uploaden en wijzigen doet het team.'),
    projects.length
      ? h('section', { class: 'card', 'aria-labelledby': 'fl-projects' }, h('h2', { class: 'card-title', id: 'fl-projects' }, 'Projecten'),
        h('div', { class: 'row-list' }, projects.map((p) => h('a', { class: 'list-row', href: `/projecten/${p.id}`, 'data-nav': true },
          h('span', { class: 'list-row-main' },
            h('strong', { class: 'list-row-title' }, p.name),
            h('span', { class: 'small muted' }, [p.clientName, plural(p.videoCount, 'video', 'video’s'), p.archived ? 'gearchiveerd' : null].filter(Boolean).join(' · '))),
          p.expiresAt ? h('span', { class: 'list-row-note small', title: 'Je toegang tot dit project stopt automatisch op dit moment' }, icon('clock'), expiryText(p)) : null,
          h('span', { class: 'list-row-count' }, icon('chat'), String(p.feedback)),
          icon('chevronRight')))))
      : h('div', { class: 'card' }, emptyState({ icon: 'folder', title: 'Nog geen projecten', text: 'Zodra een projectleider je aan een project koppelt, zie je het hier.' })),
    h('section', { class: 'card', 'aria-labelledby': 'fl-inbox' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'fl-inbox' }, 'Nieuw in je inbox'), h('a', { href: '/inbox', 'data-nav': true, class: 'btn btn-sm btn-ghost' }, h('span', { class: 'btn-label' }, 'Alle meldingen'))),
      inbox.items.length
        ? h('div', { class: 'row-list' }, inbox.items.slice(0, 5).map((n) => h('a', { class: 'list-row', href: n.href, onClick: async (e) => {
          e.preventDefault();
          try { const r = await api('POST', `/api/inbox/${n.id}/open`); nav(r.href); } catch (err) { toast(err.message, 'error'); }
        } }, h('span', { class: 'list-row-main' }, h('strong', { class: 'list-row-title' }, n.title), h('span', { class: 'small muted' }, `${n.project} · ${relativeDate(n.createdAt)}`)), icon('chevronRight'))))
        : h('p', { class: 'muted small' }, 'Geen nieuwe meldingen.'))));
}

async function viewProject(id, pageHeader) {
  const { project, videos } = await api('GET', `/api/freelance/projects/${id}`);
  document.title = `${project.name} — Studio Review`;
  mount(pageEl, h('div', { class: 'page page-narrow' },
    pageHeader({
      crumbs: [{ label: 'Mijn projecten', href: '/' }],
      title: h('h1', { class: 'page-title' }, project.name),
      meta: [project.clientName ? h('span', {}, project.clientName) : null, project.expiresAt ? h('span', { class: 'meta-item' }, icon('clock'), expiryText(project)) : null],
    }),
    videos.length
      ? h('div', { class: 'video-list', role: 'list' }, videos.map((v) => h('a', { class: 'video-row', role: 'listitem', href: `/video/${v.id}`, 'data-nav': true },
        h('span', { class: 'thumb' }, v.version.posterUrl ? h('img', { src: v.version.posterUrl, alt: '', loading: 'lazy' }) : h('span', { class: 'poster-empty' }, icon('film')),
          v.version.duration ? h('span', { class: 'thumb-duration' }, timecode(v.version.duration)) : null),
        h('span', { class: 'video-row-main' },
          h('span', { class: 'video-row-title' }, v.title),
          h('span', { class: 'video-versions' }, h('span', { class: 'ver-chip' }, `Klant ziet v${v.version.number}`), h('span', { class: 'ver-chip' }, icon('chat'), plural(v.feedback, 'klantreactie', 'klantreacties')))),
        icon('chevronRight'))))
      : h('div', { class: 'card' }, emptyState({ icon: 'film', title: 'Nog niets gepubliceerd', text: 'Zodra het team een video met de klant deelt, zie je hier de feedback.' }))));
}

async function viewVideo(id, pageHeader) {
  const wanted = new URLSearchParams(location.search).get('v');
  const d = await api('GET', `/api/freelance/videos/${id}${wanted ? `?v=${encodeURIComponent(wanted)}` : ''}`);
  document.title = `${d.video.title} — Studio Review`;
  const base = `/api/freelance/versions/${d.version.id}/hls`;
  const player = createPlayer({
    poster: d.version.posterUrl || undefined,
    duration: d.version.duration,
    hls: d.playback.levels.length ? { master: `${base}/master.m3u8`, levels: d.playback.levels, levelPlaylist: (l) => `${base}/${l}/index.m3u8`, levelFile: (l) => `${base}/${l}/seg.m4s` } : null,
    unavailable: d.playback.levels.length ? null : (d.playback.failed ? 'Deze video kan nu niet worden afgespeeld.' : 'De afspeelversie wordt nog voorbereid. Ververs de pagina over een paar minuten.'),
  });
  leaveHook = () => player.destroy?.();
  const list = h('div', { class: 'panel-scroll' });
  let active = null;
  const draw = () => renderComments(list, d.comments, {
    mode: 'read', canWrite: false, activeId: active,
    onSeek: (t, cid, c) => { player.seek(t); active = cid; player.showAnnotation?.(c?.annotation || null); draw(); },
    onPlayRange: (start, end, cid) => { active = cid; player.showAnnotation?.(null); player.playRange?.(start, end); draw(); },
  });
  player.setMarkers(markersFrom(d.comments, null));
  player.onMarkerClick((cid) => { active = cid; player.showAnnotation?.(d.comments.find((c) => c.id === cid)?.annotation || null); draw(); document.getElementById(`comment-${cid}`)?.scrollIntoView({ block: 'nearest' }); });
  draw();
  const versionSelect = d.versions.length > 1 ? h('select', { class: 'version-select', 'aria-label': 'Versie', onChange: (e) => nav(`/video/${id}?v=${e.target.value}`) },
    d.versions.map((v) => h('option', { value: v.id, selected: v.id === d.version.id }, `Versie ${v.number} · ${plural(v.feedback, 'klantreactie', 'klantreacties')}`))) : null;
  mount(pageEl, h('div', { class: 'workspace' },
    pageHeader({
      crumbs: [{ label: 'Mijn projecten', href: '/' }, { label: d.project.name, href: `/projecten/${d.project.id}` }],
      title: h('h1', { class: 'page-title', title: d.video.title }, d.video.title),
      meta: [h('span', {}, `Versie ${d.version.number} (gepubliceerd)`), d.project.expiresAt ? h('span', { class: 'meta-item' }, icon('clock'), expiryText(d.project)) : null],
      actions: versionSelect ? [versionSelect] : null,
    }),
    h('div', { class: 'workspace-grid' },
      h('div', { class: 'stage' }, player.el),
      h('aside', { class: 'side-panel', 'aria-label': 'Klantfeedback' },
        h('div', { class: 'tabs', role: 'presentation' }, h('span', { class: 'tab-static' }, 'Klantfeedback', h('span', { class: 'tab-count' }, String(d.comments.length)))),
        list,
        h('p', { class: 'panel-note small muted' }, icon('eye'), 'Alleen bekijken. Vragen over de feedback? Neem contact op met de projectleider.')))));
}

async function viewAccount(pageHeader, logout) {
  document.title = 'Mijn account — Studio Review';
  const pw = h('input', { type: 'password', id: 'fl-pw', autocomplete: 'new-password', minlength: '10', required: true });
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, h('span', { class: 'btn-label' }, 'Wachtwoord wijzigen'));
  const themes = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Thema' });
  const drawThemes = () => mount(themes, THEMES.map(([key, label]) => h('button', { type: 'button', 'aria-pressed': String(themePref() === key), onClick: async () => { await saveTheme(key); drawThemes(); } }, label)));
  drawThemes();
  mount(pageEl, h('div', { class: 'page page-narrow' },
    pageHeader({ title: 'Mijn account', meta: [h('span', {}, session.user.email)] }),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Thema'), themes),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Wachtwoord'),
      h('form', { class: 'stack-form', onSubmit: async (e) => {
        e.preventDefault();
        const restore = busy(save);
        try {
          await api('POST', `/api/users/${session.user.id}/password`, { password: pw.value });
          toast('Wachtwoord gewijzigd. Log opnieuw in.', 'success');
          logout();
        } catch (err) { toast(err.message, 'error'); restore(); }
      } }, h('label', { class: 'field-label', for: 'fl-pw' }, 'Nieuw wachtwoord (minstens 10 tekens)'), pw, h('div', {}, save)))));
}
