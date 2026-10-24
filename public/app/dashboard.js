// Persoonlijk dashboard: een rustige startpagina met een paar blokken die iedere gebruiker zelf kiest,
// verplaatst en breder of smaller maakt. De gegevens komen van de server en zijn daar al beperkt tot
// de projecten waar deze gebruiker toegang toe heeft.
import { h, mount, icon, button, api, toast, emptyState, errorState, relativeDate, formatDate, formatDeadline, isPast, timecode, plural, formatBytes, skeletonRows } from '/shared/util.js';

const greeting = () => {
  const hr = new Date().getHours();
  return hr < 6 ? 'Goedenacht' : hr < 12 ? 'Goedemorgen' : hr < 18 ? 'Goedemiddag' : 'Goedenavond';
};

export async function viewDashboard(ctx) {
  document.title = 'Dashboard — Studio Review';
  const { session, pageEl, pageHeader } = ctx;
  let state = null;
  let editing = false;
  let layout = [];
  const grid = h('div', { class: 'dash-grid', 'aria-live': 'polite' });
  const editBtn = button('Dashboard aanpassen', { icon: 'edit', variant: 'ghost', size: 'sm', onClick: () => setEditing(true) });
  const editBar = h('div', { class: 'dash-editbar', hidden: true });

  mount(pageEl, h('div', { class: 'page dash-page' },
    pageHeader({ title: `${greeting()}, ${session.user.name.split(' ')[0]}`, actions: editBtn }),
    editBar, grid));
  mount(grid, skeletonRows(4, 'skeleton-card'));

  async function load() {
    try {
      state = await api('GET', '/api/dashboard');
    } catch (err) { mount(grid, errorState(err, load)); return; }
    layout = state.layout.map((w) => ({ ...w }));
    // Nog geen enkel project: eerst de welkomstuitleg in plaats van lege blokken.
    if (!state.projectCount) {
      editBtn.hidden = true;
      mount(grid, session.user.isAdmin && ctx.onboarding ? ctx.onboarding() : h('div', { class: 'card' }, emptyState({
        icon: 'lock', title: 'Nog geen projecten voor jou',
        text: 'Je ziet hier je taken, feedback en projecten zodra een beheerder je toegang geeft tot een project.',
      })));
      grid.classList.add('is-onboarding');
      return;
    }
    draw();
  }

  async function save(next) {
    const before = layout;
    layout = next;
    draw();
    try {
      const r = await api('PUT', '/api/me/preferences', { dashboard: { widgets: layout } });
      // Nieuwe blokken hebben gegevens nodig: opnieuw ophalen.
      if (layout.some((w) => !(w.id in state.data))) { state = await api('GET', '/api/dashboard'); layout = r.dashboard.widgets; draw(); }
    } catch (err) {
      toast(`${err.message} Je indeling is niet opgeslagen.`, 'error');
      layout = before;
      draw();
    }
  }

  function setEditing(on) {
    editing = on;
    editBtn.hidden = on;
    editBar.hidden = !on;
    draw();
  }

  function draw() {
    if (!state) return;
    const titleOf = (id) => state.available.find((w) => w.id === id)?.title || id;
    if (editing) {
      const hidden = state.available.filter((w) => !layout.some((x) => x.id === w.id));
      mount(editBar,
        h('div', { class: 'dash-editbar-main' }, icon('info'), h('span', {}, 'Verplaats blokken met de pijlen of door te slepen aan de greep. Je indeling geldt alleen voor jou.')),
        hidden.length ? h('div', { class: 'dash-add' }, h('span', { class: 'small muted' }, 'Blok toevoegen:'),
          hidden.map((w) => button(w.title, { icon: 'plus', size: 'sm', title: w.description, onClick: () => save([...layout, { id: w.id, size: 'normal' }]) }))) : null,
        h('div', { class: 'dash-editbar-actions' },
          button('Standaardindeling', { size: 'sm', variant: 'ghost', onClick: () => save(state.defaultLayout.map((w) => ({ ...w }))) }),
          button('Klaar', { size: 'sm', variant: 'primary', onClick: () => setEditing(false) })));
    }
    if (!layout.length) {
      mount(grid, h('div', { class: 'card dash-empty' }, emptyState({ icon: 'grid', compact: true, title: 'Je dashboard is leeg', text: 'Voeg blokken toe via “Dashboard aanpassen”.' })));
      return;
    }
    mount(grid, layout.map((w, i) => card(w, i, titleOf(w.id))));
  }

  function move(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= layout.length) return;
    const next = layout.slice();
    [next[i], next[j]] = [next[j], next[i]];
    save(next).then(() => grid.querySelectorAll('.dash-card')[j]?.querySelector('.dash-grip')?.focus());
  }

  function card(w, i, title) {
    const data = state.data[w.id];
    const el = h('section', { class: `dash-card is-${w.size}${editing ? ' is-editing' : ''}`, 'aria-labelledby': `dash-${w.id}`, dataset: { widget: w.id } },
      h('header', { class: 'dash-card-head' },
        editing ? h('button', {
          type: 'button', class: 'dash-grip', 'aria-label': `${title} verplaatsen (pijltjes omhoog/omlaag)`, title: 'Slepen of pijltjestoetsen',
          onKeydown: (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); move(i, -1); } if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); move(i, 1); } },
        }, icon('grid')) : null,
        h('h2', { id: `dash-${w.id}` }, title),
        editing ? h('div', { class: 'dash-tools' },
          button('', { icon: 'chevronDown', variant: 'ghost', size: 'sm', class: 'btn btn-ghost btn-sm btn-icon is-up', 'aria-label': `${title} omhoog`, disabled: i === 0, onClick: () => move(i, -1) }),
          button('', { icon: 'chevronDown', variant: 'ghost', size: 'sm', 'aria-label': `${title} omlaag`, disabled: i === layout.length - 1, onClick: () => move(i, 1) }),
          button(w.size === 'wide' ? 'Smal' : 'Breed', { variant: 'ghost', size: 'sm', 'aria-label': `${title} ${w.size === 'wide' ? 'smaller' : 'breder'} maken`, onClick: () => save(layout.map((x, k) => (k === i ? { ...x, size: x.size === 'wide' ? 'normal' : 'wide' } : x))) }),
          button('Verbergen', { icon: 'x', variant: 'ghost', size: 'sm', 'aria-label': `${title} verbergen`, onClick: () => save(layout.filter((_, k) => k !== i)) })) : null),
      h('div', { class: 'dash-card-body' }, data ? (RENDER[w.id]?.(data) || null) : h('p', { class: 'small muted' }, 'Laden…')));
    if (editing) {
      el.draggable = true;
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); el.classList.add('is-dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('is-dragging'));
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('is-drop'); });
      el.addEventListener('dragleave', () => el.classList.remove('is-drop'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('is-drop');
        const from = Number(e.dataTransfer.getData('text/plain'));
        if (!Number.isInteger(from) || from === i) return;
        const next = layout.slice();
        const [it] = next.splice(from, 1);
        next.splice(i, 0, it);
        save(next);
      });
    }
    return el;
  }

  await load();
}

