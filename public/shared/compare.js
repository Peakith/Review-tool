// Twee versies naast elkaar vergelijken: gekoppeld afspelen, pauzeren en spoelen, koppeling
// loszetten, geluid van één versie, handmatige uitlijning (verschuiving) en verschillende lengtes.
// Gekoppelde tijdcodes zijn géén inhoudelijke vergelijking: beide video's staan alleen op
// hetzelfde (verschoven) tijdstip. Alleen-lezen: hier kun je niet reageren.
import { tr } from './i18n.js';
import { h, icon, timecode, mount } from './util.js';

const FPS = 25;

/**
 * versions: [{ id, number, label, sub, src, poster, duration }] (nieuwste eerst)
 * a, b: id's van de beginkeuze. onChange({ a, b }) bij een andere keuze (voor de URL).
 */
export function createCompare({ versions, a, b, onChange = () => {} }) {
  const byId = new Map(versions.map((v) => [v.id, v]));
  let A = byId.get(a) || versions[1] || versions[0];
  let B = byId.get(b) || versions[0];
  let linked = true;
  let offset = 0; // tijd van B = tijd van A + offset
  let audio = 'B';
  let view = 'both';
  let T = 0; // tijd op de gekoppelde tijdlijn (= tijd van A)
  let playing = false;
  let last = 0;
  let raf = 0;

  const pane = (key) => {
    const video = h('video', { preload: 'auto', playsinline: true, 'webkit-playsinline': true });
    const label = h('div', { class: 'cmp-label' });
    const state = h('div', { class: 'cmp-state', hidden: true });
    const time = h('div', { class: 'cmp-time mono' });
    const select = h('select', { class: 'cmp-select', 'aria-label': tr('Versie {n}', { n: key }) }, versions.map((v) => h('option', { value: v.id }, `${v.label}${v.sub ? ` · ${v.sub}` : ''}`)));
    const el = h('section', { class: 'cmp-pane', 'aria-label': tr('Versie {n}', { n: key }) },
      h('div', { class: 'cmp-pane-head' }, h('span', { class: 'cmp-key' }, key), select),
      h('div', { class: 'cmp-stage' }, video, state, label), time);
    return { key, video, label, state, time, select, el };
  };
  const pA = pane('A');
  const pB = pane('B');
  const panes = () => [[pA, () => A, 0], [pB, () => B, offset]];

  const dur = (p, v) => (Number.isFinite(p.video.duration) && p.video.duration > 0 ? p.video.duration : v.duration || 0);
  const range = () => {
    const dA = dur(pA, A);
    const dB = dur(pB, B);
    return { min: Math.min(0, -offset), max: Math.max(dA, dB - offset), dA, dB };
  };

  // ---- Bediening ----
  const playBtn = h('button', { type: 'button', class: 'pc-btn', 'aria-label': tr('Afspelen') }, icon('play'));
  const scrub = h('input', { type: 'range', min: '0', max: '100', step: '0.01', value: '0', class: 'cmp-scrub', 'aria-label': tr('Gekoppelde tijdlijn') });
  const timeEl = h('span', { class: 'pc-time' });
  const linkBtn = h('button', { type: 'button', class: 'btn btn-sm btn-secondary' });
  const audioSeg = h('div', { class: 'segmented segmented-sm', role: 'group', 'aria-label': tr('Geluid van') });
  const viewSeg = h('div', { class: 'segmented segmented-sm cmp-view', role: 'group', 'aria-label': tr('Weergave') });
  const offsetEl = h('div', { class: 'cmp-offset' });

  function drawControls() {
    mount(playBtn, icon(playing ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', playing ? tr('Pauzeren') : tr('Afspelen'));
    mount(linkBtn, icon(linked ? 'link2' : 'unlink'), h('span', { class: 'btn-label' }, linked ? tr('Gekoppeld') : tr('Los')));
    linkBtn.title = linked ? tr('Klik om A en B los van elkaar te bedienen') : tr('Klik om A en B weer gekoppeld af te spelen (met de huidige posities als uitlijning)');
    mount(audioSeg, h('span', { class: 'cmp-seg-label' }, tr('Geluid')), ['A', 'B'].map((k) => h('button', { type: 'button', 'aria-pressed': String(audio === k), onClick: () => { audio = k; applyAudio(); drawControls(); } }, k)));
    mount(viewSeg, [['both', tr('A en B')], ['A', tr('Alleen A')], ['B', tr('Alleen B')]].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(view === k), onClick: () => { view = k; root.dataset.view = k; drawControls(); } }, l)));
    const sign = offset > 0 ? '+' : offset < 0 ? '−' : '±';
    mount(offsetEl,
      h('span', { class: 'small muted' }, tr('Uitlijning B')),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => shift(-1), title: tr('B één seconde eerder') }, '−1 s'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => shift(-1 / FPS), title: tr('B één beeld eerder') }, tr('−1 beeld')),
      h('strong', { class: 'mono cmp-offset-value', title: tr('Hoeveel B verschoven is ten opzichte van A') }, `${sign}${Math.abs(offset).toFixed(2)} s`),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => shift(1 / FPS), title: tr('B één beeld later') }, tr('+1 beeld')),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => shift(1), title: tr('B één seconde later') }, '+1 s'),
      offset ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => { offset = 0; sync(true); drawControls(); } }, tr('Herstellen')) : null);
    scrub.disabled = !linked;
    playBtn.disabled = !linked;
    for (const [p] of panes()) p.video.controls = !linked;
  }

  function shift(d) {
    offset = Math.round((offset + d) * 1000) / 1000;
    sync(true);
    drawControls();
  }

  function applyAudio() {
    pA.video.muted = audio !== 'A';
    pB.video.muted = audio !== 'B';
  }

  // ---- Synchroniseren: elke video op T (+ verschuiving), of stil aan het begin/einde ----
  function sync(force = false) {
    const r = range();
    T = Math.min(r.max, Math.max(r.min, T));
    for (const [p, get, off] of panes()) {
      const v = get();
      const d = dur(p, v);
      const want = T + off;
      let note = '';
      if (want < 0) note = tr('Begint over {t}', { t: timecode(-want) });
      else if (d && want > d) note = tr('Einde van deze versie');
      const target = Math.min(d || want, Math.max(0, want));
      const inRange = !note;
      if (force || Math.abs(p.video.currentTime - target) > (playing && inRange ? 0.15 : 0.03)) {
        try { p.video.currentTime = target; } catch { /* nog niet geladen */ }
      }
      if (playing && inRange && p.video.paused) p.video.play().catch(() => {});
      if ((!playing || !inRange) && !p.video.paused) p.video.pause();
      p.state.hidden = !note;
      p.state.textContent = note;
      p.time.textContent = `${timecode(target)} / ${timecode(d)}`;
    }
    scrub.min = String(r.min);
    scrub.max = String(r.max || 1);
    scrub.value = String(T);
    timeEl.textContent = `${timecode(Math.max(0, T))}`;
  }

  function tick(now) {
    if (!playing) return;
    // De versie waarvan je het geluid hoort, bepaalt de klok (als die speelt); anders de wandklok.
    const lead = audio === 'A' ? pA : pB;
    const off = audio === 'A' ? 0 : offset;
    if (!lead.video.paused && !lead.video.seeking && lead.state.hidden) T = lead.video.currentTime - off;
    else T += (now - last) / 1000;
    last = now;
    if (T >= range().max) { T = range().max; playing = false; drawControls(); }
    sync();
    raf = requestAnimationFrame(tick);
  }

  function play() { if (!linked) return; if (T >= range().max - 0.05) T = range().min; playing = true; last = performance.now(); drawControls(); sync(true); raf = requestAnimationFrame(tick); }
  function pause() { playing = false; cancelAnimationFrame(raf); drawControls(); sync(true); }

  playBtn.addEventListener('click', () => (playing ? pause() : play()));
  scrub.addEventListener('input', () => { T = Number(scrub.value); sync(true); });
  linkBtn.addEventListener('click', () => {
    if (linked) { pause(); linked = false; } else {
      // Weer koppelen: de huidige posities bepalen de uitlijning.
      offset = Math.round((pB.video.currentTime - pA.video.currentTime) * 1000) / 1000;
      T = pA.video.currentTime;
      for (const [p] of panes()) p.video.pause();
      linked = true;
      sync(true);
    }
    drawControls();
  });

  function load(p, v) {
    p.video.src = v.src;
    if (v.poster) p.video.poster = v.poster;
    p.select.value = String(v.id);
    mount(p.label, h('strong', {}, v.label), v.sub ? h('span', {}, v.sub) : null);
    p.video.addEventListener('loadedmetadata', () => sync(true), { once: true });
  }
  pA.select.addEventListener('change', () => { A = byId.get(Number(pA.select.value)); pause(); load(pA, A); onChange({ a: A.id, b: B.id }); });
  pB.select.addEventListener('change', () => { B = byId.get(Number(pB.select.value)); pause(); load(pB, B); onChange({ a: A.id, b: B.id }); });
  for (const [p] of panes()) {
    // Los bediend: tijden bijhouden; bij het einde van een video niets bijzonders.
    p.video.addEventListener('timeupdate', () => { if (!linked) p.time.textContent = `${timecode(p.video.currentTime)} / ${timecode(p.video.duration || 0)}`; });
  }

  function onKey(e) {
    if (e.target.closest?.('input, textarea, select, button, a') || e.metaKey || e.ctrlKey) return;
    if (e.key === ' ' && linked) { e.preventDefault(); playing ? pause() : play(); }
  }
  document.addEventListener('keydown', onKey);

  const root = h('div', { class: 'cmp', dataset: { view } },
    h('div', { class: 'notice notice-info cmp-note' }, icon('info'), h('span', {},
      h('strong', {}, tr('Gekoppelde tijdcodes zijn geen inhoudelijke vergelijking. ')),
      tr('Beide video’s staan op hetzelfde tijdstip (plus de uitlijning hieronder). Is de montage anders, schuif B dan met de knoppen tot de beelden gelijk lopen, of zet de koppeling los en zoek per video het juiste moment.'))),
    h('div', { class: 'cmp-panes' }, pA.el, pB.el),
    h('div', { class: 'cmp-controls' },
      h('div', { class: 'cmp-row' }, playBtn, scrub, timeEl),
      h('div', { class: 'cmp-row cmp-row-wrap' }, linkBtn, audioSeg, viewSeg, offsetEl)));

  load(pA, A);
  load(pB, B);
  applyAudio();
  drawControls();
  sync(true);

  return {
    el: root,
    destroy() {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      for (const [p] of panes()) { p.video.pause(); p.video.removeAttribute('src'); p.video.load(); }
    },
  };
}
