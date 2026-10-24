// Definitieve opleveringen (teamkant): bewust vrijgeven van exacte, door de klant goedgekeurde
// versies, terugnemen en vervangen met geschiedenis, oplevertekst en de afzonderlijke opleverlink.
import {
  h, mount, icon, button, busy, api, apiWithRetry, toast, openDialog, confirmDialog, field, emptyState, errorState,
  formatDate, relativeDate, formatBytes, plural, skeletonRows, copyText, newRequestId, draftStore,
} from '/shared/util.js';
import { can } from './admin.js';

const fileLine = (f) => [f.format, formatBytes(f.size), f.width ? `${f.width}×${f.height}` : null].filter(Boolean).join(' · ');
const metaLine = (m) => [m?.kindLabel, m?.aspect, m?.channel].filter(Boolean).join(' · ');

/** Projecttab “Oplevering”. */
export async function viewDeliveries({ project, host, onCount }) {
  const mayShare = can(project.myLevel, 'publish');
  const archived = !!project.archivedAt;
  const params = new URLSearchParams(location.search);
  let data = null;

  async function load() {
    mount(host, skeletonRows(3));
    try {
      data = await api('GET', `/api/projects/${project.id}/deliveries`);
    } catch (err) { mount(host, errorState(err, load)); return; }
    onCount?.(data.active.filter((d) => !d.videoTrashed).length);
    draw();
  }

  function draw() {
    const releaseBtn = mayShare && !archived ? button('Bestanden vrijgeven…', { icon: 'package', variant: 'primary', onClick: () => releaseDialog(project, { onDone: load }) }) : null;
    mount(host,
      h('div', { class: 'notice notice-info fb-intro' }, icon('info'), h('span', {},
        h('strong', {}, 'Vrijgeven is iets anders dan publiceren. '),
        'Publiceren zet een versie klaar voor review. Vrijgeven maakt een door de akkoordgever goedgekeurde versie beschikbaar als definitief bestand om te downloaden. Een nieuwe upload of reviewversie verandert een oplevering nooit.')),
      h('div', { class: 'dl-toolbar' }, releaseBtn,
        h('a', { class: 'btn btn-secondary', href: `/voorbeeld/oplevering/${project.id}`, target: '_blank', rel: 'noopener', title: 'Bekijk de opleverpagina precies zoals de klant hem ziet' }, icon('eye'), h('span', { class: 'btn-label' }, 'Klantweergave')),
        !mayShare ? h('span', { class: 'small muted' }, icon('lock'), ' Vrijgeven en links beheren doet een collega met het recht “Publiceren en delen”.') : null),
      activeSection(),
      noteSection(),
      mayShare ? linkSection() : null,
      historySection());
    const pre = Number(params.get('vrijgeven'));
    if (pre && mayShare && !archived) {
      params.delete('vrijgeven');
      history.replaceState(null, '', location.pathname);
      releaseDialog(project, { preselect: pre, onDone: load });
    }
  }

  function activeSection() {
    const rows = data.active.filter((d) => !d.videoTrashed);
    return h('section', { class: 'dl-section', 'aria-labelledby': 'dl-active' },
      h('h2', { id: 'dl-active', class: 'dl-head' }, 'Vrijgegeven bestanden', h('span', { class: 'seg-count' }, rows.length)),
      rows.length ? h('div', { class: 'dl-list' }, rows.map(activeRow)) : h('div', { class: 'card' }, emptyState({
        icon: 'package', compact: true, title: 'Nog niets vrijgegeven',
        text: 'Zodra de akkoordgever een versie heeft goedgekeurd, kun je hem hier definitief vrijgeven. De klant ziet hem dan op de opleverpagina.',
      })));
  }

  function activeRow(d) {
    const newer = [];
    if (d.newer.published) newer.push(`Versie ${d.newer.published.number} is gepubliceerd (${d.newer.published.statusLabel})`);
    if (d.newer.internal && d.newer.internal.number !== d.newer.published?.number) newer.push(`Versie ${d.newer.internal.number} staat intern klaar (${d.newer.internal.statusLabel})`);
    const thumb = h('a', { href: `/video/${d.videoId}?v=${d.versionId}`, 'data-nav': true, class: `thumb${d.file.meta?.orientation === 'staand' ? ' is-portrait' : ''}`, 'aria-hidden': 'true', tabindex: '-1' },
      d.file.hasPoster ? h('img', { src: `/api/versions/${d.versionId}/poster`, alt: '', loading: 'lazy' }) : h('div', { class: 'thumb-empty' }, icon('film')));
    return h('article', { class: `dl-row${d.available ? '' : ' is-blocked'}` },
      thumb,
      h('div', { class: 'dl-main' },
        h('div', { class: 'dl-title' }, h('a', { href: `/video/${d.videoId}?v=${d.versionId}`, 'data-nav': true }, d.title), h('span', { class: 'ver-chip' }, `Versie ${d.versionNumber}`),
          d.available ? h('span', { class: 'badge badge-ok' }, icon('checkCircle'), 'Beschikbaar voor de klant') : h('span', { class: 'badge badge-warn' }, icon('lock'), 'Geblokkeerd')),
        h('div', { class: 'small muted' }, [metaLine(d.file.meta), fileLine(d.file)].filter(Boolean).join(' · ')),
        h('div', { class: 'small muted' }, `Vrijgegeven ${formatDate(d.releasedAt)} door ${d.releasedBy}`, d.approval ? ` · goedgekeurd door ${d.approval.name} op ${formatDate(d.approval.at)}` : ''),
        !d.available ? h('div', { class: 'dl-alert small' }, icon('alert'), h('span', {}, d.reasonText)) : null,
        newer.length ? h('div', { class: 'dl-newer small' }, icon('layers'), h('span', {}, h('strong', {}, 'Er is een nieuwere versie dan de opgeleverde. '), newer.join('; '), '. De klant downloadt nog steeds versie ', String(d.versionNumber), '.')) : null),
      mayShare ? h('div', { class: 'dl-actions' },
        !archived ? button('Vervangen…', { icon: 'refresh', size: 'sm', onClick: () => releaseDialog(project, { onlyVideo: d.videoId, onDone: load }) }) : null,
        button('Terugnemen…', { icon: 'x', size: 'sm', variant: 'ghost', onClick: () => withdrawDialog(d, load) })) : null);
  }

  function noteSection() {
    const draftKey = `delivery-note-${project.id}`;
    const ta = h('textarea', { rows: '3', maxlength: '2000', placeholder: 'Bijv. “Hierbij de definitieve bestanden van de campagne. Veel succes met de lancering!”', disabled: !mayShare || archived, value: draftStore.get(draftKey) || data.note });
    ta.addEventListener('input', () => draftStore.set(draftKey, ta.value));
    const save = mayShare && !archived ? button('Tekst opslaan', { size: 'sm', onClick: async (e) => {
      const restore = busy(e.currentTarget);
      try {
        const r = await api('PUT', `/api/projects/${project.id}/delivery-note`, { note: ta.value });
        data.note = r.note;
        draftStore.set(draftKey, '');
        toast('Oplevertekst opgeslagen. De klant ziet hem bovenaan de opleverpagina.', 'success');
      } catch (err) { toast(`${err.message} Je tekst is bewaard.`, 'error'); }
      restore();
    } }) : null;
    return h('section', { class: 'dl-section', 'aria-labelledby': 'dl-note' },
      h('h2', { id: 'dl-note', class: 'dl-head' }, 'Oplevertekst voor de klant'),
      h('div', { class: 'card dl-card' }, field('Korte tekst bovenaan de opleverpagina', ta), save));
  }

  function linkSection() {
    const l = data.link;
    const oa = data.otherAccess;
    const act = async (btn, fn, msg) => {
      const restore = busy(btn);
      try { await fn(); toast(msg, 'success'); await load(); } catch (err) { toast(err.message, 'error'); restore(); }
    };
    const others = h('ul', { class: 'facts dl-others' },
      h('li', {}, icon('globe'), h('span', {}, oa.portalLinkActive
        ? [h('strong', {}, 'Klantportaal (projectlink): actief. '), 'Toont deze opleverpagina ook. Intrekken doe je apart via “Klantportaal”.']
        : [h('strong', {}, 'Klantportaal: '), 'geen actieve projectlink.'])),
      h('li', {}, icon('download'), h('span', {}, oa.reviewLinksWithDownload
        ? [h('strong', {}, `${plural(oa.reviewLinksWithDownload, 'reviewlink', 'reviewlinks')} met download aan. `), 'Die geven, volgens hun eigen instelling, download van gepubliceerde versies (ook als die niet zijn vrijgegeven).']
        : [h('strong', {}, 'Reviewlinks: '), `${oa.reviewLinks ? plural(oa.reviewLinks, 'actieve reviewlink', 'actieve reviewlinks') : 'geen actieve reviewlinks'}, zonder download.`])),
      h('li', {}, icon('shield'), h('span', {}, h('strong', {}, 'Akkoordlinks: '), oa.approverLinks ? `${oa.approverLinks} actief; daarmee kan alleen worden bekeken en goedgekeurd, niet gedownload.` : 'geen actief.')));
    const localNote = data.localOnly ? h('div', { class: 'notice notice-warn' }, icon('alert'),
      h('span', {}, h('strong', {}, 'Werkt nu alleen op deze computer. '), 'De link begint met localhost: klanten buiten deze Mac kunnen hem nog niet openen. Je kunt de pagina wel zelf bekijken en testen.')) : null;
    let body;
    if (!l) {
      body = [
        h('p', { class: 'small' }, 'Een aparte link die alleen toegang geeft tot de vrijgegeven bestanden van dit project: geen reviewpagina’s, geen concepten, geen feedback.'),
        localNote,
        h('div', { class: 'portal-actions' }, button('Opleverlink maken', { icon: 'link', variant: 'primary', disabled: archived, onClick: (e) => act(e.currentTarget, async () => {
          const r = await api('POST', `/api/projects/${project.id}/delivery-link`);
          await copyText(r.link.url);
        }, 'Opleverlink gemaakt en gekopieerd') })),
      ];
    } else {
      const replace = button('Vervangen…', { icon: 'refresh', size: 'sm', onClick: async (e) => {
        const btn = e.currentTarget;
        const ok = await confirmDialog({ title: 'Opleverlink vervangen?', body: h('div', {},
          h('p', {}, 'Er komt een nieuwe link. De huidige link werkt direct niet meer, ook niet voor downloads die iemand nog wil starten.'),
          h('p', { class: 'muted' }, 'Deel daarna de nieuwe link. Andere links (klantportaal, review- en akkoordlinks) veranderen niet.')), confirmLabel: 'Vervangen', danger: true });
        if (ok) act(btn, async () => { const r = await api('POST', `/api/projects/${project.id}/delivery-link`, { replace: true }); await copyText(r.link.url); }, 'Nieuwe opleverlink gemaakt en gekopieerd. De oude werkt niet meer.');
      } });
      const revoke = button('Intrekken…', { icon: 'trash', size: 'sm', variant: 'ghost', onClick: async (e) => {
        const btn = e.currentTarget;
        const ok = await confirmDialog({ title: 'Opleverlink intrekken?', body: h('div', {},
          h('p', {}, 'Wie deze link heeft, kan direct de opleverpagina niet meer openen en geen bestanden meer downloaden via deze link.'),
          h('p', {}, h('strong', {}, 'Blijft daarna nog toegang geven, volgens hun eigen rechten:')), others.cloneNode(true),
          h('p', { class: 'muted' }, 'De vrijgaven zelf blijven staan. Je kunt later een nieuwe opleverlink maken.')), confirmLabel: 'Intrekken', danger: true });
        if (ok) act(btn, () => api('POST', `/api/projects/${project.id}/delivery-link/revoke`), 'Opleverlink ingetrokken');
      } });
      body = [
        h('div', { class: 'link-row' },
          h('div', { class: 'link-row-head' }, h('strong', {}, 'Opleverlink'), h('span', { class: 'small muted link-used' }, l.lastUsedAt ? `geopend ${relativeDate(l.lastUsedAt)}` : 'nog niet geopend')),
          h('div', { class: 'link-copy' },
            h('input', { type: 'text', readonly: true, value: l.url, class: 'link-url', 'aria-label': 'Opleverlink', onFocus: (e) => e.target.select() }),
            button('Kopiëren', { icon: 'copy', size: 'sm', onClick: async () => { await copyText(l.url); toast('Opleverlink gekopieerd', 'success'); } }),
            h('a', { class: 'btn btn-sm btn-ghost', href: l.url, target: '_blank', rel: 'noopener', title: 'Openen (nieuw tabblad). Als ingelogd teamlid telt dit niet als klantactiviteit.' }, icon('external'), h('span', { class: 'visually-hidden' }, 'Openen')))),
        localNote,
        h('div', { class: 'portal-actions' }, h('span', { class: 'small muted' }, `Gemaakt ${formatDate(l.createdAt)}.`), h('span', { class: 'spacer' }), replace, revoke),
      ];
    }
    return h('section', { class: 'dl-section', 'aria-labelledby': 'dl-link' },
      h('h2', { id: 'dl-link', class: 'dl-head' }, 'Opleverlink'),
      h('div', { class: 'card dl-card' }, body,
        h('h3', { class: 'dl-subhead' }, 'Andere toegang tot dit project'), others));
  }

  function historySection() {
    const events = [];
    for (const d of data.history) {
      events.push({ at: d.releasedAt, icon: 'package', text: [h('strong', {}, `${d.title} · versie ${d.versionNumber}`), ` vrijgegeven door ${d.releasedBy}`, d.approval ? ` (goedgekeurd door ${d.approval.name})` : ''] });
      if (d.withdrawnAt) events.push({ at: d.withdrawnAt, icon: d.replacedByNumber ? 'refresh' : 'x', text: [h('strong', {}, `${d.title} · versie ${d.versionNumber}`), d.replacedByNumber ? ' vervangen' : ' teruggenomen', ` door ${d.withdrawnBy}`, h('span', { class: 'muted' }, ` · ${d.withdrawnReason}`)] });
    }
    for (const l of data.linkHistory) {
      events.push({ at: l.createdAt, icon: 'link', text: ['Opleverlink gemaakt door ', l.createdBy] });
      if (l.revokedAt) events.push({ at: l.revokedAt, icon: 'lock', text: ['Opleverlink ingetrokken door ', l.revokedBy] });
    }
    events.sort((a, b) => b.at.localeCompare(a.at));
    return h('details', { class: 'dl-section dl-history', open: events.length > 0 && events.length <= 6 },
      h('summary', { class: 'dl-head' }, 'Oplevergeschiedenis', h('span', { class: 'seg-count' }, events.length)),
      events.length ? h('ol', { class: 'timeline' }, events.map((e) => h('li', {},
        h('div', { class: 'timeline-head' }, icon(e.icon), h('time', { class: 'small muted', datetime: e.at }, formatDate(e.at))),
        h('div', { class: 'small' }, e.text)))) : h('p', { class: 'small muted' }, 'Nog geen vrijgaven of opleverlinks.'));
  }

  await load();
}

