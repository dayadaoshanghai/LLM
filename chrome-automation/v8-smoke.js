// Regression test for Codex v8 fixes (6 issues).
// Static analysis — no browser needed.

const fs = require('fs');
const ap = fs.readFileSync('auto-purchase.js', 'utf8');
const ls = fs.readFileSync('login-and-save.js', 'utf8');
const rp = fs.readFileSync('run-purchase.js', 'utf8');

const checks = [
  // ===== v8-HIGH-1: login wait loop 每轮校验 host =====
  { src: ls, n: 'v8-HIGH-1 assertBigModelUrl in login-wait loop',
    r: /assertBigModelUrl\(url, 'login-wait'\)/ },

  // ===== v8-HIGH-2: execution context 竞态保护 =====
  { src: ap, n: 'v8-HIGH-2 EXEC_CONTEXT_ERR regex',
    r: /Execution context was destroyed/ },
  { src: ap, n: 'v8-HIGH-2 waitForText try/catch',
    r: /if \(!EXEC_CONTEXT_ERR\.test\(err\.message\)\) throw err/ },
  { src: ap, n: 'v8-HIGH-2 waitForAnyText try/catch',
    r: /waitForAnyText[\s\S]*?EXEC_CONTEXT_ERR/ },
  { src: ap, n: 'v8-HIGH-2 waitForTextGone try/catch',
    r: /waitForTextGone[\s\S]*?EXEC_CONTEXT_ERR/ },

  // ===== v8-HIGH-3: URL 脱敏 + 报告 0600 =====
  { src: ap, n: 'v8-HIGH-3 redactUrl function',
    r: /function redactUrl\(url\)/ },
  { src: ap, n: 'v8-HIGH-3 capturePageState uses redactUrl',
    r: /redactUrl\(page\.url\(\)\)/ },
  { src: ap, n: 'v8-HIGH-3 FINAL URL uses redactUrl',
    r: /redactUrl\(page\.url\(\)\)/ },
  { src: ap, n: 'v8-HIGH-3 report writeFileSync mode 0o600',
    r: /writeFileSync\(filename.*mode: 0o600/ },
  { src: ap, n: 'v8-HIGH-3 summary writeFileSync mode 0o600',
    r: /writeFileSync\(summaryFilename.*mode: 0o600/ },

  // ===== v8-MEDIUM-4: cookie domain 校验 =====
  { src: ap, n: 'v8-MED-4 isBigModelCookie function',
    r: /const isBigModelCookie/ },
  { src: ap, n: 'v8-MED-4 bigModelCookies filter',
    r: /const bigModelCookies = cookies\.filter\(isBigModelCookie\)/ },
  { src: ap, n: 'v8-MED-4 setCookie uses bigModelCookies',
    r: /page\.setCookie\(\.\.\.bigModelCookies\)/ },

  // ===== v8-MEDIUM-5: endFlow try/finally =====
  { src: ap, n: 'v8-MED-5 endFlow in finally block',
    r: /\} finally \{\s*monitor\.endFlow\(purchaseAttempted\)/ },

  // ===== v8-MEDIUM-6: 信号转发 =====
  { src: rp, n: 'v8-MED-6 spawnManaged function',
    r: /function spawnManaged\(cmd, args, opts\)/ },
  { src: rp, n: 'v8-MED-6 children Set',
    r: /const children = new Set\(\)/ },
  { src: rp, n: 'v8-MED-6 SIGTERM handler',
    r: /process\.once\(sig/ },
  { src: rp, n: 'v8-MED-6 login uses spawnManaged',
    r: /spawnManaged\('node', \['login-and-save\.js'\]/ },
  { src: rp, n: 'v8-MED-6 purchase uses spawnManaged',
    r: /spawnManaged\('node', \['auto-purchase\.js'\]/ },
];

let ok = 0, fail = 0;
for (const c of checks) {
  const test = c.r.test(c.src);
  const passed = c.negate ? !test : test;
  if (passed) { console.log('  ✓', c.n); ok++; }
  else { console.log('  ✗', c.n); fail++; }
}
console.log(`\n${ok}/${ok+fail} v8 fixes verified`);
process.exit(fail === 0 ? 0 : 1);
