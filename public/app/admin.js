// Beheerschermen: team en rechten, opslag en back-ups, prullenbak en archief.
import {
  h, mount, icon, button, busy, api, toast, confirmDialog, openDialog, field, formatDate, relativeDate,
  formatBytes, emptyState, plural,
} from '/shared/util.js';
import { applyBrand, brandMark, palette } from '/shared/brand.js';
import { clientPill } from '/shared/client.js';
import { ROLE_LABEL, ACCOUNT_LABEL, rolesFor, expiryLabel, toLocalInput, fromLocalInput, rightsMatrix, timeZone } from './roles.js';

// Niveaus in volgorde (zie server/access.js). Rollen en uitleg staan in roles.js.
export const LEVELS = ['feedback', 'read', 'view', 'upload', 'publish', 'manage'];
const rank = (l) => LEVELS.indexOf(l);
export const can = (level, need) => !!level && rank(level) >= rank(need);

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

// ---------- Team en rechten ----------

export async function viewTeam(ctx) {
  const { session } = ctx;
  if (!session.user.isAdmin) return viewMyAccount(ctx);
  document.title = 'Team & rechten — Studio Review';
  const [users, projects, freshSession, { notice: rolesNotice }] = await Promise.all([api('GET', '/api/users'), api('GET', '/api/projects?archived=1'), api('GET', '/api/session'), api('GET', '/api/system/roles-notice').catch(() => ({ notice: null }))]);
  ctx.session.media = freshSession.media;
  const reload = () => ctx.refresh();

  const row = (u) => {
    const isMe = u.id === session.user.id;
    const scope = u.role === 'admin'
      ? h('span', { class: 'muted' }, 'Alle projecten en instellingen')
      : u.projects.length
        ? h('span', {}, u.projects.slice(0, 3).map((p) => `${p.name} (${(ROLE_LABEL[p.role] || p.level).toLowerCase()}${p.expired ? ', verlopen' : p.expiresAt ? ', tijdelijk' : ''})`).join(' · '), u.projects.length > 3 ? ` · +${u.projects.length - 3}` : '')
        : h('span', { class: 'warn-text' }, icon('alert'), 'Nog geen projecten');
    return h('li', { class: `member-row${u.disabled ? ' is-disabled' : ''}` },
      h('span', { class: 'avatar' }, initials(u.name)),
      h('div', { class: 'member-main' },
        h('div', { class: 'member-name' }, h('strong', { class: 'truncate' }, u.name), isMe ? h('span', { class: 'muted' }, ' (jij)') : null,
          h('span', { class: `badge ${u.role === 'admin' ? 'badge-accent' : 'badge-neutral'}` }, ACCOUNT_LABEL[u.role] || u.role),
          u.disabled ? h('span', { class: 'badge badge-guest' }, 'Uitgeschakeld') : null),
        h('div', { class: 'small muted truncate' }, u.email),
        h('div', { class: 'small member-scope' }, scope)),
      h('div', { class: 'member-actions' },
        u.role !== 'admin' ? button('Projecten', { icon: 'lock', size: 'sm', onClick: () => accessDialog(u, projects, reload), 'aria-label': `Projecten en rollen van ${u.name}` }) : null,
        userMenu(u, isMe, reload)));
  };

  const name = h('input', { required: true, autocomplete: 'off' });
  const email = h('input', { type: 'email', required: true, autocomplete: 'off' });
  const password = h('input', { type: 'password', minlength: '10', required: true, autocomplete: 'new-password' });
  const role = h('select', {}, h('option', { value: 'member' }, 'Teamlid — alleen toegewezen projecten'), h('option', { value: 'freelancer' }, 'Freelancer — alleen klantfeedback bekijken'), h('option', { value: 'admin' }, 'Beheerder — alles'));
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), h('span', { class: 'btn-label' }, 'Toevoegen'));
  const form = h('form', { class: 'card', onSubmit: async (e) => {
    e.preventDefault();
    const restore = busy(submit);
    try {
      const { id } = await api('POST', '/api/users', { name: name.value, email: email.value, password: password.value, role: role.value });
      toast(`${name.value} is toegevoegd. Deel het tijdelijke wachtwoord via een veilig kanaal.`, 'success');
      if (role.value !== 'admin') {
        const fresh = (await api('GET', '/api/users')).find((x) => x.id === id);
        await accessDialog(fresh, projects, () => {});
      }
      reload();
    } catch (err) { toast(err.message, 'error'); restore(); }
  } },
  h('h2', { class: 'card-title' }, 'Account toevoegen'),
  h('div', { class: 'form-grid form-grid-4' }, field('Naam', name), field('E-mailadres', email), field('Tijdelijk wachtwoord', password, 'Minimaal 10 tekens.'), field('Rol', role)),
  submit);

  const m = ctx.session.media;
  const tool = (label, ok, p, missing) => h('li', { class: ok ? 'is-ok' : 'is-bad' }, icon(ok ? 'checkCircle' : 'alert'),
    h('div', {}, h('strong', {}, label), h('div', { class: 'small muted mono' }, ok ? p : missing)));

  mount(ctx.pageEl, h('div', { class: 'page page-narrow' },
    ctx.pageHeader({ title: 'Team & rechten', meta: `${plural(users.filter((u) => !u.disabled).length, 'actief account', 'actieve accounts')}` }),
    rolesNotice ? rolesNoticeBox(rolesNotice, reload) : null,
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, 'Teamleden'),
      h('ul', { class: 'member-list' }, users.map(row))),
    form,
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, 'Rollen en rechten'),
      h('p', { class: 'small muted' }, 'Teamleden en freelancers zien alleen de projecten waaraan ze zijn gekoppeld; een rol in het ene project geeft niets in een ander project. Klanten en akkoordgevers werken los hiervan via hun eigen links, zonder account.'),
      rightsMatrix()),
    h('section', { class: 'card', id: 'systeem' }, h('h2', { class: 'card-title' }, 'Systeem'),
      h('ul', { class: 'system-list' },
        tool('ffprobe · inhoudscontrole van uploads', m?.ffprobe, m?.paths?.ffprobe, 'Niet gevonden. Installeer ffmpeg (macOS: brew install ffmpeg) en herstart.'),
        tool('ffmpeg · thumbnails', m?.ffmpeg, m?.paths?.ffmpeg, 'Niet gevonden. Zonder ffmpeg krijgen nieuwe uploads geen thumbnail.')),
      h('p', { class: 'small muted' }, 'Controleer de installatie in de terminal met ', h('code', {}, 'npm run check'), '. Opslag en back-ups vind je onder ', h('a', { href: '/opslag', 'data-nav': true }, 'Opslag & back-ups'), '.'))));
}

