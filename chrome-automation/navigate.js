const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const url = 'https://bigmodel.cn/glm-coding?utm_source=bigModel&utm_medium=Experience-Center&utm_content=glm-code&utm_campaign=Platform_Ops&_channel_track_key=8IpDsEJ5';

  console.log('Navigating to:', url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  console.log('Page title:', await page.title());
  console.log('Current URL:', page.url());

  // Get all links/coding plans on the page
  const links = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('a[href*="coding"], a[href*="plan"], a[href*="Coding"], a[href*="Plan"]'));
    return elements.map(el => ({
      text: el.textContent.trim(),
      href: el.href,
      visible: el.offsetParent !== null
    })).filter(l => l.visible);
  });

  console.log('Found coding plan links:', JSON.stringify(links, null, 2));

  // Also get all links for reference
  const allLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).slice(0, 30).map(el => ({
      text: el.textContent.trim().substring(0, 100),
      href: el.href
    }));
  });

  console.log('All links on page:', JSON.stringify(allLinks, null, 2));

  await browser.close();
  console.log('Browser closed');
})();