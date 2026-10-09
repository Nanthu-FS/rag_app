@echo off
cd /d "%~dp0"
set "PY=C:\Users\admin\AppData\Local\Programs\Python\Python310\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" -c "import webview, send2trash" 2>nul || "%PY%" -m pip install -r requirements.txt
"%PY%" app.py %*
