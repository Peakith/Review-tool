// Klantportaal. Twee varianten op dezelfde pagina:
//  - /p/<token>: alle gepubliceerde video's van één project (projectlink, ongewijzigd bereik);
//  - /k/<token>: klantportaal per klant: projecten → gepubliceerde video's en opleveringen. Afgeronde
//    projecten staan ingeklapt onderaan. Een persoonlijke link van een akkoordgever toont waar die
//    persoon zelf mag goedkeuren.
// Dezelfde pagina toont het team als voorbeeld (/voorbeeld/project/<id>), gevuld met
// dezelfde serverfilters, zodat het team precies ziet wat de klant ziet.
import { h, mount, icon, api, apiWithRetry, newRequestId, emptyState, timecode, formatDateZone, formatDeadline, isPast } from '/shared/util.js';
import { tr } from '/shared/i18n.js';
import { applyBrand, brandMark } from '/shared/brand.js';
import { clientPill, clientStatusOf, metaLine, fileLabel, fileIcon } from '/shared/client.js';
import { initLang, viewerControls, linkError, fatal as showFatal, expiryNote } from '/review/gate.js';

const root = document.getElementById('root');
const parts = location.pathname.split('/').filter(Boolean);
const preview = parts[0] === 'voorbeeld';
const clientMode = parts[0] === 'k';
const token = parts[1];
const source = preview ? `/api/projects/${encodeURIComponent(parts[2])}/portal-preview`
  : clientMode ? `/api/client/${encodeURIComponent(token)}` : `/api/portal/${encodeURIComponent(token)}`;
const fatal = (title, text, iconName, retry) => showFatal(root, title, text, iconName, retry);
let data = null;

async function load() {
  mount(root, h('div', { class: 'fatal' }, h('div', { class: 'spinner', role: 'status', 'aria-label': tr('Laden') })));
  try {
    data = await api('GET', source);
  } catch (err) {
    if (preview && err.status === 401) return fatal('Log eerst in', 'Deze voorbeeldweergave is alleen voor teamleden. Log in en open het voorbeeld opnieuw vanuit het project.', 'lock');
    if (!preview && linkError(root, err, { kind: clientMode ? 'client' : 'project', token, onUnlocked: load, retry: load })) return;
    return fatal(tr('Laden lukt niet'), err.message, 'alert', load);
  }
  initLang(data.language);
  draw();
}

const draw = () => (clientMode ? renderClient(data) : render(data));

/** Opnieuw ophalen zonder laadscherm; open blokken en scrollpositie blijven staan. */
async function refresh() {
  const openKeys = [...root.querySelectorAll('details[open]')].map((d) => d.className);
  const y = window.scrollY;
  try { data = await api('GET', source); } catch { return load(); }
  draw();
  root.querySelectorAll('details').forEach((d) => { if (openKeys.includes(d.className)) d.open = true; });
  window.scrollTo(0, y);
}

/*
 * Overzicht van de klant: antwoord op "wat moet ik doen, wat gebeurt er nu en wat is klaar?"
 *   1. Jouw acties: alleen concrete acties die deze bezoeker mag doen (een gepubliceerde versie
 *      beoordelen, een gedeelde vraag beantwoorden), per project gegroepeerd, één knop per regel;
 *   2. In behandeling: feedback is verstuurd, het team is aan zet (de klant hoeft niets te doen);
 *   3. Goedgekeurd en afgerond: definitieve bestanden (vrijgegeven), goedgekeurde video's, beantwoorde
 *      vragen en afgeronde projecten; goedkeuren en vrijgeven blijven zichtbaar gescheiden;
 *   4. Alle projecten (ingeklapt; open als er niets te doen is).
 * Elke video staat hooguit één keer in 1–3, als compacte regel. Interne taken komen hier nooit.
 */
const isOpen = (v) => !v.archived && v.version.status === 'in_review';
const deadlineOf = (v) => (isOpen(v) && v.round?.deadline) || null;

/** Volgorde van acties: verstreken deadlines eerst, dan de eerstvolgende deadline, dan de rest. */
function byDeadline(a, b) {
  const da = deadlineOf(a.video);
  const db = deadlineOf(b.video);
  if (da && db) return da.localeCompare(db);
  if (da || db) return da ? -1 : 1;
  return 0;
}

