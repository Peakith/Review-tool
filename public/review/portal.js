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

/*
 * Startpagina van de klant, in vaste volgorde:
 *   1. Jouw acties: reviewen, feedback geven, goedkeuren (alleen waar dat mag), vragen beantwoorden;
 *   2. Bij <studio>: feedback is verstuurd, het team is aan zet;
 *   3. Goedgekeurd: compact en standaard ingeklapt;
 *   4. Definitieve bestanden: alleen wat echt is vrijgegeven.
 * Daaronder een (ingeklapte) route naar alle projecten en video's. Eén actie per video: nooit
 * "reageren" én "goedkeuren" als losse regels voor dezelfde video.
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

function summaryLine(n, nothingText, questions = 0) {
  const q = questions ? ` ${tr(questions === 1 ? 'En 1 vraag van het team.' : 'En {n} vragen van het team.', { n: questions })}` : '';
  if (!n && questions) return h('p', { class: 'p-summary' }, h('strong', {}, tr(questions === 1 ? 'Het team heeft 1 vraag voor je.' : 'Het team heeft {n} vragen voor je.', { n: questions })));
  return h('p', { class: 'p-summary' }, n
    ? [h('strong', {}, tr(n === 1 ? 'Er staat 1 video voor je klaar.' : 'Er staan {n} video’s voor je klaar.', { n })), q]
    : nothingText);
}

function section(key, title, count, text, body, { collapsed = false } = {}) {
  const id = `sec-${key}`;
  const head = h('div', { class: 'p-group-head' }, h('h2', { id }, title, h('span', { class: 'p-count' }, count)), text ? h('p', { class: 'small muted' }, text) : null);
  if (collapsed) {
    return h('details', { class: `p-group p-group-${key} p-collapsible` },
      h('summary', {}, icon('chevronRight'), h('span', { class: 'p-collapsible-title', id }, title), h('span', { class: 'p-count' }, count)),
      h('div', { class: 'p-list' }, body));
  }
  return h('section', { class: `p-group p-group-${key}`, 'aria-labelledby': id }, head, h('div', { class: 'p-list' }, body));
}

/** De vier blokken van de startpagina, voor één of meer projecten. */
function startSections(items, deliveries, { studio, personal, multi, questions = [], identity = null }) {
  const actions = items.filter((i) => isOpen(i.video)).sort(byDeadline);
  const openQ = questions.filter((q) => q.status === 'open');
  const answeredQ = questions.filter((q) => q.status === 'answered');
  const busy = items.filter((i) => !i.video.archived && i.video.version.status === 'changes_requested' && !i.project.completed);
  const done = items.filter((i) => i.video.version.status === 'approved' && !i.project.completed);
  const out = [];
  out.push(section('todo', tr('Jouw acties'), actions.length + openQ.length,
    actions.length || openQ.length ? null : tr('Er wacht nu niets op jou. Zodra er iets te bekijken is, staat het hier.'),
    [actions.map((i) => actionRow(i, { personal, multi })), openQ.map((q) => questionRow(q, { multi, identity }))]));
  if (busy.length) {
    out.push(section('busy', tr('Bij {studio}', { studio }), busy.length, tr('Je feedback is verstuurd. Het team is aan zet; de nieuwe versie verschijnt hier zodra die klaarstaat.'),
      busy.map((i) => compactRow(i, { multi }))));
  }
  if (done.length) out.push(section('done', tr('Goedgekeurd'), done.length, null, done.map((i) => compactRow(i, { multi })), { collapsed: true }));
  if (answeredQ.length) out.push(section('answered', tr('Beantwoorde vragen'), answeredQ.length, null, answeredQ.map((q) => questionRow(q, { multi, identity })), { collapsed: true }));
  if (deliveries.length) {
    out.push(section('files', tr('Definitieve bestanden'), deliveries.reduce((n, d) => n + d.delivery.count, 0), null,
      deliveries.map((d) => deliveryCard(d.delivery, multi ? d.name : null))));
  }
  return { out, actionCount: actions.length, questionCount: openQ.length };
}

function header(brand, clientName) {
  return h('header', { class: 'r-header p-header' },
    h('div', { class: 'r-header-inner' },
      brandMark(brand),
      clientName ? h('span', { class: 'p-client small muted truncate' }, tr('Voor {name}', { name: clientName })) : null,
      viewerControls(draw)));
}

