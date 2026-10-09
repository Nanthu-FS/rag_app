@echo off
cd /d "%~dp0"
set "PY=C:\Users\admin\AppData\Local\Programs\Python\Python310\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" -m pip install -r requirements.txt pyinstaller
"%PY%" -m PyInstaller --noconfirm --windowed --onefile --name DiskPulse --add-data "ui;ui" app.py
echo.
echo Built: dist\DiskPulse.exe
