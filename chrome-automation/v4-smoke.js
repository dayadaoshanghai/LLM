const fs = require('fs');
const ap = fs.readFileSync('auto-purchase.js', 'utf8');
const ls = fs.readFileSync('login-and-save.js', 'utf8');
const sh = fs.readFileSync('wait-and-purchase.sh', 'utf8');
const rp = fs.readFileSync('run-purchase.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const checks = [
  // v4-CRITICAL
  { src: ap, n: 'v4-CRITICAL process.exitCode = 2', r: /process\.exitCode = 2/ },
  // v4-HIGH-1
  { src: ap, n: 'v4-HIGH-1 100% click threshold', r: /clickedCount < targetChars\.length/ },
  { src: ap, n: 'v4-HIGH-1 waitForTextGone defined', r: /async function waitForTextGone/ },
  { src: ap, n: 'v4-HIGH-1 captchaGone called', r: /waitForTextGone\(page, \['请依次点击', '请按顺序点击'\], 3000\)/ },
  // v4-HIGH-2
  { src: ap, n: 'v4-HIGH-2 slide waits for gone', r: /waitForTextGone\(page, \['拖动', '拼图', '滑动'\], 3000\)/ },
  // v4-HIGH-3
  { src: ap, n: 'v4-HIGH-3 verification failed continues', r: /Verification consistently failing — skipping STEP1 and reloading[\s\S]*?continue;/ },
  // v4-HIGH-4
  { src: ls, n: 'v4-HIGH-4 token wait loop', r: /TOKEN_WAIT_MS = 15000/ },
  { src: ls, n: 'v4-HIGH-4 polling', r: /Waiting for bigmodel_token_production to appear/ },
  // v4-HIGH-5
  { src: rp, n: 'v4-HIGH-5 login signal handling', r: /login\.on\('exit', \(code, signal\) =>/ },
  { src: rp, n: 'v4-HIGH-5 purchase signal handling', r: /purchase\.on\('exit', \(code, signal\) =>/ },
  // v4-HIGH-6
  { src: ap, n: 'v4-HIGH-6 CSS.escape used', r: /window\.CSS && CSS\.escape \? CSS\.escape/ },
  { src: ap, n: 'v4-HIGH-6 rect fallback', r: /trying coordinate-based click within Pro card rect/ },
  { src: ap, n: 'v4-HIGH-6 coord fallback STEP4', r: /trying coordinate fallback/ },
  // v4-MEDIUM-1
  { src: ap, n: 'v4-MED-1 waitForAnyText opts', r: /async function waitForAnyText\(page, fragments, opts = \{\}\)/ },
  { src: ap, n: 'v4-MED-1 callers use opts', r: /waitForAnyText\(page, \['继续订阅', '5x Lite 用量额度'\], \{ timeoutMs: 3000 \}\)/ },
  // v4-MEDIUM-2
  { src: rp, n: 'v4-MED-2 caffeinate note', r: /caffeinate -is.*?shell wrapper/i },
  // v4-MEDIUM-3
  { src: ap, n: 'v4-MED-3 TIMEOUTS object', r: /const TIMEOUTS = \{[\s\S]*?step1:\s*parseInt/ },
  // v4-LOW-1
  { src: ap, n: 'v4-LOW-1 dynamic seconds log', r: /timed out after \$\{seconds\} seconds/ },
  // v4-LOW-2
  { src: ls, n: 'v4-LOW-2 login throw', r: /throw new Error\('Login timeout: URL stayed on \/login for 2 minutes'\)/ },
];

let ok = 0, fail = 0;
for (const c of checks) {
  if (c.r.test(c.src)) { console.log('  ✓', c.n); ok++; }
  else { console.log('  ✗', c.n); fail++; }
}
console.log(`\n${ok}/${ok+fail} v4 fixes verified`);
process.exit(fail === 0 ? 0 : 1);