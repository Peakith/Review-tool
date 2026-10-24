// Klantportaal. Twee varianten op dezelfde pagina:
//  - /p/<token>: alle gepubliceerde video's van één project (projectlink, ongewijzigd bereik);
//  - /k/<token>: klantportaal per klant: projecten → gepubliceerde video's en opleveringen. Afgeronde
//    projecten staan ingeklapt onderaan. Een persoonlijke link van een akkoordgever toont waar die
//    persoon zelf mag goedkeuren.
// Dezelfde pagina toont het team als voorbeeld (/voorbeeld/project/<id>), gevuld met
// dezelfde serverfilters, zodat het team precies ziet wat de klant ziet.
import { h, mount, icon, api, emptyState, plural, timecode, formatDateZone, formatDeadline, isPast } from '/shared/util.js';
import { tr } from '/shared/i18n.js';
import { applyBrand, brandMark } from '/shared/brand.js';
import { clientPill, clientStatusOf, metaLine, fileLabel, fileIcon } from '/shared/client.js';
import { initLang, langToggle, linkError, fatal as showFatal, expiryNote } from '/review/gate.js';

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

// Volgorde en uitleg van de groepen, vanuit de klant gezien.
const GROUPS = [
  { key: 'todo', title: 'Wacht op jouw review', text: 'Bekijk deze video’s, plaats je opmerkingen en verstuur je feedback.', test: (v) => v.version.status === 'in_review' && !v.archived },
  { key: 'busy', title: 'Feedback verstuurd', text: 'Het team verwerkt je feedback. Je ziet hier de nieuwe versie zodra die klaarstaat.', test: (v) => v.version.status === 'changes_requested' && !v.archived },
  { key: 'done', title: 'Goedgekeurd', text: null, test: (v) => v.version.status === 'approved' },
  { key: 'other', title: 'Afgerond of tijdelijk gesloten', text: 'Nog te bekijken, maar reageren is hier nu niet mogelijk.', test: () => true },
];

function header(brand, clientName) {
  return h('header', { class: 'r-header p-header' },
    h('div', { class: 'r-header-inner' },
      brandMark(brand),
      clientName ? h('span', { class: 'p-client small muted truncate' }, tr('Voor {name}', { name: clientName })) : null,
      langToggle(draw)));
}

/** Video's van één project, gegroepeerd naar wat er van de klant wordt verwacht. */
function videoGroups(videos, idPrefix, { personal = false, level = 2 } = {}) {
  const groups = new Map(GROUPS.map((g) => [g.key, []]));
  for (const v of videos) groups.get(GROUPS.find((g) => g.test(v)).key).push(v);
  return GROUPS.filter((g) => groups.get(g.key).length).map((g) => {
    const list = groups.get(g.key);
    return h('section', { class: `p-group p-group-${g.key}`, 'aria-labelledby': `${idPrefix}-${g.key}` },
      h('div', { class: 'p-group-head' }, h(`h${level}`, { id: `${idPrefix}-${g.key}` }, tr(g.title), h('span', { class: 'p-count' }, list.length)), g.text ? h('p', { class: 'small muted' }, tr(g.text)) : null),
      h('div', { class: 'p-grid' }, list.map((v) => card(v, { personal }))));
  });
}

function summaryLine(videos) {
  if (!videos.length) return null;
  const todo = videos.filter((v) => v.version.status === 'in_review' && !v.archived).length;
  const done = videos.filter((v) => v.version.status === 'approved').length;
  return h('p', { class: 'p-summary' }, todo
    ? [h('strong', {}, tr(todo === 1 ? '{n} video wacht' : '{n} video’s wachten', { n: todo })), tr(' op jouw review')]
    : done === videos.length ? [icon('checkCircle'), tr(' Alle video’s zijn goedgekeurd. Dank je wel!')] : tr('Er wacht nu niets op jou.'));
}

