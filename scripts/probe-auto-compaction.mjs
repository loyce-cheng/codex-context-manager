// Run disposable conversations on a private stdio app-server.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {capacityRequest} from '../src/control/capacity.mjs';
import {startCompactionFixture} from './compaction-provider-fixture.mjs';

if (!process.argv[2]) throw Error('Pass the installed Codex CLI path');
const binary = resolve(process.argv[2]);
const hot = process.argv.includes('--hot');
await mkdir('.research', {recursive:true});
const directory = await mkdtemp(resolve('.research', 'compact-test-'));
const isolated = join(directory, 'isolated-home');
await mkdir(isolated);
const fixture=process.argv.includes('--complete') ? await startCompactionFixture() : null;
await writeFile(join(isolated, 'config.toml'), [
  'model_provider = "offline"', '[analytics]', 'enabled = false',
  '[model_providers.offline]', 'name = "Offline fixture"',
  'base_url = "'+(fixture?.url??'http://127.0.0.1:9/v1')+'"', 'wire_api = "responses"',
  'requires_openai_auth = false', 'request_max_retries = 0', 'stream_max_retries = 0',
  ...(fixture ? [] : ['env_key = "CONTEXT_LENS_OFFLINE_TEST_KEY"']),
].join('\n'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(SystemRoot|WINDIR|COMSPEC|PATH|PATHEXT|TEMP|TMP|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(key)));
Object.assign(env, {CODEX_HOME:isolated, USERPROFILE:isolated, APPDATA:join(isolated,'roaming'), LOCALAPPDATA:join(isolated,'local')});
if(fixture)env.NO_PROXY='127.0.0.1';
const child = spawn(binary, process.argv.includes('--standalone') ? [] : ['app-server'], {cwd:directory, env, windowsHide:true, stdio:['pipe','pipe','ignore']});
const reader = createInterface({input:child.stdout});
const pending = new Map(), events = new Map();
let sequence = 0;
function rejectPending(error) {
  for(const waiter of pending.values()) waiter.reject(error);
  pending.clear();
}
child.on('error', rejectPending);
child.stdin.on('error', rejectPending);
child.once('exit', () => rejectPending(Error('Isolated app-server exited')));
reader.on('line', line => {
  let value;
  try {value=JSON.parse(line);} catch {return;}
  const waiter = pending.get(value.id);
  if(waiter) {
    pending.delete(value.id);
    if(value.error) waiter.reject(Error(waiter.method+' rejected ('+value.error.code+'): '+String(value.error.message).slice(0,180)));
    else waiter.resolve(value.result);
    return;
  }
  const p=value.params, tracker=events.get(p?.threadId);
  if(!tracker) return;
  if(p.item?.type==='contextCompaction' && ['item/started','item/completed'].includes(value.method))
    tracker.markers.push({event:value.method,turnId:p.turnId});
  if(value.method==='thread/tokenUsage/updated') tracker.usage.push(p.tokenUsage?.last?.totalTokens);
  if(value.method==='turn/completed') tracker.turns.set(p.turn.id,p.turn.status);
});
function request(method, params) {
  return new Promise((accept, fail) => {
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);fail(Error(method+' timed out'));},20000);
    pending.set(id,{method,resolve:value=>{clearTimeout(timer);accept(value);},reject:error=>{clearTimeout(timer);fail(error);}});
    child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
}
const model={slug:'gpt-6-astra',context_window:272000,max_context_window:872000,effective_context_window_percent:95};
const fixtureId='11111111-1111-4111-8111-111111111111';
const usage={threadId:fixtureId,host:'local',model:model.slug,capacity:258400,used:0};
const summary={modelTransport:fixture?'local synthetic Responses fixture':'offline provider with missing fixture key',samples:[],successfulSummaryVerified:false};
try {
  const init=await request('initialize',{clientInfo:{name:'context-lens-compact-test',version:'1'},capabilities:{experimentalApi:true}});
  summary.server=init.userAgent?.match(/\d+\.\d+\.\d+(?:[-.a-z0-9]+)?/i)?.[0]??null;
  child.stdin.write('{"method":"initialized"}\n');
  const history='oak '.repeat(470000);
  const selectedLimit=capacityRequest(usage,model,512000).config.model_auto_compact_token_limit;
  const cases = [
    ['baseline',512000,'oak'], ['larger-window',768000,history], ['selected-window',512000,history],
  ];
  if(!hot) cases.push(['same-window-lower-threshold',768000,history,selectedLimit]);
  summary.windowSelection=hot?'loaded-thread RPC':'thread/start config';
  for(const [label,tier,body,overrideLimit] of cases) {
    const plan=capacityRequest(usage,model,tier);
    const config={...plan.config,model_auto_compact_token_limit:overrideLimit??plan.config.model_auto_compact_token_limit};
    const start=await request('thread/start',{model:model.slug,modelProvider:'offline',ephemeral:true,cwd:directory,
      approvalPolicy:'never',sandbox:'read-only',config:hot?{}:config});
    const threadId=start.thread.id;
    const nativeBaseLimit=Math.min(config.model_auto_compact_token_limit,Math.floor(tier*9/10));
    if(hot) {
      const receipt=await request('thread/contextWindow/set',{threadId,expectedModel:model.slug,selection:{tokens:tier}});
      if(receipt.threadId!==threadId || receipt.model!==model.slug || receipt.rawTokens!==tier ||
          receipt.usableTokens!==plan.expectedUsableWindow || receipt.autoCompactTokenLimit!==nativeBaseLimit)
        throw Error('Capacity receipt mismatch for '+label);
    }
    const tracker={turns:new Map(),markers:[],usage:[]};events.set(threadId,tracker);
    const firstRequest=fixture?.samples.length;
    await request('thread/inject_items',{threadId,items:[{type:'message',role:'user',content:[{type:'input_text',text:body}]}]});
    const {turn}=await request('turn/start',{threadId,input:[{type:'text',text:'Reply OK.'}]});
    const until=Date.now()+30000;
    while(!tracker.turns.has(turn.id)&&Date.now()<until) await delay(100);
    const status=tracker.turns.get(turn.id);
    if(!status) throw Error(label+' did not complete within 30 seconds');
    summary.samples.push({label,tier,threshold:config.model_auto_compact_token_limit,nativeBaseLimit,fixtureBytes:Buffer.byteLength(body),
      turnStatus:status,turnCompactionEvents:tracker.markers.filter(m=>m.turnId===turn.id).map(m=>m.event),usage:tracker.usage.slice(-4),
      ...(fixture?{requests:fixture.samples.slice(firstRequest)}:{})});
  }
  const [baseline,larger,selected,thresholdOnly]=summary.samples;
  summary.thresholdDecisionObserved=selected.turnCompactionEvents.includes('item/started') &&
    (hot || thresholdOnly.turnCompactionEvents.includes('item/started')) &&
    baseline.turnCompactionEvents.length===0 && larger.turnCompactionEvents.length===0;
  summary.successfulSummaryVerified=!!fixture && summary.samples.every(s=>s.turnStatus==='completed') &&
    (hot?[selected]:[selected,thresholdOnly]).every(s=>{
      const last=s.requests.at(-1);
      return s.turnCompactionEvents.includes('item/completed') && s.requests.length>=2 &&
        last.containsPriorSummary && last.inputBytes<s.requests[0].inputBytes && s.usage.at(-1)===last.inputTokens+18;
    });
  if(!summary.thresholdDecisionObserved || (fixture && !summary.successfulSummaryVerified)) process.exitCode=1;
} catch(error) {
  summary.error=error.message;process.exitCode=1;
} finally {
  if(fixture)summary.fixtureRequestCount=fixture.samples.length;
  reader.close();child.stdin.end();
  if(child.exitCode===null && !child.signalCode) {
    const exit=once(child,'exit').catch(()=>{});
    child.kill();await Promise.race([exit,delay(2500)]);
  }
  await fixture?.close();
  await writeFile(join(directory,'result.json'),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary,null,2));
}
