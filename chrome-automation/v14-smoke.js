/**
 * v14-smoke.js — Regression tests for Codex review v14 fixes.
 *
 * v14-HIGH-1: waitForTextGone returns 'off-host' when page leaves bigmodel.cn
 * v14-HIGH-2: run-purchase.js defers login until LOGIN_LEAD_MS before target
 * v14-HIGH-3: wait-and-purchase.sh execs run-purchase.js, not auto-purchase.js
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

// ─── v14-HIGH-1: waitForTextGone off-host detection ──────────────────────
console.log('\n── v14-HIGH-1: waitForTextGone off-host detection ──');

check(
  'waitForTextGone returns off-host when off bigmodel.cn',
  'auto-purchase.js',
  /off-host.*return|return.*off-host/
);

check(
  'waitForTextGone evaluate checks offHost flag',
  'auto-purchase.js',
  /offHost.*onBigModel|onBigModel.*offHost/
);

check(
  'waitForTextGone evaluate builds onBigModel from hostname',
  'auto-purchase.js',
  /parsed\.hostname.*bigmodel\.cn|bigmodel\.cn.*parsed\.hostname/
);

check(
  'waitForTextGone off-host check precedes login-redirect check',
  'auto-purchase.js',
  /off-host.*\n.*login-redirect|offHost.*\n.*onLogin/s
);

// ─── v14-HIGH-2: run-purchase.js login timing ────────────────────────────
console.log('\n── v14-HIGH-2: run-purchase.js login timing ──');

check(
  'run-purchase.js reads LOGIN_LEAD_MS env',
  'run-purchase.js',
  /LOGIN_LEAD_MS/
);

check(
  'run-purchase.js has pre-login wait loop',
  'run-purchase.js',
  /preLoginWaitMs/
);

check(
  'run-purchase.js has parsePositiveInt helper',
  'run-purchase.js',
  /parsePositiveInt/
);

check(
  'run-purchase.js parsePositiveInt validates with strict regex',
  'run-purchase.js',
  /\^\[1-9\]\\d\*\$/
);

// ─── v14-HIGH-3: wait-and-purchase.sh delegates to run-purchase.js ──────
console.log('\n── v14-HIGH-3: wait-and-purchase.sh execs run-purchase.js ──');

check(
  'wait-and-purchase.sh execs run-purchase.js (not auto-purchase.js)',
  'wait-and-purchase.sh',
  /exec\s+node\s+run-purchase\.js/
);

check(
  'wait-and-purchase.sh does NOT directly run auto-purchase.js (non-comment lines)',
  'wait-and-purchase.sh',
  /^[^\s#].*auto-purchase\.js/m,
  { negate: true }
);

check(
  'wait-and-purchase.sh exports TARGET_TIME for run-purchase.js',
  'wait-and-purchase.sh',
  /export\s+TARGET_TIME/
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v14 smoke tests passed.\n');