/** Sectie met een rustige kop (titel, korte uitleg) en een lijst. */
function section(key, title, text, body, { count = null } = {}) {
  const id = `sec-${key}`;
  return h('section', { class: `p-group p-group-${key}`, 'aria-labelledby': id },
    h('div', { class: 'p-group-head' },
      h('h2', { id }, title, count ? h('span', { class: 'p-count', 'aria-label': tr('{n} open', { n: count }) }, count) : null),
      text ? h('p', { class: 'p-group-text' }, text) : null),
    body);
}

/** Inklapbaar blok binnen een sectie (standaard dicht). */
function fold(key, title, count, body, { open = false } = {}) {
  return h('details', { class: `p-fold p-group-${key}`, open },
    h('summary', {}, icon('chevronRight'), h('span', { class: 'p-fold-title' }, title), h('span', { class: 'p-count' }, count)),
    h('div', { class: 'p-list' }, body));
}

/** Regels per project groeperen (alleen een kop als er meer dan één project is). */
function byProject(entries, projects, multi, rowOf) {
  if (!multi) return h('div', { class: 'p-list' }, entries.map(rowOf));
  const groups = new Map();
  for (const e of entries) {
    const pid = e.project?.id ?? e.q?.projectId;
    if (!groups.has(pid)) groups.set(pid, []);
    groups.get(pid).push(e);
  }
  const order = projects.map((p) => p.id).filter((id) => groups.has(id));
  return h('div', { class: 'p-project-groups' }, order.map((pid) => {
    const p = projects.find((x) => x.id === pid);
    return h('div', { class: 'p-project-group' },
      h('h3', { class: 'p-project-name', title: p.name }, p.name),
      h('div', { class: 'p-list' }, groups.get(pid).map(rowOf)));
  }));
}

/** De secties van het overzicht, voor één project (projectlink) of meer (klantportaal). */
function startSections(projects, { studio, personal, multi, questions = [], identity = null }) {
  const active = projects.filter((p) => !p.completed);
  const items = active.flatMap((p) => p.videos.map((video) => ({ project: p, video })));
  const actions = items.filter((i) => isOpen(i.video)).sort(byDeadline);
  const activeIds = new Set(active.map((p) => p.id));
  const openQ = questions.filter((q) => q.status === 'open' && (!multi || activeIds.has(q.projectId)));
  const answeredQ = questions.filter((q) => q.status === 'answered');
  const busy = items.filter((i) => !i.video.archived && i.video.version.status === 'changes_requested');
  const approved = items.filter((i) => i.video.version.status === 'approved');
  const released = projects.filter((p) => p.delivery);
  const completed = projects.filter((p) => p.completed);
  const out = [];

  // 1. Jouw acties
  const todo = [...actions.map((i) => ({ project: i.project, row: () => actionRow(i, { personal }) })),
    ...openQ.map((q) => ({ q, row: () => questionRow(q, { identity }) }))];
  out.push(section('todo', tr('Jouw acties'), todo.length ? null : tr('Er wacht nu niets op jou. Zodra er iets voor je klaarstaat, zie je het hier.'),
    todo.length ? byProject(todo, projects, multi, (e) => e.row()) : null, { count: todo.length || null }));

  // 2. In behandeling
  if (busy.length) {
    out.push(section('busy', tr('In behandeling'), tr('Je feedback is verstuurd. {studio} is aan zet; je hoeft nu niets te doen.', { studio }),
      byProject(busy, projects, multi, (i) => statusRow(i, 'busy'))));
  }

  // 3. Goedgekeurd en afgerond
  const doneParts = [];
  if (released.length) {
    doneParts.push(h('div', { class: 'p-subgroup p-group-files' },
      h('h3', { class: 'p-subtitle' }, tr('Definitieve bestanden')),
      h('div', { class: 'p-list' }, released.map((p) => deliveryCard(p.delivery, multi || !p.name ? p.name : null)))));
  }
  if (approved.length) doneParts.push(fold('done', tr('Goedgekeurd'), approved.length, approved.map((i) => statusRow(i, 'approved', { multi }))));
  if (answeredQ.length) doneParts.push(fold('answered', tr('Beantwoorde vragen'), answeredQ.length, answeredQ.map((q) => questionRow(q, { identity }))));
  if (completed.length) {
    doneParts.push(fold('completed', tr(completed.length === 1 ? 'Afgerond project' : 'Afgeronde projecten'), completed.length,
      completed.map((p) => projectBlock(p, { multi: true, pins: null }))));
  }
  if (doneParts.length) {
    out.push(section('finished', tr('Goedgekeurd en afgerond'), released.length && approved.length ? tr('Goedgekeurd betekent akkoord op de video. Downloaden kan zodra het team de definitieve bestanden vrijgeeft.') : null,
      h('div', { class: 'p-finished' }, doneParts)));
  }
  return { out, todoCount: todo.length, busyCount: busy.length };
}

