import { h, api, statusPill, toast, confirmDialog, formatDate } from '/shared/util.js';
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
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  reviewerKey = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  store.set('rt-reviewer-key', reviewerKey);
}
const keyHeader = { 'x-reviewer-key': reviewerKey };

const state = { info: null, version: null, comments: [], activeId: null, player: null };

function fatal(title, message) {
  document.title = title;
  root.replaceChildren(h('div', { class: 'fatal' }, h('h1', {}, title), h('p', {}, message)));
}

async function load(versionId) {
  try {
    state.info = await api('GET', base);
  } catch (err) {
    if (err.status === 410) return fatal('Link ingetrokken', err.message);
    if (err.status === 404) return fatal('Link niet gevonden', 'Deze reviewlink bestaat niet. Controleer of je de volledige link hebt gekopieerd.');
    return fatal('Er ging iets mis', err.message);
  }
  document.title = `${state.info.title} · Review`;
  if (!state.info.versions.length) {
    return fatal(state.info.title, 'Er is nog geen versie gedeeld. Je ontvangt bericht van het team zodra de video klaarstaat.');
  }
  const wanted = state.info.versions.find((v) => v.id === versionId) || state.info.versions[0];
  await showVersion(wanted);
}

async function showVersion(version) {
  state.version = version;
  state.activeId = null;
  state.player?.destroy();
  state.comments = await api('GET', `${base}/versions/${version.id}/comments`, undefined, keyHeader);
  render();
}

async function refreshComments() {
  state.comments = await api('GET', `${base}/versions/${state.version.id}/comments`, undefined, keyHeader);
  drawComments();
}

const isApprover = () => state.info.role === 'approver';
const canAct = () => state.version.isLatest && ['in_review', 'changes_requested'].includes(state.version.status);
const myPendingCount = () => {
  let n = 0;
  const walk = (list) => list.forEach((c) => { if (c.mine && c.pending) n++; walk(c.replies || []); });
  walk(state.comments);
  return n;
};

let commentsEl;
let feedbackBtn;
let nameInput;

function render() {
  const { info, version } = state;
  const latest = info.versions[0];

  const player = createPlayer({
    src: `${base}/versions/${version.id}/media`,
    poster: version.hasPoster ? `${base}/versions/${version.id}/poster` : undefined,
    duration: version.duration,
  });
  state.player = player;
  player.onMarkerClick((id) => selectComment(id, true));

  // ---- Kop ----
  const versionPicker = info.versions.length > 1
    ? h('select', {
      class: 'version-select', 'aria-label': 'Kies versie',
      onChange: (e) => showVersion(info.versions.find((v) => v.id === Number(e.target.value))),
    }, info.versions.map((v) => h('option', { value: v.id, selected: v.id === version.id },
      `Versie ${v.number}${v.isLatest ? ' (nieuwste)' : ''}`)))
    : null;

  const header = h('header', { class: 'review-header' },
    h('div', { class: 'review-header-inner' },
      h('div', { class: 'review-titles' },
        h('div', { class: 'review-project' }, [info.project.clientName, info.project.name].filter(Boolean).join(' · ')),
        h('h1', {}, info.title)),
      h('div', { class: 'review-version' },
        h('span', { class: 'version-chip' }, `Versie ${version.number}`, version.isLatest ? h('span', { class: 'version-latest' }, 'nieuwste') : null),
        versionPicker,
        statusPill(version.status))));

  // ---- Meldingen ----
  const banners = [];
  if (!version.isLatest) {
    banners.push(h('div', { class: 'notice notice-warn' },
      `Je bekijkt een oudere versie (Versie ${version.number}). Reageren en goedkeuren kan alleen op de nieuwste versie. `,
      h('button', { class: 'link-btn link-strong', onClick: () => showVersion(latest) }, `Naar Versie ${latest.number} →`)));
  }
  if (version.status === 'approved') {
    banners.push(h('div', { class: 'notice notice-ok' },
      version.approval
        ? `Versie ${version.number} is goedgekeurd door ${version.approval.name} op ${formatDate(version.approval.at)}.`
        : `Versie ${version.number} is goedgekeurd.`));
  } else if (version.isLatest && version.status === 'changes_requested') {
    banners.push(h('div', { class: 'notice notice-info' },
      'Er is feedback verstuurd op deze versie. Het team werkt aan een nieuwe versie. Je kunt nog aanvullende feedback sturen',
      isApprover() ? ' of deze versie alsnog goedkeuren.' : '.'));
  } else if (version.isLatest && !canAct()) {
    banners.push(h('div', { class: 'notice notice-info' }, 'Deze versie staat op dit moment niet open voor review.'));
  }

  // ---- Identiteit ----
  let identity;
  if (isApprover()) {
    identity = h('div', { class: 'identity identity-verified' },
      h('div', {}, 'Je reviewt als ', h('strong', {}, info.identity.name)),
      h('div', { class: 'small' }, '✓ Aangewezen akkoordgever · bevestigd via je persoonlijke link'));
  } else {
    nameInput = h('input', {
      type: 'text', id: 'reviewer-name', autocomplete: 'name', maxlength: '80', placeholder: 'Bijv. Eva Jansen',
      value: store.get('rt-reviewer-name') || '',
      onInput: (e) => store.set('rt-reviewer-name', e.target.value.trim()),
    });
    identity = h('div', { class: 'identity' },
      h('label', { for: 'reviewer-name', class: 'identity-label' }, 'Je naam'),
      nameInput,
      h('div', { class: 'small muted' }, 'Zichtbaar bij je reacties. Deze naam is door jou opgegeven en wordt niet geverifieerd.'));
  }

  // ---- Reacties ----
  const composer = createComposer({
    player,
    onSubmit: async (body, timecode) => {
      const authorName = reviewerName();
      if (authorName === null) return false;
      try {
        await api('POST', `${base}/versions/${version.id}/comments`, { body, timecode, authorName }, keyHeader);
        await refreshComments();
        toast('Reactie geplaatst. Verstuur je feedback als je klaar bent.');
      } catch (err) {
        toast(err.message, 'error');
        return false;
      }
    },
  });
  if (!canAct()) composer.setDisabled(true, version.isLatest ? 'Reageren is niet meer mogelijk op deze versie.' : 'Reageren kan alleen op de nieuwste versie.');

  commentsEl = h('div', { class: 'comments' });

  // ---- Acties ----
  feedbackBtn = h('button', { class: 'btn btn-primary', type: 'button', onClick: submitFeedback }, 'Feedback versturen');
  const approveBtn = isApprover()
    ? h('button', { class: 'btn btn-approve', type: 'button', onClick: approve }, 'Deze versie goedkeuren')
    : null;
  const actions = canAct()
    ? h('div', { class: 'review-actions' },
      h('div', { class: 'review-actions-buttons' }, feedbackBtn, approveBtn),
      !isApprover() ? h('div', { class: 'small muted' }, info.approver ? `Goedkeuren gebeurt door ${info.approver.name}.` : 'Goedkeuren gebeurt door de aangewezen akkoordgever.') : null)
    : null;

  const download = info.allowDownload
    ? h('a', { class: 'btn btn-small btn-ghost', href: `${base}/versions/${version.id}/download` }, 'Download deze versie')
    : null;

  root.replaceChildren(
    header,
    h('main', { class: 'review-main' },
      banners.length ? h('div', { class: 'review-banners' }, banners) : null,
      h('section', { class: 'review-stage' }, player.el,
        h('div', { class: 'stage-foot small muted' },
          h('span', {}, `Je bekijkt Versie ${version.number} van ${latest.number}`, version.sharedAt ? ` · gedeeld op ${formatDate(version.sharedAt)}` : ''),
          download)),
      h('aside', { class: 'review-panel' },
        identity,
        canAct() || !version.isLatest ? composer.el : null,
        h('h2', { class: 'panel-title' }, 'Reacties'),
        commentsEl)),
    actions);
  drawComments();
}

