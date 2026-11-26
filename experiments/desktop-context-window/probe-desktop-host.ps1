# Run with PowerShell. Start only an isolated instance of the pinned Store
# desktop and report the backend executable selected by that instance's descendants.
[CmdletBinding(DefaultParameterSetName='Experimental')]
param([Parameter(Mandatory=$true,ParameterSetName='Experimental')][string]$Cli,
      [Parameter(Mandatory=$true,ParameterSetName='Stock')][switch]$Stock,
      [Parameter(Mandatory=$true,ParameterSetName='Adapter')][switch]$FixtureAdapter,
      [Parameter(ParameterSetName='Adapter')][switch]$ProtocolOnly,
      [ValidateRange(0,300)][int]$ObserveSeconds=0,
      [ValidateSet('alias','loader','prototype','built')][string]$Activation='alias',
      [string]$CandidateVersion,
      [string]$ReportPath)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$packageJson=& powershell.exe -NoProfile -NonInteractive -Command 'Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1 Version,InstallLocation,PackageFamilyName,PackageFullName,Architecture | ConvertTo-Json -Compress'
if($LASTEXITCODE -ne 0 -or !$packageJson){throw 'Cannot identify the installed Codex Store package.'}
$package=$packageJson | ConvertFrom-Json
if(!$package){throw 'Missing Codex package.'}
if($FixtureAdapter){
    if($Activation -ne 'alias' -or $CandidateVersion -or $package.PackageFamilyName -ne 'OpenAI.Codex_2p2nqsd0c76g0'){
        throw 'The fixture requires the registered Codex alias and a fresh profile.'
    }
}elseif($CandidateVersion){
    if($Activation -ne 'built' -or $CandidateVersion -ne [string]$package.Version){throw 'Candidate must match the registered desktop version.'}
}elseif([string]$package.Version -notin @('26.1117.3838.0','26.1117.4957.0')){throw 'This desktop build is outside the isolated experiment.'}
$test=Join-Path $root ('.research/desktop-host-'+[guid]::NewGuid())
if($FixtureAdapter){
    $candidate=Join-Path $test 'codex.exe'
    $version='isolated adapter with packaged backend'
}elseif($Stock){
    $candidate=Join-Path $package.InstallLocation 'app/resources/codex.exe'
    $version='packaged'
}else{
    $candidate=(Resolve-Path -LiteralPath $Cli).Path
    if([IO.Path]::GetFileName($candidate) -ne 'codex.exe'){throw 'A complete experimental codex.exe is required.'}
    $version=(& $candidate --version | Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or $version -notmatch '^codex-cli 0\.171\.0-alpha\.13$'){throw "Unexpected candidate version: $version"}
}
$candidate=[IO.Path]::GetFullPath($candidate)
$profile=Join-Path $test 'electron'
$backendHome=Join-Path $test 'home'
[void][IO.Directory]::CreateDirectory($profile)
[void][IO.Directory]::CreateDirectory($backendHome)
$desktop=Join-Path $package.InstallLocation 'app/ChatGPT.exe'
$desktop=[IO.Path]::GetFullPath($desktop)
$aliasDir=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('Microsoft/WindowsApps/'+$package.PackageFamilyName)
$desktopAlias=Join-Path $aliasDir 'chatgpt-desktop.exe'
if(!(Test-Path -LiteralPath $desktopAlias)){throw 'The Codex desktop app execution alias is unavailable.'}
$env:CODEX_HOME=$backendHome
$env:CODEX_ELECTRON_USER_DATA_PATH=$profile
if(!$Stock){
    $env:CODEX_CLI_PATH=$candidate
    if(!$FixtureAdapter){$env:CONTEXT_LENS_DESKTOP_TIERS='1'}
    $env:LENS_EXPECTED_DESKTOP=[string]$package.Version
}
$stockPath=[IO.Path]::GetFullPath((Join-Path $package.InstallLocation 'app/resources/codex.exe'))
$result=[ordered]@{desktopVersion=[string]$package.Version;cliVersion=$version;activation=$Activation;isolatedProfile=$true;started=$false;isolatedMainObserved=$false;candidateObserved=$false;packagedBackendObserved=$false;backendStayedUp=$false;liveCapacityVerified=$false}
$isolated=$null
$issued=[Collections.Generic.HashSet[int]]::new()
$fixture=$null
$profileArgument='--user-data-dir='+$profile.Replace('\','/')
try {
    $aliasArgs='"'+$profileArgument+'"'
    if($FixtureAdapter){
        $adapterDir=Join-Path $PSScriptRoot 'isolated-adapter'
        $compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
        & $compiler /nologo /target:exe "/out:$candidate" (Join-Path $adapterDir 'FixtureCli.cs')
        if($LASTEXITCODE -ne 0){throw 'Could not compile the fixture entry point.'}
        $node=(Get-Command node.exe).Source
        [IO.File]::WriteAllLines((Join-Path $test 'node-entry.txt'),[string[]]@($node,(Join-Path $adapterDir 'adapter.mjs')))
        $fixture=Start-Process -FilePath $node -ArgumentList ('"'+(Join-Path $adapterDir 'prepare.mjs')+'" "'+$test+'" "'+$stockPath+'"') -WorkingDirectory $test -WindowStyle Hidden -PassThru
        $readyFile=Join-Path $test 'fixture-ready.json'
        $readyBy=(Get-Date).AddSeconds(100)
        while(!(Test-Path -LiteralPath $readyFile)){
            if($fixture.HasExited -or (Get-Date) -gt $readyBy){
                $failure=Join-Path $test 'fixture-error.txt'
                if(Test-Path -LiteralPath $failure){throw [IO.File]::ReadAllText($failure)}
                throw 'The isolated adapter protocol test did not finish.'
            }
            Start-Sleep -Milliseconds 200
        }
        $ready=Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json
        $syntheticId=([guid]$ready.targetId).ToString()
        $result.protocolTest=@{target=$ready.target;control=$ready.control}
        # Address only this alias process. Never open a URI via the system handler.
        $entryStart=@(Get-Content -LiteralPath (Join-Path $test 'entry-events.txt')).Count
        if($ProtocolOnly){return}
    }elseif($ObserveSeconds){
        $fixtureScript=Join-Path $PSScriptRoot 'desktop-fixture.mjs'
        $fixture=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList ('"'+$fixtureScript+'" "'+$backendHome+'"') -WindowStyle Hidden -PassThru
        $readyBy=(Get-Date).AddSeconds(12)
        while(!(Test-Path -LiteralPath (Join-Path $backendHome 'config.toml'))){
            if($fixture.HasExited -or (Get-Date) -gt $readyBy){throw 'The local fixture did not initialize.'}
            Start-Sleep -Milliseconds 150
        }
    }
    $windowStyle=if($ObserveSeconds){'Normal'}else{'Hidden'}
    if($Activation -eq 'prototype'){
        Add-Type -Path (Join-Path $PSScriptRoot 'loader/DesktopAliasActivation.cs')
        $launchId=0
        $activated=[CodexScriptLoader.Interop.DesktopAliasActivation]::TryActivate(($package.PackageFamilyName+'!App'),[string[]]@($profileArgument),[ref]$launchId)
        if(!$activated){throw 'The experimental activation option was not selected.'}
    }elseif($Activation -in @('loader','built')){
        $install=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs/CodexScriptLoader'
        $registered=(Get-ItemProperty -LiteralPath 'HKCU:\Software\CodexScriptLoader' -Name InstallDir -ErrorAction SilentlyContinue).InstallDir
        if($registered){
            if($registered -notmatch '^[A-Za-z]:[\\/]' -or $registered -match '(?:^|[\\/])\.\.(?:[\\/]|$)'){throw 'Invalid registered Loader directory.'}
            $install=$registered
        }
        $privateLoader=Join-Path $root 'dist/private-loader'
        if(!(Test-Path -LiteralPath $install) -and (Test-Path -LiteralPath $privateLoader -PathType Container)){$install=$privateLoader}
        $release=Get-Content -Raw -LiteralPath (Join-Path $install 'active.json')|ConvertFrom-Json
        if($release.version -notmatch '^\d+\.\d+\.\d+$' -or $release.launcherProtocol -ne 1 -or $release.rid -ne 'win-x64'){throw 'Unsupported Loader installation.'}
        $interop=Join-Path $install ('versions/'+$release.version+'/win-x64/CodexScriptLoader.Interop.dll')
        if($Activation -eq 'built'){
            if($release.version -ne '0.6.2'){throw 'The built adapter requires Loader 0.6.2.'}
            $folder=if([string]$package.Version -eq '26.1117.3838.0'){'experimental-loader-0.6.2'}else{'experimental-loader-0.6.2-'+[string]$package.Version}
            $interop=Join-Path $root "dist/$folder/CodexScriptLoader.Interop.dll"
        }
        $null=[Reflection.Assembly]::LoadFrom($interop)
        if($Activation -eq 'built' -and ![CodexScriptLoader.Interop.DesktopAliasActivation]::SupportsVersion([version]$package.Version)){throw 'Built adapter version mismatch.'}
        $identity=[CodexScriptLoader.Interop.CodexPackageIdentity]::new($package.PackageFullName,$package.PackageFamilyName,'App',($package.PackageFamilyName+'!App'),[string]$package.Architecture,[version]$package.Version)
        $launchId=[CodexScriptLoader.Interop.ApplicationActivator]::Activate($identity,[string[]]@($profileArgument))
        $result.loaderVersion=$release.version
    }elseif($FixtureAdapter){
        $start=[Diagnostics.ProcessStartInfo]::new($desktopAlias)
        $start.UseShellExecute=$false
        $start.RedirectStandardError=$true
        $start.RedirectStandardOutput=$true
        $start.Environment['APPDATA']=Join-Path $backendHome 'AppData/Roaming'
        $start.Environment['LOCALAPPDATA']=Join-Path $backendHome 'AppData/Local'
        $start.Environment['USERPROFILE']=$backendHome
        $start.WorkingDirectory=$test
        $start.ArgumentList.Add($profileArgument)
        $start.ArgumentList.Add('codex://threads/'+$syntheticId)
        foreach($key in @($start.Environment.Keys)){
            if($key -match '(?i)(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN)$|^CODEX_(?:THREAD_ID|APP_SERVER.*|INTERNAL.*)$'){
                [void]$start.Environment.Remove($key)
            }
        }
        $launched=[Diagnostics.Process]::Start($start)
        $launchId=$launched.Id
        $launched.BeginOutputReadLine()
        $launched.BeginErrorReadLine()
    }else{
        $null=Start-Process -FilePath $desktopAlias -ArgumentList $aliasArgs -WindowStyle $windowStyle -PassThru
    }
    $result.started=$true
    $deadline=(Get-Date).AddSeconds(40)
    if($FixtureAdapter -and $ObserveSeconds){$deadline=$deadline.AddSeconds($ObserveSeconds)}
    do {
        $tree=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine)
        $main=@($tree | Where-Object {$_.ExecutablePath -eq $desktop -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine.Contains($profileArgument)})
        if($main.Count -ne 1){Start-Sleep -Milliseconds 400;continue}
        if($FixtureAdapter -or $Activation -in @('prototype','built')){
            $result.returnedPidMatchesDesktop=($main[0].ProcessId -eq $launchId)
            $result.desktopParentIsActivator=($main[0].ParentProcessId -eq $PID)
        }
        $result.isolatedMainObserved=$true
        $isolated=Get-Process -Id $main[0].ProcessId -ErrorAction SilentlyContinue
        $pids=@($main[0].ProcessId)
        for($level=0;$level -lt 5;$level++){
            $next=@($tree | Where-Object { $_.ParentProcessId -in $pids -and $_.ProcessId -notin $pids } | ForEach-Object ProcessId)
            if(!$next){break}
            $pids+=$next
        }
        $servers=@($tree | Where-Object {$_.ProcessId -in $pids -and $_.CommandLine -match '(?:\s|")app-server(?:\s|")' -and $_.CommandLine -match '(?:\s|")--analytics-default-enabled(?:\s|"|$)'})
        if($FixtureAdapter){
            foreach($entry in @($tree | Where-Object {$_.ProcessId -in $pids -and $_.ExecutablePath -eq $candidate})){
                $mark=Join-Path $test ('allow-'+$entry.ProcessId+'.fixture')
                if($issued.Add([int]$entry.ProcessId)){[IO.File]::WriteAllText($mark,'isolated descendant')}
            }
            $servers=@($tree | Where-Object {$_.ProcessId -in $pids -and $_.CommandLine -match '(?:\s|")app-server(?:\s|"|$)'})
            $result.packagedCliDescendant=$result.packagedCliDescendant -or @($tree | Where-Object {$_.ProcessId -in $pids -and $_.ExecutablePath -eq $stockPath}).Count -gt 0
        }
        if(@($servers | Where-Object ExecutablePath -eq $stockPath).Count){$result.packagedBackendObserved=$true}
        $found=@($servers | Where-Object ExecutablePath -eq $candidate)
        if($FixtureAdapter){
            if($found.Count){
                $result.candidateObserved=$true
                $backend=Get-Process -Id $found[0].ProcessId -ErrorAction SilentlyContinue
                if($backend -and ((Get-Date)-$backend.StartTime).TotalSeconds -ge 3){$result.backendStayedUp=$true}
            }
            $events=@(Get-Content -LiteralPath (Join-Path $test 'adapter-events.txt') | Select-Object -Skip $ready.eventsBeforeDesktop)
            if($result.backendStayedUp -and $result.packagedBackendObserved -and $events -contains 'target-turn-486400'){break}
            Start-Sleep -Milliseconds 300
            continue
        }
        if($found.Count){
            $result.candidateObserved=$true
            $backend=Get-Process -Id $found[0].ProcessId -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 3
            $result.backendStayedUp=($null -ne $backend -and !$backend.HasExited)
            if(!$result.backendStayedUp){continue}
            if($ObserveSeconds){
                Write-Output ('Isolated desktop PID '+$isolated.Id+'; observing the local fixture for '+$ObserveSeconds+' seconds.')
                Start-Sleep -Seconds $ObserveSeconds
            }
            break
        }
        Start-Sleep -Milliseconds 400
    } while((Get-Date) -lt $deadline)
} catch {
    $result.error=$_.Exception.GetBaseException().Message
} finally {
    if($isolated -and !$isolated.HasExited){
        $closeBy=(Get-Date).AddSeconds(15)
        do{
            $isolated.Refresh()
            if($isolated.HasExited){break}
            if($isolated.MainWindowHandle -ne 0){$result.closeRequested=$isolated.CloseMainWindow();break}
            Start-Sleep -Milliseconds 400
        }while((Get-Date) -lt $closeBy)
        if(!$isolated.WaitForExit(5000)){
            $verify=Get-CimInstance Win32_Process -Filter ("ProcessId="+$isolated.Id)
            if($verify.ExecutablePath -eq $desktop -and $verify.CommandLine.Contains($profileArgument)){
                $isolated.Kill()
                $null=$isolated.WaitForExit(5000)
            }
        }
        $result.testInstanceExited=$isolated.HasExited
    }
    if($fixture -and !$fixture.HasExited){$fixture.Kill();$null=$fixture.WaitForExit(5000)}
    if($FixtureAdapter -and $launched){$launched.Dispose()}
    if($FixtureAdapter -and $ready){
        $entries=@(Get-Content -LiteralPath (Join-Path $test 'entry-events.txt') | Select-Object -Skip $entryStart)
        $result.desktopEntryInvoked=$entries.Count -gt 0
        $result.desktopEntryProfileMismatch=$entries -contains 'profile-mismatch'
        $events=@(Get-Content -LiteralPath (Join-Path $test 'adapter-events.txt') | Select-Object -Skip $ready.eventsBeforeDesktop)
        $result.desktopHandshake=$events -contains 'initialize-acknowledged'
        $result.desktopTargetResume=$events -contains 'target-enriched'
        $result.liveCapacityVerified=$result.desktopHandshake -and $result.desktopTargetResume -and $events -contains 'target-turn-486400'
    }
    $json=$result | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $test 'report.json'),$json)
    if($ReportPath){[IO.File]::WriteAllText($ReportPath,$json)}
    $json
}
if(!$result.candidateObserved -or !$result.backendStayedUp -or ($Activation -in @('prototype','built') -and !$result.returnedPidMatchesDesktop)){exit 1}
if($FixtureAdapter -and (!$result.desktopHandshake -or !$result.packagedBackendObserved -or !$result.testInstanceExited)){exit 1}
if($Activation -eq 'built' -and (!$result.desktopParentIsActivator -or $result.packagedBackendObserved -or !$result.testInstanceExited)){exit 1}
