'use strict';
const readline = require('node:readline/promises');
const sqlite = require('node:sqlite');

const gb = (n) => (n === null || n === undefined ? 'onbekend' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

/** Vraag in de terminal. Met --ja (of NON_INTERACTIVE=1) wordt automatisch "ja" geantwoord. */
async function ask(question) {
  if (process.argv.includes('--ja') || process.env.NON_INTERACTIVE === '1') return 'j';
  if (!process.stdin.isTTY) return '';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}
const yes = (answer) => /^(j|ja|y|yes)$/i.test(answer);

/** Alleen-lezen verbinding (voor kopieën; wijzigt niets aan de bron). */
const openReadOnly = (file) => new sqlite.DatabaseSync(file, { readOnly: true });

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
const positional = () => process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && ['--van', '--naar'].includes(all[i - 1])));

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

module.exports = { gb, ask, yes, openReadOnly, argValue, positional, fail };
