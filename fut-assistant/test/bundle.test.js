import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '../scripts/build-extension.js';

test('extension/solver-bundle.js matches src/ (run `npm run build` if this fails)', () => {
  const current = readFileSync(fileURLToPath(new URL('../extension/solver-bundle.js', import.meta.url)), 'utf8');
  assert.equal(current, buildBundle());
});
