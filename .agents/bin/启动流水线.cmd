@echo off
setlocal
set "ANTOU_JIMENG=%~dp0dreamina-canvas.exe"
set "NODE="
where.exe node >nul 2>&1 && set "NODE=node"
if not defined NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE (
  echo Node.js was not found. Install Node.js or repair the Codex runtime.
  pause
  exit /b 1
)
cd /d "%~dp0..\.."
"%NODE%" "%~dp0..\skills\annotate-live\server.js" open
pause
