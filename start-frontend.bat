@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing frontend packages ^(first run only^)...
  call npm install || (echo npm install failed & pause & exit /b 1)
)
call npm run dev -- --host 127.0.0.1 --port 8080
