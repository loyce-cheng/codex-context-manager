// Quiet native launcher backend. Does not terminate apps or change system settings.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile, realpath, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loaderClient,loaderInstallDirectory } from './sidebar-loader-client.mjs';
import { ensureSidebar } from './ensure-sidebar.mjs';
import { PROFILES } from '../native-sidebar/src/telemetry.mjs';
import { profileForUpgrade } from './verify-native-profile.mjs';
import { launchSidebar } from './launcher-core.mjs';
import { syncSidebar } from './sync-sidebar.mjs';
const run=promisify(execFile), root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const checkOnly=process.argv.includes('--check');
const experimental=process.argv.includes('--desktop-tiers');
const startedAt=new Date().toISOString();
const labels={checking:'正在连接 Context Lens…','loading-page':'Codex 页面正在加载…','loading-plugin':'正在等待插件载入…','host-busy':'Loader 正在完成已有请求，请稍候…','recovering-plugin':'正在恢复插件实例…',following:'已读取当前对话容量。','waiting-for-chat':'请选择一条本地对话。','waiting-for-usage':'等待当前对话的用量快照。','space-unavailable':'已读取容量，左栏空间不足。',unsupported:'当前页面版本尚未适配。'};
async function readInventory(){
  const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$package=Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
if(-not $package){throw 'Codex Store package is not installed.'}
$apps=@(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe' OR Name = 'Codex.exe'" | Where-Object { ($_.ExecutablePath -match '\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\(?:ChatGPT|Codex)\.exe$') -or -not $_.ExecutablePath })
[pscustomobject]@{appVersion=[string]$package.Version;family=$package.PackageFamilyName;location=$package.InstallLocation;codexRunning=($apps.Count -gt 0);loaderRunning=(@(Get-Process -Name CodexScriptLoader -ErrorAction SilentlyContinue).Count -gt 0)}|ConvertTo-Json -Compress
`],{windowsHide:true,timeout:15000,maxBuffer:8192});
  return JSON.parse(stdout.replace(/^\uFEFF/,''));
}
async function launchFor(localData,launcher,installed){
  const {family,location,...inventory}=installed;
  if(experimental){
    if(process.env.CONTEXT_LENS_DESKTOP_TIERS!=='1')throw Error('请使用实验扩容启动器。');
    if(process.env.LENS_EXPECTED_DESKTOP!==inventory.appVersion)throw Error('准备期间 Codex 版本已变化，请重新打开实验入口。');
    if(inventory.codexRunning||inventory.loaderRunning)throw Error('另一个桌面实例已启动，请重新打开实验入口。');
    const {verifyExperimentalLoader}=await import('../experiments/desktop-context-window/loader/release.mjs');
    launcher=await verifyExperimentalLoader(localData,inventory.appVersion);
  }
  const expected=JSON.parse(await readFile(join(root,'native-sidebar','manifest.json'),'utf8'));
  const knownVersions=PROFILES.map(p=>p.appVersion);
  let localProfile=null;
  if(!checkOnly && !knownVersions.includes(inventory.appVersion)){
    console.log('[progress] 正在检查新版 Codex 的页面接口…');
    const result=await profileForUpgrade(inventory.appVersion,{version:inventory.appVersion,family,location},
      {cachePath:join(root,'.research','launcher-profile.json'),persist:true});
    localProfile=result.profile;
    if(result.mode==='unsupported')console.log('[progress] 当前用量接口待适配，详情已写入 launcher-profile.json。');
    else knownVersions.push(localProfile.appVersion);
    if(result.mode==='usage-only')console.log('[notice] 当前版本已恢复容量读数，档位选择等待适配。');
  }
  const report=await launchSidebar(inventory,{
    checkOnly,expectedVersion:expected.version,knownVersions,
    prepare:()=>syncSidebar({root,localData,localProfile,loaderRunning:async()=>{
      const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; @(Get-Process -Name CodexScriptLoader -ErrorAction SilentlyContinue).Count"],{windowsHide:true,timeout:10000});
      const count=Number(stdout.trim());if(!Number.isInteger(count)||count<0)throw Error('Cannot verify Loader state.');return count>0;
    }}),
    // Wait for process creation only. execFile(timeout) could terminate Loader
    // if its launcher remains running, so it must not be used for app startup.
    startLoader:async()=>{
      const latest=await readInventory();
      if(latest.appVersion!==inventory.appVersion || latest.location!==location || latest.family!==family ||
        latest.codexRunning || latest.loaderRunning){
        throw Object.assign(Error('启动期间 Codex 的版本或运行状态已变化。'),{code:'DESKTOP_CHANGED',latest});
      }
      await new Promise((resolveStart,reject)=>{
        const child=spawn(launcher,[],{windowsHide:true,detached:true,stdio:'ignore'});
        child.once('error',reject);child.once('spawn',()=>{child.unref();resolveStart();});
      });
    },
    ensure:async expectedVersion=>ensureSidebar({...await loaderClient(localData),allowReload:!experimental,expectedVersion,onProgress:stage=>console.log('[progress] '+(labels[stage]??stage))}),
  });
  return {checkedAt:new Date().toISOString(),...report};
}
try {
  await mkdir(join(root,'.research'),{recursive:true});
  await writeFile(join(root,'.research','launcher-status.json'),JSON.stringify({startedAt,checkedAt:startedAt,checkOnly,stage:'starting',ready:false},null,2)+'\n');
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw Error('此启动器仅支持 Windows。');
  const localData=await realpath(process.env.LOCALAPPDATA);
  const launcher=join(await loaderInstallDirectory(localData),'CodexScriptLoader.exe');
  try{await access(launcher);}catch(error){
    if(error.code!=='ENOENT')throw error;
    throw Error('未找到可启动的 Loader，请用完整安装包修复。');
  }
  let report;
  try{report=await launchFor(localData,launcher,await readInventory());}
  catch(error){
    if(error.code!=='DESKTOP_CHANGED'||experimental)throw error;
    console.log('[progress] 已检测到桌面更新，正在按最新状态重新检查…');
    report=await launchFor(localData,launcher,error.latest);
  }
  await mkdir(join(root,'.research'),{recursive:true});
  await writeFile(join(root,'.research','launcher-status.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(report.warning&&!checkOnly){console.error(report.warning);process.exitCode=2;}
  else if(process.send){
    const {loaded,ready,stage,notice}=report;
    process.send({loaded,ready,stage,notice});
  }
}catch(error){
  // Replace stale success records after a failed attempt.
  await mkdir(join(root,'.research'),{recursive:true});
  await writeFile(join(root,'.research','launcher-status.json'),JSON.stringify({startedAt,checkedAt:new Date().toISOString(),checkOnly,ready:false,error:error.message},null,2)+'\n');
  console.error(error.message);process.exitCode=error.code==='LOADER_RESTART_REQUIRED'?4:1;
}