function userMenu(u, isMe, reload) {
  const act = async (fn, msg) => { try { await fn(); toast(msg, 'success'); reload(); } catch (err) { toast(err.message, 'error'); } };
  const setRole = (role, msg, body) => async () => {
    if (await confirmDialog({ title: `${u.name}: ${ACCOUNT_LABEL[role]}?`, body, confirmLabel: `${ACCOUNT_LABEL[role]} maken` })) act(() => api('PATCH', `/api/users/${u.id}`, { role }), msg);
  };
  const items = [
    u.role === 'admin'
      ? ['Teamlid maken (geen beheer)', () => act(() => api('PATCH', `/api/users/${u.id}`, { role: 'member' }), `${u.name} is nu teamlid`)]
      : ['Beheerder maken…', setRole('admin', `${u.name} is nu beheerder`, 'Een beheerder heeft toegang tot alle projecten, accounts, merken, opslag en back-ups.')],
    u.role === 'member' ? ['Freelancer maken…', setRole('freelancer', `${u.name} is nu freelancer`, 'In alle gekoppelde projecten wordt de rol Freelancer: alleen verstuurde klantfeedback bekijken. Toewijzingen van taken vervallen.')] : null,
    u.role === 'freelancer' ? ['Teamlid maken…', setRole('member', `${u.name} is nu teamlid`, 'In de gekoppelde projecten begint deze persoon als Meekijker (alleen kijken). Breid de rol daarna per project bewust uit.')] : null,
    ['Wachtwoord instellen…', () => passwordDialog(u)],
    !isMe ? (u.disabled
      ? ['Weer inschakelen', () => act(() => api('PATCH', `/api/users/${u.id}`, { disabled: false }), `${u.name} kan weer inloggen`)]
      : ['Uitschakelen…', async () => {
        if (await confirmDialog({ title: `${u.name} uitschakelen?`, body: 'Inloggen is niet meer mogelijk en lopende sessies worden direct beëindigd. Reacties en uploads blijven bewaard. Je kunt het account later weer inschakelen.', confirmLabel: 'Uitschakelen', danger: true })) {
          act(() => api('PATCH', `/api/users/${u.id}`, { disabled: true }), `${u.name} is uitgeschakeld`);
        }
      }]) : null,
  ].filter(Boolean);
  return menuButton(items, `Meer acties voor ${u.name}`);
}

/** Kleine uitklapmenu-knop. items: [label, onClick, {danger}] */
/**
 * Menu achter één knop. Standaard een ⋯-knop met alleen een toegankelijk label; met
 * trigger: { label, icon } een gewone knop met zichtbare tekst (bijv. “Delen”).
 */
