@echo off
chcp 65001 >nul
title 设置网盘（每台电脑一次）
where node >nul 2>nul
if errorlevel 1 (
  echo 这台电脑没装 Node.js。先去 https://nodejs.org 装一个，再双击这里。
  pause
  exit /b 1
)
node "%~dp0网盘同步.js" 设置
echo.
pause
