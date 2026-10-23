// Merk op de klantpagina's: accentkleur (met voldoende contrast op de donkere basis) en
// logo of, zonder logo, een nette naammarkering. De basisinterface is voor elk merk gelijk.
import { h, icon } from './util.js';

const BG = [15, 16, 18]; // --bg

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (rgb, to, t) => rgb.map((v, i) => v + (to[i] - v) * t);

/** Lichter maken tot het contrast met de achtergrond minstens `min` is. */
function liftTo(rgb, min) {
  let out = rgb;
  for (let t = 0; t <= 1 && contrast(out, BG) < min; t += 0.05) out = mix(rgb, [255, 255, 255], t);
  return out;
}

/** CSS-variabelen voor een accentkleur. */
export function palette(hex) {
  const base = hexToRgb(hex);
  if (!base) return null;
  const accent = liftTo(base, 3); // knoppen en focusrand: minstens 3:1 op de achtergrond
  const strong = liftTo(base, 4.5); // tekst en links: minstens 4,5:1
  const ink = contrast(accent, [255, 255, 255]) >= contrast(accent, [17, 17, 17]) ? '#ffffff' : '#111111';
  const [r, g, b] = accent.map(Math.round);
  return {
    '--accent': toHex(accent),
    '--accent-strong': toHex(strong),
    '--accent-ink': ink,
    '--accent-soft': `rgba(${r}, ${g}, ${b}, 0.14)`,
    '--accent-line': `rgba(${r}, ${g}, ${b}, 0.45)`,
  };
}

/** Past het merk toe op de hele pagina (of herstelt de standaard bij brand = null). */
export function applyBrand(brand, target = document.documentElement) {
  const vars = palette(brand?.accent);
  for (const k of ['--accent', '--accent-strong', '--accent-ink', '--accent-soft', '--accent-line']) {
    if (vars) target.style.setProperty(k, vars[k]); else target.style.removeProperty(k);
  }
  target.dataset.brand = brand?.slug || '';
}

/** Logo of naammarkering in de kop. Zonder merk: het neutrale Studio Review-merkteken. */
export function brandMark(brand, { size = 'md' } = {}) {
  if (!brand) {
    return h('span', { class: `brand-lockup brand-${size}` }, h('span', { class: 'brand-mark' }, icon('play')), h('span', { class: 'brand-name' }, 'Studio Review'));
  }
  if (brand.logoUrl) {
    const img = h('img', { class: 'brand-logo', src: brand.logoUrl, alt: brand.name });
    // Laadt het logo niet, dan alsnog de naam tonen.
    img.addEventListener('error', () => img.replaceWith(nameMark(brand)));
    return h('span', { class: `brand-lockup brand-${size}` }, img);
  }
  return h('span', { class: `brand-lockup brand-${size}` }, nameMark(brand));
}

function nameMark(brand) {
  const initials = brand.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return h('span', { class: 'brand-namemark' }, h('span', { class: 'brand-initials', 'aria-hidden': 'true' }, initials), h('span', { class: 'brand-name' }, brand.name));
}
