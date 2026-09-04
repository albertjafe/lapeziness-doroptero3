import {test,expect} from '@playwright/test';
test('the persistence layer is loaded and executed exactly once across the real addon chain',async({page})=>{
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:'/* isolated test account */'}));
  await page.route('**/local-save-resilience.js?*',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:'window.__persistenceExecutions=(window.__persistenceExecutions||0)+1;\n'+await response.text()});
  });
  await page.goto('/');
  await page.waitForFunction(()=>window.ProfessorHandoffResilience&&window.LocalSaveResilience);
  await page.evaluate(()=>{showView('cronometro');showView('profesor');});
  expect(await page.evaluate(()=>window.__persistenceExecutions)).toBe(1);
  await expect(page.locator('script[src*="local-save-resilience.js"]')).toHaveCount(1);
});
