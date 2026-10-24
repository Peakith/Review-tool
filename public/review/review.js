import {
  h, mount, icon, button, api, apiWithRetry, newRequestId, toast, openDialog, field,
  formatDate, formatDateZone, plural, draftStore, formatDeadline, isPast,
} from '/shared/util.js';
import { tr } from '/shared/i18n.js';
import { initLang, langToggle, linkError, fatal as showFatal, expiryNote } from '/review/gate.js';
import { createPlayer } from '/shared/player.js';
import { renderComments, markersFrom } from '/shared/comments.js';
import { createComposer } from '/shared/composer.js';
import { applyBrand, brandMark } from '/shared/brand.js';
import { clientPill, metaLine } from '/shared/client.js';
import { createCompare } from '/shared/compare.js';

const token = location.pathname.split('/').filter(Boolean).pop();
// /voorbeeld/video/<id>: het team bekijkt deze pagina precies zoals de klant, alleen-lezen.
const preview = location.pathname.startsWith('/voorbeeld/');
const base = preview ? `/api/preview/videos/${encodeURIComponent(token)}` : `/api/review/${encodeURIComponent(token)}`;
const urls = {
  comments: (vid) => `${base}/versions/${vid}/comments`,
  media: (vid) => (preview ? `/api/versions/${vid}/media` : `${base}/versions/${vid}/media`),
  poster: (vid) => (preview ? `/api/versions/${vid}/poster` : `${base}/versions/${vid}/poster`),
  hls: (vid) => (preview ? `/api/versions/${vid}/hls` : `${base}/versions/${vid}/hls`),
};

/**
 * Hoe deze versie wordt afgespeeld: via afspeelversies (kwaliteitskeuze), of het origineel als
 * downloaden voor deze link mag en de afspeelversies er nog niet zijn. Zonder downloadrecht is er
 * nooit een terugval naar het origineel.
 */
function playbackFor(v) {
  const pb = v.playback || { levels: [], original: true };
  const h_ = urls.hls(v.id);
  const hls = pb.levels.length ? {
    master: `${h_}/master.m3u8`, levels: pb.levels,
    levelPlaylist: (l) => `${h_}/${l}/index.m3u8`, levelFile: (l) => `${h_}/${l}/seg.m4s`,
  } : null;
  const src = !hls && pb.original ? urls.media(v.id) : null;
  let unavailable = null;
  if (!hls && !src) {
    unavailable = pb.failed
      ? tr('Deze video kan op dit moment niet worden afgespeeld. Neem contact op met het productieteam.')
      : tr('Deze video wordt voorbereid om af te spelen ({p}%). Deze pagina werkt zichzelf bij.', { p: Math.round((pb.progress || 0) * 100) });
  }
  return { hls, src, unavailable, waiting: !hls && !src && !pb.failed };
}
/** Bestand voor de vergelijkweergave: origineel als dat mag, anders een afspeelversie (max. 1080p). */
function compareSrc(v) {
  const pb = v.playback || { levels: [], original: true };
  if (pb.original) return urls.media(v.id);
  const lvl = pb.levels.find((l) => l.level <= 1080) || pb.levels.at(-1);
  return lvl ? `${urls.hls(v.id)}/${lvl.level}/seg.m4s` : '';
}
const root = document.getElementById('root');

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* privémodus */ } },
};

// Anonieme sleutel om "mijn" nog niet verstuurde reacties te groeperen.
let reviewerKey = store.get('rt-reviewer-key');
if (!reviewerKey || !/^[A-Za-z0-9_-]{16,64}$/.test(reviewerKey)) {
  reviewerKey = newRequestId();
  store.set('rt-reviewer-key', reviewerKey);
}
const keyHeader = { 'x-reviewer-key': reviewerKey };

const state = { info: null, version: null, comments: [], activeId: null, player: null, composer: null, justSent: null };

const fatal = (title, message, iconName, retry) => showFatal(root, title, message, iconName, retry);

