const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Fix 2026-06-27 (Codex v9-MEDIUM-3): all sensitive file reads/writes use
// __dirname-based paths so the scripts work correctly regardless of cwd.
// Previously, `node /path/auto-purchase.js` from a different directory would
// read/write cookies/reports to the wrong location.
const BASE_DIR = __dirname;
const COOKIES_PATH = path.join(BASE_DIR, 'cookies.json');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Fix 2026-06-27 (Codex v25-MEDIUM-1): write file atomically with O_EXCL|O_CREAT
// so a pre-existing symlink or file at the target path triggers EEXIST instead
// of silently following. Used for report/summary files which contain purchase
// URL data.
function writePrivateNewFile(filePath, contents) {
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, contents);
    try { fs.fchmodSync(fd, 0o600); } catch { /* chmod not supported */ }
  } finally {
    fs.closeSync(fd);
  }
}

// Fix 2026-06-27 (Codex v15-MEDIUM-1): Node.js default SIGINT/SIGTERM handling
// does not run async finally blocks, so browser.close() in finally is skipped
// when the process is killed. This leaves Chrome processes orphaned. Install
// signal handlers that close the browser before exiting.
let _shuttingDown = false;
function installSignalCleanup(getBrowser) {
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(sig, async () => {
      if (_shuttingDown) return;
      _shuttingDown = true;
      const browser = getBrowser();
      if (browser) {
        try { await browser.close(); } catch { /* ignore during shutdown */ }
      }
      const sigNum = sig === 'SIGINT' ? 2 : sig === 'SIGTERM' ? 15 : 1;
      process.exit(128 + sigNum);
    });
  }
}

// Fix 2026-06-27 (Codex v7-MEDIUM-5): parseInt without validation turns
// invalid env values into NaN, which makes all wait comparisons fail
// immediately. Parse with validation so bad config surfaces at startup.
// Fix 2026-06-27 (Codex v9-LOW-4): use strict regex so "3000abc" or "1m"
// are rejected instead of silently parsed as 3000 / 1.
function parsePositiveInt(envName, fallback) {
  const raw = process.env[envName];
  const value = raw == null || raw === '' ? String(fallback) : raw;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`Invalid ${envName}: "${raw}". Must be a positive integer (no trailing chars).`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${envName}: "${raw}" (parsed as ${n}). Must be a positive integer.`);
  }
  return n;
}

const TIMEOUTS = {
  step1: parsePositiveInt('STEP1_TIMEOUT_MS', 3000),
  step2: parsePositiveInt('STEP2_TIMEOUT_MS', 3000),
  step3: parsePositiveInt('STEP3_TIMEOUT_MS', 3000),
  step4Wait: parsePositiveInt('STEP4_TIMEOUT_MS', 3000),
  captchaGone: parsePositiveInt('CAPTCHA_GONE_TIMEOUT_MS', 3000)
};

// Fix 2026-06-27: assert any page we visit is still on bigmodel.cn. Catches
// silent redirects to phishing clones or login-wall services that would
// otherwise receive our cookies and click events.
// Fix 2026-06-27 (Codex v2-HIGH-1): the previous `host.endsWith('bigmodel.cn')`
// also matched `evilbigmodel.cn`. Require exact match on `bigmodel.cn` or any
// subdomain `*.bigmodel.cn`.
// Fix 2026-06-27 (Codex v12-HIGH-1): also verify HTTPS. A downgrade to HTTP
// would let network observers intercept session tokens and credentials.
function assertBigModelUrl(url, label = 'page') {
  let parsed;
  try { parsed = new URL(url); }
  catch { throw new Error(`[${label}] not a valid URL: ${url}`); }
  if (parsed.protocol !== 'https:') {
    throw new Error(`[${label}] unexpected protocol "${parsed.protocol}" — expected https:. Aborting.`);
  }
  const host = parsed.hostname;
  if (host !== 'bigmodel.cn' && !host.endsWith('.bigmodel.cn')) {
    throw new Error(`[${label}] unexpected host "${host}" — expected bigmodel.cn or *.bigmodel.cn. Aborting.`);
  }
}

// Fix 2026-06-27 (Codex v8-HIGH-3): redact URL for logging — strip query and
// hash which may contain session tokens, order IDs, or payment parameters.
function redactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}

// Fix 2026-06-27 (Codex v18-HIGH-1): verify sensitive files (cookies.json,
// .env.local) are not group/world-readable. On shared machines, default umask
// creates files with 0644 permissions, exposing session tokens.
function assertPrivateFile(filePath, label) {
  try {
    const st = fs.statSync(filePath);
    if ((st.mode & 0o077) !== 0) {
      throw new Error(`${label} permissions are too broad (mode ${(st.mode & 0o777).toString(8)}); run: chmod 600 ${filePath}`);
    }
  } catch (err) {
    if (err && err.message && err.message.includes('permissions are too broad')) throw err;
    // statSync failed (file doesn't exist, etc.) — let the caller handle that
  }
}

// ============ PAGE-SIDE HELPERS (2026-06-27 structural refactor) ============
// Codex review structural improvement #4: replace `querySelectorAll('*') +
// textContent` full-page scans with scoped, visibility-filtered lookups.
// Reused by every purchase step (STEP1-4) and verification flows. Keeps
// selectors stable against layout shifts and prevents matching nav-bar /
// footer / copyright text by accident.

// Click a visible element whose trimmed text equals `text` (or contains `text`
// when opts.contains is true). Returns {ok, reason} on click vs miss. Use for
// buttons like "即刻订阅" / "继续订阅" / "登录" (exact) and "立即购买 ¥399/年"
// (contains).
// Fix 2026-06-27 (Codex v2-MEDIUM-1): added contains mode + whitespace
// normalisation. Buttons with inline price/label text would otherwise miss
// every exact-match attempt.
async function clickByExactText(page, text, opts = {}) {
  const scopeSel = opts.scope || null;
  // Fix 2026-06-27 (Codex v11-HIGH-1): page.evaluate with el.click()
  // can throw "Execution context was destroyed" if the click triggers SPA/full
  // navigation. Previously this would crash the entire script. Now: if context
  // is destroyed right after a click, it likely means the click worked and
  // triggered navigation — return ok:true so the caller's state assertion can
  // confirm. Avoid retrying the click (which would double-fire).
  try {
    return await page.evaluate(({ t, scopeSel, contains }) => {
      const root = scopeSel ? document.querySelector(scopeSel) : document;
      if (!root) return { ok: false, reason: 'scope-not-found' };
      const candidates = root.querySelectorAll(
        'button, a, [role="button"], [class*="btn"], [class*="button"], [class*="subscribe"], [class*="pay"]'
      );
      const norm = (s) => s.replace(/\s+/g, ' ').trim();
      const target = norm(t);
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (rect.width === 0 || rect.height === 0) continue;
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        if (el.disabled) continue;
        const actual = norm(el.textContent);
        if (contains ? actual.includes(target) : actual === target) {
          el.click();
          return { ok: true };
        }
      }
      return { ok: false, reason: 'no-exact-match' };
    }, { t: text, scopeSel, contains: !!opts.contains });
  } catch (err) {
    if (EXEC_CONTEXT_ERR.test(err.message)) {
      return { ok: true, reason: 'context-destroyed-after-possible-click' };
    }
    throw err;
  }
}

// Fix 2026-06-27 (Codex v13-HIGH-2): STEP3/STEP4 fallback page.evaluate
// calls contain el.click() which can trigger navigation. If navigation
// destroys the context, the click likely worked — return a "possible click"
// result so the caller's state assertion confirms, rather than crashing.
async function evaluatePossibleClick(page, fn, arg, successValue) {
  try {
    return await page.evaluate(fn, arg);
  } catch (err) {
    if (EXEC_CONTEXT_ERR.test(err.message)) {
      return successValue || 'Clicked: possible navigation';
    }
    throw err;
  }
}

// Find a visible container whose text contains a fragment. Returns a unique
// CSS selector that can be passed back into page.evaluate as a scope. We
// synthesise the selector by walking up the DOM until we find a node whose
// sibling-index combination is unique within the document. This avoids the
// fragility of relying on framework-generated classnames.
// Fix 2026-06-27 (Codex v13-MEDIUM-3): protect against execution context
// destruction during navigation. findVisibleByTextContains is on the critical
// path for STEP3/STEP4 — a navigation at the wrong time would crash the
// entire script. Return null (card not found) so the caller retries.
async function findVisibleByTextContains(page, fragment, opts = {}) {
  try {
    return await page.evaluate(({ f, requiredText }) => {
    const candidates = document.querySelectorAll(
      'div, section, article, li, [class*="plan"], [class*="card"], [class*="item"], [class*="package"]'
    );
    // Fix 2026-06-27 (Codex v23-HIGH-1): collect ALL matches, then rank.
    // The previous implementation returned the first match — but a leaf node
    // inside the Pro card (e.g., a "5x Lite 用量额度" quota row) can match
    // first and is too narrow for STEP3/STEP4 to find annual/pay button.
    const matches = [];
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width === 0 || rect.height === 0) continue;
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const t = el.textContent.trim();
      if (!t.includes(f)) continue;
      // Optional requiredText filter: caller can require plan-card markers
      // (e.g. "连续包年", "立即购买") to avoid matching leaf nodes.
      if (requiredText.length && !requiredText.some(x => t.includes(x))) continue;
      if (t.length > 1200) continue;
      matches.push({ el, rect, text: t });
    }
    // Score: prefer text containing 连续包年 (+10), containing pay button
    // text (+10); slight penalty for longer text (smaller scope is better
    // when both contain the same markers, but in practice we want the
    // actual plan card, which is typically large).
    matches.sort((a, b) => {
      const score = (m) =>
        (m.text.includes('连续包年') ? 10 : 0) +
        (/立即购买|立即订阅|应付金额/.test(m.text) ? 10 : 0) -
        (m.text.length / 1000);
      return score(b) - score(a);
    });
    const match = matches[0];
    if (match) {
        const { el, rect, text: t } = match;
        // Synthesise a unique CSS selector for this element. Walk up to root
        // (no depth cap — earlier 6-deep limit could land on a wrong element)
        // then verify the path resolves to exactly this element. If not, fall
        // back to recording only the bounding rect so the caller can still click
        // by coordinates if needed.
        // Fix 2026-06-27 (Codex v4-HIGH-6): use CSS.escape for ids/special
        // chars so selector uniqueness check doesn't fail on edge cases.
        const buildPath = (startNode) => {
          const path = [];
          let node = startNode;
          while (node && node !== document.body && node !== document.documentElement) {
            let part = node.tagName.toLowerCase();
            if (node.id) {
              path.unshift('#' + (window.CSS && CSS.escape ? CSS.escape(node.id) : node.id));
              return path.join(' > ');
            }
            const parent = node.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
              if (siblings.length > 1) {
                const idx = siblings.indexOf(node) + 1;
                part += `:nth-of-type(${idx})`;
              }
            }
            path.unshift(part);
            node = parent;
          }
          return path.join(' > ');
        };

        let selector = buildPath(el);
        let unique = false;
        try {
          const matches = document.querySelectorAll(selector);
          if (matches.length === 1 && matches[0] === el) unique = true;
        } catch { /* invalid selector syntax — leave unique = false */ }

        return {
          selector: unique ? selector : null,
          // Always provide the rect so the caller can fall back to a
          // coordinate-based click *scoped to this card* (never page-wide).
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          text: t.substring(0, 80)
        };
    }
    return null;
  }, { f: fragment, requiredText: opts.requiredText || [] });
  } catch (err) {
    if (EXEC_CONTEXT_ERR.test(err.message)) {
      monitor.log('WARN', 'DOM', `findVisibleByTextContains interrupted during navigation: ${err.message}`);
      return null;
    }
    throw err;
  }
}

