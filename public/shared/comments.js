import { h, icon, timecode, relativeDate, formatDate, busy, emptyState } from './util.js';

function authorBadge(c) {
  if (c.authorType === 'team') return h('span', { class: 'badge badge-team' }, 'Team');
  if (c.authorType === 'approver') return h('span', { class: 'badge badge-verified', title: 'Identiteit bevestigd via persoonlijke akkoordlink' }, icon('shield'), 'Akkoordgever');
  return h('span', { class: 'badge badge-guest', title: 'Naam is door de reviewer zelf ingevuld en niet geverifieerd' }, 'opgegeven naam');
}

/** Aantallen voor filterknoppen. */
export function commentCounts(comments) {
  const open = comments.filter((c) => !c.resolved).length;
  return { all: comments.length, open, resolved: comments.length - open };
}

/**
 * Reactielijst.
 * opts: { mode: 'team'|'client', canWrite, filter: 'all'|'open'|'resolved', activeId,
 *   onSeek(t, id), onReply(parentId, body, { internal }) → bool, onResolve(id, resolved), onDelete(id),
 *   isOwnTeamComment(c), onVisibility(id, internal) (alleen team) }
 */
export function renderComments(container, comments, opts) {
  const filter = opts.filter || 'all';
  const list = comments.filter((c) => filter === 'all' || (filter === 'open' ? !c.resolved : c.resolved));
  if (!comments.length) {
    container.replaceChildren(emptyState({
      icon: 'chat',
      compact: true,
      title: 'Nog geen reacties',
      text: opts.canWrite
        ? 'Pauzeer de video op het juiste moment en typ je opmerking. Die wordt automatisch aan dat tijdstip gekoppeld.'
        : 'Op deze versie zijn geen reacties geplaatst.',
    }));
    return;
  }
  if (!list.length) {
    container.replaceChildren(emptyState({
      icon: filter === 'open' ? 'checkCircle' : 'chat',
      compact: true,
      title: filter === 'open' ? 'Alles is afgehandeld' : 'Nog niets afgehandeld',
      text: filter === 'open' ? 'Er staan geen open reacties meer op deze versie.' : 'Afgehandelde reacties verschijnen hier.',
    }));
    return;
  }
  container.replaceChildren(h('div', { class: 'comment-list' }, list.map((c) => commentCard(c, opts, false))));
}

function stateLabel(c, opts) {
  if (c.resolved) {
    return h('span', { class: 'comment-state is-resolved', title: c.resolvedBy ? `Door ${c.resolvedBy}, ${formatDate(c.resolvedAt)}` : '' },
      icon('checkCircle'), opts.mode === 'client' ? 'Afgehandeld door team' : 'Afgehandeld');
  }
  if (c.pending) {
    return h('span', { class: 'comment-state is-pending', title: 'Hoort nog niet bij een verstuurde feedbackronde' },
      icon('clock'), c.mine ? 'Nog niet verstuurd' : 'Nog niet verstuurd door reviewer');
  }
  if (c.authorType === 'team') return null;
  if (opts.mode === 'client') {
    return c.sent
      ? h('span', { class: 'comment-state is-open' }, icon('send'), 'Verstuurd als feedback')
      : h('span', { class: 'comment-state is-pending' }, icon('eye'), 'Zichtbaar voor het team');
  }
  return h('span', { class: 'comment-state is-open' }, icon('dashed'), 'Open');
}