export function menuButton(items, label = 'Meer acties', trigger_ = null) {
  const menu = h('div', { class: 'menu', role: 'menu', hidden: true }, items.filter(Boolean).map(([text, onClick, opts = {}]) =>
    h('button', { type: 'button', class: `menu-item${opts.danger ? ' is-danger' : ''}`, role: 'menuitem', onClick: () => { close(); onClick(); } }, opts.icon ? icon(opts.icon) : null, text)));
  const trigger = trigger_
    ? button(trigger_.label, { icon: trigger_.icon, variant: trigger_.variant || 'secondary', 'aria-haspopup': 'menu', 'aria-expanded': 'false' })
    : button('', { icon: 'more', variant: 'ghost', size: 'sm', 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  const wrap = h('div', { class: 'menu-wrap' }, trigger, menu);
  const close = () => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside); };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  trigger.addEventListener('click', () => {
    if (!menu.hidden) return close();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    menu.querySelector('.menu-item')?.focus();
    setTimeout(() => document.addEventListener('click', outside));
  });
  menu.addEventListener('keydown', (e) => {
    const all = [...menu.querySelectorAll('.menu-item')];
    const i = all.indexOf(document.activeElement);
    if (e.key === 'Escape') { close(); trigger.focus(); }
    if (e.key === 'ArrowDown') { all[(i + 1) % all.length].focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { all[(i - 1 + all.length) % all.length].focus(); e.preventDefault(); }
  });
  return wrap;
}

async function accessDialog(user, projects, reload) {
  const current = new Map(user.projects.map((p) => [p.projectId, p]));
  const roles = rolesFor(user.role);
  const rows = projects.map((p) => {
    const cur = current.get(p.id);
    const sel = h('select', { 'aria-label': `Rol in ${p.name}` },
      h('option', { value: '' }, 'Geen toegang'),
      roles.map((r) => h('option', { value: r.key }, r.label)));
    sel.value = cur ? (user.role === 'freelancer' ? 'freelancer' : cur.role) : '';
    const until = h('input', { type: 'datetime-local', value: toLocalInput(cur?.expiresAt), 'aria-label': `Toegang tot (optioneel) voor ${p.name}`, title: `Tijdzone: ${timeZone()}` });
    return { p, sel, until, cur };
  });
  await openDialog({
    title: `Projecten van ${user.name}`,
    wide: true,
    body: [
      h('p', {}, user.role === 'freelancer'
        ? 'Freelancers kunnen alleen verstuurde klantfeedback bekijken. Geef per project toegang, eventueel tot een einddatum.'
        : 'Kies per project een rol. Een einddatum is optioneel. Wijzigingen gelden direct, ook voor een sessie die al open staat.'),
      h('p', { class: 'small muted' }, `Einddatums in tijdzone ${timeZone()}.`),
      projects.length
        ? h('div', { class: 'access-list' }, rows.map(({ p, sel, until, cur }) => h('div', { class: 'access-row access-row-3' },
          h('span', { class: 'access-project' }, h('strong', { class: 'truncate' }, p.name), p.clientName ? h('span', { class: 'small muted truncate' }, p.clientName) : null,
            p.archivedAt ? h('span', { class: 'badge badge-neutral' }, 'Gearchiveerd') : null, cur?.expiresAt ? expiryLabel(cur.expiresAt) : null),
          sel, until)))
        : h('p', { class: 'muted' }, 'Er zijn nog geen projecten.'),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Opslaan'))],
    onSubmit: async () => {
      try {
        const list = rows.filter((r) => r.sel.value).map(({ p, sel, until, cur }) => {
          const iso = fromLocalInput(until.value);
          // Ongewijzigde (ook verlopen) einddatum blijft staan zoals hij was.
          const same = cur?.expiresAt && toLocalInput(cur.expiresAt) === until.value;
          return { projectId: p.id, role: sel.value, expiresAt: same ? cur.expiresAt : iso };
        });
        await api('PUT', `/api/users/${user.id}/projects`, { projects: list });
        toast(`Projecten van ${user.name} opgeslagen`, 'success');
        reload();
      } catch (err) { toast(err.message, 'error'); return false; }
    },
  });
}

/** Na de update: wiens rechten zijn omgezet naar de nieuwe rollen (nooit uitgebreid). */
function rolesNoticeBox(notice, reload) {
  const fromLabel = { view: 'Bekijken en reageren', publish: 'Publiceren en delen' };
  return h('section', { class: 'notice notice-info roles-notice', 'aria-label': 'Rechten omgezet naar rollen' }, icon('info'),
    h('div', {},
      h('strong', {}, 'Rechten zijn omgezet naar de nieuwe rollen. '),
      'Niemand heeft er rechten bij gekregen. Bij deze personen is een recht vervallen; geef de juiste rol bewust opnieuw als dat nodig is:',
      h('ul', { class: 'small' }, notice.changes.map((c) => h('li', {}, h('strong', {}, c.name), ` in ${c.project}: ${fromLabel[c.from] || c.from} → ${ROLE_LABEL[c.to === 'read' ? 'meekijker' : 'editor']}`))),
      button('Begrepen', { size: 'sm', onClick: async () => { await api('POST', '/api/system/roles-notice/dismiss'); reload(); } })));
}

export async function passwordDialog(user) {
  const pw = h('input', { type: 'password', minlength: '10', required: true, autocomplete: 'new-password', autofocus: true });
  await openDialog({
    title: `Wachtwoord voor ${user.name}`,
    body: [field('Nieuw wachtwoord', pw, 'Minimaal 10 tekens. Bestaande sessies van dit account worden beëindigd.')],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'), h('button', { class: 'btn btn-primary', value: 'ok' }, h('span', { class: 'btn-label' }, 'Opslaan'))],
    onSubmit: async () => {
      try { await api('POST', `/api/users/${user.id}/password`, { password: pw.value }); toast('Wachtwoord ingesteld', 'success'); } catch (err) { toast(err.message, 'error'); return false; }
    },
  });
}

export async function viewMyAccount(ctx) {
  document.title = 'Mijn account — Studio Review';
  const [me] = await api('GET', '/api/users');
  mount(ctx.pageEl, h('div', { class: 'page page-narrow' },
    ctx.pageHeader({ title: 'Mijn account', meta: me.email }),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Mijn projecten'),
      me.projects.length
        ? h('ul', { class: 'plain-list' }, me.projects.map((p) => h('li', {}, h('a', { href: `/projecten/${p.projectId}`, 'data-nav': true }, p.name), h('span', {}, p.expiresAt ? expiryLabel(p.expiresAt) : null, ' ', h('span', { class: 'badge badge-neutral' }, ROLE_LABEL[p.role] || p.level)))))
        : h('p', { class: 'muted' }, 'Je hebt nog geen toegang tot projecten. Vraag een beheerder om je toe te voegen.')),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Wachtwoord'),
      h('p', { class: 'small muted' }, 'Na het wijzigen log je opnieuw in.'),
      button('Wachtwoord wijzigen', { icon: 'lock', onClick: async () => { await passwordDialog(me); ctx.refresh(); } }))));
}

// ---------- Opslag en back-ups ----------

