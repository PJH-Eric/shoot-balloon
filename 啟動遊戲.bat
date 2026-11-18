@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js
  echo 請先到 https://nodejs.org/ 安裝 Node.js LTS 之後再執行一次。
  echo.
  pause
  exit /b 1
)

node -e "const [major, minor, patch] = process.versions.node.split('.').map(Number); if (major !== 26 || minor < 12 || (minor === 12 && patch < 1)) process.exit(1)"
if errorlevel 1 (
  echo 需要 Node.js 26.12.1 或更新的 26.x 修補版本。
  for /f %%V in ('node --version') do echo 目前版本：%%V
  echo 請安裝 Node.js 26.12.1：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 第一次啟動，正在安裝相依套件（只要做一次，請稍候）…
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [錯誤] 套件安裝失敗，請確認網路連線後再試一次。
    pause
    exit /b 1
  )
  echo.
)

echo ================================================
echo   射氣球 - 單機遊戲
echo ================================================
echo.
echo   這台電腦開遊戲：  http://localhost:3030
echo.
echo   要停止伺服器請按 Ctrl+C 或直接關掉這個視窗。
echo.

start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start "" http://localhost:3030"

node server.js
echo.
echo 伺服器已停止。
pause
