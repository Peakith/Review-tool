// Klantportaal: alle gepubliceerde video's van één project via één stabiele link.
// Dezelfde pagina toont het team als voorbeeld (/voorbeeld/project/<id>), gevuld met
// dezelfde serverfilters, zodat het team precies ziet wat de klant ziet.
import { h, mount, icon, button, api, emptyState, plural, timecode, formatDate, formatDeadline, isPast } from '/shared/util.js';
import { applyBrand, brandMark } from '/shared/brand.js';
import { clientPill, clientStatusOf, metaLine, fileLabel, fileIcon } from '/shared/client.js';

const root = document.getElementById('root');
const parts = location.pathname.split('/').filter(Boolean);
const preview = parts[0] === 'voorbeeld';
const source = preview ? `/api/projects/${encodeURIComponent(parts[2])}/portal-preview` : `/api/portal/${encodeURIComponent(parts[1])}`;

function fatal(title, text, iconName = 'alert', retry) {
  document.title = title;
  mount(root, h('main', { class: 'fatal' }, emptyState({
    icon: iconName, title, text,
    action: retry ? button('Opnieuw proberen', { icon: 'refresh', onClick: retry }) : null,
  })));
}

async function load() {
  mount(root, h('div', { class: 'fatal' }, h('div', { class: 'spinner', role: 'status', 'aria-label': 'Laden' })));
  let data;
  try {
    data = await api('GET', source);
  } catch (err) {
    if (preview && err.status === 401) return fatal('Log eerst in', 'Deze voorbeeldweergave is alleen voor teamleden. Log in en open het voorbeeld opnieuw vanuit het project.', 'lock');
    if (err.status === 410) return fatal('Deze link werkt niet meer', err.message, 'lock');
    if (err.status === 404) return fatal('Link niet gevonden', 'Controleer of je de volledige link hebt gekopieerd, of vraag het team om een nieuwe link.', 'link');
    return fatal('Laden lukt niet', err.message, 'alert', load);
  }
  render(data);
}

// Volgorde en uitleg van de groepen, vanuit de klant gezien.
const GROUPS = [
  { key: 'todo', title: 'Wacht op jouw review', text: 'Bekijk deze video’s, plaats je opmerkingen en verstuur je feedback.', test: (v) => v.version.status === 'in_review' && !v.archived },
  { key: 'busy', title: 'Feedback verstuurd', text: 'Het team verwerkt je feedback. Je ziet hier de nieuwe versie zodra die klaarstaat.', test: (v) => v.version.status === 'changes_requested' && !v.archived },
  { key: 'done', title: 'Goedgekeurd', text: null, test: (v) => v.version.status === 'approved' },
  { key: 'other', title: 'Afgerond of tijdelijk gesloten', text: 'Nog te bekijken, maar reageren is hier nu niet mogelijk.', test: () => true },
];

