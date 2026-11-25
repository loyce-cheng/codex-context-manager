// Read-only inspection of a specific installed ASAR; never executes App code.
import { open, mkdir, writeFile,readFile,rename,rm } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {win32,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { PROFILE, RSPACK_PROFILE, RSPACK_9664_PROFILE, PROFILES } from '../native-sidebar/src/telemetry.mjs';
import {inspectGetterBindings} from './rspack-usage.mjs';

const resumedUsage=/\btokenUsageInfo:([A-Za-z_$][\w$]*)=>\1\?\.resumeState==="resumed"\?\1\.latestTokenUsageInfo:null\b/;
const modelSettings=/\bmodelSettings:([A-Za-z_$][\w$]*)=>null==\1\?null:\{model:\1\.latestModel,reasoningEffort:\1\.latestReasoningEffort\}/;

export function registeredAsar(version, pkg) {
  if(pkg?.family!=='OpenAI.Codex_2p2nqsd0c76g0' || pkg.version!==version ||
      typeof pkg.location!=='string' || !/^[A-Za-z]:[\\/]/.test(pkg.location))
    throw Error('无法确认与目标版本匹配的 Codex 安装目录。');
  return win32.join(pkg.location,'app','resources','app.asar');
}

export async function registeredCodexPackage(){
  const command=`$ErrorActionPreference='Stop'
    [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
    $p=Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
    [pscustomobject]@{version=[string]$p.Version;family=$p.PackageFamilyName;location=$p.InstallLocation}|ConvertTo-Json -Compress`;
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],
    {windowsHide:true,timeout:15000});
  return JSON.parse(stdout.replace(/^\uFEFF/,''));
}

export function checkedProfile(profile, checks, allowUsageOnly=false){
  let usageOnly=false;
  for(const [name,valid] of Object.entries(checks)){
    if(valid===true)continue;
    const optional=name.startsWith('preflight_') || name==='preflightSelectorReturnsNullWithoutState' || name==='nativeModelMeaning';
    if(!optional || !allowUsageOnly)throw Error('未通过资源检查：'+name);
    usageOnly=true;
  }
  return usageOnly?{...profile,preflightExports:null}:profile;
}

