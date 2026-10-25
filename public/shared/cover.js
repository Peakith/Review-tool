// Projectcovers en staande video's: het beeld blijft altijd volledig zichtbaar (nooit bijsnijden),
// met een vage achtergrond bij afwijkende verhoudingen. Achtergrond via CSSOM i.v.m. de CSP.
import { h, icon } from '/shared/util.js';

export function blurBackdrop(url) {
  const el = h('span', { class: 'thumb-blur', 'aria-hidden': 'true' });
  el.style.backgroundImage = `url("${url}")`;
  return el;
}

/** Cover van een project (`p.cover` uit de API), of een rustige lege plek als er (nog) geen is. */
export function projectCoverImg(p, emptyIcon = 'folder') {
  if (!p.cover) return h('div', { class: 'poster-empty' }, icon(emptyIcon));
  const img = h('img', { src: p.cover.url, alt: '', loading: 'lazy', decoding: 'async' });
  const wrap = h('span', { class: 'cover-fit' }, blurBackdrop(p.cover.url), img);
  img.addEventListener('error', () => wrap.replaceWith(h('div', { class: 'poster-empty' }, icon(emptyIcon))));
  return wrap;
}
