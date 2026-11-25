import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForDesktopExit} from '../experiments/desktop-context-window/wait-for-exit.mjs';
import {startMonitorAfterUpdate} from '../experiments/desktop-context-window/update-fallback.mjs';
import {registeredAsar} from '../scripts/verify-native-profile.mjs';
import {loaderRestartRequired} from '../scripts/sidebar-loader-client.mjs';
import {experimentalLoaderFor} from '../experiments/desktop-context-window/loader/release.mjs';
const following={stage:'following',loaded:true,ready:true};

test('each validated desktop selects its own Loader build and an unknown version has no experimental launcher',()=>{
  const previous=experimentalLoaderFor('26.1117.3838.0'),updated=experimentalLoaderFor('26.1117.4957.0');
  assert.match(previous,/experimental-loader-0\.6\.2[\\/]CodexScriptLoader\.exe$/);
  assert.match(updated,/experimental-loader-0\.6\.2-26\.1117\.4957\.0[\\/]CodexScriptLoader\.exe$/);
  assert.equal(experimentalLoaderFor('26.1117.4958.0'),null);
});

test('page compatibility checks use the registered installation on any drive and reject version or family drift',()=>{
  const pkg={version:'26.1.0.0',family:'OpenAI.Codex_2p2nqsd0c76g0',location:'D:\\WindowsApps\\Codex'};
  assert.equal(registeredAsar(pkg.version,pkg),'D:\\WindowsApps\\Codex\\app\\resources\\app.asar');
  assert.throws(()=>registeredAsar('26.2.0.0',pkg));
  assert.throws(()=>registeredAsar(pkg.version,{...pkg,family:'different'}));
  assert.throws(()=>registeredAsar(pkg.version,{...pkg,location:'relative'}));
});

test('updated desktop or Loader keeps monitoring without inheriting the experimental override',async()=>{
  for(const reason of ['Codex','Loader']){
    let saved;
    const env={CODEX_HOME:'profile',CODEX_CLI_PATH:'experimental.exe',CONTEXT_LENS_DESKTOP_TIERS:'1',LENS_EXPECTED_DESKTOP:'old'};
    const opts={version:'26.2.0.0',reason,env,experimentalBinary:'experimental.exe',
      start:async next=>{assert.deepEqual(next,{CODEX_HOME:'profile'});return following;},save:async data=>{saved=data;}};
    await startMonitorAfterUpdate(opts);
    assert.deepEqual(saved,{stage:'monitor-only',appVersion:opts.version,reason,bridgeStarted:false,monitorStage:'following',readingReady:true});
    assert.equal(env.CONTEXT_LENS_DESKTOP_TIERS,'1');
    saved=null;
    await assert.rejects(startMonitorAfterUpdate({...opts,start:async()=>{throw Error('readiness failed');}}),/readiness failed/);
    assert.equal(saved,null);
  }
});

test('startup notice preserves pending readings and insufficient space across the parent launcher',async()=>{
  for(const [stage,notice] of [['waiting-for-chat','请选择一条本地对话。'],['waiting-for-usage','正在等待读数。'],['space-unavailable','已读到容量，左栏空间不足。']]){
    let saved;
    const base={version:'new',reason:'Codex',experimentalBinary:'old',env:{},save:async record=>{saved=record;}};
    const message=await startMonitorAfterUpdate({...base,start:async()=>({stage,loaded:true,ready:false,notice})});
    assert.ok(message.startsWith(notice));
    assert.equal(saved.monitorStage,stage);
    assert.equal(saved.readingReady,stage==='space-unavailable');
    saved=null;
    for(const invalid of [null,{stage,loaded:true,ready:true,notice},{stage:'following',loaded:false,ready:true}]){
      await assert.rejects(startMonitorAfterUpdate({...base,start:async()=>invalid}),/尚未确认/);
      assert.equal(saved,null);
    }
  }
});

function scenario(states) {
  let reads=0, timestamp=0;
  const controller=new AbortController();
  const args={version:'pinned',signal:controller.signal,now:()=>timestamp,
    inventory:async()=>({version:'pinned',...states[Math.min(reads++,states.length-1)]}),
    wait:async milliseconds=>{timestamp+=milliseconds;}};
  return {args,controller,reads:()=>reads};
}

test('monitor fallback retries once after a user exit, preserves cancellation and propagates a failed retry',async()=>{
  for(const outcome of ['cancel','ready','refused-again','other-error']){
    const calls=[];
    const opts={version:'updated',reason:'Codex',env:{},experimentalBinary:'old',
      start:async()=>{
        calls.push('start');
        if(outcome==='other-error')throw Error('integrity failure');
        if(calls.length===1||outcome==='refused-again')throw loaderRestartRequired('disconnected');
        return following;
      },
      waitForExit:async()=>{calls.push('wait');return outcome!=='cancel';},
      save:async data=>calls.push(data.stage)};
    if(outcome==='refused-again'||outcome==='other-error')
      await assert.rejects(startMonitorAfterUpdate(opts),outcome==='other-error'?/integrity/:/disconnected/);
    else {
      const notice=await startMonitorAfterUpdate(opts);
      if(outcome==='cancel')assert.equal(notice,null);
      else assert.match(notice,/普通左栏/);
    }
    assert.deepEqual(calls,{cancel:['start','wait'], ready:['start','wait','start','monitor-only'],
      'refused-again':['start','wait','start'],'other-error':['start']}[outcome]);
  }
});

test('experimental start waits for natural exit of both Codex and Loader',async()=>{
  const f=scenario([{running:true,loader:true},{running:false,loader:true},{running:false,loader:false}]);
  await waitForDesktopExit(f.args);
  assert.equal(f.reads(),3);
});
test('a cancelled switch, changed version or expired wait cannot start the experimental host',async()=>{
  const pending=scenario([{running:true}]);
  pending.args.wait=async()=>pending.controller.abort();
  await assert.rejects(waitForDesktopExit(pending.args),{name:'AbortError'});
  assert.equal(pending.reads(),1);
  const changed=scenario([{version:'updated',running:false}]);
  await assert.rejects(waitForDesktopExit(changed.args),/已更新/);
  const expired=scenario([{loader:true}]);
  await assert.rejects(waitForDesktopExit({...expired.args,timeoutMs:2500}),/15 分钟/);
});