async function load(versionId) {
  if (!state.info) mount(root, h('div', { class: 'fatal' }, h('div', { class: 'spinner', role: 'status', 'aria-label': tr('Laden') })));
  try {
    state.info = await api('GET', base);
  } catch (err) {
    if (preview && err.status === 401) return fatal('Log eerst in', 'Deze voorbeeldweergave is alleen voor teamleden. Log in en open het voorbeeld opnieuw vanuit de video.', 'lock');
    if (!preview && linkError(root, err, { kind: 'share', token, onUnlocked: () => load(versionId), retry: () => load(versionId) })) return;
    return fatal(tr('Laden lukt niet'), err.message, 'alert', () => load(versionId));
  }
  initLang(state.info.language);
  applyBrand(state.info.brand);
  document.title = `${state.info.title} · ${state.info.brand?.name || 'Review'}`;
  if (!state.info.versions.length) {
    return fatal(state.info.title, preview
      ? 'Van deze video is nog geen versie gepubliceerd. De klant ziet nu alleen een wachtmelding (en de video staat niet in het portaal).'
      : tr('Er staat nog geen versie voor je klaar. Je kunt deze link bewaren: zodra het team een versie deelt, zie je die hier.'), 'clock', () => load());
  }
  const wanted = state.info.versions.find((v) => v.id === versionId) || state.info.versions[0];
  await showVersion(wanted);
}

async function showVersion(version) {
  if (state.version && version.id !== state.version.id) state.justSent = null;
  state.version = version;
  state.activeId = null;
  state.player?.destroy();
  state.composer?.destroy();
  try {
    state.comments = await api('GET', urls.comments(version.id), undefined, keyHeader);
  } catch (err) {
    if (err.status === 410) return load();
    state.comments = [];
    toast(`${err.message}`, 'error');
  }
  render();
}

async function refreshComments() {
  state.comments = await api('GET', urls.comments(state.version.id), undefined, keyHeader);
  drawComments();
}

const isApprover = () => state.info.role === 'approver';
const canAct = () => !preview && !state.info.archived && state.version.isLatest && ['in_review', 'changes_requested'].includes(state.version.status);
const myPending = () => {
  let n = 0;
  const walk = (list) => list.forEach((c) => { if (c.mine && c.pending) n++; walk(c.replies || []); });
  walk(state.comments);
  return n;
};

/** In gewone taal: wat betekent de status van deze versie voor de klant? */
function clientStatus(v) {
  if (state.info.archived) return { cls: 'is-closed', icon: 'history', title: tr('Afgerond en gearchiveerd'), text: tr('Je kunt de video nog bekijken, maar reageren en goedkeuren is niet meer mogelijk.') };
  if (!v.isLatest) return { cls: 'is-old', icon: 'history', title: tr('Oudere versie'), text: tr('Alleen om terug te kijken. Reageren en goedkeuren kan op de nieuwste versie.') };
  if (v.status === 'approved' && v.approval && !v.approval.revoked) return { cls: 'is-approved', icon: 'checkCircle', title: tr('Goedgekeurd'), text: tr('Goedgekeurd door {name} op {date}.', { name: v.approval.name, date: formatDateZone(v.approval.at) }) };
  if (v.status === 'approved') return { cls: 'is-approved', icon: 'checkCircle', title: tr('Goedgekeurd'), text: tr('Deze versie is goedgekeurd.') };
  if (v.status === 'changes_requested') return { cls: 'is-changes', icon: 'send', title: tr('Feedback verstuurd'), text: isApprover() ? tr('Het team past de video aan. Je kunt nog aanvullen of deze versie alsnog goedkeuren.') : tr('Het team past de video aan. Je kunt nog aanvullen.') };
  if (v.status === 'in_review') return { cls: 'is-review', icon: 'eye', title: tr('Klaar voor jouw review'), text: isApprover() ? tr('Plaats reacties en verstuur je feedback, of keur deze versie goed.') : tr('Plaats reacties en verstuur daarna je feedback.') };
  return { cls: 'is-closed', icon: 'lock', title: tr('Tijdelijk gesloten'), text: tr('Deze versie staat op dit moment niet open voor review.') };
}

/**
 * Het team heeft een eerdere goedkeuring van deze versie ingetrokken (statuscorrectie). Leg uit wat
 * dat betekent en wat er nu nodig is, zonder technische termen.
 */
