// Feedbacktaken: een reactie wordt een taak (verantwoordelijke, prioriteit, deadline, status,
// interne toelichting). Overzicht per project en "Mijn feedbacktaken". Alleen voor het team.
import {
  h, mount, icon, button, busy, api, toast, openDialog, confirmDialog, field, emptyState, errorState,
  formatDate, formatDay, timecode, plural, draftStore, skeletonRows,
} from '/shared/util.js';
import { can } from './admin.js';

export const PRIORITIES = { high: 'Hoog', normal: 'Normaal', low: 'Laag' };
export const TASK_STATUS = { open: 'Open', in_progress: 'Bezig', done: 'Afgehandeld' };
const STATUS_ICON = { open: 'dashed', in_progress: 'clock', done: 'checkCircle' };

const today = () => new Date().toISOString().slice(0, 10);
const overdue = (t) => t?.dueDate && t.status !== 'done' && t.dueDate < today();

/** Compacte weergave van een taak: status, verantwoordelijke, prioriteit en deadline. */
export function taskChip(task) {
  if (!task) return null;
  return h('span', { class: `task-chip is-${task.status}${task.priority === 'high' ? ' is-high' : ''}`, title: 'Feedbacktaak (alleen zichtbaar voor het team)' },
    icon(STATUS_ICON[task.status]),
    h('span', {}, TASK_STATUS[task.status]),
    h('span', { class: 'task-sep' }, '·'),
    h('span', {}, task.assigneeName || h('em', {}, 'niet toegewezen')),
    task.priority !== 'normal' ? [h('span', { class: 'task-sep' }, '·'), h('span', { class: 'task-prio' }, task.priority === 'high' ? 'Hoge prioriteit' : 'Lage prioriteit')] : null,
    task.dueDate ? [h('span', { class: 'task-sep' }, '·'), h('span', { class: overdue(task) ? 'task-overdue' : '' }, `${overdue(task) ? 'verlopen ' : 'uiterlijk '}${formatDay(task.dueDate)}`)] : null);
}

/**
 * Taak maken of bewerken bij een reactie. Maken is veilig te herhalen: de server geeft bij een
 * tweede verzoek de bestaande taak terug. Bij een fout blijft het venster met je invoer open.
 */
