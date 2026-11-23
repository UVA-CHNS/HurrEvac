@echo off
cd /d "%~dp0docs"
set PY=
where py >nul 2>nul && set PY=py
if not defined PY where python >nul 2>nul && set PY=python
if not defined PY goto nopython
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000/index.html"
%PY% -m http.server 8000
pause
exit /b

:nopython
echo Python was not found on the PATH.
echo Open "Anaconda Prompt" (or any terminal where Python works), then run:
echo     conda activate your_environment
echo     cd /d "%~dp0docs"
echo     python -m http.server 8000
echo and open http://localhost:8000/index.html in your browser.
pause
