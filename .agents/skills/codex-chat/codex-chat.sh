#!/usr/bin/env bash
# codex-chat.sh — 在 Codex 桌面版里开一个看得见的新对话，发指令，读回复（实际工作在 codex-chat.ps1）
#   bash codex-chat.sh '提示词'                      新对话，项目 = 当前目录
#   bash codex-chat.sh --cwd E:/某项目 -f 任务书.md     指定项目；-f - 读标准输入
#   bash codex-chat.sh --thread last '接着问'         续接上一个对话（或给会话 ID）
#   bash codex-chat.sh --no-wait '…'                 发出去就返回，之后用 read 取回复
#   bash codex-chat.sh read [会话ID|last]             读某个对话的最新回复
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PS1FILE="$(cygpath -w "$HERE/codex-chat.ps1")"
run() { powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PS1FILE" "$@"; }

if [ "$1" = "read" ]; then run -Read -Thread "${2:-last}"; exit $?; fi

ARGS=(); PROMPT=""; FILE=""; CWD="$(pwd -W 2>/dev/null || pwd)"
while [ $# -gt 0 ]; do
  case "$1" in
    -f) FILE="$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    --thread) ARGS+=(-Thread "$2"); shift 2 ;;
    --timeout) ARGS+=(-Timeout "$2"); shift 2 ;;
    --no-wait) ARGS+=(-NoWait); shift ;;
    *) PROMPT="${PROMPT:+$PROMPT }$1"; shift ;;
  esac
done
# 在一级目录发的改用 项目 文件夹：模型设置在 项目\.codex，一级目录里没有
bs='\'; p="${CWD//"$bs"//}"; p="${p%/}"
case "$p" in E:/AI短视频项目|e:/AI短视频项目) CWD="E:/AI短视频项目/项目" ;; esac

PFILE="$(mktemp)"
if [ "$FILE" = "-" ]; then cat > "$PFILE"
elif [ -n "$FILE" ]; then cat "$FILE" > "$PFILE" || { rm -f "$PFILE"; exit 2; }
else printf '%s' "$PROMPT" > "$PFILE"; fi
run -PromptFile "$(cygpath -w "$PFILE")" -Path "$CWD" "${ARGS[@]}"
rc=$?; rm -f "$PFILE"; exit $rc
