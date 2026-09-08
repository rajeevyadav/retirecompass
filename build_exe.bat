@echo off
REM Build the RetireCompass launcher (Windows, PyInstaller). Output folder:
REM dist\RetireCompass\RetireCompass.exe (a one-folder build, packaged by
REM installer\RetireCompass.iss). A one-folder build is used instead of
REM --onefile because a onefile exe self-extracts a Python runtime to a temp
REM directory at launch, which Windows Defender/SmartScreen heuristics
REM routinely flag as suspicious on an unsigned binary; the folder build does
REM not do that and is far less likely to be false-flagged.
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" python -m venv .venv
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip >nul
pip install -r requirements-build.txt || goto :error
pyinstaller --noconfirm --clean --onedir --name RetireCompass --version-file version_info.txt ^
  --add-data "index.html;." ^
  --add-data "css;css" ^
  --add-data "js;js" ^
  --add-data "assets;assets" ^
  --add-data "LICENSE;." ^
  run_retirecompass.py || goto :error
echo. & echo Done. Launcher: dist\RetireCompass\RetireCompass.exe
pause
goto :eof
:error
echo. & echo Build failed - see the message above.
pause
exit /b 1
