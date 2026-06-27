// 用 .env.local 中的账号密码登录 bigmodel.cn，登录成功后保存 cookies.json
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Fix 2026-06-27 (Codex v10-MEDIUM-3): same execution context protection
// as auto-purchase.js. SPA navigation during login can destroy the context.
const EXEC_CONTEXT_ERR = /Execution context was destroyed|Cannot find context|Target closed/i;

// Fix 2026-06-27 (Codex v15-MEDIUM-1): same as auto-purchase.js — Node.js
// default signal handling does not run async finally blocks, so browser.close()
// is skipped when the process is killed. Install signal handlers that close
// the browser before exiting.
let _shuttingDown = false;
function installSignalCleanup(getBrowser) {
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(sig, async () => {
      if (_shuttingDown) return;
      _shuttingDown = true;
      const browser = getBrowser();
      if (browser) {
        try { await browser.close(); } catch { /* ignore during shutdown */ }
      }
      const sigNum = sig === 'SIGINT' ? 2 : sig === 'SIGTERM' ? 15 : 1;
      process.exit(128 + sigNum);
    });
  }
}

// Fix 2026-06-27: assert any page we visit is still on bigmodel.cn. Catches
// silent redirects to phishing clones that would otherwise receive our
// credentials.
// Fix 2026-06-27 (Codex v2-HIGH-1): tightened from endsWith('bigmodel.cn')
// which allowed 'evilbigmodel.cn' to pass.
// Fix 2026-06-27 (Codex v12-HIGH-1): also verify HTTPS protocol.
function assertBigModelUrl(url, label = 'page') {
  let parsed;
  try { parsed = new URL(url); }
  catch { throw new Error(`[${label}] not a valid URL: ${url}`); }
  if (parsed.protocol !== 'https:') {
    throw new Error(`[${label}] unexpected protocol "${parsed.protocol}" — expected https:. Aborting.`);
  }
  const host = parsed.hostname;
  if (host !== 'bigmodel.cn' && !host.endsWith('.bigmodel.cn')) {
    throw new Error(`[${label}] unexpected host "${host}" — expected bigmodel.cn or *.bigmodel.cn. Aborting.`);
  }
}

function loadEnv() {
  const envPath = path.join(__dirname, '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local 不存在。请先创建并填写 GLM_USERNAME / GLM_PASSWORD');
  }
  // Fix 2026-06-27 (Codex v17-MEDIUM-1): reject group/world-readable
  // .env.local. On shared machines, default umask makes files 0644,
  // exposing credentials to other users.
  try {
    const st = fs.statSync(envPath);
    if ((st.mode & 0o077) !== 0) {
      throw new Error('.env.local permissions are too broad (mode ' + (st.mode & 0o777).toString(8) + '); run: chmod 600 .env.local');
    }
  } catch (err) {
    if (err && err.message && err.message.includes('permissions are too broad')) throw err;
  }
  const env = {};
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
    if (m) env[m[1]] = m[2];
  });
  if (!env.GLM_USERNAME || !env.GLM_PASSWORD) {
    throw new Error('.env.local 缺少 GLM_USERNAME 或 GLM_PASSWORD');
  }
  return env;
}