// Wait for the page to contain a text fragment (post-click assertion).
// Fix 2026-06-27 (Codex v2-LOW-1): removed unused waitForSelector helper.
// The current STEP assertions use waitForText (text-based), so this helper
// was dead code. Add back when we wire up selector-based assertions.
// Fix 2026-06-27 (Codex v8-HIGH-2): Puppeteer's page.evaluate() throws
// "Execution context was destroyed" when a SPA navigation or full-page
// reload happens between evaluate calls. In a rapid-purchase loop this is
// a normal transient state, not a fatal error. Catch it and retry instead
// of letting it abort the entire purchase.
const EXEC_CONTEXT_ERR = /Execution context was destroyed|Cannot find context|Target closed/i;

async function waitForText(page, fragment, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let found = false;
    try {
      found = await page.evaluate((f) => (document.body?.innerText || '').includes(f), fragment);
    } catch (err) {
      if (!EXEC_CONTEXT_ERR.test(err.message)) throw err;
      // Context destroyed during navigation — retry after a short wait
      await wait(150);
      continue;
    }
    if (found) return true;
    await wait(150);
  }
  return false;
}

// Wait for the page to contain ANY of the given text fragments. Used when
// several UI states are equally valid (e.g., new vs existing subscriber
// flows, or pay button variants). Fix 2026-06-27 (Codex v3-MEDIUM-1).
// Fix 2026-06-27 (Codex v4-MEDIUM-1): added scope option so the assertion
// only fires inside a known container — prevents matching nav-bar / footer /
// hidden elements that happen to contain the same text.
async function waitForAnyText(page, fragments, opts = {}) {
  const timeoutMs = opts.timeoutMs || 3000;
  const scopeSel = opts.scope || null;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let found = false;
    try {
      found = await page.evaluate(({ fs, scopeSel }) => {
        const root = scopeSel ? document.querySelector(scopeSel) : document.body;
        if (!root) return false;
        const text = root.innerText || '';
        return fs.some(f => text.includes(f));
      }, { fs: fragments, scopeSel });
    } catch (err) {
      if (!EXEC_CONTEXT_ERR.test(err.message)) throw err;
      await wait(150);
      continue;
    }
    if (found) return true;
    await wait(150);
  }
  return false;
}

// ============ CONSTANTS ============
const WAIT = {
  CLICK: 300,
  ACTION: 1000,
  SHORT: 150,
  VERIFY_RETRY: 500,
  SLIDE_STEP: 30
};
const SLIDE_DEFAULT_DISTANCE = 200; // Fallback slider distance in pixels when track width unavailable

// ============ MONITORING SYSTEM ============
const monitor = {
  startTime: null,
  events: [],
  stepStats: {},
  verificationAttempts: [],
  purchaseFlows: [],

  // Flow tracking
  currentFlow: null,

  startFlow(flowId) {
    this.currentFlow = {
      id: flowId,
      startTime: Date.now(),
      steps: [],
      verifications: [],
      pageState: [],
      errors: [],
      success: false
    };
    this.log('INFO', 'FLOW', `Flow #${flowId} started`);
  },

  endFlow(success) {
    if (!this.currentFlow) return;
    this.currentFlow.endTime = Date.now();
    this.currentFlow.duration = this.currentFlow.endTime - this.currentFlow.startTime;
    this.currentFlow.success = success;
    this.purchaseFlows.push(this.currentFlow);
    this.log('INFO', 'FLOW', `Flow #${this.currentFlow.id} ended`, { success, duration: this.currentFlow.duration });
    this.currentFlow = null;
  },

  // Step tracking
  recordStep(name, data) {
    if (!this.currentFlow) return;
    const step = {
      name,
      timestamp: Date.now(),
      duration: data.duration || 0,
      result: data.result || 'unknown',
      success: data.success || false
    };
    this.currentFlow.steps.push(step);
    this.stepStats[name] = data;
  },

  // Page state capture
  capturePageState(label, page) {
    if (!this.currentFlow) return;
    this.currentFlow.pageState.push({
      label,
      timestamp: Date.now(),
      url: page ? redactUrl(page.url()) : 'unknown'
    });
  },

  // Error tracking
  recordError(category, message, data) {
    if (!this.currentFlow) return;
    this.currentFlow.errors.push({
      category,
      message,
      data,
      timestamp: Date.now()
    });
  },

  // JSON.stringify a value safely. Uses a replacer that drops circular references
  // so log() never crashes when handed complex objects (e.g., the full report).
  // Fix 2026-06-27: monitor.log('REPORT', 'Purchase execution report', report) used
  // to trigger "Converting circular structure to JSON" because report.events[i].data
  // pointed back into the flow's events, which pointed back into report.
  _safeStringify(value) {
    const seen = new WeakSet();
    return JSON.stringify(value, (key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return undefined;
        seen.add(val);
      }
      return val;
    });
  },

  log(level, category, message, data = {}) {
    const timestamp = new Date().toISOString();
    const entry = { timestamp, level, category, message, data };
    this.events.push(entry);

    // Also add to current flow if active
    if (this.currentFlow) {
      this.currentFlow.events = this.currentFlow.events || [];
      this.currentFlow.events.push(entry);
    }

    const levelPrefix = { INFO: '[INFO]', WARN: '[WARN]', ERROR: '[ERROR]' }[level] || '[LOG]';
    // Fix 2026-06-27 (Codex v11-LOW-3): move _safeStringify inside the
    // try block so BigInt/throwing-getter edge cases don't crash the script.
    // The comment says "never let logging crash" but _safeStringify was
    // outside the try, so it could still throw.
    try {
      const dataStr = Object.keys(data).length > 0 ? this._safeStringify(data) : '';
      console.log(`${levelPrefix} [${category}] ${message}`, dataStr);
    } catch (err) {
      // Last-ditch fallback: never let logging crash the script
      console.log(`${levelPrefix} [${category}] ${message} <unserializable data: ${err.message}>`);
    }
  },

  // Fix 2026-06-27: was sync — page.screenshot() returns a Promise that was
  // never awaited. The screenshot could be torn down mid-write when the
  // browser closed 2 minutes later. Also swallow write errors so a disk-full
  // doesn't abort the purchase loop.
  // Fix 2026-06-27 (Codex v6-HIGH-4): screenshots may contain account info,
  // order details, or payment context. Default to OFF; only write when
  // DEBUG_SCREENSHOTS=1 is set. When writing, restrict to mode 0o600 so
  // shared machines can't read them.
  async screenshot(step, page) {
    if (process.env.DEBUG_SCREENSHOTS !== '1') return null;
    const timestamp = Date.now();
    // Fix 2026-06-27 (Codex v11-MEDIUM-2): write screenshots to BASE_DIR,
    // not cwd, so they land next to the script regardless of caller directory.
    const filename = path.join(BASE_DIR, `ss_${step}_${timestamp}.png`);
    try {
      await page.screenshot({ path: filename, fullPage: true });
      try { fs.chmodSync(filename, 0o600); } catch { /* chmod not supported on some fs */ }
      this.log('INFO', 'SCREENSHOT', `Screenshot saved: ${filename} (mode 0600)`);
    } catch (err) {
      this.log('WARN', 'SCREENSHOT', `Screenshot failed for ${step}: ${err.message}`);
    }
    return filename;
  },

  generateReport() {
    // Analyze flows for optimization insights
    const flowAnalysis = {
      totalFlows: this.purchaseFlows.length,
      successfulFlows: this.purchaseFlows.filter(f => f.success).length,
      failedFlows: this.purchaseFlows.filter(f => !f.success).length,
      avgFlowDuration: 0,
      stepTimings: {},
      verificationSuccessRate: 0,
      commonErrors: [],
      recommendations: []
    };

    if (this.purchaseFlows.length > 0) {
      const totalDuration = this.purchaseFlows.reduce((sum, f) => sum + (f.duration || 0), 0);
      flowAnalysis.avgFlowDuration = Math.round(totalDuration / this.purchaseFlows.length);

      // Analyze step timings
      const allSteps = {};
      this.purchaseFlows.forEach(flow => {
        flow.steps.forEach(step => {
          if (!allSteps[step.name]) {
            allSteps[step.name] = { count: 0, totalDuration: 0, failures: 0 };
          }
          allSteps[step.name].count++;
          allSteps[step.name].totalDuration += step.duration || 0;
          if (!step.success) allSteps[step.name].failures++;
        });
      });

      for (const stepName in allSteps) {
        const s = allSteps[stepName];
        flowAnalysis.stepTimings[stepName] = {
          count: s.count,
          avgDuration: Math.round(s.totalDuration / s.count),
          failureRate: Math.round((s.failures / s.count) * 100) + '%'
        };
      }

      // Collect common errors
      const errorCounts = {};
      this.purchaseFlows.forEach(flow => {
        (flow.errors || []).forEach(err => {
          const key = `${err.category}: ${err.message}`;
          errorCounts[key] = (errorCounts[key] || 0) + 1;
        });
      });
      flowAnalysis.commonErrors = Object.entries(errorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([msg, count]) => ({ message: msg, count }));

      // Generate recommendations
      const verifications = this.verificationAttempts || [];
      const failedVerifs = verifications.filter(v => !v.success);
      if (failedVerifs.length > 0) {
        flowAnalysis.recommendations.push({
          priority: 'HIGH',
          area: 'verification',
          issue: `${failedVerifs.length} verification attempts failed`,
          suggestion: 'Consider using OCR or third-party captcha solving service'
        });
      }

      const step3Failures = this.purchaseFlows.filter(f =>
        f.steps.some(s => s.name === 'step3_select_plan' && !s.success)
      ).length;
      if (step3Failures > 0) {
        flowAnalysis.recommendations.push({
          priority: 'MEDIUM',
          area: 'plan_selection',
          issue: `${step3Failures} plan selection failures`,
          suggestion: 'Improve plan element detection logic'
        });
      }
    }

    const report = {
      duration: Date.now() - this.startTime,
      totalEvents: this.events.length,
      stepStats: this.stepStats,
      verificationAttempts: this.verificationAttempts,
      flowAnalysis,
      purchaseFlows: this.purchaseFlows.map(f => ({
        id: f.id,
        startTime: f.startTime,
        endTime: f.endTime,
        duration: f.duration,
        success: f.success,
        steps: f.steps,
        stepCount: f.steps ? f.steps.length : 0,
        verifications: f.verifications,
        errors: f.errors,
        pageState: f.pageState
      })),
      events: this.events
    };

    const filename = path.join(BASE_DIR, `purchase_report_${Date.now()}.json`);
    try {
      // Fix 2026-06-27 (Codex v8-HIGH-3): report contains order/payment URLs and
      // verification details. Restrict to mode 0o600 like cookies.json.
      writePrivateNewFile(filename, JSON.stringify(report, null, 2));
      monitor.log('INFO', 'REPORT', `Report saved: ${filename}`);
    } catch (err) {
      monitor.log('ERROR', 'REPORT', `Failed to save report: ${err.message}`);
    }

    // Also save a readable summary
    const summaryFilename = path.join(BASE_DIR, `purchase_summary_${Date.now()}.txt`);
    const summary = this.generateSummary(report);
    try {
      // Fix 2026-06-27 (Codex v8-HIGH-3): summary may contain URLs too.
      writePrivateNewFile(summaryFilename, summary);
      monitor.log('INFO', 'REPORT', `Summary saved: ${summaryFilename}`);
    } catch (err) {
      monitor.log('ERROR', 'REPORT', `Failed to save summary: ${err.message}`);
    }

    return report;
  },

  generateSummary(report) {
    const fa = report.flowAnalysis;
    let summary = '=== GLM Coding Purchase Automation Report ===\n\n';
    summary += `Total Flows: ${fa.totalFlows}\n`;
    summary += `Successful: ${fa.successfulFlows}\n`;
    summary += `Failed: ${fa.failedFlows}\n`;
    summary += `Avg Duration: ${fa.avgFlowDuration}ms\n\n`;

    if (fa.stepTimings) {
      summary += '--- Step Timings ---\n';
      for (const [step, timing] of Object.entries(fa.stepTimings)) {
        summary += `${step}: ${timing.avgDuration}ms avg, ${timing.failureRate} fail rate\n`;
      }
      summary += '\n';
    }

    if (fa.commonErrors.length > 0) {
      summary += '--- Common Errors ---\n';
      fa.commonErrors.forEach(e => {
        summary += `[${e.count}x] ${e.message}\n`;
      });
      summary += '\n';
    }

    if (fa.recommendations.length > 0) {
      summary += '--- Recommendations ---\n';
      fa.recommendations.forEach(r => {
        summary += `[${r.priority}] ${r.area}: ${r.suggestion}\n`;
      });
    }

    return summary;
  }
};

