'use strict';
// Klantpagina's in het Nederlands en Engels: elke vertaalbare tekst op de klantpagina's en in de
// gedeelde onderdelen heeft een Engelse vertaling, met dezelfde {plaatshouders}.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..', 'public');
const src = fs.readFileSync(path.join(root, 'shared', 'i18n.js'), 'utf8');
// eslint-disable-next-line no-new-func
const EN = new Function(`${src.slice(src.indexOf('export const EN = ')).replace('export const EN = ', 'return ')}`)();

function keysIn(file) {
  const text = fs.readFileSync(file, 'utf8');
  const keys = new Set();
  for (const m of text.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
  for (const m of text.matchAll(/\btr\([^()]*?\?\s*'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g)) { keys.add(m[1]); keys.add(m[2]); }
  return keys;
}
const files = [
  ...fs.readdirSync(path.join(root, 'review')).filter((f) => f.endsWith('.js')).map((f) => path.join(root, 'review', f)),
  ...['util.js', 'client.js', 'comments.js', 'composer.js', 'player.js', 'compare.js', 'annotate.js'].map((f) => path.join(root, 'shared', f)),
];
// Teksten die via een variabele door tr() gaan (statussen, soorten, groepen, tekenhulpmiddelen).
const DYNAMIC = ['Hoofdvideo', 'Teaser', 'Cutdown', 'Social', 'Overig', 'Klaar voor jouw review', 'Wacht op jou', 'Feedback verstuurd', 'Team past aan', 'Goedgekeurd',
  'Tijdelijk gesloten', 'Gesloten', 'klaar voor review', 'feedback verstuurd', 'goedgekeurd', 'gesloten', 'Rood', 'Geel', 'Blauw', 'Wit', 'Pen', 'Pijl', 'Rechthoek',
  'Wacht op jouw review', 'Bekijk deze video’s, plaats je opmerkingen en verstuur je feedback.', 'Het team verwerkt je feedback. Je ziet hier de nieuwe versie zodra die klaarstaat.',
  'Afgerond of tijdelijk gesloten', 'Nog te bekijken, maar reageren is hier nu niet mogelijk.', 'Licht', 'Donker', 'Systeem'];

test('elke tekst op de klantpagina’s heeft een Engelse vertaling', () => {
  const missing = [];
  for (const f of files) for (const k of keysIn(f)) if (!(k in EN)) missing.push(`${path.basename(f)}: ${k}`);
  for (const k of DYNAMIC) if (!(k in EN)) missing.push(`dynamisch: ${k}`);
  assert.deepEqual(missing, []);
});

test('vertalingen behouden de plaatshouders', () => {
  const wrong = Object.entries(EN).filter(([nl, en]) => {
    const a = (nl.match(/\{\w+\}/g) || []).sort().join();
    const b = (en.match(/\{\w+\}/g) || []).sort().join();
    return a !== b;
  });
  assert.deepEqual(wrong, []);
});