(async () => {
  const env = loadEnv();
  // Fix 2026-06-27: don't print the username. Logs may be shared/uploaded.
  // Length of password is also pointless — just confirm both fields loaded.
  console.log(`[${new Date().toISOString()}] Loaded credentials from .env.local (username + password present)`);

  // Fix 2026-06-27 (Codex MEDIUM #11): try/finally so browser closes on
  // any thrown error path (selector timeout, page navigation error, etc.).
  let browser;
  // Fix 2026-06-27 (Codex v15-MEDIUM-1): ensure browser is closed on signal
  // before process.exit, so Chrome doesn't stay orphaned.
  installSignalCleanup(() => browser);
  try {
    // Fix 2026-06-27 (Codex v9-HIGH-1): same as auto-purchase.js — default
    // sandbox ON; only disable when PUPPETEER_NO_SANDBOX=1.
    const launchArgs = process.env.PUPPETEER_NO_SANDBOX === '1'
      ? ['--no-sandbox', '--disable-setuid-sandbox']
      : [];
    browser = await puppeteer.launch({
      headless: false,
      args: launchArgs
    });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  console.log(`[${new Date().toISOString()}] Opening login page...`);
  await page.goto('https://bigmodel.cn/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  assertBigModelUrl(page.url(), 'login');
  await wait(2000);

  // Step 1: Click "账号登录" tab
  console.log(`[${new Date().toISOString()}] Switching to 账号登录 tab...`);
  const tabClicked = await page.evaluate(() => {
    // find tabs by text content
    const allEls = document.querySelectorAll('div, span');
    for (const el of allEls) {
      const t = el.textContent.trim();
      if (t === '账号登录' && el.getBoundingClientRect().width > 0) {
        el.click();
        return true;
      }
    }
    return false;
  });
  if (!tabClicked) {
    console.log(`[${new Date().toISOString()}] WARN: 账号登录 tab not found, trying direct input`);
  }
  await wait(800);

  // Step 2: Fill username (placeholder: 请输入用户名/邮箱/手机号)
  console.log(`[${new Date().toISOString()}] Filling username...`);
  const usernameSel = 'input.el-input__inner[placeholder="请输入用户名/邮箱/手机号"]';
  await page.waitForSelector(usernameSel, { visible: true, timeout: 5000 });
  await page.click(usernameSel);
  await page.type(usernameSel, env.GLM_USERNAME, { delay: 30 });
  await wait(300);

  // Step 3: Fill password
  console.log(`[${new Date().toISOString()}] Filling password...`);
  const pwdSel = 'input.el-input__inner[placeholder="请输入密码"]';
  await page.waitForSelector(pwdSel, { visible: true, timeout: 5000 });
  await page.click(pwdSel);
  await page.type(pwdSel, env.GLM_PASSWORD, { delay: 30 });
  await wait(300);

  // Step 4: Check agreement checkbox if not checked
  await page.evaluate(() => {
    const cb = document.querySelector('input.el-checkbox__original');
    if (cb && !cb.checked) cb.click();
  });
  await wait(300);

  // Fix 2026-06-27 (Codex v6-HIGH-4): screenshot contains PII; only write when
  // DEBUG_SCREENSHOTS=1 and restrict file permissions.
  // Fix 2026-06-27 (Codex v12-LOW-4): write to __dirname, not cwd, consistent
  // with other path hardening (BASE_DIR in auto-purchase.js).
  if (process.env.DEBUG_SCREENSHOTS === '1') {
    const screenshotPath = path.join(__dirname, 'login_before_submit.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    try { fs.chmodSync(screenshotPath, 0o600); } catch { /* chmod not supported */ }
    console.log(`[${new Date().toISOString()}] Screenshot: ${screenshotPath} (mode 0600)`);
  }

  // Step 5: Click 登录 button (in the visible form, not the hidden one)
  console.log(`[${new Date().toISOString()}] Clicking 登录 button...`);
  // Fix 2026-06-27 (Codex v16-MEDIUM-1): protect against execution context
  // destruction. If the click triggers SPA navigation, the evaluate throws
  // before returning true. Treat that as a successful click and continue to
  // the login-success wait loop.
  let loginClicked;
  try {
    loginClicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('button.login-btn');
      for (const btn of btns) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && btn.textContent.trim() === '登录') {
          btn.click();
          return true;
        }
      }
      return false;
    });
  } catch (err) {
    if (!EXEC_CONTEXT_ERR.test(err.message)) throw err;
    loginClicked = true;
    console.log(`[${new Date().toISOString()}] Login click likely triggered navigation; continuing to wait loop...`);
  }
  if (!loginClicked) {
    console.log(`[${new Date().toISOString()}] WARN: 登录 button not clicked`);
  }

  // Step 6: Wait for login success (URL change)
  console.log(`[${new Date().toISOString()}] Waiting for login success...`);
  let loggedIn = false;
  for (let i = 0; i < 24; i++) { // 2 min max
    await wait(5000);
    const url = page.url();
    // Fix 2026-06-27 (Codex v8-HIGH-1): validate host on EVERY iteration, not
    // just the "success" branch. If the page was redirected to evil.example/login,
    // the old logic would stay in the loop (url includes '/login') without ever
    // catching the domain mismatch.
    assertBigModelUrl(url, 'login-wait');
    // Fix 2026-06-27 (Codex v10-MEDIUM-3): navigation during login can destroy
    // the execution context. Catch and retry instead of crashing.
    let text = '';
    try {
      text = await page.evaluate(() => document.body?.innerText || '');
    } catch (err) {
      if (!EXEC_CONTEXT_ERR.test(err.message)) throw err;
      // Context destroyed during navigation — retry on next iteration
      continue;
    }
    // Fix 2026-06-27 (Codex v12-MEDIUM-3): use pathname instead of url.includes
    // to avoid false matches like ?redirect=/login in query parameters.
    const currentUrl = new URL(url);
    const onAuthPage = /^\/(login|register)(\/|$)/.test(currentUrl.pathname);
    if (!onAuthPage) {
      // Fix 2026-06-27 (Codex v6-HIGH-3): verify the post-login page is still
      // on bigmodel.cn. A redirect to a third-party would otherwise be treated
      // as "login success" and cookies from that site would be saved (useless).
      assertBigModelUrl(url, 'post-login');
      loggedIn = true;
      // Fix 2026-06-27 (Codex v6-HIGH-3): don't log the full URL — query
      // parameters may contain session tokens or other secrets. Print only
      // origin + pathname.
      console.log(`[${new Date().toISOString()}] Login success! URL: ${currentUrl.origin}${currentUrl.pathname}`);
      break;
    }
    // detect error message
    const errMatch = text.match(/(账号|密码|用户名|验证码)[^\n]{0,30}(错误|不正确|失败|异常)/);
    if (errMatch) {
      // 修复 2026-06-27（Codex v28-LOW-1）：不要输出匹配到的错误文本。
      // 网站在校验失败时常会回显账户标识（手机号、邮箱、用户名），
      // 所以 `errMatch[0]` 可能携带凭证相关信息进入共享日志。
      // 仅输出分类标识（匹配的类别：账号/密码/用户名/验证码）。
      const category = errMatch[1];
      console.log(`[${new Date().toISOString()}] Login error detected (category: ${category})`);
    }
    // Fix 2026-06-27 (Codex v7-HIGH-4): don't log the full URL in the wait
    // loop either — query params may contain tokens. Print only origin + path.
    const safeWaitUrl = new URL(url);
    console.log(`[${new Date().toISOString()}] Still on ${safeWaitUrl.origin}${safeWaitUrl.pathname}...`);
  }

  if (!loggedIn) {
    console.log(`[${new Date().toISOString()}] Login timeout`);
    // Fix 2026-06-27 (Codex v4-LOW-2): let the unified finally handle
    // browser.close and the outer .catch handle exit. Avoids diverging
    // cleanup paths if cleanup logic grows in the future.
    throw new Error('Login timeout: URL stayed on /login for 2 minutes');
  }

  // Step 7: Save cookies
  // Fix 2026-06-27 (Codex v4-HIGH-4): reading cookies the instant URL leaves
  // /login can race with the auth server writing bigmodel_token_production.
  // Poll for up to 15s before giving up.
  let cookies = await page.cookies();
  const tokenWaitStart = Date.now();
  const TOKEN_WAIT_MS = 15000;
  while (
    (!cookies.length || !cookies.some(c => c.name === 'bigmodel_token_production')) &&
    Date.now() - tokenWaitStart < TOKEN_WAIT_MS
  ) {
    console.log(`[${new Date().toISOString()}] Waiting for bigmodel_token_production to appear...`);
    await new Promise(r => setTimeout(r, 500));
    cookies = await page.cookies();
  }

  // Fix 2026-06-27 (Codex v3-HIGH-2): without bigmodel_token_production, the
  // saved cookies are useless — auto-purchase.js will appear to "succeed" but
  // every click lands on the login redirect. Refuse to write the file.
  if (!cookies.length || !cookies.some(c => c.name === 'bigmodel_token_production')) {
    throw new Error('Login did not produce bigmodel_token_production cookie within ' + TOKEN_WAIT_MS + 'ms');
  }
  // Fix 2026-06-27: write cookies.json with 0600 — it contains a session
  // token that grants full account access. Default umask would make it
  // world-readable on shared systems.
  // Fix 2026-06-27 (Codex v9-MEDIUM-3): use __dirname-based path so cookies
  // are written next to the script, not in the caller's cwd.
  // Fix 2026-06-27 (Codex v17-HIGH-1): writeSynchronousFile mode option only
  // applies on creation. If cookies.json already exists with broader perms
  // from a prior run, the session token stays readable. Use write-to-tmp +
  // chmod + rename + chmod to guarantee 0600 regardless.
  const cookiesPath = path.join(__dirname, 'cookies.json');
  // Fix 2026-06-27 (Codex v22-LOW-1): cookies.json.${pid}.tmp is predictable
  // and writeFileSync follows pre-existing symlinks. On a shared writable
  // checkout, another local user could pre-create that path as a symlink
  // and redirect session-cookie writes. Use openSync with 'wx' flag
  // (O_CREAT|O_EXCL) which atomically creates a new file or fails with
  // EEXIST if the path is already present (including as a symlink).
  const tmpCookiesPath = path.join(__dirname, `cookies.json.${process.pid}.tmp`);
  const fd = fs.openSync(tmpCookiesPath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(cookies, null, 2));
    try { fs.fchmodSync(fd, 0o600); } catch { /* chmod not supported */ }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpCookiesPath, cookiesPath);
  try { fs.chmodSync(cookiesPath, 0o600); } catch { /* chmod not supported */ }
  console.log(`[${new Date().toISOString()}] Saved ${cookies.length} cookies to ${cookiesPath} (mode 0600)`);

  // Validate bigmodel_token_production. Puppeteer's expirationDate is already
  // Unix epoch in *milliseconds*, not seconds — multiplying again produces
  // RangeError: Invalid time value (fixed 2026-06-27).
  // Fix 2026-06-27 (Codex v6-LOW-10): Puppeteer usually provides expirationDate
  // (ms), but some versions/scenarios expose only `expires` (seconds). Try both.
  const token = cookies.find(c => c.name === 'bigmodel_token_production');
  if (token) {
    const expiresAt = token.expirationDate ?? (token.expires && token.expires > 0 ? token.expires * 1000 : undefined);
    if (expiresAt) {
      console.log(`[${new Date().toISOString()}] Token expires: ${new Date(expiresAt).toISOString()}`);
    } else {
      console.log(`[${new Date().toISOString()}] Token has no expirationDate (session cookie)`);
    }
  } else {
    console.log(`[${new Date().toISOString()}] WARN: bigmodel_token_production not found in cookies`);
  }

  await browser.close();
  console.log(`[${new Date().toISOString()}] Done.`);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* already closed */ }
    }
  }
})().catch(err => {
  // 修复 2026-06-27（Codex v30-LOW-1）：脱敏错误消息中的 URL。
  // Puppeteer/网络错误可能包含完整 URL，查询参数里可能有敏感 token。
  const raw = String(err && err.stack || err);
  console.error('[FATAL]', raw.replace(/https?:\/\/[^\s)]+/g, u => {
    try { const parsed = new URL(u); return `${parsed.origin}${parsed.pathname}`; }
    catch { return '<invalid-url>'; }
  }));
  process.exit(1);
});