export async function viewStorage(ctx) {
  document.title = 'Opslag & back-ups — Studio Review';
  const [report, backups, system, activity] = await Promise.all([api('GET', '/api/storage'), api('GET', '/api/backups'), api('GET', '/api/system'), api('GET', '/api/settings/activity')]);
  const t = report.totals;
  const tile = (label, bytes, hint, cls = '') => h('div', { class: `stat-tile ${cls}` }, h('span', { class: 'stat-label' }, label), h('strong', {}, formatBytes(bytes)), hint ? h('span', { class: 'small muted' }, hint) : null);

  // Schijf: gebruikt, vrij, reserve.
  let diskEl;
  if (report.disk) {
    const used = report.disk.total - report.disk.free;
    const bar = h('div', { class: 'disk-bar', role: 'img', 'aria-label': `${formatBytes(report.disk.free)} vrij van ${formatBytes(report.disk.total)}` },
      h('span', { class: 'disk-used' }), h('span', { class: 'disk-reserve' }));
    bar.children[0].style.width = `${(used / report.disk.total) * 100}%`;
    bar.children[1].style.width = `${Math.min(100, (report.reserveBytes / report.disk.total) * 100)}%`;
    const low = report.disk.free < report.reserveBytes;
    diskEl = h('div', { class: 'disk' },
      h('div', { class: 'disk-head' }, h('strong', {}, `${formatBytes(report.disk.free)} vrij`), h('span', { class: 'muted' }, ` van ${formatBytes(report.disk.total)} op de schijf met video’s`)),
      bar,
      h('div', { class: 'small muted' }, `Vrije reserve: ${formatBytes(report.reserveBytes)}. Uploads die daaronder zouden komen, worden vooraf geweigerd. Instelbaar met MIN_FREE_GB.`),
      low ? h('div', { class: 'notice notice-error' }, icon('alert'), 'Er is minder ruimte vrij dan de reserve: nieuwe uploads worden geweigerd. Maak ruimte vrij via de prullenbak of kies een andere opslaglocatie.') : null);
  } else {
    diskEl = h('div', { class: 'notice notice-error', role: 'alert' }, icon('alert'), h('span', {}, h('strong', {}, 'Opslag niet bereikbaar. '), report.storage.reason));
  }

  const locRow = (label, p, extra) => h('div', { class: 'loc-row' }, h('span', { class: 'loc-label' }, label), h('code', { class: 'loc-path' }, p), extra || null);
  const sourceText = { vast: 'vaste gegevensmap', DATA_DIR: 'ingesteld met DATA_DIR', programmamap: 'in de programmamap', test: 'testmap' }[system.dataSource] || system.dataSource;

  const backupCard = backupsCard(ctx, backups);

  mount(ctx.pageEl, h('div', { class: 'page' },
    ctx.pageHeader({ title: 'Opslag & back-ups', meta: [`Studio Review ${system.label}`, h('span', { class: 'muted' }, `Node ${system.node}`)] }),
    system.dataSource === 'programmamap' ? h('div', { class: 'notice notice-warn' }, icon('alert'),
      h('div', {}, h('strong', {}, 'Je gegevens staan nog in de programmamap. '), 'Bij een update met een nieuwe ZIP blijven ze daar achter. Stop de app en verhuis ze eenmalig met ', h('code', {}, 'npm run verhuis'), ' (of kies "verhuizen" bij de startknop). De oude map blijft daarbij bewaard.')) : null,
    system.legacyDataDir && system.dataSource === 'vast' ? h('div', { class: 'notice notice-info' }, icon('info'), h('span', {}, `De oude gegevensmap ${system.legacyDataDir} wordt niet meer gebruikt. Controleer of alles klopt; daarna kun je hem verwijderen.`)) : null,
    h('div', { class: 'storage-grid' },
      h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Schijfruimte'), diskEl),
      h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Locaties'),
        locRow('Gegevens', system.dataDir, h('span', { class: 'small muted' }, sourceText)),
        locRow('Video’s', report.locations.media.path, report.storage.ok ? h('span', { class: 'small ok-text' }, icon('checkCircle'), 'bereikbaar') : h('span', { class: 'small warn-text' }, icon('alert'), 'niet bereikbaar')),
        locRow('Back-ups', report.locations.backups.path, report.locations.backups.problem ? h('span', { class: 'small warn-text' }, report.locations.backups.problem) : null),
        locRow('Programma', system.appDir),
        locRow('Instellingen', system.settingsFile),
        h('p', { class: 'small muted' }, 'Locaties wijzig je in het instellingenbestand (MEDIA_DIR, BACKUP_DIR, MIN_FREE_GB); dat blijft bewaard bij updates. Video’s naar een andere schijf verplaatsen: stop de app en gebruik ', h('code', {}, 'npm run verplaats-opslag -- "<nieuwe map>"'), '.'))),
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, 'Gebruik'),
      h('div', { class: 'stat-tiles' },
        tile('Actieve versies', t.active, 'nieuwste versie per video'),
        tile('Oudere versies', t.oldVersions, 'eerdere versies, nog beschikbaar'),
        tile('Gearchiveerd', t.archived, 'archiveren maakt geen ruimte vrij'),
        tile('Prullenbak', t.trash, 'vrij te maken door definitief te verwijderen', t.trash ? 'is-warn' : ''),
        tile('Bijlagen', t.attachments, 'briefing en referenties (PDF, afbeeldingen, video)'),
        t.brands ? tile('Merklogo’s', t.brands, 'logo’s voor de klantweergave') : null,
        tile('Tijdelijke uploads', t.tmp, `${plural(report.tmp.active, 'lopende upload', 'lopende uploads')}; afgebroken uploads worden na 24 uur opgeruimd`),
        tile('Totaal', t.all, 'alles hierboven samen', 'is-total')),
      report.missingFiles ? h('div', { class: 'notice notice-error' }, icon('alert'), `${plural(report.missingFiles, 'videobestand ontbreekt', 'videobestanden ontbreken')} in de opslag. Controleer de opslaglocatie of zet een back-up terug.`) : null,
      h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
        h('thead', {}, h('tr', {}, ['Project', 'Versies', 'Actief', 'Oudere versies', 'Bijlagen', 'Archief', 'Prullenbak', 'Totaal'].map((x, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, x)))),
        h('tbody', {}, report.projects.map((p) => h('tr', {},
          h('th', { scope: 'row' }, h('span', { class: 'truncate cell-name', title: p.name }, p.trashed ? p.name : h('a', { href: `/projecten/${p.id}`, 'data-nav': true }, p.name)),
            p.archived ? h('span', { class: 'badge badge-neutral' }, 'Archief') : null, p.trashed ? h('span', { class: 'badge badge-warn' }, 'Prullenbak') : null),
          h('td', { class: 'num' }, p.versions),
          ...[p.active, p.oldVersions, p.attachments, p.archivedBytes, p.trash, p.total].map((b, i) => h('td', { class: `num${i === 5 ? ' strong' : ''}` }, b ? formatBytes(b) : '–')))))))),
    backupCard,
    activityCard(activity)));
}

