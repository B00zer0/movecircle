@echo off
setlocal
cd /d "%~dp0"
echo Starting MoveCircle server and tunnel...
echo.
start "MoveCircle Server" cmd /c "node server.js"
timeout /t 2 >nul
start "ngrok Tunnel" cmd /c "ngrok http 4173"
echo.
echo Wait 5 seconds, then check your URL at: http://127.0.0.1:4040
echo Share this URL with friends: https://evacuate-overeager-chaperone.ngrok-free.dev
echo.
pause
