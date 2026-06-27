#!/bin/bash
# Fix 2026-06-27 (Codex v6-MEDIUM-8): use set -euo pipefail so cd failures
# and unset variables abort the script instead of silently continuing.
# Fix 2026-06-27 (Codex v27-LOW-1): use BASH_SOURCE[0] instead of $0 to derive
# SCRIPT_DIR. When the script is invoked as `./wait-and-purchase.sh` or with a
# relative path containing a directory component (e.g. `bin/wait-and-purchase.sh`),
# the relative $0 no longer resolves after `cd "$(dirname "$0")"`. The
# caffeinate re-exec then fails because caffeinate can't find the script. Use
# BASH_SOURCE[0] (always set to the script's invocation path) and resolve it
# to an absolute path so subsequent re-exec works regardless of how the
# script was invoked.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename -- "${BASH_SOURCE[0]}")"
cd "$SCRIPT_DIR"

# 目标时间：必填。北京 10:00 对应 02:00Z，例如：
#   TARGET_ISO="2026-06-28T02:00:00.000Z" ./wait-and-purchase.sh
# 修复 2026-06-27（Codex v28-MEDIUM-1）：强制要求显式提供 TARGET_ISO。
# 之前的硬编码默认值在抢购日期之后会静默过期，导致脚本立即启动
# 或在非抢购时段浪费登录/预热窗口。
# `: ${VAR:?msg}` 在 VAR 未设置或为空时打印消息并退出。
: "${TARGET_ISO:?Set TARGET_ISO, e.g. TARGET_ISO=2026-06-28T02:00:00.000Z}"

echo "[$(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')] [WAIT] Target: $TARGET_ISO"

# === Anti-sleep wrapper ===
# Root cause of 2026-06-27 drift: Mac entered Idle Sleep at 09:48:29 (last UserIsActive
# assertion timed out), script was frozen until 10:03:29 DarkWake. Lost ~15 min.
# Fix: re-exec under `caffeinate -is` which asserts PreventUserIdleSystemSleep +
# PreventUserIdleDisplaySleep for as long as the wrapped process lives.
# Fix 2026-06-27 (Codex review MEDIUM #12): caffeinate is macOS-only. On Linux
# or other systems, fall back to running without anti-sleep rather than
# exec-failing the whole script.
# Fix 2026-06-27 (Codex v6-MEDIUM-8): use ${CAFFEINATED:-} so set -u doesn't
# abort on an unset variable.
# Fix 2026-06-27 (Codex v27-LOW-1): re-exec with $SCRIPT_PATH (absolute), not $0.
if [ -z "${CAFFEINATED:-}" ]; then
  if command -v caffeinate >/dev/null 2>&1; then
    echo "[$(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')] [WAIT] Re-execing under caffeinate -is (anti-sleep)..."
    export CAFFEINATED=1
    exec caffeinate -is "$SCRIPT_PATH" "$@"
  else
    echo "[$(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')] [WAIT] caffeinate not found (non-macOS); running without anti-sleep wrapper."
  fi
fi

# Fix 2026-06-27 (Codex v14-HIGH-3): delegate all timing/login/purchase logic
# to run-purchase.js instead of running auto-purchase.js directly. Previously,
# this shell script had its own drift-compensating wait loop and then launched
# auto-purchase.js, which bypassed run-purchase.js's login refresh, process
# supervision, and signal forwarding. Now the shell wrapper only handles
# anti-sleep (caffeinate) and environment setup; run-purchase.js handles
# everything else.
echo "[$(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')] [LAUNCH] Starting run-purchase.js"
export TARGET_TIME="$TARGET_ISO"
# Fix 2026-06-27 (Codex v7-HIGH-2): respect user-set PURCHASE_WINDOW_MS
# instead of unconditionally overriding with 300000.
export PURCHASE_WINDOW_MS="${PURCHASE_WINDOW_MS:-300000}"
exec node run-purchase.js
