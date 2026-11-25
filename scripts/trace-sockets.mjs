// Temporary, user-authorized TCP/Winsock ETW metadata trace. No packet capture provider.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
const run=promisify(execFile),self=fileURLToPath(import.meta.url),root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
function decode(value){if(!Buffer.isBuffer(value))return String(value??'');try{return new TextDecoder('utf-8',{fatal:true}).decode(value);}catch{return new TextDecoder('gb18030').decode(value);}}
async function logman(args){try{const r=await run('logman.exe',args,{windowsHide:true,timeout:10000,maxBuffer:32768,encoding:'buffer'});return {code:0,text:decode(r.stdout)+decode(r.stderr)};}catch(e){return {code:e.code??'FAILED',text:decode(e.stdout)+decode(e.stderr)};}}
if(process.argv[2]==='--watchdog'){
  const directory=resolve(process.argv[3]??'');if(!directory.startsWith(join(root,'.research','socket-trace-')))process.exit(2);
  for(let i=0;i<25;i++){await sleep(1000);let receipt;try{receipt=JSON.parse(await readFile(join(directory,'receipt.json'),'utf8'));}catch{continue;}
    if(receipt.finished)process.exit(0);
    if(receipt.started&&Date.now()-receipt.startedAt>15000&&/^ContextLens-[a-f0-9-]{36}$/.test(receipt.session)){
      const stop=await logman(['stop',receipt.session,'-ets']);await writeFile(join(directory,'watchdog.json'),JSON.stringify(stop));process.exit(stop.code===0?0:1);
    }
  }process.exit(0);
}
const port=Number(process.argv[2]);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Verified port required.');
const directory=join(root,'.research','socket-trace-'+new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(directory);const session='ContextLens-'+randomUUID(),tracePath=join(directory,'socket-events.etl');
const report={checkedAt:new Date().toISOString(),pid:process.pid,port,session,tracePath,completed:false,packetCaptureEnabled:false};
const receipt={session,started:false,finished:false},save=()=>writeFile(join(directory,'receipt.json'),JSON.stringify(receipt));
let owned=false,server;const sockets=new Set();
const tcpProbe=targetPort=>new Promise(ok=>{const start=Date.now(),socket=net.connect({host:'127.0.0.1',port:targetPort});let done=false;const finish=status=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();ok({targetPort,status,elapsedMs:Date.now()-start,startedAt:new Date(start).toISOString()});};const timer=setTimeout(()=>finish('TIMEOUT'),1800);socket.once('connect',()=>finish('CONNECTED'));socket.once('error',e=>finish(e.code));});
try{
  const inventory=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`
$ErrorActionPreference='Stop'
$p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$apps=@(Get-NetTCPConnection -LocalPort ${port} -State Listen | Where-Object LocalAddress -eq '127.0.0.1' | ForEach-Object {Get-CimInstance Win32_Process -Filter ('ProcessId = '+$_.OwningProcess)} | Where-Object {$_.ExecutablePath -match 'WindowsApps\\\\OpenAI\\.Codex_[^\\\\]+\\\\app\\\\(?:ChatGPT|Codex)\\.exe$' -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -match '--remote-debugging-port=${port}(?:\\s|$)'})
[pscustomobject]@{elevated=$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);verified=($apps.Count -eq 1)}|ConvertTo-Json -Compress
`],{windowsHide:true,timeout:15000,maxBuffer:8192});
  report.inventory=JSON.parse(inventory.stdout.replace(/^\uFEFF/,''));if(!report.inventory.elevated||!report.inventory.verified)throw Error('Admin/main-process listener not verified.');
  // Use manifest providers and connection/diagnosis keywords. Do not enable NDIS packet capture.
  const tcpKeywords=0x400000000n|0x400000n|0x80n|0x200n|0x10000000000n;
  const providers=process.argv.includes('--wfp')
    ? '{0C478C5B-0351-41B1-8C58-4A6737DA32E3} 0x10000000000 4\n'
    : `{2F07E2EE-15DB-40F1-90EF-9D7BA282188A} 0x${tcpKeywords.toString(16)} 5\n{E53C6823-7BB8-44BB-90DC-3F86090D48A6} 0xe 5\n`;
  report.providers=providers.trim().split('\n');await writeFile(join(directory,'providers.txt'),providers,'ascii');
  server=net.createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});report.controlPort=server.address().port;
  await save();const watchdog=spawn(process.execPath,[self,'--watchdog',directory],{windowsHide:true,detached:true,stdio:'ignore'});
  await new Promise((ok,fail)=>{watchdog.once('spawn',ok);watchdog.once('error',fail);});watchdog.unref();
  report.start=await logman(['create','trace',session,'-pf',join(directory,'providers.txt'),'-o',tracePath,'-f','bincirc','-max','16','-bs','64','-nb','4','16','-ets']);
  if(report.start.code!==0)throw Error('Could not start our uniquely named ETW session.');owned=true;receipt.started=true;receipt.startedAt=Date.now();await save();
  report.active=await logman(['query',session,'-ets']);if(report.active.code!==0)throw Error('Started session is not queryable.');
  report.nodeProbes=[await tcpProbe(report.controlPort),await tcpProbe(port)];
  const dotnet=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`
$results=@(foreach($portNumber in @(${report.controlPort},${port})){
 $client=[Net.Sockets.TcpClient]::new();$watch=[Diagnostics.Stopwatch]::StartNew();$status='UNKNOWN'
 try{$task=$client.ConnectAsync('127.0.0.1',$portNumber);if($task.Wait(1800)){$status='CONNECTED'}else{$status='TIMEOUT'}}catch{$base=$_.Exception.GetBaseException();$status=if($base -is [Net.Sockets.SocketException]){[string]$base.SocketErrorCode}else{$base.GetType().Name}}finally{$client.Dispose();$watch.Stop()}
 [pscustomobject]@{targetPort=$portNumber;status=$status;elapsedMs=$watch.ElapsedMilliseconds;pid=$PID}
})
$results|ConvertTo-Json -Compress
`],{windowsHide:true,timeout:7000,maxBuffer:8192});
  report.dotnetProbes=JSON.parse(dotnet.stdout.replace(/^\uFEFF/,''));await sleep(350);report.completed=true;
}catch(error){report.error=String(error.message??error).slice(0,1000);}
finally{
  for(const socket of sockets)socket.destroy();if(server?.listening)await new Promise(ok=>server.close(ok));
  if(owned){report.stop=await logman(['stop',session,'-ets']);report.after=await logman(['query',session,'-ets']);report.captureStopped=report.stop.code===0&&report.after.code!==0;}
  receipt.finished=!owned||report.captureStopped===true;await save();
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(root,'.research','socket-trace-latest.json'),JSON.stringify({directory,completed:report.completed,captureStopped:report.captureStopped??null,error:report.error??null},null,2)+'\n');
}
console.log(JSON.stringify({directory,completed:report.completed,captureStopped:report.captureStopped,error:report.error}));
if(!report.completed||!report.captureStopped)process.exitCode=1;
