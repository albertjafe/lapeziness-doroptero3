const { test, expect } = require('@playwright/test');

test('shows the supported Live Activity and the iPad overlay limitation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/native-ipad/preview.html');

  await expect(page.getByRole('heading', { name: 'Estudio Live para iPad' })).toBeVisible();
  await expect(page.locator('.activity')).toBeVisible();
  await expect(page.locator('#extend')).toBeVisible();
  await expect(page.locator('#finish')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('live-activity-lock-screen.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Partitura abierta' }).click();
  await expect(page.locator('#scoreScreen')).toBeVisible();
  await expect(page.locator('.score-limit')).toContainText('no permite');
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('live-activity-score-limit.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.getByRole('button', { name: 'Pantalla bloqueada' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator('.activity')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('live-activity-portrait.png'),
    fullPage: true,
  });
});
