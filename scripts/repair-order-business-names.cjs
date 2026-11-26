/* eslint-disable @typescript-eslint/no-require-imports -- Local operator CLI, not an application endpoint. */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const modules = new Map();
const allowed = new Set(['order-business-name-repair', 'customer-business-label', 'order-name-kernel', 'order-alias']);
function load(name) {
  if (!allowed.has(name)) throw new Error(`Unexpected repair dependency: ${name}`);
  if (modules.has(name)) return modules.get(name).exports;
  const file = path.join(root, 'src/lib', `${name}.ts`);
  const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths; modules.set(name, mod);
  const original = mod.require.bind(mod);
  mod.require = id => id.startsWith('@/lib/') ? load(id.slice(6)) : id.startsWith('./') ? load(id.slice(2)) : original(id);
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file);
  return mod.exports;
}
module.exports = { load };

async function main() {
  const args = process.argv.slice(2);
  const get = key => { const index = args.indexOf(key); return index < 0 ? null : args[index + 1]; };
  const mode = args[0];
  if (!['preview', 'apply', 'rollback'].includes(mode)) throw new Error('Specify preview, apply or rollback');
  const url = new URL(process.env.DATABASE_URL);
  if (!get('--host') || !get('--database') || url.hostname !== get('--host') || url.pathname !== `/${get('--database')}`) throw new Error('Explicit database target does not match');
  if (mode !== 'preview' && !['127.0.0.1', 'localhost'].includes(url.hostname) && !args.includes('--allow-production')) throw new Error('Production mutation requires an explicitly approved release and --allow-production');
  url.searchParams.set('connection_limit', '1');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  const api = load('order-business-name-repair');
  const write = (file, value) => {
    if (!file) throw new Error('Output/backup path is required');
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  };
  try {
    if (mode === 'preview') {
      const plan = await api.previewOrderBusinessNames(db);
      write(get('--output'), plan);
      console.log(JSON.stringify({ planHash: api.repairHash(plan), counts: plan.rows.reduce((counts, row) => ({ ...counts, [row.decision]: (counts[row.decision] || 0) + 1 }), {}) }));
    } else {
      if (!get('--plan') || !get('--sha') || !get('--actor') || !get('--backup')) throw new Error('Plan, approved hash, actor and new backup file are required');
      const plan = JSON.parse(fs.readFileSync(get('--plan'), 'utf8'));
      console.log(JSON.stringify(await api.applyOrderBusinessNames(db, plan, { expectedHash: get('--sha'), actorId: get('--actor'),
        rollback: mode === 'rollback', backup: async before => write(get('--backup'), before) })));
    }
  } finally { await db.$disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(error.message.replace(/mysql:\/\/\S+/g, '[redacted]')); process.exitCode = 1; });
