@echo off
setlocal
call "%~dp0scripts\resolve-runtime.cmd"
set "CONTEXT_LENS_DIAG_NODE=%CONTEXT_LENS_BUNDLED_NODE%"
if not exist "%CONTEXT_LENS_DIAG_NODE%" (
  where node.exe >nul 2>nul
  if errorlevel 1 (
    echo Node.js is unavailable. Keep the Context Lens release runtime beside this project.
    pause
    exit /b 1
  )
  set "CONTEXT_LENS_DIAG_NODE=node.exe"
)
"%CONTEXT_LENS_DIAG_NODE%" "%~dp0scripts\diagnose-sidebar.mjs"
if errorlevel 1 (
  echo Diagnostic failed. Keep the error above for investigation.
  pause
  exit /b 1
)
echo.
echo Read-only diagnostic complete. No app was restarted and no settings were changed.
pause
