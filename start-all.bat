@echo off
cd /d "%~dp0"
start "UrbanFlow engine" cmd /k start-backend.bat
start "UrbanFlow site" cmd /k start-frontend.bat
timeout /t 12 >nul
start http://127.0.0.1:8080
