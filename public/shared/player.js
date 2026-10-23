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

/**
 * Videospeler met eigen bediening, tijdlijn met reactiemarkeringen,
 * afspeelsnelheid en volledig scherm (op iOS via de native speler).
 * Sneltoetsen (als de speler of de pagina focus heeft): spatie/K afspelen,
 * J/L of ←/→ 5 seconden, , en . één beeld, F volledig scherm, M geluid.
 */
export function createPlayer({ src, poster, duration: knownDuration, fps = 25 }) {
  const video = h('video', { src, poster, preload: 'metadata', playsinline: true, 'webkit-playsinline': true });
  const playBtn = h('button', { class: 'pc-btn', type: 'button', 'aria-label': 'Afspelen (spatie)' }, icon('play'));
  const timeEl = h('span', { class: 'pc-time', 'aria-live': 'off' }, `0:00 / ${timecode(knownDuration || 0)}`);
  const progress = h('div', { class: 'pc-progress' });
  const buffered = h('div', { class: 'pc-buffered' });
  const markersEl = h('div', { class: 'pc-markers' });
  const handle = h('div', { class: 'pc-handle' });
  const hoverTip = h('div', { class: 'pc-tip' });
  const track = h('div', {
    class: 'pc-track', role: 'slider', tabindex: '0', 'aria-label': 'Tijdlijn (pijltjestoetsen: 5 seconden)',
    'aria-valuemin': '0', 'aria-valuenow': '0',
  }, h('div', { class: 'pc-rail' }, buffered, progress), markersEl, handle, hoverTip);
  const rateBtn = h('button', { class: 'pc-btn pc-rate', type: 'button', 'aria-label': 'Afspeelsnelheid' }, '1×');
  const muteBtn = h('button', { class: 'pc-btn', type: 'button', 'aria-label': 'Geluid uit (M)' }, icon('volume'));
  const fsBtn = h('button', { class: 'pc-btn', type: 'button', 'aria-label': 'Volledig scherm (F)' }, icon('fullscreen'));
  const bigPlay = h('button', { class: 'pc-bigplay', type: 'button', 'aria-label': 'Afspelen' }, icon('play'));
  const loading = h('div', { class: 'spinner pc-loading', 'aria-hidden': 'true' });
  const loadError = h('div', { class: 'pc-error', role: 'alert', hidden: true });
  const controls = h('div', { class: 'pc-controls' }, track,
    h('div', { class: 'pc-row' }, playBtn, timeEl, h('span', { class: 'pc-spacer' }), rateBtn, muteBtn, fsBtn));
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
        'aria-label': `Reactie op ${timecode(m.time)}${m.end ? ` tot ${timecode(m.end)}` : ''}${m.resolved ? ' (afgehandeld)' : ''}`,
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
  video.addEventListener('play', () => { setIcon(playBtn, 'pause', 'Pauzeren (spatie)'); el.classList.add('is-playing'); });
  video.addEventListener('pause', () => { setIcon(playBtn, 'play', 'Afspelen (spatie)'); el.classList.remove('is-playing'); });
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
      ? 'De video kon niet worden geladen. Controleer je verbinding en ververs de pagina.'
      : 'Deze video kan in deze browser niet worden afgespeeld. Mogelijk gebruikt het bestand een codec die browsers niet ondersteunen (zoals ProRes). Gebruik bij voorkeur H.264 in MP4.';
  });

  rateBtn.addEventListener('click', () => {
    const next = RATES[(RATES.indexOf(video.playbackRate) + 1) % RATES.length];
    video.playbackRate = next;
    rateBtn.textContent = `${next}×`;
  });
  const toggleMute = () => {
    video.muted = !video.muted;
    setIcon(muteBtn, video.muted ? 'muted' : 'volume', video.muted ? 'Geluid aan (M)' : 'Geluid uit (M)');
  };
  muteBtn.addEventListener('click', toggleMute);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) return document.exitFullscreen();
    if (el.requestFullscreen) return el.requestFullscreen().catch(() => video.webkitEnterFullscreen?.());
    if (video.webkitEnterFullscreen) return video.webkitEnterFullscreen(); // iOS Safari
  };
  fsBtn.addEventListener('click', toggleFullscreen);
  const onFsChange = () => { el.classList.toggle('is-fullscreen', document.fullscreenElement === el); requestAnimationFrame(layoutOverlay); };
  document.addEventListener('fullscreenchange', onFsChange);

  const step = 1 / fps;
  function onKey(e) {
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
    };
    const fn = keys[e.key] || keys[e.key.toLowerCase?.()];
    if (!fn || (e.key === ' ' && onButton)) return;
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
    playRange,
    play: () => video.play().catch(() => {}),
    duration,
    destroy() {
      ro?.disconnect();
      window.removeEventListener('resize', layoutOverlay);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
      timeListeners.clear();
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}
