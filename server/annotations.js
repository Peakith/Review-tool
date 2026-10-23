'use strict';
const { HttpError } = require('./status');

/**
 * Tijdsbereiken en annotaties bij reacties, gecontroleerd op de server.
 *
 * Annotatie: { v: 1, shapes: [...] } met coördinaten van 0 tot 1, relatief aan het werkelijke
 * videobeeld (zonder zwarte randen). Daardoor staat een tekening op elke schermgrootte, in
 * volledig scherm en bij verticale video's op dezelfde plek. Het videobestand verandert niet.
 *   pen:   { t: 'pen',   c, pts: [[x, y], …] }
 *   arrow: { t: 'arrow', c, a: [x, y], b: [x, y] }   (punt bij b)
 *   rect:  { t: 'rect',  c, a: [x, y], b: [x, y] }
 */
const COLORS = ['#ff4d4f', '#ffd60a', '#4cc9f0', '#ffffff'];
const MAX_SHAPES = 40;
const MAX_POINTS = 6000;
const MIN_RANGE = 0.2;

const round4 = (n) => Math.round(n * 10000) / 10000;

function point(p) {
  if (!Array.isArray(p) || p.length !== 2) throw new HttpError(400, 'Ongeldige tekening (punt).');
  const [x, y] = p.map(Number);
  // Een klein beetje buiten het beeld (bijv. een pijl tot de rand) wordt afgerond naar de rand.
  if (![x, y].every((v) => Number.isFinite(v) && v >= -0.02 && v <= 1.02)) throw new HttpError(400, 'Ongeldige tekening: een punt ligt buiten het beeld.');
  return [round4(Math.min(1, Math.max(0, x))), round4(Math.min(1, Math.max(0, y)))];
}

/** Controleert en normaliseert een annotatie; geeft een JSON-tekst of null. */
function cleanAnnotation(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  let a = raw;
  if (typeof a === 'string') {
    if (a.length > 200_000) throw new HttpError(413, 'De tekening is te groot.');
    try { a = JSON.parse(a); } catch { throw new HttpError(400, 'Ongeldige tekening.'); }
  }
  if (!a || typeof a !== 'object' || !Array.isArray(a.shapes)) throw new HttpError(400, 'Ongeldige tekening.');
  if (!a.shapes.length) return null;
  if (a.shapes.length > MAX_SHAPES) throw new HttpError(400, `Een tekening mag hooguit ${MAX_SHAPES} vormen hebben.`);
  let points = 0;
  const shapes = a.shapes.map((s) => {
    const c = COLORS.includes(s?.c) ? s.c : COLORS[0];
    if (s?.t === 'pen') {
      if (!Array.isArray(s.pts) || s.pts.length < 2) throw new HttpError(400, 'Ongeldige tekening (pen).');
      points += s.pts.length;
      return { t: 'pen', c, pts: s.pts.map(point) };
    }
    if (s?.t === 'arrow' || s?.t === 'rect') return { t: s.t, c, a: point(s.a), b: point(s.b) };
    throw new HttpError(400, 'Ongeldige tekening: onbekende vorm.');
  });
  if (points > MAX_POINTS) throw new HttpError(400, 'De tekening is te gedetailleerd. Teken met minder lijnen.');
  return JSON.stringify({ v: 1, shapes });
}

/**
 * Tijdstip en optioneel eindtijd. Grenzen: 0 ≤ begin < eind ≤ duur, en het bereik is minstens
 * 0,2 seconde. Geeft { timecode, timecodeEnd }.
 */
function cleanTimes({ timecode, timecodeEnd }, duration) {
  const has = (v) => v !== undefined && v !== null && v !== '';
  const max = Number.isFinite(duration) && duration > 0 ? duration : null;
  let start = null;
  if (has(timecode)) {
    start = Number(timecode);
    if (!Number.isFinite(start) || start < 0) throw new HttpError(400, 'Ongeldig tijdstip.');
    if (max !== null && start > max + 0.5) throw new HttpError(400, 'Het tijdstip ligt na het einde van de video.');
    if (max !== null) start = Math.min(start, max);
  }
  if (!has(timecodeEnd)) return { timecode: start, timecodeEnd: null };
  if (start === null) throw new HttpError(400, 'Een tijdsbereik heeft een begintijd nodig.');
  let end = Number(timecodeEnd);
  if (!Number.isFinite(end)) throw new HttpError(400, 'Ongeldige eindtijd.');
  if (max !== null && end > max + 0.5) throw new HttpError(400, 'De eindtijd ligt na het einde van de video.');
  if (max !== null) end = Math.min(end, max);
  if (end <= start) throw new HttpError(400, 'De eindtijd moet na de begintijd liggen.');
  if (end - start < MIN_RANGE) throw new HttpError(400, 'Het tijdsbereik is te kort (minimaal 0,2 seconde).');
  return { timecode: start, timecodeEnd: end };
}

module.exports = { cleanAnnotation, cleanTimes, COLORS };
