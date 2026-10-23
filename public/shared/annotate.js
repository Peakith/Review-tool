// Tekenen op een stilstaand videobeeld: vrije pen, pijl en rechthoek, ongedaan maken en wissen.
// Coördinaten worden opgeslagen van 0 tot 1 ten opzichte van het werkelijke beeld (zonder zwarte
// randen), zodat de tekening op elke schermgrootte en in volledig scherm op dezelfde plek staat.
// Werkt met muis, pen en aanraking (pointer events). Het videobestand verandert niet.
import { h, icon } from './util.js';
import { renderShapes } from './player.js';

export const COLORS = [['#ff4d4f', 'Rood'], ['#ffd60a', 'Geel'], ['#4cc9f0', 'Blauw'], ['#ffffff', 'Wit']];
const TOOLS = [['pen', 'Pen', 'pen'], ['arrow', 'Pijl', 'arrowTool'], ['rect', 'Rechthoek', 'rect']];
const r4 = (n) => Math.round(n * 10000) / 10000;

export function createAnnotator(player, { onChange = () => {} } = {}) {
  let shapes = [];
  let tool = 'pen';
  let color = COLORS[0][0];
  let drawing = null;
  let active = false;
  const overlay = player.overlay;

  const toolButtons = TOOLS.map(([key, label, ic]) => h('button', { type: 'button', class: 'ann-btn', 'aria-pressed': 'false', title: label, 'aria-label': label, onClick: () => { tool = key; draw(); } }, icon(ic), h('span', { class: 'ann-label' }, label)));
  const colorButtons = COLORS.map(([c, label]) => {
    const b = h('button', { type: 'button', class: 'ann-color', 'aria-pressed': 'false', title: label, 'aria-label': `Kleur ${label.toLowerCase()}`, onClick: () => { color = c; draw(); } });
    b.style.setProperty('--swatch', c);
    return b;
  });
  const undoBtn = h('button', { type: 'button', class: 'ann-btn', title: 'Ongedaan maken', 'aria-label': 'Laatste vorm ongedaan maken', onClick: () => { shapes.pop(); paint(); onChange(value()); draw(); } }, icon('undo'), h('span', { class: 'ann-label' }, 'Ongedaan'));
  const clearBtn = h('button', { type: 'button', class: 'ann-btn', title: 'Alles wissen', 'aria-label': 'Tekening wissen', onClick: () => { shapes = []; paint(); onChange(value()); draw(); } }, icon('eraser'), h('span', { class: 'ann-label' }, 'Wissen'));
  const doneBtn = h('button', { type: 'button', class: 'btn btn-sm btn-secondary', onClick: () => stop() }, icon('check'), h('span', { class: 'btn-label' }, 'Klaar met tekenen'));
  const toolbar = h('div', { class: 'ann-toolbar', role: 'toolbar', 'aria-label': 'Tekenen', hidden: true },
    h('div', { class: 'ann-group' }, toolButtons), h('div', { class: 'ann-group' }, colorButtons), h('div', { class: 'ann-group' }, undoBtn, clearBtn), doneBtn,
    h('p', { class: 'ann-hint small muted' }, 'Teken op het stilstaande beeld. Je kunt ook gewoon tekst typen; een tekening is niet verplicht.'));

  function draw() {
    toolButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(TOOLS[i][0] === tool)));
    colorButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(COLORS[i][0] === color)));
    undoBtn.disabled = !shapes.length;
    clearBtn.disabled = !shapes.length;
  }

  const size = () => ({ vw: player.video.videoWidth || 1600, vh: player.video.videoHeight || 900 });
  function paint() {
    const all = drawing ? [...shapes, drawing] : shapes;
    overlay.replaceChildren(renderShapes(all, size()));
  }

  function pos(e) {
    const r = overlay.getBoundingClientRect();
    return [r4(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))), r4(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)))];
  }
  function down(e) {
    if (!active || e.button > 0) return;
    e.preventDefault();
    overlay.setPointerCapture?.(e.pointerId);
    const p = pos(e);
    drawing = tool === 'pen' ? { t: 'pen', c: color, pts: [p] } : { t: tool, c: color, a: p, b: p };
    paint();
  }
  function move(e) {
    if (!drawing) return;
    const p = pos(e);
    if (drawing.t === 'pen') {
      const last = drawing.pts.at(-1);
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.003) drawing.pts.push(p);
    } else drawing.b = p;
    paint();
  }
  function up() {
    if (!drawing) return;
    const d = drawing;
    drawing = null;
    // Een losse tik (zonder beweging) is geen vorm.
    const big = d.t === 'pen' ? d.pts.length > 1 : Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) > 0.01;
    if (big) shapes.push(d);
    paint();
    onChange(value());
    draw();
  }
  overlay.addEventListener('pointerdown', down);
  overlay.addEventListener('pointermove', move);
  overlay.addEventListener('pointerup', up);
  overlay.addEventListener('pointercancel', up);
  // Tijdens het tekenen blijft het beeld stilstaan.
  const holdStill = () => { if (active) player.pause(); };
  player.video.addEventListener('play', holdStill);
  const unlayout = player.onLayout(() => { if (active || shapes.length) paint(); });

  function start() {
    active = true;
    player.pause();
    overlay.dataset.editing = '1';
    overlay.classList.add('is-editing');
    overlay.hidden = false;
    player.layoutOverlay();
    toolbar.hidden = false;
    paint();
    draw();
    onChange(value());
  }
  function stop() {
    active = false;
    delete overlay.dataset.editing;
    overlay.classList.remove('is-editing');
    toolbar.hidden = true;
    if (shapes.length) paint(); else { overlay.hidden = true; overlay.replaceChildren(); }
    onChange(value());
  }
  function reset() {
    shapes = [];
    drawing = null;
    if (active) stop();
    overlay.hidden = true;
    overlay.replaceChildren();
    onChange(null);
  }
  function value() { return shapes.length ? { v: 1, shapes: shapes.map((s) => ({ ...s })) } : null; }

  return {
    toolbar,
    start,
    stop,
    reset,
    value,
    isActive: () => active,
    destroy() { player.video.removeEventListener('play', holdStill); unlayout(); },
  };
}
