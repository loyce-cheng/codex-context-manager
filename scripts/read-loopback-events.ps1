# Read existing network diagnostics only. Does not enable logging/capture or change policy.
param([Parameter(Mandatory=$true)][ValidateRange(1,65535)][int]$Port)
$ErrorActionPreference = 'Stop'
$diagnosticRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$diagnosticDirectory = Join-Path $diagnosticRoot '.research'
$diagnosticOutput = Join-Path $diagnosticDirectory 'loopback-existing-events.json'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$result = [ordered]@{
    checkedAt = [DateTime]::UtcNow.ToString('o')
    elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    captureEnabledByThisScript = $false
    diagnosticPort = $Port
}
try {
    $output = (& netsh.exe wfp show options optionsfor=NETEVENTS 2>&1 | Out-String).Trim()
    $result.wfpOptions = @{ code = $LASTEXITCODE; output = $output.Substring(0, [Math]::Min(1800, $output.Length)) }
} catch { $result.wfpOptions = @{ status = 'QUERY_FAILED'; errorType = $_.Exception.GetType().Name } }
try {
    # The previously verified local diagnostic port only; no login URL or authentication content.
    $eventFile = Join-Path $diagnosticDirectory ('loopback-existing-events-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff') + '.xml')
    # The explicit timewindow query returned FWP_E_INVALID_INTERVAL in the local run.
    # Read its existing bounded event buffer, still scoped to the single diagnostic endpoint.
    $output = (& netsh.exe wfp show netevents "file=$eventFile" protocol=6 remoteaddr=127.0.0.1 "remoteport=$Port" 2>&1 | Out-String).Trim()
    $result.netEvents = @{ code = $LASTEXITCODE; output = $output.Substring(0, [Math]::Min(1800, $output.Length)); file = $eventFile; fileExists = (Test-Path -LiteralPath $eventFile) }
} catch { $result.netEvents = @{ status = 'QUERY_FAILED'; errorType = $_.Exception.GetType().Name } }
try {
    # Query already recorded 5152/5157 events, limited to 10 minutes and the diagnostic endpoint.
    $query = "*[System[(EventID=5152 or EventID=5157) and TimeCreated[timediff(@SystemTime) <= 600000]]] and *[EventData[Data[@Name='DestAddress']='127.0.0.1' and Data[@Name='DestPort']='$Port']]"
    $events = @(Get-WinEvent -LogName Security -FilterXPath $query -MaxEvents 30 -ErrorAction Stop)
    $result.securityEvents = @($events | ForEach-Object {
        $xml = [xml]$_.ToXml()
        $fields = @{}
        foreach ($field in $xml.Event.EventData.Data) { $fields[$field.GetAttribute('Name')] = $field.InnerText }
        @{ time = $_.TimeCreated.ToUniversalTime().ToString('o'); id = $_.Id; filterId = $fields.FilterRTID; layerId = $fields.LayerRTID; destinationPort = $fields.DestPort; applicationFile = [IO.Path]::GetFileName($fields.Application) }
    })
} catch {
    $result.securityEvents = @{ status = if ($_.FullyQualifiedErrorId -match 'NoMatchingEventsFound') { 'NO_MATCHING_RECORDED_EVENTS' } else { 'UNAVAILABLE' }; errorType = $_.Exception.GetType().Name }
}
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $diagnosticOutput -Encoding UTF8
