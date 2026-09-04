import fs from 'node:fs';
import { test, expect } from 'vitest';

const source = fs.readFileSync(new URL('../../pase-liquid-direct-touch.js', import.meta.url), 'utf8');

test('liquid pill commits last stable drag value without pointerup snapback', () => {
  expect(source).toMatch(/let committed = active\.lastValue/);
  expect(source).not.toMatch(/event\.type === ['"]pointerup['"]/);
  expect(source).not.toMatch(/const finalValue = updateFromPointer/);
  expect(source).toMatch(/pointer-events: none/);
  expect(source).toMatch(/requestAnimationFrame/);
  expect(source).toMatch(/setTimeout\(lock, 160\)/);
  expect(source).toMatch(/touch-action: none/);
});
