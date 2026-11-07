#!/usr/bin/env bash
# chatgpt-image.sh — 在 Codex 桌面版的 ChatGPT 模式里出图，存原图（实际工作在 chatgpt-image.ps1）
#   bash chatgpt-image.sh '提示词' --out 资产/某图.png
#   bash chatgpt-image.sh -f 提示词.txt --out 某目录/          -f - 读标准输入
#   其他参数：--timeout 秒（默认 600）、--force（同名覆盖）
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PS1FILE="$(cygpath -w "$HERE/chatgpt-image.ps1")"
ARGS=(); PROMPT=""; FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    -f) FILE="$2"; shift 2 ;;
    --out) o="$2"; case "$o" in /*) o="$(cygpath -w "$o")" ;; esac; ARGS+=(-Out "$o"); shift 2 ;;
    --timeout) ARGS+=(-Timeout "$2"); shift 2 ;;
    --force) ARGS+=(-Force); shift ;;
    *) PROMPT="${PROMPT:+$PROMPT }$1"; shift ;;
  esac
done

PFILE="$(mktemp)"
if [ "$FILE" = "-" ]; then cat > "$PFILE"
elif [ -n "$FILE" ]; then cat "$FILE" > "$PFILE" || { rm -f "$PFILE"; exit 2; }
else printf '%s' "$PROMPT" > "$PFILE"; fi
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "$PS1FILE" -PromptFile "$(cygpath -w "$PFILE")" "${ARGS[@]}"
rc=$?; rm -f "$PFILE"; exit $rc
