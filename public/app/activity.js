// Klantactiviteit per project: passieve signalen via klantlinks (geopend, afspelen gestart,
// download aangevraagd). Gescheiden van formele acties zoals feedback versturen en goedkeuren.
import { h, mount, icon, button, api, emptyState, errorState, formatDate, plural, skeletonRows } from '/shared/util.js';

const TYPE_ICON = { portal_opened: 'globe', review_opened: 'eye', playback_started: 'play', delivery_opened: 'package', download_requested: 'download' };

export async function viewActivity({ project, host }) {
  const params = new URLSearchParams(location.search);
  const state = { type: params.get('soort') || '', video: params.get('video') || '' };
  const filters = h('div', { class: 'fb-filters' });
  const list = h('div', { class: 'act-list' });
  let data = null;
  let items = [];

  const sync = () => {
    const q = new URLSearchParams();
    if (state.type) q.set('soort', state.type);
    if (state.video) q.set('video', state.video);
    history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
  };
  const select = (label, key, options) => {
    const el = h('select', { 'aria-label': label }, options.map(([v, l]) => h('option', { value: v }, l)));
    el.value = state[key];
    el.addEventListener('change', () => { state[key] = el.value; sync(); load(); });
    return h('label', { class: 'fb-filter' }, h('span', { class: 'small muted' }, label), el);
  };
  function drawFilters() {
    const counts = data?.counts || {};
    mount(filters,
      select('Gebeurtenis', 'type', [['', 'Alle gebeurtenissen'], ...Object.entries(data?.types || {}).map(([k, l]) => [k, `${l} (${counts[k] || 0})`])]),
      select('Video', 'video', [['', 'Alle video’s'], ...(data?.videos || []).map((v) => [String(v.id), v.title])]));
  }

  async function load(more = false) {
    if (!more) mount(list, skeletonRows(4));
    const q = new URLSearchParams();
    if (state.type) q.set('type', state.type);
    if (state.video) q.set('video', state.video);
    if (more && items.length) q.set('before', String(items.at(-1).id));
    try {
      data = await api('GET', `/api/projects/${project.id}/activity?${q}`);
    } catch (err) { mount(list, errorState(err, () => load())); return; }
    items = more ? [...items, ...data.items] : data.items;
    drawFilters();
    if (!items.length) {
      mount(list, h('div', { class: 'card' }, emptyState({ icon: 'activity', compact: true,
        title: state.type || state.video ? 'Niets gevonden met deze filters' : 'Nog geen klantactiviteit',
        text: 'Hier verschijnt wanneer een klant het portaal, een reviewpagina of de opleverpagina opent, afspelen start of een download aanvraagt.' })));
      return;
    }
    // Per dag gegroepeerd, nieuwste eerst.
    const days = new Map();
    for (const a of items) {
      const day = new Date(a.at).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(a);
    }
    mount(list,
      [...days].map(([day, rows]) => h('section', { class: 'act-day' }, h('h3', { class: 'act-day-head small muted' }, day), h('ol', { class: 'act-rows' }, rows.map(row)))),
      data.more ? button('Oudere activiteit laden', { size: 'sm', onClick: () => load(true) }) : null);
  }

  function row(a) {
    const time = new Date(a.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    return h('li', { class: `act-row is-${a.type}` },
      h('time', { class: 'act-time small', datetime: a.at, title: formatDate(a.at) }, time),
      h('span', { class: 'act-icon' }, icon(TYPE_ICON[a.type] || 'info')),
      h('div', { class: 'act-main' },
        h('div', {}, h('strong', {}, a.label),
          a.video ? [' · ', h('a', { href: `/video/${a.video.id}`, 'data-nav': true }, a.video.title)] : null,
          a.versionNumber ? h('span', { class: 'ver-chip' }, `Versie ${a.versionNumber}`) : null),
        h('div', { class: 'small muted' }, a.sourceLabel,
          a.source === 'approver_link' ? h('span', { class: 'act-note' }, ' · laat niet zien wie er achter het scherm zat') : null,
          a.visitorName ? [' · ', h('span', { title: 'Deze naam typte de bezoeker zelf in; hij is niet gecontroleerd.' }, `“${a.visitorName}” (opgegeven naam, niet geverifieerd)`)] : null)));
  }

  mount(host,
    h('div', { class: 'notice notice-info fb-intro' }, icon('info'), h('div', {},
      h('div', {}, h('strong', {}, 'Wat dit overzicht wel en niet zegt. '), 'Dit zijn signalen die de server via klantlinks waarnam. Ze veranderen nooit een status, taak of goedkeuring. Feedback en goedkeuringen staan in de geschiedenis van elke versie.'),
      h('ul', { class: 'act-legend small' },
        h('li', {}, h('strong', {}, 'Afspelen gestart'), ' betekent niet dat de video volledig is bekeken.'),
        h('li', {}, h('strong', {}, 'Download aangevraagd'), ' betekent niet dat het bestand is opgeslagen.'),
        h('li', {}, h('strong', {}, 'Via akkoordlink van …'), ' zegt welke link is gebruikt, niet wie er keek.'),
        h('li', {}, 'Thumbnails, voorladen, het teamvoorbeeld en ingelogde teamleden tellen niet mee. Herhalingen binnen korte tijd tellen één keer.')))),
    filters, list,
    h('p', { class: 'small muted act-retention' }, icon('clock'), ' ', h('span', { id: 'act-retention' }, '')));
  drawFilters();
  await load();
  const r = document.getElementById('act-retention');
  if (r && data) r.textContent = `Klantactiviteit wordt ${plural(data.retentionDays, 'dag', 'dagen')} bewaard en daarna automatisch opgeruimd. Een beheerder kan dit wijzigen bij Opslag & back-ups.`;
}
