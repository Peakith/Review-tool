// Opleverpagina: de bestanden die het team definitief heeft vrijgegeven.
// Bereikbaar via de afzonderlijke opleverlink (/o/<token>), via het klantportaal
// (/p/<token>/oplevering) en als alleen-lezen voorbeeld voor het team (/voorbeeld/oplevering/<id>).
import { h, mount, icon, button, api, emptyState, plural, timecode, formatDate, formatBytes } from '/shared/util.js';
import { applyBrand, brandMark } from '/shared/brand.js';
import { metaLine } from '/shared/client.js';

const root = document.getElementById('root');
const parts = location.pathname.split('/').filter(Boolean);
const mode = parts[0] === 'voorbeeld' ? 'preview' : parts[0] === 'p' ? 'portal' : 'link';
const source = {
  preview: () => `/api/projects/${encodeURIComponent(parts[2])}/delivery-preview`,
  portal: () => `/api/portal/${encodeURIComponent(parts[1])}/delivery`,
  link: () => `/api/delivery/${encodeURIComponent(parts[1])}`,
}[mode]();

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
    if (mode === 'preview' && err.status === 401) return fatal('Log eerst in', 'Deze voorbeeldweergave is alleen voor teamleden. Log in en open het voorbeeld opnieuw vanuit het project.', 'lock');
    if (err.status === 410) return fatal('Deze link werkt niet meer', err.message, 'lock');
    if (err.status === 404) return fatal('Link niet gevonden', 'Controleer of je de volledige link hebt gekopieerd, of vraag het productieteam om een nieuwe link.', 'link');
    return fatal('Laden lukt niet', `${err.message} Controleer je verbinding.`, 'alert', load);
  }
  render(data);
}

function render(data) {
  applyBrand(data.brand);
  document.title = `Oplevering · ${data.project.name}${data.brand?.name ? ` · ${data.brand.name}` : ''}`;
  const ready = data.items.filter((i) => i.available).length;

  const header = h('header', { class: 'r-header p-header' },
    h('div', { class: 'r-header-inner' },
      brandMark(data.brand),
      data.project.clientName ? h('span', { class: 'p-client small muted truncate' }, `Voor ${data.project.clientName}`) : null));

  const hero = h('section', { class: 'p-hero' },
    data.portal ? h('a', { class: 'r-back', href: data.portal.url }, icon('arrowLeft'), mode === 'preview' ? 'Terug naar het portaalvoorbeeld' : 'Terug naar het projectoverzicht') : null,
    h('div', { class: 'd-eyebrow' }, icon('package'), 'Definitieve oplevering'),
    h('h1', {}, data.project.name),
    data.project.note ? h('p', { class: 'p-intro' }, data.project.note) : null,
    data.items.length ? h('p', { class: 'p-summary' }, ready
      ? [h('strong', {}, plural(ready, 'bestand staat', 'bestanden staan')), ' klaar om te downloaden']
      : 'Op dit moment staat er geen bestand klaar om te downloaden.') : null);

  const list = data.items.length
    ? h('section', { class: 'd-list', 'aria-label': 'Vrijgegeven bestanden' }, data.items.map(item))
    : h('div', { class: 'card' }, emptyState({
      icon: 'package', title: 'Er staan nog geen definitieve bestanden klaar',
      text: mode === 'preview' ? 'Geef goedgekeurde versies vrij via “Oplevering” in het project. Tot die tijd ziet de klant deze melding.' : 'Bewaar deze link. Zodra het team bestanden definitief vrijgeeft, verschijnen ze hier.',
    }));

  mount(root,
    mode === 'preview' ? previewBar(data) : null,
    header,
    h('main', { class: 'p-main' }, hero, list,
      data.archived ? h('div', { class: 'notice notice-info' }, icon('history'), 'Dit project is afgerond en gearchiveerd. De definitieve bestanden blijven hier te downloaden.') : null,
      h('footer', { class: 'p-foot small muted' }, icon('shield'),
        h('span', {}, mode === 'link'
          ? 'Met deze link kun je alleen de definitief vrijgegeven bestanden van dit project downloaden. Elke download is precies de goedgekeurde versie die hierbij staat.'
          : 'Dit zijn de bestanden die het team definitief heeft vrijgegeven. Elke download is precies de goedgekeurde versie die hierbij staat.'))));
}

