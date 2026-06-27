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

  const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));
  console.log('[' + new Date().toISOString() + '] Loaded', cookies.length, 'cookies');
  await page.setCookie(...cookies);

  // Go to main coding plan page (not personal overview)
  console.log('[' + new Date().toISOString() + '] Going to GLM Coding page...');
  await page.goto('https://bigmodel.cn/glm-coding', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(3000);

  console.log('[' + new Date().toISOString() + '] Page title:', await page.title());
  await page.screenshot({ path: 'glm-coding-page.png', fullPage: true });
  console.log('[' + new Date().toISOString() + '] Screenshot saved');

  // Click "即刻订阅" button
  console.log('[' + new Date().toISOString() + '] Looking for subscribe button...');

  // Try to find any subscribe/pricing button
  const subscribeBtn = await page.evaluate(() => {
    // Try various selectors
    const selectors = [
      'text/即刻订阅',
      'text/立即订阅',
      'a:has-text("订阅")',
      'button:has-text("订阅")',
      '[class*="subscribe"]',
      '[class*="plan"]'
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          return { selector: sel, text: el.textContent.trim(), class: el.className };
        }
      } catch (e) {}
    }
    return null;
  });

  console.log('[' + new Date().toISOString() + '] Subscribe element:', JSON.stringify(subscribeBtn));

  // Find and click the "即刻订阅" button
  const btnClicked = await page.evaluate(() => {
    // Look for elements with "即刻订阅" text
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.textContent.trim() === '即刻订阅') {
        el.click();
        return true;
      }
    }
    return false;
  });

  if (btnClicked) {
    console.log('[' + new Date().toISOString() + '] Clicked "即刻订阅"');
    await wait(2000);
    await page.screenshot({ path: 'after-subscribe.png', fullPage: true });
  }

  // Check dialog that appears - look for "继续订阅" option
  console.log('[' + new Date().toISOString() + '] Looking for continue subscription option...');
  const continueSub = await page.evaluate(() => {
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.textContent.trim() === '继续订阅') {
        return { tag: el.tagName, class: el.className, text: el.textContent.trim() };
      }
    }
    return null;
  });

  console.log('[' + new Date().toISOString() + '] Continue subscription element:', JSON.stringify(continueSub));

  if (continueSub) {
    // Click "继续订阅"
    await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        if (el.textContent.trim() === '继续订阅') {
          el.click();
          return;
        }
      }
    });
    console.log('[' + new Date().toISOString() + '] Clicked "继续订阅"');
    await wait(3000);
    await page.screenshot({ path: 'plan-selection.png', fullPage: true });

    // Get page content to see plan options
    const planContent = await page.evaluate(() => {
      return {
        text: document.body.innerText.substring(0, 5000),
        buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t),
      };
    });
    console.log('[' + new Date().toISOString() + '] Plan selection content:', JSON.stringify(planContent, null, 2));
  }

  await browser.close();
  console.log('[' + new Date().toISOString() + '] Done!');
})();