function revokedApprovalNote(v) {
  const a = v.approval;
  if (!a?.revoked || !v.isLatest) return null;
  const who = state.info.approver?.name;
  const next = isApprover()
    ? tr('Bekijk de versie opnieuw. Klopt alles, keur hem dan opnieuw goed; zo niet, verstuur je feedback.')
    : who ? tr('Er is een nieuwe goedkeuring van {name} nodig.', { name: who }) : tr('Er is een nieuwe goedkeuring van de akkoordgever nodig.');
  return h('div', { class: 'notice notice-warn r-revoked', role: 'note' }, icon('alert'),
    h('div', {}, h('strong', {}, tr('Eerdere goedkeuring ingetrokken')),
      h('p', { class: 'small' }, tr('{name} keurde deze versie goed op {date}. Het productieteam heeft die goedkeuring daarna ingetrokken op {revoked}, bijvoorbeeld omdat er nog iets moest worden aangepast.', { name: a.name, date: formatDateZone(a.at), revoked: formatDateZone(a.revokedAt) })),
      h('p', { class: 'small' }, next)));
}

/** Nog niet geplaatste tekst of nog niet verstuurde reacties (om per ongeluk weggaan te voorkomen). */
function unsentInput() {
  const text = !!state.composer?.hasUnsent?.() || [...document.querySelectorAll('.reply-box:not([hidden]) textarea')].some((t) => t.value.trim());
  return { text, pending: state.info && state.version ? myPending() : 0 };
}

/** Naar een andere video of het overzicht: eerst vragen als er iets niet is verstuurd. */
async function leaveTo(href) {
  const u = unsentInput();
  if (!u.text && !u.pending) { location.href = href; return; }
  const ok = await openDialog({
    title: tr('Pagina verlaten?'),
    body: h('ul', { class: 'facts' },
      u.text ? h('li', {}, icon('chat'), h('span', {}, tr('Je hebt een reactie getypt die nog niet is geplaatst.'))) : null,
      u.pending ? h('li', {}, icon('clock'), h('span', {}, tr(u.pending === 1 ? '{n} reactie is nog niet als feedback verstuurd. Het team ziet die pas na “Feedback versturen”.' : '{n} reacties zijn nog niet als feedback verstuurd. Het team ziet die pas na “Feedback versturen”.', { n: u.pending }))) : null),
    actions: [h('button', { class: 'btn btn-primary', value: 'cancel', formnovalidate: true }, tr('Blijven')),
      h('button', { class: 'btn btn-ghost', value: 'ok' }, tr('Toch verlaten'))],
  });
  if (ok === 'ok') { leaving = true; location.href = href; }
}
let leaving = false;
window.addEventListener('beforeunload', (e) => {
  if (leaving || preview || !state.info) return;
  if (unsentInput().text) { e.preventDefault(); e.returnValue = ''; }
});

/** Vorige/volgende video binnen het portaal waaruit deze link komt. */
function navBar(nav) {
  if (!nav || preview) return null;
  const link = (item, dir) => (item
    ? h('a', { class: `r-nav-link is-${dir}`, href: item.href, onClick: (e) => { e.preventDefault(); leaveTo(item.href); } },
      dir === 'prev' ? icon('arrowLeft') : null,
      h('span', { class: 'r-nav-text' }, h('span', { class: 'small muted' }, dir === 'prev' ? tr('Vorige video') : tr('Volgende video')), h('span', { class: 'truncate' }, item.title)),
      dir === 'next' ? icon('arrowRight') : null)
    : h('span', { class: `r-nav-link is-${dir} is-empty`, 'aria-hidden': 'true' }));
  return h('nav', { class: 'r-nav', 'aria-label': tr('Andere video’s') },
    link(nav.prev, 'prev'),
    h('span', { class: 'r-nav-pos small muted' }, tr('Video {i} van {n}', { i: nav.index, n: nav.total })),
    link(nav.next, 'next'));
}

let commentsEl;
let composerRequest = null;
let actionsEl;
let nameInput;

