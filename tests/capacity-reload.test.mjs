import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityRequest } from '../src/control/capacity.mjs';
import { ThreadCapacityReloader, threadIsLoaded, resumeWithCapacity, resumeWithSavedTarget, resumeWithRequestedExpansion } from '../src/control/reload.mjs';
import {targetPreferenceKey} from '../src/control/target-preference.mjs';
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const model={slug:'gpt-6-astra',context_window:272000,max_context_window:872000,effective_context_window_percent:95};
const plan=capacityRequest({threadId:A,host:'local',model:model.slug,capacity:486400,used:10000},model,768000);
const original={threadId:A,model:model.slug,cwd:'D:/test',permissions:'workspace',approvalPolicy:'on-request',
  config:{model_context_window:512000,model_auto_compact_token_limit:480000,model_auto_compact_token_limit_scope:'total',model_reasoning_effort:'low'}};
test('host-initiated resume retains pagination and permission choices; mismatched rollout or model cannot redirect it',()=>{
  const path='D:/test/rollout-2026-11-18-'+A+'.jsonl';
  const params={threadId:A,model:null,history:null,path,initialTurnsPage:{limit:3},approvalPolicy:'on-request',config:{existing:1}};
  const resolved={threadId:A,host:'local',model:model.slug,threadMetadata:{id:A,path}};
  assert.deepEqual(resumeWithCapacity(params,plan,resolved),{...params,config:{existing:1,...plan.config}});
  assert.deepEqual(params.config,{existing:1});
  for(const override of [{threadId:B},{path:path.replace(A,B)},{model:'other'},{history:[]}]){
    assert.throws(()=>resumeWithCapacity({...params,...override},plan,resolved),/UNVERIFIED/);
  }
  assert.throws(()=>resumeWithCapacity(params,plan,{...resolved,threadMetadata:null}),/UNVERIFIED/);
});
test('passive resume reads only this chat/model target and leaves ordinary restores intact',()=>{
  const prefs=new Map([[targetPreferenceKey(A,model.slug),'512000']]);
  const snapshot={host:'local',threadId:A,model:model.slug,modelProvider:'fixture',capacity:258400,used:120000};
  const threadMetadata={id:A,model:model.slug,modelProvider:'fixture',ephemeral:false,status:{type:'notLoaded'}};
  const context={snapshot,model,threadMetadata,readPreference:key=>prefs.get(key)};
  const params={threadId:A,excludeTurns:true,config:{model_reasoning_effort:'low'}};
  assert.deepEqual(resumeWithSavedTarget(params,context).config,{model_reasoning_effort:'low',
    model_context_window:512000,model_auto_compact_token_limit:462080,model_auto_compact_token_limit_scope:'total'});
  const other={threadId:B};assert.equal(resumeWithSavedTarget(other,{...context,snapshot:{...snapshot,threadId:B},threadMetadata:{id:B}}),other);
  const explicit={...params,config:{model_context_window:384000}};assert.equal(resumeWithSavedTarget(explicit,context),explicit);
  for (const changes of [{status:{type:'idle'}},{ephemeral:true},{model:'different'},{modelProvider:'different'}]) {
    assert.equal(resumeWithSavedTarget(params,{...context,threadMetadata:{...threadMetadata,...changes}}),params);
  }
  assert.equal(resumeWithSavedTarget(params,{...context,readPreference:()=>String(model.context_window)}),params);
  for(const invalid of [{snapshot:null},{model:null},{threadMetadata:{id:B}},{snapshot:{...snapshot,used:490000}},
    {snapshot:{...snapshot,host:'remote'}},{readPreference:()=>{throw Error('storage unavailable');}},{readPreference:()=>999999}]){
    assert.equal(resumeWithSavedTarget(params,{...context,...invalid}),params);
  }
});
test('explicit expansion uses the original resume once and reads authoritative thread metadata before dispatch',async()=>{
  const calls=[];
  const params={threadId:A,excludeTurns:true,config:{model_reasoning_effort:'low'},initialTurnsPage:{limit:3}};
  const snapshot={host:'local',threadId:A,model:model.slug,modelProvider:'test',capacity:486400,used:10000};
  const thread={id:A,status:{type:'notLoaded'},model:model.slug,modelProvider:'test',ephemeral:false};
  const response={thread:{id:A},model:model.slug,modelProvider:'test'};
  const options={host:'local',plan,model,getSnapshot:()=>snapshot,isCurrent:()=>true,
    readThread:async query=>{assert.deepEqual(query,{threadId:A,includeTurns:false});return {thread};},
    resume:async input=>{calls.push(input);return response;}};
  assert.deepEqual(await resumeWithRequestedExpansion(params,options),{response,state:'awaiting-observation'});
  assert.deepEqual(calls,[{...params,config:{...params.config,...plan.config}}]);
  const errors=[{isCurrent:()=>false},{readThread:async()=>{throw Error('offline');}},
    {getSnapshot:()=>({...snapshot,threadId:B})},{getSnapshot:()=>({...snapshot,capacity:729600})},
    ...[{model:'other'},{ephemeral:true},{status:{type:'idle'}},{status:{type:'active'}},{modelProvider:'different'},{id:B}]
      .map(change=>({readThread:async()=>({thread:{...thread,...change}})}))];
  for(const override of errors){
    calls.length=0;assert.equal((await resumeWithRequestedExpansion(params,{...options,...override})).state,'unchanged');
    assert.deepEqual(calls,[params]);assert.equal(calls[0],params);
  }
  let selected=true;
  assert.equal((await resumeWithRequestedExpansion(params,{...options,isCurrent:()=>selected,
    readThread:async()=>{selected=false;return {thread};}})).state,'unchanged');
  calls.length=0;
  await assert.rejects(resumeWithRequestedExpansion(params,{...options,resume:async input=>{calls.push(input);throw Error('timeout');}}),/timeout/);
  assert.equal(calls.length,1);
  assert.equal((await resumeWithRequestedExpansion(params,{...options,resume:async()=>({...response,modelProvider:'other'})})).state,'unconfirmed');
});
function fixture(overrides={}) {
  const calls=[],phases=[],releases=[];let time=0,remaining=2;
  const lease={host:'local',threadId:A,model:model.slug,exclusive:true,holdsTurnsAndResumes:true,settingsPreserved:true,
    resumeParams:structuredClone(original),
    check:async()=>({threadId:A,host:'local',model:model.slug,idle:true,exclusive:true,holdsTurnsAndResumes:true}),
    request:async(method,params)=>{
      calls.push({method,params});
      if(method==='thread/unsubscribe')return {status:'unsubscribed'};
      if(method==='thread/loaded/list')return {data:remaining-->0?[A,B]:[B],nextCursor:null};
      if(method==='thread/resume')return {thread:{id:params.threadId}};
      throw Error('unexpected method');
    },
    release:async outcome=>releases.push(outcome),...overrides};
  const reloader=new ThreadCapacityReloader({acquire:async()=>lease,now:()=>time,wait:async ms=>{time+=ms;},unloadTimeoutMs:1000,pollMs:500});
  return {lease,reloader,calls,phases,releases,options:{onPhase:phase=>phases.push(phase)}};
}
test('reload waits for release, preserves non-capacity settings and never touches a second thread',async()=>{
  const f=fixture();const result=await f.reloader.reloadThread(plan,f.options);
  assert.equal(result.state,'awaiting-observation');assert.equal(result.observedCapacity,null);
  assert.deepEqual(f.phases,['checking','releasing','waiting-for-unload','resuming','awaiting-observation']);
  const resume=f.calls.at(-1);assert.equal(resume.method,'thread/resume');
  assert.deepEqual(resume.params,{...original,excludeTurns:true,config:{...original.config,...plan.config}});
  assert.deepEqual(f.lease.resumeParams,original);
  assert.ok(f.calls.every(c=>c.method==='thread/loaded/list'||c.params.threadId===A));
  assert.equal(f.releases.length,1);
});
test('busy, ambiguous or unpreserved sessions are refused before unsubscribe',async()=>{
  for(const override of [{exclusive:false},{holdsTurnsAndResumes:false},{settingsPreserved:false},
    {resumeParams:{...original,path:'unrelated-rollout'}},{check:async()=>({idle:false})}]) {
    const f=fixture(override);await assert.rejects(f.reloader.reloadThread(plan));assert.equal(f.calls.length,0);
  }
});
test('loaded list pagination, malformed pages and cursor loops cannot be mistaken for unload',async()=>{
  let calls=0;
  assert.equal(await threadIsLoaded(async()=>++calls===1?{data:[B],nextCursor:'page2'}:{data:[A],nextCursor:null},A),true);
  for(const page of [{data:[],nextCursor:'repeat'},{data:[]},{data:['bad-id'],nextCursor:null}])
    await assert.rejects(threadIsLoaded(async()=>page,A),/LOADED_STATE_UNVERIFIED/);
});
test('navigation during the wait restores captured settings to A, never to newly selected B',async()=>{
  const f=fixture();let selected=A;
  f.reloader.wait=async()=>{selected=B;};
  await assert.rejects(f.reloader.reloadThread(plan,{...f.options,isCurrent:()=>selected===A}),e=>e.code==='CAPACITY_CHANGE_CANCELLED'&&e.recovery==='restored');
  assert.deepEqual(f.calls.at(-1),{method:'thread/resume',params:{...original,excludeTurns:true}});
  assert.equal(f.phases.includes('resuming'),false);
});
test('timeout reattaches with original settings and unknown restore failure remains explicit',async()=>{
  for(const rejectRestore of [false,true]) {
    const f=fixture(),request=f.lease.request;
    f.lease.request=async(method,params)=>{
      if(method==='thread/loaded/list')return {data:[A,B],nextCursor:null};
      if(rejectRestore&&method==='thread/resume')throw Error('disconnected');
      return request(method,params);
    };
    await assert.rejects(f.reloader.reloadThread(plan,f.options),e=>e.code==='THREAD_UNLOAD_TIMEOUT'&&e.recovery===(rejectRestore?'required':'restored'));
    assert.equal(f.reloader.running,false);assert.equal(f.phases.includes('resuming'),false);
  }
});
test('ambiguous resume outcome is not called a rollback and does not start competing resume writes',async()=>{
  for(const mismatch of [false,true]) {
    const f=fixture(),request=f.lease.request;
    f.lease.request=async(method,params)=>{
      if(method==='thread/resume'){f.calls.push({method,params});if(mismatch)return {thread:{id:B}};throw Error('timeout');}
      return request(method,params);
    };
    await assert.rejects(f.reloader.reloadThread(plan),e=>e.recovery==='required');
    assert.equal(f.calls.filter(c=>c.method==='thread/resume').length,1);
  }
});
test('missing unsubscribe acknowledgment cannot be claimed recovered after best-effort reattach',async()=>{
  const f=fixture(),request=f.lease.request;
  f.lease.request=async(method,params)=>{if(method==='thread/unsubscribe')throw Error('timeout');return request(method,params);};
  await assert.rejects(f.reloader.reloadThread(plan),e=>e.recovery==='required');
  assert.deepEqual(f.calls.at(-1).params,{...original,excludeTurns:true});
});
test('one controller serializes transactions while still releasing after cancellation or a failed lease release',async()=>{
  const f=fixture();let finish;
  f.reloader.acquire=()=>new Promise(resolve=>finish=()=>resolve(f.lease));
  const controller=new AbortController();
  const first=f.reloader.reloadThread(plan,{signal:controller.signal});
  await assert.rejects(f.reloader.reloadThread(plan),/IN_PROGRESS/);
  controller.abort();finish();await assert.rejects(first,/CANCELLED/);assert.equal(f.calls.length,0);
  const g=fixture({release:async()=>{throw Error('lost owner');}});
  await assert.rejects(g.reloader.reloadThread(plan),e=>e.code==='RELOAD_LEASE_RELEASE_FAILED'&&e.recovery==='required');
    const double=fixture({exclusive:false,release:async()=>{throw Error('lost owner');}});
    await assert.rejects(double.reloader.reloadThread(plan),e=>e.code==='RELOAD_LEASE_UNVERIFIED' &&
      e.recovery==='required' && e.cause instanceof AggregateError && e.cause.errors[1].message==='lost owner');
});
