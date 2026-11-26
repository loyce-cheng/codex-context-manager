import assert from 'node:assert/strict';
import test from 'node:test';
import {fixtureRequestFilter,fixtureReceipts,filterFrames} from '../experiments/desktop-context-window/isolated-adapter/adapter.mjs';

const threadId = '01234567-89ab-4567-89ab-0123456789ab';
const model = 'gpt-6-astra', modelProvider = 'context_lens_probe';
const seed = {
  snapshot:{threadId,model,modelProvider,host:'local',used:100,capacity:258400},
  threadMetadata:{id:threadId,model,modelProvider,ephemeral:false,status:{type:'notLoaded'}}
};
const encode = (params,method='thread/resume') => Buffer.from(JSON.stringify({id:1,method,params})+'\r\n');

test('only the first eligible synthetic resume gains the three capacity settings',()=>{
  const events=[];
  const filter=fixtureRequestFilter(seed,event=>events.push(event));
  const control=encode({threadId:'other'});
  assert.equal(filter(control),control);
  const params={threadId,cwd:'D:\\unicode 项目',approvalPolicy:'never',config:{sample:true}};
  const request=encode(params), result=JSON.parse(filter(request));
  assert.deepEqual(result.params,{...params,config:{sample:true,model_context_window:512000,
    model_auto_compact_token_limit:462080,model_auto_compact_token_limit_scope:'total'}});
  assert.equal(filter(request),request);
  assert.deepEqual(events,['target-resume-received','target-enriched','target-resume-received']);
});

test('explicit overrides, inline history and already active targets preserve native requests',()=>{
  for(const params of [{threadId,config:{model_context_window:768000}},{threadId,history:[]},{threadId,model:'other'}]){
    const request=encode(params);
    assert.equal(fixtureRequestFilter(seed,()=>{})(request),request);
  }
  const filter=fixtureRequestFilter(seed,()=>{});
  filter(encode({threadId},'turn/start'));
  const request=encode({threadId});
  assert.equal(filter(request),request);
  const precise=Buffer.from('{"id":9007199254740993,"method":"thread/resume","params":{"threadId":"'+threadId+'"}}\n');
  assert.equal(fixtureRequestFilter(seed,()=>{})(precise),precise);
});

test('split UTF-8, oversized frames and a partial last frame retain exact bytes',async()=>{
  const first=encode({threadId:'other',value:'文字'});
  const large=encode({threadId:'other',value:'x'.repeat(150000)});
  const data=Buffer.concat([first,large,encode({threadId}),Buffer.from('{"partial"')]);
  const pieces=[];
  for(let i=0;i<data.length;i+=7)pieces.push(data.subarray(i,i+7));
  const output=await Array.fromAsync(filterFrames(pieces,fixtureRequestFilter(seed,()=>{})));
  assert.deepEqual(Buffer.concat(output),data);
});

test('a desktop receipt requires an acknowledged resume and fresh matching completed turn',()=>{
  const events=[], receipts=fixtureReceipts(seed,event=>events.push(event));
  const send=msg=>{const bytes=Buffer.from(JSON.stringify(msg)+'\n');assert.equal(receipts.frame(bytes),bytes);};
  const notify=(method,params)=>send({method,params:{threadId,...params}});
  const turn={id:'new',status:'completed'};
  receipts.initialize(10);send({id:11,result:{userAgent:'fixture'}});
  assert.deepEqual(events,[]);
  send({id:10,result:{userAgent:'fixture'}});
  receipts.enrich(12);send({id:12,result:{thread:{id:threadId},model,modelProvider}});
  notify('thread/tokenUsage/updated',{turnId:'old',tokenUsage:{modelContextWindow:486400}});
  notify('turn/completed',{turn});
  notify('turn/started',{turn});
  notify('thread/tokenUsage/updated',{threadId:'other',turnId:'new',tokenUsage:{modelContextWindow:486400}});
  notify('turn/completed',{turn});
  assert.deepEqual(events,['initialize-acknowledged']);
  notify('turn/started',{turn});
  notify('thread/tokenUsage/updated',{turnId:'new',tokenUsage:{modelContextWindow:486400}});
  notify('turn/completed',{turn});
  assert.deepEqual(events,['initialize-acknowledged']);
  receipts.request({method:'turn/start',id:14,params:{threadId}});
  send({id:14,result:{turn}});
  notify('turn/started',{turn});
  notify('thread/tokenUsage/updated',{turnId:'new',tokenUsage:{modelContextWindow:486400}});
  notify('turn/completed',{turn});
  assert.deepEqual(events,['initialize-acknowledged','target-turn-486400']);
});
