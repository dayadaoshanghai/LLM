const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const url = 'https://bigmodel.cn/glm-coding?utm_source=bigModel&utm_medium=Experience-Center&utm_content=glm-code&utm_campaign=Platform_Ops&_channel_track_key=8IpDsEJ5';

  console.log('Step 1: Navigating to:', url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  console.log('Step 2: Clicking console link (控制台)...');
  await page.click('a[href="https://bigmodel.cn/coding-plan/personal/overview"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

  console.log('Current URL:', page.url());
  console.log('Page title:', await page.title());

  // Take a screenshot
  await page.screenshot({ path: 'console.png', fullPage: true });
  console.log('Screenshot saved to console.png');

  // Find all pricing/purchase related elements
  const pricingLinks = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('a, button'));
    return elements
      .filter(el => {
        const text = el.textContent.trim().toLowerCase();
        const href = el.href || '';
        return text.includes('购买') || text.includes('订阅') || text.includes('套餐') ||
               text.includes('buy') || text.includes('plan') || text.includes('price') ||
               text.includes('pricing') || text.includes('抢购') || text.includes('立即') ||
               href.includes('pricing') || href.includes('buy') || href.includes('subscribe');
      })
      .map(el => ({
        tag: el.tagName,
        text: el.textContent.trim().substring(0, 100),
        href: el.href || 'N/A',
        visible: el.offsetParent !== null
      }));
  });

  console.log('Pricing/Purchase links found:', JSON.stringify(pricingLinks, null, 2));

  // Get all buttons and clickable elements
  const clickables = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href], button')).slice(0, 50).map(el => ({
      tag: el.tagName,
      text: el.textContent.trim().substring(0, 80),
      href: el.href || 'N/A'
    }));
  });

  console.log('Clickable elements:', JSON.stringify(clickables, null, 2));

  await browser.close();
  console.log('Browser closed');
})();