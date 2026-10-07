@echo off
chcp 65001 >nul
title 福宝相册 · 选片工具
cd /d %~dp0
echo 正在启动选片工具，浏览器将自动打开…
start "" http://127.0.0.1:8124
node scripts\curate.mjs
pause