/** Compacte kop: merk, voor wie (klant of project) en kleine persoonlijke opties. */
function header(brand, { title, sub = null }) {
  return h('header', { class: 'r-header p-header' },
    h('div', { class: 'r-header-inner p-header-inner' },
      brandMark(brand),
      h('div', { class: 'p-header-titles' },
        h('h1', { class: 'p-header-title', title }, title),
        sub),
      viewerControls(draw)));
}

function identityLine(d) {
  if (!d.identity?.personal) return null;
  return h('p', { class: 'p-identity', title: tr('Goedkeuren kan bij de video’s waarvoor jij de akkoordgever bent.') }, icon('shield'),
    h('span', {}, tr('Persoonlijke link van {name}', { name: d.identity.name })));
}

function deliveryCard(delivery, projectName) {
  return h('a', { class: 'p-card p-delivery-card', href: delivery.url },
    h('div', { class: 'p-row-icon', 'aria-hidden': 'true' }, icon('package')),
    h('div', { class: 'p-card-body' },
      h('h4', { class: 'p-card-title', title: projectName || '' }, projectName || tr('Definitieve bestanden')),
      h('p', { class: 'p-card-meta' }, tr(delivery.count === 1 ? '{n} bestand vrijgegeven om te downloaden' : '{n} bestanden vrijgegeven om te downloaden', { n: delivery.count }))),
    h('span', { class: 'btn btn-sm btn-secondary' }, icon('download'), h('span', { class: 'btn-label' }, tr('Naar de oplevering'))));
}

function render(d) {
  applyBrand(d.brand);
  const brandName = d.brand?.name;
  document.title = `${d.project.name}${brandName ? ` · ${brandName}` : ''}`;
  const project = { id: 0, name: d.project.name, completed: false, videos: d.videos, delivery: d.delivery, briefing: d.briefing, intro: d.project.intro };
  const { out } = startSections([project], { studio: d.studio || tr('het team'), personal: false, multi: false, questions: d.questions || [] });

  const sections = [];
  if (!d.videos.length && !d.delivery && !(d.questions || []).length) {
    sections.push(h('div', { class: 'p-empty' }, emptyState({
      icon: 'clock', title: tr('Er staan nog geen video’s voor je klaar'),
      text: tr('Bewaar deze link. Zodra het team een video publiceert, verschijnt die hier.'),
    })));
  } else {
    sections.push(...out);
    if (d.videos.length) sections.push(allVideos([project], { single: true }));
  }
  if (d.briefing.length) sections.push(briefingSection(d.briefing, 'group-briefing'));

  mount(root,
    preview ? previewBar(d) : null,
    header(d.brand, { title: d.project.name, sub: d.project.clientName ? h('p', { class: 'p-header-sub' }, d.project.clientName) : null }),
    h('main', { class: 'p-main' },
      d.project.intro ? h('p', { class: 'p-intro' }, d.project.intro) : null,
      d.archived ? h('div', { class: 'notice notice-info' }, icon('history'), tr('Dit project is afgerond en gearchiveerd. Je kunt alles nog bekijken, maar niet meer reageren of goedkeuren.')) : null,
      sections,
      !preview && d.videos.length ? h('p', { class: 'p-export small' }, icon('fileDown'), tr('Alle feedback downloaden:'), h('a', { href: `${source}/export.pdf` }, 'PDF'), h('a', { href: `${source}/export.csv` }, tr('CSV (Excel)'))) : null,
      h('footer', { class: 'p-foot small muted' },
        icon('shield'), h('span', {}, tr('Met deze link kun je bekijken, reageren en feedback versturen. Goedkeuren doet de aangewezen akkoordgever per video via een persoonlijke link.'))),
      preview ? null : expiryNote(d.linkExpiresAt)));
}

