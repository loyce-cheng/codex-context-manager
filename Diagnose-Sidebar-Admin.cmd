@echo off
setlocal
call "%~dp0scripts\resolve-runtime.cmd"
set "CONTEXT_LENS_DIAG_NODE=%CONTEXT_LENS_BUNDLED_NODE%"
set "CONTEXT_LENS_DIAG_SCRIPT=%~dp0scripts\diagnose-sidebar.mjs"
if not exist "%CONTEXT_LENS_DIAG_NODE%" (
  echo The Context Lens bundled Node runtime is missing.
  pause
  exit /b 1
)
echo Read-only network diagnosis. Windows will request administrator access.
echo Reads firewall block rules. Does not add rules, disable protection, or restart Codex.
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; try { $probeArgs=([char]34)+$env:CONTEXT_LENS_DIAG_SCRIPT+([char]34)+' --firewall'; $probeProcess=Start-Process -FilePath $env:CONTEXT_LENS_DIAG_NODE -ArgumentList $probeArgs -Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $probeProcess.ExitCode } catch { Write-Host 'Administrator diagnostic cancelled or failed.'; exit 1 }"
if errorlevel 1 (
  echo Diagnosis did not finish. No network settings were changed.
) else (
  echo Report saved to .research\sidebar-network-diagnostic.json
)
pause
