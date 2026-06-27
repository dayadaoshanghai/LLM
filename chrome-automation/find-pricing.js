const puppeteer = require('puppeteer');
const fs = require('fs');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Load cookies
  const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));
  console.log('[' + new Date().toISOString() + '] Loaded', cookies.length, 'cookies');

  await page.setCookie(...cookies);
  console.log('[' + new Date().toISOString() + '] Cookies set');

  // Navigate to coding plan overview page (套餐概览)
  console.log('[' + new Date().toISOString() + '] Navigating to coding plan...');
  await page.goto('https://bigmodel.cn/coding-plan/personal/overview', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(3000);

  console.log('[' + new Date().toISOString() + '] Page title:', await page.title());

  // Take screenshot of main page
  await page.screenshot({ path: 'main-page.png', fullPage: true });
  console.log('[' + new Date().toISOString() + '] Main page screenshot saved');

  // Check for any pricing/plan section
  const planSelectors = await page.evaluate(() => {
    // Look for any plan-related elements
    const plans = document.querySelectorAll('[class*="plan"], [class*="price"], [class*="Pro"], [class*="pro"]');
    return Array.from(plans).map(el => ({
      tag: el.tagName,
      class: el.className,
      text: el.innerText.substring(0, 200)
    }));
  });
  console.log('[' + new Date().toISOString() + '] Plan elements found:', JSON.stringify(planSelectors, null, 2));

  // Try to find the direct pricing page
  const pricingUrl = 'https://bigmodel.cn/coding-plan/pricing';
  console.log('[' + new Date().toISOString() + '] Trying pricing page:', pricingUrl);
  await page.goto(pricingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await wait(3000);

  console.log('[' + new Date().toISOString() + '] Pricing page URL:', page.url());

  await page.screenshot({ path: 'pricing-page.png', fullPage: true });
  console.log('[' + new Date().toISOString() + '] Pricing page screenshot saved');

  // Get page content
  const pricingContent = await page.evaluate(() => {
    return {
      url: window.location.href,
      title: document.title,
      bodyText: document.body.innerText.substring(0, 5000),
      buttons: Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim(),
        className: b.className
      })).filter(b => b.text),
      links: Array.from(document.querySelectorAll('a[href]')).map(a => ({
        text: a.textContent.trim().substring(0, 80),
        href: a.href
      })).filter(l => l.text && l.href)
    };
  });

  console.log('[' + new Date().toISOString() + '] Pricing content:', JSON.stringify(pricingContent, null, 2));

  // Look for any subscribe/buy buttons
  const buyButtons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, a')).filter(el => {
      const text = el.textContent.trim().toLowerCase();
      return text.includes('订阅') || text.includes('购买') || text.includes('立即') || text.includes('buy') || text.includes('subscribe') || text.includes('pro');
    }).map(el => ({
      tag: el.tagName,
      text: el.textContent.trim(),
      href: el.href || 'N/A',
      class: el.className
    }));
  });

  console.log('[' + new Date().toISOString() + '] Buy buttons:', JSON.stringify(buyButtons, null, 2));

  await browser.close();
  console.log('[' + new Date().toISOString() + '] Done!');
})();