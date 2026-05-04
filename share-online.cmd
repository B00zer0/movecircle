@echo off
setlocal
cd /d "%~dp0"
echo Starting MoveCircle with Cloudflare Tunnel...
echo.
start "MoveCircle Server" /min "C:\Program Files\nodejs\node.exe" "%~dp0server.js"
timeout /t 2 >nul
echo Starting Cloudflare Tunnel...
echo This will give you a permanent URL to share with friends.
echo.
npx --yes cloudflared tunnel --url http://localhost:4173
