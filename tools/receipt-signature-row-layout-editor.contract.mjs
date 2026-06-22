import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dirname, 'receipt-signature-row-layout-editor.html');
const html = readFileSync(htmlPath, 'utf8');

const requiredSnippets = [
  'id="receipt-stage"',
  'id="config-output"',
  'id="copy-config"',
  'id="download-config"',
  'data-layer="receiverLabel"',
  'data-layer="receiverName"',
  'data-layer="receiverSignatureLabel"',
  'data-layer="receiverSignature"',
  'data-layer="receiverLine"',
  'data-layer="payerSignatureLabel"',
  'data-layer="payerSignature"',
  'data-layer="payerLine"',
  'function exportConfig',
  'function applyConfig',
  'function selectLayer',
  'function updateLayerFromInputs',
  'RECEIPT_SIGNATURE_ROW_LAYOUT',
];

for (const snippet of requiredSnippets) {
  assert.ok(html.includes(snippet), `missing required snippet: ${snippet}`);
}

const configMatch = html.match(/const DEFAULT_CONFIG = (\{[\s\S]*?\n\s*\});/);
assert.ok(configMatch, 'DEFAULT_CONFIG object must be present');

const layerNames = [...html.matchAll(/data-layer="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(layerNames.sort(), [
  'payerLine',
  'payerSignature',
  'payerSignatureLabel',
  'receiverLabel',
  'receiverLine',
  'receiverName',
  'receiverSignature',
  'receiverSignatureLabel',
].sort());

console.log('receipt signature row layout editor contract passed');
