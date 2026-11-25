import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { LocalCodexSource, extractTelemetry, assertThreadId, within } from '../src/adapters/local-codex.mjs';

const id='11111111-1111-4111-8111-111111111111';
test('an older duplicate does not replace the newer indexed conversation',async t=>{
  const home=await mkdtemp(join(tmpdir(),'lens-index-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  for(const year of ['2025','2026']){
    const dir=join(home,'sessions',year,'01','01');
    await mkdir(dir,{recursive:true});
    await writeFile(join(dir,`rollout-${year}-01-01T10-00-00-${id}.jsonl`),'');
  }
  const [item]=await new LocalCodexSource({home}).listThreads();
  assert.equal(item.date,'2026-01-01');
});
const row=(type,payload,timestamp='2026-10-29T10:00:00Z')=>JSON.stringify({type,payload,timestamp})+'\n';
const usage=(n,ts)=>row('event_msg',{type:'token_count',info:{last_token_usage:{total_tokens:n},total_token_usage:{total_tokens:999999999},model_context_window:258400}},ts);
test('telemetry discards conversation text and cumulative totals',()=>{
  const s=extractTelemetry([row('event_msg',{type:'agent_message',message:'PRIVATE'}),usage(10000)]);
  assert.equal(s.used,10000);assert(!JSON.stringify(s).includes('PRIVATE'));assert(!JSON.stringify(s).includes('999999999'));
  assert.throws(()=>assertThreadId('../../auth.json'));assert.equal(within('/tmp/source','/tmp/other/file'),false);
  assert.deepEqual(extractTelemetry(['null','[1]','false','{broken']),{});
});
test('reader follows append, ignores partial lines, resets on truncation and never writes logs',async()=>{
  const home=await mkdtemp(join(tmpdir(),'context-lens-test-'));const folder=join(home,'sessions','2026','10','29');await mkdir(folder,{recursive:true});
  const path=join(folder,`rollout-2026-10-29T16-13-30-${id}.jsonl`),prefix=row('session_meta',{id})+row('turn_context',{model:'test-model'});
  try{
    await writeFile(path,prefix+usage(10000));await writeFile(join(home,'models_cache.json'),JSON.stringify({models:[{slug:'test-model',context_window:272000,max_context_window:872000,effective_context_window_percent:95}]}));
    const source=new LocalCodexSource({home});assert.equal((await source.listThreads())[0].threadId,id);
    let s=await source.snapshot(id);assert.equal(s.usedTokens,10000);assert.equal(s.displayWindow,272000);
    const next=usage(20000,'2026-10-29T10:01:00Z');await appendFile(path,next.slice(0,-1));s=await source.snapshot(id);assert.equal(s.usedTokens,10000);
    await appendFile(path,'\n');s=await source.snapshot(id);assert.equal(s.usedTokens,20000);
    await writeFile(path,prefix+usage(5000,'2026-10-29T10:02:00Z'));s=await source.snapshot(id);assert.equal(s.usedTokens,5000);
    assert.equal(source.capabilities().runtimeWindowUpdate,false);await assert.rejects(source.snapshot('22222222-2222-4222-8222-222222222222'));
  }finally{await cleanup(home);}
});

async function cleanup(home){assert(within(resolve(tmpdir()),resolve(home)));assert(basename(home).startsWith('context-lens-test-'));await rm(home,{recursive:true,force:true});}

test('old header usage is not presented as a recent snapshot when the bounded tail has none',async()=>{
  const home=await mkdtemp(join(tmpdir(),'context-lens-test-'));const folder=join(home,'sessions','2026','10','29');await mkdir(folder,{recursive:true});
  const path=join(folder,`rollout-2026-10-29T16-13-30-${id}.jsonl`);
  try{
    await writeFile(path,row('session_meta',{id})+row('turn_context',{model:'test-model'})+usage(10000)+row('response_item',{text:'x'.repeat(3000)}));
    const source=new LocalCodexSource({home,maxTailBytes:1024});assert.equal((await source.snapshot(id)).usedTokens,null);
    await appendFile(path,usage(20000));assert.equal((await source.snapshot(id)).usedTokens,20000);
    await appendFile(path,row('event_msg',{type:'task_complete'}));assert.equal((await source.snapshot(id)).usedTokens,20000);
    await appendFile(path,row('event_msg',{type:'context_compacted'}));assert.equal((await source.snapshot(id)).usedTokens,null);
  }finally{await cleanup(home);}
});
