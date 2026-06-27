const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const url = 'https://bigmodel.cn/glm-coding?utm_source=bigModel&utm_medium=Experience-Center&utm_content=glm-code&utm_campaign=Platform_Ops&_channel_track_key=8IpDsEJ5';

  console.log('[' + new Date().toISOString() + '] Step 1: Navigating to:', url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  console.log('[' + new Date().toISOString() + '] Step 2: Clicking console link (控制台)...');
  await page.click('a[href="https://bigmodel.cn/coding-plan/personal/overview"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

  console.log('[' + new Date().toISOString() + '] Current URL:', page.url());
  console.log('[' + new Date().toISOString() + '] Page title:', await page.title());

  // Find and click Pro version purchase button
  const purchaseSelectors = [
    'a[href*="pro"]',
    'button:has-text("Pro")',
    'a:has-text("Pro")',
    'a:has-text("升级")',
    'a:has-text("购买Pro")',
    'a:has-text("立即购买")',
    'button:has-text("立即")',
    '[data-plan="pro"]',
    '.plan-pro a',
    '.pro-btn'
  ];

  let clicked = false;
  for (const selector of purchaseSelectors) {
    try {
      const exists = await page.$(selector);
      if (exists) {
        console.log('[' + new Date().toISOString() + '] Found selector:', selector);
        await page.click(selector, { timeout: 2000 });
        clicked = true;
        console.log('[' + new Date().toISOString() + '] Clicked:', selector);
        break;
      }
    } catch (e) {
      // Try next selector
    }
  }

  if (!clicked) {
    // Take screenshot to see current state
    await page.screenshot({ path: 'purchase-attempt.png', fullPage: true });
    console.log('[' + new Date().toISOString() + '] Screenshot saved to purchase-attempt.png');

    // Get all buttons and links to find purchase options
    const allClickables = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a, button')).map(el => ({
        tag: el.tagName,
        text: el.textContent.trim().substring(0, 100),
        href: el.href || 'N/A'
      }));
    });
    console.log('[' + new Date().toISOString() + '] All clickables:', JSON.stringify(allClickables, null, 2));
  } else {
    // Wait a bit and take screenshot
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'after-purchase-click.png', fullPage: true });
    console.log('[' + new Date().toISOString() + '] Screenshot saved to after-purchase-click.png');
  }

  await browser.close();
  console.log('[' + new Date().toISOString() + '] Browser closed');
})();