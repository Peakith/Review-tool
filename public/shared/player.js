import { tr } from './i18n.js';
import { h, timecode, icon } from './util.js';

export { icon };

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

/**
 * Vormen (coördinaten 0–1 t.o.v. het beeld) als SVG. De viewBox heeft de verhouding van de video,
 * zodat pijlpunten en lijndiktes niet vervormen; lijnen schalen mee met de beeldgrootte.
 */
export function renderShapes(shapes, { vw, vh }) {
  const W = 1000;
  const H = Math.round((W * vh) / vw);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pc-shapes', 'aria-hidden': 'true' });
  const sw = Math.max(4, Math.round(W / 220));
  for (const s of shapes) {
    const P = ([x, y]) => [x * W, y * H];
    const common = { stroke: s.c, 'stroke-width': sw, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    if (s.t === 'pen') {
      svg.append(svgEl('polyline', { ...common, points: s.pts.map((p) => P(p).join(',')).join(' ') }));
    } else if (s.t === 'rect') {
      const [x1, y1] = P(s.a);
      const [x2, y2] = P(s.b);
      svg.append(svgEl('rect', { ...common, x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), rx: 4 }));
    } else if (s.t === 'arrow') {
      const [x1, y1] = P(s.a);
      const [x2, y2] = P(s.b);
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const len = Math.max(sw * 4, Math.min(48, Math.hypot(x2 - x1, y2 - y1) * 0.35));
      const head = (d) => [x2 - len * Math.cos(ang + d), y2 - len * Math.sin(ang + d)].join(',');
      svg.append(svgEl('line', { ...common, x1, y1, x2, y2 }));
      svg.append(svgEl('polyline', { ...common, points: `${head(0.45)} ${x2},${y2} ${head(-0.45)}` }));
    }
  }
  return svg;
}

const RATES = [1, 1.5, 2, 0.5];
const store = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* privémodus */ } },
};
const LEVEL_LABEL = { 2160: '4K', 1440: '1440p', 1080: '1080p', 720: '720p' };
const levelLabel = (n) => LEVEL_LABEL[n] || `${n}p`;
/** Kwaliteit van het beeld dat nu echt speelt (korte zijde), als label. */
const playedLabel = (video) => {
  const short = Math.min(video.videoWidth || 0, video.videoHeight || 0);
  if (!short) return null;
  const known = [2160, 1440, 1080, 720].find((l) => Math.abs(short - l) <= 8);
  return levelLabel(known || short);
};

/**
 * Videospeler met eigen bediening, tijdlijn met reactiemarkeringen,
 * afspeelsnelheid en volledig scherm (op iOS via de native speler).
 * Sneltoetsen (als de speler of de pagina focus heeft): spatie/K afspelen,
 * J/L of ←/→ 5 seconden, , en . één beeld, F volledig scherm, M geluid.
 */
