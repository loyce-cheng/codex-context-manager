param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw '.NET Framework C# compiler is unavailable.' }
$out = if ($OutputDirectory) { $OutputDirectory } else { Join-Path $projectRoot 'dist\launcher' }
New-Item -ItemType Directory -Path $out -Force | Out-Null
& $compiler /nologo /target:winexe /optimize+ /platform:anycpu /reference:System.Windows.Forms.dll ('/out:' + (Join-Path $out 'Context-Lens.exe')) (Join-Path $projectRoot 'packaging\windows-launcher\ContextLensLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
& $compiler /nologo /target:winexe /optimize+ /platform:anycpu /reference:System.Windows.Forms.dll /reference:System.Drawing.dll ('/out:' + (Join-Path $out 'Context-Lens-Recovery.exe')) (Join-Path $projectRoot 'packaging\windows-launcher\LoaderRecovery.cs')
if ($LASTEXITCODE -ne 0) { throw 'Recovery tool compilation failed.' }
Copy-Item -LiteralPath (Join-Path $out 'Context-Lens.exe') -Destination (Join-Path $out 'Install-Context-Lens.exe') -Force
Copy-Item -LiteralPath (Join-Path $out 'Context-Lens.exe') -Destination (Join-Path $out 'Context-Lens-Experimental.exe') -Force
Copy-Item -LiteralPath (Join-Path $out 'Context-Lens.exe') -Destination (Join-Path $out 'Context-Lens-Status.exe') -Force
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
Copy-Item -LiteralPath (Join-Path $out 'Context-Lens-Recovery.exe') -Destination (Join-Path $out "Codex-Context-Manager-$version-Recovery.exe") -Force
Write-Output (Join-Path $out 'Context-Lens.exe')
