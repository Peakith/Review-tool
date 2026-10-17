import { h, icon, timecode, busy, draftStore } from './util.js';

/**
 * Invoerveld voor een nieuwe reactie. Het tijdstip volgt de afspeelpositie; zodra je
 * gaat typen pauzeert de video en staat het tijdstip vast. Klik op het tijdstip om er
 * een algemene reactie (zonder tijdstip) van te maken. Concepttekst blijft bewaard
 * (draftKey) en wordt alleen gewist na een geslaagde verzending.
 */
export function createComposer({ player, onSubmit, placeholder = 'Schrijf een reactie bij dit moment…', submitLabel = 'Plaatsen', draftKey, before = null }) {
  let pinned = false;
  let time = 0;
  let withTime = true;
  const ta = h('textarea', { rows: '3', placeholder, 'aria-label': 'Nieuwe reactie', maxlength: '5000' });
  ta.value = draftKey ? draftStore.get(draftKey) : '';
  const atValue = h('strong', {}, timecode(0));
  const atLabel = h('span', {}, 'Bij ');
  const at = h('button', {
    type: 'button', class: 'composer-at', 'aria-pressed': 'true',
    title: 'Klik om te wisselen tussen een reactie op dit tijdstip en een algemene reactie',
  }, icon('clock'), atLabel, atValue);
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, icon('send'), h('span', { class: 'btn-label' }, submitLabel));

  const show = () => {
    at.setAttribute('aria-pressed', String(withTime));
    atLabel.textContent = withTime ? 'Bij ' : 'Algemene reactie';
    atValue.textContent = withTime ? timecode(time) : '';
    at.setAttribute('aria-label', withTime ? `Reactie bij ${timecode(time)}. Klik voor een algemene reactie.` : 'Algemene reactie zonder tijdstip. Klik om aan het tijdstip te koppelen.');
  };
  const follow = (t) => { if (!pinned) { time = t; show(); } };
  const unsubscribe = player.onTime(follow);
  const pin = () => { time = player.currentTime(); pinned = true; show(); };

  at.addEventListener('click', () => { withTime = !withTime; show(); });
  ta.addEventListener('focus', () => { if (!ta.value.trim()) { player.pause(); pin(); } });
  ta.addEventListener('input', () => {
    if (!pinned) { player.pause(); pin(); }
    if (draftKey) draftStore.set(draftKey, ta.value);
  });
  player.video.addEventListener('seeked', () => { if (!ta.value.trim()) { pinned = false; follow(player.currentTime()); } });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
  });

  const form = h('form', { class: 'composer', onSubmit: async (e) => {
    e.preventDefault();
    const body = ta.value.trim();
    if (!body) { ta.focus(); return; }
    const restore = busy(submit);
    let ok = false;
    try {
      ok = (await onSubmit(body, withTime ? time : null)) !== false;
    } finally {
      restore();
    }
    if (ok) {
      ta.value = '';
      if (draftKey) draftStore.set(draftKey, '');
      pinned = false;
      follow(player.currentTime());
    }
  } },
  before,
  ta,
  h('div', { class: 'composer-bar' },
    at,
    h('span', { class: 'composer-hint' }, '⌘/Ctrl + Enter'),
    submit));

  show();
  return {
    el: form,
    focus: () => ta.focus(),
    destroy: unsubscribe,
    setDisabled(disabled, reason) {
      ta.disabled = disabled; submit.disabled = disabled; at.disabled = disabled;
      ta.placeholder = disabled ? reason : placeholder;
    },
  };
}
