// Globaal zoeken: in projecten en klanten, videotitels, oorspronkelijke bestandsnamen, briefings en
// reacties. De server beperkt elke zoekopdracht (ook suggesties en aantallen) tot de projecten waar
// je toegang toe hebt. Zoekopdrachten kun je bewaren; die worden bij gebruik opnieuw uitgevoerd.
import { h, mount, icon, button, api, toast, openDialog, field, emptyState, errorState, skeletonRows } from '/shared/util.js';

export const GROUPS = [
  ['projects', 'Projecten en klanten', 'folder'],
  ['videos', 'Video’s', 'film'],
  ['files', 'Bestandsnamen', 'doc'],
  ['briefing', 'Briefing', 'clipboard'],
  ['comments', 'Reacties', 'chat'],
];

const mark = (text, q) => {
  const t = String(text || '');
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return t;
  return [t.slice(0, i), h('mark', {}, t.slice(i, i + q.length)), t.slice(i + q.length)];
};

/** Zoekveld in de zijbalk met suggesties (pijltjes + Enter, Escape sluit). */
export function searchBox({ navigate, onShortcut = null, shortcutLabel = '/' }) {
  const input = h('input', { type: 'search', placeholder: 'Zoeken…', 'aria-label': 'Zoeken in projecten, video’s, bestanden, briefings en reacties', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'search-suggest', 'aria-autocomplete': 'list' });
  const list = h('div', { class: 'search-suggest', id: 'search-suggest', role: 'listbox', hidden: true });
  let items = [];
  let active = -1;
  let timer;
  let seq = 0;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const open = (href) => { close(); input.blur(); navigate(href); };
  function draw(q, groups) {
    items = [];
    const parts = [];
    for (const [key, label] of GROUPS) {
      const g = groups[key];
      if (!g?.items.length) continue;
      parts.push(h('div', { class: 'suggest-head' }, label));
      for (const it of g.items.slice(0, 3)) {
        const idx = items.length;
        items.push(it.href);
        parts.push(h('a', { class: 'suggest-item', href: it.href, role: 'option', id: `sugg-${idx}`, 'data-nav': true, onClick: (e) => { e.preventDefault(); open(it.href); } },
          h('span', { class: 'truncate' }, mark(it.title, q)), h('span', { class: 'small muted truncate' }, it.snippet ? mark(it.snippet, q) : it.sub)));
      }
    }
    const all = `/zoeken?q=${encodeURIComponent(q)}`;
    items.push(all);
    parts.push(h('a', { class: 'suggest-item suggest-all', href: all, role: 'option', id: `sugg-${items.length - 1}`, onClick: (e) => { e.preventDefault(); open(all); } }, icon('search'), `Alle resultaten voor “${q}”`));
    mount(list, parts);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  const highlight = () => {
    list.querySelectorAll('.suggest-item').forEach((el, i) => el.classList.toggle('is-active', i === active));
    if (active >= 0) input.setAttribute('aria-activedescendant', `sugg-${active}`); else input.removeAttribute('aria-activedescendant');
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const r = await api('GET', `/api/search?q=${encodeURIComponent(q)}&limit=3`);
        if (mine === seq && input.value.trim() === q) draw(q, r.groups);
      } catch { /* suggesties zijn niet kritisch */ }
    }, 180);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown' && !list.hidden) { e.preventDefault(); active = Math.min(items.length - 1, active + 1); highlight(); }
    if (e.key === 'ArrowUp' && !list.hidden) { e.preventDefault(); active = Math.max(-1, active - 1); highlight(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (active >= 0 && items[active]) open(items[active]);
      else if (q.length >= 2) open(`/zoeken?q=${encodeURIComponent(q)}`);
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  // Sneltoets "/" vanuit de pagina
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest?.('input, textarea, select, [contenteditable], dialog') && !document.querySelector('dialog[open]')) { e.preventDefault(); input.focus(); }
  });
  // Met opdrachtbalk: de sneltoetsknop opent die (⌘K/Ctrl+K); "/" focust gewoon het zoekveld.
  const kbd = onShortcut
    ? h('button', { type: 'button', class: 'side-kbd kbd-btn', title: `Opdrachtbalk (${shortcutLabel})`, 'aria-label': `Opdrachtbalk openen (${shortcutLabel})`, onClick: onShortcut }, shortcutLabel)
    : h('kbd', { class: 'side-kbd', 'aria-hidden': 'true' }, '/');
  return h('div', { class: 'side-search' }, icon('search'), input, kbd, list);
}