export async function inspectProfile(version, {discover = false, asar, allowUsageOnly=false,assetHints} = {}) {
assert.match(version,/^\d+\.\d+\.\d+\.\d+$/);
let profile=discover?null:PROFILES.find(p=>p.appVersion===version);
if(assetHints){
  const names=cachedAssetNames(version,{mode:'verified',profile:{...assetHints,appVersion:version}});
  if(!names)throw Error('Invalid cached resource names.');
  profile={...RSPACK_9664_PROFILE,appVersion:version,...names};
}
const path=asar??registeredAsar(version,await registeredCodexPackage());
const file=await open(path,'r');
try {
  const size=Buffer.alloc(8);await file.read(size,0,8,0);
  const length=size.readUInt32LE(4);assert.ok(length>=8 && length<=32*1024*1024);
  const header=Buffer.alloc(length);assert.equal((await file.read(header,0,length,8)).bytesRead,length);
  const tree=JSON.parse(header.subarray(8,8+header.readUInt32LE(4)).toString());
  async function asset(name) {
    const entry=name.split('/').reduce((node,part)=>node.files[part],tree);
    assert.ok(entry&&!entry.unpacked&&entry.size<18000000);
    const data=Buffer.alloc(entry.size);assert.equal((await file.read(data,0,data.length,8+length+Number(entry.offset))).bytesRead,data.length);
    return {text:data.toString(),name,sha256:createHash('sha256').update(data).digest('hex')};
  }
  if(!profile) {
    const assets=tree.files.webview.files.assets.files;
    const root=Object.keys(assets), chunks=Object.keys(assets.async.files)
      .filter(name=>/^\d+\.[0-9a-f]{10}\.js$/.test(name));
    function only(matches) {
      assert.equal(matches.length,1,'no unique matching desktop asset');
      return matches[0];
    }
    const runtime=only(root.filter(name=>/^348410\.[0-9a-f]{10}\.js$/.test(name)));
    const states=[],composers=[],rails=[];
    for(const name of chunks) {
      const item=await asset('webview/assets/async/'+name);
      if(resumedUsage.test(item.text) &&
        (item.text.includes('tl5a(e,t,n){') || item.text.includes('tl5a:(function(')))states.push(name);
      if(item.text.includes('?.modelContextWindow??null') && item.text.includes('?.last.totalTokens??null') &&
        item.text.includes('("tl5a")'))composers.push(name);
      if(item.text.includes('"data-app-navigation-rail"')) rails.push(name);
    }
    profile={...RSPACK_9664_PROFILE, appVersion:version, asset:runtime,
      stateAsset:'async/'+only(states), composerAsset:'async/'+only(composers), primaryAsset:'async/'+only(rails)};
  }
  const rspack=profile.kind==='rspack';
  const initial=await asset(`webview/assets/${profile.asset}`);
  const state=rspack?await asset(`webview/assets/${profile.stateAsset}`):initial;
  const primary=await asset(rspack?`webview/assets/${profile.primaryAsset}`:'webview/assets/app-primary-8eba40dc50b2.js');
  const composer=await asset(rspack?`webview/assets/${profile.composerAsset}`:'webview/assets/composer-content-a151cc8dbbb3.js');
  const latest=Boolean(profile.preflightExports);
  const getters=latest && state.text.includes('tl5a:(function(');
  const moduleStart='tl5a(e,t,n){';
  const usage=latest?'ez=(0,I.tv)("tokenUsageInfo"),eX=(0,a.i1)(q.u,(e,{get:t})=>null==e?null:t(ez,{hostId:t(T.qX,e),threadId:e}))':'eV=(0,I.t)("tokenUsageInfo"),ez=(0,a.i1)(B.u,(e,{get:t})=>null==e?null:t(eV,{hostId:t(C.qX,e),threadId:e}))';
  const usageExport=latest?'k2:eX':'k2:ez';
  const hostExport=latest?'qX:()=>T.qX':'qX:()=>C.qX';
  const hostImport=latest?'T=n("Bl6U")':'C=n("Bl6U")';
  const semantic=getters?inspectGetterBindings(state.text,composer.text,profile):null;
  if(semantic && semantic.checks.tokenUsageExport && semantic.checks.hostExport){
    if(!discover && !assetHints)assert.ok(semantic.usageExport===profile.usageExport && semantic.hostExport===profile.hostExport,'bundled page exports changed');
    profile={...profile,usageExport:semantic.usageExport,hostExport:semantic.hostExport};
  }
  const checks=rspack?{
    initializedRuntimeCache:initial.text.includes(getters?'p.m=l,p.c=u':'p.m=u,p.c=l')&&initial.text.includes(latest?'var h=p':'var v=p')&&initial.text.includes(latest?'export{h as __webpack_require__}':'export{v as __webpack_require__}'),
    ...(getters?semantic.checks:{
    stateModule:state.text.includes(moduleStart),
    tokenUsageExport:state.text.includes(usageExport),
    tokenUsageAtom:state.text.includes(usage),
    hostExport:state.text.includes(hostExport)&&state.text.includes(hostImport)&&state.text.includes('n.d(t,{},{lG:l,qX:d,sb:u})'),
    nativeFormula:composer.text.includes('let t=e?.modelContextWindow??null,n=e?.last.totalTokens??null'),
    nativeUsageConsumer:composer.text.includes('S=n("tl5a")')&&composer.text.includes('S.k2'),
    }),
    resumedUsageOnly:resumedUsage.test(state.text),
    composerIdentity:state.text.includes('clientThreadId:r,conversationId:e,kind:"local",placement:t,routeConversationId:n'),
    navigationRail:primary.text.includes('"data-app-navigation-rail"'),
  }:{
    tokenUsageExport:initial.text.includes('VZn as awn'),
    hostExport:initial.text.includes('Kw as VJn'),
    resumedUsageOnly:initial.text.includes('tokenUsageInfo:e=>e?.resumeState===`resumed`?e.latestTokenUsageInfo:null'),
    tokenUsageAtom:initial.text.includes('BZn=Lw(`tokenUsageInfo`),VZn=U(Q,(e,{get:t})=>e==null?null:t(BZn,{hostId:t(Kw,e),threadId:e}))'),
    composerIdentity:initial.text.includes('function GS(e){return e.value.kind===`local`?e.value.conversationId:null}'),
    nativeFormula:composer.text.includes('let t=e?.modelContextWindow??null,n=e?.last.totalTokens??null'),
    navigationRail:primary.text.includes('"data-app-navigation-rail"'),
  };
  if(latest && !getters) {
    const start=state.text.indexOf(moduleStart),end=state.text.indexOf('},s0j4(e,t,n){',start),module=state.text.slice(start,end);
    assert.ok(start>=0 && end>start,'unverified usage module boundary');
    for(const field of [usageExport,hostExport,hostImport,usage])
      assert.ok(module.includes(field),'usage binding moved or changed');
    const definitions={
      model:['Zs:eK','eK=(0,a.i1)(q.u,(e,{get:t})=>t(e$,e)?.model??null)','tg=(0,I.tv)("modelSettings")'],
      responseInProgress:['uF:ex','ex=n_(({isResponseInProgress:e})=>e)'],
      requestCount:['LO:eZ','eZ=n_(({requests:e})=>e.length)'],
      pendingRequestKind:['Zv:e0','let n=t(eJ,e)','eJ=n_(({pendingRequest:e})=>e?.kind??null)'],
      resumeState:['nX:e2','e2=n_(({resumeState:e})=>e)'],
      ephemeral:['v7:eL','eL=n_(({ephemeral:e})=>!0===e)'],
      runtimeStatus:['F9:tS','tS=n_(({summary:e})=>e.threadRuntimeStatus??null)'],
      latestTurnStatus:['VY:tD','tD=n_(({latestTurnStatus:e})=>e)'],
    };
    for(const [field,needles] of Object.entries(definitions)) checks[`preflight_${field}`]=needles.every(needle=>module.includes(needle));
    checks.preflightSelectorReturnsNullWithoutState=module.includes('return null==o?null:t(o)');
  }
  if(latest)checks.nativeModelMeaning=modelSettings.test(state.text);
  profile=checkedProfile(profile,checks,allowUsageOnly);
  const evidence={kind:'read-only-installed-asset-inspection',nativeCodexAcceptance:false,profile,checks,assets:[...new Set([initial,state,primary,composer])].map(({name,sha256})=>({name,sha256}))};
  return evidence;
}finally{await file.close();}
}

