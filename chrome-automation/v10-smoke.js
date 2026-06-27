// Regression test for Codex v10 fixes (4 issues).
const fs = require('fs');
const ap = fs.readFileSync('auto-purchase.js', 'utf8');
const ls = fs.readFileSync('login-and-save.js', 'utf8');
const rp = fs.readFileSync('run-purchase.js', 'utf8');

const checks = [
  // ===== v10-HIGH-1: spawn 绝对路径 + cwd =====
  { src: rp, n: 'v10-HIGH-1 login absolute path',
    r: /path\.join\(__dirname, 'login-and-save\.js'\)/ },
  { src: rp, n: 'v10-HIGH-1 login cwd __dirname',
    r: /cwd: __dirname/ },
  { src: rp, n: 'v10-HIGH-1 purchase absolute path',
    r: /path\.join\(__dirname, 'auto-purchase\.js'\)/ },
  { src: rp, n: 'v10-HIGH-1 process.execPath',
    r: /process\.execPath/ },

  // ===== v10-HIGH-2: token 过期 + login 重定向检查 =====
  { src: ap, n: 'v10-HIGH-2 tokenExpiresAt check',
    r: /tokenExpiresAt && tokenExpiresAt <= Date\.now\(\) \+ 60000/ },
  { src: ap, n: 'v10-HIGH-2 expired token error message',
    r: /is expired or expires within 60s/ },
  { src: ap, n: 'v10-HIGH-2 login redirect after goto check',
    r: /redirected to login\/register/ },

  // ===== v10-MEDIUM-3: login evaluate 竞态 =====
  { src: ls, n: 'v10-MED-3 EXEC_CONTEXT_ERR in login',
    r: /EXEC_CONTEXT_ERR/ },
  { src: ls, n: 'v10-MED-3 login evaluate try/catch',
    r: /EXEC_CONTEXT_ERR\.test\(err\.message\)/ },

  // ===== v10-MEDIUM-4: checkout 轮询竞态 =====
  { src: ap, n: 'v10-MED-4 checkoutDeadline polling',
    r: /checkoutDeadline/ },
  { src: ap, n: 'v10-MED-4 checkout loop with EXEC_CONTEXT_ERR',
    r: /EXEC_CONTEXT_ERR\.test\(err\.message\).*?throw err/s },
];

let ok = 0, fail = 0;
for (const c of checks) {
  const test = c.r.test(c.src);
  const passed = c.negate ? !test : test;
  if (passed) { console.log('  ✓', c.n); ok++; }
  else { console.log('  ✗', c.n); fail++; }
}
console.log(`\n${ok}/${ok+fail} v10 fixes verified`);
process.exit(fail === 0 ? 0 : 1);
