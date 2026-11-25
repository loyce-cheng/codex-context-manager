// Requires explicit user approval: temporarily allow only the verified Codex loopback port.
// A unique rule name, exact ownership marker, finally cleanup and a watchdog prevent broad changes.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
const run=promisify(execFile),self=fileURLToPath(import.meta.url),root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
async function ps(code){const r=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'\n${code}`],{windowsHide:true,timeout:15000,maxBuffer:16384});return JSON.parse(r.stdout.replace(/^\uFEFF/,''));}
function ruleIdentity(name,marker){if(!/^ContextLens-Probe-[a-f0-9-]{36}$/.test(name)||!/^Context Lens temporary loopback diagnostic [a-f0-9-]{36}$/.test(marker))throw Error('Invalid rule ownership marker');}
async function removeOwnRule(name,marker){ruleIdentity(name,marker);return ps(`
$rule=Get-NetFirewallRule -Name '${name}' -ErrorAction SilentlyContinue
if($rule){if($rule.Description -ne '${marker}'){throw 'Rule ownership mismatch; not removed.'};$rule|Remove-NetFirewallRule}
[pscustomobject]@{absent=(-not [bool](Get-NetFirewallRule -Name '${name}' -ErrorAction SilentlyContinue))}|ConvertTo-Json -Compress
`);}
if(process.argv[2]==='--watchdog'){
 const directory=resolve(process.argv[3]??'');if(!directory.startsWith(join(root,'.research','rule-probe-')))process.exit(2);
 for(let i=0;i<40;i++){await sleep(1000);let r;try{r=JSON.parse(await readFile(join(directory,'receipt.json'),'utf8'));}catch{continue;}
  if(r.finished)process.exit(0);
  if(r.armed&&Date.now()-r.armedAt>=20000){let result;try{result=await removeOwnRule(r.name,r.marker);}catch(e){result={error:String(e.message).slice(0,500)};}await writeFile(join(directory,'watchdog.json'),JSON.stringify(result));process.exit(result.absent?0:1);}
 }process.exit(0);
}
const port=Number(process.argv[2]);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Verified Codex port required.');
if(!process.argv.includes('--approved'))throw Error('Explicit user approval is required before this script is run.');
const uuid=randomUUID(),name='ContextLens-Probe-'+uuid,marker='Context Lens temporary loopback diagnostic '+uuid;
const directory=join(root,'.research','rule-probe-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(directory);
const report={checkedAt:new Date().toISOString(),port,name,temporary:true,completed:false};
const receipt={name,marker,armed:false,finished:false},save=()=>writeFile(join(directory,'receipt.json'),JSON.stringify(receipt));
let attempted=false;
const probe=()=>new Promise(ok=>{const start=Date.now(),socket=net.connect({host:'127.0.0.1',port});let done=false;const finish=status=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();ok({status,elapsedMs:Date.now()-start});};const timer=setTimeout(()=>finish('TIMEOUT'),1800);socket.once('connect',()=>finish('CONNECTED'));socket.once('error',e=>finish(e.code));});
async function versionMetadata(){return new Promise(ok=>{let done=false,chunks=[],bytes=0;const finish=r=>{if(done)return;done=true;clearTimeout(timer);request.destroy();ok(r);};const request=http.get({host:'127.0.0.1',port,path:'/json/version',agent:false},response=>{if(response.statusCode!==200){finish({status:'HTTP_'+response.statusCode});return;}response.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536)finish({status:'TOO_LARGE'});else chunks.push(chunk);});response.on('error',e=>finish({status:e.code??'RESPONSE_ERROR'}));response.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString());finish({status:'OK',browser:typeof value.Browser==='string'?value.Browser.slice(0,100):null,protocol:typeof value['Protocol-Version']==='string'?value['Protocol-Version']:null});}catch{finish({status:'INVALID_JSON'});}});});const timer=setTimeout(()=>finish({status:'TIMEOUT'}),2000);request.on('error',e=>finish({status:e.code??'ERROR'}));});}
const verifyApp=`
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if(-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Elevation required.'}
$apps=@(Get-NetTCPConnection -LocalPort ${port} -State Listen | Where-Object LocalAddress -eq '127.0.0.1' | ForEach-Object {Get-CimInstance Win32_Process -Filter ('ProcessId = '+$_.OwningProcess)} | Where-Object {$_.ExecutablePath -match 'WindowsApps\\\\OpenAI\\.Codex_[^\\\\]+\\\\app\\\\(?:ChatGPT|Codex)\\.exe$' -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -match '--remote-debugging-port=${port}(?:\\s|$)'})
if($apps.Count -ne 1){throw 'Codex listener not verified.'}
$app=$apps[0]
`;
try{
 report.inventory=await ps(verifyApp+`[pscustomobject]@{verified=$true;pid=$app.ProcessId;program=$app.ExecutablePath}|ConvertTo-Json -Compress`);
 report.before=await probe();
 if(report.before.status==='CONNECTED')throw Error('Already connected; no temporary rule needed.');
 await save();const watchdog=spawn(process.execPath,[self,'--watchdog',directory],{windowsHide:true,detached:true,stdio:'ignore'});await new Promise((ok,fail)=>{watchdog.once('spawn',ok);watchdog.once('error',fail);});watchdog.unref();
 receipt.armed=true;receipt.armedAt=Date.now();await save();attempted=true;
 report.rule=await ps(verifyApp+`
if(Get-NetFirewallRule -Name '${name}' -ErrorAction SilentlyContinue){throw 'Unexpected rule name collision.'}
$rule=New-NetFirewallRule -Name '${name}' -DisplayName 'Context Lens temporary localhost verification' -Description '${marker}' -Group 'Context Lens diagnostics' -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol TCP -LocalAddress 127.0.0.1 -RemoteAddress 127.0.0.1 -LocalPort ${port} -Program $app.ExecutablePath -EdgeTraversalPolicy Block
$address=$rule|Get-NetFirewallAddressFilter;$ports=$rule|Get-NetFirewallPortFilter;$application=$rule|Get-NetFirewallApplicationFilter
[pscustomobject]@{name=$rule.Name;action=[string]$rule.Action;direction=[string]$rule.Direction;localAddress=$address.LocalAddress;remoteAddress=$address.RemoteAddress;localPort=$ports.LocalPort;program=$application.Program}|ConvertTo-Json -Compress
`);
 report.during=await probe();if(report.during.status==='CONNECTED')report.metadata=await versionMetadata();report.completed=true;
}catch(error){report.error=String(error.message??error).slice(0,1200);}
finally{
 if(attempted){try{report.cleanup=await removeOwnRule(name,marker);}catch(error){report.cleanup={absent:false,error:String(error.message??error).slice(0,700)};}}
 receipt.finished=!attempted||report.cleanup?.absent===true;await save();
 if(report.cleanup?.absent)report.afterRemoval=await probe();
 await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(root,'.research','rule-probe-latest.json'),JSON.stringify({directory,completed:report.completed,ruleRemoved:report.cleanup?.absent??null},null,2)+'\n');
}
console.log(JSON.stringify({directory,completed:report.completed,ruleRemoved:report.cleanup?.absent,error:report.error}));
if(!report.completed||(attempted&&!report.cleanup?.absent))process.exitCode=1;