function render(data) {
  applyBrand(data.brand);
  const brandName = data.brand?.name;
  document.title = `${data.project.name}${brandName ? ` · ${brandName}` : ''}`;

  const groups = new Map(GROUPS.map((g) => [g.key, []]));
  for (const v of data.videos) groups.get(GROUPS.find((g) => g.test(v)).key).push(v);
  const todo = groups.get('todo').length;
  const done = groups.get('done').length;

  const header = h('header', { class: 'r-header p-header' },
    h('div', { class: 'r-header-inner' },
      brandMark(data.brand),
      data.project.clientName ? h('span', { class: 'p-client small muted truncate' }, `Voor ${data.project.clientName}`) : null));

  const summary = data.videos.length
    ? h('p', { class: 'p-summary' }, todo
      ? [h('strong', {}, plural(todo, 'video wacht', 'video’s wachten')), ' op jouw review']
      : done === data.videos.length ? [icon('checkCircle'), ' Alle video’s zijn goedgekeurd. Dank je wel!'] : 'Er wacht nu niets op jou.')
    : null;

  const hero = h('section', { class: 'p-hero' },
    h('h1', {}, data.project.name),
    data.project.intro ? h('p', { class: 'p-intro' }, data.project.intro) : null,
    summary);

  const sections = [];
  if (!data.videos.length) {
    sections.push(h('div', { class: 'card' }, emptyState({
      icon: 'clock', title: 'Er staan nog geen video’s voor je klaar',
      text: 'Bewaar deze link. Zodra het team een video publiceert, verschijnt die hier.',
    })));
  }
  for (const g of GROUPS) {
    const list = groups.get(g.key);
    if (!list.length) continue;
    sections.push(h('section', { class: `p-group p-group-${g.key}`, 'aria-labelledby': `group-${g.key}` },
      h('div', { class: 'p-group-head' }, h('h2', { id: `group-${g.key}` }, g.title, h('span', { class: 'p-count' }, list.length)), g.text ? h('p', { class: 'small muted' }, g.text) : null),
      h('div', { class: 'p-grid' }, list.map(card))));
  }
  // Definitieve bestanden staan op een eigen pagina; hier alleen de verwijzing.
  if (data.delivery) {
    sections.unshift(h('a', { class: 'p-delivery-card', href: data.delivery.url },
      h('div', { class: 'brief-icon' }, icon('package')),
      h('div', {}, h('h2', {}, 'Definitieve bestanden'), h('p', { class: 'small muted' }, `${plural(data.delivery.count, 'bestand is', 'bestanden zijn')} definitief vrijgegeven en klaar om te downloaden.`)),
      h('span', { class: 'btn btn-sm btn-primary' }, icon('download'), h('span', { class: 'btn-label' }, 'Naar de oplevering'))));
  }
  if (data.briefing.length) sections.push(briefingSection(data.briefing));

  mount(root,
    preview ? previewBar(data) : null,
    header,
    h('main', { class: 'p-main' }, hero, sections,
      data.archived ? h('div', { class: 'notice notice-info' }, icon('history'), 'Dit project is afgerond en gearchiveerd. Je kunt alles nog bekijken, maar niet meer reageren of goedkeuren.') : null,
      !preview && data.videos.length ? h('p', { class: 'p-export small' }, icon('fileDown'), 'Alle feedback downloaden:', h('a', { href: `${source}/export.pdf` }, 'PDF'), h('a', { href: `${source}/export.csv` }, 'CSV (Excel)')) : null,
      h('footer', { class: 'p-foot small muted' },
        icon('shield'), h('span', {}, 'Met deze link kun je bekijken, reageren en feedback versturen. Goedkeuren doet de aangewezen akkoordgever per video via een persoonlijke link.'))));
}

function previewBar(data) {
  return h('div', { class: 'preview-bar', role: 'note' },
    icon('eye'),
    h('span', {}, h('strong', {}, 'Voorbeeld: '), 'zo ziet de klant het portaal', data.preview.portalLinkActive ? '.' : '. Er is nog geen actieve projectlink; maak die via “Klantportaal” in het project.'),
    h('a', { href: `/projecten/${data.preview.projectId}`, class: 'btn btn-sm btn-secondary' }, icon('arrowLeft'), h('span', { class: 'btn-label' }, 'Terug naar het project')));
}