/** Terugnemen met bevestiging en reden. */
async function withdrawDialog(d, onDone) {
  const reason = h('textarea', { rows: '2', required: true, maxlength: '300', placeholder: 'Bijv. “Verkeerde audiomix, nieuwe versie volgt”' });
  await openDialog({
    title: `${d.title} · versie ${d.versionNumber} terugnemen?`,
    body: [
      h('p', {}, 'Het bestand verdwijnt van de opleverpagina en kan direct niet meer worden gedownload, ook niet via een eerder gekopieerde downloadlink.'),
      h('p', { class: 'small muted' }, 'De versie, de goedkeuring en de status veranderen niet. De vrijgave en het terugnemen blijven in de oplevergeschiedenis staan.'),
      field('Reden (verplicht, voor de geschiedenis)', reason),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-danger', value: 'ok' }, icon('x'), h('span', { class: 'btn-label' }, 'Terugnemen'))],
    onSubmit: async () => {
      if (!reason.value.trim()) { reason.classList.add('input-error'); reason.focus(); return false; }
      try {
        await api('POST', `/api/deliveries/${d.id}/withdraw`, { confirm: true, reason: reason.value });
        toast('Oplevering teruggenomen. De klant kan dit bestand niet meer downloaden.', 'success');
        onDone();
      } catch (err) { toast(err.message, 'error'); return false; }
    },
  });
}

/**
 * Vrijgeven in twee stappen: (1) per video de exacte goedgekeurde versie kiezen, (2) overzicht van
 * wat de klant krijgt en bevestigen. Bij een fout blijft het venster met de keuze open; dezelfde
 * request-id voorkomt dubbele vrijgaven bij opnieuw proberen.
 */
export async function releaseDialog(project, { preselect = null, onlyVideo = null, onDone } = {}) {
  let cand;
  try {
    cand = await api('GET', `/api/projects/${project.id}/delivery-candidates`);
  } catch (err) { toast(err.message, 'error'); return; }
  const videos = cand.videos.filter((v) => !onlyVideo || v.id === onlyVideo);
  const choice = new Map(); // videoId -> versionId
  for (const v of videos) {
    const pre = v.versions.find((x) => x.id === preselect && x.eligible);
    if (pre) choice.set(v.id, pre.id);
    else if (onlyVideo && v.versions.find((x) => x.eligible && x.id !== v.current?.versionId)) choice.set(v.id, v.versions.find((x) => x.eligible && x.id !== v.current?.versionId).id);
  }
  const requestId = newRequestId();
  let step = 1;
  const box = h('div', { class: 'release' });
  const back = h('button', { type: 'button', class: 'btn btn-ghost', hidden: true }, icon('arrowLeft'), h('span', { class: 'btn-label' }, 'Terug'));
  const next = h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Overzicht bekijken'));
  back.addEventListener('click', () => { step = 1; draw(); next.focus(); });
  const errorEl = h('div', { class: 'notice notice-error', role: 'alert', hidden: true });
  let ack = null;

  const selected = () => videos.filter((v) => choice.get(v.id)).map((v) => ({ video: v, version: v.versions.find((x) => x.id === choice.get(v.id)) }));
  const changes = () => selected().filter(({ video, version }) => !(video.current && video.current.versionId === version.id && video.current.available));

  function videoBlock(v) {
    const eligible = v.versions.filter((x) => x.eligible);
    const blocked = v.versions.filter((x) => !x.eligible && x.problem && (x.status === 'approved' || x.number === v.versions[0].number));
    const name = `rel-${v.id}`;
    const option = (value, label, sub, disabled = false) => {
      const input = h('input', { type: 'radio', name, value: String(value), disabled });
      input.checked = (choice.get(v.id) || 0) === value;
      input.addEventListener('change', () => { if (value) choice.set(v.id, value); else choice.delete(v.id); errorEl.hidden = true; drawCount(); });
      return h('label', { class: `release-opt${disabled ? ' is-disabled' : ''}` }, input, h('span', {}, h('span', {}, label), sub ? h('span', { class: 'small muted' }, sub) : null));
    };
    return h('fieldset', { class: 'release-video' },
      h('legend', {}, v.title, v.archived ? h('span', { class: 'badge badge-neutral' }, 'gearchiveerd') : null),
      v.current ? h('div', { class: 'small muted' }, icon('package'), ` Nu opgeleverd: versie ${v.current.versionNumber}${v.current.available ? '' : ' (geblokkeerd)'} · ${formatDate(v.current.releasedAt)}`) : null,
      option(0, v.current ? 'Niets wijzigen' : 'Niet vrijgeven', null),
      eligible.map((x) => option(x.id, `Versie ${x.number}${v.current?.versionId === x.id ? (v.current.available ? ' (al opgeleverd)' : ' (opnieuw vrijgeven)') : ''}`,
        `Goedgekeurd door ${x.approval.name} op ${formatDate(x.approval.at)} · ${fileLine(x.file)}`, v.archived)),
      blocked.map((x) => h('div', { class: 'release-blocked small' }, icon('lock'), h('span', {}, h('strong', {}, `Versie ${x.number}: `), x.problem))),
      !eligible.length && !blocked.length ? h('p', { class: 'small muted' }, 'Nog geen versie goedgekeurd door de akkoordgever.') : null);
  }

  function drawCount() {
    const n = changes().length;
    next.querySelector('.btn-label').textContent = step === 1 ? (n ? `Overzicht bekijken (${n})` : 'Overzicht bekijken') : `Vrijgeven (${n})`;
  }

  function draw() {
    back.hidden = step === 1;
    errorEl.hidden = true;
    if (step === 1) {
      const anyEligible = videos.some((v) => v.versions.some((x) => x.eligible));
      mount(box,
        h('p', {}, 'Kies per video de exacte versie die de klant als definitief bestand krijgt. Alleen versies die de akkoordgever zelf heeft goedgekeurd, kunnen worden vrijgegeven.'),
        !anyEligible ? h('div', { class: 'notice notice-warn' }, icon('info'), h('span', {}, 'Er is nog geen versie met een geldige klantgoedkeuring. Een handmatig op “Goedgekeurd” gezette status telt niet.')) : null,
        videos.length ? h('div', { class: 'release-list' }, videos.map(videoBlock)) : emptyState({ icon: 'film', compact: true, title: 'Geen video’s', text: 'Dit project heeft nog geen video’s.' }),
        errorEl);
    } else {
      const list = selected();
      const replacing = list.filter(({ video, version }) => video.current && video.current.versionId !== version.id);
      ack = replacing.length ? h('input', { type: 'checkbox' }) : null;
      mount(box,
        h('p', {}, h('strong', {}, 'Dit krijgt de klant'), ' op de opleverpagina (via de opleverlink en het klantportaal):'),
        h('div', { class: 'release-summary' }, list.map(({ video, version }) => {
          const unchanged = video.current && video.current.versionId === version.id && video.current.available;
          return h('div', { class: `release-item${unchanged ? ' is-unchanged' : ''}` },
            icon(unchanged ? 'check' : 'package'),
            h('div', {},
              h('div', {}, h('strong', {}, video.title), ` · versie ${version.number}`, unchanged ? h('span', { class: 'muted' }, ' · al opgeleverd, blijft ongewijzigd') : null),
              h('div', { class: 'small muted' }, `${version.file.filename} · ${fileLine(version.file)}`),
              h('div', { class: 'small muted' }, `Goedgekeurd door ${version.approval.name} op ${formatDate(version.approval.at)}`),
              video.current && video.current.versionId !== version.id ? h('div', { class: 'small dl-replace' }, icon('refresh'), ` Vervangt de huidige oplevering (versie ${video.current.versionNumber}). Die is daarna niet meer te downloaden.`) : null));
        })),
        ack ? h('label', { class: 'check' }, ack, `Ik vervang bewust ${plural(replacing.length, 'opgeleverd bestand', 'opgeleverde bestanden')}.`) : null,
        h('p', { class: 'small muted' }, 'De klant downloadt precies deze bestanden. Een latere upload of reviewversie verandert dit niet; vervangen vraagt opnieuw een bewuste vrijgave.'),
        errorEl);
    }
    drawCount();
  }

  const showError = (err) => {
    const details = err.data?.details || [];
    errorEl.hidden = false;
    mount(errorEl, icon('alert'), h('div', {}, h('strong', {}, err.message),
      details.length > 1 ? h('ul', { class: 'small' }, details.map((d) => h('li', {}, `${d.title || 'Versie'}: ${d.error}`))) : null,
      err.status === 0 ? h('div', { class: 'small' }, 'Je keuze is bewaard; klik nogmaals op Vrijgeven. Een dubbele vrijgave is niet mogelijk.') : null));
  };

  draw();
  await openDialog({
    title: onlyVideo ? 'Oplevering vervangen' : 'Bestanden definitief vrijgeven',
    body: box,
    wide: true,
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('span', { class: 'spacer' }), back, next],
    onSubmit: async () => {
      if (step === 1) {
        if (!changes().length) { showError({ message: 'Kies minstens één goedgekeurde versie die nog niet is opgeleverd.' }); return false; }
        step = 2;
        draw();
        // De bezig-indicator van de knop zet na afloop het oude label terug; daarna pas bijwerken.
        setTimeout(drawCount);
        return false;
      }
      if (ack && !ack.checked) { showError({ message: 'Vink aan dat je de huidige oplevering bewust vervangt.' }); return false; }
      try {
        const items = changes().map(({ video, version }) => ({ versionId: version.id, replace: !!(video.current && video.current.versionId !== version.id) }));
        const r = await apiWithRetry('POST', `/api/projects/${project.id}/deliveries`, { items, confirm: true, requestId });
        toast(r.replayed ? 'Deze vrijgave was al verwerkt.' : `${plural(r.released.length, 'bestand', 'bestanden')} definitief vrijgegeven.`, 'success');
        onDone?.();
      } catch (err) {
        showError(err);
        return false;
      }
    },
  });
}