/** Klantportaal per klant: eerst wat er van jou gevraagd wordt, daarna de rest. */
function renderClient(d) {
  applyBrand(d.brand);
  document.title = `${d.client.name}${d.brand?.name ? ` · ${d.brand.name}` : ''}`;
  const personal = !!d.identity?.personal;
  const multi = d.projects.length > 1;
  const { out, todoCount, busyCount } = startSections(d.projects, { studio: d.studio || tr('het team'), personal, multi, questions: d.questions || [], identity: personal ? d.identity.name : null });

  const sections = [];
  if (!d.projects.length) {
    sections.push(h('div', { class: 'p-empty' }, emptyState({
      icon: 'clock', title: tr('Er staan nog geen projecten voor je klaar'),
      text: tr('Bewaar deze link. Zodra het team een project met je deelt, verschijnt het hier.'),
    })));
  } else {
    // Niets te doen: de projecten staan dan direct open, zodat alles bereikbaar blijft.
    const all = allVideos(d.projects.filter((p) => !p.completed), { multi, open: !todoCount && !busyCount });
    sections.push(...out, all);
  }

  mount(root,
    header(d.brand, { title: d.client.name, sub: identityLine(d) }),
    h('main', { class: 'p-main' }, sections,
      h('footer', { class: 'p-foot small muted' }, icon('shield'),
        h('span', {}, personal
          ? tr('Deze link is persoonlijk. Deel hem niet: wie hem heeft, kan namens jou goedkeuren.')
          : tr('Met deze link kun je bekijken, reageren en feedback versturen. Goedkeuren doet de aangewezen akkoordgever per video via een persoonlijke link.'))),
      expiryNote(d.linkExpiresAt)));
}

/**
 * Optioneel vastzetten voor klanten: alleen in deze browser (geen account), per link. Vastgezette
 * projecten staan bovenaan "Alle projecten"; de acties bovenaan de pagina gaan altijd voor.
 */
const pinKey = `rt-client-pins:${token}`;
function readPins() {
  try { return new Set(JSON.parse(localStorage.getItem(pinKey) || '[]').map(Number)); } catch { return new Set(); }
}
function writePins(set) {
  try { localStorage.setItem(pinKey, JSON.stringify([...set])); } catch { /* opslag geblokkeerd: dan alleen voor deze weergave */ }
}

function clientPin(p, pins, onChange) {
  const btn = h('button', { type: 'button', class: 'pin-btn is-compact' });
  const drawPin = () => {
    const on = pins.has(p.id);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? tr('{name} losmaken', { name: p.name }) : tr('{name} vastzetten', { name: p.name }));
    btn.title = on ? tr('Vastgezet in deze browser. Klik om los te maken.') : tr('Vastzetten in deze browser (bovenaan dit overzicht)');
    mount(btn, icon('star'));
  };
  drawPin();
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (pins.has(p.id)) pins.delete(p.id); else pins.add(p.id);
    writePins(pins);
    drawPin();
    onChange();
  });
  return btn;
}

/** Kleine projectcover (alleen uit gedeelde versies; de server levert niets anders aan klanten). */
function smallCover(p) {
  if (!p.cover) return h('span', { class: 'k-cover is-empty', 'aria-hidden': 'true' }, icon('folder'));
  const img = h('img', { src: p.cover.url, alt: '', loading: 'lazy', decoding: 'async' });
  const box = h('span', { class: 'k-cover', 'aria-hidden': 'true' }, img);
  img.addEventListener('error', () => mount(box, icon('folder')));
  return box;
}

/** Eén project: kop met kleine cover en naam, daaronder de video's als compacte regels en de briefing. */
function projectBlock(p, { multi = false, pins = null, onPin = null, single = false } = {}) {
  const id = `proj-${p.id}`;
  return h('section', { class: 'k-project', 'aria-labelledby': id },
    single ? null : h('div', { class: 'k-project-head' },
      smallCover(p),
      h('div', { class: 'k-project-titles' },
        h('h3', { id, title: p.name }, p.name),
        h('span', { class: 'small muted' }, [tr(p.videos.length === 1 ? '{n} video' : '{n} video’s', { n: p.videos.length }), multi && p.brand ? p.brand.name : null, p.archived ? tr('gearchiveerd') : null].filter(Boolean).join(' · '))),
      pins && multi ? clientPin(p, pins, onPin) : null),
    p.intro && !single ? h('p', { class: 'p-intro' }, p.intro) : null,
    p.videos.length ? h('div', { class: 'p-list' }, p.videos.map((v) => statusRow({ project: p, video: v }, 'any')))
      : h('p', { class: 'small muted' }, tr('Er staan in dit project nog geen video’s voor je klaar.')),
    !single && p.briefing?.length ? briefingSection(p.briefing, `${id}-briefing`, 4) : null);
}

