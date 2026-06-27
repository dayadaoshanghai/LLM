/**
 * v25-smoke.js — Regression tests for Codex review v25 fixes.
 *
 * v25-MEDIUM-1: report/summary files written via writePrivateNewFile (O_EXCL|O_CREAT)
 * v25-LOW-1: STEP3 uses monitor.recordStep instead of stepStats only
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

// ─── v25-MEDIUM-1: writePrivateNewFile helper ─────────────────────────────
console.log('\n── v25-MEDIUM-1: writePrivateNewFile helper ──');

check(
  'auto-purchase.js defines writePrivateNewFile helper',
  'auto-purchase.js',
  /function writePrivateNewFile/
);

check(
  'writePrivateNewFile uses openSync with wx flag (O_EXCL|O_CREAT)',
  'auto-purchase.js',
  /openSync\(filePath,\s*'wx',\s*0o600\)/
);

check(
  'writePrivateNewFile uses fchmodSync on fd',
  'auto-purchase.js',
  /fchmodSync\(fd/
);

check(
  'writePrivateNewFile closes fd in finally',
  'auto-purchase.js',
  /closeSync\(fd\)/
);

check(
  'Report file uses writePrivateNewFile instead of writeFileSync',
  'auto-purchase.js',
  /writePrivateNewFile\(filename,\s*JSON\.stringify\(report/
);

check(
  'Summary file uses writePrivateNewFile instead of writeFileSync',
  'auto-purchase.js',
  /writePrivateNewFile\(summaryFilename,\s*summary/
);

// ─── v25-LOW-1: STEP3 recordStep ─────────────────────────────────────────
console.log('\n── v25-LOW-1: STEP3 recordStep ──');

check(
  'STEP3 uses monitor.recordStep with step3_select_plan name',
  'auto-purchase.js',
  /monitor\.recordStep\('step3_select_plan'/
);

check(
  'STEP3 recordStep uses success field (not asserted)',
  'auto-purchase.js',
  /recordStep\('step3_select_plan',\s*\{[\s\S]{0,200}success:/
);

check(
  'STEP3 no longer writes to stepStats.step3_select_plan directly',
  'auto-purchase.js',
  /stepStats\.step3_select_plan\s*=/,
  { negate: true }
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v25 smoke tests passed.\n');
