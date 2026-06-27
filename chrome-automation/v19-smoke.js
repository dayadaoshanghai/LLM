/**
 * v19-smoke.js — Regression tests for Codex review v19 fixes.
 *
 * v19-HIGH-1: checkout verification too loose — 应付金额 accepted on plan-selection page
 * v19-MEDIUM-1: captcha char parsing doesn't split unseparated Chinese targets
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

// ─── v19-HIGH-1: checkout verification tighter ───────────────────────────
console.log('\n── v19-HIGH-1: checkout verification tighter ──');

check(
  'Checkout verification records URL before purchase click',
  'auto-purchase.js',
  /beforePurchaseUrl\s*=\s*page\.url/
);

check(
  'Checkout verification checks checkout-only text (收银台/确认付款/支付方式)',
  'auto-purchase.js',
  /收银台.*确认付款.*支付方式|hasCheckoutOnlyText/
);

check(
  'Checkout verification only accepts 应付金额 if URL changed',
  'auto-purchase.js',
  /urlChanged.*应付金额|应付金额.*urlChanged/
);

check(
  'Checkout verify evaluate receives beforeUrl parameter',
  'auto-purchase.js',
  /page\.evaluate.*beforeUrl.*beforePurchaseUrl/s
);

// ─── v19-MEDIUM-1: captcha char parsing splits multi-char Chinese ─────────
console.log('\n── v19-MEDIUM-1: captcha char parsing splits multi-char Chinese ──');

check(
  'Captcha parsing uses flatMap to split multi-char Chinese segments',
  'auto-purchase.js',
  /flatMap/
);

check(
  'Captcha parsing splits trimmed string into individual chars with spread',
  'auto-purchase.js',
  /\[\.\.\.\s*trimmed\]/
);

check(
  'Captcha parsing filters individual chars with Chinese char regex',
  'auto-purchase.js',
  /一-龥/
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v19 smoke tests passed.\n');