function render() {
  const { info, version } = state;
  const latest = info.versions[0];
  const status = clientStatus(version);

  const pb = playbackFor(version);
  const player = createPlayer({
    src: pb.src,
    hls: pb.hls,
    unavailable: pb.unavailable,
    poster: version.hasPoster ? urls.poster(version.id) : undefined,
    duration: version.duration,
  });
  // Nog in voorbereiding: af en toe opnieuw kijken, zonder dat getypte tekst verloren gaat.
  if (pb.waiting) schedulePlaybackCheck(version.id);
  state.player = player;
  // Klantactiviteit: alleen de eerste keer afspelen per versie op deze pagina (niet in het teamvoorbeeld).
  if (!preview) {
    player.video.addEventListener('play', () => reportPlayback(version.id), { once: true });
  }
  player.onMarkerClick((id) => { selectComment(id, true); showDrawing(state.comments.find((c) => c.id === id)); });

  // ---- Kop: welke video en versie bekijk ik? ----
  const versionPicker = info.versions.length > 1
    ? h('label', { class: 'version-pick' }, h('span', { class: 'visually-hidden' }, tr('Kies versie')),
      h('select', { onChange: (e) => showVersion(info.versions.find((v) => v.id === Number(e.target.value))) },
        info.versions.map((v) => h('option', { value: v.id }, `${tr('Versie {n}', { n: v.number })}${v.isLatest ? ` · ${tr('nieuwste')}` : ''}`))))
    : null;
  if (versionPicker) versionPicker.querySelector('select').value = String(version.id);

  const meta = metaLine(info.meta);
  const header = h('header', { class: 'r-header' },
    h('div', { class: 'r-header-inner' },
      h('div', { class: 'r-titles' },
        h('div', { class: 'r-brand' }, brandMark(info.brand, { size: 'sm' }),
          info.portal ? h('a', { class: 'r-back', href: info.portal.url, onClick: (e) => { e.preventDefault(); leaveTo(info.portal.url); } }, icon('arrowLeft'), info.portal.url.startsWith('/k/') ? tr('Naar het overzicht') : tr('Alle video’s van dit project')) : null),
        h('div', { class: 'r-project truncate' }, [info.project.clientName, info.project.name].filter(Boolean).join(' · ')),
        h('h1', { title: info.title }, info.title),
        meta ? h('div', { class: 'r-meta-line' }, meta) : null),
      h('div', { class: 'r-version' },
        h('span', { class: 'version-chip' }, h('strong', {}, tr('Versie {n}', { n: version.number })), version.isLatest ? h('span', { class: 'version-latest' }, tr('nieuwste')) : h('span', { class: 'version-old' }, tr('van {n}', { n: latest.number }))),
        versionPicker,
        clientPill(version.status),
        preview ? null : langToggle(() => { const t = state.player?.video.currentTime || 0; render(); if (t) state.player.seek(t); }))),
    navBar(info.nav));

  // ---- Statusuitleg ----
  const statusCard = h('section', { class: `r-status ${status.cls}`, 'aria-live': 'polite' },
    icon(status.icon),
    h('div', {}, h('strong', {}, status.title), h('p', {}, status.text)),
    !version.isLatest ? button(tr('Naar Versie {n}', { n: latest.number }), { size: 'sm', onClick: () => showVersion(latest) }) : null);

  // ---- Ronde, deadline en wat er is aangepast (bij precies deze versie) ----
  const open = version.isLatest && ['in_review', 'changes_requested'].includes(version.status) && !info.archived;
  const r = version.round;
  const roundCard = r || version.changeNote ? h('section', { class: 'r-round', 'aria-label': tr('Reviewronde') },
    r ? h('div', { class: 'r-round-head' }, icon('history'), h('strong', {}, tr('Reviewronde {n}', { n: r.number })),
      r.deadline && open ? h('span', { class: isPast(r.deadline) ? 'r-deadline is-past' : 'r-deadline' }, tr('· graag je reactie vóór {date}', { date: formatDeadline(r.deadline) })) : null) : null,
    r?.deadline && open && isPast(r.deadline) ? h('p', { class: 'small' }, tr('Deze datum is verstreken. Je kunt nog steeds reageren en feedback versturen.')) : null,
    r?.note ? h('p', { class: 'r-round-note' }, r.note) : null,
    version.changeNote ? h('div', { class: 'r-change' }, h('strong', {}, tr('Aangepast in versie {n}', { n: version.number })), h('p', {}, version.changeNote)) : null) : null;

  // ---- Identiteit ----
  let identity;
  if (isApprover()) {
    identity = h('div', { class: 'identity is-verified' }, icon('shield'),
      h('div', {}, h('div', {}, tr('Je reviewt als '), h('strong', {}, info.identity.name)), h('div', { class: 'small' }, tr('Aangewezen akkoordgever · bevestigd via je persoonlijke link'))));
  } else {
    nameInput = h('input', {
      type: 'text', id: 'reviewer-name', autocomplete: 'name', maxlength: '80', placeholder: tr('Bijv. Eva Jansen'),
      value: store.get('rt-reviewer-name') || '',
      onInput: (e) => { store.set('rt-reviewer-name', e.target.value.trim()); e.target.classList.remove('input-error'); },
    });
    identity = h('div', { class: 'identity' },
      h('label', { for: 'reviewer-name', class: 'field-label' }, tr('Je naam')),
      nameInput,
      h('div', { class: 'field-hint' }, tr('Zichtbaar bij je reacties, als “opgegeven naam” (niet geverifieerd).')));
  }

  // ---- Reacties ----
  const composer = createComposer({
    player,
    draftKey: `review-draft-${token}-${version.id}`,
    placeholder: tr('Pauzeer op het juiste moment en typ hier je opmerking…'),
    onSubmit: async (body, timecode, { timecodeEnd, annotation } = {}) => {
      const authorName = reviewerName();
      if (authorName === null) return false;
      try {
        // Dezelfde request-id tot het lukt: opnieuw klikken na een fout plaatst de reactie niet dubbel.
        composerRequest ||= newRequestId();
        await apiWithRetry('POST', `${base}/versions/${version.id}/comments`, { body, timecode, timecodeEnd, annotation, authorName, requestId: composerRequest }, keyHeader);
        composerRequest = null;
        await refreshComments();
        toast(tr('Reactie geplaatst. Hij is nog niet verstuurd: klik op “Feedback versturen” als je klaar bent.'), 'success');
        return true;
      } catch (err) {
        toast(`${err.message} ${tr('Je tekst is bewaard.')}`, 'error');
        return false;
      }
    },
  });
  state.composer = composer;

  commentsEl = h('div', { class: 'r-comments' });
  actionsEl = h('div', { class: 'r-actions', role: 'region', 'aria-label': tr('Feedback versturen of goedkeuren') });

  const howTo = howToCard();
  const compareBtn = info.versions.length > 1
    ? button(tr('Versies vergelijken'), { icon: 'compare', size: 'sm', variant: 'ghost', onClick: () => showCompare(version) })
    : null;
  const exportLinks = !preview ? h('span', { class: 'r-export small' }, icon('fileDown'), tr('Feedback downloaden:'),
    h('a', { href: `${base}/export.pdf` }, 'PDF'), h('a', { href: `${base}/export.csv` }, 'CSV')) : null;
  const download = info.allowDownload
    ? h('a', { class: 'btn btn-sm btn-ghost', href: `${base}/versions/${version.id}/download` }, icon('download'), h('span', { class: 'btn-label' }, tr('Download')))
    : null;

  mount(root,
    preview ? h('div', { class: 'preview-bar', role: 'note' }, icon('eye'),
      h('span', {}, h('strong', {}, 'Voorbeeld: '), 'zo ziet de klant deze video via een reviewlink of het portaal. Interne notities en niet-gepubliceerde versies zijn verborgen; reageren is hier uitgeschakeld.'),
      h('a', { href: `/video/${info.preview.videoId}`, class: 'btn btn-sm btn-secondary' }, icon('arrowLeft'), h('span', { class: 'btn-label' }, 'Terug naar de werkplek'))) : null,
    header,
    h('main', { class: 'r-main' },
      h('section', { class: 'r-stage', 'aria-label': 'Video' }, player.el,
        h('div', { class: 'r-stage-foot small muted' },
          h('span', {}, tr('Je bekijkt Versie {n} van {total}', { n: version.number, total: latest.number }), version.sharedAt ? ` · ${tr('gedeeld {date}', { date: formatDate(version.sharedAt) })}` : ''),
          h('span', { class: 'r-stage-actions' }, compareBtn, exportLinks, download)),
        preview ? null : expiryNote(info.linkExpiresAt)),
      h('aside', { class: 'r-panel', 'aria-label': tr('Reacties') },
        statusCard,
        revokedApprovalNote(version),
        roundCard,
        state.justSent ? sentConfirmation() : null,
        canAct() ? howTo : null,
        canAct() ? identity : null,
        canAct() ? composer.el : null,
        h('div', { class: 'r-comments-head' }, h('h2', {}, tr('Reacties')), h('span', { class: 'small muted', id: 'comment-count' })),
        commentsEl)),
    canAct() ? actionsEl : null);
  drawComments();
}

