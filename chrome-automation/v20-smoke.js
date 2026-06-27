/**
 * v20-smoke.js — Regression tests for Codex review v20 fixes.
 *
 * v20-HIGH-1: beforePurchaseUrl captured before purchase click (not after)
 * v20-MEDIUM-1: assertBigModelUrl after STEP1/STEP2/STEP3 success
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

// ─── v20-HIGH-1: beforePurchaseUrl captured before click ─────────────────
console.log('\n── v20-HIGH-1: beforePurchaseUrl captured before click ──');

check(
  'beforePurchaseUrl captured before Clicking Pro purchase button section',
  'auto-purchase.js',
  /Clicking Pro purchase button[\s\S]{0,500}beforePurchaseUrl\s*=\s*page\.url/s
);

check(
  'No duplicate beforePurchaseUrl = page.url() inside checkout loop',
  'auto-purchase.js',
  /checkoutDeadline[\s\S]{0,500}beforePurchaseUrl\s*=\s*page\.url/s,
  { negate: true }
);

// ─── v20-MEDIUM-1: assertBigModelUrl after STEP1/STEP2/STEP3 ─────────────
console.log('\n── v20-MEDIUM-1: assertBigModelUrl after STEP1/STEP2/STEP3 ──');

check(
  'assertBigModelUrl called after STEP1 success (post-step1)',
  'auto-purchase.js',
  /assertBigModelUrl\(page\.url\(\),\s*'post-step1'\)/
);

check(
  'assertBigModelUrl called after STEP2 success (post-step2)',
  'auto-purchase.js',
  /assertBigModelUrl\(page\.url\(\),\s*'post-step2'\)/
);

check(
  'assertBigModelUrl called after STEP3 success (post-step3)',
  'auto-purchase.js',
  /assertBigModelUrl\(page\.url\(\),\s*'post-step3'\)/
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v20 smoke tests passed.\n');
