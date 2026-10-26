// Instellingen: alle beheer- en persoonlijke instellingen op één plek, met een eigen subnavigatie.
// De bestaande schermen (team, merken, opslag, prullenbak, archief) worden hier ongewijzigd getoond.
import { h, mount, icon, api, toast } from '/shared/util.js';
import { viewTeam, viewStorage, viewTrash, viewArchive, viewBrands, viewMyAccount, passwordDialog } from './admin.js';

const SECTIONS = [
  { key: 'account', label: 'Mijn account', icon: 'users', view: viewAccount },
  { key: 'team', label: 'Team & rechten', icon: 'shield', admin: true, view: (c) => viewTeam(c) },
  { key: 'merken', label: 'Merken', icon: 'palette', admin: true, view: (c) => viewBrands(c) },
  { key: 'opslag', label: 'Opslag & back-ups', icon: 'server', admin: true, view: (c) => viewStorage(c) },
  { key: 'archief', label: 'Archief', icon: 'history', view: (c) => viewArchive(c) },
  { key: 'prullenbak', label: 'Prullenbak', icon: 'trash', view: (c) => viewTrash(c) },
];

/** Welke sectie hoort bij een (oud) adres. */
export function settingsSection(path, session) {
  const legacy = { '/team': session.user.isAdmin ? 'team' : 'account', '/merken': 'merken', '/opslag': 'opslag', '/prullenbak': 'prullenbak', '/archief': 'archief' };
  if (legacy[path]) return legacy[path];
  const m = path.match(/^\/instellingen\/([a-z]+)$/);
  return m ? m[1] : 'account';
}

export async function viewSettings(ctx, section) {
  const { session } = ctx;
  const available = SECTIONS.filter((s) => !s.admin || session.user.isAdmin);
  const current = available.find((s) => s.key === section);
  if (!current) {
    mount(ctx.pageEl, h('div', { class: 'page' }, ctx.pageHeader({ title: 'Niet beschikbaar' }), h('p', { class: 'muted' }, 'Dit onderdeel is alleen voor beheerders.')));
    return;
  }
  const host = h('div', { class: 'settings-content' });
  mount(ctx.pageEl, h('div', { class: 'page settings-page' },
    h('nav', { class: 'settings-nav', 'aria-label': 'Instellingen' },
      h('h1', { class: 'settings-title' }, 'Instellingen'),
      available.map((s) => h('a', {
        href: `/instellingen/${s.key}`, 'data-nav': true, class: s.key === current.key ? 'is-active' : '', 'aria-current': s.key === current.key ? 'page' : null,
      }, icon(s.icon), s.label))),
    host));
  await current.view({ ...ctx, pageEl: host });
}

async function viewAccount(ctx) {
  document.title = 'Mijn account — Studio Review';
  const { session } = ctx;
  const sub = h('div', {});
  mount(ctx.pageEl, h('div', { class: 'page page-narrow' }, ctx.pageHeader({ title: 'Mijn account', meta: `${session.user.name} · ${session.user.email}` }), sub));
  if (session.user.isAdmin) {
    mount(sub, h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Wachtwoord'),
      h('p', { class: 'small muted' }, 'Na het wijzigen log je opnieuw in.'),
      h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => passwordDialog(session.user).then(() => ctx.refresh()) }, icon('lock'), h('span', { class: 'btn-label' }, 'Wachtwoord wijzigen'))));
  } else {
    await viewMyAccount({ ...ctx, pageEl: sub, pageHeader: () => null });
  }
}

