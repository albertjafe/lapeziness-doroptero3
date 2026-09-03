import fs from 'node:fs';
import { test, expect } from 'vitest';

const source = fs.readFileSync(new URL('../../pase-liquid-direct-touch.js', import.meta.url), 'utf8');

test('liquid pill commits the final pointerup position and guards against Safari snapback', () => {
  expect(source).toMatch(/event\.type === 'pointerup'/);
  expect(source).toMatch(/const finalValue = updateFromPointer/);
  expect(source).toMatch(/setTimeout\(lockFinalValue, 40\)/);
  expect(source).toMatch(/touch-action: none/);
});
