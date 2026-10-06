// Execute the real scheduler against the disposable API-test database, never a provider.
/* eslint-disable @typescript-eslint/no-require-imports -- Source transpilation for isolated CommonJS test processes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '3307');
assert.equal(database.pathname, '/trading_ledger_test');
assert.equal(process.env.WHATSAPP_OUTBOUND_ENABLED, 'false');
process.env.YCLOUD_SENDER_PHONE = '+8613819858718';
const resolve = Module._resolveFilename;
Module._resolveFilename = function(specifier, ...args) {
  return resolve.call(this, specifier.startsWith('@/') ? path.resolve('src', specifier.slice(2)) : specifier, ...args);
};
require.extensions['.ts'] = (module, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(compiled.outputText, filename);
};
const { db } = require('../../../../src/lib/db.ts');
const { projectOutstandingReminders } = require('../../../../src/lib/whatsapp/outstanding-reminders.ts');
const now = new Date();
now.setUTCHours(7, 0, 0, 0);
projectOutstandingReminders(now).catch(error => {
  console.error(error.code || error.message);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
