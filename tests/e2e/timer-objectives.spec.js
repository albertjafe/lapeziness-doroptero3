import { test, expect } from '@playwright/test';

test.describe('Stopwatch Visual Tab Selector (Calendario / Objetivos)', () => {
  test.beforeEach(async ({ page }) => {
    // Populate localStorage with a mocked active habit challenge and mock auth before loading
    await page.addInitScript(() => {
      const mockDb = {
        obras: [
          { id: 'o1', nombre: 'Claro de Luna', compositor: 'Beethoven', dificultad: 5, duracion: 6, solidez: 40, solHistory: [] }
        ],
        eventos: [],
        sesiones: [],
        registro: [],
        habitChallenge: {
          id: 'habit_123456789',
          title: 'Estudiar Piano Diario',
          mode: 'do',
          durationDays: 30,
          startDate: new Date().toISOString().split('T')[0],
          logs: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
      localStorage.setItem('alberto_piano_v2', JSON.stringify(mockDb));
      localStorage.setItem('piano_auth_v1', JSON.stringify({ access_token: 'mock', user: { email: 'test@example.com' } }));
    });

    // Navigate to the app
    await page.goto('/');

    // Wait for the loading screen to disappear and the main layout to appear
    await page.waitForSelector('button[data-view="cronometro"]', { state: 'visible' });
  });

  test('should show tab selector, switch between Calendar and Objectives, and preserve choices', async ({ page }) => {
    // Navigate to the stopwatch view
    await page.click('button[data-view="cronometro"]');

    // Wait for stopwatch view to enter
    await page.waitForSelector('.crono-calendar-panel', { state: 'visible' });

    // Verify that the tab selector buttons exist
    const tabCalendar = page.locator('#cronoTabCalendar');
    const tabObjectives = page.locator('#cronoTabObjectives');
    await expect(tabCalendar).toBeVisible();
    await expect(tabObjectives).toBeVisible();

    // Default tab should be Calendar
    await expect(tabCalendar).toHaveClass(/active/);
    await expect(page.locator('#cronoPanelCalendar')).toBeVisible();
    await expect(page.locator('#cronoPanelObjectives')).not.toBeVisible();

    // Click Objectives
    await tabObjectives.click();

    // Objectives should be active and display the habit dashboard
    await expect(tabObjectives).toHaveClass(/active/);
    await expect(page.locator('#cronoPanelCalendar')).not.toBeVisible();
    await expect(page.locator('#cronoPanelObjectives')).toBeVisible();

    // Verify habit calendar is displayed inside the objectives panel
    const dashboard = page.locator('#cronoPanelObjectives #habitCalendarDashboard');
    await expect(dashboard).toBeVisible();
    await expect(dashboard).toContainText('Estudiar Piano Diario');

    // Give a brief moment for rendering and then take screenshot
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'verification.png' });

    // Exit stopwatch concentration mode using the close button
    await page.click('.crono-close-btn');

    // Navigate to Calendario view and check general Objectives tab
    await page.click('button[data-view="calendario"]');
    const calTabObjetivos = page.locator('#calTabObjetivos');
    await calTabObjetivos.click();

    // Check that the dashboard has safely returned to its default parent
    const defaultParentDashboard = page.locator('#calPanelObjetivos #habitCalendarDashboard');
    await expect(defaultParentDashboard).toBeVisible();

    // Return to the stopwatch and check that the "Objectives" tab choice is persisted
    await page.click('button[data-view="cronometro"]');
    await expect(tabObjectives).toHaveClass(/active/);
    await expect(page.locator('#cronoPanelObjectives #habitCalendarDashboard')).toBeVisible();
  });
});