// ---------- Weergave per blok ----------

const row = (href, main, sub, side) => h('a', { class: 'dash-row', href, 'data-nav': true }, h('div', { class: 'dash-row-main' }, h('div', { class: 'truncate' }, main), sub ? h('div', { class: 'small muted truncate' }, sub) : null), side ? h('div', { class: 'dash-row-side small muted' }, side) : null);
const empty = (text) => h('p', { class: 'dash-empty-text small muted' }, text);
const more = (href, text) => h('a', { class: 'dash-more small', href, 'data-nav': true }, text, icon('chevronRight'));

const RENDER = {
  tasks: (d) => [
    d.items.length ? h('div', { class: 'dash-list' }, d.items.map((t) => row(`/video/${t.videoId}?v=${t.versionId}&c=${t.commentId}`,
      [t.timecode !== null && t.timecode !== undefined ? h('span', { class: 'mono dash-tc' }, timecode(t.timecode)) : null, ' ', t.body || 'Tekening'],
      `${t.videoTitle} · versie ${t.versionNumber} · ${t.projectName}`,
      t.task?.dueDate ? `uiterlijk ${t.task.dueDate.split('-').reverse().join('-')}` : t.statusLabel))) : empty('Geen open taken voor jou.'),
    more('/taken', d.total ? `Alle taken (${d.total})` : 'Mijn taken'),
  ],
  feedback: (d) => (d.items.length ? h('div', { class: 'dash-list' }, d.items.map((f) => row(`/video/${f.videoId}?v=${f.versionId}`,
    [h('strong', {}, f.reviewerName), f.verified ? ' (akkoordgever)' : '', ` verstuurde ${plural(f.commentCount, 'reactie', 'reacties')}`],
    `${f.videoTitle} · versie ${f.versionNumber} · ${f.projectName}`, h('span', { title: formatDate(f.at) }, relativeDate(f.at))))) : empty('Geen nieuwe feedback in de afgelopen 30 dagen.')),
  waiting: (d) => (d.items.length ? h('div', { class: 'dash-list' }, d.items.map((v) => row(`/video/${v.videoId}?v=${v.versionId}`,
    `${v.videoTitle} · versie ${v.versionNumber}`, v.projectName,
    v.deadline ? h('span', { class: isPast(v.deadline) ? 'warn-text' : '' }, `vóór ${formatDeadline(v.deadline)}`) : h('span', { title: formatDate(v.sharedAt) }, `gedeeld ${relativeDate(v.sharedAt)}`)))) : empty('Er wacht niets op de klant.')),
  recent: (d) => [
    d.items.length ? h('div', { class: 'dash-list' }, d.items.map((p) => row(`/projecten/${p.id}`, p.name, [p.clientName, plural(p.videoCount, 'video', 'video’s')].filter(Boolean).join(' · '),
      h('span', { title: formatDate(p.lastActivityAt) }, relativeDate(p.lastActivityAt))))) : empty('Nog geen projecten.'),
    more('/projecten', 'Alle projecten'),
  ],
  activity: (d) => (d.items.length ? h('div', { class: 'dash-list' }, d.items.map((a) => row(`/projecten/${a.projectId}/activiteit`,
    [h('strong', {}, a.label), a.videoTitle ? ` · ${a.videoTitle}${a.versionNumber ? ` (v${a.versionNumber})` : ''}` : ''],
    `${a.projectName} · ${a.sourceLabel}`, h('span', { title: formatDate(a.at) }, relativeDate(a.at))))) : empty('Nog geen klantactiviteit.')),
  uploads: (d) => [
    d.items.length ? h('div', { class: 'dash-list' }, d.items.map((u) => h('div', { class: 'dash-row' }, h('div', { class: 'dash-row-main' }, h('div', { class: 'truncate' }, u.name),
      h('div', { class: 'small muted' }, `${Math.round((u.received / Math.max(1, u.size)) * 100)}% van ${formatBytes(u.size)} · ${relativeDate(u.updatedAt)}`))))) : empty('Geen lopende uploads.'),
    d.processing?.length ? h('div', { class: 'dash-list' }, d.processing.map((p) => h('div', { class: 'dash-row' }, h('div', { class: 'dash-row-main' }, h('div', { class: 'truncate' }, p.title), h('div', { class: 'small muted' }, p.text))))) : null,
  ],
  storage: (d) => {
    if (!d.ok) return h('p', { class: 'small warn-text' }, d.reason);
    const pct = d.disk ? Math.round(((d.disk.total - d.disk.free) / d.disk.total) * 100) : 0;
    const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-bar' }));
    bar.firstChild.style.width = `${pct}%`;
    return [bar, h('p', { class: 'small muted' }, `${formatBytes(d.disk.free)} vrij van ${formatBytes(d.disk.total)} · Studio Review gebruikt ${formatBytes(d.usage?.bytes || 0)}`), more('/instellingen/opslag', 'Opslag & back-ups')];
  },
};