/** Route naar alles wat deze link mag zien: per project alle gepubliceerde video's, met briefing. */
function allVideos(projects, { single = false, multi = false, open = false } = {}) {
  const pins = single ? new Set() : readPins();
  const ordered = [...projects].sort((a, b) => Number(pins.has(b.id)) - Number(pins.has(a.id)));
  const total = projects.reduce((n, p) => n + p.videos.length, 0);
  const box = h('details', { class: 'p-group p-all p-collapsible', open },
    h('summary', {}, icon('chevronRight'), h('span', { class: 'p-collapsible-title' }, single ? tr('Alle video’s') : tr('Alle projecten')), h('span', { class: 'p-count' }, single ? total : projects.length)),
    h('div', { class: 'p-all-body' },
      ordered.map((p) => projectBlock(p, {
        multi, single, pins,
        onPin: () => { const fresh = allVideos(projects, { single, multi, open: true }); box.replaceWith(fresh); fresh.querySelector(`#proj-${p.id}`)?.closest('.k-project')?.querySelector('.pin-btn')?.focus(); },
      }))));
  return box;
}

function previewBar(d) {
  return h('div', { class: 'preview-bar', role: 'note' },
    icon('eye'),
    h('span', {}, h('strong', {}, 'Voorbeeld: '), 'zo ziet de klant het portaal', d.preview.portalLinkActive ? '.' : '. Er is nog geen actieve projectlink; maak die via “Delen → Klantportaal” in het project.'),
    h('a', { href: `/projecten/${d.preview.projectId}`, class: 'btn btn-sm btn-secondary' }, icon('arrowLeft'), h('span', { class: 'btn-label' }, 'Terug naar het project')));
}

function thumbOf(v) {
  const orientation = v.meta.orientation === 'staand' ? ' is-portrait' : v.meta.orientation === 'vierkant' ? ' is-square' : '';
  return h('div', { class: `p-thumb${orientation}` },
    v.posterUrl ? posterImg(v.posterUrl) : h('div', { class: 'poster-empty' }, icon('film')),
    v.version.duration ? h('span', { class: 'thumb-duration' }, timecode(v.version.duration)) : null);
}

/** Eén actie voor één video: welke versie, wat er gevraagd wordt, een deadline alleen als die er is. */
function actionRow({ video: v }, { personal = false } = {}) {
  const canApprove = personal && v.canApprove;
  const action = canApprove ? tr('Bekijken en goedkeuren') : tr('Bekijken en reageren');
  const deadline = deadlineOf(v);
  const late = deadline && isPast(deadline);
  let note = null;
  if (v.approval?.revoked) note = h('div', { class: 'p-note is-warn' }, icon('alert'), tr('Eerdere goedkeuring ingetrokken: opnieuw goedkeuren nodig'));
  else if (canApprove) note = h('div', { class: 'p-note is-mine' }, icon('shield'), tr('Jij bent de akkoordgever van deze video'));
  const sub = [tr('Versie {n}', { n: v.version.number }), tr('klaar voor je review')];
  const body = [
    thumbOf(v),
    h('div', { class: 'p-card-body' },
      h('h4', { class: 'p-card-title', title: v.title }, v.title),
      h('p', { class: 'p-card-meta' }, sub.join(' · ')),
      deadline ? h('p', { class: `p-due${late ? ' is-late' : ''}` }, icon('clock'),
        late ? tr('Reactie gevraagd vóór {date} (verstreken; reageren kan nog)', { date: formatDeadline(deadline) }) : tr('Reactie graag vóór {date}', { date: formatDeadline(deadline) })) : null,
      note),
    h('div', { class: 'p-card-action' }, h('span', { class: 'btn btn-sm btn-primary' }, h('span', { class: 'btn-label' }, action), icon('chevronRight'))),
  ];
  const label = `${v.title}, ${tr('Versie {n}', { n: v.version.number })}. ${action}${deadline ? `. ${tr('Reactie graag vóór {date}', { date: formatDeadline(deadline) })}` : ''}`;
  return v.href ? h('a', { class: 'p-card p-action is-in_review', href: v.href, 'aria-label': label }, body) : h('div', { class: 'p-card p-action is-in_review' }, body);
}