export async function taskDialog({ comment, projectId, level, onDone }) {
  const task = comment.task;
  const mayEdit = can(level, 'upload');
  const assignees = await api('GET', `/api/projects/${projectId}/assignees`).catch(() => []);
  const draftKey = `task-note-${comment.id}`;
  const assignee = h('select', { 'aria-label': 'Verantwoordelijke', disabled: !mayEdit },
    h('option', { value: '' }, 'Nog niemand'),
    assignees.map((u) => h('option', { value: u.id }, `${u.name}${u.me ? ' (ik)' : ''}`)));
  assignee.value = task?.assigneeId ? String(task.assigneeId) : '';
  const priority = h('select', { 'aria-label': 'Prioriteit', disabled: !mayEdit }, Object.entries(PRIORITIES).map(([k, l]) => h('option', { value: k }, l)));
  priority.value = task?.priority || 'normal';
  const due = h('input', { type: 'date', value: task?.dueDate || '', 'aria-label': 'Deadline (optioneel)', disabled: !mayEdit });
  const status = h('select', { 'aria-label': 'Status' }, Object.entries(TASK_STATUS).map(([k, l]) => h('option', { value: k }, l)));
  status.value = task?.status || 'open';
  const note = h('textarea', { rows: '3', maxlength: '2000', placeholder: 'Bijv. “Nieuwe logo-bestanden staan in de projectmap”', disabled: !mayEdit });
  note.value = draftStore.get(draftKey) || task?.note || '';
  note.addEventListener('input', () => draftStore.set(draftKey, note.value));
  const error = h('div', { class: 'form-error', role: 'alert', hidden: true });

  const quote = h('blockquote', { class: 'task-quote' },
    h('div', { class: 'small muted' }, `${comment.authorName}${comment.timecode !== null && comment.timecode !== undefined ? ` · ${timecode(comment.timecode)}${comment.timecodeEnd ? `–${timecode(comment.timecodeEnd)}` : ''}` : ' · algemeen'}`),
    h('div', {}, comment.body || h('em', {}, 'Tekening zonder tekst')));
  let saved = false;
  await openDialog({
    title: task ? 'Feedbacktaak' : 'Taak maken van deze reactie',
    body: [
      quote,
      task?.unassignedNote && !task.assigneeId ? h('div', { class: 'notice notice-warn' }, icon('alert'), task.unassignedNote) : null,
      error,
      h('div', { class: 'form-grid is-2' }, field('Verantwoordelijke', assignee, 'Alleen teamleden met toegang tot dit project.'), field('Prioriteit', priority)),
      h('div', { class: 'form-grid is-2' }, field('Deadline (optioneel)', due, 'Een dag, geen tijdstip.'), field('Status', status, 'Afgehandeld = de reactie is afgehandeld (en andersom).')),
      field('Interne toelichting', note, 'Alleen zichtbaar voor het team, nooit voor de klant.'),
      !mayEdit ? h('p', { class: 'small muted' }, icon('lock'), ' Je kunt alleen de status wijzigen. Voor de rest is het recht “Uploaden” nodig.') : null,
    ],
    actions: [
      task && mayEdit ? h('button', { class: 'btn btn-ghost', type: 'button', onClick: async (e) => {
        const btn = e.currentTarget;
        if (!(await confirmDialog({ title: 'Taak verwijderen?', body: 'De reactie zelf blijft bestaan, met haar huidige afhandelstatus.', confirmLabel: 'Verwijderen', danger: true }))) return;
        const restore = busy(btn);
        try { await api('DELETE', `/api/tasks/${task.id}`); toast('Taak verwijderd', 'success'); btn.closest('dialog').close(''); onDone?.(); } catch (err) { toast(err.message, 'error'); restore(); }
      } }, icon('trash'), 'Taak verwijderen') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'),
      h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, task ? 'Opslaan' : 'Taak maken')),
    ],
    onSubmit: async () => {
      error.hidden = true;
      const body = mayEdit
        ? { assigneeId: assignee.value ? Number(assignee.value) : null, priority: priority.value, dueDate: due.value || null, status: status.value, note: note.value }
        : { status: status.value };
      try {
        if (task) await api('PATCH', `/api/tasks/${task.id}`, body);
        else {
          const r = await api('POST', `/api/comments/${comment.id}/task`, body);
          // Bestond er (door een eerdere poging) al een taak, dan die bijwerken met deze invoer.
          if (r.existing) await api('PATCH', `/api/tasks/${r.task.id}`, body);
        }
        draftStore.set(draftKey, '');
        saved = true;
      } catch (err) {
        mount(error, icon('alert'), h('span', {}, `${err.message} Je invoer is bewaard; probeer het opnieuw.`));
        error.hidden = false;
        return false;
      }
    },
  });
  if (saved) { toast(task ? 'Taak bijgewerkt' : 'Taak gemaakt', 'success'); onDone?.(); }
}

