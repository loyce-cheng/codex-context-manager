import {spawn, execFile} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {acquireBridgeLease, prepareCodexHome, launchExitCode} from './bridge-lifecycle.mjs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {activeLoaderDirectory,loaderClient,loaderRestartRequired} from '../../scripts/sidebar-loader-client.mjs';
import {followDesktopChoices} from './desktop-tier-bridge.mjs';
import {experimentalLoaderFor, verifyExperimentalLoader,verifyExperimentalCli,cliVersion,expectedCliHash as expectedSha256} from './loader/release.mjs';
import {waitForDesktopExit} from './wait-for-exit.mjs';
import {startMonitorAfterUpdate} from './update-fallback.mjs';
import {ensureCodeModeHost} from './code-mode-host.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const binary=join(root,'dist','experimental-backend-'+cliVersion,'codex.exe');
const run=promisify(execFile);
const ps=async(command,env=process.env)=>JSON.parse((await run('powershell.exe',
  ['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,env,timeout:15000,maxBuffer:8192})).stdout.replace(/^\uFEFF/,''));

async function inventory(){
  return ps(`$ErrorActionPreference='Stop'
    $p=Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
    if(!$p){throw 'Codex package not found'}
    $desktop=Join-Path $p.InstallLocation 'app\\ChatGPT.exe'
    $running=@(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Where-Object { !$_.ExecutablePath -or $_.ExecutablePath -eq $desktop }).Count -gt 0
    [pscustomobject]@{version=[string]$p.Version;resources=(Join-Path $p.InstallLocation 'app\\resources');running=$running;loader=(@(Get-Process CodexScriptLoader -ErrorAction SilentlyContinue).Count -gt 0)}|ConvertTo-Json -Compress`);
}

async function owner(appVersion,{stock=false}={}){
  // A similarly named process or a separate test profile cannot arm this bridge.
  const experiment=experimentalLoaderFor(appVersion);
  if(!experiment)return null;
  const loaderPath=stock ? join(await activeLoaderDirectory(process.env.LOCALAPPDATA),'CodexScriptLoader.exe') : experiment;
  const result=await ps(`$ErrorActionPreference='Stop'
    $p=Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
    if([string]$p.Version -ne $env:LENS_EXPECTED_APP){'null';exit}
    $desktop=Join-Path $p.InstallLocation 'app\\ChatGPT.exe'
    $target=if($env:LENS_CHECK_STOCK -eq '1'){Join-Path $p.InstallLocation 'app\\resources\\codex.exe'}else{$env:LENS_EXPECTED_BIN}
    $loader=$env:LENS_EXPECTED_LOADER
    $fields='ProcessId','ParentProcessId','ExecutablePath','CommandLine','CreationDate'
    $candidates=Get-CimInstance Win32_Process -Filter "Name='codex.exe'" -Property $fields
    $match=@(foreach($child in $candidates){
      if($child.ExecutablePath -ne $target -or $child.CommandLine -notmatch '\\bapp-server\\b' -or $child.CommandLine -notmatch '--analytics-default-enabled'){continue}
      $ancestor=$child; $seenDesktop=$false
      for($i=0;$i -lt 7;$i++){
        $parentId=$ancestor.ParentProcessId; $childBorn=$ancestor.CreationDate
        $ancestor=Get-CimInstance Win32_Process -Filter ("ProcessId="+$parentId) -Property $fields
        if(!$ancestor -or $ancestor.CreationDate -gt $childBorn){break}
        if($ancestor.ExecutablePath -eq $desktop -and $ancestor.CommandLine -notmatch '--type='){$seenDesktop=$true}
        if($seenDesktop -and $ancestor.ExecutablePath -eq $loader){
          [pscustomobject]@{pid=$child.ProcessId;born=$child.CreationDate.ToUniversalTime().Ticks.ToString()};break
        }
      }
    })
    if($match.Count -eq 1){$match[0]|ConvertTo-Json -Compress}else{'null'}`,
  {...process.env,LENS_EXPECTED_APP:appVersion,LENS_EXPECTED_BIN:binary,LENS_EXPECTED_LOADER:loaderPath,LENS_CHECK_STOCK:stock?'1':'0'});
  return result;
}

async function startSidebar(env,experimental=false){
  return new Promise((done,fail)=>{
    const args=[join(root,'scripts','launch-sidebar.mjs')];
    if(experimental)args.push('--desktop-tiers');
    const child=spawn(process.execPath,args,{env,stdio:['ignore','inherit','pipe','ipc'],windowsHide:true});
    let detail='', result=null;
    child.once('message',message=>{result=message;});
    child.stderr.setEncoding('utf8');
    child.stderr.on('data',chunk=>{detail=(detail+chunk).slice(-3000);});
    child.once('error',fail);
    child.once('close',code=>{
      if(code===0){if(detail)process.stderr.write(detail);done(result);}
      else if(code===4)fail(loaderRestartRequired(detail.trim()));
      else fail(Error(detail.trim() || '左栏启动检查未通过，请查看启动器记录。'));
    });
  });
}

let installedVersion=null;
async function saveDiagnostic(name,data){
  const dir=join(root,'.research');
  await mkdir(dir,{recursive:true});
  await writeFile(join(dir,name),JSON.stringify(data)+'\n');
}
const saveStatus=data=>saveDiagnostic('experimental-launch.json',
  {appVersion:installedVersion,experimentalAppVersion:experimentalLoaderFor(installedVersion)?installedVersion:null,cliVersion,...data,at:new Date().toISOString()});

async function waitForManualExit(version,message){
  const cancel=new AbortController();
  const stop=()=>cancel.abort();
  process.stdin.once('end',stop);
  process.stdin.on('data',stop);
  process.stdin.resume();
  try{
    await saveStatus({stage:'waiting-for-exit',bridgeStarted:false});
    console.log('[progress] '+message+' 关闭此提示可取消（15 分钟内有效）。');
    await waitForDesktopExit({inventory,version,signal:cancel.signal});
    return true;
  }catch(error){
    if(!cancel.signal.aborted)throw error;
    await saveStatus({stage:'cancelled',bridgeStarted:false});
    return false;
  }finally{
    process.stdin.off('end',stop);process.stdin.off('data',stop);process.stdin.pause();
  }
}

let lastBridgeErrorAt=0;
async function recordBridgeError(code,fatal=false){
  const now=Date.now();
  if(!fatal && now-lastBridgeErrorAt<30000)return;
  lastBridgeErrorAt=now;
  const known=/^(?:E[A-Z0-9]{2,24}|COMMAND_[A-Z_]+|HOST_[A-Z_]+|PLUGIN_[A-Z_]+|RECEIPT_UNAVAILABLE|INSPECT_FAILED|Error|TypeError)$/;
  await saveDiagnostic('experimental-bridge-error.json',{
    at:new Date(now).toISOString(),fatal,code:known.test(code)?code:'BRIDGE_ERROR'
  }).catch(()=>{});
}

async function watch(){
  const pid=Number(process.env.LENS_OWNER_PID), born=process.env.LENS_OWNER_BORN;
  if(!Number.isSafeInteger(pid)||pid<1||!/^\d+$/.test(born??''))throw Error('缺少已验证的后台实例。');
  const controller=new AbortController();
  const stillOwned=async()=>{const current=await owner(process.env.LENS_EXPECTED_DESKTOP);return current?.pid===pid && current.born===born;};
  if(!await stillOwned())throw Error('桌面后台已切换。');
  const client=await loaderClient(process.env.LOCALAPPDATA);
  const lease=await acquireBridgeLease(process.env.LOCALAPPDATA,pid,born);
  if(!lease){process.send?.({inUse:true});process.disconnect?.();return;}
  if(process.send){process.send({ready:true});process.disconnect();}
  const timer=setInterval(()=>{try{process.kill(pid,0);}catch{controller.abort();}},2000);
  try{
    await followDesktopChoices({home:process.env.CODEX_HOME,inspect:client.inspect,acknowledge:client.acknowledge,confirmTurn:client.confirmTurn,signal:controller.signal,onError:recordBridgeError,
      beforeWrite:async()=>{if(await stillOwned())return true;controller.abort();return false;}});
  }finally{clearInterval(timer);lease.close();}
}

async function main(){
  if(process.argv.includes('--watch')){await watch();return;}
  const current=await inventory(), check=process.argv.includes('--check');
  const appVersion=current.version;
  installedVersion=appVersion;
  const interactive=process.argv.includes('--interactive-wait');
  async function monitorAfterUpdate(reason){
    if(check)throw Error(reason+'更新后的组合尚未验证实验扩容。');
    const notice=await startMonitorAfterUpdate({version:current.version,reason,env:process.env,
      experimentalBinary:binary,start:startSidebar,save:saveStatus,
      waitForExit:interactive ? ()=>waitForManualExit(current.version,'请保存并完全退出 Codex。若 Loader 仍在后台，请点击“恢复 Loader”。两者退出后将自动打开普通监控。') : null});
    if(notice)console.log('[notice] '+notice);
  }
  if(!experimentalLoaderFor(appVersion)){
    return monitorAfterUpdate('Codex');
  }
  try{await verifyExperimentalLoader(process.env.LOCALAPPDATA,current.version);}
  catch(error){
    if(error.code==='UNVERIFIED_VERSION')return monitorAfterUpdate('Loader');
    throw error;
  }
  await verifyExperimentalCli(binary);
  await ensureCodeModeHost(current.resources,dirname(binary),{checkOnly:check});
  let backend=await owner(appVersion);
  if(check){
    const stock=backend?null:await owner(appVersion,{stock:true});
    console.log(JSON.stringify({appVersion,cliVersion,loaderVersion:'0.6.2',sha256:expectedSha256,codeModeHostVerified:true,verified:true,attached:Boolean(backend),stockOwnedByLoader:backend ? false : stock ? true : null}));
    return;
  }
  for(const name of ['CODEX_APP_SERVER_DISABLE_MANAGED_CONFIG','CODEX_APP_SERVER_MANAGED_CONFIG_PATH','CODEX_CLI_PATH']){
    if(name==='CODEX_CLI_PATH' && backend && process.env.CONTEXT_LENS_DESKTOP_TIERS==='1' &&
        process.env[name] && resolve(process.env[name]).toLowerCase()===resolve(binary).toLowerCase())continue;
    if(process.env[name])throw Error('检测到现有的自定义后台环境 '+name+'，保留原设置并停止实验启动。');
  }
  const home=await prepareCodexHome(process.env.CODEX_HOME||join(homedir(),'.codex'));
  const env={...process.env,CODEX_HOME:home,CODEX_CLI_PATH:binary,CONTEXT_LENS_DESKTOP_TIERS:'1',LENS_EXPECTED_DESKTOP:appVersion};
  if(!backend){
    if(current.running||current.loader){
      if(!interactive)throw Error('请保存工作并完全退出 Codex 后，打开 Context-Lens-Experimental.exe。');
      if(!await waitForManualExit(appVersion,'请保存工作并完全退出 Codex，实验模式将自动打开。'))return;
    }
    console.log('[progress] 正在启动实验后台并连接左栏…');
    await startSidebar(env,true);
    for(let i=0;i<10;i++){
      backend=await owner(appVersion);
      if(backend)break;
      await delay(750);
    }
  }
  if(!backend)throw Error('左栏已启动，尚未确认这个窗口使用实验后台。档位写入未开启。');
  const bridge=spawn(process.execPath,[fileURLToPath(import.meta.url),'--watch'],{detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],
    env:{...env,LENS_OWNER_PID:String(backend.pid),LENS_OWNER_BORN:backend.born}});
  const bridgeStatus=await new Promise((done,fail)=>{
    const timeout=setTimeout(()=>{bridge.kill();fail(Error('档位桥接进程没有就绪。'));},20000);
    bridge.once('message',message=>{clearTimeout(timeout);message?.ready||message?.inUse?done(message):fail(Error('桥接握手失败。'));});
    bridge.once('error',error=>{clearTimeout(timeout);fail(error);});
    bridge.once('exit',()=>{clearTimeout(timeout);fail(Error('档位桥接进程已经退出。'));});
  });bridge.unref();
  if(bridgeStatus.inUse){console.log('[progress] 此后台已有档位桥接实例。');return;}
  await saveStatus({stage:'ready',backend:'experimental',bridgeStarted:true,
    backendPid:backend.pid,backendBorn:backend.born,bridgePid:bridge.pid});
  console.log('[progress] 实验后台已启动。请在左栏为当前对话选择档位。');
}
main().catch(async error=>{
  if(process.argv.includes('--watch'))await recordBridgeError(error.code??error.name,true);
  if(!process.argv.includes('--watch')&&!process.argv.includes('--check'))
    await saveStatus({stage:'error',error:error.message}).catch(()=>{});
  console.error(error.message);process.exitCode=launchExitCode(error);
});
