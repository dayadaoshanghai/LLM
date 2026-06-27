// Regression test for Codex v13 fixes (6 issues).
const fs = require('fs');
const ap = fs.readFileSync('auto-purchase.js', 'utf8');
const rp = fs.readFileSync('run-purchase.js', 'utf8');

const checks = [
  // ===== v13-HIGH-1: slide verify → detected-but-failed =====
  { src: ap, n: 'v13-HIGH-1 slide returns detected-but-failed',
    r: /Slide verification skipped during navigation[\s\S]*?return 'detected-but-failed'/ },

  // ===== v13-HIGH-2: evaluatePossibleClick helper =====
  { src: ap, n: 'v13-HIGH-2 evaluatePossibleClick function',
    r: /async function evaluatePossibleClick\(page, fn, arg, successValue\)/ },
  { src: ap, n: 'v13-HIGH-2 STEP3 annualByCoord uses evaluatePossibleClick',
    r: /annualByCoord = await evaluatePossibleClick/ },
  { src: ap, n: 'v13-HIGH-2 STEP3 fragmentClick uses evaluatePossibleClick',
    r: /fragmentClick = await evaluatePossibleClick/ },
  { src: ap, n: 'v13-HIGH-2 STEP4 coordClick uses evaluatePossibleClick',
    r: /coordClick = await evaluatePossibleClick/ },

  // ===== v13-MEDIUM-3: findVisibleByTextContains 竞态 =====
  { src: ap, n: 'v13-MED-3 findVisible try/catch',
    r: /findVisibleByTextContains interrupted during navigation/ },
  { src: ap, n: 'v13-MED-3 findVisible returns null on context error',
    r: /findVisibleByTextContains[\s\S]*?return null[\s\S]*?throw err/ },

  // ===== v13-MEDIUM-4: waitForTextGone pathname =====
  { src: ap, n: 'v13-MED-4 waitForTextGone uses pathname',
    r: /parsed\.pathname/ },

  // ===== v13-MEDIUM-5: signal wait for children =====
  { src: rp, n: 'v13-MED-5 shuttingDown guard',
    r: /shuttingDown = true/ },
  { src: rp, n: 'v13-MED-5 wait for children with timeout',
    r: /Promise\.race\(/ },

  // ===== v13-LOW-6: recordStep wired =====
  { src: ap, n: 'v13-LOW-6 recordStep on STEP1 success',
    r: /monitor\.recordStep\('step1_subscribe'/ },
  { src: ap, n: 'v13-LOW-6 recordStep on STEP1 failure',
    r: /recordStep\('step1_subscribe'[\s\S]*?success: false/ },
  { src: ap, n: 'v13-LOW-6 recordError on verification failure',
    r: /monitor\.recordError\('verification'/ },
];

let ok = 0, fail = 0;
for (const c of checks) {
  const test = c.r.test(c.src);
  const passed = c.negate ? !test : test;
  if (passed) { console.log('  ✓', c.n); ok++; }
  else { console.log('  ✗', c.n); fail++; }
}
console.log(`\n${ok}/${ok+fail} v13 fixes verified`);
process.exit(fail === 0 ? 0 : 1);