// ============ CLICK VERIFICATION ============
// Find a visible element matching a Chinese character for click-captcha.
// Refactor 2026-06-27 (Codex structural #4): restricted candidates to
// text-bearing interactive nodes, added getComputedStyle visibility filter.
// Fix 2026-06-27 (Codex v21-MEDIUM-1): search within already-scoped captcha
// candidates (passed in from handleClickVerification's verificationInfo),
// not via a full-page scan. The previous implementation re-scanned the whole
// page for the target character, which could match unrelated visible text
// like nav-bar / footer Chinese characters and click the wrong coordinates.
function findClickableElementFromCandidates(char, candidates) {
  let bestMatch = null;
  let bestScore = 0;
  for (const el of candidates || []) {
    const text = String(el.text || '').trim();
    if (!text || text.length > 20) continue;
    let score = 0;
    if (text === char) score = 3;
    else if (text.includes(char) && text.length <= 5) score = 2;
    else if (text.includes(char)) score = 1;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { found: true, x: el.x, y: el.y };
    }
  }
  return bestMatch || { found: false };
}

async function findClickableElement(page, char) {
  try {
    const result = await page.evaluate((targetChar) => {
      // Limit candidates to likely captcha-tile elements: small clickable
      // containers with a single character of text.
      const candidates = document.querySelectorAll(
        'div, span, li, td, [class*="char"], [class*="tile"], [class*="captcha"] *'
      );
      let bestMatch = null;
      let bestScore = 0;

      for (const el of candidates) {
        const text = el.textContent.trim();
        if (!text || text.length > 20) continue;

        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.top >= window.innerHeight || rect.top < 0) continue;

        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;

        let score = 0;
        if (text === targetChar) {
          score = 3; // Exact match - highest score
        } else if (text.includes(targetChar) && text.length <= 5) {
          score = 2; // Short partial match
        } else if (text.includes(targetChar)) {
          score = 1; // Fuzzy match
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
      return bestMatch || { found: false };
    }, char);

    return result;
  } catch (err) {
    monitor.log('ERROR', 'VERIFY', `findClickableElement error: ${err.message}`);
    return { found: false };
  }
}

async function handleClickVerification(page) {
  monitor.log('INFO', 'VERIFY', 'Checking for click verification...');

  let verificationInfo;
  try {
    verificationInfo = await page.evaluate(() => {
      // Refactor 2026-06-27 (Codex structural #4): scope to captcha modal
      // containers first. Only fall back to full-page scan if no modal found.
      const modalSelectors = [
        '[class*="captcha"]', '[class*="verify"]', '[class*="challenge"]',
        '[class*="dialog"]', '[class*="modal"]', '[role="dialog"]'
      ];
      // Fix 2026-06-27 (Codex v30-MEDIUM-1): walk ALL visible modals, not just
      // the first DOM-order match. The previous `querySelector(sel)` returned
      // only the first element matching each selector. If a non-captcha modal
      // (cookie banner, ad dialog, terms-of-service) appeared earlier in DOM
      // order, the actual captcha modal later in DOM was missed — and the
      // function returned "no verification found", letting the purchase
      // proceed on a captcha-blocked page.
      const roots = modalSelectors
        .flatMap(sel => [...document.querySelectorAll(sel)])
        .filter(candidate => candidate && candidate.offsetParent !== null);
      roots.push(document.body);

      let promptText = '';
      // Fix 2026-06-27 (Codex v24-HIGH-1): rename for clarity — this is just
      // the prompt text element, NOT the captcha container. Walk up via
      // closest() to find the actual captcha modal containing the tiles.
      let promptEl = null;

      for (const root of roots) {
        const candidates = root.querySelectorAll('div, section, p, span');
        for (const el of candidates) {
          const text = el.textContent.trim();
          // Only match explicit captcha prompts. Tightened 2026-06-27: removed
          // the loose "验证" trigger which produced false positives on every
          // page (footer/copyright text contains the word).
          if (text.includes('请依次点击') || text.includes('请按顺序点击')) {
            promptText = text;
            promptEl = el;
            break;
          }
        }
        if (promptEl) break;
      }

      if (!promptText) return { found: false };

      // Fix 2026-06-27 (Codex v21-MEDIUM-2): tighter regex to avoid capturing
      // trailing instruction text. The previous regex matched the rest of the
      // line including Chinese instruction words after the target chars.
      const match =
        promptText.match(/点击[^：:\n\r]*[：:]\s*([一-龥\s,，、|]{1,20})/) ||
        promptText.match(/点击\s*([一-龥](?:[\s,，、|]*[一-龥]){0,5})/);
      let charsToClick = [];

      // Try to find captcha tile candidates: small visible containers with single
      // Chinese character of text. Refactor 2026-06-27: limit to small
      // interactive nodes with computed-style visibility filter.
      // (Collected BEFORE prompt filtering so v21-MEDIUM-2 can intersect
      // target chars with actually-clickable chars.)
      const clickableElements = [];
      // Fix 2026-06-27 (Codex v22-MEDIUM-1): scope to the detected captcha
      // container. document.querySelectorAll collects unrelated Chinese text
      // from the page (nav, footer, copyright), defeating the candidate
      // filtering that v21 added.
      // Fix 2026-06-27 (Codex v24-HIGH-1): the prompt text element itself
      // is just the prompt — tiles are siblings in the modal. Walk up via
      // closest() to find the captcha modal container, otherwise tileCandidates
      // is empty and every captcha is treated as unsolvable.
      const captchaScope = promptEl
        ? (promptEl.closest(
            '[class*="captcha"], [class*="verify"], [class*="challenge"], [class*="dialog"], [class*="modal"], [role="dialog"]'
          ) || root || document)
        : (root || document);
      const tileCandidates = captchaScope.querySelectorAll(
        'div, span, li, td, [class*="char"], [class*="tile"], [class*="captcha"] *'
      );
      for (const el of tileCandidates) {
        const text = el.textContent.trim();
        if (text.length < 1 || text.length > 5 || !/[一-龥]/.test(text)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.top >= window.innerHeight || rect.top < 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        clickableElements.push({ text, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      }

      // Fix 2026-06-27 (Codex v21-MEDIUM-2): build charsToClick AFTER
      // collecting clickableElements so we can filter target chars to only
      // those that actually appear in the captcha tiles. This prevents
      // clicking words like "下图中" or trailing instruction text.
      if (match) {
        const candidateTexts = new Set(clickableElements.flatMap(el => [...String(el.text || '')]));
        const charPart = match[1]
          .trim()
          // Strip common prompt prefixes like "下图中", "图中", "文字", "字符"
          .replace(/^(?:下图中(?:的)?|图中(?:的)?|文字|字符)+/, '');
        charsToClick = charPart.split(/[\s,，、|]+/).flatMap(c => {
          const trimmed = c.trim();
          if (!/[一-龥]/.test(trimmed)) return [];
          if (trimmed.length === 1) {
            // Only keep single-char targets that exist in clickable candidates
            return candidateTexts.has(trimmed) ? [trimmed] : [];
          }
          // Common captcha prompts concatenate targets with no delimiter.
          // Split into individual Chinese characters, filtered by clickable set.
          return [...trimmed].filter(ch => /[一-龥]/.test(ch) && candidateTexts.has(ch));
        }).slice(0, 6); // Cap at 6 chars (reasonable captcha limit)
      }

      return { found: true, promptText, charsToClick, clickableElements };
    });
  } catch (err) {
    // Fix 2026-06-27 (Codex v12-HIGH-2): execution context destroyed during
    // navigation means the page is unstable — return 'detected-but-failed' so
    // the dispatcher retries, not false (which means "no captcha" and would
    // let the purchase proceed on an unstable page).
    if (EXEC_CONTEXT_ERR.test(err.message)) {
      monitor.log('WARN', 'VERIFY', `Click verification interrupted during navigation: ${err.message}`);
      return 'detected-but-failed';
    }
    monitor.log('ERROR', 'VERIFY', `handleClickVerification evaluate error: ${err.message}`);
    return 'detected-but-failed';
  }

  if (!verificationInfo.found) {
    monitor.log('INFO', 'VERIFY', 'No click verification found');
    return false;
  }

  monitor.log('INFO', 'VERIFY', 'Click verification detected', {
    prompt: verificationInfo.promptText.substring(0, 100),
    charsCount: verificationInfo.charsToClick.length,
    clickableCount: verificationInfo.clickableElements.length
  });

  // Only use the chars explicitly listed in the captcha prompt. The previous
  // fallback used "any visible Chinese element on the entire page" as targets,
  // which clicked nav-bar/footer/copyright text (e.g., 文档/控制台/即刻订阅).
  // Fix 2026-06-27: refuse to click anything we can't explicitly identify as a
  // captcha target. Caller can decide whether to reload and retry.
  const targetChars = verificationInfo.charsToClick;

  if (targetChars.length === 0) {
    monitor.log('WARN', 'VERIFY', 'Click captcha detected but no chars parsed from prompt; refusing unsafe fallback');
    return 'detected-but-failed';
  }

  monitor.log('INFO', 'VERIFY', 'Click sequence', { chars: targetChars });

  // Click each target character using coordinate-based click
  let clickedCount = 0;
  const clickResults = [];

  for (const char of targetChars) {
    // Fix 2026-06-27 (Codex v21-MEDIUM-1): search within already-scoped
    // clickableElements (collected at captcha detection time) instead of
    // re-scanning the whole page. This prevents clicking unrelated page text
    // like nav-bar/footer Chinese characters.
    const pos = findClickableElementFromCandidates(char, verificationInfo.clickableElements);

    if (pos.found) {
      await page.mouse.click(pos.x, pos.y);
      clickedCount++;
      clickResults.push({ char, success: true, x: pos.x, y: pos.y });
      monitor.log('INFO', 'VERIFY', `Clicked: ${char} at (${Math.round(pos.x)}, ${Math.round(pos.y)})`);
      await wait(WAIT.CLICK);
    } else {
      clickResults.push({ char, success: false });
      monitor.log('WARN', 'VERIFY', `Could not find element: ${char}`);
    }
  }

  monitor.verificationAttempts.push({
    type: 'click',
    charsToClick: targetChars,
    clickResults,
    successCount: clickedCount,
    totalChars: targetChars.length
  });

  monitor.log('INFO', 'VERIFY', `Click verification complete: ${clickedCount}/${targetChars.length} clicked`);

  // Guard against division by zero
  if (targetChars.length === 0) {
    monitor.log('WARN', 'VERIFY', 'No target characters to click');
    return 'detected-but-failed';
  }

  // Check if verification was successful.
  // Fix 2026-06-27 (Codex v4-HIGH-1): previous 60% threshold allowed
  // partial matches (3 chars, click 2) — page stays captcha-blocked, all
  // subsequent clicks invalid. Require 100% match + wait for captcha to
  // disappear before declaring handled.
  if (clickedCount < targetChars.length) {
    monitor.log('WARN', 'VERIFY', `Clicked ${clickedCount}/${targetChars.length} — incomplete, captcha likely still showing`);
    return 'detected-but-failed';
  }

  // Fix 2026-06-27 (Codex v6-MEDIUM-6): wire TIMEOUTS.captchaGone.
  const captchaState = await waitForTextGone(page, ['请依次点击', '请按顺序点击'], TIMEOUTS.captchaGone);
  if (captchaState !== 'cleared') {
    monitor.log('WARN', 'VERIFY', `Click captcha did not confirm solve (state=${captchaState}) — treating as failed`);
    return 'detected-but-failed';
  }

  monitor.log('INFO', 'VERIFY', `Click captcha cleared (${clickedCount}/${targetChars.length})`);
  return true;
}

// Wait until the page no longer contains ANY of the given text fragments,
// AND that the page is still on bigmodel.cn (not bounced to /login) and no
// other captcha family is showing.
// Fix 2026-06-27 (Codex v5-HIGH-1): previous implementation returned true as
// soon as the target fragments disappeared, which also fired when the page
// was redirected to /login (text gone but not solved). Return a structured
// result so callers can branch on the failure mode.
//
// Returns one of:
//   'cleared'        — target fragments gone, still on bigmodel.cn, no other captcha
//   'login-redirect' — URL indicates we got bounced back to login
//   'other-captcha'  — original gone but a different captcha family appeared
//   'timeout'        — fragments still present after timeoutMs
async function waitForTextGone(page, fragments, timeoutMs = 3000) {
  // Returns one of:
  //   'cleared'        — target fragments gone, still on bigmodel.cn, no other captcha
  //   'login-redirect' — URL indicates we got bounced back to login
  //   'off-host'       — URL left bigmodel.cn domain
  //   'other-captcha'  — original gone but a different captcha family appeared
  //   'timeout'        — fragments still present after timeoutMs
  const captchaFamily = ['请依次点击', '请按顺序点击', '拖动', '拼图', '滑动', '安全验证', '请完成验证'];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let state;
    try {
      state = await page.evaluate(({ targets, family }) => {
        // Fix 2026-06-27 (Codex v17-MEDIUM-2): guard document.body during
        // fast SPA transitions where body can be null.
        const text = document.body?.innerText || '';
        // Fix 2026-06-27 (Codex v13-MEDIUM-4): use pathname instead of
        // full URL to avoid false matches like ?redirect=/login.
        const parsed = new URL(location.href);
        // Fix 2026-06-27 (Codex v14-HIGH-1): detect off-host redirect.
        // If captcha disappears because page left bigmodel.cn, that's not 'cleared'.
        const onBigModel = parsed.protocol === 'https:' &&
          (parsed.hostname === 'bigmodel.cn' || parsed.hostname.endsWith('.bigmodel.cn'));
        const targetsPresent = targets.some(f => text.includes(f));
        const otherCaptchaPresent = family.some(f => text.includes(f) && !targets.includes(f));
        const onLogin = /^\/(login|register)(\/|$)/.test(parsed.pathname) ||
                         /登录|注册/.test(document.title);
        return { targetsPresent, otherCaptchaPresent, onLogin, offHost: !onBigModel };
      }, { targets: fragments, family: captchaFamily });
    } catch (err) {
      if (!EXEC_CONTEXT_ERR.test(err.message)) throw err;
      await wait(150);
      continue;
    }

    // Fix 2026-06-27 (Codex v14-HIGH-1): check off-host before login check.
    // If page left bigmodel.cn, that's more severe than login redirect.
    if (state.offHost) return 'off-host';
    if (state.onLogin) return 'login-redirect';
    if (!state.targetsPresent) {
      if (state.otherCaptchaPresent) return 'other-captcha';
      return 'cleared';
    }
    await wait(150);
  }
  return 'timeout';
}

// ============ SLIDE VERIFICATION ============
async function handleSlideVerification(page) {
  monitor.log('INFO', 'VERIFY', 'Checking for slide verification...');

  // Fix 2026-06-27 (Codex v9-MEDIUM-2): protect against execution context
  // destruction during navigation. Same pattern as waitForText/waitForAnyText.
  let slideInfo;
  try {
    slideInfo = await page.evaluate(() => {
    // Refactor 2026-06-27 (Codex structural #4): scope to captcha modal
    // containers first; only fall back to body if none found.
    const modalSelectors = [
      '[class*="captcha"]', '[class*="verify"]', '[class*="challenge"]',
      '[class*="dialog"]', '[class*="modal"]', '[role="dialog"]'
    ];
    // Fix 2026-06-27 (Codex v30-MEDIUM-2): walk ALL visible modals. The previous
    // first-match-only loop had the same problem as the click-captcha detector
    // — a non-captcha modal appearing earlier in DOM would shadow the real
    // captcha modal. Also: scope the knob lookup to the captcha root so a
    // page-wide search can't drag an unrelated slider (volume control,
    // brightness, etc.).
    const roots = modalSelectors
      .flatMap(sel => [...document.querySelectorAll(sel)])
      .filter(candidate => candidate && candidate.offsetParent !== null);
    roots.push(document.body);
    for (const root of roots) {
      const candidates = root.querySelectorAll('div, section, p, span');
      const hasPrompt = [...candidates].some(el => {
        const text = el.textContent.trim();
        return (text.includes('拖动') && text.includes('完成验证')) || text.includes('滑动') || text.includes('拼图');
      });
      if (hasPrompt) {
        // Also probe for the slider knob within the same captcha root so the
        // caller knows the captcha is actually actionable here.
        const knobSelectors = ['[class*="knob"]', '[class*="handle"]', '[class*="thumb"]', '[class*="slider"] [class*="bar"]'];
        for (const sel of knobSelectors) {
          if (root.querySelector(sel)) return { found: true, scoped: true };
        }
        return { found: true, scoped: false };
      }
    }
    return { found: false };
  });
  } catch (err) {
    if (EXEC_CONTEXT_ERR.test(err.message)) {
      monitor.log('WARN', 'VERIFY', `Slide verification skipped during navigation: ${err.message}`);
      // Fix 2026-06-27 (Codex v13-HIGH-1): return 'detected-but-failed' instead
      // of false. 'false' means "no captcha", which lets the purchase proceed
      // on an unstable page. 'detected-but-failed' triggers a retry.
      return 'detected-but-failed';
    }
    monitor.log('ERROR', 'VERIFY', `Slide verification detect error: ${err.message}`);
    return 'detected-but-failed';
  }

  if (!slideInfo.found) {
    monitor.log('INFO', 'VERIFY', 'No slide verification found');
    return false; // No captcha detected on page
  }

  monitor.log('INFO', 'VERIFY', 'Slide verification detected, attempting to solve...');

  let result;
  try {
    // 修复 2026-06-27（Codex v31-MEDIUM-1）：将滑块查找范围限定到验证码模态框。
    // v30 的检测阶段已限定到验证码模态框，但求解查找仍在整个页面使用
    // document.querySelectorAll — 如果页面有其它滑块（音量控制、亮度等），
    // 会拖错控件。现在将检测 + 滑块查找合并到一个 evaluate 中，
    // 仅在包含验证码提示的同一模态框内查找滑块旋钮。
    result = await page.evaluate((defaultDistance) => {
      const modalSelectors = [
        '[class*="captcha"]', '[class*="verify"]', '[class*="challenge"]',
        '[class*="dialog"]', '[class*="modal"]', '[role="dialog"]'
      ];
      const roots = modalSelectors
        .flatMap(sel => [...document.querySelectorAll(sel)])
        .filter(candidate => candidate && candidate.offsetParent !== null);
      roots.push(document.body);

      const knobSelectors = ['[class*="knob"]', '[class*="handle"]', '[class*="thumb"]', '[class*="slider"] [class*="bar"]'];

      for (const root of roots) {
        const promptEls = root.querySelectorAll('div, section, p, span');
        const hasPrompt = [...promptEls].some(el => {
          const text = el.textContent.trim();
          return (text.includes('拖动') && text.includes('完成验证')) ||
            text.includes('滑动') || text.includes('拼图');
        });
        if (!hasPrompt) continue;

        let knob = null;
        for (const sel of knobSelectors) {
          const found = root.querySelectorAll(sel);
          if (found.length > 0) { knob = found[0]; break; }
        }
        if (!knob) return { found: false, reason: 'no-knob-in-captcha-root' };

        const rect = knob.getBoundingClientRect();
        const track = knob.closest('[class*="slider"], [class*="track"], [class*="rail"]');
        const trackWidth = track ? track.getBoundingClientRect().width : defaultDistance;
        return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height, trackWidth };
      }
      return { found: false, reason: 'no-slide-captcha-root' };
    }, SLIDE_DEFAULT_DISTANCE);
  } catch (err) {
    monitor.log('ERROR', 'VERIFY', `Slide verification error: ${err.message}`);
    return 'detected-but-failed';
  }

  if (!result.found) {
    monitor.log('WARN', 'VERIFY', 'Could not locate slider knob');
    return 'detected-but-failed';
  }

  monitor.log('INFO', 'VERIFY', 'Found slider', { x: result.x, y: result.y, trackWidth: result.trackWidth });

  const startX = result.x, startY = result.y;
  // Slide 80% of track width (generous for most滑块验证)
  const targetDistance = result.trackWidth * 0.8;

  await page.mouse.move(startX, startY);
  await page.mouse.down();

  const steps = 15; // Smooth cubic easing
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const easeProgress = 1 - Math.pow(1 - progress, 3);
    const x = startX + targetDistance * easeProgress;
    const y = startY; // Keep Y constant to avoid干扰滑块
    await page.mouse.move(x, y);
    await wait(WAIT.SLIDE_STEP + Math.random() * 20);
  }

  await page.mouse.up();
  monitor.log('INFO', 'VERIFY', 'Slide drag completed');

  // Fix 2026-06-27 (Codex v4-HIGH-2): don't trust mouse.up alone. Bad tracks
  // (wrong distance, second-challenge overlay) leave the captcha visible.
  // Wait for the slider/captcha prompt to disappear before declaring handled.
  // Fix 2026-06-27 (Codex v6-MEDIUM-6): wire TIMEOUTS.captchaGone.
  const slideState = await waitForTextGone(page, ['拖动', '拼图', '滑动'], TIMEOUTS.captchaGone);
  if (slideState !== 'cleared') {
    monitor.log('WARN', 'VERIFY', `Slide did not confirm solve (state=${slideState}) — treating as failed`);
    monitor.verificationAttempts.push({ type: 'slide', success: false });
    return 'detected-but-failed';
  }

  monitor.log('INFO', 'VERIFY', 'Slide captcha cleared');
  monitor.verificationAttempts.push({ type: 'slide', success: true });
  return true;
}

// ============ MAIN VERIFICATION DISPATCHER ============
// Fix 2026-06-27 (Codex CRITICAL #6): three-state result. The previous boolean
// return conflated "no captcha on this page" with "captcha detection failed",
// causing the refresh loop to reload up to 3 extra times even on normal pages.
// Now:
//   'none'    — no captcha was detected at all (normal page). Continue.
//   'handled' — captcha was detected and solved. Continue.
//   'failed'  — captcha was detected but could not be solved. Retry.
async function handleVerification(page) {
  const clickResult = await handleClickVerification(page);
  if (clickResult === true) return 'handled';
  if (clickResult === 'detected-but-failed') return 'failed';

  const slideResult = await handleSlideVerification(page);
  if (slideResult === true) return 'handled';
  if (slideResult === 'detected-but-failed') return 'failed';

  return 'none';
}

// ============ MAIN PURCHASE SCRIPT ============
(async () => {
  monitor.startTime = Date.now();
  monitor.log('INFO', 'SYSTEM', 'Purchase script started');

  // Fix 2026-06-27 (Codex MEDIUM #11): browser variable is mutated by the
  // finally block below so it can clean up on any error path. Let, not const.
  let browser;
  // Fix 2026-06-27 (Codex v15-MEDIUM-1): ensure browser is closed on signal
  // before process.exit, so Chrome doesn't stay orphaned.
  installSignalCleanup(() => browser);
  try {
    // Fix 2026-06-27 (Codex v9-HIGH-1): --no-sandbox disables Chromium's
    // renderer sandbox, turning any renderer vulnerability into a full local
    // compromise. Only disable when explicitly requested (e.g., root user on
    // Linux where sandbox can't work). Default: sandbox ON.
    const launchArgs = process.env.PUPPETEER_NO_SANDBOX === '1'
      ? ['--no-sandbox', '--disable-setuid-sandbox']
      : [];
    browser = await puppeteer.launch({
      headless: false,
      args: launchArgs
    });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Validate cookies.json exists and has valid format
  if (!fs.existsSync(COOKIES_PATH)) {
    monitor.log('ERROR', 'SYSTEM', 'cookies.json not found');
    monitor.log('ERROR', 'SYSTEM', 'Please create cookies.json first. Visit bigmodel.cn and export cookies.');
    throw new Error('cookies.json not found');
  }
  // Fix 2026-06-27 (Codex v18-HIGH-1): reject group/world-readable cookie files.
  assertPrivateFile(COOKIES_PATH, 'session cookie file');

  let cookies;
  try {
    cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
    if (!Array.isArray(cookies)) {
      throw new Error('cookies.json must contain an array');
    }
  } catch (err) {
    monitor.log('ERROR', 'SYSTEM', `Invalid cookies.json: ${err.message}`);
    monitor.log('ERROR', 'SYSTEM', 'Please ensure cookies.json contains a valid JSON array of cookies.');
    throw err;
  }

  monitor.log('INFO', 'SYSTEM', 'Loaded cookies', { count: cookies.length });
  // Fix 2026-06-27 (Codex v8-MEDIUM-4): filter to bigmodel.cn cookies only.
  // A contaminated cookies.json could set third-party cookies or cause
  // ProtocolError on page.setCookie. Only cookies whose domain matches
  // bigmodel.cn / *.bigmodel.cn are relevant for this purchase flow.
  const isBigModelCookie = (c) => {
    const domain = String(c.domain || '').replace(/^\./, '');
    if (domain === 'bigmodel.cn' || domain.endsWith('.bigmodel.cn')) return true;
    if (c.url) {
      try { const host = new URL(c.url).hostname; return host === 'bigmodel.cn' || host.endsWith('.bigmodel.cn'); } catch { return false; }
    }
    return false;
  };
  const bigModelCookies = cookies.filter(isBigModelCookie);
  monitor.log('INFO', 'SYSTEM', 'Filtered bigmodel.cn cookies', { total: cookies.length, bigmodel: bigModelCookies.length });

  // Fix 2026-06-27 (Codex v3-HIGH-2): refuse to start purchase with stale or
  // empty cookies — every click would land on the login redirect and waste the
  // flash-sale window.
  if (!bigModelCookies.length || !bigModelCookies.some(c => c.name === 'bigmodel_token_production')) {
    throw new Error('cookies.json has no bigmodel_token_production; re-run login-and-save.js');
  }
  // Fix 2026-06-27 (Codex v10-HIGH-2): check token expiry before starting.
  // An expired token passes the name check but the session is invalid — every
  // request gets bounced to /login, wasting the purchase window.
  const tokenCookie = bigModelCookies.find(c => c.name === 'bigmodel_token_production');
  const tokenExpiresAt = tokenCookie.expirationDate ??
    (tokenCookie.expires && tokenCookie.expires > 0 ? tokenCookie.expires * 1000 : undefined);
  if (tokenExpiresAt && tokenExpiresAt <= Date.now() + 60000) {
    throw new Error('bigmodel_token_production is expired or expires within 60s; re-run login-and-save.js');
  }
  await page.setCookie(...bigModelCookies);

  // Go to GLM Coding page
  monitor.log('INFO', 'NAVIGATE', 'Going to GLM Coding page...');
  await page.goto('https://bigmodel.cn/glm-coding', { waitUntil: 'domcontentloaded', timeout: 60000 });
  assertBigModelUrl(page.url(), 'glm-coding');
  // Fix 2026-06-27 (Codex v10-HIGH-2): verify we're NOT on /login. Expired
  // tokens pass the expiry check above but the server may still reject them,
  // redirecting to /login. Detecting this early avoids wasting the purchase
  // window on a dead session.
  // Fix 2026-06-27 (Codex v29-MEDIUM-1): test pathname, not full URL. The
  // previous regex matched `/login` in query strings like
  // `?redirect=/login`, false-aborting an authenticated session. Other
  // parts of this script already use `URL.pathname` for the same reason.
  const currentPath = new URL(page.url()).pathname;
  if (/^\/(login|register)(\/|$)/.test(currentPath)) {
    throw new Error('Cookies did not authenticate; redirected to login/register. Re-run login-and-save.js');
  }
  await wait(3000);
  monitor.log('INFO', 'NAVIGATE', 'Page loaded', { title: await page.title() });
  await monitor.screenshot('00_start', page);

  // Target time configurable via env TARGET_TIME (Beijing UTC+8 ISO), e.g. "2026-06-27T10:00:00+08:00".
  // Default: run immediately (no wait).
  // Fix 2026-06-27: validate the parsed date. Previously a typo like
  // "2026-06-27T25:00:00+08:00" would silently produce an Invalid Date that
  // crashes later inside targetTime.toISOString() at the moment of truth.
  const envTarget = process.env.TARGET_TIME;
  let targetTime;
  if (envTarget) {
    targetTime = new Date(envTarget);
    if (Number.isNaN(targetTime.getTime())) {
      throw new Error(`Invalid TARGET_TIME env var: "${envTarget}". Use ISO 8601, e.g. 2026-06-27T10:00:00+08:00`);
    }
    monitor.log('INFO', 'SYSTEM', 'Target time set from env', { target: targetTime.toISOString() });
  } else {
    // Run immediately — use now as target so wait is skipped
    targetTime = new Date(Date.now() - 1000);
    monitor.log('INFO', 'SYSTEM', 'No TARGET_TIME env set — running immediately');
  }

  // Wait until target. Do NOT subtract a buffer here: the runner
  // (run-purchase.js) already accounts for Chromium/page warmup by launching
  // this script AUTO_PURCHASE_LEAD_MS before target. Subtracting an additional
  // buffer here would fire the first click before TARGET_TIME, which can submit
  // an early purchase attempt against an unstarted flash-sale and waste the
  // entire purchase window on retries.
  // Fix 2026-06-27 (Codex v27-MEDIUM-1): remove -2000 buffer.
  let now = new Date();
  let waitMs = targetTime.getTime() - now.getTime();

  if (waitMs > 0) {
    monitor.log('INFO', 'WAIT', `Waiting until target (${Math.round(waitMs/1000/60)} minutes)`);
    while (waitMs > 0) {
      await wait(Math.min(60000, waitMs));
      waitMs = targetTime.getTime() - new Date().getTime();
    }
  }

  // ============ RAPID PURCHASE LOOP ============
  // Run window: target → target + PURCHASE_WINDOW_MS (default 5 min)
  const purchaseWindowMs = parsePositiveInt('PURCHASE_WINDOW_MS', 300000);
  const timeoutTime = targetTime.getTime() + purchaseWindowMs;
  let purchaseAttempted = false;
  let attemptCount = 0;
  const loopStats = { refreshCount: 0, subscribeAttempts: 0, verificationHandled: 0 };

  monitor.log('INFO', 'LOOP', 'Starting rapid refresh loop');

  while (!purchaseAttempted && new Date().getTime() < timeoutTime) {
    attemptCount++;
    loopStats.refreshCount++;
    const attemptStart = Date.now();

    // Fix 2026-06-27 (Codex v7-LOW-7): wire flow API so reports contain
    // per-attempt data instead of all-zeros.
    monitor.startFlow(attemptCount);
    try {

    monitor.log('INFO', 'LOOP', `Attempt #${attemptCount}`, { refreshCount: loopStats.refreshCount });

    await page.reload({ waitUntil: 'domcontentloaded' });
    // Fix 2026-06-27 (Codex v6-CRITICAL-2): reload can follow a 302 to a
    // different domain (e.g., login redirect, payment gateway). Without this
    // check, the script continues DOM scanning on a non-bigmodel page.
    assertBigModelUrl(page.url(), 'loop-reload');
    await wait(300);

    // Check verification - retry only on 'failed', not on 'none' or 'handled'.
    // Fix 2026-06-27 (Codex CRITICAL #6): previously the boolean return
    // caused this loop to reload up to 3 extra times on every normal page
    // (because 'no captcha' was indistinguishable from 'captcha failed').
    let verificationSuccess = true; // start true; only 'failed' turns it false
    for (let vRetry = 0; vRetry < 3; vRetry++) {
      try {
        const verification = await handleVerification(page);
        if (verification === 'handled') {
          loopStats.verificationHandled++;
          await monitor.screenshot(`01_v${loopStats.verificationHandled}_verification`, page);
          verificationSuccess = true;
          break;
        }
        if (verification === 'none') {
          // No captcha at all — normal page, no retry needed.
          verificationSuccess = true;
          break;
        }
        // 'failed' — captcha detected but not solved. Retry once or twice.
        monitor.log('WARN', 'VERIFY', `Verification attempt ${vRetry + 1}/3 failed, retrying...`);
        await wait(WAIT.VERIFY_RETRY);
        await page.reload({ waitUntil: 'domcontentloaded' });
        assertBigModelUrl(page.url(), 'verification-reload');
        await wait(WAIT.ACTION);
        verificationSuccess = false;
      } catch (err) {
        monitor.log('ERROR', 'VERIFY', `Verification error: ${err.message}`);
        await wait(WAIT.VERIFY_RETRY);
        await page.reload({ waitUntil: 'domcontentloaded' });
        assertBigModelUrl(page.url(), 'verification-error-reload');
        await wait(WAIT.ACTION);
        verificationSuccess = false;
      }
    }

    if (!verificationSuccess) {
      // Fix 2026-06-27 (Codex v4-HIGH-3): previously warned and continued into
      // STEP1. With captcha still showing, every STEP1-4 click is intercepted
      // and could trigger more anti-bot friction. Skip the rest of this loop
      // iteration and let the reload-and-retry loop handle it.
      monitor.log('WARN', 'VERIFY', 'Verification consistently failing — skipping STEP1 and reloading');
      monitor.recordError('verification', 'All 3 verification attempts failed', { loopStats });
      await wait(WAIT.SHORT);
      continue;
    }

    // Step 1: Click "即刻订阅"
    monitor.log('INFO', 'STEP1', 'Clicking "即刻订阅"...');
    loopStats.subscribeAttempts++;

    // STEP1: structural refactor 2026-06-27 — use clickByExactText instead of
    // querySelectorAll('*') + textContent (Codex structural improvement #4).
    // After click, assert either a plan-selection modal opened or a 继续订阅
    // button appeared — proves the click actually did something.
    const step1Click = await clickByExactText(page, '即刻订阅');

    if (!step1Click.ok) {
      monitor.log('WARN', 'STEP1', `"即刻订阅" button not found (${step1Click.reason}), retrying...`);
      monitor.recordStep('step1_subscribe', { duration: Date.now() - attemptStart, result: step1Click.reason, success: false });
      await wait(WAIT.SHORT);
      continue;
    }

    // State assertion: confirm we actually entered a plan-selection flow.
    // Fix 2026-06-27 (Codex v2-HIGH-2): new users skip the 继续订阅 button
    // and land directly on the plan-selection page (containing 5x Lite 用量额度).
    // Fix 2026-06-27 (Codex v3-MEDIUM-1): collapsed to one waitForAnyText call
    // with a 3000ms budget so a slow page doesn't drop us back to retry loop.
    // Fix 2026-06-27 (Codex v6-MEDIUM-6): wire TIMEOUTS.step1 instead of
    // hardcoded 3000 so env tuning actually takes effect.
    const step1Asserted =
      await waitForAnyText(page, ['继续订阅', '5x Lite 用量额度'], { timeoutMs: TIMEOUTS.step1 });
    if (!step1Asserted) {
      monitor.log('WARN', 'STEP1', 'Clicked 即刻订阅 but no plan-selection state appeared');
      await wait(WAIT.SHORT);
      continue;
    }

    monitor.log('INFO', 'STEP1', 'Subscribe clicked + plan-selection visible');
    // Fix 2026-06-27 (Codex v20-MEDIUM-1): verify page is still on bigmodel.cn
    // after the click. A redirect after 即刻订阅 could make later DOM ops
    // run on the wrong host.
    assertBigModelUrl(page.url(), 'post-step1');
    monitor.recordStep('step1_subscribe', { duration: Date.now() - attemptStart, result: 'clicked', success: true });
    await wait(WAIT.ACTION);
    await monitor.screenshot('02_subscribe', page);

    // Check verification after subscribe
    // Fix 2026-06-27 (Codex v6-CRITICAL-1): previously only checked 'handled',
    // ignoring 'failed'. If captcha appeared but wasn't solved, STEP2/3/4 clicks
    // are all intercepted by the captcha overlay — wasting the purchase window.
    const v2 = await handleVerification(page);
    if (v2 === 'handled') {
      loopStats.verificationHandled++;
      await monitor.screenshot('03_v2_verification', page);
    } else if (v2 === 'failed') {
      monitor.log('WARN', 'VERIFY', 'Verification after subscribe failed — retrying from fresh reload');
      await wait(WAIT.SHORT);
      continue;
    }

    // Step 2: Click "继续订阅" (continues an existing subscription dialog)
    monitor.log('INFO', 'STEP2', 'Looking for "继续订阅"...');

    const step2Click = await clickByExactText(page, '继续订阅');

    if (step2Click.ok) {
      // State assertion: Pro/Lite plan cards must become visible.
      // Fix 2026-06-27 (Codex v6-MEDIUM-6): wire TIMEOUTS.step2.
      const step2Asserted = await waitForText(page, '5x Lite 用量额度', TIMEOUTS.step2);
      if (!step2Asserted) {
        // Fix 2026-06-27 (Codex v16-MEDIUM-2): don't proceed to STEP3/4 if STEP2
        // failed to confirm plan cards appeared. Continuing wastes purchase-window
        // time and lets later selectors operate against stale/unrelated UI.
        monitor.log('WARN', 'STEP2', 'Clicked 继续订阅 but no plan cards appeared — retrying from fresh reload');
        monitor.recordStep('step2_continue', {
          duration: Date.now() - attemptStart,
          result: 'clicked-but-no-plan-cards',
          success: false
        });
        await wait(WAIT.SHORT);
        continue;
      } else {
        monitor.log('INFO', 'STEP2', '"继续订阅" clicked + plan cards visible');
        // Fix 2026-06-27 (Codex v20-MEDIUM-1): verify still on bigmodel.cn
        // after 继续订阅 click.
        assertBigModelUrl(page.url(), 'post-step2');
      }
      await wait(WAIT.ACTION * 1.5);
      await monitor.screenshot('04_plan_selection', page);

      // Fix 2026-06-27 (Codex v6-CRITICAL-1): same as v2 above — if captcha
      // appeared after plan dialog but wasn't solved, don't continue to STEP3/4.
      const v3 = await handleVerification(page);
      if (v3 === 'handled') {
        loopStats.verificationHandled++;
        await monitor.screenshot('05_v3_plan_verification', page);
      } else if (v3 === 'failed') {
        monitor.log('WARN', 'VERIFY', 'Verification after plan dialog failed — retrying from fresh reload');
        await wait(WAIT.SHORT);
        continue;
      }
    } else {
      monitor.log('INFO', 'STEP2', `No 继续订阅 button (${step2Click.reason}) — skipping (may be new subscriber flow)`);
    }

    // Step 3: Select Pro plan + 连续包年. Refactor 2026-06-27:
    //   - findVisibleByTextContains() locates the Pro card via stable fragment.
    //   - clickByExactText() inside that card selects 连续包年.
    //   - State assertion: the pay button must become enabled afterwards.
    monitor.log('INFO', 'STEP3', 'Selecting Pro 连续包年...');
    const step3Start = Date.now();

    let proSelected = 'Not found';
    const proCard = await findVisibleByTextContains(page, '5x Lite 用量额度', {
      requiredText: ['连续包年', '立即购买', '立即订阅', '应付金额']
    });

    if (!proCard) {
      monitor.log('WARN', 'STEP3', 'Pro plan card (containing "5x Lite 用量额度") not visible');
    } else if (!proCard.selector) {
      // Fix 2026-06-27 (Codex v3-CRITICAL + v4-HIGH-6): if the selector wasn't
      // unique, fall back to coordinate-based click *scoped to the card's
      // bounding rect*. This is still safer than page-wide search — we click
      // within proCard.rect only.
      // Fix 2026-06-27 (Codex v7-HIGH-3): previous fallback used
      // elementsFromPoint(card center), which only hits elements at the exact
      // center point. Buttons are usually at the bottom of the card, not the
      // center. Instead, find all visible interactive elements whose bounding
      // rect is fully inside the card rect, then match by text.
      monitor.log('WARN', 'STEP3', 'Selector not unique; trying rect-scoped button search within Pro card');
      const annualByCoord = await evaluatePossibleClick(page, (rect) => {
        if (!rect) return 'Not found';
        const interactive = document.querySelectorAll(
          'button, a, [role="button"], [class*="btn"], [class*="button"], [class*="option"], [class*="radio"], [class*="select"]'
        );
        for (const el of interactive) {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          if (r.width <= 0 || r.height <= 0 || s.visibility === 'hidden' || s.display === 'none') continue;
          // Element must be inside the card rect
          if (r.left >= rect.x && r.right <= rect.x + rect.width &&
              r.top >= rect.y && r.bottom <= rect.y + rect.height) {
            if (el.textContent.includes('连续包年')) {
              el.click();
              return 'Clicked: 连续包年 (rect-scoped-fallback)';
            }
          }
        }
        return 'Not found';
      }, proCard.rect, 'Clicked: 连续包年 (navigation)');
      proSelected = annualByCoord;
    } else {
      monitor.log('INFO', 'STEP3', `Pro card located: ${proCard.selector}`);
      // Now click 连续包年 inside the Pro card scope.
      const annualClick = await clickByExactText(page, '连续包年', { scope: proCard.selector });
      if (annualClick.ok) {
        proSelected = 'Clicked: 连续包年 (within Pro card)';
      } else {
        // Fallback: any element containing 连续包年 within the card scope.
        const fragmentClick = await evaluatePossibleClick(page, (sel) => {
          const root = sel ? document.querySelector(sel) : document;
          if (!root) return 'Not found';
          const selectable = root.querySelectorAll(
            'button, a, [class*="option"], [class*="radio"], [class*="select"]'
          );
          for (const el of selectable) {
            if (el.textContent.includes('连续包年')) {
              el.click();
              return 'Clicked: 连续包年 (fragment match)';
            }
          }
          return 'Not found';
        }, proCard.selector, 'Clicked: 连续包年 (navigation)');
        proSelected = fragmentClick;
      }
    }

    // State assertion: after selecting 连续包年, the buy button text should
    // reflect the price (e.g. "立即购买" or "立即订阅").
    // Fix 2026-06-27 (Codex v17-HIGH-2): scope assertion to the Pro card.
    // Previously, waitForAnyText searched the full page, so a buy button
    // elsewhere could satisfy the assertion even if the annual click failed.
    // Now we check: (1) pay button text exists within the card, AND (2) an
    // element containing "连续包年" appears selected (aria-selected, aria-checked,
    // or active/selected/checked class).
    // Fix 2026-06-27 (Codex v18-MEDIUM-1): when proCard has no unique selector
    // (rect-scoped fallback), use rect coordinates to locate the card. Also
    // guard the evaluate against EXEC_CONTEXT_ERR during SPA navigation.
    let step3Asserted = false;
    if (proSelected !== 'Not found') {
      try {
        step3Asserted = await page.evaluate(({ selector, rect }) => {
          let root = selector ? document.querySelector(selector) : null;
          // Rect fallback: locate card by its bounding rect
          if (!root && rect) {
            const candidates = [...document.querySelectorAll(
              'div, section, article, li, [class*="plan"], [class*="card"], [class*="item"], [class*="package"]'
            )];
            root = candidates.find(el => {
              const r = el.getBoundingClientRect();
              return Math.abs(r.left - rect.x) < 2 && Math.abs(r.top - rect.y) < 2 &&
                     Math.abs(r.width - rect.width) < 2 && Math.abs(r.height - rect.height) < 2;
            }) || null;
          }
          if (!root) return false;
          const text = root.innerText || '';
          const hasPayButton = /立即购买|立即订阅|应付金额/.test(text);
          const annualNodes = [...root.querySelectorAll('button, [role="button"], [aria-selected], [aria-checked], [class]')]
            .filter(el => (el.innerText || el.textContent || '').includes('连续包年'));
          const annualSelected = annualNodes.some(el =>
            el.getAttribute('aria-selected') === 'true' ||
            el.getAttribute('aria-checked') === 'true' ||
            /\b(active|selected|checked)\b/i.test(el.className || '')
          );
          return hasPayButton && annualSelected;
        }, { selector: proCard && proCard.selector, rect: proCard && proCard.rect });
      } catch (err) {
        if (!EXEC_CONTEXT_ERR.test(err.message)) throw err;
        monitor.log('WARN', 'STEP3', `Plan assertion interrupted during navigation: ${err.message}`);
      }
    }

    // Fix 2026-06-27 (Codex v25-LOW-1): use recordStep so this failure mode
    // surfaces in purchaseFlows / stepTimings / plan_selection recommendations.
    // Previously the data only went into stepStats which the report generator
    // doesn't aggregate from.
    monitor.recordStep('step3_select_plan', {
      duration: Date.now() - step3Start,
      result: proSelected,
      success: step3Asserted
    });
    monitor.log('INFO', 'STEP3', `Pro selection result: ${proSelected}, pay-button visible: ${step3Asserted}`);

    if (!step3Asserted) {
      // Fix 2026-06-27 (Codex v15-HIGH-1): don't proceed to STEP4 if STEP3
      // failed to confirm 连续包年 selection. Continuing without proof risks
      // purchasing the wrong plan/cycle. Instead, retry from a fresh reload.
      monitor.log('WARN', 'STEP3', 'Plan selection failed assertion — retrying from fresh reload');
      await wait(WAIT.SHORT);
      continue;
    }
    // Fix 2026-06-27 (Codex v20-MEDIUM-1): verify still on bigmodel.cn
    // after 连续包年 selection.
    assertBigModelUrl(page.url(), 'post-step3');

    await wait(WAIT.ACTION);
    await monitor.screenshot('06_annual_select', page);

    // Step 4: Click purchase button. Refactor 2026-06-27:
    //   - Locate Pro card via stable fragment "5x Lite 用量额度".
    //   - Click pay button ONLY inside that card scope.
    //   - State assertion already added (lines after) waits for checkout page.
    monitor.log('INFO', 'STEP4', 'Clicking Pro purchase button...');
    const step4Start = Date.now();
    // Fix 2026-06-27 (Codex v20-HIGH-1): capture URL BEFORE the purchase click.
    // If captured after, a synchronous SPA navigation makes urlChanged always
    // false, causing checkout pages that only show 应付金额 to be treated as
    // misses and triggering a reload/retry after a real order was reached.
    const beforePurchaseUrl = page.url();

    let purchaseResult = 'No purchase button found';
    const proCardForBuy = await findVisibleByTextContains(page, '5x Lite 用量额度', {
      requiredText: ['连续包年', '立即购买', '立即订阅', '应付金额']
    });

    if (!proCardForBuy) {
      monitor.log('WARN', 'STEP4', 'Pro card not visible — cannot locate scoped buy button');
    } else if (!proCardForBuy.selector) {
      // Fix 2026-06-27 (Codex v7-HIGH-3): previous fallback used
      // elementsFromPoint(card center) which only hits elements at that exact
      // point. Buttons are usually at the bottom, not the center. Instead, find
      // all visible interactive elements fully inside the card rect and match
      // by text content.
      monitor.log('WARN', 'STEP4', 'Pro card found but selector is not unique; trying rect-scoped button search');
      const coordClick = await evaluatePossibleClick(page, (rect) => {
        if (!rect) return 'Not found';
        const interactive = document.querySelectorAll(
          'button, a, [role="button"], [class*="btn"], [class*="button"]'
        );
        for (const el of interactive) {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          if (r.width <= 0 || r.height <= 0 || s.visibility === 'hidden' || s.display === 'none') continue;
          // Element must be fully inside the card rect
          if (r.left >= rect.x && r.right <= rect.x + rect.width &&
              r.top >= rect.y && r.bottom <= rect.y + rect.height) {
            const buyKeywords = ['立即购买', '立即订阅', '购买', '订阅', '立即开通'];
            const txt = el.textContent || '';
            if (buyKeywords.some(k => txt.includes(k))) {
              el.click();
              return 'Clicked: ' + txt.trim().substring(0, 30) + ' (rect-scoped-fallback)';
            }
          }
        }
        return 'Not found';
      }, proCardForBuy.rect, 'Clicked: purchase button (navigation)');
      // Fix 2026-06-27 (Codex v23-MEDIUM-1): only treat "Clicked: ..." as a
      // successful purchase click. Without this guard, a 'Not found' fallback
      // from evaluatePossibleClick enters the checkout polling loop and wastes
      // the STEP4 timeout window on iterations where no button was clicked.
      if (coordClick && coordClick.startsWith('Clicked:')) {
        purchaseResult = coordClick;
      }
    } else {
      // Try common buy button texts inside the card scope only.
      const buyTexts = ['立即购买', '立即订阅', '购买 Pro', '订阅 Pro', '立即开通'];
      for (const t of buyTexts) {
        const r = await clickByExactText(page, t, { scope: proCardForBuy.selector, contains: true });
        if (r.ok) {
          purchaseResult = 'Clicked: ' + t;
          break;
        }
      }
    }

    monitor.stepStats.step4_purchase = { duration: Date.now() - step4Start, result: purchaseResult };
    monitor.log('INFO', 'STEP4', `Purchase result: ${purchaseResult}`);

    if (purchaseResult.startsWith('Clicked:')) {
      // Fix 2026-06-27 (Codex v10-MEDIUM-4): replace single wait+evaluate with a
      // polling loop that handles navigation context destruction. Previously, a
      // SPA redirect during checkout could throw "Execution context was destroyed"
      // and crash the entire purchase. Now we retry within the timeout window.
      const checkoutDeadline = Date.now() + TIMEOUTS.step4Wait;
      // Fix 2026-06-27 (Codex v19-HIGH-1): 应付金额 exists on plan-selection
      // page too; only accept it as checkout proof if the URL has actually
      // changed (i.e., page navigated). beforePurchaseUrl captured before click.
      let reachedCheckout = false;
      while (Date.now() < checkoutDeadline) {
        try {
          assertBigModelUrl(page.url(), 'post-purchase-click');
          reachedCheckout = await page.evaluate((beforeUrl) => {
            const url = location.href;
            const pathname = location.pathname;
            // Fix 2026-06-27 (Codex v17-MEDIUM-2): guard document.body during
        // fast SPA transitions where body can be null.
        const text = document.body?.innerText || '';
            // Fix 2026-06-27 (Codex v19-HIGH-1): tighten checkout detection.
            // - URL route matching is reliable (checkout/payment/order in pathname)
            // - Checkout-specific text (收银台/确认付款/支付方式/微信支付/支付宝)
            //   is reliable because it only appears on the checkout page.
            // - 应付金额/支付金额 also appear on plan-selection page; only
            //   accept them if the URL has actually changed since the click.
            const onCheckoutRoute = /checkout|payment|order/i.test(pathname);
            const hasCheckoutOnlyText = /收银台|确认付款|支付方式|微信支付|支付宝/.test(text);
            const urlChanged = url !== beforeUrl;
            return onCheckoutRoute || hasCheckoutOnlyText ||
              (urlChanged && /支付金额|应付金额/.test(text));
          }, beforePurchaseUrl);
          if (reachedCheckout) break;
        } catch (err) {
          if (!EXEC_CONTEXT_ERR.test(err.message)) throw err;
          // Context destroyed during navigation — retry
        }
        await wait(150);
      }

      if (!reachedCheckout) {
        monitor.log('WARN', 'STEP4', `Click "${purchaseResult}" did not reach checkout page, treating as miss and retrying`);
        monitor.stepStats.step4_purchase.result = 'Click did not reach checkout';
        purchaseResult = 'No purchase button found'; // Force another refresh iteration
      } else {
        // Fix 2026-06-27 (Codex v7-CRITICAL-1): check final verification BEFORE
        // setting purchaseAttempted. If checkout verification fails, the purchase
        // isn't actually complete — we must continue retrying, not exit with 0.
        const v4 = await handleVerification(page);
        if (v4 === 'failed') {
          // Fix 2026-06-27 (Codex v27-MEDIUM-2): when verification fails AFTER
          // checkout is reached, the page is now on a checkout/payment URL.
          // A bare `continue` would make the next loop iteration's page.reload()
          // reload the checkout page, not the product page. Selectors like
          // 立即订阅 / 继续订阅 / 5x Lite 用量额度 don't exist on checkout,
          // so the loop would spin until the purchase window expires without
          // ever actually retrying the purchase. Navigate back to the product
          // page before continuing so the retry hits the right selectors.
          monitor.log('WARN', 'VERIFY', 'Final checkout verification failed — returning to product page before retry');
          try {
            await page.goto('https://bigmodel.cn/glm-coding', { waitUntil: 'domcontentloaded', timeout: 60000 });
            assertBigModelUrl(page.url(), 'post-v4-failure-reset');
          } catch (err) {
            monitor.log('ERROR', 'VERIFY', `Failed to reset to product page after checkout verify fail: ${err.message}`);
          }
          await wait(WAIT.SHORT);
          continue;
        }
        if (v4 === 'handled') {
          loopStats.verificationHandled++;
          await monitor.screenshot('07_v4_final_verification', page);
        }

        purchaseAttempted = true;
        monitor.stepStats.attempt_duration = Date.now() - attemptStart;
        monitor.log('INFO', 'SUCCESS', 'Purchase click successful — checkout page reached');

        await wait(WAIT.ACTION * 2);
        await monitor.screenshot('08_purchase_result', page);
      }
    } else {
      monitor.log('WARN', 'STEP4', 'No purchase button found, retrying...');
      monitor.stepStats.loop_stats = { attemptCount, loopStats };
      await wait(WAIT.SHORT);
    }
    // Fix 2026-06-27 (Codex v8-MEDIUM-5): use try/finally so every `continue`
    // in the loop body still calls endFlow. Without this, failed attempts skip
    // endFlow and the report undercounts failures.
    } finally {
      monitor.endFlow(purchaseAttempted);
    }
  }

  // ============ FINALIZATION ============
  if (!purchaseAttempted) {
    // Fix 2026-06-27 (Codex v4-CRITICAL + v4-LOW-1 + v5-HIGH-2): a failed
    // purchase must surface as exit code 2 so run-purchase.js / CI / shell
    // wrappers can detect it. To prevent the subsequent report generation,
    // browser-hold wait, or browser.close() from masking that exit code with
    // an unrelated throw, we save the report and close the browser inline
    // before triggering a hard exit. The outer try/finally still cleans up
    // if anything earlier throws.
    const seconds = Math.round(purchaseWindowMs / 1000);
    monitor.log('ERROR', 'LOOP', `Purchase attempt timed out after ${seconds} seconds`);

    // Best-effort inline cleanup: save report + close browser NOW, before
    // any other code path can throw and override exitCode via outer .catch.
    try {
      const report = monitor.generateReport();
      monitor.log('INFO', 'REPORT', 'Purchase execution report generated', {
        duration: report.duration,
        totalEvents: report.totalEvents,
        totalFlows: report.flowAnalysis.totalFlows,
        successfulFlows: report.flowAnalysis.successfulFlows,
        failedFlows: report.flowAnalysis.failedFlows,
        avgFlowDuration: report.flowAnalysis.avgFlowDuration
      });
    } catch (e) {
      monitor.log('ERROR', 'REPORT', `Report generation failed: ${e.message}`);
    }
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    process.exit(2);
  }

  monitor.log('INFO', 'FINAL', 'Current URL:', { url: redactUrl(page.url()) });
  monitor.log('INFO', 'FINAL', 'Total stats', { loopStats, stepStats: monitor.stepStats });

  const report = monitor.generateReport();
  // Don't pass the full `report` object as data: events[] within report can
  // reference back into flows whose events reference back into report — a
  // circular structure that crashes JSON.stringify. Log a flat summary instead.
  monitor.log('INFO', 'REPORT', 'Purchase execution report generated', {
    duration: report.duration,
    totalEvents: report.totalEvents,
    totalFlows: report.flowAnalysis.totalFlows,
    successfulFlows: report.flowAnalysis.successfulFlows,
    failedFlows: report.flowAnalysis.failedFlows,
    avgFlowDuration: report.flowAnalysis.avgFlowDuration
  });

  monitor.log('INFO', 'FINAL', 'Browser staying open for review (2 minutes)...');
  await wait(120000);

  await browser.close();
  monitor.log('INFO', 'SYSTEM', 'Browser closed, script terminated');
  } finally {
    // Fix 2026-06-27 (Codex MEDIUM #11): always close the browser, even on
    // thrown errors. Without this, an unhandled exception leaves a headless
    // Chrome process hanging around.
    if (browser) {
      try { await browser.close(); } catch { /* already closed */ }
    }
  }
})().catch(err => {
  // 修复 2026-06-27（Codex v30-LOW-1）：脱敏错误消息中的 URL。
  // Puppeteer/网络错误可能包含完整 URL，查询参数里可能有敏感 token。
  // 其它 URL 日志已经过 redactUrl() 处理；这里也保持一致。
  const raw = String(err && err.stack || err);
  console.error('[FATAL]', raw.replace(/https?:\/\/[^\s)]+/g, u => redactUrl(u)));
  process.exit(1);
});
