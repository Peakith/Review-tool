'use strict';
// Stopt de Studio Review van DEZE installatie (Stop Studio Review.command of npm run stop).
// Stopt alleen een proces dat zich aantoonbaar als deze installatie meldt (zelfde
// installatie-ID en proces-ID); nooit een willekeurig proces op de poort.
const { loadConfig } = require('../server/config');
const { readLock } = require('../server/lock');

async function health(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const data = await res.json();
    return data?.app === 'studio-review' ? data : null;
  } catch { return null; }
}

(async () => {
  const config = loadConfig();
  const lock = readLock(config.dataDir);
  const port = lock?.port || config.port;
  const h = await health(port);
  const pid = lock?.pid || h?.pid;
  if (!h || !pid) {
    console.log('Studio Review (deze installatie) draait niet. Er is niets gestopt.');
    process.exit(0);
  }
  if (h.instanceId !== config.instanceId || h.pid !== pid) {
    console.log(`Op poort ${port} draait een andere Studio Review-installatie${h.appDir ? ` (${h.appDir})` : ''}. Die wordt niet gestopt.`);
    console.log('Gebruik de Stop-knop in de map van die installatie.');
    process.exit(2);
  }
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (!(await health(port))) {
      console.log('✓ Studio Review is gestopt. Je gegevens zijn bewaard.');
      process.exit(0);
    }
  }
  console.log('Studio Review reageert nog. Sluit het startvenster (Terminal) om de app te stoppen.');
  process.exit(1);
})();
