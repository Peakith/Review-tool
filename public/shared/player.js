import { h, timecode } from './util.js';

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15 9a4.2 4.2 0 0 1 0 6M17.5 6.5a7.8 7.8 0 0 1 0 11" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 7l-5 5 5 5M6.5 12H18" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export function icon(name) {
  const span = h('span', { class: 'icon' });
  span.innerHTML = ICONS[name]; // vaste, eigen SVG-string
  return span;
}

/**
 * Videospeler met eigen bediening, tijdlijn met reactiemarkeringen en
 * volledig scherm (ook op iOS via de native speler).
 */
export function createPlayer({ src, poster, duration: knownDuration }) {
  const video = h('video', { src, poster, preload: 'metadata', playsinline: true, 'webkit-playsinline': true });
  const playBtn = h('button', { class: 'pc-btn', type: 'button', 'aria-label': 'Afspelen' }, icon('play'));
  const timeEl = h('span', { class: 'pc-time' }, '0:00 / ', timecode(knownDuration || 0));
  const progress = h('div', { class: 'pc-progress' });
  const buffered = h('div', { class: 'pc-buffered' });
  const markersEl = h('div', { class: 'pc-markers' });
  const handle = h('div', { class: 'pc-handle' });
  const hoverTip = h('div', { class: 'pc-tip' });
  const track = h('div', {
    class: 'pc-track', role: 'slider', tabindex: '0', 'aria-label': 'Tijdlijn',
    'aria-valuemin': '0', 'aria-valuenow': '0',
  }, h('div', { class: 'pc-rail' }, buffered, progress), markersEl, handle, hoverTip);
  const muteBtn = h('button', { class: 'pc-btn pc-mute', type: 'button', 'aria-label': 'Geluid uit' }, icon('volume'));
  const fsBtn = h('button', { class: 'pc-btn', type: 'button', 'aria-label': 'Volledig scherm' }, icon('fullscreen'));
  const bigPlay = h('button', { class: 'pc-bigplay', type: 'button', 'aria-label': 'Afspelen' }, icon('play'));
  const loadError = h('div', { class: 'pc-error', hidden: true });
  const controls = h('div', { class: 'pc-controls' }, track, h('div', { class: 'pc-row' }, playBtn, timeEl, h('span', { class: 'pc-spacer' }), muteBtn, fsBtn));
  const el = h('div', { class: 'player', tabindex: '-1' }, h('div', { class: 'player-stage' }, video, bigPlay, loadError), controls);

  let markers = [];
  let onMarkerClick = () => {};
  const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : knownDuration || 0);

  const setIcon = (btn, name, label) => { btn.replaceChildren(icon(name)); btn.setAttribute('aria-label', label); };
  const toggle = () => (video.paused ? video.play().catch(() => {}) : video.pause());

  function render() {
    const d = duration();
    const pct = d ? (video.currentTime / d) * 100 : 0;
    progress.style.width = `${pct}%`;
    handle.style.left = `${pct}%`;
    timeEl.textContent = `${timecode(video.currentTime)} / ${timecode(d)}`;
    track.setAttribute('aria-valuenow', String(Math.round(video.currentTime)));
    track.setAttribute('aria-valuemax', String(Math.round(d)));
    track.setAttribute('aria-valuetext', timecode(video.currentTime));
    if (video.buffered.length && d) buffered.style.width = `${(video.buffered.end(video.buffered.length - 1) / d) * 100}%`;
  }

  function renderMarkers() {
    const d = duration();
    markersEl.replaceChildren(...(d ? markers : []).map((m) => positioned(h('button', {
      type: 'button',
      class: `pc-marker${m.resolved ? ' is-resolved' : ''}${m.active ? ' is-active' : ''}`,
      title: `${timecode(m.time)} · ${m.label || ''}`,
      'aria-label': `Reactie op ${timecode(m.time)}`,
      onClick: (e) => { e.stopPropagation(); seek(m.time); onMarkerClick(m.id); },
    }), Math.min(100, (m.time / d) * 100))));
  }

  // Via CSSOM i.p.v. een style-attribuut, zodat de Content-Security-Policy strikt kan blijven.
  function positioned(node, pct) {
    node.style.left = `${pct}%`;
    return node;
  }

  function seek(t) {
    video.currentTime = Math.max(0, Math.min(duration() || t, t));
    render();
  }

  function timeFromEvent(e) {
    const rect = track.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return Math.max(0, Math.min(1, x / rect.width)) * duration();
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
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { seek(video.currentTime + 5); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { seek(video.currentTime - 5); e.preventDefault(); }
  });

  playBtn.addEventListener('click', toggle);
  bigPlay.addEventListener('click', toggle);
  video.addEventListener('click', toggle);
  video.addEventListener('play', () => { setIcon(playBtn, 'pause', 'Pauzeren'); el.classList.add('is-playing'); });
  video.addEventListener('pause', () => { setIcon(playBtn, 'play', 'Afspelen'); el.classList.remove('is-playing'); });
  video.addEventListener('timeupdate', render);
  video.addEventListener('progress', render);
  video.addEventListener('loadedmetadata', () => { render(); renderMarkers(); });
  video.addEventListener('error', () => {
    const code = video.error?.code;
    loadError.hidden = false;
    loadError.textContent = code === 2
      ? 'De video kon niet worden geladen. Controleer je verbinding en ververs de pagina.'
      : 'Deze video kan in deze browser niet worden afgespeeld. Mogelijk gebruikt het bestand een codec die browsers niet ondersteunen (zoals ProRes). Gebruik bij voorkeur H.264 in MP4.';
  });

  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    setIcon(muteBtn, video.muted ? 'muted' : 'volume', video.muted ? 'Geluid aan' : 'Geluid uit');
  });

  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) return document.exitFullscreen();
    if (el.requestFullscreen) return el.requestFullscreen().catch(() => video.webkitEnterFullscreen?.());
    if (video.webkitEnterFullscreen) return video.webkitEnterFullscreen(); // iOS Safari
  });
  document.addEventListener('fullscreenchange', () => el.classList.toggle('is-fullscreen', document.fullscreenElement === el));

  el.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === ' ' || e.key === 'k') { toggle(); e.preventDefault(); }
  });

  return {
    el,
    video,
    seek,
    pause: () => video.pause(),
    currentTime: () => video.currentTime,
    setMarkers(list) { markers = list; renderMarkers(); },
    onMarkerClick(fn) { onMarkerClick = fn; },
    destroy() { video.pause(); video.removeAttribute('src'); video.load(); },
  };
}
