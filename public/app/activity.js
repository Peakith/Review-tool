// Klantactiviteit per project als één tijdlijn: passieve signalen via klantlinks (geopend, afspelen
// gestart, download aangevraagd) en de formele acties die al vastliggen (feedback verstuurd,
// goedkeuring gegeven). Eigen testbezoeken van ingelogde teamleden staan apart en standaard uit.
import { h, mount, icon, button, api, emptyState, errorState, formatDateZone, plural, skeletonRows } from '/shared/util.js';

const TYPE_ICON = {
  portal_opened: 'globe', review_opened: 'eye', playback_started: 'play', delivery_opened: 'package', download_requested: 'download',
  feedback_sent: 'send', approval_given: 'checkCircle',
};

export async function viewActivity({ project, host }) {
  const params = new URLSearchParams(location.search);
  const state = { type: params.get('soort') || '', video: params.get('video') || '', team: params.get('team') === '1' };
  const filters = h('div', { class: 'fb-filters' });
  const active = h('div', { class: 'act-active', 'aria-live': 'polite' });
  const list = h('div', { class: 'act-list' });
  const refreshed = h('span', { class: 'small muted' });
  let data = null;
  let items = [];

  const sync = () => {
    const q = new URLSearchParams();
    if (state.type) q.set('soort', state.type);
    if (state.video) q.set('video', state.video);
    if (state.team) q.set('team', '1');
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
    const team = h('input', { type: 'checkbox', checked: state.team });
    team.addEventListener('change', () => { state.team = team.checked; sync(); load(); });
    mount(filters,
      select('Gebeurtenis', 'type', [['', 'Alle gebeurtenissen'], ...Object.entries(data?.types || {}).map(([k, l]) => [k, `${l} (${counts[k] || 0})`])]),
      select('Video', 'video', [['', 'Alle video’s'], ...(data?.videos || []).map((v) => [String(v.id), v.title])]),
      h('label', { class: 'check fb-filter act-team' }, team, `Eigen teambezoeken tonen${data?.teamVisits ? ` (${data.teamVisits})` : ''}`));
    // Actieve filters altijd zichtbaar, met één klik te wissen.
    const chips = [];
    if (state.type) chips.push(['type', `Gebeurtenis: ${data?.types?.[state.type] || state.type}`]);
    if (state.video) chips.push(['video', `Video: ${data?.videos?.find((v) => String(v.id) === state.video)?.title || 'onbekend'}`]);
    if (state.team) chips.push(['team', 'Inclusief eigen teambezoeken']);
    mount(active, chips.length ? [h('span', { class: 'small muted' }, 'Gefilterd op:'),
      chips.map(([key, label]) => h('span', { class: 'saved-chip' }, label, h('button', { type: 'button', class: 'saved-del', 'aria-label': `Filter “${label}” wissen`, onClick: () => { state[key] = key === 'team' ? false : ''; sync(); load(); } }, icon('x')))),
      chips.length > 1 ? button('Alle filters wissen', { size: 'sm', variant: 'ghost', onClick: () => { state.type = ''; state.video = ''; state.team = false; sync(); load(); } }) : null] : null);
  }

  async function load({ more = false, quiet = false } = {}) {
    if (!more && !quiet) mount(list, skeletonRows(4));
    const q = new URLSearchParams();
    if (state.type) q.set('type', state.type);
    if (state.video) q.set('video', state.video);
    if (state.team) q.set('team', '1');
    if (more && items.length) q.set('before', items.at(-1).at);
    let r;
    try { r = await api('GET', `/api/projects/${project.id}/activity?${q}`); } catch (err) { if (!quiet) mount(list, errorState(err, () => load())); return; }
    data = r;
    items = more ? [...items, ...data.items] : data.items;
    refreshed.textContent = `Bijgewerkt ${new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ververst elke 30 seconden zolang deze pagina openstaat`;
    drawFilters();
    if (!items.length) {
      const filtered = state.type || state.video;
      mount(list, h('div', { class: 'card' }, emptyState({ icon: 'activity', compact: true,
        title: filtered ? 'Niets gevonden met deze filters' : 'Nog geen klantactiviteit',
        text: filtered ? 'Wis de filters hierboven om alles te zien.'
          : `Hier verschijnt wanneer een klant het portaal, een reviewpagina of de opleverpagina opent, afspelen start, een download aanvraagt, feedback verstuurt of goedkeurt.${data.teamVisits && !state.team ? ` Je eigen bezoeken als ingelogd teamlid (${data.teamVisits}) tellen niet mee; vink “Eigen teambezoeken tonen” aan om ze te zien.` : ''}`,
        action: filtered ? button('Filters wissen', { onClick: () => { state.type = ''; state.video = ''; sync(); load(); } }) : null })));
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
      data.more ? button('Oudere activiteit laden', { size: 'sm', onClick: () => load({ more: true }) }) : null);
  }

  function row(a) {
    const time = new Date(a.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    return h('li', { class: `act-row is-${a.type}${a.kind === 'formal' ? ' is-formal' : ''}${a.team ? ' is-team' : ''}` },
      h('time', { class: 'act-time small', datetime: a.at, title: formatDateZone(a.at) }, time),
      h('span', { class: 'act-icon' }, icon(TYPE_ICON[a.type] || 'info')),
      h('div', { class: 'act-main' },
        h('div', {}, h('strong', {}, a.label),
          a.kind === 'formal' ? h('span', { class: 'badge badge-verified act-badge', title: 'Vastgelegde actie (staat ook in de geschiedenis van de versie)' }, 'formeel') : null,
          a.team ? h('span', { class: 'badge badge-neutral act-badge' }, 'teambezoek') : null,
          a.video ? [' · ', h('a', { href: a.href || `/video/${a.video.id}`, 'data-nav': true }, a.video.title)] : null,
          a.versionNumber ? h('span', { class: 'ver-chip' }, `Versie ${a.versionNumber}`) : null),
        h('div', { class: 'small muted' }, a.sourceLabel,
          a.detail ? ` · ${a.detail}` : null,
          a.kind !== 'formal' && a.source === 'approver_link' ? h('span', { class: 'act-note' }, ' · laat niet zien wie er achter het scherm zat') : null,
          a.visitorName && a.kind === 'formal' && a.visitorNameVerified ? [' · ', h('span', {}, `${a.visitorName} (via persoonlijke link)`)] : null,
          a.visitorName && !a.visitorNameVerified ? [' · ', h('span', { title: 'Deze naam typte de bezoeker zelf in; hij is niet gecontroleerd.' }, `“${a.visitorName}” (opgegeven naam, niet geverifieerd)`)] : null,
          ' · ', h('span', { title: 'Datum en tijd met tijdzone' }, formatDateZone(a.at)))));
  }

  mount(host,
    h('div', { class: 'notice notice-info fb-intro' }, icon('info'), h('div', {},
      h('div', {}, h('strong', {}, 'Wat dit overzicht wel en niet zegt. '), 'Signalen zijn wat de server via klantlinks waarnam; ze veranderen nooit een status, taak of goedkeuring. “Formeel” zijn vastgelegde acties: verstuurde feedback en goedkeuringen.'),
      h('ul', { class: 'act-legend small' },
        h('li', {}, h('strong', {}, 'Afspelen gestart'), ' betekent niet dat de video volledig is bekeken.'),
        h('li', {}, h('strong', {}, 'Download aangevraagd'), ' betekent niet dat het bestand is opgeslagen.'),
        h('li', {}, h('strong', {}, 'Via akkoordlink van …'), ' zegt welke link is gebruikt, niet wie er keek.'),
        h('li', {}, 'Thumbnails, voorladen en het teamvoorbeeld tellen niet mee. Openen of afspelen via dezelfde link binnen 30 minuten (download: 5 minuten) telt één keer, ook als er verschillende mensen achter die link zitten.'),
        h('li', {}, 'Open je als ingelogd teamlid zelf een klantlink, dan is dat een ', h('strong', {}, 'teambezoek'), ': apart gemarkeerd en standaard verborgen.')))),
    filters, active, list,
    h('p', { class: 'small muted act-retention' }, icon('clock'), ' ', h('span', { id: 'act-retention' }, '')),
    h('p', { class: 'small muted' }, refreshed));
  drawFilters();
  await load();
  const r = document.getElementById('act-retention');
  if (r && data) r.textContent = `Signalen worden ${plural(data.retentionDays, 'dag', 'dagen')} bewaard en daarna automatisch opgeruimd (formele acties blijven). Een beheerder kan dit wijzigen bij Opslag & back-ups.`;
  // Automatisch verversen, zolang dit tabblad zichtbaar is en je niet verder terug aan het bladeren bent.
  const path = location.pathname;
  const timer = setInterval(() => {
    if (location.pathname !== path || !document.body.contains(list)) { clearInterval(timer); return; }
    if (document.visibilityState === 'visible' && !(data?.more && items.length > data.items.length)) load({ quiet: true });
  }, 30_000);
}
