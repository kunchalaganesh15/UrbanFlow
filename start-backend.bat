@echo off
setlocal
cd /d "%~dp0backend"
if not exist .venv (
  echo Creating Python environment ^(first run only^)...
  py -3.11 -m venv .venv || py -3 -m venv .venv || goto :fail
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip
  python -m pip install -r requirements.txt || goto :fail
) else (
  call .venv\Scripts\activate.bat
)
echo.
echo UrbanFlow engine starting on http://127.0.0.1:8000  ^(Ctrl+C to stop^)
echo The first analysis downloads the YOLO model, which needs internet access.
uvicorn app:app --host 127.0.0.1 --port 8000
goto :eof
:fail
echo Setup failed. Check that Python 3.11+ is installed and on PATH.
pause
