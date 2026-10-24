'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

let cache = { signature: null, build: null };

/**
 * Build-code op basis van de inhoud van de interfacebestanden. Werkt dus ook in een
 * ZIP-installatie zonder .git-map, en verandert zodra een bestand in public/ verandert.
 * Om niet bij elk verzoek alles te lezen, wordt eerst een snelle handtekening
 * (pad, grootte, wijzigingstijd) vergeleken; alleen bij verschil wordt opnieuw gehasht.
 */
function build() {
  const files = walk(PUBLIC_DIR).sort();
  const stats = files.map((f) => { const s = fs.statSync(f); return `${path.relative(PUBLIC_DIR, f)}:${s.size}:${s.mtimeMs}`; });
  const signature = stats.join('|');
  if (signature !== cache.signature) {
    const hash = crypto.createHash('sha256').update(VERSION);
    for (const f of files) hash.update(path.relative(PUBLIC_DIR, f)).update(fs.readFileSync(f));
    cache = { signature, build: hash.digest('hex').slice(0, 8) };
  }
  return cache.build;
}

const versionInfo = () => ({ version: VERSION, build: build(), label: `${VERSION} (build ${build()})` });

module.exports = { VERSION, build, versionInfo, PUBLIC_DIR };