const reportedPlayback = new Set();
function reportPlayback(versionId) {
  if (reportedPlayback.has(versionId)) return;
  reportedPlayback.add(versionId);
  const visitorName = isApprover() ? undefined : (store.get('rt-reviewer-name') || undefined);
  // Eén request-id: een herhaalpoging na een verbindingsfout telt niet dubbel. Mislukt het, dan niets doen.
  apiWithRetry('POST', `${base}/activity`, { type: 'playback_started', versionId, requestId: newRequestId(), visitorName }).catch(() => {});
}

function howToCard() {
  const collapsed = store.get('rt-howto-collapsed') === '1';
  const details = h('details', { class: 'howto', open: !collapsed },
    h('summary', {}, icon('info'), tr('Zo werkt het')),
    h('ol', {},
      h('li', {}, h('strong', {}, tr('Reageer op het juiste moment. ')), tr('Pauzeer de video en typ je opmerking; het tijdstip wordt automatisch gekoppeld.')),
      h('li', {}, h('strong', {}, tr('Verstuur je feedback. ')), tr('Je reacties zijn pas definitief voor het team als je op “Feedback versturen” klikt.')),
      isApprover()
        ? h('li', {}, h('strong', {}, tr('Akkoord? ')), tr('Klik op “Deze versie goedkeuren”. Je goedkeuring geldt alleen voor deze versie.'))
        : h('li', {}, state.info.approver ? tr('Goedkeuren doet {name} via een persoonlijke link.', { name: state.info.approver.name }) : tr('Goedkeuren doet de aangewezen akkoordgever via een persoonlijke link.'))));
  details.addEventListener('toggle', () => store.set('rt-howto-collapsed', details.open ? '0' : '1'));
  return details;
}