function deliveryCard(delivery, projectName) {
  return h('a', { class: 'p-delivery-card', href: delivery.url },
    h('div', { class: 'brief-icon' }, icon('package')),
    h('div', {}, h('h3', {}, projectName || tr('Definitieve bestanden')), h('p', { class: 'small muted' }, tr(delivery.count === 1 ? '{n} bestand is definitief vrijgegeven en klaar om te downloaden.' : '{n} bestanden zijn definitief vrijgegeven en klaar om te downloaden.', { n: delivery.count }))),
    h('span', { class: 'btn btn-sm btn-secondary' }, icon('download'), h('span', { class: 'btn-label' }, tr('Naar de oplevering'))));
}

function render(d) {
  applyBrand(d.brand);
  const brandName = d.brand?.name;
  document.title = `${d.project.name}${brandName ? ` · ${brandName}` : ''}`;
  const project = { id: 0, name: d.project.name, completed: false };
  const items = d.videos.map((video) => ({ project, video }));
  const { out, actionCount, questionCount } = startSections(items, d.delivery ? [{ name: d.project.name, delivery: d.delivery }] : [], { studio: d.studio || tr('het team'), personal: false, multi: false, questions: d.questions || [] });

  const hero = h('section', { class: 'p-hero' },
    h('h1', {}, d.project.name),
    d.project.intro ? h('p', { class: 'p-intro' }, d.project.intro) : null,
    d.videos.length || questionCount ? summaryLine(actionCount, tr('Er wacht nu niets op jou.'), questionCount) : null);

  const sections = [];
  if (!d.videos.length && !d.delivery && !(d.questions || []).length) {
    sections.push(h('div', { class: 'p-empty' }, emptyState({
      icon: 'clock', title: tr('Er staan nog geen video’s voor je klaar'),
      text: tr('Bewaar deze link. Zodra het team een video publiceert, verschijnt die hier.'),
    })));
  } else {
    sections.push(...out);
    if (d.videos.length) sections.push(allVideos([{ ...project, videos: d.videos }], { single: true }));
  }
  if (d.briefing.length) sections.push(briefingSection(d.briefing, 'group-briefing'));

  mount(root,
    preview ? previewBar(d) : null,
    header(d.brand, d.project.clientName),
    h('main', { class: 'p-main' }, hero, sections,
      d.archived ? h('div', { class: 'notice notice-info' }, icon('history'), tr('Dit project is afgerond en gearchiveerd. Je kunt alles nog bekijken, maar niet meer reageren of goedkeuren.')) : null,
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
  const items = d.projects.flatMap((p) => p.videos.map((video) => ({ project: p, video })));
  const deliveries = d.projects.filter((p) => p.delivery).map((p) => ({ name: p.name, delivery: p.delivery }));
  const multi = d.projects.length > 1;
  const { out, actionCount, questionCount } = startSections(items, deliveries, { studio: d.studio || tr('het team'), personal, multi: true, questions: d.questions || [], identity: personal ? d.identity.name : null });

  const hero = h('section', { class: 'p-hero' },
    h('h1', {}, d.client.name),
    personal
      ? h('p', { class: 'p-identity small' }, icon('shield'),
        h('span', {}, tr('Persoonlijke link van '), h('strong', {}, d.identity.name), '. ', tr('Goedkeuren kan bij de video’s waarvoor jij de akkoordgever bent.')))
      : null,
    d.projects.length ? summaryLine(actionCount, tr('Er wacht nu niets op jou.'), questionCount) : null);

  const sections = [];
  if (!d.projects.length) {
    sections.push(h('div', { class: 'p-empty' }, emptyState({
      icon: 'clock', title: tr('Er staan nog geen projecten voor je klaar'),
      text: tr('Bewaar deze link. Zodra het team een project met je deelt, verschijnt het hier.'),
    })));
  } else {
    sections.push(...out, allVideos(d.projects, { multi, personal }));
  }

  mount(root,
    header(d.brand, null),
    h('main', { class: 'p-main' }, hero, sections,
      h('footer', { class: 'p-foot small muted' }, icon('shield'),
        h('span', {}, personal
          ? tr('Deze link is persoonlijk. Deel hem niet: wie hem heeft, kan namens jou goedkeuren.')
          : tr('Met deze link kun je bekijken, reageren en feedback versturen. Goedkeuren doet de aangewezen akkoordgever per video via een persoonlijke link.'))),
      expiryNote(d.linkExpiresAt)));
}

/**
 * Route naar alles wat deze link mag zien: per project alle gepubliceerde video's, met briefing.
 * Afgeronde projecten staan apart en ingeklapt.
 */
/**
 * Optioneel vastzetten voor klanten: alleen in deze browser (geen account), per link. Vastgezette
 * projecten staan bovenaan dit ingeklapte overzicht; de acties bovenaan de pagina gaan altijd voor.
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
  const draw = () => {
    const on = pins.has(p.id);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? tr('{name} losmaken', { name: p.name }) : tr('{name} vastzetten', { name: p.name }));
    btn.title = on ? tr('Vastgezet in deze browser. Klik om los te maken.') : tr('Vastzetten in deze browser (bovenaan dit overzicht)');
    mount(btn, icon('star'));
  };
  draw();
  btn.addEventListener('click', () => {
    if (pins.has(p.id)) pins.delete(p.id); else pins.add(p.id);
    writePins(pins);
    draw();
    onChange();
  });
  return btn;
}

/** Kleine projectcover (alleen uit gedeelde versies; de server levert niets anders aan klanten). */
function smallCover(p) {
  if (!p.cover) return null;
  const img = h('img', { src: p.cover.url, alt: '', loading: 'lazy', decoding: 'async' });
  const box = h('span', { class: 'k-cover', 'aria-hidden': 'true' }, img);
  img.addEventListener('error', () => box.remove());
  return box;
}

function allVideos(projects, { single = false, multi = false } = {}) {
  const pins = single ? new Set() : readPins();
  const ordered = () => [...projects].sort((a, b) => Number(pins.has(b.id)) - Number(pins.has(a.id)));
  const active = ordered().filter((p) => !p.completed);
  const completed = ordered().filter((p) => p.completed);
  const total = projects.reduce((n, p) => n + p.videos.length, 0);
  const projectBlock = (p) => {
    const id = `proj-${p.id}`;
    return h('section', { class: 'k-project', 'aria-labelledby': id },
      single ? null : h('div', { class: 'k-project-head' },
        smallCover(p),
        h('div', { class: 'k-project-titles' },
          h('h3', { id, title: p.name }, p.name),
          p.brand && multi ? h('span', { class: 'small muted' }, p.brand.name) : null),
        multi ? clientPin(p, pins, () => { const fresh = allVideos(projects, { single, multi }); fresh.open = true; box.replaceWith(fresh); fresh.querySelector(`#${id}`)?.closest('.k-project')?.querySelector('.pin-btn')?.focus(); }) : null,
        p.archived ? h('span', { class: 'badge badge-neutral' }, tr('gearchiveerd')) : null),
      p.intro && !single ? h('p', { class: 'p-intro' }, p.intro) : null,
      p.videos.length ? h('div', { class: 'p-list' }, p.videos.map((v) => compactRow({ project: p, video: v }, { multi: false })))
        : h('p', { class: 'small muted' }, tr('Er staan in dit project nog geen video’s voor je klaar.')),
      !single && p.briefing?.length ? briefingSection(p.briefing, `${id}-briefing`, 4) : null);
  };
  const box = h('details', { class: 'p-group p-all p-collapsible' },
    h('summary', {}, icon('chevronRight'), h('span', { class: 'p-collapsible-title' }, single ? tr('Alle video’s') : tr('Alle projecten en video’s')), h('span', { class: 'p-count' }, total)),
    h('div', { class: 'p-all-body' },
      active.map(projectBlock),
      completed.length ? h('details', { class: 'k-completed' },
        h('summary', {}, icon('history'), tr(completed.length === 1 ? 'Afgerond project ({n})' : 'Afgeronde projecten ({n})', { n: completed.length })),
        h('div', { class: 'k-completed-body' }, completed.map(projectBlock))) : null));
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

/** Eén actie voor één video: precies welke versie, wat er gevraagd wordt en tot wanneer. */
function actionRow({ project, video: v }, { personal = false, multi = false } = {}) {
  const canApprove = personal && v.canApprove;
  const action = canApprove ? tr('Bekijken en goedkeuren') : tr('Bekijken en reageren');
  const deadline = deadlineOf(v);
  const late = deadline && isPast(deadline);
  let note = null;
  if (v.approval?.revoked) note = h('div', { class: 'p-note is-warn' }, icon('alert'), tr('Eerdere goedkeuring ingetrokken: opnieuw goedkeuren nodig'));
  else if (canApprove) note = h('div', { class: 'p-note is-mine' }, icon('shield'), tr('Jij bent de akkoordgever van deze video'));
  else if (v.approverName) note = h('div', { class: 'p-note' }, icon('shield'), tr('Goedkeuren: {name}, via een persoonlijke link', { name: v.approverName }));
  const body = [
    thumbOf(v),
    h('div', { class: 'p-card-body' },
      multi ? h('div', { class: 'p-card-kicker' }, project.name) : null,
      h('h3', { class: 'p-card-title', title: v.title }, v.title),
      h('div', { class: 'p-card-meta small muted' }, [tr('Versie {n}', { n: v.version.number }), metaLine(v.meta), v.round ? tr('Ronde {n}', { n: v.round.number }) : null].filter(Boolean).join(' · ')),
      deadline ? h('div', { class: `p-due${late ? ' is-late' : ''}` }, icon('clock'),
        late ? tr('Reactie gevraagd vóór {date} (verstreken; reageren kan nog)', { date: formatDeadline(deadline) }) : tr('Reactie graag vóór {date}', { date: formatDeadline(deadline) })) : null,
      note),
    h('div', { class: 'p-card-action' }, h('span', { class: `btn btn-sm ${canApprove ? 'btn-approve' : 'btn-primary'}` }, icon(canApprove ? 'checkCircle' : 'chat'), h('span', { class: 'btn-label' }, action))),
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
function questionRow(q, { multi = false, identity = null } = {}) {
  const about = [multi ? q.projectName : null, q.videoTitle, q.versionNumber ? tr('Versie {n}', { n: q.versionNumber }) : null].filter(Boolean).join(' · ');
  const head = [
    h('div', { class: 'p-q-icon', 'aria-hidden': 'true' }, icon('help')),
    h('div', { class: 'p-card-body' },
      about ? h('div', { class: 'p-card-kicker' }, about) : null,
      h('h3', { class: 'p-card-title p-q-text' }, q.body),
      h('div', { class: 'p-card-meta small muted' }, tr('Vraag van het team · {date}', { date: formatDateZone(q.createdAt) }))),
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
      await load();
    } catch (err) {
      send.disabled = false;
      error.hidden = false;
      error.textContent = err.data?.code === 'already_answered' ? tr('Deze vraag is al beantwoord.') : err.data?.code === 'withdrawn' ? tr('Het team heeft deze vraag ingetrokken.') : err.message;
      if (['already_answered', 'withdrawn'].includes(err.data?.code)) setTimeout(load, 1500);
    }
  });
  // Eerst alleen de vraag; het antwoordveld verschijnt na "Beantwoorden".
  const open = h('div', { class: 'p-q-open' }, h('button', { type: 'button', class: 'btn btn-sm btn-primary', 'aria-expanded': 'false', onClick: (e) => {
    form.hidden = false; e.currentTarget.parentElement.hidden = true; text.focus();
  } }, icon('reply'), h('span', { class: 'btn-label' }, tr('Beantwoorden'))));
  return h('article', { class: 'p-card p-question' }, head, open, form);
}

/** Compacte regel: status, versie en (bij goedkeuring) wie en wanneer. */
function compactRow({ project, video: v }, { multi = false } = {}) {
  const s = clientStatusOf(v.version.status);
  const approved = v.approval && !v.approval.revoked && v.version.status === 'approved';
  const body = [
    thumbOf(v),
    h('div', { class: 'p-card-body' },
      multi ? h('div', { class: 'p-card-kicker' }, project.name) : null,
      h('h3', { class: 'p-card-title', title: v.title }, v.title),
      h('div', { class: 'p-card-meta small muted' }, [tr('Versie {n}', { n: v.version.number }), metaLine(v.meta)].filter(Boolean).join(' · ')),
      approved ? h('div', { class: 'p-note is-ok' }, icon('checkCircle'), tr('Goedgekeurd door {name} · {date}', { name: v.approval.name, date: formatDateZone(v.approval.at) })) : null),
    h('div', { class: 'p-card-status' }, clientPill(v.version.status, { small: true })),
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