function commentCard(c, opts, isReply) {
  const replyBox = h('div', { class: 'reply-box', hidden: true });
  const foot = h('div', { class: 'comment-foot' });
  const seekable = !isReply && c.timecode !== null && c.timecode !== undefined;

  if (!isReply) {
    const state = stateLabel(c, opts);
    if (state) foot.append(state);
  }
  if (!isReply && opts.canWrite) {
    foot.append(h('button', { type: 'button', class: 'link-btn', onClick: () => toggleReply() }, icon('reply'), 'Beantwoorden'));
  }
  if (!isReply && opts.mode === 'team') {
    foot.append(h('button', {
      type: 'button',
      class: `link-btn${c.resolved ? '' : ' is-accent'}`,
      onClick: (e) => { busy(e.currentTarget); opts.onResolve(c.id, !c.resolved); },
    }, icon(c.resolved ? 'refresh' : 'check'), c.resolved ? 'Heropenen' : 'Afhandelen'));
  }
  const canDelete = (opts.mode === 'client' && c.mine && c.pending) || (opts.mode === 'team' && opts.isOwnTeamComment?.(c));
  if (canDelete) {
    foot.append(h('button', { type: 'button', class: 'link-btn is-danger', onClick: (e) => { busy(e.currentTarget); opts.onDelete(c.id); } }, icon('trash'), 'Verwijderen'));
  }
  // Team: zichtbaarheid van teamreacties. Een antwoord onder een interne notitie blijft intern.
  const visibilityLocked = isReply && opts.parentInternal;
  if (opts.mode === 'team' && c.authorType === 'team' && opts.onVisibility && opts.canWrite && !visibilityLocked && (opts.isOwnTeamComment?.(c) || opts.canShare)) {
    foot.append(h('button', { type: 'button', class: 'link-btn', onClick: (e) => { busy(e.currentTarget); opts.onVisibility(c.id, !c.internal); } },
      icon(c.internal ? 'eye' : 'lock'), c.internal ? 'Zichtbaar maken voor klant' : 'Intern maken'));
  }

  function toggleReply() {
    replyBox.hidden = !replyBox.hidden;
    if (!replyBox.hidden && !replyBox.firstChild) {
      const ta = h('textarea', { rows: '2', placeholder: `Antwoord aan ${c.authorName}…`, 'aria-label': `Antwoord aan ${c.authorName}`, maxlength: '5000' });
      const send = h('button', { type: 'submit', class: 'btn btn-sm btn-primary' }, h('span', { class: 'btn-label' }, 'Antwoorden'));
      // Team: antwoord op een klantreactie is standaard zichtbaar voor de klant; onder een interne notitie altijd intern.
      const teamInternal = opts.mode === 'team' && (c.internal || c.authorType === 'team');
      const internalBox = opts.mode === 'team' && !c.internal ? h('input', { type: 'checkbox', checked: teamInternal }) : null;
      const visibilityRow = opts.mode === 'team'
        ? (internalBox ? h('label', { class: 'check small' }, internalBox, 'Alleen intern (klant ziet dit antwoord niet)')
          : h('span', { class: 'small muted' }, icon('lock'), ' Blijft intern, net als de notitie'))
        : null;
      const form = h('form', { class: 'reply-form', onSubmit: async (e) => {
        e.preventDefault();
        if (!ta.value.trim()) { ta.focus(); return; }
        const restore = busy(send);
        // Bij een fout blijft de tekst staan, zodat je het opnieuw kunt proberen.
        const ok = await opts.onReply(c.id, ta.value.trim(), { internal: internalBox ? internalBox.checked : true }).catch(() => false);
        restore();
        if (ok !== false) ta.value = '';
      } }, ta, visibilityRow, h('div', { class: 'reply-form-actions' },
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => { replyBox.hidden = true; } }, 'Annuleren'), send));
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });
      replyBox.append(form);
    }
    replyBox.querySelector('textarea')?.focus();
  }

  const tc = seekable
    ? h('button', { type: 'button', class: 'timecode', onClick: () => opts.onSeek(c.timecode, c.id), title: 'Spring naar dit moment', 'aria-label': `Spring naar ${timecode(c.timecode)}` }, icon('play'), timecode(c.timecode))
    : (!isReply ? h('span', { class: 'timecode timecode-general' }, 'Algemeen') : null);

  const card = h('article', {
    class: `comment${isReply ? ' comment-reply' : ''}${c.resolved ? ' is-resolved' : ''}${opts.activeId === c.id ? ' is-active' : ''}${seekable ? ' is-seekable' : ''}`,
    id: `comment-${c.id}`,
    'aria-label': `Reactie van ${c.authorName}${seekable ? ` op ${timecode(c.timecode)}` : ''}`,
    onClick: (e) => {
      if (seekable && !e.target.closest('button, textarea, form, a')) opts.onSeek(c.timecode, c.id);
    },
  },
  h('header', { class: 'comment-head' },
    tc,
    h('span', { class: 'comment-author' }, c.authorName),
    authorBadge(c),
    opts.mode === 'team' && c.authorType === 'team'
      ? (c.internal || (isReply && opts.parentInternal)
        ? h('span', { class: 'badge badge-internal', title: 'Alleen zichtbaar voor het team' }, icon('lock'), 'Intern')
        : h('span', { class: 'badge badge-visible', title: 'De klant ziet deze reactie (als de versie gepubliceerd is)' }, icon('eye'), 'Klant ziet dit'))
      : null,
    h('time', { class: 'comment-time', datetime: c.createdAt, title: formatDate(c.createdAt) }, relativeDate(c.createdAt))),
  h('p', { class: 'comment-body' }, c.body),
  foot.childNodes.length ? foot : null,
  c.replies?.length ? h('div', { class: 'replies' }, c.replies.map((r) => commentCard(r, { ...opts, parentInternal: !!c.internal }, true))) : null,
  replyBox);
  return card;
}

/** Tijdlijnmarkeringen voor de speler. */
export function markersFrom(comments, activeId) {
  return comments
    .filter((c) => c.timecode !== null && c.timecode !== undefined)
    .map((c) => ({ id: c.id, time: c.timecode, resolved: c.resolved, active: c.id === activeId, label: `${c.authorName}: ${c.body.slice(0, 60)}` }));
}