function sentConfirmation() {
  const s = state.justSent;
  return h('div', { class: 'notice notice-ok', role: 'status' }, icon('checkCircle'),
    h('div', {}, h('strong', {}, s.type === 'approved' ? tr('Versie {n} is goedgekeurd.', { n: s.number }) : tr('Je feedback is verstuurd.')),
      h('div', { class: 'small' }, s.type === 'approved' ? tr('Het team ziet je goedkeuring direct. Dank je wel!') : tr('{count} verstuurd op {date}. Het team gaat ermee aan de slag.', { count: plural(s.count, tr('reactie'), tr('reacties')), date: formatDate(s.at) }))));
}

function reviewerName() {
  if (isApprover()) return state.info.identity.name;
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.classList.add('input-error');
    nameInput.focus();
    toast(tr('Vul eerst je naam in, zodat het team weet van wie de feedback komt.'), 'error');
    return null;
  }
  return name;
}

function drawComments() {
  renderComments(commentsEl, state.comments, {
    mode: 'client',
    canWrite: canAct(),
    activeId: state.activeId,
    onSeek: (t, id, c) => { state.player.seek(t); selectComment(id, false); showDrawing(c); },
    onPlayRange: (start, end, id) => { selectComment(id, false); state.player.showAnnotation(null); state.player.playRange(start, end); },
    onReply: async (parentId, body) => {
      const authorName = reviewerName();
      if (authorName === null) return false;
      try {
        await apiWithRetry('POST', `${base}/versions/${state.version.id}/comments`, { body, parentId, authorName, requestId: newRequestId() }, keyHeader);
        await refreshComments();
        toast(tr('Antwoord geplaatst'), 'success');
        return true;
      } catch (err) { toast(`${err.message} ${tr('Je tekst is bewaard.')}`, 'error'); return false; }
    },
    onDelete: async (id) => {
      try {
        await api('DELETE', `${base}/comments/${id}`, undefined, keyHeader);
        await refreshComments();
        toast(tr('Reactie verwijderd'));
      } catch (err) { toast(err.message, 'error'); drawComments(); }
    },
  });
  state.player.setMarkers(markersFrom(state.comments, state.activeId));
  const countEl = document.getElementById('comment-count');
  if (countEl) countEl.textContent = state.comments.length ? plural(state.comments.length, tr('reactie'), tr('reacties')) : '';
  drawActions();
}

