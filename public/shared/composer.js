import { h, icon, timecode, busy, draftStore } from './util.js';
import { createAnnotator } from './annotate.js';

/**
 * Invoerveld voor een nieuwe reactie. Het tijdstip volgt de afspeelpositie; zodra je gaat typen
 * pauzeert de video en staat het tijdstip vast. Klik op het tijdstip om er een algemene reactie
 * (zonder tijdstip) van te maken. Concepttekst blijft bewaard (draftKey) en wordt alleen gewist
 * na een geslaagde verzending.
 *
 * Extra (tools: true):
 *  - Bereik: "van 0:12 tot 0:18" — eind instellen door verder te spelen en op "Eind hier" te klikken;
 *  - Tekenen: pen, pijl en rechthoek op het stilstaande beeld. Tekst blijft altijd mogelijk.
 * onSubmit(body, timecode, { timecodeEnd, annotation }) → true bij succes.
 */
export function createComposer({ player, onSubmit, placeholder = 'Schrijf een reactie bij dit moment…', submitLabel = 'Plaatsen', draftKey, before = null, tools = true }) {
  let pinned = false;
  let time = 0;
  let withTime = true;
  let rangeEnd = null;
  let rangeMode = false;
  let annotation = null;
  const ta = h('textarea', { rows: '3', placeholder, 'aria-label': 'Nieuwe reactie', maxlength: '5000' });
  ta.value = draftKey ? draftStore.get(draftKey) : '';
  const atValue = h('strong', {}, timecode(0));
  const atLabel = h('span', {}, 'Bij ');
  const at = h('button', {
    type: 'button', class: 'composer-at', 'aria-pressed': 'true',
    title: 'Klik om te wisselen tussen een reactie op dit tijdstip en een algemene reactie',
  }, icon('clock'), atLabel, atValue);
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, icon('send'), h('span', { class: 'btn-label' }, submitLabel));
  const error = h('div', { class: 'composer-error small', role: 'alert', hidden: true });

  // ---- Bereik ----
  const rangeBtn = h('button', { type: 'button', class: 'composer-tool', title: 'Reactie over een tijdsbereik (van – tot)', 'aria-pressed': 'false' }, icon('range'), h('span', {}, 'Bereik'));
  const rangeBox = h('div', { class: 'composer-range', hidden: true });
  // ---- Tekenen ----
  const annotator = tools ? createAnnotator(player, { onChange: (v) => { annotation = v; show(); } }) : null;
  const drawBtn = h('button', { type: 'button', class: 'composer-tool', title: 'Tekenen op het stilstaande beeld', 'aria-pressed': 'false' }, icon('pen'), h('span', {}, 'Tekenen'));

  const show = () => {
    at.setAttribute('aria-pressed', String(withTime));
    atLabel.textContent = withTime ? (rangeMode ? 'Van ' : 'Bij ') : 'Algemene reactie';
    atValue.textContent = withTime ? timecode(time) : '';
    at.setAttribute('aria-label', withTime ? `Reactie bij ${timecode(time)}. Klik voor een algemene reactie.` : 'Algemene reactie zonder tijdstip. Klik om aan het tijdstip te koppelen.');
    at.disabled = rangeMode || !!annotation;
    rangeBtn.setAttribute('aria-pressed', String(rangeMode));
    drawBtn.setAttribute('aria-pressed', String(!!annotator?.isActive() || !!annotation));
    rangeBox.hidden = !rangeMode;
    if (rangeMode) {
      rangeBox.replaceChildren(
        icon('range'),
        rangeEnd === null
          ? h('span', { class: 'small' }, `Van ${timecode(time)} tot … `, h('span', { class: 'muted' }, 'speel verder en klik op'))
          : h('span', { class: 'small' }, h('strong', {}, `${timecode(time)} – ${timecode(rangeEnd)}`), ` (${Math.round((rangeEnd - time) * 10) / 10} s)`),
        h('button', { type: 'button', class: 'btn btn-sm btn-secondary', onClick: setEnd }, icon('flag'), h('span', { class: 'btn-label' }, rangeEnd === null ? 'Eind hier' : 'Eind opnieuw hier')),
        rangeEnd !== null ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => player.playRange(time, rangeEnd), title: 'Fragment afspelen' }, icon('play'), h('span', { class: 'btn-label' }, 'Fragment')) : null,
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-icon', 'aria-label': 'Bereik weghalen', title: 'Bereik weghalen', onClick: () => { rangeMode = false; rangeEnd = null; show(); } }, icon('x')));
    }
    drawChip.hidden = !annotation || annotator?.isActive();
    drawChip.replaceChildren(icon('pen'), h('span', {}, `Tekening (${annotation?.shapes.length || 0} ${annotation?.shapes.length === 1 ? 'vorm' : 'vormen'})`),
      h('button', { type: 'button', class: 'link-btn', onClick: () => { annotator.start(); show(); } }, 'Aanpassen'),
      h('button', { type: 'button', class: 'link-btn is-danger', onClick: () => { annotator.reset(); show(); } }, 'Weghalen'));
  };
  const drawChip = h('div', { class: 'composer-drawing small', hidden: true });

  function setEnd() {
    const t = player.currentTime();
    if (t <= time + 0.2) { showError(`Het einde moet na het begin (${timecode(time)}) liggen. Speel de video verder en klik dan op “Eind hier”.`); return; }
    rangeEnd = t;
    player.pause();
    hideError();
    show();
  }
  const showError = (msg) => { error.textContent = msg; error.hidden = false; };
  const hideError = () => { error.hidden = true; };

  const follow = (t) => { if (!pinned) { time = t; show(); } };
  const unsubscribe = player.onTime(follow);
  const pin = () => { time = player.currentTime(); pinned = true; show(); };

  at.addEventListener('click', () => { withTime = !withTime; show(); });
  rangeBtn.addEventListener('click', () => {
    if (rangeMode) { rangeMode = false; rangeEnd = null; show(); return; }
    if (!pinned) pin();
    withTime = true;
    rangeMode = true;
    rangeEnd = null;
    show();
  });
  drawBtn.addEventListener('click', () => {
    if (annotator.isActive()) { annotator.stop(); show(); return; }
    player.pause();
    if (!pinned) pin();
    withTime = true;
    annotator.start();
    show();
  });
  ta.addEventListener('focus', () => { if (!ta.value.trim() && !rangeMode) { player.pause(); pin(); } });
  ta.addEventListener('input', () => {
    if (!pinned) { player.pause(); pin(); }
    if (draftKey) draftStore.set(draftKey, ta.value);
  });
  player.video.addEventListener('seeked', () => {
    // Na verder spoelen volgt het tijdstip weer, tenzij er al iets is ingevuld, getekend of een bereik loopt.
    if (!ta.value.trim() && !rangeMode && !annotation && !annotator?.isActive()) { pinned = false; follow(player.currentTime()); }
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
  });

  const form = h('form', { class: 'composer', onSubmit: async (e) => {
    e.preventDefault();
    const body = ta.value.trim();
    if (!body && !annotation) { ta.focus(); return; }
    if (rangeMode && rangeEnd === null) { showError('Klik eerst op “Eind hier” om het einde van het bereik te kiezen, of haal het bereik weg.'); return; }
    hideError();
    annotator?.stop();
    const restore = busy(submit);
    let ok = false;
    try {
      ok = (await onSubmit(body, withTime ? time : null, { timecodeEnd: rangeMode ? rangeEnd : null, annotation })) !== false;
    } finally {
      restore();
    }
    if (ok) {
      ta.value = '';
      if (draftKey) draftStore.set(draftKey, '');
      rangeMode = false;
      rangeEnd = null;
      annotator?.reset();
      pinned = false;
      follow(player.currentTime());
    }
    // Bij een fout blijven tekst, bereik en tekening staan.
  } },
  before,
  annotator?.toolbar,
  ta,
  rangeBox,
  drawChip,
  error,
  h('div', { class: 'composer-bar' },
    at,
    tools ? h('div', { class: 'composer-tools' }, rangeBtn, drawBtn) : null,
    h('span', { class: 'composer-hint' }, '⌘/Ctrl + Enter'),
    submit));

  show();
  return {
    el: form,
    focus: () => ta.focus(),
    destroy: () => { unsubscribe(); annotator?.destroy(); },
    setDisabled(disabled, reason) {
      ta.disabled = disabled; submit.disabled = disabled; at.disabled = disabled; rangeBtn.disabled = disabled; drawBtn.disabled = disabled;
      ta.placeholder = disabled ? reason : placeholder;
    },
  };
}