/** Bewaartermijn van passieve klantactiviteit (standaard 90 dagen). */
function activityCard(st) {
  const input = h('input', { type: 'number', min: String(st.range[0]), max: String(st.range[1]), step: '1', inputmode: 'numeric', value: String(st.retentionDays), class: 'input-narrow', 'aria-label': 'Bewaartermijn in dagen' });
  const save = button('Opslaan', { size: 'sm', onClick: async (e) => {
    const restore = busy(e.currentTarget);
    try {
      const r = await api('PUT', '/api/settings/activity', { retentionDays: Number(input.value) });
      toast(`Bewaartermijn: ${plural(r.retentionDays, 'dag', 'dagen')}.${r.removed ? ` ${r.removed} oudere gebeurtenis(sen) opgeruimd.` : ''}`, 'success');
    } catch (err) { toast(err.message, 'error'); input.focus(); }
    restore();
  } });
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Klantactiviteit bewaren'),
    h('p', { class: 'small muted' }, 'Passieve signalen (portaal of pagina geopend, afspelen gestart, download aangevraagd) worden na deze termijn automatisch verwijderd. Goedkeuringen, feedback, statusgeschiedenis en oplevergeschiedenis blijven altijd bewaard. Er worden geen IP-adressen of apparaatgegevens opgeslagen.'),
    h('div', { class: 'share-form share-form-row' }, h('label', { class: 'field-inline' }, input, h('span', {}, 'dagen')), save,
      h('span', { class: 'small muted' }, `Nu ${plural(st.total, 'gebeurtenis', 'gebeurtenissen')} bewaard · standaard ${st.defaultDays} dagen`)));
}

function backupsCard(ctx, data) {
  const lastComplete = data.backups.find((b) => b.status === 'volledig' && b.kind.startsWith('volledig'));
  const old = !lastComplete || Date.now() - Date.parse(lastComplete.createdAt) > 7 * 86400_000;
  const progress = h('div', { class: 'backup-progress', hidden: true });
  const startBtn = button('Nu back-up maken', { icon: 'download', variant: 'primary', onClick: start });

  async function start() {
    const restore = busy(startBtn);
    try {
      await api('POST', '/api/backups', {});
      poll();
    } catch (err) { toast(err.message, 'error'); restore(); }
  }
  async function poll() {
    progress.hidden = false;
    const r = await api('GET', '/api/backups').catch(() => null);
    const job = r?.job;
    if (!job) return;
    if (job.state === 'bezig') {
      const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
      mount(progress, h('div', { class: 'progress' }, (() => { const b = h('div', { class: 'progress-bar' }); b.style.width = `${pct}%`; return b; })()),
        h('div', { class: 'small muted' }, job.phase === 'database' ? 'Database kopiëren…' : `Bestanden kopiëren: ${job.done} van ${job.total} (${formatBytes(job.bytes)})`));
      setTimeout(poll, 700);
      return;
    }
    if (job.state === 'klaar') toast(job.complete ? 'Back-up gemaakt en gecontroleerd' : 'Back-up gemaakt, maar onvolledig: er ontbraken bestanden', job.complete ? 'success' : 'error');
    else toast(`Back-up mislukt: ${job.error}`, 'error');
    ctx.refresh();
  }
  if (data.job?.state === 'bezig') setTimeout(poll);

  const statusPill = (b) => h('span', { class: `pill pill-sm ${b.status === 'volledig' ? 'pill-approved' : b.status === 'onvolledig' ? 'pill-changes_requested' : 'pill-concept'}` },
    icon(b.status === 'volledig' ? 'checkCircle' : 'alert'), b.status === 'volledig' ? 'compleet en gecontroleerd' : b.status);

  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Back-ups'), startBtn),
    h('p', { class: 'small muted' }, 'Een back-up bevat de database (accounts, projecten, versies, reacties, links, rechten) én alle video’s en thumbnails, met controlesommen. Back-ups staan buiten de gegevensmap in ', h('code', {}, data.dir), '. Maken kan terwijl de app draait.'),
    data.problem ? h('div', { class: 'notice notice-error' }, icon('alert'), data.problem) : null,
    old ? h('div', { class: 'notice notice-warn' }, icon('clock'), lastComplete ? `De laatste volledige back-up is van ${formatDate(lastComplete.createdAt)}. Maak er een nieuwe.` : 'Er is nog geen volledige back-up. Maak er nu een.') : null,
    progress,
    data.backups.length
      ? h('ul', { class: 'backup-list' }, data.backups.map((b) => h('li', {},
        h('div', { class: 'backup-main' },
          h('div', { class: 'backup-title' }, h('strong', {}, b.createdAt ? formatDate(b.createdAt) : b.name), statusPill(b), h('span', { class: 'badge badge-neutral' }, b.kind || 'onbekend')),
          b.counts ? h('div', { class: 'small muted' }, `${plural(b.counts.users, 'account', 'accounts')} · ${plural(b.counts.projects, 'project', 'projecten')} · ${plural(b.counts.versions, 'versie', 'versies')} · ${plural(b.counts.comments, 'reactie', 'reacties')} · ${plural(b.counts.share_links, 'link', 'links')} · ${plural(b.fileCount || 0, 'bestand', 'bestanden')}`) : null,
          b.note ? h('div', { class: 'small warn-text' }, b.note) : null,
          h('code', { class: 'small loc-path' }, b.name)),
        h('span', { class: 'backup-size' }, b.totalBytes ? formatBytes(b.totalBytes) : '–'))))
      : emptyState({ icon: 'server', compact: true, title: 'Nog geen back-ups', text: 'Maak de eerste back-up met de knop hierboven.' }),
    h('details', { class: 'howto-restore' },
      h('summary', {}, 'Een back-up terugzetten'),
      h('ol', {},
        h('li', {}, 'Stop de app (Stop Studio Review.command of Ctrl+C in het startvenster).'),
        h('li', {}, 'Open Terminal in de programmamap en voer uit: ', h('code', {}, 'npm run herstel'), '. Kies de back-up uit de lijst.'),
        h('li', {}, 'Kies wat er met klantlinks gebeurt. ', h('strong', {}, 'Standaard (veilig): alle review-, akkoord-, project- en opleverlinks worden ongeldig'),
          ', omdat een back-up niet weet welke links je later hebt ingetrokken. Je maakt daarna nieuwe links aan en deelt die opnieuw. Alleen als je daar bewust voor kiest, gaan de links uit de back-up weer werken; dan kunnen eerder ingetrokken links ook weer toegang geven.'),
        h('li', {}, 'De back-up wordt eerst volledig gecontroleerd. Je huidige gegevens worden niet verwijderd maar bewaard als “…voor-herstel-<datum>”. Goedkeuringen, reacties, opleveringen en geschiedenis blijven altijd bewaard.'),
        h('li', {}, 'Start de app opnieuw. Bovenaan staat een melding over de klantlinks.')),
      h('p', { class: 'small muted' }, 'Een gewone update met een nieuwe ZIP raakt klantlinks niet; die blijven gewoon werken.')));
}

