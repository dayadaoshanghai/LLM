// Regression test for Codex v12 fixes (4 issues).
const fs = require('fs');
const ap = fs.readFileSync('auto-purchase.js', 'utf8');
const ls = fs.readFileSync('login-and-save.js', 'utf8');

const checks = [
  // ===== v12-HIGH-1: HTTPS 校验 =====
  { src: ap, n: 'v12-HIGH-1 auto-purchase protocol check',
    r: /parsed\.protocol !== 'https:'/ },
  { src: ls, n: 'v12-HIGH-1 login protocol check',
    r: /parsed\.protocol !== 'https:'/ },

  // ===== v12-HIGH-2: handleClickVerification evaluate → detected-but-failed =====
  { src: ap, n: 'v12-HIGH-2 EXEC_CONTEXT_ERR in click verify catch',
    r: /Click verification interrupted during navigation/ },
  { src: ap, n: 'v12-HIGH-2 catch returns detected-but-failed',
    r: /handleClickVerification evaluate error[\s\S]*?return 'detected-but-failed'/ },

  // ===== v12-MEDIUM-3: login pathname 判断 =====
  { src: ls, n: 'v12-MED-3 uses pathname regex',
    r: /\/\(login\|register\)\(\\\/\|\$\)\// },
  { src: ls, n: 'v12-MED-3 uses currentUrl not url.includes',
    r: /const currentUrl = new URL\(url\)/ },

  // ===== v12-LOW-4: login 截图 __dirname =====
  { src: ls, n: 'v12-LOW-4 screenshot path.join __dirname',
    r: /path\.join\(__dirname, 'login_before_submit\.png'\)/ },
];

let ok = 0, fail = 0;
for (const c of checks) {
  const test = c.r.test(c.src);
  const passed = c.negate ? !test : test;
  if (passed) { console.log('  ✓', c.n); ok++; }
  else { console.log('  ✗', c.n); fail++; }
}
console.log(`\n${ok}/${ok+fail} v12 fixes verified`);
process.exit(fail === 0 ? 0 : 1);
