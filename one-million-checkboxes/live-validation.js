const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
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

  try {
    await page.goto('https://pragal.fun/one-million-checkboxes/', {
      waitUntil: 'networkidle',
      timeout: 120000,
    });

    await page.waitForSelector('#checkbox-container', { state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('#checkbox-container input[type="checkbox"]').length > 0, { timeout: 30000 });

    const renderedCheckboxCount = await page.locator('#checkbox-container input[type="checkbox"]').count();
    if (renderedCheckboxCount <= 0) {
      throw new Error('No rendered checkboxes found');
    }

    const firstCheckbox = page.locator('#checkbox-container input[type="checkbox"]').first();
    const previousCheckedState = await firstCheckbox.isChecked();
    await firstCheckbox.click();
    const currentCheckedState = await firstCheckbox.isChecked();
    if (currentCheckedState === previousCheckedState) {
      throw new Error('Checkbox click did not change state');
    }

    await page.evaluate(() => window.scrollTo(0, 1600));
    await page.waitForTimeout(1000);

    const topButtonVisible = await page.locator('#scrollTopBtn').isVisible();
    if (!topButtonVisible) {
      throw new Error('Top scroll button did not become visible after scrolling');
    }

    await page.locator('#scrollTopBtn').click();
    await page.waitForTimeout(600);

    const scrollYAfterTop = await page.evaluate(() => window.scrollY);
    if (scrollYAfterTop >= 50) {
      throw new Error(`Top button did not scroll near top. scrollY=${scrollYAfterTop}`);
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    const bottomButton = page.locator('#scrollBottomBtn');
    const bottomButtonVisible = await bottomButton.isVisible();
    if (!bottomButtonVisible) {
      throw new Error('Bottom scroll button is not visible near top of page');
    }

    await bottomButton.click();
    await page.waitForTimeout(1800);

    const activeBottomLabel = await bottomButton.textContent();
    if (!activeBottomLabel.includes('Stop')) {
      throw new Error(`Bottom button did not enter auto-scroll state. label=${activeBottomLabel}`);
    }

    await bottomButton.click();
    await page.waitForTimeout(500);

    const resetBottomLabel = await bottomButton.textContent();
    if (resetBottomLabel.trim() !== 'Bottom ↓') {
      throw new Error(`Bottom button did not reset after stop. label=${resetBottomLabel}`);
    }

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
      ok: true,
      renderedCheckboxCount,
      statusBannerText,
      scrollYAfterTop,
      activeBottomLabel,
      resetBottomLabel,
      consoleErrors,
      pageErrors,
      requestFailures,
    }, null, 2));
  } catch (error) {
    console.error(error.stack || String(error));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