// ---------- Prullenbak ----------

const TYPE_LABEL = { project: 'Project', video: 'Video', version: 'Versie', briefing: 'Briefing' };
const TYPE_ICON = { project: 'folder', video: 'film', version: 'layers', briefing: 'clipboard' };

export async function viewTrash(ctx) {
  document.title = 'Prullenbak — Studio Review';
  const data = await api('GET', '/api/trash');
  const restore = async (item, btn) => {
    const done = busy(btn);
    try { await api('POST', '/api/trash/restore', { type: item.type, id: item.id }); toast(`${TYPE_LABEL[item.type]} “${item.title}” is teruggezet. Ingetrokken links blijven ingetrokken.`, 'success'); ctx.refresh(); } catch (err) { toast(err.message, 'error'); done(); }
  };
  mount(ctx.pageEl, h('div', { class: 'page page-narrow' },
    ctx.pageHeader({ title: 'Prullenbak', meta: data.items.length ? `${plural(data.items.length, 'item', 'items')} · ${formatBytes(data.totalBytes)} vrij te maken` : null }),
    h('div', { class: 'notice notice-info' }, icon('info'), h('span', {}, 'Items in de prullenbak zijn niet bereikbaar via klantlinks of directe links, maar de bestanden staan nog op schijf. Terugzetten brengt alles terug, behalve links die al waren ingetrokken. ', h('strong', {}, 'Automatisch definitief verwijderen staat uit'), '; dat doet alleen een beheerder, met een overzicht vooraf.')),
    data.items.length
      ? h('ul', { class: 'trash-list' }, data.items.map((item) => {
        const restoreBtn = button('Terugzetten', { icon: 'refresh', size: 'sm', onClick: (e) => restore(item, e.currentTarget) });
        return h('li', { class: 'trash-item' },
          h('span', { class: 'trash-icon' }, icon(TYPE_ICON[item.type])),
          h('div', { class: 'trash-main' },
            h('div', { class: 'trash-title' }, h('span', { class: 'badge badge-neutral' }, TYPE_LABEL[item.type]), h('strong', { class: 'truncate', title: item.title }, item.title)),
            h('div', { class: 'small muted' }, [item.context, item.detail, `${plural(item.fileCount, 'bestand', 'bestanden')}, ${formatBytes(item.bytes)}`].filter(Boolean).join(' · ')),
            h('div', { class: 'small muted' }, `In prullenbak sinds ${formatDate(item.trashedAt)} door ${item.trashedBy}`)),
          h('div', { class: 'trash-actions' }, restoreBtn,
            data.canPurge ? button('Definitief verwijderen…', { icon: 'trash', size: 'sm', variant: 'danger', onClick: () => purgeDialog(ctx, item) }) : null));
      }))
      : h('div', { class: 'card' }, emptyState({ icon: 'trash', compact: true, title: 'De prullenbak is leeg', text: 'Projecten, video’s, versies en briefingonderdelen die je naar de prullenbak verplaatst, verschijnen hier.' }))));
}

