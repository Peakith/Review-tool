import {
  h, mount, icon, button, busy, api, apiWithRetry, newRequestId, statusPill, toast, openDialog, field,
  formatDate, plural, draftStore, emptyState,
} from '/shared/util.js';
import { createPlayer } from '/shared/player.js';
import { renderComments, markersFrom } from '/shared/comments.js';
import { createComposer } from '/shared/composer.js';

const token = location.pathname.split('/').filter(Boolean).pop();
const base = `/api/review/${encodeURIComponent(token)}`;
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

function fatal(title, message, iconName = 'alert', retry) {
  document.title = title;
  mount(root, h('main', { class: 'fatal' }, emptyState({
    icon: iconName, title, text: message,
    action: retry ? button('Opnieuw proberen', { icon: 'refresh', onClick: retry }) : null,
  })));
}

async function load(versionId) {
  if (!state.info) mount(root, h('div', { class: 'fatal' }, h('div', { class: 'spinner', role: 'status', 'aria-label': 'Laden' })));
  try {
    state.info = await api('GET', base);
  } catch (err) {
    if (err.status === 410) return fatal('Deze link is ingetrokken', 'Je hebt geen toegang meer tot deze video. Vraag het productieteam om een nieuwe link.', 'lock');
    if (err.status === 404) return fatal('Link niet gevonden', 'Controleer of je de volledige link hebt gekopieerd, of vraag het team om een nieuwe link.', 'link');
    return fatal('Laden lukt niet', err.message, 'alert', () => load(versionId));
  }
  document.title = `${state.info.title} · Review`;
  if (!state.info.versions.length) {
    return fatal(state.info.title, 'Er staat nog geen versie voor je klaar. Je kunt deze link bewaren: zodra het team een versie deelt, zie je die hier.', 'clock', () => load());
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
    state.comments = await api('GET', `${base}/versions/${version.id}/comments`, undefined, keyHeader);
  } catch (err) {
    if (err.status === 410) return load();
    state.comments = [];
    toast(`${err.message}`, 'error');
  }
  render();
}

async function refreshComments() {
  state.comments = await api('GET', `${base}/versions/${state.version.id}/comments`, undefined, keyHeader);
  drawComments();
}

const isApprover = () => state.info.role === 'approver';
const canAct = () => !state.info.archived && state.version.isLatest && ['in_review', 'changes_requested'].includes(state.version.status);
const myPending = () => {
  let n = 0;
  const walk = (list) => list.forEach((c) => { if (c.mine && c.pending) n++; walk(c.replies || []); });
  walk(state.comments);
  return n;
};

/** In gewone taal: wat betekent de status van deze versie voor de klant? */
function clientStatus(v) {
  if (state.info.archived) return { cls: 'is-closed', icon: 'history', title: 'Afgerond en gearchiveerd', text: 'Je kunt de video nog bekijken, maar reageren en goedkeuren is niet meer mogelijk.' };
  if (!v.isLatest) return { cls: 'is-old', icon: 'history', title: 'Oudere versie', text: 'Alleen om terug te kijken. Reageren en goedkeuren kan op de nieuwste versie.' };
  if (v.status === 'approved') return { cls: 'is-approved', icon: 'checkCircle', title: 'Goedgekeurd', text: v.approval ? `Goedgekeurd door ${v.approval.name} op ${formatDate(v.approval.at)}.` : 'Deze versie is goedgekeurd.' };
  if (v.status === 'changes_requested') return { cls: 'is-changes', icon: 'send', title: 'Feedback verstuurd', text: 'Het team past de video aan. Je kunt nog aanvullen' + (isApprover() ? ' of deze versie alsnog goedkeuren.' : '.') };
  if (v.status === 'in_review') return { cls: 'is-review', icon: 'eye', title: 'Klaar voor jouw review', text: isApprover() ? 'Plaats reacties en verstuur je feedback, of keur deze versie goed.' : 'Plaats reacties en verstuur daarna je feedback.' };
  return { cls: 'is-closed', icon: 'lock', title: 'Tijdelijk gesloten', text: 'Deze versie staat op dit moment niet open voor review.' };
}

let commentsEl;
let actionsEl;
let nameInput;

