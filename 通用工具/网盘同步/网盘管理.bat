@echo off
chcp 65001 >nul
title 网盘管理
where node >nul 2>nul
if errorlevel 1 (
  echo 这台电脑没装 Node.js。先去 https://nodejs.org 装一个，再双击这里。
  pause
  exit /b 1
)
rem 网盘管理就是项目管理（流水线）里「网盘」那一页：项目管理服务没开就先开起来，再用浏览器打开
node "%~dp0..\..\.agents\skills\annotate-live\server.js" open >nul
if errorlevel 1 (
  echo.
  echo 项目管理服务没开起来，看上面的提示。
  pause
  exit /b 1
)
start "" "http://localhost:8766/%%E9%%80%%9A%%E7%%94%%A8%%E5%%B7%%A5%%E5%%85%%B7/%%E6%%B5%%81%%E6%%B0%%B4%%E7%%BA%%BF/%%E7%%BD%%91%%E7%%9B%%98.html"
