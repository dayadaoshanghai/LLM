// Regression test for Codex v6 fixes (10 issues).
// Runs as: node v6-smoke.js
// Each check verifies the fix is present in the source code.
// This is a static analysis test — no browser needed.

const fs = require('fs');
const ap = fs.readFileSync('auto-purchase.js', 'utf8');
const ls = fs.readFileSync('login-and-save.js', 'utf8');
const rp = fs.readFileSync('run-purchase.js', 'utf8');
const sh = fs.readFileSync('wait-and-purchase.sh', 'utf8');

const checks = [
  // ===== CRITICAL-1: STEP1/STEP2 后验证码失败 continue =====
  { src: ap, n: 'v6-CRIT-1 v2 failed → continue',
    r: /Verification after subscribe failed.*?continue;/s },
  { src: ap, n: 'v6-CRIT-1 v3 failed → continue',
    r: /Verification after plan dialog failed.*?continue;/s },

  // ===== CRITICAL-2: reload/购买后 assertBigModelUrl =====
  { src: ap, n: 'v6-CRIT-2 loop-reload assert',
    r: /assertBigModelUrl\(page\.url\(\), 'loop-reload'\)/ },
  { src: ap, n: 'v6-CRIT-2 verification-reload assert',
    r: /assertBigModelUrl\(page\.url\(\), 'verification-reload'\)/ },
  { src: ap, n: 'v6-CRIT-2 verification-error-reload assert',
    r: /assertBigModelUrl\(page\.url\(\), 'verification-error-reload'\)/ },
  { src: ap, n: 'v6-CRIT-2 post-purchase-click assert',
    r: /assertBigModelUrl\(page\.url\(\), 'post-purchase-click'\)/ },

  // ===== HIGH-3: login host 校验 + URL 脱敏 =====
  { src: ls, n: 'v6-HIGH-3 post-login assertBigModelUrl',
    r: /assertBigModelUrl\(url, 'post-login'\)/ },
  { src: ls, n: 'v6-HIGH-3 safeUrl origin+pathname',
    r: /safeUrl\.origin\}\$\{safeUrl\.pathname/ },

  // ===== HIGH-4: 截图默认关闭 + chmod 0o600 =====
  { src: ap, n: 'v6-HIGH-4 monitor.screenshot gated by DEBUG_SCREENSHOTS',
    r: /DEBUG_SCREENSHOTS !== '1'\) return null/ },
  { src: ap, n: 'v6-HIGH-4 screenshot chmod 0o600',
    r: /fs\.chmodSync\(filename, 0o600\)/ },
  { src: ls, n: 'v6-HIGH-4 login screenshot gated by DEBUG_SCREENSHOTS',
    r: /DEBUG_SCREENSHOTS === '1'/ },
  { src: ls, n: 'v6-HIGH-4 login screenshot chmod 0o600',
    r: /fs\.chmodSync\('login_before_submit\.png', 0o600\)/ },

  // ===== HIGH-5: PURCHASE_WINDOW_MS 不覆盖用户设置 =====
  { src: rp, n: 'v6-HIGH-5 PURCHASE_WINDOW_MS respects env',
    r: /PURCHASE_WINDOW_MS: process\.env\.PURCHASE_WINDOW_MS \|\| '300000'/ },

  // ===== MEDIUM-6: TIMEOUTS 接到调用点 =====
  { src: ap, n: 'v6-MED-6 step1 uses TIMEOUTS.step1',
    r: /waitForAnyText\(page, \['继续订阅', '5x Lite 用量额度'\], \{ timeoutMs: TIMEOUTS\.step1 \}\)/ },
  { src: ap, n: 'v6-MED-6 step2 uses TIMEOUTS.step2',
    r: /waitForText\(page, '5x Lite 用量额度', TIMEOUTS\.step2\)/ },
  { src: ap, n: 'v6-MED-6 step3 uses TIMEOUTS.step3',
    r: /waitForAnyText\(page, \['立即购买', '立即订阅', '应付金额'\], \{ timeoutMs: TIMEOUTS\.step3 \}\)/ },
  { src: ap, n: 'v6-MED-6 step4Wait uses TIMEOUTS.step4Wait',
    r: /wait\(TIMEOUTS\.step4Wait\)/ },
  { src: ap, n: 'v6-MED-6 captchaGone click uses TIMEOUTS.captchaGone',
    r: /waitForTextGone\(page, \['请依次点击', '请按顺序点击'\], TIMEOUTS\.captchaGone\)/ },
  { src: ap, n: 'v6-MED-6 captchaGone slide uses TIMEOUTS.captchaGone',
    r: /waitForTextGone\(page, \['拖动', '拼图', '滑动'\], TIMEOUTS\.captchaGone\)/ },

  // ===== MEDIUM-7: 子进程 error 事件 =====
  { src: rp, n: 'v6-MED-7 waitChild function defined',
    r: /function waitChild\(child\)/ },
  { src: rp, n: 'v6-MED-7 waitChild listens error',
    r: /child\.once\('error'/ },
  { src: rp, n: 'v6-MED-7 login uses waitChild',
    r: /waitChild\(login\)/ },
  { src: rp, n: 'v6-MED-7 purchase uses waitChild',
    r: /waitChild\(purchase\)/ },
  { src: rp, n: 'v6-MED-7 loginExit error handling',
    r: /loginExit\.error \? `error:/ },

  // ===== MEDIUM-8: wait-and-purchase.sh set -euo pipefail + dirname =====
  { src: sh, n: 'v6-MED-8 set -euo pipefail',
    r: /set -euo pipefail/ },
  { src: sh, n: 'v6-MED-8 cd dirname $0',
    r: /cd "\$\(dirname "\$0"\)"/ },
  { src: sh, n: 'v6-MED-8 CAFFEINATED safe access',
    r: /\$\{CAFFEINATED:-\}/ },

  // ===== LOW-9: VERIFY_SUCCESS_RATE 删除 =====
  { src: ap, n: 'v6-LOW-9 VERIFY_SUCCESS_RATE removed',
    r: /VERIFY_SUCCESS_RATE/, negate: true },

  // ===== LOW-10: cookie expires 字段兼容 =====
  { src: ls, n: 'v6-LOW-10 expiresAt fallback',
    r: /token\.expirationDate \?\? \(token\.expires/ },
];

let ok = 0, fail = 0;
for (const c of checks) {
  const test = c.r.test(c.src);
  const passed = c.negate ? !test : test;
  if (passed) { console.log('  ✓', c.n); ok++; }
  else { console.log('  ✗', c.n); fail++; }
}
console.log(`\n${ok}/${ok+fail} v6 fixes verified`);
process.exit(fail === 0 ? 0 : 1);