function render() {
  const { info, version } = state;
  const latest = info.versions[0];
  const status = clientStatus(version);

  const player = createPlayer({
    src: `${base}/versions/${version.id}/media`,
    poster: version.hasPoster ? `${base}/versions/${version.id}/poster` : undefined,
    duration: version.duration,
  });
  state.player = player;
  player.onMarkerClick((id) => selectComment(id, true));

  // ---- Kop: welke video en versie bekijk ik? ----
  const versionPicker = info.versions.length > 1
    ? h('label', { class: 'version-pick' }, h('span', { class: 'visually-hidden' }, 'Kies versie'),
      h('select', { onChange: (e) => showVersion(info.versions.find((v) => v.id === Number(e.target.value))) },
        info.versions.map((v) => h('option', { value: v.id }, `Versie ${v.number}${v.isLatest ? ' · nieuwste' : ''}`))))
    : null;
  if (versionPicker) versionPicker.querySelector('select').value = String(version.id);

  const header = h('header', { class: 'r-header' },
    h('div', { class: 'r-header-inner' },
      h('div', { class: 'r-titles' },
        h('div', { class: 'r-project truncate' }, [info.project.clientName, info.project.name].filter(Boolean).join(' · ')),
        h('h1', { title: info.title }, info.title)),
      h('div', { class: 'r-version' },
        h('span', { class: 'version-chip' }, h('strong', {}, `Versie ${version.number}`), version.isLatest ? h('span', { class: 'version-latest' }, 'nieuwste') : h('span', { class: 'version-old' }, `van ${latest.number}`)),
        versionPicker,
        statusPill(version.status))));

  // ---- Statusuitleg ----
  const statusCard = h('section', { class: `r-status ${status.cls}`, 'aria-live': 'polite' },
    icon(status.icon),
    h('div', {}, h('strong', {}, status.title), h('p', {}, status.text)),
    !version.isLatest ? button(`Naar Versie ${latest.number}`, { size: 'sm', onClick: () => showVersion(latest) }) : null);

  // ---- Identiteit ----
  let identity;
  if (isApprover()) {
    identity = h('div', { class: 'identity is-verified' }, icon('shield'),
      h('div', {}, h('div', {}, 'Je reviewt als ', h('strong', {}, info.identity.name)), h('div', { class: 'small' }, 'Aangewezen akkoordgever · bevestigd via je persoonlijke link')));
  } else {
    nameInput = h('input', {
      type: 'text', id: 'reviewer-name', autocomplete: 'name', maxlength: '80', placeholder: 'Bijv. Eva Jansen',
      value: store.get('rt-reviewer-name') || '',
      onInput: (e) => { store.set('rt-reviewer-name', e.target.value.trim()); e.target.classList.remove('input-error'); },
    });
    identity = h('div', { class: 'identity' },
      h('label', { for: 'reviewer-name', class: 'field-label' }, 'Je naam'),
      nameInput,
      h('div', { class: 'field-hint' }, 'Zichtbaar bij je reacties, als “opgegeven naam” (niet geverifieerd).'));
  }

  // ---- Reacties ----
  const composer = createComposer({
    player,
    draftKey: `review-draft-${token}-${version.id}`,
    placeholder: 'Pauzeer op het juiste moment en typ hier je opmerking…',
    onSubmit: async (body, timecode) => {
      const authorName = reviewerName();
      if (authorName === null) return false;
      try {
        await apiWithRetry('POST', `${base}/versions/${version.id}/comments`, { body, timecode, authorName, requestId: newRequestId() }, keyHeader);
        await refreshComments();
        toast('Reactie geplaatst. Hij is nog niet verstuurd: klik op “Feedback versturen” als je klaar bent.', 'success');
        return true;
      } catch (err) {
        toast(`${err.message} Je tekst is bewaard.`, 'error');
        return false;
      }
    },
  });
  state.composer = composer;

  commentsEl = h('div', { class: 'r-comments' });
  actionsEl = h('div', { class: 'r-actions', role: 'region', 'aria-label': 'Feedback versturen of goedkeuren' });

  const howTo = howToCard();
  const download = info.allowDownload
    ? h('a', { class: 'btn btn-sm btn-ghost', href: `${base}/versions/${version.id}/download` }, icon('download'), h('span', { class: 'btn-label' }, 'Download'))
    : null;

  mount(root,
    header,
    h('main', { class: 'r-main' },
      h('section', { class: 'r-stage', 'aria-label': 'Video' }, player.el,
        h('div', { class: 'r-stage-foot small muted' },
          h('span', {}, `Je bekijkt Versie ${version.number} van ${latest.number}`, version.sharedAt ? ` · gedeeld ${formatDate(version.sharedAt)}` : ''),
          download)),
      h('aside', { class: 'r-panel', 'aria-label': 'Reacties' },
        statusCard,
        state.justSent ? sentConfirmation() : null,
        canAct() ? howTo : null,
        canAct() ? identity : null,
        canAct() ? composer.el : null,
        h('div', { class: 'r-comments-head' }, h('h2', {}, 'Reacties'), h('span', { class: 'small muted', id: 'comment-count' })),
        commentsEl)),
    canAct() ? actionsEl : null);
  drawComments();
}

