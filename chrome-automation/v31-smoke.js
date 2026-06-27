/**
 * v31-smoke.js — Regression tests for Codex review v31 fixes.
 *
 * v31-MEDIUM-1: handleSlideVerification knob lookup scoped to captcha root
 *               (not page-wide). Detection (v30) was already scoped, but
 *               the solving lookup still used document.querySelectorAll.
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

// ─── v31-MEDIUM-1: scoped knob lookup ────────────────────────────────────
console.log('\n── v31-MEDIUM-1: scoped knob lookup ──');

check(
  'auto-purchase.js: knob lookup uses root.querySelectorAll (not document)',
  'auto-purchase.js',
  /for \(const sel of knobSelectors\) \{[\s\S]{0,60}root\.querySelectorAll\(sel\)/
);

check(
  'auto-purchase.js: knob lookup walks roots (modal + body fallback)',
  'auto-purchase.js',
  /knobSelectors[\s\S]{0,200}root\.querySelectorAll/
);

check(
  'auto-purchase.js: returns no-knob-in-captcha-root (not no-knob)',
  'auto-purchase.js',
  /no-knob-in-captcha-root/
);

check(
  'auto-purchase.js: returns no-slide-captcha-root when no root found',
  'auto-purchase.js',
  /no-slide-captcha-root/
);

check(
  'auto-purchase.js: old page-wide document.querySelectorAll knob lookup is gone',
  'auto-purchase.js',
  /const found = document\.querySelectorAll\(sel\);\s*if \(found\.length > 0\) \{ knob = found\[0\]/,
  { negate: true }
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v31 smoke tests passed.\n');