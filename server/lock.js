'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Eén draaiende server per gegevensmap. Het lockbestand vertelt de startknop en de
// beheercommando's (back-up terugzetten, verhuizen) of en waar de app al draait.
const lockFile = (dataDir) => path.join(dataDir, '.studio-review.lock');

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/** Leest het lockbestand; een achtergebleven bestand van een gestopt proces telt niet. */
function readLock(dataDir) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile(dataDir), 'utf8'));
    return lock.pid && isAlive(lock.pid) ? lock : null;
  } catch { return null; }
}

function writeLock(dataDir, info) {
  fs.writeFileSync(lockFile(dataDir), JSON.stringify({ ...info, pid: process.pid, startedAt: new Date().toISOString() }, null, 2));
}

function removeLock(dataDir) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile(dataDir), 'utf8'));
    if (lock.pid === process.pid) fs.rmSync(lockFile(dataDir));
  } catch { /* al weg */ }
}

/** Gooit een duidelijke fout als een server met deze gegevens draait. */
function assertNotRunning(dataDir, action) {
  const lock = readLock(dataDir);
  if (lock) {
    throw new Error(`Studio Review draait nog met deze gegevens (proces ${lock.pid}, poort ${lock.port}). Stop de app eerst (Stop Studio Review.command of Ctrl+C in het startvenster) en ${action} daarna opnieuw.`);
  }
}

module.exports = { readLock, writeLock, removeLock, assertNotRunning, lockFile, isAlive };
