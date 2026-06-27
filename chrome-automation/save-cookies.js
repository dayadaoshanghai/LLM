const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  console.log('[' + new Date().toISOString() + '] Opening login page...');
  await page.goto('https://bigmodel.cn/login', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('[' + new Date().toISOString() + '] Current URL:', page.url());
  console.log('[' + new Date().toISOString() + '] Login URL: https://bigmodel.cn/login');
  console.log('[' + new Date().toISOString() + '] Please log in manually, then the script will continue...');

  // Wait for login with a timeout check every 5 seconds
  let loggedIn = false;
  for (let i = 0; i < 120; i++) { // 10 minutes max
    await new Promise(r => setTimeout(r, 5000));
    const currentUrl = page.url();
    if (!currentUrl.includes('/login') && !currentUrl.includes('/register')) {
      loggedIn = true;
      console.log('[' + new Date().toISOString() + '] Detected login success!');
      break;
    }
    console.log('[' + new Date().toISOString() + '] Still on login page, waiting...');
  }

  if (!loggedIn) {
    console.log('[' + new Date().toISOString() + '] Login timeout, please try again');
    await browser.close();
    process.exit(1);
  }

  // Save cookies
  const cookies = await page.cookies();
  fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
  console.log('[' + new Date().toISOString() + '] Cookies saved to cookies.json');
  console.log('[' + new Date().toISOString() + '] Cookie count:', cookies.length);

  // Navigate to coding plan console
  console.log('[' + new Date().toISOString() + '] Navigating to coding plan console...');
  await page.goto('https://bigmodel.cn/coding-plan/personal/overview', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'console-page.png', fullPage: true });
  console.log('[' + new Date().toISOString() + '] Console screenshot saved');

  // Check current state
  const state = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    bodyText: document.body.innerText.substring(0, 3000)
  }));
  console.log('[' + new Date().toISOString() + '] Console page:', JSON.stringify(state, null, 2));

  await browser.close();
  console.log('[' + new Date().toISOString() + '] Done!');
})();