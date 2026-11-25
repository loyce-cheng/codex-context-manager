import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSidebar, sidebarReadiness } from '../scripts/ensure-sidebar.mjs';
import {loaderReleaseDirectory,selectLoaderDirectory} from '../scripts/sidebar-loader-client.mjs';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('offline install can use its private Loader and keeps an existing shared install authoritative',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lens-loader-location-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const shared=join(root,'shared'),bundled=join(root,'bundled');
  assert.equal(await selectLoaderDirectory(shared,bundled),shared);
  await mkdir(bundled);
  assert.equal(await selectLoaderDirectory(shared,bundled),bundled);
  await writeFile(shared,'invalid install location');
  await assert.rejects(selectLoaderDirectory(shared,bundled),/不是目录/);
  await rm(shared);await mkdir(shared);
  assert.equal(await selectLoaderDirectory(shared,bundled),shared);
});
test('resolve compatible active Loader releases and reject an incompatible descriptor',()=>{
  const release={schemaVersion:1,launcherProtocol:1,handoffProtocol:1,rid:'win-x64',entryPoint:'CodexScriptLoader.exe'};
  for(const version of ['0.6.1','0.6.2','0.6.3']){
    assert.equal(loaderReleaseDirectory('base',{...release,version}),join('base','Programs','CodexScriptLoader','versions',version,'win-x64'));
  }
  for(const override of [{version:'../unexpected'},{version:'0.6.2',launcherProtocol:2},{version:'0.6.2',rid:'other'},{version:'0.6.2',entryPoint:'other.exe'}]){
    assert.throws(()=>loaderReleaseDirectory('base',{...release,...override}));
  }
});
const version = '0.1.0-alpha.4';
const ready = { ok: true, result: { version, startup: 'started', status: 'following', layoutOK: true,
  threadId:'11111111-1111-4111-8111-111111111111',capacity:258400,percent:47,
  diagnostics:{selection:'ready',host:'local',visibleComposerCount:1} } };
const fail = code => ({ ok: false, error: { code } });
function options(sequence) {
  let reads = 0, reloads = 0, time=0;
  return { expectedVersion: version, maxAttempts: 25, now:()=>time, wait: async ms => {time+=ms;},
    inspect: async () => sequence[Math.min(reads++, sequence.length-1)], reload: async () => { reloads++; },
    counts: () => ({ reads, reloads }) };
}
test('startup navigation loss resets stability and triggers one public reload', async () => {
  const opts=options([fail('COMMAND_UNAVAILABLE'),ready,fail('PLUGIN_COMMAND_FAILED'),ready,ready,ready]);
  assert.equal((await ensureSidebar(opts)).reloaded,true);
  assert.deepEqual(opts.counts(),{reads:6,reloads:1});
});

test('startup on an empty transitional document is not a successful sidebar launch',async()=>{
  const empty={ok:true,result:{...ready.result,status:'unavailable',layoutOK:false,threadId:null,capacity:null,percent:null,
    diagnostics:{selection:'unavailable',host:null,visibleComposerCount:0}}};
  assert.equal(sidebarReadiness(empty.result),null);
  await assert.rejects(ensureSidebar(options([empty])),/PAGE_NOT_READY/);
  const o=options([empty,empty,ready]);const result=await ensureSidebar(o);
  assert.equal(result.ready,true);assert.equal(result.stage,'following');assert.equal(o.counts().reads,5);
});

test('an empty chat or missing first snapshot is loaded but not a successful capacity reading',async()=>{
  for(const [status,selection,host,stage] of [['unavailable','unavailable',null,'waiting-for-chat'],['waiting','ready','local','waiting-for-usage']]) {
    const r={ok:true,result:{...ready.result,status,threadId:null,capacity:null,percent:null,diagnostics:{selection,host,visibleComposerCount:1}}};
    const result=await ensureSidebar(options([r]));assert.equal(result.loaded,true);assert.equal(result.ready,false);assert.equal(result.stage,stage);
  }
});
test('time spent starting Loader does not consume the wait for a restoring chat',async()=>{
  const waiting={ok:true,result:{...ready.result,status:'unavailable',threadId:null,capacity:null,percent:null,
    diagnostics:{selection:'unavailable',visibleComposerCount:1}}};
  const o=options([fail('COMMAND_BUSY'),fail('COMMAND_BUSY'),waiting,waiting,waiting,waiting,ready]);
  assert.equal((await ensureSidebar(o)).stage,'following');
});

test('busy host backs off without reloading another plugin command; invalid numbers never pass',async()=>{
  const o=options([fail('COMMAND_BUSY'),fail('COMMAND_BUSY'),ready]);
  assert.equal((await ensureSidebar(o)).ready,true);assert.equal(o.counts().reloads,0);
  for(const override of [{percent:NaN},{capacity:null},{threadId:'not-a-thread'}])assert.equal(sidebarReadiness({...ready.result,...override}),null);
});
test('healthy startup needs three confirmations and never reloads', async () => {
  const opts=options([ready]); assert.equal((await ensureSidebar(opts)).reloaded,false);
  assert.deepEqual(opts.counts(),{reads:3,reloads:0});
});
test('unready Loader is not reloaded; repeated page failure has bounded recovery', async () => {
  for(const code of ['COMMAND_UNAVAILABLE','PLUGIN_COMMAND_FAILED']) {
    const opts=options([fail(code)]); await assert.rejects(ensureSidebar(opts),/not confirmed/);
    assert.equal(opts.counts().reloads, code==='PLUGIN_COMMAND_FAILED'?1:0);
  }
});
test('version mismatch and failed plugin startup stop with an actionable error', async () => {
  await assert.rejects(ensureSidebar(options([{ok:true,result:{...ready.result,version:'older'}}])),/version differs/);
  await assert.rejects(ensureSidebar(options([{ok:true,result:{...ready.result,startup:'failed'}}])),/startup failed/);
});

test('a dedicated experimental host never starts the installed bootstrap for a reload',async()=>{
  const opts=options([fail('PLUGIN_COMMAND_FAILED')]);
  await assert.rejects(ensureSidebar({...opts,allowReload:false}),/not confirmed/);
  assert.equal(opts.counts().reloads,0);
});
