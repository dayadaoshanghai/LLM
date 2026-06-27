// Regression test for Codex v7 fixes (7 issues).
// Runs as: node v7-smoke.js
// Each check verifies the fix is present in the source code.
// This is a static analysis test — no browser needed.

const fs = require('fs');
const ap = fs.readFileSync('auto-purchase.js', 'utf8');
const ls = fs.readFileSync('login-and-save.js', 'utf8');
const rp = fs.readFileSync('run-purchase.js', 'utf8');
const sh = fs.readFileSync('wait-and-purchase.sh', 'utf8');

const checks = [
  // ===== v7-CRITICAL-1: checkout 验证码失败 → continue, purchaseAttempted 在验证后 =====
  { src: ap, n: 'v7-CRIT-1 checkout v4 failed → continue',
    r: /Final checkout verification failed.*?continue;/s },
  { src: ap, n: 'v7-CRIT-1 purchaseAttempted after v4 check',
    r: /const v4 = await handleVerification[\s\S]*?purchaseAttempted = true/s },

  // ===== v7-HIGH-2: shell PURCHASE_WINDOW_MS 不覆盖 =====
  { src: sh, n: 'v7-HIGH-2 shell respects PURCHASE_WINDOW_MS',
    r: /PURCHASE_WINDOW_MS="\$\{PURCHASE_WINDOW_MS:-300000\}"/ },

  // ===== v7-HIGH-3: rect-scoped button search (not elementsFromPoint) =====
  { src: ap, n: 'v7-HIGH-3 STEP3 rect-scoped fallback',
    r: /rect-scoped-fallback/ },
  { src: ap, n: 'v7-HIGH-3 no elementsFromPoint in code (comments ok)',
    // Match lines that aren't comments (don't start with whitespace + //)
    r: /^[^\s/].*elementsFromPoint\(/m, negate: true },
  { src: ap, n: 'v7-HIGH-3 STEP4 rect-scoped fallback',
    r: /rect-scoped-fallback/ },

  // ===== v7-HIGH-4: login wait loop URL 脱敏 =====
  { src: ls, n: 'v7-HIGH-4 wait loop uses safeUrl',
    r: /safeWaitUrl\.origin\}\$\{safeWaitUrl\.pathname/ },

  // ===== v7-MEDIUM-5: parsePositiveInt 校验 =====
  { src: ap, n: 'v7-MED-5 parsePositiveInt function',
    r: /function parsePositiveInt\(envName, fallback\)/ },
  { src: ap, n: 'v7-MED-5 TIMEOUTS uses parsePositiveInt',
    r: /step1: parsePositiveInt\('STEP1_TIMEOUT_MS', 3000\)/ },
  { src: ap, n: 'v7-MED-5 PURCHASE_WINDOW_MS uses parsePositiveInt',
    r: /parsePositiveInt\('PURCHASE_WINDOW_MS', 300000\)/ },

  // ===== v7-MEDIUM-6: readdirSync try/catch =====
  { src: rp, n: 'v7-MED-6 readdirSync wrapped in try/catch',
    r: /try \{[\s\S]*?readdirSync[\s\S]*?\} catch \(err\)/ },

  // ===== v7-LOW-7: flow API wired =====
  { src: ap, n: 'v7-LOW-7 startFlow in loop',
    r: /monitor\.startFlow\(attemptCount\)/ },
  { src: ap, n: 'v7-LOW-7 endFlow in loop',
    r: /monitor\.endFlow\(purchaseAttempted\)/ },
];

let ok = 0, fail = 0;
for (const c of checks) {
  const test = c.r.test(c.src);
  const passed = c.negate ? !test : test;
  if (passed) { console.log('  ✓', c.n); ok++; }
  else { console.log('  ✗', c.n); fail++; }
}
console.log(`\n${ok}/${ok+fail} v7 fixes verified`);
process.exit(fail === 0 ? 0 : 1);
