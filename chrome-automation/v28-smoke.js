/**
 * v28-smoke.js — Regression tests for Codex review v28 fixes.
 *
 * v28-MEDIUM-1: TARGET_TIME required in run-purchase.js + wait-and-purchase.sh.
 *                Reject unset OR past values so stale defaults don't silently launch.
 *
 * v28-LOW-1:    login-and-save.js logs only the error category, not errMatch[0].
 *
 * v28-LOW-2:    run-purchase.js uses signalExitCode() helper (128+signum)
 *                for child exit on signal so supervisor can distinguish
 *                killed from normal-fail.
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

// ─── v28-MEDIUM-1: require explicit TARGET_TIME ────────────────────────────
console.log('\n── v28-MEDIUM-1: require explicit TARGET_TIME ──');

check(
  'run-purchase.js: hardcoded default TARGET_TIME is gone',
  'run-purchase.js',
  /TARGET_TIME\s*\|\|\s*['"]2026-06-27T09:59:00/,
  { negate: true }
);

check(
  'run-purchase.js: TARGET_TIME is required (throws if unset)',
  'run-purchase.js',
  /TARGET_TIME is required/
);

check(
  'run-purchase.js: rejects past TARGET_TIME',
  'run-purchase.js',
  /TARGET_TIME is in the past/
);

check(
  'wait-and-purchase.sh: hardcoded default TARGET_ISO is gone',
  'wait-and-purchase.sh',
  /TARGET_ISO=.*2026-06-27T02:00:00/,
  { negate: true }
);

check(
  'wait-and-purchase.sh: uses :? to require TARGET_ISO',
  'wait-and-purchase.sh',
  /: "\$\{TARGET_ISO:\?/
);

// ─── v28-LOW-1: redact login error text ────────────────────────────────────
console.log('\n── v28-LOW-1: redact login error text ──');

check(
  'login-and-save.js: no longer logs errMatch[0] verbatim',
  'login-and-save.js',
  /Login error detected: \$\{errMatch\[0\]\}/,
  { negate: true }
);

check(
  'login-and-save.js: logs only the category',
  'login-and-save.js',
  /Login error detected \(category: \$\{category\}\)/
);

// ─── v28-LOW-2: signalExitCode helper ──────────────────────────────────────
console.log('\n── v28-LOW-2: signalExitCode helper ──');

check(
  'run-purchase.js: defines signalExitCode function',
  'run-purchase.js',
  /function signalExitCode\(signal\)/
);

check(
  'run-purchase.js: signalExitCode uses 128 + signum',
  'run-purchase.js',
  /128\s*\+\s*\(nums\[signal\]\s*\|\|\s*1\)/
);

check(
  'run-purchase.js: loginExit uses signalExitCode on signal',
  'run-purchase.js',
  /loginExit\.signal\s*\?\s*signalExitCode\(loginExit\.signal\)\s*:\s*\(loginExit\.code\s*\|\|\s*1\)/
);

check(
  'run-purchase.js: purchaseExit uses signalExitCode on signal',
  'run-purchase.js',
  /purchaseExit\.signal\s*\?\s*signalExitCode\(purchaseExit\.signal\)\s*:\s*\(purchaseExit\.code\s*\?\?\s*1\)/
);

check(
  'run-purchase.js: bare `code === null ? 1 : code` is gone',
  'run-purchase.js',
  /purchaseExit\.code === null \? 1 : purchaseExit\.code/,
  { negate: true }
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v28 smoke tests passed.\n');