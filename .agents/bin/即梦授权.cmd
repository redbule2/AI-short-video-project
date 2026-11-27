@echo off
setlocal
"%~dp0dreamina-canvas.exe" auth login
echo.
"%~dp0dreamina-canvas.exe" auth status --format json
echo.
pause
