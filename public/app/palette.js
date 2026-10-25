// Opdrachtbalk (⌘K op de Mac, Ctrl+K elders): zoeken in toegankelijke projecten, video's en taken,
// direct naar een resultaat gaan of een toegestane actie starten (zoals uploaden).
// - De server beperkt elke zoekopdracht tot je eigen projecten (en voor freelancers tot geldige
//   koppelingen); er worden geen recente resultaten in de browser bewaard.
// - Acties komen van het scherm dat openstaat en bestaan alleen als je ze daar ook mag doen; ze roepen
//   dezelfde functies aan als de knoppen, dus bevestigingen blijven gewoon bestaan.
// - Volledig met het toetsenbord: pijltjes, Enter, Escape (focus gaat terug naar waar je was).
import { h, mount, icon, api } from '/shared/util.js';

let contextActions = [];
let ctx = null;
let openState = null;

/** Acties van het huidige scherm (bij elke navigatie opnieuw gezet). */
export function setPaletteActions(list) { contextActions = list.filter(Boolean); }

/** Eenmalig aanzetten: sneltoets en wat er standaard in staat. */
export function initPalette({ navigate, session }) {
  ctx = { navigate, session };
  if (initPalette.done) return;
  initPalette.done = true;
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      // Niet over een ander dialoogvenster heen.
      if (document.querySelector('dialog[open]:not(.palette)')) return;
      e.preventDefault();
      if (openState) openState.close(); else openPalette();
    }
  });
}

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const paletteShortcut = () => (isMac() ? '⌘K' : 'Ctrl+K');

function globalActions() {
  const { navigate, session } = ctx;
  const go = (label, path, ic, keywords = '') => ({ label, icon: ic, group: 'Ga naar', keywords, run: () => navigate(path) });
  if (session.user.role === 'freelancer') {
    return [go('Mijn projecten', '/', 'folder'), go('Inbox', '/inbox', 'inbox', 'meldingen'), go('Mijn account', '/account', 'users', 'wachtwoord thema')];
  }
  return [
    go('Dashboard', '/', 'grid', 'start home'),
    go('Projecten', '/projecten', 'folder'),
    go('Klanten', '/klanten', 'users'),
    go('Inbox', '/inbox', 'inbox', 'meldingen'),
    go('Mijn taken', '/taken', 'tasks', 'feedback'),
    go('Instellingen', '/instellingen', 'wrench', 'account team merken opslag back-up'),
  ];
}

