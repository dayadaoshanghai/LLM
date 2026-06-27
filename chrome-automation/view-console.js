const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const consoleUrl = 'https://bigmodel.cn/coding-plan/personal/overview';

  console.log('[' + new Date().toISOString() + '] Navigating to console:', consoleUrl);

  try {
    await page.goto(consoleUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000); // Wait for dynamic content
  } catch (e) {
    console.log('[' + new Date().toISOString() + '] Navigation error:', e.message);
  }

  console.log('[' + new Date().toISOString() + '] Current URL:', page.url());
  console.log('[' + new Date().toISOString() + '] Page title:', await page.title());

  // Take screenshot
  await page.screenshot({ path: 'console-screenshot.png', fullPage: true });
  console.log('[' + new Date().toISOString() + '] Screenshot saved');

  // Get page content
  const pageContent = await page.evaluate(() => {
    return {
      title: document.title,
      bodyText: document.body.innerText.substring(0, 5000),
      buttons: Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim().substring(0, 100),
        disabled: b.disabled,
        className: b.className
      })),
      links: Array.from(document.querySelectorAll('a[href]')).map(a => ({
        text: a.textContent.trim().substring(0, 80),
        href: a.href
      })).filter(l => l.text.length > 0)
    };
  });

  console.log('[' + new Date().toISOString() + '] Page content:', JSON.stringify(pageContent, null, 2));

  await browser.close();
  console.log('[' + new Date().toISOString() + '] Done');
})();