/** Eén regel in een feedbackoverzicht. */
function feedbackRow(item, { reload, showProject, level, userId }) {
  const href = `/video/${item.videoId}?v=${item.versionId}&c=${item.commentId}`;
  const tc = item.timecode !== null && item.timecode !== undefined ? `${timecode(item.timecode)}${item.timecodeEnd ? `–${timecode(item.timecodeEnd)}` : ''}` : 'Algemeen';
  const mayStatus = item.task && (can(level ?? item.level, 'upload') || item.task.assigneeId === userId);
  const quick = mayStatus && item.status !== 'done'
    ? h('div', { class: 'fb-quick' },
      item.status === 'open' ? button('Bezig', { size: 'sm', icon: 'clock', onClick: (e) => setStatus(e.currentTarget, item, 'in_progress', reload) }) : null,
      button('Afgehandeld', { size: 'sm', icon: 'check', onClick: (e) => setStatus(e.currentTarget, item, 'done', reload) }))
    : null;
  return h('article', { class: `fb-row is-${item.status}` },
    h('div', { class: 'fb-main' },
      h('div', { class: 'fb-head small' },
        showProject ? h('span', { class: 'muted' }, item.projectName, ' ›') : null,
        h('a', { href, 'data-nav': true, class: 'fb-video' }, item.videoTitle),
        h('span', { class: 'muted' }, `Versie ${item.versionNumber}${item.roundNumber ? ` · ronde ${item.roundNumber}` : ''}`),
        h('span', { class: 'timecode timecode-static' }, icon(item.timecodeEnd ? 'range' : 'clock'), tc),
        item.hasAnnotation ? h('span', { class: 'badge badge-neutral' }, icon('pen'), 'Tekening') : null,
        item.internal ? h('span', { class: 'badge badge-internal' }, icon('lock'), 'Intern') : null),
      h('p', { class: 'fb-body' }, item.body || h('em', { class: 'muted' }, 'Tekening zonder tekst')),
      h('div', { class: 'fb-meta small muted' }, `${item.authorName} · ${formatDate(item.createdAt)}${item.replyCount ? ` · ${plural(item.replyCount, 'antwoord', 'antwoorden')}` : ''}`),
      item.task ? h('div', { class: 'fb-task' }, taskChip(item.task), item.task.note ? h('span', { class: 'small muted fb-note', title: item.task.note }, `“${item.task.note}”`) : null)
        : h('div', { class: 'fb-task' }, h('span', { class: `comment-state ${item.status === 'done' ? 'is-resolved' : 'is-open'}` }, icon(item.status === 'done' ? 'checkCircle' : 'dashed'), item.status === 'done' ? 'Afgehandeld' : 'Open, geen taak'))),
    h('div', { class: 'fb-side' }, quick, h('a', { class: 'btn btn-sm btn-ghost', href, 'data-nav': true, title: 'Openen op het juiste moment' }, icon('play'), h('span', { class: 'btn-label' }, 'Openen'))));
}

async function setStatus(btn, item, status, reload) {
  const restore = busy(btn);
  try {
    await api('PATCH', `/api/tasks/${item.task.id}`, { status });
    toast(status === 'done' ? 'Afgehandeld. De reactie is ook afgehandeld; de status van de video verandert niet.' : 'Op “bezig” gezet', 'success');
    reload();
  } catch (err) { toast(err.message, 'error'); restore(); }
}

