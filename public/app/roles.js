// Rollen en rechten (bouwronde 6): één plek voor namen, uitleg en de rechtenmatrix.
import { h, icon, formatDateZone } from '/shared/util.js';

/** Projectrollen met het niveau dat de server ervoor gebruikt. */
export const PROJECT_ROLES = [
  { key: 'producer', level: 'manage', label: 'Projectleider', short: 'Project beheren, personen koppelen, publiceren, delen en opleveren' },
  { key: 'editor', level: 'upload', label: 'Editor', short: 'Uploaden, versies, reageren en feedbacktaken' },
  { key: 'meekijker', level: 'read', label: 'Meekijker', short: 'Projectinformatie bekijken, niets wijzigen' },
  { key: 'freelancer', level: 'feedback', label: 'Freelancer', short: 'Alleen verstuurde klantfeedback bekijken (alleen voor freelanceraccounts)' },
];
export const ROLE_LABEL = Object.fromEntries(PROJECT_ROLES.map((r) => [r.key, r.label]));
const LEVEL_ROLE = { manage: 'producer', publish: 'editor', upload: 'editor', view: 'meekijker', read: 'meekijker', feedback: 'freelancer' };
export const roleOfLevel = (level) => LEVEL_ROLE[level] || null;
export const ACCOUNT_LABEL = { admin: 'Beheerder', member: 'Teamlid', freelancer: 'Freelancer' };

/** Rollen die bij een account passen: freelancers alleen Freelancer, teamleden de rest. */
export const rolesFor = (accountRole) => PROJECT_ROLES.filter((r) => (accountRole === 'freelancer' ? r.key === 'freelancer' : r.key !== 'freelancer'));

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "Toegang tot …" of "Verlopen op …", altijd met tijdzone. */
export function expiryLabel(iso) {
  if (!iso) return null;
  const past = Date.parse(iso) <= Date.now();
  return h('span', { class: `expiry${past ? ' is-expired' : ''}`, title: `Tijdzone: ${timeZone()}` }, icon(past ? 'lock' : 'clock'),
    past ? `Verlopen op ${formatDateZone(iso)}` : `Toegang tot ${formatDateZone(iso)}`);
}

/** <input type="datetime-local"> ↔ ISO. */
export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

/** Rechtenmatrix zoals in de documentatie (docs/ROLLEN.md). */
const MATRIX = [
  ['Projecten en video’s bekijken', 'alle', 'toegewezen', 'toegewezen', 'toegewezen', 'alleen gepubliceerd'],
  ['Interne notities en taken zien', '✓', '✓', '✓', '✓', '—'],
  ['Klantfeedback met tijdcodes en tekeningen', '✓', '✓', '✓', '✓', '✓ (alleen lezen)'],
  ['Reageren, feedback afhandelen, taken', '✓', '✓', '✓', '—', '—'],
  ['Uploaden en nieuwe versies', '✓', '✓', '✓', '—', '—'],
  ['Originelen en exports downloaden', '✓', '✓', '✓', '✓', '—'],
  ['Publiceren, klantlinks, vragen aan klant', '✓', '✓', '—', '—', '—'],
  ['Opleveren en status corrigeren', '✓', '✓', '—', '—', '—'],
  ['Personen aan het project koppelen', '✓', '✓ (bestaande accounts)', '—', '—', '—'],
  ['Accounts, merken, opslag, back-ups', '✓', '—', '—', '—', '—'],
  ['Andere projecten', 'alle', '—', '—', '—', '—'],
];
export function rightsMatrix() {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data-table rights-table' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Mag'), ['Beheerder', 'Projectleider', 'Editor', 'Meekijker', 'Freelancer'].map((r) => h('th', { scope: 'col' }, r)))),
    h('tbody', {}, MATRIX.map(([what, ...cells]) => h('tr', {}, h('th', { scope: 'row' }, what), cells.map((c) => h('td', { class: c === '—' ? 'muted' : '' }, c)))))));
}
