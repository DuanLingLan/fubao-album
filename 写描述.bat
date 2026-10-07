@echo off
chcp 65001 >nul
title 福宝相册 · 写文案
cd /d %~dp0
echo 正在启动文案编辑页，浏览器将自动打开…
start "" http://127.0.0.1:8124/captions
node scripts\curate.mjs
pause
