/**
 * v30-smoke.js — Regression tests for Codex review v30 fixes.
 *
 * v30-MEDIUM-1: handleClickVerification walks ALL visible modals (not just
 *                the first DOM-order match). Earlier non-captcha modals no
 *                longer shadow the real captcha.
 *
 * v30-MEDIUM-2: handleSlideVerification walks ALL visible modals + scopes
 *                knob lookup to the captcha root (no page-wide drag).
 *
 * v30-LOW-1:    FATAL error handlers in auto-purchase.js + login-and-save.js
 *                redact URLs in error stacks via redactUrl().
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

// ─── v30-MEDIUM-1: walk all modals in click captcha ────────────────────────
console.log('\n── v30-MEDIUM-1: walk all modals in click captcha ──');

check(
  'auto-purchase.js (click captcha): uses querySelectorAll for modals',
  'auto-purchase.js',
  /\.flatMap\(sel => \[\.\.\.document\.querySelectorAll\(sel\)\]\)/
);

check(
  'auto-purchase.js (click captcha): filters visible (offsetParent)',
  'auto-purchase.js',
  /filter\(candidate => candidate && candidate\.offsetParent !== null\)/
);

check(
  'auto-purchase.js (click captcha): iterates over roots (not single root)',
  'auto-purchase.js',
  /for \(const root of roots\) \{[\s\S]{0,200}for \(const el of candidates\)/
);

check(
  'auto-purchase.js (click captcha): old first-match loop is gone',
  'auto-purchase.js',
  /for \(const sel of modalSelectors\) \{\s*const candidate = document\.querySelector\(sel\);/,
  { negate: true }
);

// ─── v30-MEDIUM-2: walk all modals in slide captcha ────────────────────────
console.log('\n── v30-MEDIUM-2: walk all modals in slide captcha ──');

check(
  'auto-purchase.js (slide captcha): uses querySelectorAll for modals',
  'auto-purchase.js',
  /\.flatMap\(sel => \[\.\.\.document\.querySelectorAll\(sel\)\]\)/
);

check(
  'auto-purchase.js (slide captcha): scopes knob lookup to captcha root',
  'auto-purchase.js',
  /root\.querySelector\(sel\)/
);

check(
  'auto-purchase.js (slide captcha): returns scoped flag',
  'auto-purchase.js',
  /return \{ found: true, scoped: true \}/
);

// ─── v30-LOW-1: redact URLs in FATAL handlers ─────────────────────────────
console.log('\n── v30-LOW-1: redact URLs in FATAL handlers ──');

check(
  'auto-purchase.js FATAL: no longer logs raw stack',
  'auto-purchase.js',
  /console\.error\('\[FATAL\]', err && err\.stack \|\| err\)/,
  { negate: true }
);

check(
  'auto-purchase.js FATAL: redacts URLs in error',
  'auto-purchase.js',
  /raw\.replace\([\s\S]{0,40}https[\s\S]{0,40}redactUrl\(u\)/
);

check(
  'login-and-save.js FATAL: no longer logs raw stack',
  'login-and-save.js',
  /console\.error\('\[FATAL\]', err && err\.stack \|\| err\)/,
  { negate: true }
);

check(
  'login-and-save.js FATAL: redacts URLs in error',
  'login-and-save.js',
  /raw\.replace\([\s\S]{0,40}https[\s\S]{0,80}new URL\(u\)/
);

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n✅ All v30 smoke tests passed.\n');