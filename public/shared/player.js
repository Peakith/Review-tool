import { h, timecode, icon } from './util.js';

export { icon };

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
  const el = h('div', { class: 'player', tabindex: '-1' }, h('div', { class: 'player-stage' }, video, bigPlay, loading, loadError), controls);

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
    markersEl.replaceChildren(...(d ? markers : []).map((m) => positioned(h('button', {
      type: 'button',
      class: `pc-marker${m.resolved ? ' is-resolved' : ''}${m.active ? ' is-active' : ''}`,
      title: `${timecode(m.time)} · ${m.label || ''}`,
      'aria-label': `Reactie op ${timecode(m.time)}${m.resolved ? ' (afgehandeld)' : ''}`,
      onClick: (e) => { e.stopPropagation(); seek(m.time); onMarkerClick(m.id); },
    }), Math.min(100, (m.time / d) * 100))));
  }

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
  const onFsChange = () => el.classList.toggle('is-fullscreen', document.fullscreenElement === el);
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
    destroy() {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
      timeListeners.clear();
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}