/** Resultatenpagina /zoeken. */
export async function viewSearch(ctx) {
  const { pageEl, pageHeader } = ctx;
  const params = new URLSearchParams(location.search);
  const state = { q: params.get('q') || '', types: (params.get('in') || '').split(',').filter((t) => GROUPS.some(([k]) => k === t)) };
  document.title = `Zoeken${state.q ? `: ${state.q}` : ''} — Studio Review`;
  const input = h('input', { type: 'search', value: state.q, placeholder: 'Waar zoek je naar?', 'aria-label': 'Zoekterm', autofocus: true });
  const chips = h('div', { class: 'segmented search-types', role: 'group', 'aria-label': 'Zoeken in' });
  const results = h('div', { class: 'search-results', 'aria-live': 'polite' });
  const savedEl = h('div', { class: 'saved-searches' });

  const sync = () => {
    const q = new URLSearchParams();
    if (state.q) q.set('q', state.q);
    if (state.types.length) q.set('in', state.types.join(','));
    history.replaceState(null, '', `/zoeken${q.toString() ? `?${q}` : ''}`);
  };
  function drawChips() {
    mount(chips, h('button', { type: 'button', 'aria-pressed': String(!state.types.length), onClick: () => { state.types = []; sync(); drawChips(); run(); } }, 'Alles'),
      GROUPS.map(([key, label]) => h('button', {
        type: 'button', 'aria-pressed': String(state.types.includes(key)),
        onClick: () => { state.types = state.types.includes(key) ? state.types.filter((t) => t !== key) : [...state.types, key]; sync(); drawChips(); run(); },
      }, label)));
  }
  async function loadSaved() {
    const saved = await api('GET', '/api/saved-searches').catch(() => []);
    mount(savedEl, saved.length ? [h('span', { class: 'small muted' }, 'Bewaard:'), saved.map((s) => h('span', { class: 'saved-chip' },
      h('a', { href: `/zoeken?q=${encodeURIComponent(s.query)}${s.filters.types?.length ? `&in=${s.filters.types.join(',')}` : ''}`, 'data-nav': true }, s.name),
      h('button', { type: 'button', class: 'saved-del', 'aria-label': `Bewaarde zoekopdracht “${s.name}” verwijderen`, onClick: async () => {
        try { await api('DELETE', `/api/saved-searches/${s.id}`); loadSaved(); } catch (err) { toast(err.message, 'error'); }
      } }, icon('x'))))] : null);
  }
  async function run() {
    if (state.q.trim().length < 2) {
      mount(results, h('div', { class: 'card' }, emptyState({ icon: 'search', compact: true, title: 'Zoek in al je projecten', text: 'Typ minstens twee tekens. Je vindt projecten, klanten, videotitels, oorspronkelijke bestandsnamen, briefings en reacties uit projecten waar je toegang toe hebt.' })));
      return;
    }
    mount(results, skeletonRows(3));
    let r;
    try {
      r = await api('GET', `/api/search?q=${encodeURIComponent(state.q)}&limit=25${state.types.length ? `&types=${state.types.join(',')}` : ''}`);
    } catch (err) { mount(results, errorState(err, run)); return; }
    const groups = GROUPS.filter(([k]) => r.groups[k]?.total);
    if (!groups.length) {
      mount(results, h('div', { class: 'card' }, emptyState({ icon: 'search', compact: true, title: `Niets gevonden voor “${r.q}”`, text: state.types.length ? 'Probeer “Alles” of een andere zoekterm.' : 'Probeer een andere zoekterm.' })));
      return;
    }
    mount(results, groups.map(([key, label, ic]) => {
      const g = r.groups[key];
      return h('section', { class: 'search-group', 'aria-labelledby': `sg-${key}` },
        h('h2', { id: `sg-${key}`, class: 'search-group-head' }, icon(ic), label, h('span', { class: 'seg-count' }, g.total)),
        h('div', { class: 'search-list' }, g.items.map((it) => h('a', { class: 'search-item', href: it.href, 'data-nav': true },
          h('div', { class: 'search-item-title' }, h('span', { class: 'truncate' }, mark(it.title, r.q)),
            it.internal ? h('span', { class: 'badge badge-internal' }, 'intern') : null, it.archived ? h('span', { class: 'badge badge-neutral' }, 'archief') : null),
          it.snippet ? h('div', { class: 'small search-snippet' }, mark(it.snippet, r.q)) : null,
          h('div', { class: 'small muted truncate' }, it.sub)))),
        g.total > g.items.length ? h('p', { class: 'small muted' }, `${g.items.length} van ${g.total} getoond. Verfijn je zoekterm om meer te vinden.`) : null);
    }));
  }
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = input.value.trim(); sync(); run(); }, 250); });
  const saveBtn = button('Zoekopdracht bewaren', { icon: 'plus', size: 'sm', variant: 'ghost', onClick: async () => {
    if (state.q.length < 2) { toast('Typ eerst een zoekterm.', 'error'); return; }
    const name = h('input', { type: 'text', maxlength: '80', value: state.q, required: true, autofocus: true });
    await openDialog({
      title: 'Zoekopdracht bewaren',
      body: [field('Naam', name, 'Alleen voor jou. De resultaten worden bij gebruik opnieuw opgezocht, met je actuele rechten.')],
      actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Bewaren'))],
      onSubmit: async () => {
        try { await api('POST', '/api/saved-searches', { name: name.value, query: state.q, filters: { types: state.types } }); toast('Zoekopdracht bewaard', 'success'); loadSaved(); } catch (err) { toast(err.message, 'error'); return false; }
      },
    });
  } });
  mount(pageEl, h('div', { class: 'page page-narrow search-page' },
    pageHeader({ title: 'Zoeken', actions: saveBtn }),
    h('div', { class: 'search-big' }, icon('search'), input),
    chips, savedEl, results));
  drawChips();
  loadSaved();
  await run();
}
