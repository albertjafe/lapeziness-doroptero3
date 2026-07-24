import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const nativeRoot = resolve(here, '..');
const sourceRoot = resolve(nativeRoot, '..');
const targetRoot = join(nativeRoot, 'www');

const assets = [
  'app.js',
  'data-core.js',
  'icon-192.png',
  'icon-512.png',
  'index.html',
  'manifest.json',
  'push-client.js',
  'styles.css',
  'sync-core.js',
  'timer-core.js',
];

await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true });

for (const asset of assets) {
  await cp(join(sourceRoot, asset), join(targetRoot, asset));
}

await cp(
  join(nativeRoot, 'web', 'native-live-activity.js'),
  join(targetRoot, 'native-live-activity.js'),
);

const nativeMarker = '<script>window.__ESTUDIO_NATIVE__ = true;</script>';
const bridgeScript = '<script src="native-live-activity.js"></script>';
let html = await readFile(join(targetRoot, 'index.html'), 'utf8');
html = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n' + nativeMarker);
html = html.replace('<script src="app.js?v=167"></script>', '<script src="app.js?v=167"></script>\n' + bridgeScript);
html = html.replaceAll(
  "if ('serviceWorker' in navigator)",
  "if (!window.__ESTUDIO_NATIVE__ && 'serviceWorker' in navigator)",
);
await writeFile(join(targetRoot, 'index.html'), html);

let app = await readFile(join(targetRoot, 'app.js'), 'utf8');
app = app.replaceAll(
  "if ('serviceWorker' in navigator)",
  "if (!window.__ESTUDIO_NATIVE__ && 'serviceWorker' in navigator)",
);
await writeFile(join(targetRoot, 'app.js'), app);

console.log(`Copia nativa preparada en ${targetRoot}`);