/** Onderbalk: feedback versturen en (alleen akkoordgever) goedkeuren. */
function drawActions() {
  if (!actionsEl || !canAct()) return;
  const n = myPending();
  const feedbackBtn = button(n ? tr('Feedback versturen ({n})', { n }) : tr('Feedback versturen'), { icon: 'send', variant: isApprover() ? 'secondary' : 'primary', size: 'lg', onClick: submitFeedback });
  const approveBtn = isApprover() ? button(tr('Deze versie goedkeuren'), { icon: 'checkCircle', variant: 'approve', size: 'lg', onClick: approve }) : null;
  const hint = n
    ? h('span', { class: 'r-actions-hint is-pending' }, icon('clock'), tr('{count} nog niet verstuurd', { count: plural(n, tr('reactie'), tr('reacties')) }))
    : h('span', { class: 'r-actions-hint' }, icon('info'), isApprover() ? tr('Klaar met kijken? Verstuur feedback of keur goed.') : state.info.approver ? tr('Goedkeuren gebeurt door {name}.', { name: state.info.approver.name }) : tr('Goedkeuren gebeurt door de akkoordgever.'));
  mount(actionsEl, h('div', { class: 'r-actions-inner' }, hint, h('div', { class: 'r-actions-buttons' }, feedbackBtn, approveBtn)));
}

/** Twee gepubliceerde versies naast elkaar (alleen-lezen). */
let compareView = null;
function showCompare(current) {
  const { info } = state;
  state.player?.destroy();
  state.composer?.destroy();
  const versions = info.versions.map((v) => ({
    id: v.id, number: v.number, label: tr('Versie {n}', { n: v.number }),
    sub: `${v.isLatest ? `${tr('nieuwste')} · ` : ''}${clientStatusText(v.status)}`,
    src: compareSrc(v), poster: v.hasPoster ? urls.poster(v.id) : undefined, duration: v.duration,
  }));
  const other = info.versions.find((v) => v.id !== current.id);
  compareView = createCompare({ versions, a: other.id, b: current.id });
  mount(root,
    h('header', { class: 'r-header' }, h('div', { class: 'r-header-inner' },
      h('div', { class: 'r-titles' }, h('div', { class: 'r-brand' }, brandMark(info.brand, { size: 'sm' })), h('h1', {}, `${tr('Versies vergelijken')} · ${info.title}`)),
      button(tr('Terug naar de video'), { icon: 'arrowLeft', onClick: () => { compareView.destroy(); compareView = null; showVersion(current); } }))),
    h('main', { class: 'r-compare' }, compareView.el, h('p', { class: 'small muted' }, tr('Alleen-lezen. Reageren en feedback versturen doe je op de nieuwste versie.'))));
}
const clientStatusText = (s) => tr({ in_review: 'klaar voor review', changes_requested: 'feedback verstuurd', approved: 'goedgekeurd' }[s] || 'gesloten');

function showDrawing(c) {
  state.player.pause();
  state.player.showAnnotation(c?.annotation || null);
}