const answerUrl = (q) => (clientMode ? `/api/client/${encodeURIComponent(token)}/questions/${q.id}/answer` : `/api/portal/${encodeURIComponent(token)}/questions/${q.id}/answer`);
const nameStore = {
  get() { try { return localStorage.getItem('rt-reviewer-name') || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem('rt-reviewer-name', v); } catch { /* privémodus */ } },
};

/**
 * Vraag van het team: open met een antwoordveld, of beantwoord (met wie en wanneer). Met een
 * persoonlijke link staat de naam vast (geverifieerd); anders vul je die zelf in.
 */
function questionRow(q, { identity = null } = {}) {
  const about = [q.videoTitle, q.versionNumber ? tr('Versie {n}', { n: q.versionNumber }) : null].filter(Boolean).join(', ');
  const head = [
    h('div', { class: 'p-row-icon p-q-icon', 'aria-hidden': 'true' }, icon('help')),
    h('div', { class: 'p-card-body' },
      h('h4', { class: 'p-card-title p-q-text' }, q.body),
      h('p', { class: 'p-card-meta' }, about ? tr('Vraag van het team over {about}', { about }) : tr('Vraag van het team'), ' · ', formatDateZone(q.createdAt))),
  ];
  if (q.status === 'answered') {
    return h('article', { class: 'p-card p-question is-answered' }, head,
      h('div', { class: 'p-q-answer' }, h('p', {}, q.answer.text),
        h('p', { class: 'small muted' }, q.answer.verified
          ? tr('Beantwoord door {name} · {date}', { name: q.answer.name, date: formatDateZone(q.answer.at) })
          : tr('Beantwoord door {name} (naam zelf ingevuld) · {date}', { name: q.answer.name, date: formatDateZone(q.answer.at) }))));
  }
  const id = `q-${q.id}`;
  const text = h('textarea', { id: `${id}-a`, rows: '3', maxlength: '2000', required: true });
  const name = identity ? null : h('input', { id: `${id}-n`, type: 'text', maxlength: '120', autocomplete: 'name', value: nameStore.get(), required: true });
  const error = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const send = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, icon('send'), h('span', { class: 'btn-label' }, tr('Antwoord versturen')));
  // Eén request-id per antwoord: een dubbelklik of herhaald verzoek maakt geen tweede antwoord.
  const requestId = newRequestId();
  const form = h('form', { class: 'p-q-form', novalidate: true, hidden: true }, h('label', { for: `${id}-a`, class: 'field-label' }, tr('Jouw antwoord')), text,
    name ? [h('label', { for: `${id}-n`, class: 'field-label' }, tr('Je naam')), name] : h('p', { class: 'small muted' }, icon('shield'), ' ', tr('Je antwoordt als {name}.', { name: identity })),
    error, h('div', {}, preview ? h('span', { class: 'small muted' }, tr('Voorbeeld: antwoorden kan alleen de klant.')) : send));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (preview) return;
    if (!text.value.trim()) { text.focus(); return; }
    if (name && !name.value.trim()) { name.focus(); return; }
    send.disabled = true;
    error.hidden = true;
    try {
      if (name) nameStore.set(name.value.trim());
      await apiWithRetry('POST', answerUrl(q), { answer: text.value, name: name?.value, requestId });
      await refresh();
    } catch (err) {
      send.disabled = false;
      error.hidden = false;
      error.textContent = err.data?.code === 'already_answered' ? tr('Deze vraag is al beantwoord.') : err.data?.code === 'withdrawn' ? tr('Het team heeft deze vraag ingetrokken.') : err.message;
      if (['already_answered', 'withdrawn'].includes(err.data?.code)) setTimeout(refresh, 1500);
    }
  });
  // Eerst alleen de vraag; het antwoordveld verschijnt na "Beantwoorden".
  const open = h('div', { class: 'p-card-action p-q-open' }, h('button', { type: 'button', class: 'btn btn-sm btn-primary', 'aria-expanded': 'false', onClick: (e) => {
    form.hidden = false; e.currentTarget.parentElement.hidden = true; text.focus();
  } }, h('span', { class: 'btn-label' }, tr('Beantwoorden')), icon('chevronRight')));
  return h('article', { class: 'p-card p-question' }, head, open, form);
}

