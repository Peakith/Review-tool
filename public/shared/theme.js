// Thema: Licht, Donker of Systeem (volgt de instelling van de computer, ook als die verandert).
const KEY = 'rt-theme';
const root = document.documentElement;
const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

export const THEMES = [['light', 'Licht'], ['dark', 'Donker'], ['system', 'Systeem']];

export function themePref() {
  const p = root.getAttribute('data-theme-pref') || (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  return ['light', 'dark', 'system'].includes(p) ? p : 'dark';
}

const resolve = (pref) => (pref === 'system' ? (media?.matches ? 'light' : 'dark') : pref);

/** Thema toepassen (en in deze browser onthouden). Stuurt een 'themechange'-gebeurtenis. */
export function applyTheme(pref) {
  root.setAttribute('data-theme-pref', pref);
  try { localStorage.setItem(KEY, pref); } catch { /* privémodus */ }
  const next = resolve(pref);
  if (root.getAttribute('data-theme') !== next) {
    root.setAttribute('data-theme', next);
  }
  window.dispatchEvent(new CustomEvent('themechange', { detail: { pref, theme: next } }));
}

export const currentTheme = () => root.getAttribute('data-theme') || 'dark';

media?.addEventListener?.('change', () => { if (themePref() === 'system') applyTheme('system'); });
