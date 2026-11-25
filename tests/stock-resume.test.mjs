import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifiedResumeMeasurements,verifyStockResume} from '../scripts/verify-stock-resume.mjs';
import {startMonitorAfterUpdate} from '../experiments/desktop-context-window/update-fallback.mjs';
import {inspectUpgrade,describeUpgrade} from '../scripts/upgrade-status.mjs';

function report(){
  return {isolatedHome:true,desktopThreadsTouched:false,externalModelRequestsSent:0,fixtureRequestCount:16,
    checks:{globalContextConfig:null,resumeUnloadedWithConfig:{sameThread:true}},perThreadIsolationVerified:true,
    coldResume:{globalWindow:null,restoredDefault:258400},compactionEffectVerified:true,
    measuredTurns:Object.entries({'A-natural':258400,'A-512k':486400,'B-after-512k':258400,'A-cold':729600,'B-cold':258400,'A-default':258400})
      .map(([label,window])=>({label,window})),
    resumedCompaction:[{tier:512000,window:486400,compacted:true},{tier:768000,window:729600,compacted:false}]};
}
test('stock acceptance needs native turn readings, cold isolation and compaction at the selected tier',()=>{
  const input=report();
  assert.equal(verifiedResumeMeasurements(input).selectedWindow,486400);
  for(const change of [{measuredTurns:input.measuredTurns.slice(1)},{resumedCompaction:[]},
    {desktopThreadsTouched:true},{externalModelRequestsSent:1},{fixtureRequestCount:0},{coldResume:{globalWindow:512000}}]){
    assert.throws(()=>verifiedResumeMeasurements({...input,...change}),{code:'MEASUREMENT_MISMATCH'});
  }
});
test('cache is bound to the binary, desktop and suite; a changed installation cannot publish a stale pass',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lens-resume-cache-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const cachePath=join(dir,'cache.json');
  let backend={desktop:'1.2.3.4',binary:'fixture',sha256:'a'.repeat(64)},runs=0;
  const options={cachePath,identify:async()=>({...backend}),probeBackend:async()=>{runs++;return report();}};
  const first=await verifyStockResume(options);
  assert.equal(first.outcome,'verified');assert.equal(first.desktopIntegrated,false);
  assert.equal((await verifyStockResume(options)).cached,true);assert.equal(runs,1);
  const saved=JSON.parse(await readFile(cachePath,'utf8'));
  await writeFile(cachePath,JSON.stringify({...saved,measurements:null}));
  assert.equal((await verifyStockResume(options)).cached,false);
  backend.sha256='b'.repeat(64);
  assert.equal((await verifyStockResume(options)).cached,false);
  const fail={...options,force:true,probeBackend:async()=>({error:'fixture unavailable'})};
  assert.equal((await verifyStockResume(fail)).outcome,'inconclusive');
  assert.equal((await verifyStockResume(options)).outcome,'inconclusive');
  const old=await readFile(cachePath,'utf8');
  await assert.rejects(verifyStockResume({...options,force:true,probeBackend:async()=>{
    backend.desktop='2.0.0.0';return report();
  }}),/已变化/);
  assert.equal(await readFile(cachePath,'utf8'),old);
  assert.equal((await verifyStockResume(options)).outcome,'verified');
  assert.equal((await verifyStockResume({...options,force:true})).cached,false);
});
test('post-update probe runs only after monitoring is available and cannot turn on desktop writes',async()=>{
  const calls=[];
  const opts={version:'new',reason:'Codex',env:{},experimentalBinary:'old.exe',
    start:async()=>{calls.push('monitor');return {loaded:true,ready:true,stage:'following'};},
    save:async state=>{calls.push(state.stage);assert.equal(state.bridgeStarted,false);},
    checkStockResume:async()=>{calls.push('probe');throw Error('unavailable');}};
  assert.match(await startMonitorAfterUpdate(opts),/普通左栏.*未能完成/);
  assert.deepEqual(calls,['monitor','monitor-only','probe']);
  calls.length=0;
  await assert.rejects(startMonitorAfterUpdate({...opts,start:async()=>({loaded:false})}));
  assert.deepEqual(calls,[]);
});

test('status reports a cached backend pass without promoting an unknown desktop build',async()=>{
  const result=await inspectUpgrade({packageInfo:async()=>({version:'99.0.0.1'}),pageProfile:async()=>({mode:'verified'}),
    findLoader:async()=>join('versions','0.6.2','win-x64'),stockResult:async()=>({outcome:'verified'})});
  assert.equal(result.mode,'unverified-desktop');
  assert.match(describeUpgrade(result),/官方后台已通过.*仍只保存预设/);
});
