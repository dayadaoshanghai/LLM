/**
 * v26-smoke.js — Regression tests for Codex review v26 fixes.
 *
 * v26-HIGH-1: run-purchase.js launches auto-purchase.js AUTO_PURCHASE_LEAD_MS
 *             (default 60s) before target, not just 2s before. This gives
 *             Chromium/page warmup time before the sale starts.
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

// ─── v26-HIGH-1: AUTO_PURCHASE_LEAD_MS ────────────────────────────────────
console.log('\n── v26-HIGH-1: AUTO_PURCHASE_LEAD_MS ──');

check(
  'run-purchase.js reads AUTO_PURCHASE_LEAD_MS env',
  'run-purchase.js',
  /AUTO_PURCHASE_LEAD_MS/
);

check(
  'run-purchase.js uses autoPurchaseLeadMs (not hardcoded 2000)',
  'run-purchase.js',
  /targetTime\.getTime\(\)\s*-\s*now\.getTime\(\)\s*-\s*autoPurchaseLeadMs/
);

check(
  'run-purchase.js does NOT use hardcoded 2000ms lead',
  'run-purchase.js',
  /targetTime\.getTime\(\)\s*-\s*new Date\(\)\.getTime\(\)\s*-\s*2000/,
  { negate: true }
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v26 smoke tests passed.\n');