function card(v) {
  const s = clientStatusOf(v.version.status);
  const orientation = v.meta.orientation === 'staand' ? ' is-portrait' : v.meta.orientation === 'vierkant' ? ' is-square' : '';
  const thumb = h('div', { class: `p-thumb${orientation}` },
    v.posterUrl ? posterImg(v.posterUrl) : h('div', { class: 'poster-empty' }, icon('film')),
    v.version.duration ? h('span', { class: 'thumb-duration' }, timecode(v.version.duration)) : null,
    v.meta.kindLabel ? h('span', { class: 'p-kind' }, v.meta.kindLabel) : null);
  const action = v.version.status === 'in_review' && !v.archived ? 'Bekijken en reageren' : 'Bekijken';
  const approval = v.approval
    ? h('div', { class: 'p-note is-ok' }, icon('checkCircle'), `Goedgekeurd door ${v.approval.name} · ${formatDate(v.approval.at)}`)
    : v.version.status === 'in_review' || v.version.status === 'changes_requested'
      ? h('div', { class: 'p-note' }, icon('shield'), v.approverName ? `Goedkeuren: ${v.approverName}, via een persoonlijke link` : 'Goedkeuren gaat via een persoonlijke link van het team')
      : null;
  const body = [
    thumb,
    h('div', { class: 'p-card-body' },
      h('h3', { class: 'p-card-title', title: v.title }, v.title),
      h('div', { class: 'p-card-meta small muted' }, [metaLine(v.meta), `Versie ${v.version.number}`].filter(Boolean).join(' · ')),
      h('div', { class: 'p-card-status' }, clientPill(v.version.status, { small: true })),
      v.round ? h('div', { class: 'p-note' }, icon('history'), `Ronde ${v.round.number}${v.round.deadline && v.version.status === 'in_review' ? ` · reactie graag vóór ${formatDeadline(v.round.deadline)}${isPast(v.round.deadline) ? ' (verstreken; reageren kan nog)' : ''}` : ''}`) : null,
      approval),
    h('div', { class: 'p-card-action' }, h('span', { class: `btn btn-sm ${v.version.status === 'in_review' && !v.archived ? 'btn-primary' : 'btn-secondary'}` }, icon(s.icon === 'eye' ? 'chat' : 'play'), h('span', { class: 'btn-label' }, action))),
  ];
  return v.href
    ? h('a', { class: `p-card is-${s.cls}`, href: v.href, 'aria-label': `${v.title}, versie ${v.version.number}: ${s.label}. ${action}` }, body)
    : h('div', { class: `p-card is-${s.cls}` }, body);
}

function posterImg(src) {
  const img = h('img', { src, alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(h('div', { class: 'poster-empty' }, icon('film'))));
  return img;
}

function briefingSection(items) {
  return h('section', { class: 'p-group p-briefing', 'aria-labelledby': 'group-briefing' },
    h('div', { class: 'p-group-head' }, h('h2', { id: 'group-briefing' }, 'Briefing en referenties'), h('p', { class: 'small muted' }, 'Gedeeld door het team.')),
    h('div', { class: 'brief-list' }, items.map((b) => {
      if (b.kind === 'text') {
        return h('article', { class: 'brief-item is-text' }, h('div', { class: 'brief-icon' }, icon('clipboard')),
          h('div', { class: 'brief-main' }, h('h3', {}, b.title), h('p', { class: 'brief-body' }, b.body)));
      }
      if (b.kind === 'link') {
        let host = '';
        try { host = new URL(b.url).hostname; } catch { /* ongeldige link */ }
        return h('a', { class: 'brief-item is-link', href: b.url, target: '_blank', rel: 'noopener noreferrer' }, h('div', { class: 'brief-icon' }, icon('link')),
          h('div', { class: 'brief-main' }, h('h3', {}, b.title), h('div', { class: 'small muted truncate' }, host)), icon('external'));
      }
      return h('div', { class: 'brief-item is-file' }, h('div', { class: 'brief-icon' }, icon(fileIcon(b.file))),
        h('div', { class: 'brief-main' }, h('h3', { class: 'truncate', title: b.title }, b.title), h('div', { class: 'small muted' }, fileLabel(b.file))),
        h('div', { class: 'brief-actions' },
          h('a', { class: 'btn btn-sm btn-secondary', href: b.file.url, target: '_blank', rel: 'noopener' }, icon('eye'), h('span', { class: 'btn-label' }, 'Openen')),
          h('a', { class: 'btn btn-sm btn-ghost', href: `${b.file.url}?download=1`, 'aria-label': `${b.title} downloaden` }, icon('download'))));
    })));
}

load();
