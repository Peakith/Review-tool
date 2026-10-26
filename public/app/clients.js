// Klanten: een klant heeft projecten en een eigen klantportaal (klant → projecten → video's en
// opleveringen). Projecten worden alleen expliciet gekoppeld, nooit op basis van een klantnaam.
// Per project kies je de klanttoegang: Actief, Afgerond (ingeklapt in het portaal) of Klanttoegang uit.
import { h, mount, icon, button, api, toast, openDialog, field, confirmDialog, copyText, emptyState, skeletonRows, formatDate, relativeDate, plural, busy } from '/shared/util.js';
import { protectionBadges, protectionButton } from './linkprotect.js';
import { brandChip } from './brandchip.js';

export const VISIBILITY = [
  ['active', 'Actief', 'Zichtbaar in het klantportaal; alle klantlinks werken.'],
  ['completed', 'Afgerond', 'Ingeklapt onder “Afgeronde projecten”; links blijven werken.'],
  ['off', 'Klanttoegang uit', 'Verborgen, en geen enkele klantlink werkt (ook oude links en directe bestandsadressen niet).'],
];
const visibilityLabel = (v) => VISIBILITY.find(([k]) => k === v)?.[1] || v;
const LANG_LABEL = { nl: 'Nederlands', en: 'Engels' };

export async function viewClients(ctx) {
  const { pageEl, pageHeader, navigate } = ctx;
  document.title = 'Klanten — Studio Review';
  mount(pageEl, h('div', { class: 'page' }, pageHeader({ title: 'Klanten' }), skeletonRows(3)));
  const r = await api('GET', '/api/clients');
  const newBtn = r.canCreate ? button('Nieuwe klant', { icon: 'plus', variant: 'primary', onClick: () => clientDialog(null, (id) => navigate(`/klanten/${id}`)) }) : null;
  const list = r.clients.length
    ? h('div', { class: 'client-list', role: 'list' }, r.clients.map((c) => h('a', { class: 'client-row', href: `/klanten/${c.id}`, 'data-nav': true, role: 'listitem' },
      h('span', { class: 'client-avatar', 'aria-hidden': 'true' }, c.name.slice(0, 1).toUpperCase()),
      h('span', { class: 'client-main' }, h('strong', { class: 'truncate' }, c.name),
        h('span', { class: 'small muted' }, [plural(c.projectCount, 'project', 'projecten'), c.activeProjectCount !== c.projectCount ? `${c.activeProjectCount} actief` : null, LANG_LABEL[c.language]].filter(Boolean).join(' · '))),
      c.brand ? brandChip(c.brand) : null,
      c.activeLinks !== null ? h('span', { class: 'badge badge-neutral', title: 'Actieve klantportaallinks' }, icon('link'), String(c.activeLinks)) : null,
      icon('chevronRight'))))
    : h('div', { class: 'card' }, emptyState({
      icon: 'users', title: 'Nog geen klanten',
      text: r.canCreate ? 'Maak een klant aan en koppel er projecten aan. Daarna kun je de klant één portaal geven met al zijn projecten.' : 'Er zijn nog geen klanten met projecten waar jij toegang toe hebt.',
      action: newBtn,
    }));
  mount(pageEl, h('div', { class: 'page page-narrow' },
    pageHeader({ title: 'Klanten', meta: r.clients.length ? plural(r.clients.length, 'klant', 'klanten') : null, actions: r.clients.length ? newBtn : null }),
    h('p', { class: 'small muted' }, 'Een klant krijgt één klantportaal met al zijn zichtbare projecten. Losse project-, review-, akkoord- en opleverlinks blijven daarnaast gewoon werken.'),
    list));
}

