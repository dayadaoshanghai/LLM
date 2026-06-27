/**
 * v22-smoke.js — Regression tests for Codex review v22 fixes.
 *
 * v22-MEDIUM-1: captcha tile candidates scoped to verificationContainer (not document)
 * v22-LOW-1: cookies tmp file uses openSync 'wx' flag (O_EXCL|O_CREAT) to prevent symlink attacks
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

// ─── v22-MEDIUM-1: captcha tile candidates scoped ─────────────────────────
console.log('\n── v22-MEDIUM-1: captcha tile candidates scoped ──');

check(
  'tileCandidates uses verificationContainer (captchaScope) instead of document',
  'auto-purchase.js',
  /captchaScope\.querySelectorAll|verificationContainer.*querySelectorAll/s
);

check(
  'tileCandidates no longer uses document.querySelectorAll directly',
  'auto-purchase.js',
  /tileCandidates\s*=\s*document\.querySelectorAll/,
  { negate: true }
);

// ─── v22-LOW-1: cookies tmp file symlink-safe ─────────────────────────────
console.log('\n── v22-LOW-1: cookies tmp file symlink-safe ──');

check(
  'login-and-save.js uses openSync with wx flag for tmp file',
  'login-and-save.js',
  /openSync\(tmpCookiesPath,\s*'wx',\s*0o600\)/
);

check(
  'login-and-save.js uses fchmodSync on file descriptor',
  'login-and-save.js',
  /fchmodSync\(fd/
);

check(
  'login-and-save.js closes file descriptor in finally',
  'login-and-save.js',
  /closeSync\(fd\)/
);

check(
  'login-and-save.js no longer uses writeFileSync directly on tmp path',
  'login-and-save.js',
  /writeFileSync\(tmpCookiesPath/,
  { negate: true }
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v22 smoke tests passed.\n');
