const { test, expect } = require('@playwright/test');

test('renders reduced daily activity context and opens the timeline', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/tests/fixtures/activity-dashboard.html', { waitUntil: 'domcontentloaded' });

  const card = page.locator('#activityDailyCard');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Actividad digital · contexto del día');
  await expect(card).toContainText('2 min');
  await expect(card).toContainText('Productivo');
  await expect(card).toContainText('Entretenimiento');
  await expect(card).toContainText('1');

  await card.getByRole('button', { name: 'Ver línea temporal' }).click();
  const modal = page.locator('#activityTimelineModal');
  await expect(modal).toHaveClass(/open/);
  await expect(modal.locator('.activity-timeline-row')).toHaveCount(2);
  await expect(modal).toContainText('youtube.com');

  const context = await page.evaluate(() => window.ActivityTracker.reportContext('2026-09-01'));
  expect(context.trackedSeconds).toBe(120);
  expect(context.switches).toBe(1);
  expect(context.categories.productive).toBe(60);
  expect(context.categories.entertainment).toBe(60);
});