/**
 * Compacte regel met wat er nu met de video gebeurt. 'busy': feedback verstuurd (team aan zet);
 * 'approved': goedgekeurd, met apart of de definitieve versie al is vrijgegeven; 'any': de status.
 */
function statusRow({ video: v }, kind = 'any') {
  const s = clientStatusOf(v.version.status);
  const approved = v.approval && !v.approval.revoked && v.version.status === 'approved';
  let line = null;
  if (kind === 'busy') line = h('p', { class: 'p-card-meta' }, tr('Versie {n}', { n: v.version.number }), ' · ', tr('Je feedback is verstuurd'));
  else if (approved) {
    line = h('p', { class: 'p-card-meta' }, tr('Versie {n}', { n: v.version.number }), ' · ', tr('goedgekeurd door {name} op {date}', { name: v.approval.name, date: formatDateZone(v.approval.at) }));
  } else line = h('p', { class: 'p-card-meta' }, [tr('Versie {n}', { n: v.version.number }), metaLine(v.meta)].filter(Boolean).join(' · '));
  const release = approved ? (v.released
    ? h('p', { class: 'p-note is-ok' }, icon('package'), tr('Versie {n} vrijgegeven om te downloaden', { n: v.released.versionNumber }))
    : h('p', { class: 'p-note' }, icon('clock'), tr('Nog niet vrijgegeven als download'))) : null;
  const body = [
    thumbOf(v),
    h('div', { class: 'p-card-body' }, h('h4', { class: 'p-card-title', title: v.title }, v.title), line, release),
    // Alleen in het projectoverzicht een statuslabel; elders zegt de regel zelf al wat er gebeurt.
    kind === 'any' ? h('div', { class: 'p-card-status' }, clientPill(v.version.status, { small: true })) : null,
  ];
  const label = `${v.title}, ${tr('Versie {n}', { n: v.version.number })}: ${s.label}`;
  return v.href ? h('a', { class: `p-card p-compact is-${s.cls}`, href: v.href, 'aria-label': label }, body) : h('div', { class: `p-card p-compact is-${s.cls}` }, body);
}

function posterImg(src) {
  const img = h('img', { src, alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(h('div', { class: 'poster-empty' }, icon('film'))));
  return img;
}

function briefingSection(items, id, level = 2) {
  const sub = `h${level + 1}`;
  return h('section', { class: 'p-group p-briefing', 'aria-labelledby': id },
    h('div', { class: 'p-group-head' }, h(`h${level}`, { id }, tr('Briefing en referenties')), h('p', { class: 'small muted' }, tr('Gedeeld door het team.'))),
    h('div', { class: 'brief-list' }, items.map((b) => {
      if (b.kind === 'text') {
        return h('article', { class: 'brief-item is-text' }, h('div', { class: 'brief-icon' }, icon('clipboard')),
          h('div', { class: 'brief-main' }, h(sub, {}, b.title), h('p', { class: 'brief-body' }, b.body)));
      }
      if (b.kind === 'link') {
        let host = '';
        try { host = new URL(b.url).hostname; } catch { /* ongeldige link */ }
        return h('a', { class: 'brief-item is-link', href: b.url, target: '_blank', rel: 'noopener noreferrer' }, h('div', { class: 'brief-icon' }, icon('link')),
          h('div', { class: 'brief-main' }, h(sub, {}, b.title), h('div', { class: 'small muted truncate' }, host)), icon('external'));
      }
      return h('div', { class: 'brief-item is-file' }, h('div', { class: 'brief-icon' }, icon(fileIcon(b.file))),
        h('div', { class: 'brief-main' }, h(sub, { class: 'truncate', title: b.title }, b.title), h('div', { class: 'small muted' }, fileLabel(b.file))),
        h('div', { class: 'brief-actions' },
          h('a', { class: 'btn btn-sm btn-secondary', href: b.file.url, target: '_blank', rel: 'noopener' }, icon('eye'), h('span', { class: 'btn-label' }, tr('Openen'))),
          h('a', { class: 'btn btn-sm btn-ghost', href: `${b.file.url}?download=1`, 'aria-label': tr('{title} downloaden', { title: b.title }) }, icon('download'))));
    })));
}

load();
