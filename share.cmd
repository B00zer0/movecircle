@echo off
setlocal
cd /d "%~dp0"

echo [MoveCircle] Starting server...
start "MoveCircle Server" /min "C:\Program Files\nodejs\node.exe" "%~dp0server.js"
timeout /t 2 >nul

echo [MoveCircle] Starting tunnel (localtunnel)...
echo [MoveCircle] Your URL: https://movecircle-artur.loca.lt
cmd //c "node_modules\.bin\lt.cmd --port 4173 --subdomain movecircle-artur"