/** Tabblad "Feedback" op de projectpagina: open feedback met filters. */
export async function viewFeedback({ project, host, session }) {
  const params = new URLSearchParams(location.search);
  const state = { assignee: params.get('wie') || '', video: params.get('video') || '', priority: params.get('prio') || '', status: params.get('status') || 'active' };
  const [assignees] = await Promise.all([api('GET', `/api/projects/${project.id}/assignees`).catch(() => [])]);
  const list = h('div', { class: 'fb-list' });
  const filters = h('div', { class: 'fb-filters' });
  let data = null;

  const select = (label, key, options) => {
    const el = h('select', { 'aria-label': label }, options.map(([v, l]) => h('option', { value: v }, l)));
    el.value = state[key];
    el.addEventListener('change', () => { state[key] = el.value; sync(); load(); });
    return h('label', { class: 'fb-filter' }, h('span', { class: 'small muted' }, label), el);
  };
  const sync = () => {
    const q = new URLSearchParams();
    if (state.assignee) q.set('wie', state.assignee);
    if (state.video) q.set('video', state.video);
    if (state.priority) q.set('prio', state.priority);
    if (state.status !== 'active') q.set('status', state.status);
    history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
  };

  function drawFilters() {
    const counts = data?.counts || {};
    mount(filters,
      select('Verantwoordelijke', 'assignee', [['', 'Iedereen'], ['me', 'Mijn taken'], ['none', 'Niet toegewezen'], ...assignees.filter((u) => !u.me).map((u) => [String(u.id), u.name])]),
      select('Video', 'video', [['', 'Alle video’s'], ...(data?.videos || []).map((v) => [String(v.id), v.title])]),
      select('Prioriteit', 'priority', [['', 'Alle'], ...Object.entries(PRIORITIES).map(([k, l]) => [k, l])]),
      select('Status', 'status', [['active', `Nog te doen (${(counts.open || 0) + (counts.in_progress || 0)})`], ['open', `Open (${counts.open || 0})`], ['in_progress', `Bezig (${counts.in_progress || 0})`], ['done', `Afgehandeld (${counts.done || 0})`], ['all', 'Alles']]));
  }

  async function load() {
    mount(list, skeletonRows(3));
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v) q.set(k, v);
    try {
      data = await api('GET', `/api/projects/${project.id}/feedback?${q}`);
    } catch (err) { mount(list, errorState(err, load)); return; }
    drawFilters();
    if (!data.items.length) {
      mount(list, h('div', { class: 'card' }, emptyState({ icon: 'checkCircle', compact: true,
        title: state.status === 'active' && !state.assignee && !state.video && !state.priority ? 'Geen open feedback' : 'Niets gevonden met deze filters',
        text: 'Hier verschijnt feedback die klanten hebben verstuurd, en elke reactie waar je een taak van maakt.' })));
      return;
    }
    mount(list, data.items.map((i) => feedbackRow(i, { reload: load, level: project.myLevel, userId: session.user.id })));
  }

  mount(host,
    h('div', { class: 'notice notice-info fb-intro' }, icon('info'), h('span', {}, 'Verstuurde klantfeedback en alle reacties met een taak. Taken, verantwoordelijken en interne toelichting ziet alleen het team. Een taak afhandelen handelt de reactie af, maar verandert de status van de video niet.')),
    filters, list);
  drawFilters();
  await load();
}

/** Pagina "Mijn feedbacktaken". */
export async function viewMyTasks(ctx) {
  document.title = 'Mijn feedbacktaken — Studio Review';
  const params = new URLSearchParams(location.search);
  let status = params.get('status') || 'active';
  const list = h('div', { class: 'fb-list' });
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Status' });
  async function load() {
    mount(seg, [['active', 'Nog te doen'], ['done', 'Afgehandeld'], ['all', 'Alles']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(status === k), onClick: () => { status = k; history.replaceState(null, '', k === 'active' ? location.pathname : `?status=${k}`); load(); } }, l)));
    mount(list, skeletonRows(3));
    let items;
    try { items = (await api('GET', `/api/my/tasks?status=${status}`)).items; } catch (err) { mount(list, errorState(err, load)); return; }
    if (!items.length) {
      mount(list, h('div', { class: 'card' }, emptyState({ icon: 'checkCircle', compact: true, title: status === 'active' ? 'Geen taken voor jou' : 'Niets gevonden', text: 'Taken die aan jou zijn toegewezen, verschijnen hier, met een link naar het juiste moment in de video.' })));
      return;
    }
    // Belangrijkste eerst: verlopen, hoge prioriteit, dichtstbijzijnde deadline.
    const rank = (i) => [overdue(i.task) ? 0 : 1, { high: 0, normal: 1, low: 2 }[i.task.priority], i.task.dueDate || '9999'];
    items.sort((a, b) => { const x = rank(a); const y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]); });
    mount(list, items.map((i) => feedbackRow(i, { reload: load, showProject: true, level: 'view', userId: ctx.session.user.id })));
  }
  mount(ctx.pageEl, h('div', { class: 'page page-narrow' },
    ctx.pageHeader({ title: 'Mijn feedbacktaken', meta: 'Feedback die aan jou is toegewezen, in alle projecten waar je toegang toe hebt' }),
    h('div', { class: 'toolbar' }, seg), list));
  await load();
}
