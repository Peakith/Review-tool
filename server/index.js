'use strict';
const { loadConfig } = require('./config');
const { readLock, writeLock, removeLock } = require('./lock');

// Draait er al een server met dezelfde gegevens? Dan niet nog een starten (dat zou de
// database door twee processen laten gebruiken).
const preConfig = loadConfig();
const running = readLock(preConfig.dataDir);
if (running && running.pid !== process.pid) {
  console.error(`Studio Review draait al met deze gegevens (proces ${running.pid}) op http://localhost:${running.port}.`);
  console.error('Open dat adres in je browser, of stop die versie eerst (Ctrl+C in het andere venster of "Stop Studio Review.command").');
  process.exit(3);
}

const { createApp } = require('./app');
const { backfillPosters } = require('./maintenance');
const { versionInfo } = require('./build');

const { app, db, config, storage, setupToken, needsSetup, runCleanup, mediaCheck, stop } = createApp();

const server = app.listen(config.port, async () => {
  writeLock(config.dataDir, { port: config.port, instanceId: config.instanceId, appDir: config.appDir });
  console.log(`Studio Review ${versionInfo().label} draait op http://localhost:${config.port}`);
  console.log(`Programma:  ${config.appDir}`);
  console.log(`Gegevens:   ${config.dataDir}${config.dataSource === 'DATA_DIR' ? ' (uit DATA_DIR)' : ''}`);
  console.log(`Video's:    ${config.mediaDir}`);
  console.log(`Back-ups:   ${config.backupDir}`);

  if (config.dataSource === 'programmamap') {
    console.warn('');
    console.warn('!! Je gegevens staan nog in de programmamap. Bij een update met een nieuwe ZIP blijven ze daar achter.');
    console.warn('!! Verhuis ze eenmalig naar een vaste map: stop de app en voer uit:  npm run verhuis');
    console.warn('');
  }
  const st = storage.status();
  if (!st.ok) console.error(`!! Opslag niet bereikbaar: ${st.reason}`);

  const media = await mediaCheck();
  console.log(`ffprobe: ${media.paths.ffprobe || 'niet gevonden'} · ffmpeg: ${media.paths.ffmpeg || 'niet gevonden'}`);
  if (!media.ffprobe) {
    console.error('');
    console.error('!! ffprobe NIET GEVONDEN (onderdeel van ffmpeg).');
    console.error(media.unverifiedAllowed
      ? '!! ALLOW_UNVERIFIED_UPLOADS=true: uploads worden ZONDER inhoudscontrole geaccepteerd. Nooit gebruiken in productie.'
      : '!! Uploaden is uitgeschakeld. Installeer ffmpeg (macOS: "brew install ffmpeg", Linux: "apt install ffmpeg")\n!! of zet FFPROBE_PATH in het bestand .env (zie README).');
    console.error('');
  } else if (!media.ffmpeg) {
    console.warn('Let op: ffmpeg niet gevonden. Uploads worden wel gecontroleerd, maar krijgen geen voorvertoning.');
  }

  if (needsSetup()) {
    const base = config.publicUrl || `http://localhost:${config.port}`;
    console.log('');
    console.log('Nog geen accounts. Maak het eerste teamaccount aan met deze installatiecode:');
    console.log(`  ${setupToken}`);
    console.log(`  of open direct: ${base}/?setup=${encodeURIComponent(setupToken)}`);
    console.log(config.setupToken ? '  (code komt uit SETUP_TOKEN)' : '  (code is willekeurig en verandert bij elke herstart)');
    console.log('');
  }
  console.log('Stoppen: druk op Ctrl+C in dit venster (of dubbelklik "Stop Studio Review.command").');

  runCleanup();
  backfillPosters(db, config, storage).then((r) => {
    if (r.created) console.log(`Thumbnails: ${r.created} ontbrekende voorvertoning(en) aangemaakt`);
  }).catch((err) => console.error('Thumbnails aanmaken mislukt:', err));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Poort ${config.port} is al in gebruik door een ander programma of een andere Studio Review-installatie.`);
    console.error(`Kies een andere poort, bijvoorbeeld door PORT=${config.port + 1} te zetten in ${config.settingsFile}, en start opnieuw.`);
    console.error('Er is niets gestopt of gewijzigd.');
    process.exit(4);
  }
  throw err;
});

// Netjes afsluiten: lopende verzoeken afronden, database sluiten, lockbestand opruimen.
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\nStudio Review stopt (${signal})…`);
  stop();
  server.close(() => {
    try { db.close(); } catch { /* al gesloten */ }
    removeLock(config.dataDir);
    console.log('Gestopt. Je gegevens zijn bewaard.');
    process.exit(0);
  });
  // Open videoverbindingen niet laten wachten.
  setTimeout(() => { server.closeAllConnections?.(); }, 1500).unref();
  setTimeout(() => { removeLock(config.dataDir); process.exit(0); }, 5000).unref();
}
process.on('SIGINT', () => shutdown('Ctrl+C'));
process.on('SIGTERM', () => shutdown('stopverzoek'));
process.on('SIGHUP', () => shutdown('venster gesloten'));
process.on('exit', () => removeLock(config.dataDir));
