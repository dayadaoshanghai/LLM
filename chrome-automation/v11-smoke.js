// Regression test for Codex v11 fixes (3 issues).
const fs = require('fs');
const ap = fs.readFileSync('auto-purchase.js', 'utf8');

const checks = [
  // ===== v11-HIGH-1: clickByExactText evaluate 竞态 =====
  { src: ap, n: 'v11-HIGH-1 clickByExactText try/catch',
    r: /async function clickByExactText[\s\S]*?EXEC_CONTEXT_ERR\.test\(err\.message\)/ },
  { src: ap, n: 'v11-HIGH-1 context-destroyed-after-possible-click',
    r: /context-destroyed-after-possible-click/ },

  // ===== v11-MEDIUM-2: screenshot BASE_DIR =====
  { src: ap, n: 'v11-MED-2 screenshot uses path.join BASE_DIR',
    r: /path\.join\(BASE_DIR, `ss_/ },

  // ===== v11-LOW-3: _safeStringify inside try =====
  { src: ap, n: 'v11-LOW-3 _safeStringify inside try block',
    r: /try \{\s+const dataStr = Object\.keys\(data\)\.length > 0 \? this\._safeStringify\(data\)/ },
];

let ok = 0, fail = 0;
for (const c of checks) {
  const test = c.r.test(c.src);
  const passed = c.negate ? !test : test;
  if (passed) { console.log('  ✓', c.n); ok++; }
  else { console.log('  ✗', c.n); fail++; }
}
console.log(`\n${ok}/${ok+fail} v11 fixes verified`);
process.exit(fail === 0 ? 0 : 1);
