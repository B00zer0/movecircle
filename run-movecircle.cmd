@echo off
setlocal
cd /d "%~dp0"
start "MoveCircle Server" /min "C:\Program Files\nodejs\node.exe" "%~dp0server.js"
timeout /t 2 >nul
start "" http://127.0.0.1:4173
