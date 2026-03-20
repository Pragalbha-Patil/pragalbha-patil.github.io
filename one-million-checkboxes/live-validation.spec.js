const { test, expect } = require('@playwright/test');

test('live page renders and basic interactions work', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', error => {
    pageErrors.push(String(error));
  });

  page.on('requestfailed', request => {
    requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'unknown error'}`);
  });

  await page.goto('https://pragal.fun/one-million-checkboxes/', {
    waitUntil: 'networkidle',
    timeout: 120000,
  });

  await expect(page.locator('#checkbox-container')).toBeVisible();
  await page.waitForFunction(() => document.querySelectorAll('#checkbox-container input[type="checkbox"]').length > 0, null, {
    timeout: 30000,
  });

  const renderedCheckboxCount = await page.locator('#checkbox-container input[type="checkbox"]').count();
  expect(renderedCheckboxCount).toBeGreaterThan(0);

  const firstCheckbox = page.locator('#checkbox-container input[type="checkbox"]').first();
  await expect(firstCheckbox).toBeVisible();
  const previousCheckedState = await firstCheckbox.isChecked();
  await firstCheckbox.click();
  await expect(firstCheckbox).toHaveJSProperty('checked', !previousCheckedState);

  await page.evaluate(() => window.scrollTo(0, 1600));
  await page.waitForTimeout(1000);

  const topButton = page.locator('#scrollTopBtn');
  await expect(topButton).toBeVisible();
  await topButton.click();
  await page.waitForTimeout(500);

  const scrollYAfterTop = await page.evaluate(() => window.scrollY);
  expect(scrollYAfterTop).toBeLessThan(50);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  const bottomButton = page.locator('#scrollBottomBtn');
  await expect(bottomButton).toBeVisible();
  await bottomButton.click();
  await page.waitForTimeout(1800);

  const bottomLabel = await bottomButton.textContent();
  expect(bottomLabel).toContain('Stop');

  await bottomButton.click();
  await page.waitForTimeout(500);
  await expect(bottomButton).toHaveText('Bottom ↓');

  const statusBannerText = await page.locator('#status-banner').textContent();

  if (requestFailures.length) {
    throw new Error(`Request failures detected:\n${requestFailures.join('\n')}`);
  }

  if (pageErrors.length) {
    throw new Error(`Page errors detected:\n${pageErrors.join('\n')}`);
  }

  if (consoleErrors.length) {
    throw new Error(`Console errors detected:\n${consoleErrors.join('\n')}`);
  }

  console.log(JSON.stringify({
    renderedCheckboxCount,
    previousCheckedState,
    statusBannerText,
    consoleErrors,
    pageErrors,
    requestFailures,
  }, null, 2));
});
