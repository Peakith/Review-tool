// Merk op de klantpagina's: accentkleur (met voldoende contrast op de donkere basis) en
// logo of, zonder logo, een nette naammarkering. De basisinterface is voor elk merk gelijk.
import { h, icon } from './util.js';

const BG_DARK = [15, 16, 18]; // --bg (donker)
const BG_LIGHT = [245, 245, 243]; // --bg (licht)
const currentMode = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

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

/** Lichter (donker thema) of donkerder (licht thema) maken tot het contrast minstens `min` is. */
function liftTo(rgb, min, mode) {
  const bg = mode === 'light' ? BG_LIGHT : BG_DARK;
  const to = mode === 'light' ? [0, 0, 0] : [255, 255, 255];
  let out = rgb;
  for (let t = 0; t <= 1 && contrast(out, bg) < min; t += 0.05) out = mix(rgb, to, t);
  return out;
}

/** CSS-variabelen voor een accentkleur, leesbaar in het huidige thema. */
export function palette(hex, mode = currentMode()) {
  const base = hexToRgb(hex);
  if (!base) return null;
  const accent = liftTo(base, 3, mode); // knoppen en focusrand: minstens 3:1 op de achtergrond
  const strong = liftTo(base, 4.5, mode); // tekst en links: minstens 4,5:1
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
let lastBrand;
window.addEventListener('themechange', () => { if (lastBrand !== undefined) applyBrand(lastBrand); });

export function applyBrand(brand, target = document.documentElement) {
  if (target === document.documentElement) lastBrand = brand;
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