async function purgeDialog(ctx, item) {
  const preview = await api('GET', `/api/trash/${item.type}/${item.id}/purge-preview`).catch((err) => { toast(err.message, 'error'); return null; });
  if (!preview) return;
  const ack = h('input', { type: 'checkbox', required: true });
  await openDialog({
    title: `${TYPE_LABEL[item.type]} definitief verwijderen?`,
    wide: true,
    body: [
      h('div', { class: 'notice notice-error' }, icon('alert'), h('span', {}, h('strong', {}, `“${item.title}”`), ' en alles hieronder wordt definitief verwijderd. Dit kan niet ongedaan worden gemaakt, behalve met een eerder gemaakte back-up.')),
      h('div', { class: 'purge-summary' },
        h('div', {}, h('strong', {}, formatBytes(preview.totalBytes)), h('span', { class: 'small muted' }, 'komt vrij')),
        h('div', {}, h('strong', {}, preview.fileCount), h('span', { class: 'small muted' }, 'bestanden')),
        h('div', {}, h('strong', {}, preview.versions), h('span', { class: 'small muted' }, 'versies')),
        h('div', {}, h('strong', {}, preview.comments), h('span', { class: 'small muted' }, 'reacties')),
        h('div', {}, h('strong', {}, preview.links), h('span', { class: 'small muted' }, 'links')),
        preview.briefing ? h('div', {}, h('strong', {}, preview.briefing), h('span', { class: 'small muted' }, 'briefingonderdelen')) : null),
      preview.deliveries?.some((d) => d.active) ? h('div', { class: 'notice notice-warn' }, icon('package'),
        h('div', {}, h('strong', {}, 'Let op: dit is (deels) een definitieve oplevering. '),
          'Na verwijderen kan de klant deze bestanden niet meer downloaden via de opleverpagina, en verdwijnt de oplevergeschiedenis ervan.',
          h('ul', { class: 'small' }, preview.deliveries.filter((d) => d.active).map((d) => h('li', {}, `${d.title} · versie ${d.versionNumber} (vrijgegeven ${formatDate(d.releasedAt)})`))))) : null,
      preview.deliveries?.length && !preview.deliveries.some((d) => d.active) ? h('p', { class: 'small muted' }, icon('package'), ` ${preview.deliveries.length} eerdere (teruggenomen) oplevering(en) verdwijnen uit de oplevergeschiedenis.`) : null,
      h('h3', { class: 'purge-files-title' }, 'Bestanden die verdwijnen'),
      h('ul', { class: 'purge-files' }, preview.files.map((f) => h('li', {},
        icon(f.kind === 'video' ? 'film' : f.kind === 'bijlage' ? 'doc' : 'grid'),
        h('span', { class: 'truncate' }, f.label, f.originalFilename ? h('span', { class: 'muted' }, ` · ${f.originalFilename}`) : h('span', { class: 'muted' }, ' · thumbnail'),
          f.inDelivery ? h('span', { class: 'badge badge-warn' }, icon('package'), 'opgeleverd') : null),
        h('span', { class: 'mono small' }, f.bytes === null ? 'ontbreekt' : formatBytes(f.bytes))))),
      h('label', { class: 'check purge-ack' }, ack, 'Ik begrijp dat dit definitief is'),
    ],
    actions: [h('button', { class: 'btn btn-ghost', value: 'cancel', formnovalidate: true }, 'Annuleren'),
      h('button', { class: 'btn btn-danger', value: 'ok' }, icon('trash'), h('span', { class: 'btn-label' }, `Definitief verwijderen (${formatBytes(preview.totalBytes)})`))],
    onSubmit: async () => {
      if (!ack.checked) { toast('Vink eerst aan dat je begrijpt dat dit definitief is.', 'error'); return false; }
      try {
        const r = await api('POST', `/api/trash/${item.type}/${item.id}/purge`, { confirm: true, expectedFiles: preview.fileCount });
        toast(`Definitief verwijderd. ${formatBytes(r.freedBytes)} vrijgemaakt.${r.failedFiles.length ? ` ${r.failedFiles.length} bestand(en) konden niet worden verwijderd.` : ''}`, r.failedFiles.length ? 'error' : 'success');
        ctx.refresh();
      } catch (err) { toast(err.message, 'error'); return false; }
    },
  });
}

// ---------- Merken ----------

export async function viewBrands(ctx) {
  document.title = 'Merken — Studio Review';
  const [brands, studio] = await Promise.all([api('GET', '/api/brands'), api('GET', '/api/settings/studio-name')]);
  const studioInput = h('input', { type: 'text', maxlength: '80', value: studio.name, 'aria-label': 'Naam van de studio voor klanten' });
  const studioSave = button('Opslaan', { size: 'sm', onClick: async (e) => {
    const restore = busy(e.currentTarget);
    try { await api('PUT', '/api/settings/studio-name', { name: studioInput.value }); toast('Naam opgeslagen', 'success'); } catch (err) { toast(err.message, 'error'); }
    restore();
  } });
  mount(ctx.pageEl, h('div', { class: 'page page-narrow' },
    ctx.pageHeader({ title: 'Merken', meta: 'Logo, naam en accentkleur van de klantweergave' }),
    ctx.session.user.isAdmin ? h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Naam van de studio'),
      h('p', { class: 'small muted' }, 'Zo staat de studio bij de klant, bijvoorbeeld in “Bij Studio Brutaal” op de startpagina.'),
      h('div', { class: 'inline-form' }, studioInput, studioSave)) : null,
    h('div', { class: 'notice notice-info' }, icon('info'), h('span', {}, 'Kies per project een merk via ', h('strong', {}, 'Project bewerken'), '. De klant ziet het in het klantportaal en op de reviewpagina’s. De opbouw van de pagina is voor elk merk gelijk; zonder merk ziet de klant de standaard Studio Review-weergave.')),
    brands.map((b) => brandCard(ctx, b))));
}

