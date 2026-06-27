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

  // Go to main page first
  console.log('[' + new Date().toISOString() + '] Going to main page...');
  await page.goto('https://bigmodel.cn/coding-plan/personal/overview', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(3000);

  // Look for the "立即订阅" text - get all matching elements
  const subscribeElements = await page.evaluate(() => {
    const results = [];
    // Find all elements containing "立即订阅"
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
      if (el.childNodes.length === 1 && el.textContent.trim() === '立即订阅') {
        results.push({
          tag: el.tagName,
          class: el.className,
          id: el.id,
          text: el.textContent.trim()
        });
      }
    });
    return results;
  });

  console.log('[' + new Date().toISOString() + '] Elements with exact text "立即订阅":', JSON.stringify(subscribeElements, null, 2));

  // Click the subscribe button (operate-btn-item class)
  console.log('[' + new Date().toISOString() + '] Clicking subscribe button...');
  await page.evaluate(() => {
    const btn = document.querySelector('.operate-btn-item');
    if (btn) btn.click();
  });
  await wait(3000);

  // Take screenshot
  await page.screenshot({ path: 'after-subscribe-click.png', fullPage: true });
  console.log('[' + new Date().toISOString() + '] Screenshot saved');

  // Check what dialog/modal appeared
  const dialogInfo = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('[class*="dialog"], [class*="modal"], [class*="drawer"]');
    return {
      dialogCount: dialogs.length,
      dialogs: Array.from(dialogs).map(d => ({
        tag: d.tagName,
        class: d.className,
        visible: d.offsetParent !== null,
        text: d.innerText.substring(0, 500)
      }))
    };
  });

  console.log('[' + new Date().toISOString() + '] Dialog info:', JSON.stringify(dialogInfo, null, 2));

  // Check if there's any iframe or new window
  const iframes = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('iframe')).map(f => ({
      id: f.id,
      src: f.src,
      class: f.className
    }));
  });
  console.log('[' + new Date().toISOString() + '] Iframes:', JSON.stringify(iframes, null, 2));

  // Also check body text for any plan info
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('[' + new Date().toISOString() + '] Body text:', bodyText);

  await browser.close();
  console.log('[' + new Date().toISOString() + '] Done!');
})();