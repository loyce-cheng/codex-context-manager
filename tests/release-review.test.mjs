import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {adapterCompatibilityIssue} from '../scripts/diagnose-adapter.mjs';
import {acquireBridgeLease, prepareCodexHome, launchExitCode} from '../experiments/desktop-context-window/bridge-lifecycle.mjs';
import {startMonitorAfterUpdate} from '../experiments/desktop-context-window/update-fallback.mjs';
import {loaderRestartRequired} from '../scripts/sidebar-loader-client.mjs';

test('stable and beta diagnostics distinguish runtime mismatch, bundled and locally verified profiles', () => {
  const appVersion = '26.1.2.3', profiles = [{appVersion}];
  const result = (version, renderer, bundled, list = profiles) =>
    adapterCompatibilityIssue({extension:{version}, processes:profiles, renderer}, bundled, list);
  for (const version of ['0.1.0-beta.6','0.1.0','0.1.1','1.0.0']) {
    assert.equal(result(version,{version,status:'unsupported'},version),'INSTALLED_ADAPTER_DOES_NOT_MATCH_APP');
    assert.equal(result(version,null,version),null);
    assert.equal(result(version,{version,diagnostics:{profile:appVersion}},null,[]),null);
    assert.equal(result(version,{version:'old',diagnostics:{profile:appVersion}},null,[]),'INSTALLED_ADAPTER_COMPATIBILITY_UNVERIFIED');
  }
  for (const version of ['0.1.0-alpha.2','0.0.9','bad',null]) assert.equal(result(version,null,null,[]),null);
});

test('first experimental launch creates the profile; existing profiles and recovery status are preserved',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lens-first-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,'new','.codex');
  const actual=await prepareCodexHome(path);
  assert.equal(actual,await realpath(path));
  assert.equal(await prepareCodexHome(path),actual);
  assert.equal(launchExitCode(loaderRestartRequired('recovery')),4);
  assert.equal(launchExitCode(Error('other')),1);
});

const [major,minor]=process.versions.node.split('.').map(Number);
test('per-user bridge leases survive duplicate launches and release after abrupt holder exit',
  {skip: major===22 && minor<13 ? 'experimental desktop uses the bundled Node runtime' : false,timeout:15000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'lens-lease-'));
  const moduleUrl=new URL('../experiments/desktop-context-window/bridge-lifecycle.mjs',import.meta.url).href;
  const script="import {acquireBridgeLease} from "+JSON.stringify(moduleUrl)+";"+
    "const held=await acquireBridgeLease(process.argv[1],123,'456'); process.send(Boolean(held)); setInterval(()=>{},1000);";
  const child=spawn(process.execPath,['--input-type=module','-e',script,root],{stdio:['ignore','ignore','inherit','ipc'],windowsHide:true});
  const ended=once(child,'exit');
  t.after(async()=>{
    if(child.exitCode===null && child.signalCode===null) child.kill();
    try { await ended; } finally { await rm(root,{recursive:true,force:true}); }
  });
  const ready=await Promise.race([once(child,'message'),ended.then(()=>{throw Error('lease holder exited before readiness');})]);
  assert.equal(ready[0],true);
  assert.equal(await acquireBridgeLease(root,123,'456'),null);
  for (const args of [[join(root,'other-profile'),123,'456'],[root,123,'457']]) {
    const other=await acquireBridgeLease(...args);
    assert.ok(other);
    other.close();
  }
  child.kill();await ended;
  const next=await acquireBridgeLease(root,123,'456');
  assert.ok(next);
  next.close();
});

test('fallback drops mixed-case experiment overrides and keeps independent CLI settings',async()=>{
  for (const [cli,keep] of [['Experiment.EXE',false],['custom.exe',true]]) {
    const env={Codex_Cli_Path:cli,context_lens_desktop_tiers:'1',Lens_Expected_Desktop:'old',CODEX_HOME:'home'};
    await startMonitorAfterUpdate({version:'new',reason:'Codex',env,experimentalBinary:'experiment.exe',
      start:async next=>{
        assert.deepEqual(next,keep?{Codex_Cli_Path:cli,CODEX_HOME:'home'}:{CODEX_HOME:'home'});
        return {loaded:true,stage:'following',ready:true};
      },save:async()=>{}});
    assert.equal(env.context_lens_desktop_tiers,'1');
  }
});