export function openPalette() {
  if (!ctx || openState) return;
  const returnFocus = document.activeElement;
  const freelancer = ctx.session.user.role === 'freelancer';
  const input = h('input', {
    type: 'text', class: 'palette-input', placeholder: freelancer ? 'Zoek een project of video…' : 'Zoek een project, video of taak, of typ een actie…',
    'aria-label': 'Opdracht of zoekterm', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false',
  });
  const list = h('div', { class: 'palette-list', id: 'palette-list', role: 'listbox', 'aria-label': 'Resultaten' });
  const status = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const dialog = h('dialog', { class: 'palette', 'aria-label': 'Opdrachtbalk' },
    h('div', { class: 'palette-head' }, icon('search'), input, h('kbd', { class: 'palette-kbd' }, 'Esc')),
    list, status,
    h('div', { class: 'palette-foot small muted' }, h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' kiezen'), h('span', {}, h('kbd', {}, 'Enter'), ' openen'), h('span', {}, h('kbd', {}, 'Esc'), ' sluiten')));
  let items = [];
  let active = 0;
  let seq = 0;
  let timer = null;
  let remote = {};

  const match = (a, q) => !q || `${a.label} ${a.keywords || ''}`.toLowerCase().includes(q);
  function draw() {
    const q = input.value.trim().toLowerCase();
    const actions = [...contextActions.map((a) => ({ ...a, group: a.group || 'Acties' })), ...globalActions()].filter((a) => match(a, q));
    const groups = new Map();
    for (const a of actions) {
      if (!groups.has(a.group)) groups.set(a.group, []);
      groups.get(a.group).push({ label: a.label, sub: a.sub, icon: a.icon, run: a.run });
    }
    for (const [key, label, ic] of [['projects', 'Projecten', 'folder'], ['videos', 'Video’s', 'film'], ['tasks', 'Mijn taken', 'tasks']]) {
      const g = remote[key];
      if (g?.length) groups.set(label, g.map((r) => ({ label: r.title, sub: r.sub, icon: ic, run: () => ctx.navigate(r.href) })));
    }
    items = [];
    const parts = [];
    for (const [label, rows] of groups) {
      parts.push(h('div', { class: 'palette-group', role: 'presentation' }, label));
      for (const r of rows) {
        const i = items.length;
        items.push(r);
        parts.push(h('div', { class: 'palette-item', role: 'option', id: `pal-${i}`, 'aria-selected': 'false', onClick: () => choose(i), onMousemove: () => { if (active !== i) { active = i; highlight(); } } },
          icon(r.icon || 'arrowRight'), h('span', { class: 'palette-label truncate' }, r.label), r.sub ? h('span', { class: 'palette-sub small muted truncate' }, r.sub) : null));
      }
    }
    if (!items.length) parts.push(h('p', { class: 'palette-empty muted' }, q.length >= 2 ? `Niets gevonden voor “${input.value.trim()}”.` : 'Typ om te zoeken.'));
    mount(list, parts);
    active = Math.min(active, Math.max(0, items.length - 1));
    highlight();
    status.textContent = items.length ? `${items.length} resultaten` : 'Geen resultaten';
  }
  function highlight() {
    list.querySelectorAll('.palette-item').forEach((el, i) => { el.classList.toggle('is-active', i === active); el.setAttribute('aria-selected', String(i === active)); });
    if (items.length) {
      input.setAttribute('aria-activedescendant', `pal-${active}`);
      document.getElementById(`pal-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  async function searchRemote() {
    const q = input.value.trim();
    const mine = ++seq;
    if (q.length < 2) { remote = {}; draw(); return; }
    try {
      if (freelancer) {
        const r = await api('GET', `/api/freelance/search?q=${encodeURIComponent(q)}`);
        if (mine === seq) remote = { projects: r.groups.projects.items, videos: r.groups.videos.items };
      } else {
        const [r, tasks] = await Promise.all([
          api('GET', `/api/search?q=${encodeURIComponent(q)}&types=projects,videos&limit=6`),
          api('GET', '/api/my/tasks').catch(() => ({ items: [] })),
        ]);
        const lq = q.toLowerCase();
        const t = tasks.items.filter((i) => `${i.body || ''} ${i.videoTitle || ''} ${i.projectName || ''}`.toLowerCase().includes(lq)).slice(0, 5)
          .map((i) => ({ title: (i.body || 'Taak').slice(0, 80), sub: [i.videoTitle, `versie ${i.versionNumber}`, i.projectName].filter(Boolean).join(' · '), href: `/video/${i.videoId}?v=${i.versionId}&c=${i.commentId}` }));
        if (mine === seq) remote = { projects: r.groups.projects?.items || [], videos: r.groups.videos?.items || [], tasks: t };
      }
    } catch { if (mine === seq) remote = {}; }
    if (mine === seq) draw();
  }
  function choose(i) {
    const item = items[i];
    if (!item) return;
    close({ restore: false });
    // Na sluiten uitvoeren: een actie kan zelf een dialoog openen (met de gewone bevestiging).
    setTimeout(() => item.run(), 0);
  }
  function close({ restore = true } = {}) {
    if (!openState) return;
    openState = null;
    clearTimeout(timer);
    dialog.close();
    dialog.remove();
    if (restore && returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }
  input.addEventListener('input', () => { active = 0; draw(); clearTimeout(timer); timer = setTimeout(searchRemote, 160); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { active = (active + 1) % items.length; highlight(); } }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { active = (active - 1 + items.length) % items.length; highlight(); } }
    if (e.key === 'Home') { active = 0; highlight(); }
    if (e.key === 'End') { active = Math.max(0, items.length - 1); highlight(); }
    if (e.key === 'Enter') { e.preventDefault(); choose(active); }
  });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  openState = { close };
  draw();
  input.focus();
}