function previewBar(data) {
  return h('div', { class: 'preview-bar', role: 'note' },
    icon('eye'),
    h('span', {}, h('strong', {}, 'Voorbeeld: '), 'zo ziet de klant de opleverpagina. Downloaden is hier uitgeschakeld en telt niet als klantactiviteit.',
      data.preview.linkActive ? '' : ' Er is nog geen actieve opleverlink; de klant kan deze pagina dan alleen via het klantportaal openen.'),
    h('a', { href: `/projecten/${data.preview.projectId}/oplevering`, class: 'btn btn-sm btn-secondary' }, icon('arrowLeft'), h('span', { class: 'btn-label' }, 'Terug naar het project')));
}

function item(it) {
  const orientation = it.meta.orientation === 'staand' ? ' is-portrait' : it.meta.orientation === 'vierkant' ? ' is-square' : '';
  const thumb = h('div', { class: `p-thumb d-thumb${orientation}` },
    it.posterUrl ? posterImg(it.posterUrl) : h('div', { class: 'poster-empty' }, icon('film')),
    it.duration ? h('span', { class: 'thumb-duration' }, timecode(it.duration)) : null,
    it.meta.kindLabel ? h('span', { class: 'p-kind' }, it.meta.kindLabel) : null);
  const meta = metaLine(it.meta);
  const errorEl = h('p', { class: 'd-error small', role: 'alert', hidden: true });
  let action;
  if (!it.available) {
    action = h('div', { class: 'd-unavailable' }, icon('lock'), h('span', {}, h('strong', {}, 'Tijdelijk niet beschikbaar. '), 'Neem contact op met het productieteam.'));
  } else if (mode === 'preview') {
    action = h('span', { class: 'btn btn-secondary d-download is-disabled', 'aria-disabled': 'true', title: 'Voorbeeld: downloaden is hier uitgeschakeld' }, icon('download'), h('span', { class: 'btn-label' }, 'Downloaden'));
  } else {
    const a = h('a', {
      class: 'btn btn-primary d-download', href: it.downloadUrl, download: it.filename,
      'aria-label': `${it.title}, versie ${it.versionNumber} downloaden (${it.format}, ${formatBytes(it.size)})`,
    }, icon('download'), h('span', { class: 'btn-label' }, 'Downloaden'));
    a.addEventListener('click', (e) => checkThenDownload(e, a, errorEl));
    action = a;
  }
  return h('article', { class: `d-item${it.available ? '' : ' is-unavailable'}` },
    thumb,
    h('div', { class: 'd-body' },
      h('h2', { class: 'd-title', title: it.title }, it.title),
      meta ? h('div', { class: 'd-meta small muted' }, meta) : null,
      h('dl', { class: 'd-facts small' },
        h('div', {}, h('dt', {}, 'Bestand'), h('dd', {}, `${it.format} · ${formatBytes(it.size)}${it.width ? ` · ${it.width}×${it.height}` : ''}`)),
        h('div', {}, h('dt', {}, 'Versie'), h('dd', {}, String(it.versionNumber))),
        h('div', {}, h('dt', {}, 'Vrijgegeven'), h('dd', {}, formatDate(it.releasedAt)))),
      h('div', { class: 'd-name small muted truncate', title: it.filename }, icon('doc'), it.filename)),
    h('div', { class: 'd-action' }, action, errorEl));
}

/**
 * Eerst kort controleren of het bestand nog beschikbaar is (HEAD telt niet als download), zodat de
 * klant een duidelijke melding krijgt in plaats van een mislukte download. Daarna downloadt de
 * browser het bestand zelf, gestreamd naar schijf.
 */
async function checkThenDownload(e, a, errorEl) {
  if (a.dataset.checked === '1') { a.dataset.checked = ''; return; }
  e.preventDefault();
  errorEl.hidden = true;
  let res;
  try {
    res = await fetch(a.href, { method: 'HEAD', cache: 'no-store' });
  } catch {
    errorEl.hidden = false;
    errorEl.textContent = 'Geen verbinding met de server. Controleer je verbinding en probeer het opnieuw.';
    return;
  }
  if (!res.ok) {
    errorEl.hidden = false;
    errorEl.textContent = res.status === 410
      ? 'Dit bestand is niet meer beschikbaar via deze link (ingetrokken of tijdelijk geblokkeerd). Neem contact op met het productieteam.'
      : res.status === 404 ? 'Dit bestand is niet meer beschikbaar. Ververs de pagina voor de actuele bestanden.' : 'Downloaden lukt nu niet. Probeer het later opnieuw.';
    return;
  }
  a.dataset.checked = '1';
  a.click();
}

function posterImg(src) {
  const img = h('img', { src, alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(h('div', { class: 'poster-empty' }, icon('film'))));
  return img;
}

load();