function brandCard(ctx, brand) {
  const name = h('input', { type: 'text', maxlength: '80', value: brand.name, 'aria-label': `Naam van ${brand.name}` });
  const color = h('input', { type: 'color', value: brand.accentColor, 'aria-label': 'Accentkleur kiezen', class: 'color-input' });
  const hex = h('input', { type: 'text', maxlength: '7', value: brand.accentColor, 'aria-label': 'Accentkleur als hexcode', class: 'hex-input mono' });
  const contrastNote = h('p', { class: 'small muted' });
  const preview = h('div', { class: 'brand-preview', 'aria-label': `Voorbeeld van de klantweergave van ${brand.name}` });
  let current = { ...brand };

  const drawPreview = () => {
    applyBrand({ ...current, accent: hex.value }, preview);
    const pal = palette(hex.value);
    contrastNote.textContent = !pal ? 'Vul een geldige kleur in, bijvoorbeeld #38c6b8.'
      : pal['--accent'].toLowerCase() !== hex.value.toLowerCase() ? 'Op de donkere achtergrond wordt deze kleur iets lichter getoond, zodat knoppen en tekst goed leesbaar blijven.' : 'Goed leesbaar op de donkere achtergrond.';
    mount(preview,
      h('div', { class: 'bp-header' }, brandMark({ ...current, name: name.value || brand.name })),
      h('div', { class: 'bp-body' },
        h('div', { class: 'bp-title' }, 'Voorjaarscampagne 2026'),
        h('div', { class: 'bp-card' },
          h('div', { class: 'bp-thumb' }, icon('film')),
          h('div', { class: 'bp-card-body' }, h('strong', {}, 'Hoofdvideo'), clientPill('in_review', { small: true }),
            h('span', { class: 'btn btn-sm btn-primary' }, icon('chat'), h('span', { class: 'btn-label' }, 'Bekijken en reageren')))),
        h('a', { class: 'bp-link small', href: '#', onClick: (e) => e.preventDefault() }, 'Voorbeeldlink in accentkleur')));
  };
  color.addEventListener('input', () => { hex.value = color.value; drawPreview(); });
  hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) color.value = hex.value; drawPreview(); });
  name.addEventListener('input', drawPreview);

  const save = button('Opslaan', { variant: 'primary', size: 'sm', onClick: async (e) => {
    const restore = busy(e.currentTarget);
    try { current = await api('PATCH', `/api/brands/${brand.id}`, { name: name.value, accentColor: hex.value }); toast(`${current.name} opgeslagen`, 'success'); drawPreview(); } catch (err) { toast(err.message, 'error'); }
    restore();
  } });

  const logoInfo = h('div', { class: 'logo-row' });
  const drawLogo = () => mount(logoInfo,
    current.logoUrl ? h('img', { src: current.logoUrl, alt: `Logo ${current.name}`, class: 'logo-thumb' }) : h('span', { class: 'small muted' }, 'Nog geen logo: de klant ziet dan de naam met initialen.'),
    button(current.logoUrl ? 'Ander logo…' : 'Logo uploaden…', { icon: 'upload', size: 'sm', onClick: pickLogo }),
    current.logoUrl ? button('Verwijderen', { icon: 'trash', size: 'sm', variant: 'ghost', onClick: async (e) => {
      const restore = busy(e.currentTarget);
      try { current = await api('DELETE', `/api/brands/${brand.id}/logo`); toast('Logo verwijderd', 'success'); drawLogo(); drawPreview(); } catch (err) { toast(err.message, 'error'); restore(); }
    } }) : null);
  function pickLogo() {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'visually-hidden' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { toast('Het logo is te groot (maximaal 2 MB).', 'error'); return; }
      try {
        const res = await fetch(`/api/brands/${brand.id}/logo`, { method: 'PUT', headers: { 'x-requested-with': 'review-tool', 'content-type': file.type || 'application/octet-stream' }, body: file, credentials: 'same-origin' });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `Uploaden mislukt (${res.status})`);
        current = data;
        toast('Logo opgeslagen', 'success');
        drawLogo();
        drawPreview();
      } catch (err) { toast(err.message, 'error'); }
    });
    document.body.append(input);
    input.click();
  }
  drawLogo();
  drawPreview();

  return h('section', { class: 'card brand-card' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, brand.name), h('span', { class: 'small muted' }, plural(brand.projectCount, 'project', 'projecten'))),
    h('div', { class: 'brand-grid' },
      h('div', { class: 'brand-form' },
        field('Merknaam', name),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Accentkleur'), h('div', { class: 'color-row' }, color, hex), contrastNote),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Logo'), logoInfo, h('span', { class: 'field-hint' }, 'PNG, JPG of WebP tot 2 MB, liefst met transparante achtergrond en lichte kleuren (de klantweergave is donker). SVG is niet toegestaan.')),
        h('div', {}, save)),
      preview));
}

// ---------- Archief ----------

export async function viewArchive(ctx) {
  document.title = 'Archief — Studio Review';
  const projects = (await api('GET', '/api/projects?archived=1')).filter((p) => p.archivedAt);
  mount(ctx.pageEl, h('div', { class: 'page page-narrow' },
    ctx.pageHeader({ title: 'Archief', meta: projects.length ? plural(projects.length, 'gearchiveerd project', 'gearchiveerde projecten') : null }),
    h('div', { class: 'notice notice-info' }, icon('info'), h('span', {}, 'Gearchiveerde projecten blijven volledig bewaard, inclusief bestanden (dit maakt geen ruimte vrij). Ze zijn alleen te bekijken: klanten kunnen hun links nog openen, maar niet meer reageren of goedkeuren. Gearchiveerde video’s binnen een actief project vind je in dat project.')),
    projects.length
      ? h('ul', { class: 'trash-list' }, projects.map((p) => h('li', { class: 'trash-item' },
        h('span', { class: 'trash-icon' }, icon('folder')),
        h('div', { class: 'trash-main' },
          h('a', { href: `/projecten/${p.id}`, 'data-nav': true, class: 'trash-title' }, h('strong', { class: 'truncate' }, p.name)),
          h('div', { class: 'small muted' }, [p.clientName, plural(p.videoCount, 'video', 'video’s'), `gearchiveerd ${relativeDate(p.archivedAt)}`].filter(Boolean).join(' · '))),
        h('div', { class: 'trash-actions' }, can(p.myLevel, 'manage') ? button('Uit archief halen', { icon: 'refresh', size: 'sm', onClick: async (e) => {
          const done = busy(e.currentTarget);
          try { await api('POST', `/api/projects/${p.id}/archive`, { archived: false }); toast(`“${p.name}” is weer actief`, 'success'); ctx.refresh(); } catch (err) { toast(err.message, 'error'); done(); }
        } }) : null))))
      : h('div', { class: 'card' }, emptyState({ icon: 'folder', compact: true, title: 'Geen gearchiveerde projecten', text: 'Archiveer een afgerond project via “Bewerken” op de projectpagina.' }))));
}
