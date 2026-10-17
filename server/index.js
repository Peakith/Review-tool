'use strict';
const { createApp } = require('./app');
const { hasFfmpeg } = require('./media');

const { app, config } = createApp();

app.listen(config.port, async () => {
  console.log(`Review-tool draait op http://localhost:${config.port}`);
  console.log(`Gegevens en bestanden: ${config.dataDir}`);
  if (!(await hasFfmpeg())) {
    console.warn('Let op: ffmpeg/ffprobe niet gevonden. Uploads worden niet gecontroleerd en krijgen geen voorvertoning.');
  }
});
