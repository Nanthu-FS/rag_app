@echo off
REM Personal Intelligence launcher — uses the Python 3.10 interpreter that has the project stack.
setlocal

set PY=C:\Users\admin\AppData\Local\Programs\Python\Python310\python.exe

echo === Personal Intelligence ===
echo Checking dependencies...
"%PY%" -m pip install -q -r "%~dp0backend\requirements.txt"

echo Starting server on http://127.0.0.1:8850
cd /d "%~dp0backend"
"%PY%" -m uvicorn server:app --host 127.0.0.1 --port 8850

endlocal
