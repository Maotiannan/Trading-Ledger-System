import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ApiTestContext } from '../tests/api/isolated/helpers/context.mjs';

const caseDir = path.resolve('tests/api/isolated/cases');
const caseFiles = readdirSync(caseDir)
  .filter((file) => file.endsWith('.case.mjs'))
  .sort();

if (caseFiles.length === 0) {
  throw new Error('No isolated API case files found');
}

const context = new ApiTestContext();

try {
  for (const file of caseFiles) {
    const mod = await import(pathToFileURL(path.join(caseDir, file)).href);
    const caseName = mod.name || file;
    const run = mod.default;
    if (typeof run !== 'function') {
      throw new TypeError(`Case ${file} does not export a default async function`);
    }
    context.setCase(caseName);
    await run(context);
  }
  console.log(`\nIsolated API cases completed: ${caseFiles.length}`);
} finally {
  context.destroy();
}
