/**
 * v27-smoke.js — Regression tests for Codex review v27 fixes.
 *
 * v27-MEDIUM-1: auto-purchase.js waits until exact TARGET_TIME (no -2000 buffer).
 *               run-purchase.js already handles AUTO_PURCHASE_LEAD_MS warmup,
 *               so the inner 2s buffer would fire the first click before target.
 *
 * v27-MEDIUM-2: After post-checkout handleVerification returns 'failed',
 *               auto-purchase.js navigates back to https://bigmodel.cn/glm-coding
 *               (not just page.reload which keeps checkout URL).
 *
 * v27-LOW-1:    wait-and-purchase.sh uses BASH_SOURCE[0] + absolute SCRIPT_PATH
 *               for the caffeinate re-exec (works with relative $0 invocation).
 */

const fs   = require('fs');
const path = require('path');
const assert = require('assert');

const BASE = path.join(__dirname);

// ─── Helper ───────────────────────────────────────────────────────────────
function check(label, file, regex, { negate = false } = {}) {
  const src = fs.readFileSync(path.join(BASE, file), 'utf8');
  const ok  = regex.test(src);
  const pass = negate ? !ok : ok;
  assert(pass, `${label}: ${negate ? 'should NOT match' : 'should match'} ${regex} in ${file}`);
  console.log(`  ✓ ${label}`);
}

// ─── v27-MEDIUM-1: remove -2000 buffer ─────────────────────────────────────
console.log('\n── v27-MEDIUM-1: remove -2000 buffer ──');

check(
  'auto-purchase.js: waitMs no longer subtracts 2000',
  'auto-purchase.js',
  /targetTime\.getTime\(\)\s*-\s*now\.getTime\(\)\s*-\s*2000/,
  { negate: true }
);

check(
  'auto-purchase.js: loop recompute no longer subtracts 2000',
  'auto-purchase.js',
  /waitMs\s*=\s*targetTime\.getTime\(\)\s*-\s*new Date\(\)\.getTime\(\)\s*-\s*2000/,
  { negate: true }
);

check(
  'auto-purchase.js: waitMs uses plain targetTime - now',
  'auto-purchase.js',
  /targetTime\.getTime\(\)\s*-\s*now\.getTime\(\)/
);

check(
  'auto-purchase.js: loop recompute uses plain targetTime - new Date',
  'auto-purchase.js',
  /waitMs\s*=\s*targetTime\.getTime\(\)\s*-\s*new Date\(\)\.getTime\(\)/
);

check(
  'auto-purchase.js: WAIT log no longer says "2 seconds before target"',
  'auto-purchase.js',
  /2 seconds before target/,
  { negate: true }
);

check(
  'auto-purchase.js: WAIT log says "Waiting until target"',
  'auto-purchase.js',
  /Waiting until target/
);

// ─── v27-MEDIUM-2: navigate back to glm-coding after post-checkout verify fail ──
console.log('\n── v27-MEDIUM-2: navigate back after post-checkout verify fail ──');

check(
  'auto-purchase.js: post-v4-failure path logs "returning to product page"',
  'auto-purchase.js',
  /returning to product page before retry/
);

check(
  'auto-purchase.js: post-v4-failure path calls page.goto glm-coding',
  'auto-purchase.js',
  /page\.goto\('https:\/\/bigmodel\.cn\/glm-coding'[\s\S]{0,400}post-v4-failure-reset/
);

check(
  'auto-purchase.js: post-v4-failure path uses assertBigModelUrl',
  'auto-purchase.js',
  /assertBigModelUrl\(page\.url\(\),\s*'post-v4-failure-reset'\)/
);

// ─── v27-LOW-1: BASH_SOURCE in wait-and-purchase.sh ────────────────────────
console.log('\n── v27-LOW-1: BASH_SOURCE in wait-and-purchase.sh ──');

check(
  'wait-and-purchase.sh: uses BASH_SOURCE[0] for SCRIPT_DIR',
  'wait-and-purchase.sh',
  /SCRIPT_DIR=.*BASH_SOURCE\[0\]/
);

check(
  'wait-and-purchase.sh: defines absolute SCRIPT_PATH',
  'wait-and-purchase.sh',
  /SCRIPT_PATH=.*basename.*BASH_SOURCE\[0\]/
);

check(
  'wait-and-purchase.sh: cd uses absolute SCRIPT_DIR',
  'wait-and-purchase.sh',
  /cd "\$SCRIPT_DIR"/
);

check(
  'wait-and-purchase.sh: caffeinate re-exec uses SCRIPT_PATH not $0',
  'wait-and-purchase.sh',
  /exec caffeinate -is "\$SCRIPT_PATH"/
);

check(
  'wait-and-purchase.sh: bare `cd "$(dirname "$0")"` is gone',
  'wait-and-purchase.sh',
  /^cd "\$\(dirname "\$0"\)"$/m,
  { negate: true }
);

check(
  'wait-and-purchase.sh: bare `exec caffeinate -is "$0"` is gone',
  'wait-and-purchase.sh',
  /exec caffeinate -is "\$0"/,
  { negate: true }
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v27 smoke tests passed.\n');