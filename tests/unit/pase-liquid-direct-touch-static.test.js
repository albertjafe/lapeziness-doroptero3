import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../../pase-liquid-direct-touch.js', import.meta.url), 'utf8');

test('liquid pill commits the final pointerup position and guards against Safari snapback', () => {
  assert.match(source, /event\.type === 'pointerup'/);
  assert.match(source, /const finalValue = updateFromPointer/);
  assert.match(source, /setTimeout\(lockFinalValue, 40\)/);
  assert.match(source, /touch-action: none/);
});
