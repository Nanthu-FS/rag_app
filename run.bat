@echo off
cd /d "%~dp0"
"C:\Users\admin\AppData\Local\Programs\Python\Python310\python.exe" -m streamlit run app.py --server.port 8501