function deliveryCard(delivery) {
  return h('a', { class: 'p-delivery-card', href: delivery.url },
    h('div', { class: 'brief-icon' }, icon('package')),
    h('div', {}, h('h2', {}, tr('Definitieve bestanden')), h('p', { class: 'small muted' }, tr(delivery.count === 1 ? '{n} bestand is definitief vrijgegeven en klaar om te downloaden.' : '{n} bestanden zijn definitief vrijgegeven en klaar om te downloaden.', { n: delivery.count }))),
    h('span', { class: 'btn btn-sm btn-primary' }, icon('download'), h('span', { class: 'btn-label' }, tr('Naar de oplevering'))));
}

function render(d) {
  applyBrand(d.brand);
  const brandName = d.brand?.name;
  document.title = `${d.project.name}${brandName ? ` · ${brandName}` : ''}`;

  const hero = h('section', { class: 'p-hero' },
    h('h1', {}, d.project.name),
    d.project.intro ? h('p', { class: 'p-intro' }, d.project.intro) : null,
    summaryLine(d.videos));

  const sections = [];
  if (d.delivery) sections.push(deliveryCard(d.delivery));
  if (!d.videos.length) {
    sections.push(h('div', { class: 'card' }, emptyState({
      icon: 'clock', title: tr('Er staan nog geen video’s voor je klaar'),
      text: tr('Bewaar deze link. Zodra het team een video publiceert, verschijnt die hier.'),
    })));
  }
  sections.push(...videoGroups(d.videos, 'group'));
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

/** Klantportaal per klant: actieve projecten open, afgeronde projecten ingeklapt. */
function renderClient(d) {
  applyBrand(d.brand);
  document.title = `${d.client.name}${d.brand?.name ? ` · ${d.brand.name}` : ''}`;
  const personal = !!d.identity?.personal;
  const active = d.projects.filter((p) => !p.completed);
  const completed = d.projects.filter((p) => p.completed);
  const allVideos = active.flatMap((p) => p.videos);
  const mine = allVideos.filter((v) => v.canApprove && v.version.status !== 'approved' && !v.archived);

  const hero = h('section', { class: 'p-hero' },
    h('h1', {}, d.client.name),
    personal
      ? h('div', { class: 'identity is-verified p-identity' }, icon('shield'),
        h('div', {}, h('div', {}, tr('Persoonlijke link van '), h('strong', {}, d.identity.name)),
          h('div', { class: 'small' }, tr('Je kunt reageren op alle video’s hieronder. Goedkeuren kan bij de video’s waarvoor jij de akkoordgever bent.'))))
      : null,
    personal && mine.length ? h('p', { class: 'p-summary' }, h('strong', {}, tr(mine.length === 1 ? '{n} video wacht op jouw goedkeuring' : '{n} video’s wachten op jouw goedkeuring', { n: mine.length }))) : summaryLine(allVideos));

  const projectBlock = (p) => {
    const id = `proj-${p.id}`;
    return h('section', { class: 'k-project', 'aria-labelledby': id },
      h('div', { class: 'k-project-head' },
        h('h2', { id }, p.name),
        p.brand && p.brand.id !== d.brand?.id ? h('span', { class: 'badge badge-neutral' }, p.brand.name) : null,
        p.archived ? h('span', { class: 'badge badge-neutral' }, tr('gearchiveerd')) : null),
      p.intro ? h('p', { class: 'p-intro' }, p.intro) : null,
      p.delivery ? deliveryCard(p.delivery) : null,
      p.videos.length ? videoGroups(p.videos, id, { personal, level: 3 }) : h('p', { class: 'small muted' }, tr('Er staan in dit project nog geen video’s voor je klaar.')),
      p.briefing.length ? briefingSection(p.briefing, `${id}-briefing`, 3) : null);
  };

  const sections = [];
  if (!d.projects.length) {
    sections.push(h('div', { class: 'card' }, emptyState({
      icon: 'clock', title: tr('Er staan nog geen projecten voor je klaar'),
      text: tr('Bewaar deze link. Zodra het team een project met je deelt, verschijnt het hier.'),
    })));
  }
  sections.push(...active.map(projectBlock));
  if (completed.length) {
    sections.push(h('details', { class: 'k-completed' },
      h('summary', {}, icon('history'), tr(completed.length === 1 ? 'Afgerond project ({n})' : 'Afgeronde projecten ({n})', { n: completed.length })),
      h('div', { class: 'k-completed-body' }, completed.map(projectBlock))));
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

function previewBar(d) {
  return h('div', { class: 'preview-bar', role: 'note' },
    icon('eye'),
    h('span', {}, h('strong', {}, 'Voorbeeld: '), 'zo ziet de klant het portaal', d.preview.portalLinkActive ? '.' : '. Er is nog geen actieve projectlink; maak die via “Delen → Klantportaal” in het project.'),
    h('a', { href: `/projecten/${d.preview.projectId}`, class: 'btn btn-sm btn-secondary' }, icon('arrowLeft'), h('span', { class: 'btn-label' }, 'Terug naar het project')));
}

function card(v, { personal = false } = {}) {
  const s = clientStatusOf(v.version.status);
  const open = ['in_review', 'changes_requested'].includes(v.version.status) && !v.archived;
  const orientation = v.meta.orientation === 'staand' ? ' is-portrait' : v.meta.orientation === 'vierkant' ? ' is-square' : '';
  const thumb = h('div', { class: `p-thumb${orientation}` },
    v.posterUrl ? posterImg(v.posterUrl) : h('div', { class: 'poster-empty' }, icon('film')),
    v.version.duration ? h('span', { class: 'thumb-duration' }, timecode(v.version.duration)) : null,
    v.meta.kindLabel ? h('span', { class: 'p-kind' }, tr(v.meta.kindLabel)) : null);
  const canApprove = personal && v.canApprove && open;
  const action = canApprove ? tr('Bekijken en goedkeuren') : v.version.status === 'in_review' && !v.archived ? tr('Bekijken en reageren') : tr('Bekijken');
  let approval = null;
  if (v.approval && !v.approval.revoked && v.version.status === 'approved') {
    approval = h('div', { class: 'p-note is-ok' }, icon('checkCircle'), tr('Goedgekeurd door {name} · {date}', { name: v.approval.name, date: formatDateZone(v.approval.at) }));
  } else if (v.approval?.revoked && open) {
    approval = h('div', { class: 'p-note is-warn' }, icon('alert'), tr('Eerdere goedkeuring ingetrokken: opnieuw goedkeuren nodig'));
  } else if (canApprove) {
    approval = h('div', { class: 'p-note is-mine' }, icon('shield'), tr('Jij bent de akkoordgever van deze video'));
  } else if (open) {
    approval = h('div', { class: 'p-note' }, icon('shield'), v.approverName ? tr('Goedkeuren: {name}, via een persoonlijke link', { name: v.approverName }) : tr('Goedkeuren gaat via een persoonlijke link van het team'));
  }
  const body = [
    thumb,
    h('div', { class: 'p-card-body' },
      h('h3', { class: 'p-card-title', title: v.title }, v.title),
      h('div', { class: 'p-card-meta small muted' }, [metaLine(v.meta), tr('Versie {n}', { n: v.version.number })].filter(Boolean).join(' · ')),
      h('div', { class: 'p-card-status' }, clientPill(v.version.status, { small: true })),
      v.round ? h('div', { class: 'p-note' }, icon('history'), tr('Ronde {n}', { n: v.round.number }), v.round.deadline && v.version.status === 'in_review' ? ` · ${tr('reactie graag vóór {date}', { date: formatDeadline(v.round.deadline) })}${isPast(v.round.deadline) ? ` ${tr('(verstreken; reageren kan nog)')}` : ''}` : '') : null,
      approval),
    h('div', { class: 'p-card-action' }, h('span', { class: `btn btn-sm ${canApprove ? 'btn-approve' : v.version.status === 'in_review' && !v.archived ? 'btn-primary' : 'btn-secondary'}` }, icon(canApprove ? 'checkCircle' : s.icon === 'eye' ? 'chat' : 'play'), h('span', { class: 'btn-label' }, action))),
  ];
  return v.href
    ? h('a', { class: `p-card is-${s.cls}`, href: v.href, 'aria-label': `${v.title}, ${tr('Versie {n}', { n: v.version.number })}: ${s.label}. ${action}` }, body)
    : h('div', { class: `p-card is-${s.cls}` }, body);
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