function howToCard() {
  const collapsed = store.get('rt-howto-collapsed') === '1';
  const details = h('details', { class: 'howto', open: !collapsed },
    h('summary', {}, icon('info'), 'Zo werkt het'),
    h('ol', {},
      h('li', {}, h('strong', {}, 'Reageer op het juiste moment. '), 'Pauzeer de video en typ je opmerking; het tijdstip wordt automatisch gekoppeld.'),
      h('li', {}, h('strong', {}, 'Verstuur je feedback. '), 'Je reacties zijn pas definitief voor het team als je op “Feedback versturen” klikt.'),
      isApprover()
        ? h('li', {}, h('strong', {}, 'Akkoord? '), 'Klik op “Deze versie goedkeuren”. Je goedkeuring geldt alleen voor deze versie.')
        : h('li', {}, h('strong', {}, 'Goedkeuren '), `doet ${state.info.approver ? state.info.approver.name : 'de aangewezen akkoordgever'} via een persoonlijke link.`)));
  details.addEventListener('toggle', () => store.set('rt-howto-collapsed', details.open ? '0' : '1'));
  return details;
}

function sentConfirmation() {
  const s = state.justSent;
  return h('div', { class: 'notice notice-ok', role: 'status' }, icon('checkCircle'),
    h('div', {}, h('strong', {}, s.type === 'approved' ? `Versie ${s.number} is goedgekeurd.` : 'Je feedback is verstuurd.'),
      h('div', { class: 'small' }, s.type === 'approved' ? 'Het team ziet je goedkeuring direct. Dank je wel!' : `${plural(s.count, 'reactie', 'reacties')} verstuurd op ${formatDate(s.at)}. Het team gaat ermee aan de slag.`)));
}

function reviewerName() {
  if (isApprover()) return state.info.identity.name;
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.classList.add('input-error');
    nameInput.focus();
    toast('Vul eerst je naam in, zodat het team weet van wie de feedback komt.', 'error');
    return null;
  }
  return name;
}

function drawComments() {
  renderComments(commentsEl, state.comments, {
    mode: 'client',
    canWrite: canAct(),
    activeId: state.activeId,
    onSeek: (t, id) => { state.player.seek(t); selectComment(id, false); },
    onReply: async (parentId, body) => {
      const authorName = reviewerName();
      if (authorName === null) return false;
      try {
        await apiWithRetry('POST', `${base}/versions/${state.version.id}/comments`, { body, parentId, authorName, requestId: newRequestId() }, keyHeader);
        await refreshComments();
        toast('Antwoord geplaatst', 'success');
        return true;
      } catch (err) { toast(`${err.message} Je tekst is bewaard.`, 'error'); return false; }
    },
    onDelete: async (id) => {
      try {
        await api('DELETE', `${base}/comments/${id}`, undefined, keyHeader);
        await refreshComments();
        toast('Reactie verwijderd');
      } catch (err) { toast(err.message, 'error'); drawComments(); }
    },
  });
  state.player.setMarkers(markersFrom(state.comments, state.activeId));
  const countEl = document.getElementById('comment-count');
  if (countEl) countEl.textContent = state.comments.length ? plural(state.comments.length, 'reactie', 'reacties') : '';
  drawActions();
}

