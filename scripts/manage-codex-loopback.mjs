// Optional repair, never part of normal plugin import. Requires explicit user approval/UAC.
// Allows TCP loopback only for the verified Codex executable; no LAN/public or outbound rules.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const mode=process.argv[2];
if(!['install','remove'].includes(mode)||!process.argv.includes('--approved'))throw Error('Use install/remove --approved only after user approval.');
const expectedVersion=process.argv.find(arg=>arg.startsWith('--expected-version='))?.slice('--expected-version='.length)??null;
if(expectedVersion!==null&&!/^\d+\.\d+\.\d+\.\d+$/.test(expectedVersion))throw Error('Invalid approved app version.');
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),run=promisify(execFile);
const common=String.raw`
$ErrorActionPreference='Stop'
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator access required.'}
$marker='Context Lens: Codex TCP loopback only, local and remote 127.0.0.1, version-bound executable, reversible.'
function Test-OwnedRule($rule){
 if($rule.Name -notmatch '^ContextLens-CodexLoopback-[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' -or $rule.Description -ne $marker -or $rule.Group -ne 'Context Lens loopback repair'){return $false}
 $address=$rule|Get-NetFirewallAddressFilter;$ports=$rule|Get-NetFirewallPortFilter;$appFilter=$rule|Get-NetFirewallApplicationFilter
 $program=[string]$appFilter.Program
 if($program -notmatch '^[A-Z]:\\(?:[^\\:*?"<>|]+\\)*WindowsApps\\OpenAI\.Codex_(\d+\.\d+\.\d+\.\d+)_x64__2p2nqsd0c76g0\\app\\(?:ChatGPT|Codex)\.exe$'){return $false}
 if($rule.Name -ne ('ContextLens-CodexLoopback-'+$Matches[1]) -or [IO.Path]::GetFullPath($program) -ine $program){return $false}
 return ([string]$rule.Action -eq 'Allow' -and [string]$rule.Direction -eq 'Inbound' -and [string]$rule.EdgeTraversalPolicy -eq 'Block' -and
  [string]$address.LocalAddress -eq '127.0.0.1' -and [string]$address.RemoteAddress -eq '127.0.0.1' -and
  [string]$ports.Protocol -in @('TCP','6') -and [string]$ports.LocalPort -eq 'Any' -and [string]$ports.RemotePort -eq 'Any')
}
`;
const install=String.raw`
$package=@(Get-AppxPackage -Name OpenAI.Codex | Where-Object { $_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' -and [string]$_.Architecture -eq 'X64' })
if($package.Count -ne 1){throw 'Cannot confirm the registered Codex package.'}
$version=[string]$package[0].Version
$expectedPackage='OpenAI.Codex_'+$version+'_x64__2p2nqsd0c76g0'
$dir=[IO.Path]::GetFullPath($package[0].InstallLocation)
if($package[0].PackageFullName -ine $expectedPackage -or [IO.Path]::GetFileName($dir) -ine $expectedPackage -or
  [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($dir)) -ine 'WindowsApps'){throw 'Unexpected registered package path.'}
$allowed=@((Join-Path $dir 'app\ChatGPT.exe'),(Join-Path $dir 'app\Codex.exe'))
$apps=@(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe' OR Name = 'Codex.exe'" | Where-Object { $_.ExecutablePath -in $allowed -and $_.CommandLine -notmatch '--type=' })
if($apps.Count -ne 1){throw 'Open exactly one verified Codex main process before installing this repair.'}
$program=$apps[0].ExecutablePath
$name='ContextLens-CodexLoopback-'+$version
if($approvedVersion -and $version -ne $approvedVersion){throw 'Codex version differs from the specifically approved version; nothing changed.'}
$existing=Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
$created=$false
try{
 if($existing){
  if(-not (Test-OwnedRule $existing) -or ($existing|Get-NetFirewallApplicationFilter).Program -ine $program){throw 'Existing rule does not match the expected ownership/scope; nothing changed.'}
  $rule=$existing
 }else{
  $rule=New-NetFirewallRule -Name $name -DisplayName ('Context Lens Codex loopback '+$version) -Description $marker -Group 'Context Lens loopback repair' -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol TCP -LocalAddress 127.0.0.1 -RemoteAddress 127.0.0.1 -LocalPort Any -RemotePort Any -Program $program -EdgeTraversalPolicy Block
  $created=$true
 }
 if(-not (Test-OwnedRule $rule)){throw 'Rule validation failed.'}
 [pscustomobject]@{operation='install';version=$version;name=$name;program=$program;created=$created;localAddress='127.0.0.1';remoteAddress='127.0.0.1';protocol='TCP';localPorts='Any';persistent=$true}|ConvertTo-Json -Compress
}catch{
 if($created){$candidate=Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue;if($candidate -and $candidate.Description -eq $marker){$candidate|Remove-NetFirewallRule}}
 throw
}
`;
const remove=String.raw`
$rules=@(Get-NetFirewallRule -Name 'ContextLens-CodexLoopback-*' -ErrorAction SilentlyContinue)
foreach($rule in $rules){if(-not (Test-OwnedRule $rule)){throw 'A matching name has unexpected ownership/scope; nothing removed.'}}
$removed=@(foreach($rule in $rules){$name=$rule.Name;$rule|Remove-NetFirewallRule;if(Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue){throw 'Removal verification failed.'};$name})
[pscustomobject]@{operation='remove';removed=$removed}|ConvertTo-Json -Compress
`;
try{
 const result=await run(join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),['-NoProfile','-NonInteractive','-Command',"$approvedVersion='"+(expectedVersion??'')+"'\n"+common+(mode==='install'?install:remove)],{windowsHide:true,timeout:30000,maxBuffer:16384});
 const report=JSON.parse(result.stdout.replace(/^\uFEFF/,''));report.checkedAt=new Date().toISOString();await mkdir(join(root,'.research'),{recursive:true});await writeFile(join(root,'.research','codex-loopback-repair.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){await mkdir(join(root,'.research'),{recursive:true});await writeFile(join(root,'.research','codex-loopback-repair-error.txt'),String(error.stderr??error.message));console.error('Repair did not complete. Inspect the local error report; no global firewall settings were changed.');process.exitCode=1;}
