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
echo Adds a persistent TCP inbound exception for the currently running Codex executable.
echo Both source and destination are restricted to 127.0.0.1. No LAN/public access.
echo All local TCP ports are included because Loader uses a new port on each launch.
echo Windows will request administrator approval. Undo-Codex-Loopback.cmd removes our rule.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; try { $repairArgs=([char]34)+$env:CONTEXT_LENS_REPAIR_SCRIPT+([char]34)+' install --approved'; $repairProcess=Start-Process -FilePath $env:CONTEXT_LENS_REPAIR_NODE -ArgumentList $repairArgs -Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $repairProcess.ExitCode } catch { Write-Host 'Repair cancelled or failed.'; exit 1 }"
if errorlevel 1 (
  echo Repair did not complete. See .research\codex-loopback-repair-error.txt if present.
) else (
  echo Loopback rule installed. No app was restarted. Report: .research\codex-loopback-repair.json
)
pause
