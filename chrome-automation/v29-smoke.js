/**
 * v29-smoke.js — Regression tests for Codex review v29 fixes.
 *
 * v29-MEDIUM-1: auto-purchase.js login redirect check uses URL.pathname,
 *                not full URL. The old regex `/\/(login|register)(\?|#|$|\/)/`
 *                matched `/login` in query strings (e.g. `?redirect=/login`),
 *                false-aborting an authenticated session.
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

// ─── v29-MEDIUM-1: pathname check for login redirect ──────────────────────
console.log('\n── v29-MEDIUM-1: pathname check for login redirect ──');

check(
  'auto-purchase.js: parses URL.pathname into currentPath',
  'auto-purchase.js',
  /const currentPath\s*=\s*new URL\(page\.url\(\)\)\.pathname/
);

check(
  'auto-purchase.js: tests currentPath with login|register regex',
  'auto-purchase.js',
  /\.test\(currentPath\)/
);

check(
  'auto-purchase.js: regex contains login|register alternation',
  'auto-purchase.js',
  /\(login\|register\)/
);

check(
  'auto-purchase.js: regex is anchored to start of pathname',
  'auto-purchase.js',
  /\/\^\\\/\(/
);

check(
  'auto-purchase.js: no longer tests page.url() with old (?|...) regex',
  'auto-purchase.js',
  /\(\?\|#\|\$\|\/\)/,
  { negate: true }
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v29 smoke tests passed.\n');