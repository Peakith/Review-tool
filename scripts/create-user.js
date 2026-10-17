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
  const id = createUser(openDb(loadConfig()), { email, name, password });
  console.log(`Account aangemaakt (id ${id}) voor ${email}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