/** Onderbalk: feedback versturen en (alleen akkoordgever) goedkeuren. */
function drawActions() {
  if (!actionsEl || !canAct()) return;
  const n = myPending();
  const feedbackBtn = button(n ? `Feedback versturen (${n})` : 'Feedback versturen', { icon: 'send', variant: isApprover() ? 'secondary' : 'primary', size: 'lg', onClick: submitFeedback });
  const approveBtn = isApprover() ? button('Deze versie goedkeuren', { icon: 'checkCircle', variant: 'approve', size: 'lg', onClick: approve }) : null;
  const hint = n
    ? h('span', { class: 'r-actions-hint is-pending' }, icon('clock'), `${plural(n, 'reactie', 'reacties')} nog niet verstuurd`)
    : h('span', { class: 'r-actions-hint' }, icon('info'), isApprover() ? 'Klaar met kijken? Verstuur feedback of keur goed.' : `Goedkeuren gebeurt door ${state.info.approver ? state.info.approver.name : 'de akkoordgever'}.`);
  mount(actionsEl, h('div', { class: 'r-actions-inner' }, hint, h('div', { class: 'r-actions-buttons' }, feedbackBtn, approveBtn)));
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
  const message = h('textarea', { rows: '3', placeholder: n ? 'Optioneel: algemene toelichting voor het team' : 'Wat moet er veranderen?', maxlength: '5000', value: draftStore.get(draftKey) });
  message.addEventListener('input', () => draftStore.set(draftKey, message.value));
  // Eén request-id per verzendactie: ook als je opnieuw klikt na een fout, telt de server hem maar één keer.
  const requestId = newRequestId();
  let result = null;
  await openDialog({
    title: `Feedback versturen op Versie ${v.number}`,
    body: [
      h('p', {}, n
        ? ['Je verstuurt ', h('strong', {}, plural(n, 'reactie', 'reacties')), ' naar het team. Daarna gaat de video terug naar het team voor aanpassingen.']
        : 'Je hebt nog geen eigen reacties geplaatst. Schrijf hieronder wat er moet veranderen, of annuleer en plaats eerst reacties op de juiste momenten.'),
      field(n ? 'Toelichting (optioneel)' : 'Toelichting', message),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'),
      h('button', { class: 'btn btn-primary', value: 'ok' }, icon('send'), h('span', { class: 'btn-label' }, 'Feedback versturen'))],
    onSubmit: async () => {
      if (!n && !message.value.trim()) { message.classList.add('input-error'); message.focus(); return false; }
      try {
        result = await apiWithRetry('POST', `${base}/versions/${v.id}/feedback`, { authorName, message: message.value, requestId }, keyHeader);
      } catch (err) {
        toast(`${err.message} Je tekst is bewaard; probeer het opnieuw.`, 'error');
        return false;
      }
    },
  });
  if (!result) return;
  draftStore.set(draftKey, '');
  state.justSent = { type: 'feedback', count: result.commentCount, at: new Date().toISOString() };
  toast('Je feedback is verstuurd naar het team.', 'success');
  await load(v.id);
}

async function approve() {
  const v = state.version;
  const requestId = newRequestId();
  let result = null;
  const pendingNote = myPending()
    ? h('div', { class: 'notice notice-warn' }, icon('clock'), h('span', {}, `Je hebt ${plural(myPending(), 'reactie', 'reacties')} die nog niet als feedback zijn verstuurd. Die blijven zichtbaar voor het team, maar keuren deze versie niet af.`))
    : null;
  await openDialog({
    title: `Versie ${v.number} goedkeuren?`,
    body: [
      h('p', {}, 'Je keurt ', h('strong', {}, `Versie ${v.number}`), ' van ', h('strong', {}, state.info.title), ' goed.'),
      h('ul', { class: 'facts' },
        h('li', {}, icon('shield'), h('span', {}, `Vastgelegd met je naam (${state.info.identity.name}), datum en tijd.`)),
        h('li', {}, icon('layers'), h('span', {}, 'Geldt alleen voor deze versie. Een eventuele nieuwe versie moet opnieuw worden goedgekeurd.'))),
      pendingNote,
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'),
      h('button', { class: 'btn btn-approve', value: 'ok' }, icon('checkCircle'), h('span', { class: 'btn-label' }, `Ja, keur Versie ${v.number} goed`))],
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
  toast(`Versie ${v.number} is goedgekeurd. Dank je wel!`, 'success');
  await load(v.id);
}

// Houd reacties van andere reviewers en het team actueel.
setInterval(() => {
  if (document.visibilityState === 'visible' && state.version && !document.querySelector('.reply-box:not([hidden]) textarea, dialog[open]')) {
    refreshComments().catch(() => {});
  }
}, 30_000);

load();
