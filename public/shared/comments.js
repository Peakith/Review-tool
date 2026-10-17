import { h, timecode, relativeDate, formatDate } from './util.js';

function authorBadge(c) {
  if (c.authorType === 'team') return h('span', { class: 'badge badge-team' }, 'Team');
  if (c.authorType === 'approver') return h('span', { class: 'badge badge-verified', title: 'Identiteit bevestigd via persoonlijke akkoordlink' }, '✓ Akkoordgever');
  return h('span', { class: 'badge badge-guest', title: 'Naam is door de reviewer zelf ingevuld en niet geverifieerd' }, 'opgegeven naam');
}

/**
 * Reactielijst. opts: { mode: 'team'|'client', canWrite, canDeleteOwnTeam, activeId,
 *   onSeek(t, id), onReply(parentId, body), onResolve(id, resolved), onDelete(id) }
 */
export function renderComments(container, comments, opts) {
  container.replaceChildren();
  if (!comments.length) {
    container.append(h('div', { class: 'empty-comments' },
      h('p', {}, 'Nog geen reacties op deze versie.'),
      opts.canWrite ? h('p', { class: 'muted' }, 'Pauzeer de video en typ je opmerking: die wordt automatisch aan dat tijdstip gekoppeld.') : null));
    return;
  }

  const open = comments.filter((c) => !c.resolved).length;
  container.append(h('div', { class: 'comments-meta' }, `${comments.length} reactie${comments.length === 1 ? '' : 's'} · ${open} open`));

  for (const c of comments) container.append(commentCard(c, opts, false));
}

function commentCard(c, opts, isReply) {
  const replyBox = h('div', { class: 'reply-box', hidden: true });
  const actions = h('div', { class: 'comment-actions' });

  if (!isReply && opts.canWrite) {
    actions.append(h('button', { type: 'button', class: 'link-btn', onClick: () => toggleReply() }, 'Beantwoorden'));
  }
  if (!isReply && opts.mode === 'team') {
    actions.append(h('button', {
      type: 'button',
      class: `link-btn${c.resolved ? '' : ' link-strong'}`,
      onClick: () => opts.onResolve(c.id, !c.resolved),
    }, c.resolved ? 'Heropenen' : '✓ Markeer als afgehandeld'));
  }
  const canDelete = (opts.mode === 'client' && c.mine && c.pending) || (opts.mode === 'team' && opts.isOwnTeamComment?.(c));
  if (canDelete) actions.append(h('button', { type: 'button', class: 'link-btn link-danger', onClick: () => opts.onDelete(c.id) }, 'Verwijderen'));

  function toggleReply() {
    replyBox.hidden = !replyBox.hidden;
    if (!replyBox.hidden && !replyBox.firstChild) {
      const ta = h('textarea', { rows: '2', placeholder: 'Schrijf een antwoord…', 'aria-label': 'Antwoord' });
      const send = h('button', { type: 'submit', class: 'btn btn-small btn-primary' }, 'Antwoorden');
      const form = h('form', { class: 'reply-form', onSubmit: async (e) => {
        e.preventDefault();
        if (!ta.value.trim()) return;
        send.disabled = true;
        try { await opts.onReply(c.id, ta.value.trim()); } finally { send.disabled = false; }
      } }, ta, h('div', { class: 'reply-form-actions' },
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', onClick: () => { replyBox.hidden = true; } }, 'Annuleren'), send));
      replyBox.append(form);
    }
    replyBox.querySelector('textarea')?.focus();
  }

  const tc = c.timecode !== null && c.timecode !== undefined
    ? h('button', { type: 'button', class: 'timecode', onClick: () => opts.onSeek(c.timecode, c.id), title: 'Spring naar dit moment' }, timecode(c.timecode))
    : (!isReply ? h('span', { class: 'timecode timecode-general' }, 'Algemeen') : null);

  const card = h('article', {
    class: `comment${isReply ? ' comment-reply' : ''}${c.resolved ? ' is-resolved' : ''}${opts.activeId === c.id ? ' is-active' : ''}`,
    id: `comment-${c.id}`,
    onClick: (e) => {
      if (!isReply && c.timecode !== null && !e.target.closest('button, textarea, form, a')) opts.onSeek(c.timecode, c.id);
    },
  },
  h('header', { class: 'comment-head' },
    tc,
    h('strong', { class: 'comment-author' }, c.authorName),
    authorBadge(c),
    h('time', { class: 'comment-time', datetime: c.createdAt, title: formatDate(c.createdAt) }, relativeDate(c.createdAt))),
  h('p', { class: 'comment-body' }, c.body),
  (c.pending || c.resolved) ? h('div', { class: 'comment-tags' },
    c.pending ? h('span', { class: 'tag tag-pending', title: 'Deze reactie hoort nog niet bij een verstuurde feedbackronde' }, 'Nog niet verstuurd') : null,
    c.resolved ? h('span', { class: 'tag tag-resolved', title: c.resolvedBy ? `Door ${c.resolvedBy}, ${formatDate(c.resolvedAt)}` : '' }, '✓ Afgehandeld') : null) : null,
  actions.childNodes.length ? actions : null,
  c.replies?.length ? h('div', { class: 'replies' }, c.replies.map((r) => commentCard(r, opts, true))) : null,
  replyBox);
  return card;
}

/** Tijdlijnmarkeringen voor de speler. */
export function markersFrom(comments, activeId) {
  return comments
    .filter((c) => c.timecode !== null && c.timecode !== undefined)
    .map((c) => ({ id: c.id, time: c.timecode, resolved: c.resolved, active: c.id === activeId, label: `${c.authorName}: ${c.body.slice(0, 60)}` }));
}
