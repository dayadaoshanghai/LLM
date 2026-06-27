/**
 * v23-smoke.js — Regression tests for Codex review v23 fixes.
 *
 * v23-HIGH-1: findVisibleByTextContains ranks matches by plan-card markers
 *             (avoids leaf nodes like quota rows) + accepts requiredText option
 * v23-MEDIUM-1: STEP4 purchaseResult check accepts only "Clicked:" prefix
 *               (rejects 'Not found' from rect fallback)
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

// ─── v23-HIGH-1: findVisibleByTextContains ranking ───────────────────────
console.log('\n── v23-HIGH-1: findVisibleByTextContains ranking ──');

check(
  'findVisibleByTextContains accepts opts parameter',
  'auto-purchase.js',
  /async function findVisibleByTextContains\(page,\s*fragment,\s*opts\s*=\s*\{\}\)/
);

check(
  'findVisibleByTextContains collects all matches and sorts by score',
  'auto-purchase.js',
  /matches\.sort/
);

check(
  'findVisibleByTextContains score includes 连续包年 (+10)',
  'auto-purchase.js',
  /includes\('连续包年'\)\s*\?\s*10/
);

check(
  'findVisibleByTextContains score includes pay button text (+10)',
  'auto-purchase.js',
  /\.test\(m\.text\)\s*\?\s*10/
);

check(
  'STEP3 calls findVisibleByTextContains with requiredText option',
  'auto-purchase.js',
  /const proCard = await findVisibleByTextContains[\s\S]{0,200}requiredText:/s
);

check(
  'STEP4 calls findVisibleByTextContains with requiredText option',
  'auto-purchase.js',
  /const proCardForBuy = await findVisibleByTextContains[\s\S]{0,200}requiredText:/s
);

// ─── v23-MEDIUM-1: STEP4 purchaseResult check ────────────────────────────
console.log('\n── v23-MEDIUM-1: STEP4 purchaseResult check ──');

check(
  'coordClick assignment guarded by Clicked: prefix check',
  'auto-purchase.js',
  /coordClick\.startsWith\('Clicked:'\)/
);

check(
  'STEP4 purchaseResult check uses Clicked: prefix instead of "No purchase button found"',
  'auto-purchase.js',
  /if\s*\(purchaseResult\.startsWith\('Clicked:'\)\)/
);

check(
  'STEP4 purchaseResult does NOT use the old !== "No purchase button found" check',
  'auto-purchase.js',
  /purchaseResult\s*!==\s*'No purchase button found'/,
  { negate: true }
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v23 smoke tests passed.\n');
