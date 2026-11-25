import test from 'node:test';
import assert from 'node:assert/strict';
import {capacityLevels,capacityRequest,CapacityTransaction} from '../src/control/capacity.mjs';
const astra={slug:'gpt-6-astra',context_window:272000,max_context_window:872000,effective_context_window_percent:95};
const snapshot={threadId:'11111111-1111-4111-8111-111111111111',host:'local',model:astra.slug,capacity:258400,used:100000,activeTurnId:null,otherSubscribers:false};
const verified={mode:'reload-thread',validated:true};
test('checks the native total-context cap before accepting a target',()=>{
  assert.doesNotThrow(()=>capacityRequest({...snapshot,used:460799},astra,512000));
  assert.throws(()=>capacityRequest({...snapshot,used:460800},astra,512000),/IMMEDIATE_COMPACTION/);
});
test('capacity levels use each model catalog and distinguish configured from usable capacity',()=>{
  assert.deepEqual(capacityLevels(astra),[272000,384000,512000,768000,872000]);
  assert.deepEqual(capacityLevels({...astra,context_window:500000}),[500000,512000,768000,872000]);
  const p=capacityRequest(snapshot,astra,512000);assert.equal(p.expectedUsableWindow,486400);
  assert.equal(p.config.model_auto_compact_token_limit,462080);assert.equal(p.config.model_auto_compact_token_limit_scope,'total');
  assert.throws(()=>capacityLevels({...astra,max_context_window:null}),/UNVERIFIED/);
  assert.throws(()=>capacityRequest(snapshot,astra,1050000),/NOT_ALLOWED/);
});
test('production gate prevents writes; active turns and ambiguous subscribers also prevent writes',async()=>{
  const backend={reloadThread(){throw Error('must not call');}};
  await assert.rejects(new CapacityTransaction({snapshot,model:astra}).apply(512000,backend),/WRITE_UNVERIFIED/);
  for(const override of [{activeTurnId:'busy'},{otherSubscribers:true},{otherSubscribers:undefined}])
    await assert.rejects(new CapacityTransaction({snapshot:{...snapshot,...override},model:astra,capability:verified}).apply(512000,backend),/NOT_SAFE/);
});
test('RPC success cannot change meter; correct runtime observation confirms application',async()=>{
  const tx=new CapacityTransaction({snapshot,model:astra,capability:verified});
  await tx.apply(512000,{reloadThread:async p=>assert.equal(p.threadId,snapshot.threadId)});
  assert.equal(tx.state,'awaiting-observation');assert.equal(tx.actualCapacity,258400);
  assert.equal(tx.observe({...snapshot,threadId:'22222222-2222-4222-8222-222222222222',capacity:486400}),'awaiting-observation');
  assert.equal(tx.actualCapacity,258400);assert.equal(tx.observe({...snapshot,capacity:486400}),'applied');
});
test('failure, navigation and missing confirmation do not fabricate a larger capacity',async()=>{
  let time=0;const tx=new CapacityTransaction({snapshot,model:astra,capability:verified,now:()=>time});
  await assert.rejects(tx.apply(512000,{reloadThread:async()=>{throw Error('rejected');}}),/rejected/);
  assert.equal(tx.actualCapacity,258400);
  await tx.apply(512000,{reloadThread:async()=>{}});time=30001;assert.equal(tx.observe(snapshot),'unconfirmed');
  await assert.rejects(tx.apply(512000,{reloadThread:async()=>{}}),/IN_PROGRESS/);
  tx.select(snapshot);
  let finish;const pending=tx.apply(512000,{reloadThread:()=>new Promise(resolve=>finish=resolve)});
  tx.select({...snapshot,threadId:'22222222-2222-4222-8222-222222222222'});
  await assert.rejects(tx.apply(512000,{reloadThread:async()=>{}}),/IN_PROGRESS/);finish();
  assert.equal((await pending).state,'superseded');assert.equal(tx.actualCapacity,258400);
});

test('late real usage confirms a pending change without a generated turn or duplicate write',async()=>{
  let time=0,calls=0;
  const tx=new CapacityTransaction({snapshot,model:astra,capability:verified,now:()=>time});
  await tx.apply(512000,{reloadThread:async()=>{calls++;}});
  time=30001;assert.equal(tx.observe(snapshot),'unconfirmed');assert.equal(tx.plan.requestedWindow,512000);
  time=600000;
  assert.equal(tx.observe({...snapshot,model:'different',capacity:486400}),'unconfirmed');
  assert.equal(tx.observe({...snapshot,host:'remote',capacity:486400}),'unconfirmed');
  assert.equal(tx.actualCapacity,258400);
  assert.equal(tx.observe({...snapshot,capacity:486400}),'applied');assert.equal(tx.plan,null);assert.equal(calls,1);
  tx.select({...snapshot,threadId:'22222222-2222-4222-8222-222222222222'});
  assert.equal(tx.observe({...snapshot,capacity:486400}),'idle');assert.equal(tx.actualCapacity,258400);
});
test('shrinking into existing usage or targeting another model is refused',()=>{
  assert.throws(()=>capacityRequest({...snapshot,used:300000},astra,272000),/IMMEDIATE_COMPACTION/);
  assert.throws(()=>capacityRequest({...snapshot,model:'other'},astra,512000),/IDENTITY_UNVERIFIED/);
});
