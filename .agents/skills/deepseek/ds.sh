#!/usr/bin/env bash
# ds.sh — 调 DeepSeek（deepseek.py）。本机 python 是商店占位符，默认用 Blender 自带的（可用 BRIDGE_PY 指定）。
# 关掉 Git Bash 的自动路径改写：不然以 / 开头的提示词（比如 "/help 是什么"）会被改成 "D:/Apps/Git/help 是什么"。
# 路径参数请写成 C:/… 形式；写成 /c/… 也行，deepseek.py 会自己换算。
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && { pwd -W 2>/dev/null || pwd; })"
PY=""
for c in "${BRIDGE_PY:-}" "D:/Apps/Blender/blender-5.2.3-windows-x64/5.2/python/bin/python.exe" D:/Apps/Blender/*/*/python/bin/python.exe; do
  [ -n "$c" ] && [ -x "$c" ] && PY="$c" && break
done
if [ -z "$PY" ]; then
  echo "找不到可用的 Python，设置 BRIDGE_PY 指向 python.exe" >&2
  echo 'RESULT_JSON {"ok": false, "error": "找不到可用的 Python，设置 BRIDGE_PY 指向 python.exe"}'
  exit 9
fi
exec "$PY" -I "$HERE/deepseek.py" "$@"
