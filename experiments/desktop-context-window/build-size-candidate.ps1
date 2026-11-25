# Run in a configured MSVC/Rust build shell with the same V8 inputs as the verified CLI.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CrateRoot,
    [Parameter(Mandatory)][string]$TargetDirectory,
    [ValidateRange(1,16)][int]$Jobs=2
)
$ErrorActionPreference='Stop'
$crates=(Resolve-Path -LiteralPath $CrateRoot).Path
$out=[IO.Path]::GetFullPath($TargetDirectory)
$project=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$scratch=Join-Path $project '.research'
if(!$out.StartsWith(($scratch+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)){throw 'Choose a dedicated candidate directory under .research.'}
$policy=Join-Path $crates 'app-server/src/request_processors/turn_processor/desktop_tiers.rs'
if((Get-FileHash -LiteralPath $policy).Hash -ne (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'desktop_tiers.rs')).Hash){throw 'The prepared source does not contain the matching desktop tier policy.'}
if(!(Test-Path -LiteralPath $env:RUSTY_V8_ARCHIVE -PathType Leaf) -or !(Test-Path -LiteralPath $env:RUSTY_V8_SRC_BINDING_PATH -PathType Leaf)){throw 'The pinned local V8 archive and bindings are required.'}
$null=New-Item -Path $out -ItemType Directory -Force
$env:CARGO_TARGET_DIR=$out
$env:CARGO_INCREMENTAL='0'
$env:CARGO_PROFILE_RELEASE_OPT_LEVEL='s'
$env:CARGO_PROFILE_RELEASE_DEBUG='0'
$env:CARGO_PROFILE_RELEASE_STRIP='symbols'
# Avoid cross-crate ThinLTO memory pressure on a personal machine.
$env:CARGO_PROFILE_RELEASE_LTO='off'
$env:CARGO_NET_OFFLINE='true'
$log=Join-Path $out 'build.log'
Push-Location -LiteralPath $crates
try{
    & cargo.exe build --locked --offline --release --jobs $Jobs -p codex-cli --bin codex *> $log
    if($LASTEXITCODE -ne 0){Get-Content -LiteralPath $log -Tail 16;throw 'Size-optimized candidate build failed.'}
    $file=Get-Item -LiteralPath (Join-Path $out 'release/codex.exe')
    [pscustomobject]@{path=$file.FullName;bytes=$file.Length;sha256=(Get-FileHash -LiteralPath $file.FullName).Hash.ToLowerInvariant()} | ConvertTo-Json -Compress
}finally{Pop-Location}
