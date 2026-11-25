import assert from 'node:assert/strict';
import test from 'node:test';
import {appendFile,mkdir,mkdtemp, readdir, readFile, rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {desktopChoice, writeDesktopTier, followDesktopChoices} from '../experiments/desktop-context-window/desktop-tier-bridge.mjs';
import {openTurnReceipt} from '../experiments/desktop-context-window/turn-receipt.mjs';

const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
const model='gpt-6-astra', now=50000;
const choice={threadId:a,expectedModel:model,chosenAt:now,id:'a'.repeat(32),selection:{tokens:512000}};
const sample={status:'following',threadId:a,capacityChoice:choice,diagnostics:{capacityPreflight:{host:'local',threadId:a,model}}};

test('native receipt uses only appended, complete records from the same turn and model',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lens-native-turn-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'session.jsonl'),source={rolloutPath:async()=>file};
  const meta=id=>JSON.stringify({type:'session_meta',payload:{id}})+'\n';
  const start=(id,time,capacity)=>JSON.stringify({type:'event_msg',timestamp:new Date(time).toISOString(),payload:{type:'task_started',turn_id:id,model_context_window:capacity}})+'\n';
  const context=(id,m)=>JSON.stringify({type:'turn_context',payload:{turn_id:id,model:m}})+'\n';
  const record={threadId:a,expectedModel:model};
  await writeFile(file,meta(b));await assert.rejects(openTurnReceipt(source,record),/identity/);
  const uppercase={...record,threadId:'AAAAAAAA-1111-4111-8111-111111111111'};
  await writeFile(file,meta(uppercase.threadId.toLowerCase()));await openTurnReceipt(source,uppercase);
  await writeFile(file,meta(a)+start('old',1000,258400)+context('old',model));
  const read=await openTurnReceipt(source,record);
  await appendFile(file,start('early',1000,258400)+context('early',model)+start('wrong-model',2500,272000)+context('wrong-model','other'));
  assert.equal(await read(2000),null);
  await appendFile(file,start('new',3000,486400)+context('another',model)+context('new',model).trimEnd());
  assert.equal(await read(2000),null);
  await appendFile(file,'\n');assert.equal(await read(2000),486400);
  assert.equal(await read(2000),486400,'the identical observation is available for a busy host retry');
});

