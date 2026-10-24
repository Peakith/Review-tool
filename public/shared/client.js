// Statussen en opleveringsgegevens in de taal van de klant (portaal en reviewpagina).
import { h, icon, formatBytes } from './util.js';
import { tr } from './i18n.js';

export const CLIENT_STATUS = {
  in_review: { label: 'Klaar voor jouw review', short: 'Wacht op jou', icon: 'eye', cls: 'in_review' },
  changes_requested: { label: 'Feedback verstuurd', short: 'Team past aan', icon: 'send', cls: 'changes_requested' },
  approved: { label: 'Goedgekeurd', short: 'Goedgekeurd', icon: 'checkCircle', cls: 'approved' },
  closed: { label: 'Tijdelijk gesloten', short: 'Gesloten', icon: 'lock', cls: 'concept' },
};
export const clientStatusOf = (status) => {
  const s = CLIENT_STATUS[status] || CLIENT_STATUS.closed;
  return { ...s, label: tr(s.label), short: tr(s.short) };
};

export function clientPill(status, { small = false, short = false } = {}) {
  const s = clientStatusOf(status);
  return h('span', { class: `pill pill-${s.cls}${small ? ' pill-sm' : ''}` }, icon(s.icon), h('span', {}, short ? s.short : s.label));
}

/** "Teaser · 9:16 · Instagram Reels" (alleen wat bekend is). */
export function metaLine(meta) {
  if (!meta) return '';
  return [meta.kindLabel ? tr(meta.kindLabel) : null, meta.aspect, meta.channel].filter(Boolean).join(' · ');
}

export function fileLabel(file) {
  const type = file.mime === 'application/pdf' ? 'PDF' : file.mime.startsWith('image/') ? tr('Afbeelding') : file.mime.startsWith('video/') ? 'Video' : tr('Bestand');
  return `${type} · ${formatBytes(file.size)}`;
}

export const fileIcon = (file) => (file.mime.startsWith('video/') ? 'film' : file.mime.startsWith('image/') ? 'image' : 'doc');
