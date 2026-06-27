/**
 * v16-smoke.js — Regression tests for Codex review v16 fixes.
 *
 * v16-MEDIUM-1: login-and-save.js login button click EXEC_CONTEXT_ERR protection
 * v16-MEDIUM-2: STEP2 failed assertion retries instead of continuing
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

// ─── v16-MEDIUM-1: login button click EXEC_CONTEXT_ERR ───────────────────
console.log('\n── v16-MEDIUM-1: login button click EXEC_CONTEXT_ERR ──');

check(
  'login-and-save.js login click evaluate wrapped in try/catch',
  'login-and-save.js',
  /try\s*\{[^}]*loginClicked.*page\.evaluate.*btn\.click/s
);

check(
  'login-and-save.js login click catch handles EXEC_CONTEXT_ERR',
  'login-and-save.js',
  /EXEC_CONTEXT_ERR\.test[\s\S]{0,60}loginClicked\s*=\s*true/s
);

check(
  'login-and-save.js login click EXEC_CONTEXT_ERR logs and continues',
  'login-and-save.js',
  /Login click likely triggered navigation/
);

// ─── v16-MEDIUM-2: STEP2 failed assertion retries ────────────────────────
console.log('\n── v16-MEDIUM-2: STEP2 failed assertion retries ──');

check(
  'STEP2 assertion failure retries with continue',
  'auto-purchase.js',
  /step2Asserted.*\n.*continue/s
);

check(
  'STEP2 assertion failure logs retry reason',
  'auto-purchase.js',
  /no plan cards appeared.*retrying/
);

check(
  'STEP2 assertion failure records step with success: false',
  'auto-purchase.js',
  /step2_continue.*success:\s*false/s
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v16 smoke tests passed.\n');
