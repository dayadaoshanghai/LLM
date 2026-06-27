/**
 * v17-smoke.js — Regression tests for Codex review v17 fixes.
 *
 * v17-HIGH-1: cookies.json write-rename-chmod pattern
 * v17-MEDIUM-1: .env.local permission check
 * v17-HIGH-2: STEP3 assertion scoped to Pro card
 * v17-MEDIUM-2: document.body?.innerText null safety
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

// ─── v17-HIGH-1: cookies.json atomic write with chmod ────────────────────
console.log('\n── v17-HIGH-1: cookies.json atomic write with chmod ──');

check(
  'login-and-save.js writes cookies to tmp file first',
  'login-and-save.js',
  /tmpCookiesPath/
);

check(
  'login-and-save.js chmod tmp file before rename',
  'login-and-save.js',
  /chmodSync\(tmpCookiesPath/
);

check(
  'login-and-save.js renames tmp to final path',
  'login-and-save.js',
  /renameSync\(tmpCookiesPath,\s*cookiesPath\)/
);

check(
  'login-and-save.js chmod final path after rename',
  'login-and-save.js',
  /chmodSync\(cookiesPath/
);

// ─── v17-MEDIUM-1: .env.local permission check ───────────────────────────
console.log('\n── v17-MEDIUM-1: .env.local permission check ──');

check(
  'login-and-save.js checks .env.local file permissions',
  'login-and-save.js',
  /st\.mode.*0o077|0o077.*st\.mode/
);

check(
  'login-and-save.js rejects broad permissions with chmod advice',
  'login-and-save.js',
  /chmod 600.*env\.local|permissions are too broad/
);

// ─── v17-HIGH-2: STEP3 assertion scoped to Pro card ──────────────────────
console.log('\n── v17-HIGH-2: STEP3 assertion scoped to Pro card ──');

check(
  'STEP3 assertion uses page.evaluate scoped to proCard selector',
  'auto-purchase.js',
  /step3Asserted.*page\.evaluate.*selector/s
);

check(
  'STEP3 assertion checks annualSelected within card',
  'auto-purchase.js',
  /annualSelected/
);

check(
  'STEP3 assertion checks hasPayButton within card',
  'auto-purchase.js',
  /hasPayButton/
);

check(
  'STEP3 assertion does NOT use page-wide waitForAnyText',
  'auto-purchase.js',
  /waitForAnyText\(page,\s*\['立即购买/,
  { negate: true }
);

// ─── v17-MEDIUM-2: document.body null safety ─────────────────────────────
console.log('\n── v17-MEDIUM-2: document.body null safety ──');

check(
  'auto-purchase.js uses optional chaining on document.body.innerText',
  'auto-purchase.js',
  /document\.body\?\.innerText/
);

check(
  'auto-purchase.js no longer uses bare document.body.innerText',
  'auto-purchase.js',
  /document\.body\.innerText(?!\?)/,
  { negate: true }
);

check(
  'login-and-save.js uses optional chaining on document.body.innerText',
  'login-and-save.js',
  /document\.body\?\.innerText/
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v17 smoke tests passed.\n');
