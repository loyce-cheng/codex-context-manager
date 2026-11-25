import test from 'node:test';
import assert from 'node:assert/strict';
import {launchSidebar} from '../scripts/launcher-core.mjs';
const current={appVersion:'known',codexRunning:true,loaderRunning:true};
function fixture(){
  const calls=[];return {calls,options:{expectedVersion:'alpha.4',knownVersions:['known'],
    startLoader:async()=>{calls.push('start');},
    ensure:async version=>{calls.push('ensure:'+version);return {ready:true,reloaded:false,inspection:{version,status:'following',layoutOK:true}};}}};
}
test('shortcut checks existing Loader without starting another app; plain Codex requires manual exit',async()=>{
  const f=fixture();assert.equal((await launchSidebar(current,f.options)).startedLoader,false);assert.deepEqual(f.calls,['ensure:alpha.4']);
  const g=fixture();await assert.rejects(launchSidebar({...current,loaderRunning:false},g.options),/手动完全退出/);assert.deepEqual(g.calls,[]);
});
test('cold-start policy starts Loader once and then checks plugin readiness',async()=>{
  const f=fixture();assert.equal((await launchSidebar({...current,codexRunning:false,loaderRunning:false},f.options)).startedLoader,true);
  assert.deepEqual(f.calls,['start','ensure:alpha.4']);
});
test('an orphan Loader or a plain Codex signals a cold start before preparing package files',async()=>{
  for(const codexRunning of [true,false]){
    const f=fixture();f.options.prepare=async()=>f.calls.push('prepare');
    await assert.rejects(launchSidebar({...current,codexRunning,loaderRunning:!codexRunning},f.options),
      {code:'LOADER_RESTART_REQUIRED'});
    assert.deepEqual(f.calls,[]);
  }
});
test('unknown app version stays unsupported; check-only mode has no launch or reload side effects',async()=>{
  const f=fixture();assert.equal((await launchSidebar({...current,appVersion:'new'},f.options)).compatibility,'requires-adapter-validation');
  const g=fixture();await launchSidebar({...current,loaderRunning:false},{...g.options,checkOnly:true});assert.deepEqual(g.calls,[]);
});
test('failed process creation does not continue into reload attempts',async()=>{
  const f=fixture();f.options.startLoader=async()=>{throw Error('launch denied');};
  await assert.rejects(launchSidebar({...current,codexRunning:false,loaderRunning:false},f.options),/launch denied/);assert.deepEqual(f.calls,[]);
});

test('loaded plugin without a current usage reading is reported as waiting, not ready',async()=>{
  const f=fixture();f.options.ensure=async()=>({ready:false,loaded:true,stage:'waiting-for-usage',reloaded:false,inspection:{version:'alpha.4',status:'waiting',layoutOK:true}});
  const report=await launchSidebar(current,f.options);
  assert.equal(report.ready,false);assert.equal(report.loaded,true);assert.match(report.notice,/等待/);
});
test('normal launch prepares bundled updates once before launch/readiness; check-only never prepares',async()=>{
  const f=fixture();f.options.prepare=async()=>{f.calls.push('prepare');return {version:'alpha.4',changed:false,loaded:false,configChanged:false};};
  const report=await launchSidebar({...current,codexRunning:false,loaderRunning:false},f.options);
  assert.deepEqual(f.calls,['prepare','start','ensure:alpha.4']);assert.equal(report.packageSync.configChanged,false);
  f.calls.length=0;await launchSidebar(current,{...f.options,checkOnly:true});assert.deepEqual(f.calls,[]);
});
