@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   福宝相册 · 一键更新
echo   将自动：压缩新照片 → 生成数据 → 提交推送
echo ============================================
echo.
node scripts\build.mjs
if errorlevel 1 (
  echo.
  echo [X] 构建失败，请查看上方错误信息
  pause
  exit /b 1
)
echo.
node scripts\deploy.mjs
if errorlevel 1 (
  echo.
  echo [X] 推送失败，请检查网络或 git 状态
  pause
  exit /b 1
)
echo.
echo [OK] 更新完成！约 1-2 分钟后线上生效：
echo      https://duanlinglan.github.io/fubao-album/
pause
