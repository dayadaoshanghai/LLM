const fs = require('fs');
const ap = fs.readFileSync('auto-purchase.js', 'utf8');
const ls = fs.readFileSync('login-and-save.js', 'utf8');
const sh = fs.readFileSync('wait-and-purchase.sh', 'utf8');

const checks = [
  { src: ap, n: 'P0-1 _safeStringify helper', r: /_safeStringify\(value\) \{/ },
  { src: ap, n: 'P0-2 log uses _safeStringify', r: /dataStr = Object\.keys\(data\)\.length > 0 \? this\._safeStringify\(data\) :/ },
  { src: ap, n: 'P0-2 report summary (not full report)', r: /'Purchase execution report generated'/ },
  { src: ap, n: 'P0-3 captcha no 验证 trigger', r: /text\.includes\('请依次点击'\) \|\| text\.includes\('请按顺序点击'\)/ },
  { src: ap, n: 'P0-3 captcha no unsafe fallback', r: /Click captcha detected but no chars parsed from prompt; refusing unsafe fallback/ },
  { src: ap, n: 'P0-4 STEP4 no global fallback', r: /removed the page-wide button fallback/ },
  { src: ap, n: 'P0-5 STEP4 checkout assertion', r: /\/支付\|订单\|收银台\|确认付款\|checkout\|payment\// },
  { src: ap, n: 'CRITICAL-#6 handleVerification three-state', r: /async function handleVerification\(page\) \{[\s\S]*?'none'[\s\S]*?'handled'[\s\S]*?'failed'/ },
  { src: ap, n: 'CRITICAL-#6 caller checks handled|none', r: /if \(verification === 'handled'\)[\s\S]*?if \(verification === 'none'\)/ },
  { src: ap, n: 'CRITICAL-#6 detected-but-failed returns', r: /'detected-but-failed'/g },
  { src: ls, n: 'HIGH-#7 no username log', r: /Loaded credentials from \.env\.local/ },
  { src: ls, n: 'HIGH-#7 username removed (no GLM_USERNAME in console.log)', neg: true, r: /console\.log.*GLM_USERNAME/ },
  { src: ls, n: 'HIGH-#8 cookies 0600', r: /fs\.writeFileSync\('cookies\.json'[\s\S]*?mode: 0o600/ },
  { src: ap, n: 'HIGH-#9 assertBigModelUrl defined', r: /function assertBigModelUrl/ },
  { src: ap, n: 'HIGH-#9 used after glm-coding goto', r: /assertBigModelUrl\(page\.url\(\), 'glm-coding'\)/ },
  { src: ls, n: 'HIGH-#9 used after login goto', r: /assertBigModelUrl\(page\.url\(\), 'login'\)/ },
  { src: ap, n: 'MEDIUM-#10 screenshot async', r: /async screenshot\(step, page\) \{/ },
  { src: ap, n: 'MEDIUM-#10 try/catch in screenshot', r: /async screenshot\(step, page\) \{[\s\S]*?try \{[\s\S]*?await page\.screenshot[\s\S]*?\} catch \(err\)/ },
  { src: ap, n: 'MEDIUM-#11 try/finally', r: /let browser;[\s\S]*?try \{[\s\S]*?\} finally \{[\s\S]*?if \(browser\)/ },
  { src: ap, n: 'MEDIUM-#11 .catch() wrapper', r: /\}\)\.catch\(err => \{[\s\S]*?process\.exit\(1\)/ },
  { src: ls, n: 'MEDIUM-#11 try/finally in login', r: /let browser;[\s\S]*?try \{[\s\S]*?\} finally \{[\s\S]*?if \(browser\)/ },
  { src: sh, n: 'MEDIUM-#12 caffeinate fallback', r: /if command -v caffeinate >\/dev\/null 2>&1/ },
  { src: sh, n: 'MEDIUM-#12 non-mac warning', r: /caffeinate not found \(non-macOS\)/ },
  { src: ap, n: 'MEDIUM-#13 TARGET_TIME validation', r: /if \(Number\.isNaN\(targetTime\.getTime\(\)\)\) \{[\s\S]*?throw new Error\(`Invalid TARGET_TIME/ },
];

let ok = 0, fail = 0;
for (const c of checks) {
  const m = c.r.test(c.src);
  const pass = c.neg ? !m : m;
  if (pass) { console.log('  ✓', c.n); ok++; }
  else { console.log('  ✗', c.n); fail++; }
}
console.log(`\n${ok}/${ok+fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);