import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('creates an isolated native web copy with the bridge installed', async () => {
  await execFileAsync(process.execPath, [join(nativeRoot, 'scripts', 'sync-web.mjs')]);

  const html = await readFile(join(nativeRoot, 'www', 'index.html'), 'utf8');
  const app = await readFile(join(nativeRoot, 'www', 'app.js'), 'utf8');
  const bridge = await readFile(join(nativeRoot, 'www', 'native-live-activity.js'), 'utf8');

  assert.match(html, /window\.__ESTUDIO_NATIVE__ = true/);
  assert.match(html, /native-live-activity\.js/);
  assert.match(html, /!window\.__ESTUDIO_NATIVE__/);
  assert.match(app, /!window\.__ESTUDIO_NATIVE__/);
  assert.match(bridge, /StudyLiveActivity/);
});

