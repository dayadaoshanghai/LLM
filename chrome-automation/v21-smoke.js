/**
 * v21-smoke.js — Regression tests for Codex review v21 fixes.
 *
 * v21-MEDIUM-1: captcha lookup uses scoped candidates (not full-page scan)
 * v21-MEDIUM-2: captcha prompt over-capture filtering (intersection with clickable candidates)
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

// ─── v21-MEDIUM-1: captcha lookup uses scoped candidates ─────────────────
console.log('\n── v21-MEDIUM-1: captcha lookup uses scoped candidates ──');

check(
  'findClickableElementFromCandidates helper exists',
  'auto-purchase.js',
  /function findClickableElementFromCandidates/
);

check(
  'Click loop uses findClickableElementFromCandidates with verificationInfo',
  'auto-purchase.js',
  /findClickableElementFromCandidates\([^,]+,\s*verificationInfo\.clickableElements\)/
);

// ─── v21-MEDIUM-2: captcha prompt over-capture filtering ─────────────────
console.log('\n── v21-MEDIUM-2: captcha prompt over-capture filtering ──');

check(
  'captcha prompt regex is tightened (one of the two patterns)',
  'auto-purchase.js',
  /点击[\s\S]{0,30}一-龥/
);

check(
  'charsToClick builds AFTER clickableElements collection',
  'auto-purchase.js',
  /clickableElements[\s\S]{0,400}candidateTexts\s*=\s*new Set/s
);

check(
  'Target chars filtered by intersection with clickable candidates',
  'auto-purchase.js',
  /candidateTexts\.has\(trimmed\)/,
);

check(
  'Prompt prefix like 下图中 is stripped',
  'auto-purchase.js',
  /下图中\(?:的\)\?|图中\(?:的\)\?|文字|字符/
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v21 smoke tests passed.\n');
