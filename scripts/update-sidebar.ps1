$ErrorActionPreference='Stop'
# Compatibility entry for the old offline update command.
$projectRoot=Split-Path -Parent $PSScriptRoot
$runtimeVersion=(Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json).version
if($runtimeVersion -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$'){throw 'Invalid runtime version.'}
$node=Join-Path $projectRoot ("dist/context-lens-"+$runtimeVersion+"-win32-x64/plugins/context-lens/runtime/node.exe")
& $node (Join-Path $PSScriptRoot 'update-sidebar.mjs') @args
exit $LASTEXITCODE
