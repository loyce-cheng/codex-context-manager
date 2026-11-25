[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SourceArchive,
    [Parameter(Mandatory)][string]$Dotnet,
    [switch]$StageOnly,
    [ValidatePattern('^\d+\.\d+\.\d+\.\d+$')][string]$DesktopVersion='26.1117.4957.0',
    [ValidatePattern('^\d+\.\d+\.\d+\.\d+$')][string[]]$AdditionalDesktopVersions=@()
)
$ErrorActionPreference = 'Stop'
$archive = (Resolve-Path -LiteralPath $SourceArchive).Path
$sdk = (Resolve-Path -LiteralPath $Dotnet).Path
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$commit = 'c9d38d66c6643e6780a67e280488a36f53b6da4e'
$desktops=@($DesktopVersion)+$AdditionalDesktopVersions
foreach($desktop in $desktops){
    if(([version]$desktop).ToString() -cne $desktop){throw 'Expected a canonical four-part desktop version.'}
}
if(@($desktops | Select-Object -Unique).Count -ne $desktops.Count){throw 'Duplicate desktop version.'}
if($desktops.Count -gt 1 -and !$StageOnly){throw 'Multi-version candidates must be staged for desktop validation.'}
if ((Get-FileHash -LiteralPath $archive).Hash -ne '55E34A0139C9520A7219B17F3B7F76B840D5DB9931E29262FE10E44B41BD9699') {
    throw 'Expected the pinned upstream v0.6.2 source archive.'
}
$scratch = Join-Path $project ('.research/loader-build-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$stage = Join-Path $scratch 'publish'
$folder=if($DesktopVersion -eq '26.1117.3838.0'){'experimental-loader-0.6.2'}else{'experimental-loader-0.6.2-'+$DesktopVersion}
$target = if($StageOnly){Join-Path $scratch 'candidate'}else{Join-Path $project ('dist/'+$folder)}
if (Test-Path -LiteralPath $target) { throw "An experimental build already exists at $target. Choose a clean build directory." }
New-Item -ItemType Directory -Path $scratch | Out-Null
tar.exe -xf $archive -C $scratch
if ($LASTEXITCODE -ne 0) { throw 'Source extraction failed.' }
$source = Join-Path $scratch ('codex-script-loader-' + $commit)
Push-Location -LiteralPath $source
try {
    git apply --whitespace=error (Join-Path $PSScriptRoot 'activation-0.6.2.patch')
    if ($LASTEXITCODE -ne 0) { throw 'Activation patch does not apply to this source.' }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'DesktopAliasActivation.cs') -Destination 'windows/src/CodexScriptLoader.Interop/'
    if($DesktopVersion -ne '26.1117.4957.0' -or $desktops.Count -gt 1){
        # Generate only in the scratch copy. A multi-version host must still
        # match the exact desktop selected by the current launch.
        $cs=(Resolve-Path -LiteralPath 'windows/src/CodexScriptLoader.Interop/DesktopAliasActivation.cs').Path
        $body=[IO.File]::ReadAllText($cs)
        $marker='version == new Version(26, 1117, 4957, 0)'
        if([regex]::Matches($body,[regex]::Escape($marker)).Count -ne 1){throw 'Missing or ambiguous desktop version guard.'}
        $guard=($desktops | ForEach-Object {'version == new Version('+($_.Split('.') -join ', ')+')'}) -join ' || '
        if($desktops.Count -gt 1){
            $guard='('+$guard+') && version.ToString() == Environment.GetEnvironmentVariable("LENS_EXPECTED_DESKTOP")'
        }
        [IO.File]::WriteAllText($cs,$body.Replace($marker,$guard))
    }
    $env:DOTNET_CLI_HOME = Join-Path $project '.research/dotnet-build-home'
    $env:NUGET_PACKAGES = Join-Path $project '.research/dotnet-build-packages'
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    $env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
    $env:DOTNET_NOLOGO = '1'
    $csproj = 'windows/src/CodexScriptLoader.Windows/CodexScriptLoader.Windows.csproj'
    & $sdk publish $csproj -c Release -r win-x64 --self-contained true -p:RestoreLockedMode=true -p:NuGetAudit=false -o $stage
    if ($LASTEXITCODE -ne 0) { throw 'Loader publish failed.' }
    Copy-Item -LiteralPath 'LICENSE' -Destination (Join-Path $stage 'LICENSE-Loader.txt')
    Copy-Item -LiteralPath 'windows/branding/README.md' -Destination (Join-Path $stage 'NOTICE-Loader-branding.md')
    if (!(Test-Path -LiteralPath (Join-Path $stage 'CodexScriptLoader.exe'))) { throw 'Published host is missing.' }
    $files = @(Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object FullName | ForEach-Object {
        [ordered]@{path=$_.FullName.Substring($stage.Length+1).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant()}
    })
    $manifest = [ordered]@{version='0.6.2'; commit=$commit; files=$files}
    [IO.File]::WriteAllText((Join-Path $stage 'context-lens-build.json'), ($manifest | ConvertTo-Json -Depth 4))
    Move-Item -LiteralPath $stage -Destination $target
    Write-Output $target
} finally { Pop-Location }