test('bridge acknowledges a write first and reports the subsequent native capacity through the public receipt',async t=>{
  const home=await mkdtemp(join(tmpdir(),'lens-bridge-turn-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const dir=join(home,'sessions','2026','11','22');await mkdir(dir,{recursive:true});
  const file=join(dir,'rollout-2026-11-22T10-00-00-'+a+'.jsonl');
  await writeFile(file,JSON.stringify({type:'session_meta',payload:{id:a}})+'\n');
  const live={...sample,turnReceipts:true,capacityChoice:{...choice,chosenAt:null}};
  const calls=[],control=new AbortController(),stop=setTimeout(()=>control.abort(),10000);
  let polls=0;
  try{await followDesktopChoices({home,signal:control.signal,
    inspect:async()=>{live.capacityChoice.chosenAt??=Date.now();live.layoutOK=++polls>4;return {ok:true,result:live};},
    acknowledge:async id=>{
      calls.push(['staged',id]);
      const timestamp=new Date(Date.now()+1).toISOString();
      await appendFile(file,[{type:'event_msg',timestamp,payload:{type:'task_started',turn_id:'turn1',model_context_window:486400}},
        {type:'turn_context',payload:{turn_id:'turn1',model}}].map(row=>JSON.stringify(row)).join('\n')+'\n');
      return {ok:true,result:{displayed:true}};
    },confirmTurn:async(id,capacity)=>{
      calls.push(['measured',id,capacity]);
      if(live.layoutOK)control.abort();
      return {ok:true,result:{displayed:live.layoutOK}};
    }
  });}finally{clearTimeout(stop);}
  assert.deepEqual(calls,[['staged',choice.id],['measured',choice.id,486400]]);
  assert.equal(polls,5);
});

test('export only fresh explicit choices matching the local chat and model',()=>{
  const namespaced='provider:model';
  const tagged={...sample,capacityChoice:{...choice,expectedModel:namespaced},
    diagnostics:{capacityPreflight:{host:'local',threadId:a,model:namespaced}}};
  assert.equal(desktopChoice(tagged,now,now)?.record.expectedModel,namespaced);
  assert.deepEqual(desktopChoice(sample,now,now)?.record,{threadId:a,expectedModel:model,selection:{tokens:512000}});
  for(const other of [{...sample,capacityChoice:null},{...sample,threadId:b},{...sample,status:'waiting'},
    {...sample,diagnostics:{capacityPreflight:{host:'remote',model,threadId:a}}},
    {...sample,capacityChoice:{...choice,expectedModel:'different'}},
    {...sample,capacityChoice:{...choice,chosenAt:now-1}},
    {...sample,capacityChoice:{...choice,chosenAt:now+1}},
    {...sample,capacityChoice:{...choice,selection:{tokens:-1}}}]) {
    assert.equal(desktopChoice(other,now,now),null);
  }
  assert.equal(desktopChoice(sample,0,now+15001),null);
});

test('write and reset each chat independently with complete JSON records',async t=>{
  const home=await mkdtemp(join(tmpdir(),'lens-tier-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const {record}=desktopChoice(sample,now,now);
  await Promise.all([writeDesktopTier(home,record),writeDesktopTier(home,{...record,threadId:b})]);
  await writeDesktopTier(home,{...record,selection:'default'});
  const directory=join(home,'context-lens-desktop-tiers-v1');
  assert.deepEqual((await readdir(directory)).sort(),[a+'.json',b+'.json']);
  assert.equal(JSON.parse(await readFile(join(directory,a+'.json'),'utf8')).selection,'default');
  assert.deepEqual(JSON.parse(await readFile(join(directory,b+'.json'),'utf8')).selection,{tokens:512000});
  await assert.rejects(writeDesktopTier(home,{...record,threadId:'../other'}));
});

test('acknowledge only after the same visible choice has been saved for its owner',async t=>{
  const home=await mkdtemp(join(tmpdir(),'lens-bridge-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const live={...sample,capacityChoice:{...choice}};
  let reads=0, receivedId, savedTokens, wrongReceipts=0;
  const controller=new AbortController();
  await followDesktopChoices({home,signal:controller.signal,inspect:async()=>{
    if(reads++===0)live.capacityChoice.chosenAt=Date.now();
    return {ok:true,result:live};
  },beforeWrite:async()=>true,acknowledge:async id=>{
    controller.abort();
    receivedId=id;
    savedTokens=JSON.parse(await readFile(join(home,'context-lens-desktop-tiers-v1',a+'.json'),'utf8')).selection.tokens;
  }});
  assert.equal(reads,2);
  assert.equal(receivedId,choice.id);
  assert.equal(savedTokens,512000);
  const switched=new AbortController();
  reads=0;
  await followDesktopChoices({home,signal:switched.signal,inspect:async()=>{
    if(++reads===1){live.capacityChoice.chosenAt=Date.now();return {ok:true,result:live};}
    switched.abort();return {ok:true,result:{...live,threadId:b}};
  },beforeWrite:async()=>true,acknowledge:async()=>{wrongReceipts++;}});
  assert.equal(reads,2);
  assert.equal(wrongReceipts,0);
});

test('rechecks the visible choice after owner verification and retries a busy receipt without rewriting',async t=>{
  const home=await mkdtemp(join(tmpdir(),'lens-receipt-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const controller=new AbortController();
  const live={...sample,capacityChoice:{...choice}};
  let inspections=0, owners=0, receipts=0;
  await followDesktopChoices({home,signal:controller.signal,inspect:async()=>{
    if(inspections++===0)live.capacityChoice.chosenAt=Date.now();
    return {ok:true,result:live};
  },beforeWrite:async()=>{owners++;return true;},acknowledge:async()=>{
    if(++receipts===1){
      live.capacityChoice.chosenAt-=16000;
      return {ok:false,error:{code:'COMMAND_BUSY'}};
    }
    controller.abort();return {ok:true,result:{displayed:true}};
  }});
  assert.equal(owners,1);
  assert.equal(receipts,2);
  assert.equal(inspections,3);
  const changed=new AbortController();
  let selection=live, samples=0;
  await followDesktopChoices({home,signal:changed.signal,inspect:async()=>{
    if(++samples===1)live.capacityChoice={...choice,id:'b'.repeat(32),chosenAt:Date.now(),selection:{tokens:768000}};
    if(samples>=3)changed.abort();
    return {ok:true,result:selection};
  },beforeWrite:async()=>{selection={...live,threadId:b};return true;},
  acknowledge:async()=>assert.fail('old selection acknowledged')});
  const saved=JSON.parse(await readFile(join(home,'context-lens-desktop-tiers-v1',a+'.json'),'utf8'));
  assert.deepEqual(saved.selection,{tokens:512000});
});

test('tier files use the same canonical local UUID as the backend',async t=>{
  const home=await mkdtemp(join(tmpdir(),'lens-tier-case-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const threadId='ABCDEFAB-1111-4111-8111-111111111111';
  await writeDesktopTier(home,{threadId,expectedModel:model,selection:'default'});
  const folder=join(home,'context-lens-desktop-tiers-v1');
  assert.deepEqual(await readdir(folder),[threadId.toLowerCase()+'.json']);
  const record=JSON.parse(await readFile(join(folder,threadId.toLowerCase()+'.json'),'utf8'));
  assert.equal(record.threadId,threadId.toLowerCase());
});