export async function viewClient(ctx, id) {
  const { pageEl, pageHeader, navigate } = ctx;
  mount(pageEl, h('div', { class: 'page' }, skeletonRows(4)));
  const c = await api('GET', `/api/clients/${id}`);
  document.title = `${c.name} — Klanten — Studio Review`;
  const reload = () => viewClient(ctx, id);

  const projectRows = c.projects.length
    ? h('div', { class: 'client-projects' }, c.projects.map((p) => h('div', { class: `client-project is-${p.visibility}` },
      h('div', { class: 'client-project-main' },
        h('a', { href: `/projecten/${p.id}`, 'data-nav': true, class: 'truncate' }, h('strong', {}, p.name)),
        h('span', { class: 'small muted' }, [plural(p.publishedCount, 'gepubliceerde video', 'gepubliceerde video’s'), p.archived ? 'gearchiveerd' : null].filter(Boolean).join(' · '))),
      p.canManage ? visibilityControl(p, reload) : h('span', { class: `badge ${p.visibility === 'off' ? 'badge-danger' : 'badge-neutral'}` }, visibilityLabel(p.visibility)),
      p.canManage ? button('', { icon: 'unlink', size: 'sm', variant: 'ghost', 'aria-label': `${p.name} loskoppelen van ${c.name}`, title: 'Loskoppelen', onClick: async () => {
        const ok = await confirmDialog({ title: 'Project loskoppelen?', body: `“${p.name}” verdwijnt uit het klantportaal van ${c.name}. Video’s die de klant via dat portaal opende, zijn dan niet meer bereikbaar. Losse project-, review- en akkoordlinks van het project blijven werken.`, confirmLabel: 'Loskoppelen', danger: true });
        if (!ok) return;
        try { await api('PUT', `/api/projects/${p.id}/client`, { clientId: null }); toast('Project losgekoppeld', 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
      } }) : null)))
    : h('p', { class: 'small muted' }, 'Nog geen projecten gekoppeld.');

  const assignBtn = c.assignable.length ? button('Project koppelen', { icon: 'plus', size: 'sm', onClick: () => assignDialog(c, reload) }) : null;

  const links = c.isAdmin ? linksSection(c, reload) : null;

  mount(pageEl, h('div', { class: 'page page-narrow' },
    pageHeader({
      crumbs: [{ label: 'Klanten', href: '/klanten' }],
      title: c.name,
      meta: [h('span', {}, `Klantweergave: ${LANG_LABEL[c.language]}`), c.brand ? brandChip(c.brand) : null],
      actions: c.isAdmin ? button('Bewerken', { icon: 'edit', onClick: () => clientDialog(c, reload) }) : null,
    }),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Projecten'), assignBtn),
      projectRows,
      c.hiddenProjects ? h('p', { class: 'small muted' }, `${plural(c.hiddenProjects, 'ander project', 'andere projecten')} van deze klant zie je niet, omdat je daar geen toegang toe hebt.`) : null,
      h('details', { class: 'share-more' }, h('summary', {}, 'Wat betekenen Actief, Afgerond en Klanttoegang uit?'),
        h('ul', { class: 'facts' }, VISIBILITY.map(([k, label, text]) => h('li', {}, icon(k === 'off' ? 'lock' : k === 'completed' ? 'history' : 'eye'), h('span', {}, h('strong', {}, `${label}: `), text)))),
        h('p', { class: 'small muted' }, 'Zet je klanttoegang later weer aan, dan werken links die je los had ingetrokken nog steeds niet.'))),
    links,
    c.isAdmin ? h('div', { class: 'danger-zone' }, button('Klant verwijderen…', { icon: 'trash', size: 'sm', variant: 'ghost', onClick: async () => {
      const ok = await confirmDialog({ title: 'Klant verwijderen?', body: 'Dit kan alleen als er geen projecten meer aan deze klant gekoppeld zijn. Alle klantportaallinks van deze klant werken daarna niet meer.', confirmLabel: 'Verwijderen', danger: true });
      if (!ok) return;
      try { await api('DELETE', `/api/clients/${c.id}`); toast('Klant verwijderd', 'success'); navigate('/klanten'); } catch (err) { toast(err.message, 'error'); }
    } })) : null));
}

function visibilityControl(p, reload) {
  const group = h('div', { class: 'segmented segmented-sm', role: 'radiogroup', 'aria-label': `Klanttoegang voor ${p.name}` },
    VISIBILITY.map(([key, label, text]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(p.visibility === key), 'aria-pressed': String(p.visibility === key), title: text,
      class: key === 'off' ? 'is-danger' : '',
      onClick: async () => {
        if (p.visibility === key) return;
        if (key === 'off') {
          const ok = await confirmDialog({ title: 'Klanttoegang uitzetten?', body: `Voor “${p.name}” werkt dan geen enkele klantlink meer: klantportaal, projectlink, review- en akkoordlinks, opleverlink en directe bestandsadressen. Het team kan gewoon verder. Je kunt het later weer aanzetten.`, confirmLabel: 'Klanttoegang uit', danger: true });
          if (!ok) return;
        }
        try { await api('PUT', `/api/projects/${p.id}/client-visibility`, { visibility: key }); toast(`Klanttoegang: ${label}`, 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
      },
    }, label)));
  return group;
}

async function assignDialog(c, reload) {
  const select = h('select', { required: true }, h('option', { value: '' }, 'Kies een project…'),
    c.assignable.map((p) => h('option', { value: p.id }, `${p.name}${p.clientName ? ` (klantnaam: ${p.clientName})` : ''}${p.otherClient ? ` — nu bij ${p.otherClient}` : ''}`)));
  const warn = h('p', { class: 'notice notice-warn', hidden: true });
  select.addEventListener('change', () => {
    const p = c.assignable.find((x) => String(x.id) === select.value);
    warn.hidden = !p?.otherClient;
    if (p?.otherClient) warn.textContent = `Dit project hoort nu bij ${p.otherClient}. Na koppelen verdwijnt het uit dat klantportaal.`;
  });
  await openDialog({
    title: `Project koppelen aan ${c.name}`,
    body: [field('Project', select, 'Alleen projecten waarin jij “Beheren” mag. De klantnaam bij een project wordt niet gebruikt om automatisch te koppelen.'), warn],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Koppelen'))],
    onSubmit: async () => {
      if (!select.value) { select.focus(); return false; }
      try { await api('PUT', `/api/projects/${select.value}/client`, { clientId: c.id }); toast('Project gekoppeld', 'success'); } catch (err) { toast(err.message, 'error'); return false; }
    },
  });
  reload();
}

function linksSection(c, reload) {
  const active = c.links.filter((l) => !l.revokedAt);
  const revoked = c.links.filter((l) => l.revokedAt);
  const row = (l) => h('div', { class: 'link-row' },
    h('div', { class: 'link-row-head' },
      h('strong', { class: 'truncate' }, l.personal ? `Persoonlijk: ${l.approverName}` : (l.label || 'Klantportaal')),
      l.personal ? h('span', { class: 'badge badge-verified', title: `Kan goedkeuren bij video’s waar ${l.approverEmail} de akkoordgever is` }, icon('shield'), 'akkoordgever') : null,
      protectionBadges(l.protection),
      h('span', { class: 'small muted link-used' }, l.lastUsedAt ? `geopend ${relativeDate(l.lastUsedAt)}` : 'nog niet geopend')),
    h('div', { class: 'link-copy' },
      h('input', { type: 'text', readonly: true, value: l.url, class: 'link-url', 'aria-label': 'Klantportaallink', onFocus: (e) => e.target.select() }),
      button('Kopiëren', { icon: 'copy', size: 'sm', onClick: async () => { await copyText(l.url); toast('Link gekopieerd', 'success'); } }),
      h('a', { class: 'btn btn-sm btn-ghost', href: l.url, target: '_blank', rel: 'noopener', title: 'Openen als klant (nieuw tabblad)' }, icon('external'), h('span', { class: 'visually-hidden' }, 'Openen'))),
    h('div', { class: 'link-row-foot' },
      protectionButton('client', l, reload),
      button('Intrekken…', { icon: 'trash', size: 'sm', variant: 'ghost', onClick: async () => {
        const ok = await confirmDialog({ title: 'Klantportaallink intrekken?', body: 'Wie deze link heeft, ziet het portaal direct niet meer, ook niet de video’s die via dit portaal zijn geopend. Reacties, feedback en goedkeuringen blijven bewaard.', confirmLabel: 'Intrekken', danger: true });
        if (!ok) return;
        try { await api('POST', `/api/client-links/${l.id}/revoke`); toast('Link ingetrokken', 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
      } })));
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Klantportaal'), button('Nieuwe link', { icon: 'plus', size: 'sm', onClick: () => newLinkDialog(c, reload) })),
    h('ul', { class: 'facts' },
      h('li', {}, icon('eye'), h('span', {}, `De klant ziet ${plural(c.portalProjects, 'zichtbaar project', 'zichtbare projecten')} met alleen gepubliceerde video’s, opleveringen en gedeelde briefing.`)),
      h('li', {}, icon('shield'), h('span', {}, h('strong', {}, 'Een algemene link kan nooit goedkeuren. '), 'Een persoonlijke link kan alleen goedkeuren bij video’s waar die persoon (op e-mailadres) de aangewezen akkoordgever is.'))),
    c.localOnly ? h('div', { class: 'notice notice-warn' }, icon('alert'), h('span', {}, h('strong', {}, 'Werkt nu alleen op deze computer. '), 'De links beginnen met localhost: klanten buiten deze Mac kunnen ze nog niet openen.')) : null,
    active.length ? active.map(row) : h('p', { class: 'small muted' }, 'Nog geen klantportaallink.'),
    revoked.length ? h('details', { class: 'share-more' }, h('summary', {}, `Ingetrokken links (${revoked.length})`),
      revoked.map((l) => h('div', { class: 'link-row is-revoked' }, h('strong', { class: 'small' }, l.personal ? `Persoonlijk: ${l.approverName}` : (l.label || 'Klantportaal')), h('span', { class: 'small muted' }, ` · ingetrokken ${formatDate(l.revokedAt)}${l.revokedBy ? ` door ${l.revokedBy}` : ''}`)))) : null);
}

async function newLinkDialog(c, reload) {
  const kindGeneral = h('input', { type: 'radio', name: 'link-kind', value: 'general', checked: true });
  const kindPersonal = h('input', { type: 'radio', name: 'link-kind', value: 'personal' });
  const label = h('input', { type: 'text', maxlength: '100', placeholder: 'Bijv. “Marketingteam”' });
  const name = h('input', { type: 'text', maxlength: '120', placeholder: 'Naam', 'aria-label': 'Naam akkoordgever', autocomplete: 'off' });
  const email = h('input', { type: 'email', maxlength: '200', placeholder: 'E-mailadres', 'aria-label': 'E-mailadres akkoordgever', autocomplete: 'off' });
  const personalBox = h('div', { class: 'share-form share-form-row', hidden: true }, name, email);
  const sync = () => { personalBox.hidden = !kindPersonal.checked; };
  kindGeneral.addEventListener('change', sync);
  kindPersonal.addEventListener('change', sync);
  let created = null;
  await openDialog({
    title: `Nieuwe klantportaallink voor ${c.name}`,
    body: [
      h('fieldset', { class: 'radio-cards' },
        h('legend', { class: 'field-label' }, 'Soort link'),
        h('label', { class: 'radio-card' }, kindGeneral, h('span', {}, h('strong', {}, 'Algemeen'), h('span', { class: 'small muted' }, 'Bekijken, reageren en feedback versturen. Kan niet goedkeuren.'))),
        h('label', { class: 'radio-card' }, kindPersonal, h('span', {}, h('strong', {}, 'Persoonlijk voor een akkoordgever'), h('span', { class: 'small muted' }, 'Zelfde portaal, maar goedkeuren kan bij video’s waar deze persoon de aangewezen akkoordgever is.')))),
      personalBox,
      field('Label (optioneel)', label, 'Alleen voor het team, om links uit elkaar te houden.'),
      h('p', { class: 'small muted' }, 'Wachtwoord en vervaldatum stel je na het maken in via “Beveiliging”.'),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Link maken'))],
    onSubmit: async () => {
      const body = { label: label.value };
      if (kindPersonal.checked) {
        if (!name.value.trim()) { name.classList.add('input-error'); name.focus(); return false; }
        if (!email.value.trim()) { email.classList.add('input-error'); email.focus(); return false; }
        Object.assign(body, { approverName: name.value, approverEmail: email.value });
      }
      try { created = await api('POST', `/api/clients/${c.id}/links`, body); } catch (err) { toast(err.message, 'error'); return false; }
    },
  });
  if (!created) return;
  await copyText(created.url);
  toast('Link gemaakt en gekopieerd', 'success');
  reload();
}

/** Nieuwe klant of klant bewerken (alleen beheerders). */
export async function clientDialog(c, onDone) {
  const name = h('input', { type: 'text', maxlength: '120', required: true, value: c?.name || '', autofocus: true });
  const lang = h('select', {}, Object.entries(LANG_LABEL).map(([k, l]) => h('option', { value: k }, l)));
  lang.value = c?.language || 'nl';
  const brand = h('select', {}, h('option', { value: '' }, 'Standaard (Studio Review)'));
  api('GET', '/api/brands').then((list) => {
    for (const b of list) brand.append(h('option', { value: b.id }, b.name));
    brand.value = c?.brandId ? String(c.brandId) : '';
  }).catch(() => {});
  let id = null;
  await openDialog({
    title: c ? 'Klant bewerken' : 'Nieuwe klant',
    body: [
      field('Naam', name),
      field('Standaardtaal klantweergave', lang, 'Klanten kunnen zelf wisselen tussen Nederlands en Engels. Titels, reacties en briefing worden niet vertaald.'),
      field('Merk van het klantportaal', brand, 'Elk project houdt zijn eigen merk op de videopagina’s.'),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, c ? 'Opslaan' : 'Klant maken'))],
    onSubmit: async () => {
      if (!name.value.trim()) { name.classList.add('input-error'); name.focus(); return false; }
      const body = { name: name.value, language: lang.value, brandId: brand.value || null };
      try {
        if (c) { await api('PATCH', `/api/clients/${c.id}`, body); id = c.id; } else { id = (await api('POST', '/api/clients', body)).id; }
      } catch (err) { toast(err.message, 'error'); return false; }
    },
  });
  if (id) { toast(c ? 'Klant bijgewerkt' : 'Klant gemaakt', 'success'); onDone?.(id); }
}

/**
 * Projectpagina: klant kiezen en klanttoegang instellen (recht “Beheren”). Toont ook wat een
 * wijziging betekent voor bestaande links.
 */
export async function clientSection(project, onDone) {
  let clients = [];
  try { clients = (await api('GET', '/api/clients')).clients; } catch { /* lijst is niet kritisch */ }
  const select = h('select', {}, h('option', { value: '' }, 'Geen klant'), clients.map((c) => h('option', { value: c.id }, c.name)));
  select.value = project.client ? String(project.client.id) : '';
  let visibility = project.clientVisibility || 'active';
  const vis = h('div', { class: 'radio-cards' });
  const drawVis = () => mount(vis, VISIBILITY.map(([key, label, text]) => h('label', { class: `radio-card${key === 'off' ? ' is-danger' : ''}` },
    h('input', { type: 'radio', name: 'client-visibility', value: key, checked: visibility === key, onChange: () => { visibility = key; } }),
    h('span', {}, h('strong', {}, label), h('span', { class: 'small muted' }, text)))));
  drawVis();
  let changed = false;
  await openDialog({
    title: 'Klant en klanttoegang',
    body: [
      field('Klant', select, clients.length ? 'Het project verschijnt in het klantportaal van deze klant (als de klanttoegang niet uit staat).' : 'Er zijn nog geen klanten (of geen klanten die je kunt zien). Een beheerder maakt klanten aan onder Klanten.'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Klanttoegang'), vis,
        h('span', { class: 'field-hint' }, 'Geldt voor álle klantlinks van dit project, ook de projectlink, losse review- en akkoordlinks en de opleverlink. Weer aanzetten heropent geen links die je los had ingetrokken.')),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Opslaan'))],
    onSubmit: async (value, form) => {
      const restore = busy(form.querySelector('.btn-primary'));
      try {
        const clientId = select.value ? Number(select.value) : null;
        if (clientId !== (project.client?.id || null)) { await api('PUT', `/api/projects/${project.id}/client`, { clientId }); changed = true; }
        if (visibility !== project.clientVisibility) {
          if (visibility === 'off' && !(await confirmDialog({ title: 'Klanttoegang uitzetten?', body: 'Geen enkele klantlink van dit project werkt dan nog, ook niet voor bestanden. Het team kan gewoon verder.', confirmLabel: 'Klanttoegang uit', danger: true }))) { restore(); return false; }
          await api('PUT', `/api/projects/${project.id}/client-visibility`, { visibility });
          changed = true;
        }
      } catch (err) { toast(err.message, 'error'); restore(); return false; }
      restore();
    },
  });
  if (changed) { toast('Opgeslagen', 'success'); onDone?.(); }
}