function selectComment(id, scroll) {
  state.activeId = id;
  drawComments();
  if (scroll) document.getElementById(`comment-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function submitFeedback() {
  const authorName = reviewerName();
  if (authorName === null) return;
  const v = state.version;
  const n = myPending();
  const draftKey = `review-feedback-${token}-${v.id}`;
  const message = h('textarea', { rows: '3', placeholder: n ? tr('Optioneel: algemene toelichting voor het team') : tr('Wat moet er veranderen?'), maxlength: '5000', value: draftStore.get(draftKey) });
  message.addEventListener('input', () => draftStore.set(draftKey, message.value));
  // Eén request-id per verzendactie: ook als je opnieuw klikt na een fout, telt de server hem maar één keer.
  const requestId = newRequestId();
  let result = null;
  await openDialog({
    title: tr('Feedback versturen op Versie {n}', { n: v.number }),
    body: [
      h('p', {}, n
        ? [tr('Je verstuurt '), h('strong', {}, plural(n, tr('reactie'), tr('reacties'))), tr(' naar het team. Daarna gaat de video terug naar het team voor aanpassingen.')]
        : tr('Je hebt nog geen eigen reacties geplaatst. Schrijf hieronder wat er moet veranderen, of annuleer en plaats eerst reacties op de juiste momenten.')),
      field(n ? tr('Toelichting (optioneel)') : tr('Toelichting'), message),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, tr('Annuleren')),
      h('button', { class: 'btn btn-primary', value: 'ok' }, icon('send'), h('span', { class: 'btn-label' }, tr('Feedback versturen')))],
    onSubmit: async () => {
      if (!n && !message.value.trim()) { message.classList.add('input-error'); message.focus(); return false; }
      try {
        result = await apiWithRetry('POST', `${base}/versions/${v.id}/feedback`, { authorName, message: message.value, requestId }, keyHeader);
      } catch (err) {
        toast(`${err.message} ${tr('Je tekst is bewaard; probeer het opnieuw.')}`, 'error');
        return false;
      }
    },
  });
  if (!result) return;
  draftStore.set(draftKey, '');
  state.justSent = { type: 'feedback', count: result.commentCount, at: new Date().toISOString() };
  toast(tr('Je feedback is verstuurd naar het team.'), 'success');
  await load(v.id);
}

async function approve() {
  const v = state.version;
  const requestId = newRequestId();
  let result = null;
  const pendingNote = myPending()
    ? h('div', { class: 'notice notice-warn' }, icon('clock'), h('span', {}, tr('Je hebt {count} die nog niet als feedback zijn verstuurd. Die blijven zichtbaar voor het team, maar keuren deze versie niet af.', { count: plural(myPending(), tr('reactie'), tr('reacties')) })))
    : null;
  await openDialog({
    title: tr('Versie {n} goedkeuren?', { n: v.number }),
    body: [
      h('p', { class: 'approve-what' }, h('strong', {}, state.info.title), h('span', { class: 'approve-version' }, tr('Versie {n}', { n: v.number }))),
      h('p', { class: 'small muted' }, tr('Je goedkeuring wordt vastgelegd met je naam ({name}), datum en tijd, en geldt alleen voor deze versie.', { name: state.info.identity.name })),
      pendingNote,
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, tr('Annuleren')),
      h('button', { class: 'btn btn-approve', value: 'ok' }, icon('checkCircle'), h('span', { class: 'btn-label' }, tr('Ja, keur Versie {n} goed', { n: v.number })))],
    onSubmit: async () => {
      try {
        result = await apiWithRetry('POST', `${base}/versions/${v.id}/approve`, { confirm: true, versionNumber: v.number, requestId }, keyHeader);
      } catch (err) {
        toast(err.message, 'error');
        if (err.status === 409) { load(); return true; }
        return false;
      }
    },
  });
  if (!result) return;
  state.justSent = { type: 'approved', number: v.number };
  toast(tr('Versie {n} is goedgekeurd. Dank je wel!', { n: v.number }), 'success');
  await load(v.id);
}

let playbackTimer = null;
function schedulePlaybackCheck(versionId) {
  clearTimeout(playbackTimer);
  playbackTimer = setTimeout(async () => {
    try {
      const fresh = await api('GET', base);
      const v = fresh.versions.find((x) => x.id === versionId);
      if (v?.playback.levels.length && state.version?.id === versionId && !unsentInput().text) {
        state.info = fresh;
        await showVersion(v);
        return;
      }
    } catch { /* volgende poging */ }
    if (state.version?.id === versionId) schedulePlaybackCheck(versionId);
  }, 10_000);
}

// Houd reacties van andere reviewers en het team actueel.
setInterval(() => {
  if (document.visibilityState === 'visible' && state.version && !compareView && !document.querySelector('.reply-box:not([hidden]) textarea, dialog[open]')) {
    refreshComments().catch(() => {});
  }
}, 30_000);

load();
