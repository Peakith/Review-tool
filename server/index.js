'use strict';
const { createApp } = require('./app');

const { app, config, setupToken, needsSetup, runCleanup, mediaCheck } = createApp();

app.listen(config.port, async () => {
  console.log(`Review-tool draait op http://localhost:${config.port}`);
  console.log(`Gegevens en bestanden: ${config.dataDir}`);

  const media = await mediaCheck();
  if (!media.ffprobe) {
    console.error('');
    console.error('!! ffprobe NIET GEVONDEN (onderdeel van ffmpeg).');
    console.error(media.unverifiedAllowed
      ? '!! ALLOW_UNVERIFIED_UPLOADS=true: uploads worden ZONDER inhoudscontrole geaccepteerd. Nooit gebruiken in productie.'
      : '!! Uploaden is uitgeschakeld tot ffmpeg is geïnstalleerd (bijv. "apt install ffmpeg") of FFPROBE_PATH is ingesteld.');
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

  runCleanup();
});
