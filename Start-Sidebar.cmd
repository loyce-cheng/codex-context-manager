@echo off
setlocal
rem Compatibility entry: use the same launcher as the desktop icon.
set "CONTEXT_LENS_LAUNCHER=%~dp0dist\launcher\Context-Lens.exe"
if not exist "%CONTEXT_LENS_LAUNCHER%" (
  echo Context Lens launcher is missing. Keep the complete installation folder.
  pause
  exit /b 1
)
start "" "%CONTEXT_LENS_LAUNCHER%" "%~dp0."
exit /b 0
