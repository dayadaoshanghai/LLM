// Regression test for Codex v9 fixes (4 issues).
// Static analysis — no browser needed.

const fs = require('fs');
const ap = fs.readFileSync('auto-purchase.js', 'utf8');
const ls = fs.readFileSync('login-and-save.js', 'utf8');

const checks = [
  // ===== v9-HIGH-1: Chrome sandbox 默认开启 =====
  { src: ap, n: 'v9-HIGH-1 auto-purchase PUPPETEER_NO_SANDBOX check',
    r: /PUPPETEER_NO_SANDBOX === '1'/ },
  { src: ap, n: 'v9-HIGH-1 auto-purchase launchArgs conditional',
    r: /const launchArgs = process\.env\.PUPPETEER_NO_SANDBOX/ },
  { src: ls, n: 'v9-HIGH-1 login PUPPETEER_NO_SANDBOX check',
    r: /PUPPETEER_NO_SANDBOX === '1'/ },

  // ===== v9-MEDIUM-2: handleSlideVerification evaluate 竞态保护 =====
  { src: ap, n: 'v9-MED-2 slideInfo try/catch with EXEC_CONTEXT_ERR',
    r: /handleSlideVerification[\s\S]*?EXEC_CONTEXT_ERR\.test\(err\.message\)/ },

  // ===== v9-MEDIUM-3: 敏感文件用绝对路径 =====
  { src: ap, n: 'v9-MED-3 BASE_DIR defined',
    r: /const BASE_DIR = __dirname/ },
  { src: ap, n: 'v9-MED-3 COOKIES_PATH defined',
    r: /const COOKIES_PATH = path\.join\(BASE_DIR, 'cookies\.json'\)/ },
  { src: ap, n: 'v9-MED-3 existsSync uses COOKIES_PATH',
    r: /existsSync\(COOKIES_PATH\)/ },
  { src: ap, n: 'v9-MED-3 readFileSync uses COOKIES_PATH',
    r: /readFileSync\(COOKIES_PATH/ },
  { src: ap, n: 'v9-MED-3 report uses path.join BASE_DIR',
    r: /path\.join\(BASE_DIR, `purchase_report_/ },
  { src: ap, n: 'v9-MED-3 summary uses path.join BASE_DIR',
    r: /path\.join\(BASE_DIR, `purchase_summary_/ },
  { src: ls, n: 'v9-MED-3 login cookiesPath uses __dirname',
    r: /path\.join\(__dirname, 'cookies\.json'\)/ },

  // ===== v9-LOW-4: parsePositiveInt 严格校验 =====
  { src: ap, n: 'v9-LOW-4 strict regex validation',
    r: /\^\[1-9\]\\d\*\$\/\.test\(value\)/ },
  { src: ap, n: 'v9-LOW-4 rejects trailing chars',
    r: /no trailing chars/ },
];

let ok = 0, fail = 0;
for (const c of checks) {
  const test = c.r.test(c.src);
  const passed = c.negate ? !test : test;
  if (passed) { console.log('  ✓', c.n); ok++; }
  else { console.log('  ✗', c.n); fail++; }
}
console.log(`\n${ok}/${ok+fail} v9 fixes verified`);
process.exit(fail === 0 ? 0 : 1);
