@echo off
setlocal
call "%~dp0scripts\resolve-runtime.cmd"
set "CONTEXT_LENS_REPAIR_NODE=%CONTEXT_LENS_BUNDLED_NODE%"
set "CONTEXT_LENS_REPAIR_SCRIPT=%~dp0scripts\manage-codex-loopback.mjs"
if not exist "%CONTEXT_LENS_REPAIR_NODE%" (
  echo Bundled runtime is missing. No settings changed.
  pause
  exit /b 1
)
echo Removes only verified Context Lens Codex loopback rules. Other rules stay unchanged.
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; try { $repairArgs=([char]34)+$env:CONTEXT_LENS_REPAIR_SCRIPT+([char]34)+' remove --approved'; $repairProcess=Start-Process -FilePath $env:CONTEXT_LENS_REPAIR_NODE -ArgumentList $repairArgs -Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $repairProcess.ExitCode } catch { Write-Host 'Removal cancelled or failed.'; exit 1 }"
if errorlevel 1 (
  echo Removal did not complete. Inspect .research\codex-loopback-repair-error.txt.
) else (
  echo Context Lens loopback rules removed. No app was restarted.
)
pause
