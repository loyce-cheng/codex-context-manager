@echo off
set "CONTEXT_LENS_BUNDLED_NODE="
set "CONTEXT_LENS_MANIFEST=%~dp0..\package.json"
pushd "%SystemRoot%\System32\WindowsPowerShell\v1.0" || exit /b 1
for /f "delims=" %%V in ('.\powershell.exe -NoProfile -NonInteractive -Command "$v=(Get-Content -Raw -LiteralPath $env:CONTEXT_LENS_MANIFEST | ConvertFrom-Json).version; if($v -match '^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$'){Write-Output $v}"') do set "CONTEXT_LENS_BUNDLED_NODE=%~dp0..\dist\context-lens-%%V-win32-x64\plugins\context-lens\runtime\node.exe"
popd
set "CONTEXT_LENS_MANIFEST="