export function createPlayer({ src, poster, duration: knownDuration, fps = 25, hls: hlsSource = null, unavailable = null }) {
  // Geen src als er afspeelversies zijn: die laadt de kwaliteitskeuze hieronder (HLS).
  const video = h('video', { src: hlsSource?.levels?.length ? undefined : (src || undefined), poster, preload: 'metadata', playsinline: true, 'webkit-playsinline': true, controlsList: 'nodownload noremoteplayback', disablePictureInPicture: true, draggable: 'false' });
  // Geen “Video opslaan als…” via het contextmenu. Dit is geen kopieerbeveiliging: wat afgespeeld
  // wordt, kan altijd worden opgenomen. Het voorkomt alleen een ongewenste download met één klik.
  video.addEventListener('contextmenu', (e) => e.preventDefault());
  const playBtn = h('button', { class: 'pc-btn', type: 'button', 'aria-label': tr('Afspelen (spatie)') }, icon('play'));
  const timeEl = h('span', { class: 'pc-time', 'aria-live': 'off' }, `0:00 / ${timecode(knownDuration || 0)}`);
  const progress = h('div', { class: 'pc-progress' });
  const buffered = h('div', { class: 'pc-buffered' });
  const markersEl = h('div', { class: 'pc-markers' });
  const handle = h('div', { class: 'pc-handle' });
  const hoverTip = h('div', { class: 'pc-tip' });
  const track = h('div', {
    class: 'pc-track', role: 'slider', tabindex: '0', 'aria-label': tr('Tijdlijn (pijltjestoetsen: 5 seconden)'),
    'aria-valuemin': '0', 'aria-valuenow': '0',
  }, h('div', { class: 'pc-rail' }, buffered, progress), markersEl, handle, hoverTip);
  const rateBtn = h('button', { class: 'pc-btn pc-rate', type: 'button', 'aria-label': tr('Afspeelsnelheid') }, '1×');
  const muteBtn = h('button', { class: 'pc-btn', type: 'button', 'aria-label': tr('Geluid uit (M)') }, icon('volume'));
  const fsBtn = h('button', { class: 'pc-btn', type: 'button', 'aria-label': tr('Volledig scherm (F)') }, icon('fullscreen'));
  const qualityBtn = h('button', { class: 'pc-btn pc-quality', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', hidden: true }, icon('gear'), h('span', { class: 'pc-quality-label' }, ''));
  const qualityMenu = h('div', { class: 'pc-quality-menu', role: 'menu', hidden: true });
  const bigPlay = h('button', { class: 'pc-bigplay', type: 'button', 'aria-label': tr('Afspelen') }, icon('play'));
  const loading = h('div', { class: 'spinner pc-loading', 'aria-hidden': 'true' });
  const loadError = h('div', { class: 'pc-error', role: 'alert', hidden: true });
  const controls = h('div', { class: 'pc-controls' }, track,
    h('div', { class: 'pc-row' }, playBtn, timeEl, h('span', { class: 'pc-spacer' }), h('span', { class: 'pc-quality-wrap' }, qualityBtn, qualityMenu), rateBtn, muteBtn, fsBtn));
  // Laag precies boven het werkelijke videobeeld (zonder zwarte randen) voor tekeningen.
  const overlay = h('div', { class: 'pc-overlay', hidden: true });
  const stage = h('div', { class: 'player-stage' }, video, overlay, bigPlay, loading, loadError);
  const el = h('div', { class: 'player', tabindex: '-1' }, stage, controls);

  let markers = [];
  let onMarkerClick = () => {};
  const timeListeners = new Set();
  const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : knownDuration || 0);

  const setIcon = (btn, name, label) => { btn.replaceChildren(icon(name)); btn.setAttribute('aria-label', label); };
  const toggle = () => (video.paused ? video.play().catch(() => {}) : video.pause());

  function render() {
    const d = duration();
    const pct = d ? Math.min(100, (video.currentTime / d) * 100) : 0;
    progress.style.width = `${pct}%`;
    handle.style.left = `${pct}%`;
    timeEl.textContent = `${timecode(video.currentTime)} / ${timecode(d)}`;
    track.setAttribute('aria-valuenow', String(Math.round(video.currentTime)));
    track.setAttribute('aria-valuemax', String(Math.round(d)));
    track.setAttribute('aria-valuetext', timecode(video.currentTime));
    if (video.buffered.length && d) buffered.style.width = `${(video.buffered.end(video.buffered.length - 1) / d) * 100}%`;
    for (const fn of timeListeners) fn(video.currentTime);
  }

  // Via CSSOM i.p.v. een style-attribuut, zodat de Content-Security-Policy strikt kan blijven.
  const positioned = (node, pct) => { node.style.left = `${pct}%`; return node; };

  function renderMarkers() {
    const d = duration();
    const items = [];
    for (const m of d ? markers : []) {
      // Tijdsbereik: een balk van begin tot eind, onder de stip.
      if (m.end !== null && m.end !== undefined && m.end > m.time) {
        const bar = positioned(h('span', { class: `pc-range${m.active ? ' is-active' : ''}${m.resolved ? ' is-resolved' : ''}`, 'aria-hidden': 'true' }), Math.min(100, (m.time / d) * 100));
        bar.style.width = `${Math.max(0.5, Math.min(100, ((m.end - m.time) / d) * 100))}%`;
        items.push(bar);
      }
      items.push(positioned(h('button', {
        type: 'button',
        class: `pc-marker${m.resolved ? ' is-resolved' : ''}${m.active ? ' is-active' : ''}${m.drawing ? ' has-drawing' : ''}`,
        title: `${timecode(m.time)}${m.end ? `–${timecode(m.end)}` : ''} · ${m.label || ''}`,
        'aria-label': `${tr('Reactie op {t}', { t: timecode(m.time) })}${m.end ? ` ${tr('tot')} ${timecode(m.end)}` : ''}${m.resolved ? ` ${tr('(afgehandeld)')}` : ''}`,
        onClick: (e) => { e.stopPropagation(); seek(m.time); onMarkerClick(m.id); },
      }), Math.min(100, (m.time / d) * 100)));
    }
    markersEl.replaceChildren(...items);
  }

  // ---- Beeldvlak: waar staat het echte beeld binnen de speler (object-fit: contain)? ----
  function pictureRect() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const bw = video.clientWidth;
    const bh = video.clientHeight;
    if (!vw || !vh || !bw || !bh) return null;
    const scale = Math.min(bw / vw, bh / vh);
    const w = vw * scale;
    const hgt = vh * scale;
    return { left: video.offsetLeft + (bw - w) / 2, top: video.offsetTop + (bh - hgt) / 2, width: w, height: hgt, vw, vh };
  }
  const layoutListeners = new Set();
  function layoutOverlay() {
    const r = pictureRect();
    if (!r) return;
    Object.assign(overlay.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    for (const fn of layoutListeners) fn(r);
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(layoutOverlay) : null;
  ro?.observe(stage);
  video.addEventListener('loadedmetadata', layoutOverlay);
  // Andere kwaliteit = andere beeldafmetingen in pixels, zelfde verhouding: tekeningen blijven op hun plek.
  video.addEventListener('resize', () => { layoutOverlay(); if (shown) showAnnotation(shown); drawQuality(); });
  window.addEventListener('resize', layoutOverlay);

  // ---- Tekening tonen (alleen-lezen) ----
  let shown = null;
  function showAnnotation(annotation) {
    shown = annotation && annotation.shapes?.length ? annotation : null;
    if (!shown) { if (!overlay.dataset.editing) { overlay.hidden = true; overlay.replaceChildren(); } return; }
    // Het stilstaande beeld onder de tekening moet echt geladen zijn (niet alleen de metadata).
    if (video.readyState < 2) video.preload = 'auto';
    layoutOverlay();
    overlay.hidden = false;
    overlay.replaceChildren(renderShapes(shown.shapes, { vw: video.videoWidth || 1600, vh: video.videoHeight || 900 }));
  }
  video.addEventListener('play', () => { if (!overlay.dataset.editing) { shown = null; overlay.hidden = true; overlay.replaceChildren(); } });

  // ---- Fragment afspelen (van begin tot eind van een tijdsbereik) ----
  let rangeEnd = null;
  function playRange(start, end) {
    seek(start);
    rangeEnd = end;
    video.play().catch(() => {});
  }
  const checkRange = () => {
    if (rangeEnd !== null && video.currentTime >= rangeEnd - 0.03) { video.pause(); video.currentTime = rangeEnd; rangeEnd = null; render(); }
    if (rangeEnd !== null && !video.paused) requestAnimationFrame(checkRange);
  };
  video.addEventListener('play', () => { if (rangeEnd !== null) requestAnimationFrame(checkRange); });
  // Zelf pauzeren of verder spoelen tijdens een fragment: dan geen automatische stop meer.
  video.addEventListener('pause', () => { rangeEnd = null; });

  function seek(t) {
    const d = duration();
    video.currentTime = Math.max(0, d ? Math.min(d, t) : t);
    render();
  }

  function timeFromEvent(e) {
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration();
  }

  let dragging = false;
  track.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('pc-marker')) return;
    dragging = true;
    track.setPointerCapture(e.pointerId);
    seek(timeFromEvent(e));
  });
  track.addEventListener('pointermove', (e) => {
    const t = timeFromEvent(e);
    hoverTip.textContent = timecode(t);
    hoverTip.style.left = `${duration() ? (t / duration()) * 100 : 0}%`;
    if (dragging) seek(t);
  });
  track.addEventListener('pointerup', () => { dragging = false; });
  track.addEventListener('pointercancel', () => { dragging = false; });

  playBtn.addEventListener('click', toggle);
  bigPlay.addEventListener('click', toggle);
  video.addEventListener('click', toggle);
  video.addEventListener('play', () => { setIcon(playBtn, 'pause', tr('Pauzeren (spatie)')); el.classList.add('is-playing'); });
  video.addEventListener('pause', () => { setIcon(playBtn, 'play', tr('Afspelen (spatie)')); el.classList.remove('is-playing'); });
  video.addEventListener('waiting', () => el.classList.add('is-loading'));
  for (const ev of ['playing', 'canplay', 'pause', 'seeked']) video.addEventListener(ev, () => el.classList.remove('is-loading'));
  video.addEventListener('timeupdate', render);
  video.addEventListener('seeked', render);
  video.addEventListener('progress', render);
  video.addEventListener('loadedmetadata', () => { render(); renderMarkers(); });
  video.addEventListener('error', () => {
    const code = video.error?.code;
    el.classList.remove('is-loading');
    loadError.hidden = false;
    loadError.textContent = code === 2
      ? tr('De video kon niet worden geladen. Controleer je verbinding en ververs de pagina.')
      : tr('Deze video kan in deze browser niet worden afgespeeld. Mogelijk gebruikt het bestand een codec die browsers niet ondersteunen (zoals ProRes). Gebruik bij voorkeur H.264 in MP4.');
  });

  rateBtn.addEventListener('click', () => {
    const next = RATES[(RATES.indexOf(video.playbackRate) + 1) % RATES.length];
    video.playbackRate = next;
    rateBtn.textContent = `${next}×`;
  });
  const toggleMute = () => {
    video.muted = !video.muted;
    setIcon(muteBtn, video.muted ? 'muted' : 'volume', video.muted ? tr('Geluid aan (M)') : tr('Geluid uit (M)'));
  };
  muteBtn.addEventListener('click', toggleMute);

  // ---- Volledig scherm ----
  // Op iPhone bestaat alleen de ingebouwde schermvullende speler van iOS (webkitEnterFullscreen).
  // Daarin kunnen we geen tekeningen tonen. Zijn er tekeningen, dan leggen we dat uit en bieden we
  // "Groot in de pagina": de speler vult dan het venster, mét tekeningen.
  let pageFull = false;
  const fsChoice = h('div', { class: 'pc-fschoice', role: 'dialog', 'aria-label': tr('Volledig scherm met tekeningen'), hidden: true });
  stage.append(fsChoice);
  const setPageFull = (on) => {
    pageFull = on;
    el.classList.toggle('is-pagefull', on);
    document.documentElement.classList.toggle('has-pagefull-player', on);
    setIcon(fsBtn, on ? 'minimize' : 'fullscreen', on ? tr('Groot in de pagina sluiten (Esc)') : tr('Volledig scherm (F)'));
    fsChoice.hidden = true;
    requestAnimationFrame(layoutOverlay);
  };
  const hasDrawings = () => !!shown || markers.some((m) => m.drawing);
  function showFsChoice() {
    const native = h('button', { type: 'button', class: 'btn btn-sm btn-secondary' }, tr('Schermvullend zonder tekeningen'));
    const page = h('button', { type: 'button', class: 'btn btn-sm btn-primary' }, icon('fullscreen'), h('span', { class: 'btn-label' }, tr('Groot in de pagina (met tekeningen)')));
    const close = h('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-icon', 'aria-label': tr('Sluiten') }, icon('x'));
    page.addEventListener('click', () => setPageFull(true));
    native.addEventListener('click', () => { fsChoice.hidden = true; video.webkitEnterFullscreen(); });
    close.addEventListener('click', () => { fsChoice.hidden = true; });
    fsChoice.replaceChildren(
      h('div', { class: 'pc-fschoice-head' }, icon('info'), h('strong', {}, tr('Tekeningen en volledig scherm')), close),
      h('p', {}, tr('De schermvullende weergave van iPhone toont geen tekeningen. Ze zijn niet verdwenen: kies “Groot in de pagina” om het beeld met tekeningen groot te bekijken.')),
      h('div', { class: 'pc-fschoice-actions' }, page, native));
    fsChoice.hidden = false;
    page.focus();
  }
  function fallbackFullscreen() {
    if (!video.webkitEnterFullscreen) return setPageFull(true);
    if (hasDrawings()) return showFsChoice();
    return video.webkitEnterFullscreen(); // iOS Safari zonder tekeningen
  }
  const toggleFullscreen = () => {
    if (pageFull) return setPageFull(false);
    if (document.fullscreenElement) return document.exitFullscreen();
    if (el.requestFullscreen) return el.requestFullscreen().catch(fallbackFullscreen);
    return fallbackFullscreen();
  };
  fsBtn.addEventListener('click', toggleFullscreen);
  const onFsChange = () => { el.classList.toggle('is-fullscreen', document.fullscreenElement === el); requestAnimationFrame(layoutOverlay); };
  document.addEventListener('fullscreenchange', onFsChange);
  video.addEventListener('webkitendfullscreen', () => requestAnimationFrame(layoutOverlay));

  // ---- Kwaliteit (afspeelversies via HLS) ----
  // Auto kiest de hoogste kwaliteit die de verbinding aankan (en wisselt niet bij elk schommelinkje);
  // een eigen keuze blijft staan tot je hem wijzigt. Wisselen behoudt tijdstip, geluid en tekeningen.
  const levels = (hlsSource?.levels || []).slice().sort((a, b) => b.level - a.level); // hoog → laag
  let choice = 'auto';
  let hls = null;
  let mode = null; // 'hlsjs' | 'native' | 'file'
  const wantedLevel = () => (choice === 'auto' ? null : levels.find((l) => String(l.level) === String(choice)) || null);
  function drawQuality() {
    if (!levels.length) return;
    const now = playedLabel(video);
    const label = choice === 'auto' ? `Auto${now ? ` · ${now}` : ''}` : (wantedLevel()?.label || levelLabel(choice));
    qualityBtn.querySelector('.pc-quality-label').textContent = label;
    qualityBtn.setAttribute('aria-label', `${tr('Kwaliteit')}: ${label}${now && choice !== 'auto' ? '' : ''}`);
    const item = (key, text, sub) => h('button', {
      type: 'button', role: 'menuitemradio', class: 'pc-quality-item', 'aria-checked': String(String(choice) === String(key)),
      onClick: () => { setQuality(key); closeQuality(); qualityBtn.focus(); },
    }, h('span', { class: 'pc-quality-check', 'aria-hidden': 'true' }, String(choice) === String(key) ? icon('check') : null), text, sub ? h('span', { class: 'pc-quality-sub' }, sub) : null);
    qualityMenu.replaceChildren(
      h('div', { class: 'pc-quality-head' }, tr('Kwaliteit')),
      item('auto', tr('Auto'), tr('hoogste die je verbinding aankan')),
      ...levels.map((l) => item(l.level, l.label, `${l.width}×${l.height}`)),
      h('div', { class: 'pc-quality-now' }, now ? tr('Nu: {q}', { q: now }) : tr('Nu: wordt geladen…')));
  }
  const closeQuality = () => { qualityMenu.hidden = true; qualityBtn.setAttribute('aria-expanded', 'false'); };
  qualityBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!qualityMenu.hidden) return closeQuality();
    drawQuality();
    qualityMenu.hidden = false;
    qualityBtn.setAttribute('aria-expanded', 'true');
    qualityMenu.querySelector('[aria-checked="true"]')?.focus();
  });
  qualityMenu.addEventListener('keydown', (e) => {
    const items = [...qualityMenu.querySelectorAll('.pc-quality-item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.stopPropagation(); closeQuality(); qualityBtn.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  const outsideQuality = (e) => { if (!qualityMenu.hidden && !qualityMenu.contains(e.target) && e.target !== qualityBtn) closeQuality(); };
  document.addEventListener('click', outsideQuality);

  /** Bron wisselen zonder hls.js (Safari-eigen HLS of los bestand): tijd en afspeelstatus behouden. */
  function swapSource(url) {
    const t = video.currentTime;
    const playing = !video.paused;
    const keepRange = rangeEnd;
    video.src = url;
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = t;
      if (keepRange !== null) rangeEnd = keepRange;
      if (playing) video.play().catch(() => {});
    }, { once: true });
  }

  function setQuality(key) {
    choice = key;
    store.set('rt-quality', String(key));
    if (mode === 'hlsjs' && hls) {
      // currentLevel: direct wisselen vanaf het huidige tijdstip; -1 = automatisch.
      const idx = key === 'auto' ? -1 : hls.levels.findIndex((l) => Math.min(l.width, l.height) === Number(key) || l.height === Number(key));
      hls.currentLevel = idx;
      if (key === 'auto') hls.nextLevel = -1;
    } else if (mode === 'native') {
      swapSource(key === 'auto' ? hlsSource.master : hlsSource.levelPlaylist(key));
    } else if (mode === 'file') {
      swapSource(hlsSource.levelFile(key === 'auto' ? levels[0].level : key));
    }
    drawQuality();
  }

  async function startHls() {
    const saved = store.get('rt-quality');
    if (saved && (saved === 'auto' || levels.some((l) => String(l.level) === saved))) choice = saved;
    qualityBtn.hidden = false;
    let Hls = null;
    try {
      const mod = await import('/shared/vendor/hls.light.min.mjs');
      Hls = mod.default;
    } catch { Hls = null; }
    if (Hls?.isSupported()) {
      mode = 'hlsjs';
      hls = new Hls({
        // Lokaal of op een snel netwerk: begin hoog. ABR stapt alleen terug als het echt nodig is.
        startLevel: -1, abrEwmaDefaultEstimate: 25e6, capLevelToPlayerSize: false,
        maxBufferLength: 30, backBufferLength: 30, enableWorker: false,
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (choice !== 'auto') setQuality(choice);
        else hls.startLevel = hls.levels.length - 1; // hoogste (afspeellijst staat oplopend)
        drawQuality();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, drawQuality);
      hls.on(Hls.Events.ERROR, (evt, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else { loadError.hidden = false; loadError.textContent = tr('De video kon niet worden geladen. Controleer je verbinding en ververs de pagina.'); }
      });
      hls.loadSource(hlsSource.master);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      mode = 'native'; // Safari: eigen HLS-ondersteuning (Auto); een vaste keuze speelt die ene afspeellijst
      video.src = choice === 'auto' ? hlsSource.master : hlsSource.levelPlaylist(choice);
    } else {
      mode = 'file'; // zonder HLS-ondersteuning: één afspeelversie als gewoon bestand
      video.src = hlsSource.levelFile(choice === 'auto' ? levels[0].level : choice);
    }
    drawQuality();
  }
  if (levels.length) startHls();
  if (!levels.length && !src && unavailable) {
    loadError.hidden = false;
    loadError.textContent = unavailable;
    bigPlay.hidden = true;
  }

  const step = 1 / fps;
  function onKey(e) {
    if (e.key === 'Escape' && !qualityMenu.hidden) { closeQuality(); qualityBtn.focus(); e.preventDefault(); return; }
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable], dialog')) return;
    if (document.querySelector('dialog[open]')) return;
    const onButton = e.target.closest?.('button, a');
    const keys = {
      ' ': () => !onButton && toggle(),
      k: toggle,
      j: () => seek(video.currentTime - 5),
      l: () => seek(video.currentTime + 5),
      ArrowLeft: () => seek(video.currentTime - 5),
      ArrowRight: () => seek(video.currentTime + 5),
      ',': () => { video.pause(); seek(video.currentTime - step); },
      '.': () => { video.pause(); seek(video.currentTime + step); },
      f: toggleFullscreen,
      m: toggleMute,
      Escape: () => (pageFull ? setPageFull(false) : !fsChoice.hidden ? (fsChoice.hidden = true) : null),
    };
    const fn = keys[e.key] || keys[e.key.toLowerCase?.()];
    if (!fn || (e.key === ' ' && onButton)) return;
    if (e.key === 'Escape' && !pageFull && fsChoice.hidden) return;
    fn();
    e.preventDefault();
  }
  document.addEventListener('keydown', onKey);

  return {
    el,
    video,
    seek,
    pause: () => video.pause(),
    currentTime: () => video.currentTime,
    onTime(fn) { timeListeners.add(fn); return () => timeListeners.delete(fn); },
    setMarkers(list) { markers = list; renderMarkers(); },
    onMarkerClick(fn) { onMarkerClick = fn; },
    stage,
    overlay,
    pictureRect,
    layoutOverlay,
    onLayout(fn) { layoutListeners.add(fn); return () => layoutListeners.delete(fn); },
    showAnnotation,
    setPageFull,
    playRange,
    play: () => video.play().catch(() => {}),
    duration,
    quality: () => ({ choice, played: playedLabel(video), mode, levels: levels.map((l) => l.label) }),
    setQuality,
    destroy() {
      hls?.destroy();
      document.removeEventListener('click', outsideQuality);
      ro?.disconnect();
      window.removeEventListener('resize', layoutOverlay);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
      document.documentElement.classList.remove('has-pagefull-player');
      timeListeners.clear();
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}