export function cachedAssetNames(version,prior){
  const p=prior?.profile;
  if(!p||p.appVersion!==version||!['verified','usage-only'].includes(prior.mode)||
    typeof p.asset!=='string'||!/^348410\.[0-9a-f]{10}\.js$/.test(p.asset))return null;
  const names={asset:p.asset};
  for(const key of ['stateAsset','composerAsset','primaryAsset']){
    if(typeof p[key]!=='string'||!/^async\/\d+\.[0-9a-f]{10}\.js$/.test(p[key]))return null;
    names[key]=p[key];
  }
  return names;
}

export async function profileForUpgrade(version,pkg,{cachePath,persist=false}={}){
  const asar=registeredAsar(version,pkg);
  if(PROFILES.some(profile=>profile.appVersion===version))return {profile:null,mode:'bundled'};
  let hints=null,result;
  if(cachePath){
    try{hints=cachedAssetNames(version,JSON.parse(await readFile(cachePath,'utf8')));}catch{ /* First start or incomplete cache. */ }
  }
  try{
    let evidence;
    if(hints){
      try{evidence=await inspectProfile(version,{asar,assetHints:hints,allowUsageOnly:true});}
      catch{ /* Names are hints only. Rediscover from this installation. */ }
    }
    const cached=!!evidence;
    evidence??=await inspectProfile(version,{discover:true,asar,allowUsageOnly:true});
    result={profile:evidence.profile,mode:evidence.profile.preflightExports?'verified':'usage-only',cached,evidence};
  }catch(error){
    result={profile:{appVersion:version,unsupported:true},mode:'unsupported',reason:error.message};
  }
  if(cachePath && persist){
    await mkdir(dirname(cachePath),{recursive:true});
    const temporary=cachePath+'.'+randomUUID()+'.tmp';
    try{await writeFile(temporary,JSON.stringify(result,null,2)+'\n',{flag:'wx'});await rename(temporary,cachePath);}
    finally{await rm(temporary,{force:true});}
  }
  return result;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const version=process.argv.find(arg=>arg.startsWith('--version='))?.slice('--version='.length);
  const rspack=process.argv.includes('--rspack');
  const evidence=await inspectProfile(version??(rspack?RSPACK_PROFILE:PROFILE).appVersion,
    {discover:process.argv.includes('--discover'),asar:process.env.CONTEXT_LENS_APP_ASAR});
  const suffix=version?`-${version}`:rspack?'-rspack':'';
  await mkdir('docs/evidence',{recursive:true});await writeFile(`docs/evidence/native-sidebar-profile${suffix}.json`,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence,null,2));
}
