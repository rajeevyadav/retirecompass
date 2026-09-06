@echo off
REM Build a standalone RetireCompass.exe (Windows, PyInstaller). Output: dist\RetireCompass.exe
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" python -m venv .venv
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip >nul
pip install -r requirements-build.txt || goto :error
pyinstaller --noconfirm --clean --onefile --name RetireCompass --version-file version_info.txt ^
  --add-data "index.html;." ^
  --add-data "css;css" ^
  --add-data "js;js" ^
  --add-data "assets;assets" ^
  --add-data "LICENSE;." ^
  run_retirecompass.py || goto :error
echo. & echo Done. Executable: dist\RetireCompass.exe
pause
goto :eof
:error
echo. & echo Build failed - see the message above.
pause
exit /b 1
