$ErrorActionPreference = 'Stop'
# First install only. Do not overwrite an existing Loader configuration or extension.
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'native-sidebar\manifest.json') | ConvertFrom-Json
if ($release.id -ne 'local.context-lens.sidebar' -or $release.version -notmatch '^\d+\.\d+\.\d+(?:-(?:alpha|beta)\.\d+)?$') { throw 'Unexpected sidebar release.' }
$packageRoot = Join-Path $projectRoot ('dist\context-lens-sidebar-' + $release.version)
$localData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$loaderRoot = Join-Path $localData 'Programs\CodexScriptLoader'
$dataRoot = Join-Path $localData 'CodexScriptLoader'
$configPath = Join-Path $dataRoot 'config.json'
$targetRoot = Join-Path $dataRoot 'scripts\local.context-lens.sidebar'
if (-not (Test-Path -LiteralPath (Join-Path $loaderRoot '.codex-script-loader-install'))) { throw 'Install Codex Script Loader first.' }
if (Get-Process -Name 'CodexScriptLoader' -ErrorAction SilentlyContinue) { throw 'Loader is running. Use its package import instead.' }
if ((Test-Path -LiteralPath $configPath) -or (Test-Path -LiteralPath $targetRoot)) { throw 'An existing Loader configuration or Context Lens package was found. Nothing was overwritten; use Loader ZIP import.' }
$manifest = Get-Content -Raw -LiteralPath (Join-Path $packageRoot 'manifest.json') | ConvertFrom-Json
if ($manifest.id -ne $release.id -or $manifest.version -ne $release.version) { throw 'Unexpected package identity.' }
$files = @('manifest.json','index.js','README.md','NOTICE.md','LICENSE')
foreach ($name in $files) { if (-not (Test-Path -LiteralPath (Join-Path $packageRoot $name) -PathType Leaf)) { throw "Missing package file: $name" } }
$scriptsRoot = Split-Path -Parent $targetRoot
[IO.Directory]::CreateDirectory($scriptsRoot) | Out-Null
$staging = Join-Path $dataRoot ('staging-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($staging) | Out-Null
foreach ($name in $files) {
  $sourceFile = Join-Path $packageRoot $name
  $targetFile = Join-Path $staging $name
  Copy-Item -LiteralPath $sourceFile -Destination $targetFile
  if ((Get-FileHash -LiteralPath $sourceFile).Hash -ne (Get-FileHash -LiteralPath $targetFile).Hash) { throw "Copied file hash mismatch: $name" }
}
# Loader v0.6.1 ScriptRegistry reads this schema and discovers manifest directories at startup.
# Enable only the requested extension; the bundled demonstration plugin stays disabled.
$config = @{ schemaVersion=1; globalEnabled=$true; safeMode=$false; scripts=@{
  'local.context-lens.sidebar'=@{enabled=$true}
  'dev.codex-script-loader.example-ui'=@{enabled=$false}
} }
$pendingConfig = "$staging.json"
[IO.File]::WriteAllText($pendingConfig, ($config | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
[IO.Directory]::Move($staging, $targetRoot)
try { [IO.File]::Move($pendingConfig, $configPath) }
catch { [IO.Directory]::Move($targetRoot, $staging); throw }
@{ registered=$true; running=$false; target=$targetRoot; config=$configPath; version=$manifest.version } | ConvertTo-Json
