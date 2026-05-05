import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ApiTestContext } from '../tests/api/isolated/helpers/context.mjs';

function getCaseFilter(argv) {
  const equalArg = argv.find((arg) => arg.startsWith('--case='));
  if (equalArg) return equalArg.slice('--case='.length).trim();
  const index = argv.indexOf('--case');
  if (index >= 0) return String(argv[index + 1] || '').trim();
  return '';
}

const caseFilter = getCaseFilter(process.argv.slice(2));
const caseDir = path.resolve('tests/api/isolated/cases');
const allCaseFiles = readdirSync(caseDir)
  .filter((file) => file.endsWith('.case.mjs'))
  .sort();
const caseFiles = caseFilter
  ? allCaseFiles.filter((file) => file.includes(caseFilter))
  : allCaseFiles;

if (caseFiles.length === 0) {
  throw new Error(caseFilter
    ? `No isolated API case files found for --case ${caseFilter}`
    : 'No isolated API case files found');
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
    await context.resetRateLimits();
    await run(context);
  }
  console.log(`\nIsolated API cases completed: ${caseFiles.length}`);
} finally {
  context.destroy();
}
