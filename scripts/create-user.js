'use strict';
// Gebruik: npm run create-user -- <email> "<naam>" <wachtwoord>
const { loadConfig } = require('../server/config');
const { openDb } = require('../server/db');
const { createUser } = require('../server/auth');

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error('Gebruik: npm run create-user -- <email> "<naam>" <wachtwoord>');
  process.exit(1);
}
try {
  // Via de commandoregel aangemaakte accounts zijn beheerder (noodroute als niemand meer kan beheren).
  const config = loadConfig();
  const id = createUser(openDb(config), { email, name, password, role: 'admin' });
  console.log(`Beheerdersaccount aangemaakt (id ${id}) voor ${email} in ${config.dataDir}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
