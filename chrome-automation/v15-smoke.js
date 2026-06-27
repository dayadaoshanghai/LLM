/**
 * v15-smoke.js — Regression tests for Codex review v15 fixes.
 *
 * v15-HIGH-1: STEP3 failed assertion continues to STEP4 → should retry
 * v15-MEDIUM-1: Signal-triggered browser cleanup in both JS files
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

// ─── v15-HIGH-1: STEP3 failed assertion retries ──────────────────────────
console.log('\n── v15-HIGH-1: STEP3 failed assertion retries ──');

check(
  'STEP3 assertion failure retries with continue',
  'auto-purchase.js',
  /step3Asserted.*\n.*continue/s
);

check(
  'STEP3 assertion failure does NOT mention continuing to STEP4',
  'auto-purchase.js',
  /continuing to STEP4/,
  { negate: true }
);

// ─── v15-MEDIUM-1: Signal-triggered browser cleanup ──────────────────────
console.log('\n── v15-MEDIUM-1: Signal-triggered browser cleanup ──');

check(
  'auto-purchase.js defines installSignalCleanup',
  'auto-purchase.js',
  /function installSignalCleanup/
);

check(
  'auto-purchase.js calls installSignalCleanup with browser getter',
  'auto-purchase.js',
  /installSignalCleanup\(\(\)\s*=>\s*browser\)/
);

check(
  'auto-purchase.js installSignalCleanup handles SIGINT/SIGTERM/SIGHUP',
  'auto-purchase.js',
  /SIGINT.*SIGTERM.*SIGHUP|SIGHUP.*SIGTERM.*SIGINT/
);

check(
  'auto-purchase.js installSignalCleanup closes browser before process.exit',
  'auto-purchase.js',
  /browser\.close.*process\.exit|await browser\.close/
);

check(
  'login-and-save.js defines installSignalCleanup',
  'login-and-save.js',
  /function installSignalCleanup/
);

check(
  'login-and-save.js calls installSignalCleanup with browser getter',
  'login-and-save.js',
  /installSignalCleanup\(\(\)\s*=>\s*browser\)/
);

check(
  'login-and-save.js installSignalCleanup closes browser before process.exit',
  'login-and-save.js',
  /browser\.close.*process\.exit|await browser\.close/
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v15 smoke tests passed.\n');