function reviewerName() {
  if (isApprover()) return state.info.identity.name;
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    nameInput.classList.add('input-error');
    toast('Vul eerst je naam in, zodat het team weet van wie de feedback komt.', 'error');
    return null;
  }
  nameInput.classList.remove('input-error');
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
      if (authorName === null) return;
      try {
        await api('POST', `${base}/versions/${state.version.id}/comments`, { body, parentId, authorName }, keyHeader);
        await refreshComments();
      } catch (err) { toast(err.message, 'error'); }
    },
    onDelete: async (id) => {
      try {
        await api('DELETE', `${base}/comments/${id}`, undefined, keyHeader);
        await refreshComments();
      } catch (err) { toast(err.message, 'error'); }
    },
  });
  state.player.setMarkers(markersFrom(state.comments, state.activeId));
  if (feedbackBtn) {
    const n = myPendingCount();
    feedbackBtn.textContent = n ? `Feedback versturen (${n})` : 'Feedback versturen';
  }
}

function selectComment(id, scroll) {
  state.activeId = id;
  drawComments();
  if (scroll) document.getElementById(`comment-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function submitFeedback() {
  const authorName = reviewerName();
  if (authorName === null) return;
  const n = myPendingCount();
  const message = h('textarea', { rows: '3', placeholder: 'Optioneel: algemene toelichting voor het team', maxlength: '5000' });
  const ok = await confirmDialog({
    title: `Feedback versturen op Versie ${state.version.number}`,
    body: h('div', {},
      h('p', {}, n
        ? `Je verstuurt ${n} reactie${n === 1 ? '' : 's'} naar het team. Daarna gaat de video terug naar het team voor aanpassingen.`
        : 'Je hebt nog geen reacties geplaatst. Schrijf hieronder wat er moet veranderen.'),
      message),
    confirmLabel: 'Feedback versturen',
  });
  if (!ok) return;
  try {
    await api('POST', `${base}/versions/${state.version.id}/feedback`, { authorName, message: message.value }, keyHeader);
    toast('Bedankt! Je feedback is verstuurd naar het team.', 'success');
    await load(state.version.id);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function approve() {
  const v = state.version;
  const ok = await confirmDialog({
    title: `Versie ${v.number} goedkeuren?`,
    body: h('div', {},
      h('p', {}, 'Je keurt ', h('strong', {}, `Versie ${v.number}`), ' van ', h('strong', {}, state.info.title), ' goed.'),
      h('p', { class: 'muted small' }, 'Deze goedkeuring geldt alleen voor deze versie en wordt vastgelegd met je naam, datum en tijd.')),
    confirmLabel: `Ja, keur Versie ${v.number} goed`,
  });
  if (!ok) return;
  try {
    await api('POST', `${base}/versions/${v.id}/approve`, { confirm: true, versionNumber: v.number }, keyHeader);
    toast(`Versie ${v.number} is goedgekeurd. Dank je wel!`, 'success');
    await load(v.id);
  } catch (err) {
    toast(err.message, 'error');
    if (err.status === 409) await load();
  }
}

// Houd reacties van andere reviewers en het team actueel.
setInterval(() => {
  if (document.visibilityState === 'visible' && state.version && !document.querySelector('.reply-box:not([hidden]) textarea')) {
    refreshComments().catch(() => {});
  }
}, 30_000);

load();
