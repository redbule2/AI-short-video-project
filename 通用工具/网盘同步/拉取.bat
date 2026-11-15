@echo off
chcp 65001 >nul
title 拉取（网盘 → 本机，挑着拉）
where node >nul 2>nul
if errorlevel 1 (
  echo 这台电脑没装 Node.js。先去 https://nodejs.org 装一个，再双击这里。
  pause
  exit /b 1
)
node "%~dp0网盘同步.js" 拉取
echo.
pause
