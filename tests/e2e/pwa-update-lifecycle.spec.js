import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';

// Real browser lifecycle: VM mocks cannot reproduce activate -> navigate ->
// fetch dependencies. All documents are synthetic, with no cloud connection.
test.use({ serviceWorkers: 'allow' });
test('explicit promotion finishes activation and serves the new shell without a reload loop', async ({ page }) => {
  test.setTimeout(45000);
  const sw = fs.readFileSync('sw.js', 'utf8');
  const safety = fs.readFileSync('update-safety.js', 'utf8');
  let version = '900';
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (pathname === '/sw.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(sw.replace(/estudio-v\d+/, 'estudio-v' + version));
    } else if (pathname === '/update-safety.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(safety);
    } else if (pathname === '/' || pathname === '/index.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><body><div id="version">${version}</div>
        <div id="swUpdateBanner"><button onclick="swDoUpdate()">Actualizar</button></div>
        <script>
          var db = JSON.parse(localStorage.getItem('alberto_piano_v2') || '{"sesiones":[{"id":"recent","mins":40}]}');
          localStorage.setItem('alberto_piano_v2', JSON.stringify(db));
          window.swDoUpdate = function(){};
          window.showToast = function(message){ console.log(message); };
        </script><script src="/update-safety.js?v=348"></script>
        <script>navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'});</script>`);
    } else {
      res.setHeader('Content-Type', 'text/javascript');
      res.end('/* synthetic precache asset */');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.goto(origin);
    await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
    const before = await page.evaluate(() => localStorage.getItem('alberto_piano_v2'));
    version = '901';
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    await page.getByRole('button', { name: 'Actualizar' }).click();
    await expect(page.locator('#version')).toHaveText('901', { timeout: 15000 });
    await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
    expect(await page.evaluate(() => localStorage.getItem('alberto_piano_v2'))).toBe(before);
    await page.reload();
    await expect(page.locator('#version')).toHaveText('901');
    expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting)).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
