/**
 * v24-smoke.js — Regression tests for Codex review v24 fixes.
 *
 * v24-HIGH-1: captcha tile scope walks up from prompt element via closest()
 *             to find actual captcha modal containing tiles
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

// ─── v24-HIGH-1: captcha tile scope walks up ─────────────────────────────
console.log('\n── v24-HIGH-1: captcha tile scope walks up ──');

check(
  'Renamed variable: promptEl replaces verificationContainer',
  'auto-purchase.js',
  /let promptEl = null/
);

check(
  'captchaScope uses closest() to walk up from promptEl to modal',
  'auto-purchase.js',
  /promptEl\.closest\(/s
);

check(
  'captchaScope falls back to root when closest finds nothing',
  'auto-purchase.js',
  /closest\([\s\S]{0,200}root\s*\|\|\s*document/
);

check(
  'No remaining references to old verificationContainer variable',
  'auto-purchase.js',
  /verificationContainer/,
  { negate: true }
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v24 smoke tests passed.\n');
