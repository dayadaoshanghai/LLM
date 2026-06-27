// 编排脚本：登录刷新 Cookie → 等待到 TARGET_TIME → 调用 auto-purchase.js
// 用法：TARGET_TIME=2026-06-27T09:59:00+08:00 node run-purchase.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Fix 2026-06-27 (Codex v8-MEDIUM-6): forward SIGTERM/SIGHUP/SIGINT to child
// processes so they (and their Chrome instances) are cleaned up when the runner
// is killed by CI, launchd, or terminal close. Without this, child processes
// become orphans that continue holding resources.
const children = new Set();

function spawnManaged(cmd, args, opts) {
  const child = spawn(cmd, args, opts);
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.once('error', () => children.delete(child));
  return child;
}

// Fix 2026-06-27 (Codex v13-MEDIUM-5): wait for children to exit before
// process.exit so they can clean up Chrome. Use a 5s timeout so we don't
// hang if a child is unresponsive.
let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      if (!child.killed) child.kill(sig);
    }
    await Promise.race([
      Promise.all([...children].map(waitChild)),
      wait(5000)
    ]);
    const sigNum = sig === 'SIGINT' ? 2 : sig === 'SIGTERM' ? 15 : 1;
    process.exit(128 + sigNum);
  });
}

// Fix 2026-06-27 (Codex v6-MEDIUM-7): spawn can emit 'error' (ENOENT,
// permission denied, etc.) which never triggers 'exit'. Without this listener,
// the Promise hangs forever. Merge both events into one resolution.
function waitChild(child) {
  return new Promise(resolve => {
    child.once('error', err => resolve({ code: 1, signal: null, error: err }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

// 修复 2026-06-27（Codex v28-LOW-2）：POSIX 标准约定，信号退出使用
// `128 + signum`。不区分时，"被 SIGTERM 终止"和"以 code 1 退出"在
// supervisor/CI 看来一样，无法判断自动化是被中断还是正常失败。
// SIGHUP=1, SIGINT=2, SIGTERM=15。
function signalExitCode(signal) {
  const nums = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
  return 128 + (nums[signal] || 1);
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] [RUNNER] ${msg}`);
}

// Fix 2026-06-27 (Codex v14-HIGH-2): parse positive integer from env,
// reusing the same strict pattern as auto-purchase.js.
function parsePositiveInt(envName, fallback) {
  const raw = process.env[envName];
  const value = raw == null || raw === '' ? String(fallback) : raw;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`Invalid ${envName}: "${raw}". Must be a positive integer.`);
  }
  return Number(value);
}

(async () => {
  // 修复 2026-06-27（Codex v28-MEDIUM-1）：强制要求显式提供 TARGET_TIME。
  // 之前的默认值 `'2026-06-27T09:59:00+08:00'` 会在抢购日期之后静默过期，
  // 导致脚本立即执行（或在抢购窗口结束后失败）。强制操作者提供明确的
  // 目标时间，避免在非抢购时段误启动脚本，浪费登录 + 预热窗口。
  const targetStr = process.env.TARGET_TIME;
  if (!targetStr) {
    throw new Error('TARGET_TIME is required, e.g. TARGET_TIME=2026-06-27T10:00:00+08:00 node run-purchase.js');
  }
  const targetTime = new Date(targetStr);
  // 修复 2026-06-27：使用前校验。否则输入错误会静默产生 NaN，
  // 循环会一直转，直到 targetTime.toISOString() 才抛出异常。
  if (Number.isNaN(targetTime.getTime())) {
    throw new Error(`Invalid TARGET_TIME: "${targetStr}". Use ISO 8601, e.g. 2026-06-27T10:00:00+08:00`);
  }
  // 修复 2026-06-27（Codex v28-MEDIUM-1）：同时拒绝过去的时间。
  // 上次抢购窗口遗留的 TARGET_TIME 不应静默地立即启动自动化——
  // 操作者可能在复用旧终端标签页或保存的命令。抛出明确错误让其
  // 注意到并提供新的目标时间。
  if (targetTime.getTime() <= Date.now()) {
    throw new Error(`TARGET_TIME is in the past: ${targetTime.toISOString()}. Provide a future time.`);
  }
  log(`Target purchase start: ${targetTime.toISOString()} (Beijing: ${targetTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })})`);

  // Fix 2026-06-27 (Codex v14-HIGH-2): delay login until LOGIN_LEAD_MS before
  // target time. Previously, login ran immediately on startup, so for flash sales
  // started hours in advance, the session cookie could expire or be invalidated
  // during the wait. By deferring login to just before the sale window, the
  // session is fresh when auto-purchase.js needs it.
  const loginLeadMs = parsePositiveInt('LOGIN_LEAD_MS', 10 * 60 * 1000);
  let preLoginWaitMs = targetTime.getTime() - Date.now() - loginLeadMs;
  if (preLoginWaitMs > 0) {
    const minutes = Math.round(preLoginWaitMs / 60000);
    log(`Waiting ${minutes} min until ${Math.round(loginLeadMs / 60000)} min before target to refresh login...`);
    while (preLoginWaitMs > 0) {
      if (preLoginWaitMs > 60000) {
        await wait(60000);
      } else {
        await wait(preLoginWaitMs);
      }
      preLoginWaitMs = targetTime.getTime() - Date.now() - loginLeadMs;
      if (preLoginWaitMs > 0) {
        log(`  ${Math.round(preLoginWaitMs / 1000)}s until login...`);
      }
    }
  }

  // ---- STEP 1: Login + save cookies ----
  log('Step 1: Running login-and-save.js...');
  // Fix 2026-06-27 (Codex v10-HIGH-1): use absolute script path + cwd:__dirname
  // so the runner works correctly regardless of the caller's cwd. Previously,
  // `node /path/run-purchase.js` from another directory would resolve
  // 'login-and-save.js' relative to cwd, potentially running the wrong script.
  const login = spawnManaged(process.execPath, [path.join(__dirname, 'login-and-save.js')], {
    stdio: 'inherit',
    cwd: __dirname
  });
  const loginExit = await waitChild(login);
  // Fix 2026-06-27 (Codex v4-HIGH-5): exit event can deliver (code, signal).
  // code===null means killed by signal — treat as failure.
  // Fix 2026-06-27 (Codex v6-MEDIUM-7): error event produces {code:1, error}.
  if (loginExit.code !== 0) {
    const reason = loginExit.error ? `error: ${loginExit.error.message}`
      : loginExit.signal ? `signal ${loginExit.signal}`
      : `code ${loginExit.code}`;
    log(`Login script failed (${reason}), aborting.`);
    // 修复 2026-06-27（Codex v28-LOW-2）：信号退出使用 128+signum，
    // 让 supervisor 能区分被杀死（如 SIGTERM=143）和正常失败（code 1）。
    process.exit(loginExit.signal ? signalExitCode(loginExit.signal) : (loginExit.code || 1));
  }
  log('Login OK, cookies.json refreshed.');

  // Fix 2026-06-27 (Codex v4-MEDIUM-2): the JS wait loop below does NOT block
  // macOS Idle Sleep. If the user invokes run-purchase.js directly (instead
  // of the caffeinate-wrapped wait-and-purchase.sh), sleep still happens.
  // Recommend the shell wrapper; refuse to silently drift.
  if (process.platform === 'darwin') {
    log('NOTE: on macOS, prefer `./wait-and-purchase.sh` which wraps this script in `caffeinate -is`.');
  }

  // ---- STEP 2: Start auto-purchase early enough to warm up Chromium/page ----
  // Fix 2026-06-27 (Codex v26-HIGH-1): launching auto-purchase.js only 2s
  // before target was too late. auto-purchase.js still has to launch Chromium,
  // create a page, load cookies, navigate to bigmodel.cn, and only then run
  // its internal TARGET_TIME wait. In a flash-sale flow this starts the
  // refresh/purchase loop several seconds late. Start it AUTO_PURCHASE_LEAD_MS
  // (default 60s) before target so browser/page warmup completes before target.
  const autoPurchaseLeadMs = parsePositiveInt('AUTO_PURCHASE_LEAD_MS', 60000);
  let now = new Date();
  let waitMs = targetTime.getTime() - now.getTime() - autoPurchaseLeadMs;
  if (waitMs > 0) {
    const minutes = Math.round(waitMs / 60000);
    log(`Step 2: Waiting ${minutes} min until ${Math.round(autoPurchaseLeadMs / 1000)}s before target...`);
    while (waitMs > 0) {
      // Print countdown every minute
      if (waitMs > 60000) {
        await wait(60000);
      } else {
        await wait(waitMs);
      }
      waitMs = targetTime.getTime() - new Date().getTime() - autoPurchaseLeadMs;
      if (waitMs > 0) {
        log(`  ${Math.round(waitMs / 1000)}s until auto-purchase launch...`);
      }
    }
  } else {
    log('Step 2: Auto-purchase launch time already passed, starting immediately.');
  }

  // ---- STEP 3: Run auto-purchase ----
  log('Step 3: Launching auto-purchase.js...');
  // Fix 2026-06-27 (Codex v6-HIGH-5): respect user-set PURCHASE_WINDOW_MS
  // instead of always overriding with 300000. The spread operator puts
  // process.env first, then the hardcoded value overwrites it. Use || to
  // provide a default only when the env var is unset.
  const env = { ...process.env, TARGET_TIME: targetTime.toISOString(), PURCHASE_WINDOW_MS: process.env.PURCHASE_WINDOW_MS || '300000' };
  // Fix 2026-06-27 (Codex v10-HIGH-1): same absolute path + cwd as login above.
  const purchase = spawnManaged(process.execPath, [path.join(__dirname, 'auto-purchase.js')], {
    stdio: 'inherit',
    cwd: __dirname,
    env
  });
  const purchaseExit = await waitChild(purchase);
  const exitReason = purchaseExit.signal ? `signal ${purchaseExit.signal}` : `code ${purchaseExit.code}`;
  log(`auto-purchase.js exited with ${exitReason}`);

  // ---- STEP 4: Show latest report ----
  // Fix 2026-06-27 (Codex v7-MEDIUM-6): readdirSync can throw (permissions,
  // cwd gone, etc.). If it does, the unhandled error would mask the real
  // purchase exit code. Wrap in try/catch so the real exit code always wins.
  try {
    const reports = fs.readdirSync(__dirname)
      .filter(f => /^purchase_report_\d+\.json$/.test(f))
      .sort();
    if (reports.length) {
      const latest = reports[reports.length - 1];
      log(`Latest report: ${latest}`);
      log(`Summary files: purchase_summary_*.txt (latest in ${__dirname})`);
    }
  } catch (err) {
    log(`WARN: failed to list reports: ${err.message}`);
  }
  process.exit(purchaseExit.signal ? signalExitCode(purchaseExit.signal) : (purchaseExit.code ?? 1));
})();