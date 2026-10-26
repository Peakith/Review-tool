import { h } from '/shared/util.js';

/** Klein label met de merkkleur van de klantweergave. */
export function brandChip(brand) {
  if (!brand) return null;
  const dot = h('span', { class: 'brand-dot', 'aria-hidden': 'true' });
  if (brand.accent) dot.style.setProperty('background', brand.accent);
  return h('span', { class: 'brand-chip', title: 'Merk van de klantweergave' }, dot, brand.name);
}
