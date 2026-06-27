/**
 * v18-smoke.js — Regression tests for Codex review v18 fixes.
 *
 * v18-HIGH-1: auto-purchase.js cookies.json permission check
 * v18-MEDIUM-1: STEP3 assertion rect fallback + EXEC_CONTEXT_ERR guard
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

// ─── v18-HIGH-1: cookies.json permission check ───────────────────────────
console.log('\n── v18-HIGH-1: cookies.json permission check ──');

check(
  'auto-purchase.js defines assertPrivateFile function',
  'auto-purchase.js',
  /function assertPrivateFile/
);

check(
  'auto-purchase.js assertPrivateFile checks mode & 0o077',
  'auto-purchase.js',
  /0o077/
);

check(
  'auto-purchase.js calls assertPrivateFile on COOKIES_PATH',
  'auto-purchase.js',
  /assertPrivateFile\(COOKIES_PATH/
);

// ─── v18-MEDIUM-1: STEP3 assertion rect fallback + EXEC_CONTEXT_ERR ──────
console.log('\n── v18-MEDIUM-1: STEP3 assertion rect fallback + EXEC_CONTEXT_ERR ──');

check(
  'STEP3 assertion evaluate passes rect to page.evaluate',
  'auto-purchase.js',
  /rect:\s*proCard.*rect/
);

check(
  'STEP3 assertion evaluate has rect-based fallback when selector is null',
  'auto-purchase.js',
  /rect.*getBoundingClientRect|getBoundingClientRect.*rect/
);

check(
  'STEP3 assertion evaluate is wrapped in try/catch for EXEC_CONTEXT_ERR',
  'auto-purchase.js',
  /step3Asserted.*try\s*\{[\s\S]{0,200}page\.evaluate[\s\S]{0,500}EXEC_CONTEXT_ERR/s
);

check(
  'STEP3 assertion EXEC_CONTEXT_ERR logs interruption',
  'auto-purchase.js',
  /Plan assertion interrupted during navigation/
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v18 smoke tests passed.\n');
