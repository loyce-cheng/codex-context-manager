// Verify the installed stock app-server using disposable local conversations.
// A passing result describes the backend only. It grants no desktop write capability.
import {execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {registeredAsar,registeredCodexPackage} from './verify-native-profile.mjs';

const run=promisify(execFile);
const suiteVersion=1;
const retryAfterMs=24*60*60*1000;
const probe=fileURLToPath(new URL('./probe-capacity-protocol.mjs',import.meta.url));
const expectedMeasurements=Object.freeze({selectedWindow:486400,otherWindow:258400,coldWindow:729600,restoredDefault:258400,
  compactionAt512k:true,compactionAt768k:false});

async function installedBackend(pkg){
  pkg??=await registeredCodexPackage();
  if(!/^\d+\.\d+\.\d+\.\d+$/.test(pkg.version))throw Error('无法核对已安装的 Codex 版本。');
  const binary=join(dirname(registeredAsar(pkg.version,pkg)),'codex.exe');
  const hash=createHash('sha256');
  for await(const bytes of createReadStream(binary))hash.update(bytes);
  return {desktop:pkg.version,binary,sha256:hash.digest('hex')};
}

async function runFixture(binary){
  const base=resolve(tmpdir());
  const scratch=await mkdtemp(join(base,'context-lens-resume-'));
  try{
    await run(process.execPath,[probe,binary,'--complete','--local-turn','--natural-resume','--explicit-expansion','--cold-resume'],
      {cwd:scratch,windowsHide:true,timeout:120000,maxBuffer:256*1024});
    const data=JSON.parse(await readFile(join(scratch,'.research','capacity-probe-latest.json'),'utf8'));
    return data.report;
  }finally{
    if(dirname(scratch)===base)await rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
}

export function verifiedResumeMeasurements(report){
  const turns=report?.measuredTurns??[];
  const at=(label,window)=>turns.filter(turn=>turn.label===label).length===1 &&
    turns.some(turn=>turn.label===label && turn.window===window);
  const compact=report?.resumedCompaction;
  if(report?.error || report?.isolatedHome!==true || report.desktopThreadsTouched!==false ||
      report.externalModelRequestsSent!==0 || !Number.isSafeInteger(report.fixtureRequestCount) ||
      report.fixtureRequestCount<turns.length || report.checks?.globalContextConfig!==null ||
      report.checks?.resumeUnloadedWithConfig?.sameThread!==true || report.perThreadIsolationVerified!==true ||
      !at('A-natural',258400) || !at('A-512k',486400) || !at('B-after-512k',258400) ||
      !at('A-cold',729600) || !at('B-cold',258400) || !at('A-default',258400) ||
      report.coldResume?.restoredDefault!==258400 || report.coldResume.globalWindow!==null ||
      report.compactionEffectVerified!==true || compact?.length!==2 ||
      !compact.some(s=>s.tier===512000 && s.window===486400 && s.compacted===true) ||
      !compact.some(s=>s.tier===768000 && s.window===729600 && s.compacted===false))
    throw Object.assign(Error('本机模拟回合、会话隔离或自动压缩检查未通过。'),{code:'MEASUREMENT_MISMATCH'});
  return {...expectedMeasurements};
}

const defaultCachePath=()=>join(process.env.LOCALAPPDATA,'ContextLens','stock-resume-check.json');

export async function readStockResumeResult({cachePath=defaultCachePath(),identify=installedBackend,expectedDesktop}={}){
  let cached;
  try{cached=JSON.parse(await readFile(cachePath,'utf8'));}catch{return null;}
  if(!cached || cached.suite!==suiteVersion || cached.desktopIntegrated!==false ||
      (expectedDesktop && cached.desktop!==expectedDesktop))return null;
  const age=Date.now()-Date.parse(cached.checkedAt);
  if(!Number.isFinite(age)||age<0)return null;
  const passed=cached.outcome==='verified' && Object.entries(expectedMeasurements)
    .every(([field,value])=>cached.measurements?.[field]===value);
  if(!passed && !(cached.outcome==='inconclusive' && age<retryAfterMs))return null;
  const current=await identify();
  return cached.desktop===current.desktop && cached.sha256===current.sha256 ? {...cached,cached:true} : null;
}

export async function verifyStockResume({
  force=false,cachePath=defaultCachePath(),expectedDesktop,identify=installedBackend,probeBackend=runFixture,onProbe=()=>{}
}={}){
  const before=await identify();
  if(expectedDesktop && before.desktop!==expectedDesktop)throw Error('检查期间桌面版本已变化。');
  const key={suite:suiteVersion,desktop:before.desktop,sha256:before.sha256};
  if(!force){
    const cached=await readStockResumeResult({cachePath,expectedDesktop,identify:()=>before});
    if(cached)return cached;
  }
  onProbe();
  let measurements=null,reason=null;
  try{measurements=verifiedResumeMeasurements(await probeBackend(before.binary));}
  catch(error){
    reason=error.code==='MEASUREMENT_MISMATCH'?'measurements-mismatched':error.killed?'probe-timed-out':'fixture-failed';
  }
  const after=await identify();
  if(before.desktop!==after.desktop || before.sha256!==after.sha256 || before.binary!==after.binary)
    throw Error('检查期间官方后台已变化，本次结果已作废。');
  const result={...key,outcome:measurements?'verified':'inconclusive',checkedAt:new Date().toISOString(),
    desktopIntegrated:false,reason,measurements};
  await mkdir(dirname(cachePath),{recursive:true});
  const temporary=cachePath+'.'+randomUUID()+'.tmp';
  try{
    await writeFile(temporary,JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
    await rename(temporary,cachePath);
  }finally{await rm(temporary,{force:true});}
  return {...result,cached:false};
}

export function describeStockResume(result){
  return result.outcome==='verified'
    ? '官方后台已通过单对话恢复与压缩测试；当前左栏仍只保存预设，等待桌面接入。'
    : '官方后台的本地隔离测试未能确认兼容性，当前继续使用监控。';
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.argv.slice(2).some(a=>a!=='--force'))throw Error('Use --force to repeat the stock backend test.');
    const result=await verifyStockResume({force:process.argv.includes('--force')});
    console.log(JSON.stringify({...result,description:describeStockResume(result)},null,2));
    if(result.outcome!=='verified')process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
