// Isolated stdio protocol probe. No desktop threads, real auth or user config writes.
// --complete serves simulated Responses on loopback. Offline probes use a missing fixture key.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ThreadCapacityReloader,threadIsLoaded,resumeWithCapacity,resumeWithSavedTarget,resumeWithRequestedExpansion } from '../src/control/reload.mjs';
import {targetPreferenceKey} from '../src/control/target-preference.mjs';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {capacityRequest} from '../src/control/capacity.mjs';
import {startCompactionFixture} from './compaction-provider-fixture.mjs';
const executable=process.argv[2];
const binary=executable && /[\\/]/.test(executable) ? resolve(executable) : executable;
const loadedWindow=process.argv.find(value=>value.startsWith('--loaded-window='))?.split('=')[1];
if(loadedWindow!==undefined && !['stock','patched'].includes(loadedWindow)) throw Error('Use --loaded-window=stock or --loaded-window=patched');
const localTurn=process.argv.includes('--local-turn');
const naturalResume=process.argv.includes('--natural-resume');
const coldResume=process.argv.includes('--cold-resume');
const explicitExpansion=process.argv.includes('--explicit-expansion');
if(explicitExpansion&&!naturalResume)throw Error('--explicit-expansion requires --natural-resume');
if(coldResume&&!naturalResume)throw Error('--cold-resume requires --natural-resume');
if(naturalResume&&!localTurn) throw Error('--natural-resume requires --local-turn');
if(!binary) throw Error('Pass the verified current Codex CLI path.');
const directory=resolve('.research','capacity-probe-'+Date.now()+'-'+randomUUID());
const probeHome=join(directory,'isolated-home');
await mkdir(probeHome,{recursive:true});
const complete=process.argv.includes('--complete');
const desktopTiers=process.argv.includes('--desktop-tiers');
const desktopArgs=process.argv.includes('--desktop-cli');
const browserSlider=process.argv.includes('--sidebar-browser');
if(browserSlider && !desktopTiers)throw Error('--sidebar-browser requires --desktop-tiers');
if(desktopTiers && (loadedWindow!=='patched' || !complete))throw Error('--desktop-tiers requires --loaded-window=patched --complete');
if(desktopArgs && process.argv.includes('--standalone'))throw Error('--desktop-cli requires a full CLI');
if(complete&&!loadedWindow&&!naturalResume)throw Error('--complete requires a loaded-window or natural-resume test');
const fixture=complete ? await startCompactionFixture() : null;
await writeFile(join(probeHome,'config.toml'),[
  ...(naturalResume?['thread_unload_delay_secs = 1']:[]),
  'model = "gpt-6-astra"','model_provider = "context_lens_probe"',
  '[analytics]','enabled = false',
  '[model_providers.context_lens_probe]','name = "Context Lens local protocol probe"',
  'base_url = "'+(fixture?.url??'http://127.0.0.1:9/v1')+'"','wire_api = "responses"',
  'requires_openai_auth = false','request_max_retries = 0','stream_max_retries = 0',
  ...(!fixture && (loadedWindow || localTurn) ? ['env_key = "CONTEXT_LENS_OFFLINE_TEST_KEY"'] : []),
].join('\n')+'\n');
// Only Windows process essentials are inherited; no API keys or login credentials.
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(SystemRoot|WINDIR|COMSPEC|PATH|PATHEXT|TEMP|TMP|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(key)));
Object.assign(env,{CODEX_HOME:probeHome,USERPROFILE:probeHome,APPDATA:join(probeHome,'AppData','Roaming'),LOCALAPPDATA:join(probeHome,'AppData','Local')});
let sequence=0,stderr='',child,lines;const pending=new Map(),notifications=[],windows=[],completed=new Map();
const compactionEvents=[];
if(fixture)env.NO_PROXY='127.0.0.1';
if(desktopTiers)env.CONTEXT_LENS_DESKTOP_TIERS='1';
function onLine(line){let value;try{value=JSON.parse(line);}catch{return;}
  if(value.id!==undefined&&pending.has(value.id)){const item=pending.get(value.id);pending.delete(value.id);clearTimeout(item.timer);item.resolve(value);}
  else if(value.method){
    notifications.push(value.method);
    if(value.params?.item?.type==='contextCompaction' && ['item/started','item/completed'].includes(value.method))
      compactionEvents.push({method:value.method,thread:value.params.threadId,turn:value.params.turnId});
    if(value.method==='thread/tokenUsage/updated')windows.push({threadId:value.params?.threadId,turnId:value.params?.turnId,window:value.params?.tokenUsage?.modelContextWindow,used:value.params?.tokenUsage?.last?.totalTokens});
    if(value.method==='turn/completed')completed.set(value.params?.turn?.id,value.params?.turn?.status);
  }
}
function startServer(){
  const args=desktopArgs ? ['-c','features.code_mode_host=true','app-server','--analytics-default-enabled',
    '-c','features.prefer_mxc=true','--plugin-mcp-launch-cwd','fixture@local','example',directory,
    '--mcp-launch-cwd','fixture',resolve(binary),directory] : process.argv.includes('--standalone')?[]:['app-server'];
  child=spawn(binary,args,{cwd:directory,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-16000);});
  lines=createInterface({input:child.stdout});lines.on('line',onLine);
  const rejectPending=error=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();};
  lines.on('error',rejectPending);child.stderr.on('error',rejectPending);
  child.on('error',rejectPending);child.stdin.on('error',rejectPending);
  child.once('exit',()=>rejectPending(Error('Test app-server exited')));
}
async function stopServer(){
  if(child.pid && child.exitCode===null && child.signalCode===null){
    const exited=once(child,'exit');child.stdin.end();
    await Promise.race([exited,delay(2000,undefined,{ref:false})]);
    if(child.exitCode===null && child.signalCode===null){child.kill();await exited;}
  }
  lines.close();
}
startServer();
function rpc(method,params){return new Promise((resolveRpc,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},15000);pending.set(id,{resolve:resolveRpc,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
const outcome=value=>value.error?{accepted:false,code:value.error.code,message:String(value.error.message).slice(0,700)}:{accepted:true};
const report={checkedAt:new Date().toISOString(),isolatedHome:true,persistentTestThreadOnlyInsideWorkspace:true,externalModelRequestsSent:0,localTransportTest:localTurn,desktopThreadsTouched:false,checks:{}};
const aliases=new Map(),turnLabels=new Map();
async function localTestTurn(threadId){
  const response=await rpc('turn/start',{threadId,input:[{type:'text',text:'Local capacity protocol probe; no tools.'}]});
  if(response.error){
    if(fixture)throw Error('Local fixture turn rejected.');
    return outcome(response);
  }
  const turnId=response.result?.turn?.id,deadline=Date.now()+18000;
  turnLabels.set(turnId,aliases.get(threadId)??'unknown');
  while(!completed.has(turnId)&&Date.now()<deadline)await new Promise(resolveWait=>setTimeout(resolveWait,100));
  if(!completed.has(turnId))throw Error('Local transport test exceeded its deadline.');
  const usage=windows.findLast(item=>item.threadId===threadId && item.turnId===turnId);
  if(fixture && (completed.get(turnId)!=='completed' || !Number.isSafeInteger(usage?.window)))
    throw Error('Missing completed fixture response or native usage for '+aliases.get(threadId));
  if(fixture)(report.measuredTurns??=[]).push({label:aliases.get(threadId),window:usage.window});
  return {accepted:true,status:completed.get(turnId),reportedWindow:usage?.window??null,turnId};
}

async function checkResumedCompaction(threadId, tier, expectedWindow, shouldCompact) {
  const first=fixture.samples.length;
  const history='oak '.repeat(470000);
  const injection=await rpc('thread/inject_items',{threadId,items:[
    {type:'message',role:'user',content:[{type:'input_text',text:history}]}
  ]});
  if(injection.error)throw Error('Synthetic history was rejected.');
  aliases.set(threadId,'compact-'+tier);
  const turn=await localTestTurn(threadId);
  const markers=compactionEvents.filter(event=>event.thread===threadId && event.turn===turn.turnId);
  const samples=fixture.samples.slice(first), last=samples.at(-1);
  const summary=markers.some(event=>event.method==='item/completed') && samples.length>=2 &&
    last.containsPriorSummary && last.inputBytes<samples[0].inputBytes;
  if(turn.reportedWindow!==expectedWindow || !last ||
      (shouldCompact ? !summary : markers.length!==0))throw Error('Unexpected compaction result at '+tier);
  (report.resumedCompaction??=[]).push({tier,window:turn.reportedWindow,compacted:summary});
}
async function observedTurnWindows(directory){
  const rows=[];
  async function visit(path){
    let entries;try{entries=await readdir(path,{withFileTypes:true});}catch{return;}
    for(const entry of entries){
      if(entry.isDirectory())await visit(join(path,entry.name));
      else if(entry.name.endsWith('.jsonl'))for(const line of (await readFile(join(path,entry.name),'utf8')).split('\n')){
        let v;try{v=JSON.parse(line);}catch{continue;}
        if(v.type==='event_msg'&&v.payload?.type==='task_started')rows.push({turnId:v.payload.turn_id,window:v.payload.model_context_window});
      }
    }
  }
  await visit(directory);return rows;
}
async function verifyResume(){
  const start=await rpc('thread/start',{model:'gpt-6-astra',modelProvider:'context_lens_probe',cwd:directory,ephemeral:false,approvalPolicy:'never',sandbox:'read-only',
    config:{model_context_window:512000,model_auto_compact_token_limit:480000,model_auto_compact_token_limit_scope:'total'}});
  report.checks.startWithThreadConfig=outcome(start);
  const id=start.result?.thread?.id;
  if(id){
    aliases.set(id,'A');
    let controlId=null;
    report.checks.persistedOnlyInIsolatedHome=start.result.thread.ephemeral===false;
    if(localTurn)report.checks.beforeLiveChange=await localTestTurn(id);
    report.checks.liveCamelCase=outcome(await rpc('thread/settings/update',{threadId:id,modelContextWindow:768000}));
    report.checks.liveSnakeCase=outcome(await rpc('thread/settings/update',{threadId:id,model_context_window:768000}));
    report.checks.liveConfigObject=outcome(await rpc('thread/settings/update',{threadId:id,config:{model_context_window:768000}}));
    report.checks.unknownFieldControl=outcome(await rpc('thread/settings/update',{threadId:id,contextLensUnsupportedProbeField:123}));
    report.checks.supportedEffortControl=outcome(await rpc('thread/settings/update',{threadId:id,effort:'low'}));
    if(localTurn)report.checks.afterLiveChange=await localTestTurn(id);
    const resumed=await rpc('thread/resume',{threadId:id,excludeTurns:true,config:{model_context_window:768000}});
    report.checks.resumeLoadedWithConfig={...outcome(resumed),sameThread:resumed.result?.thread?.id===id,
      responseReportsWindow:Object.hasOwn(resumed.result??{},'modelContextWindow')};
    if(localTurn&&!resumed.error)report.checks.afterLoadedResume=await localTestTurn(id);
    if(localTurn&&!resumed.error){
      const control=await rpc('thread/start',{model:'gpt-6-astra',modelProvider:'context_lens_probe',cwd:directory,ephemeral:false,config:{model_context_window:272000}});
      controlId=control.result?.thread?.id??null;
      if(controlId){aliases.set(controlId,'B');report.checks.controlBefore=await localTestTurn(controlId);}
      const phases=[];let unsubscribeAt=null;
      // This lease is valid ONLY in this owned, isolated stdio process: there
      // are no other clients, native automatic resumes, or concurrent turns.
      const request=async(method,params)=>{
        const response=await rpc(method,params);
        if(response.error)throw Error(method+' rejected: '+response.error.code);
        if(method==='thread/unsubscribe'){report.checks.unsubscribe={accepted:true,status:response.result?.status};unsubscribeAt=Date.now();}
        return response.result;
      };
      const reloader=new ThreadCapacityReloader({acquire:async()=>({
        host:'local',threadId:id,model:'gpt-6-astra',exclusive:true,holdsTurnsAndResumes:true,settingsPreserved:true,
        resumeParams:{threadId:id,model:'gpt-6-astra',modelProvider:'context_lens_probe',cwd:directory,approvalPolicy:'never',sandbox:'read-only',
          config:{model_context_window:512000,model_auto_compact_token_limit:480000,model_auto_compact_token_limit_scope:'total',model_reasoning_effort:'low'}},
        check:async()=>({host:'local',threadId:id,model:'gpt-6-astra',idle:true,exclusive:true,holdsTurnsAndResumes:true}),
        request,release:async()=>{},
      })});
      const reload=await reloader.reloadThread({host:'local',threadId:id,model:'gpt-6-astra',
        config:{model_context_window:768000,model_auto_compact_token_limit:700000,model_auto_compact_token_limit_scope:'total'}},
        {onPhase:phase=>{
          phases.push(phase);
          if(phase==='waiting-for-unload')console.log(JSON.stringify({phase:'waiting-for-isolated-thread-unload',maxWaitSeconds:120}));
          if(phase==='resuming'){report.checks.unloaded=true;report.checks.unloadElapsedMs=Date.now()-unsubscribeAt;}
        }});
      report.checks.reloadController={completed:true,phases};
      report.checks.resumeUnloadedWithConfig={accepted:true,sameThread:reload.threadId===id};
      if(controlId)report.checks.controlStillLoaded=(await rpc('thread/loaded/list',{})).result?.data?.includes(controlId)===true;
      report.checks.afterUnloadedResume=await localTestTurn(id);
      if(controlId)report.checks.controlAfter=await localTestTurn(controlId);
      if(naturalResume) {
        async function unloadTestThread() {
          const released=await request('thread/unsubscribe',{threadId:id});
          if(released.status!=='unsubscribed')throw Error('Natural resume: release unconfirmed');
          const deadline=Date.now()+120000;
          while(await threadIsLoaded(request,id)){
            if(Date.now()>=deadline)throw Error('Natural resume: still loaded');
            await new Promise(done=>setTimeout(done,250));
          }
        }
        await unloadTestThread();
        const hostParams={threadId:id,excludeTurns:true};
        const restored=await request('thread/resume',hostParams);
        if(restored.thread?.id!==id||restored.modelProvider!=='context_lens_probe')throw Error('Natural resume lost expected local test provider/identity');
        aliases.set(id,'A-natural');
        await localTestTurn(id);
        await unloadTestThread();
        const {thread:metadata}=await request('thread/read',{threadId:id,includeTurns:false});
        if(!metadata.path || metadata.id!==id)throw Error('Test thread metadata unavailable');
        const identity={threadId:id,host:'local',model:restored.model,threadMetadata:{id:metadata.id,path:metadata.path}};
        const model={slug:'gpt-6-astra',context_window:272000,max_context_window:872000,effective_context_window_percent:95};
        const target=capacityRequest({...identity,used:0,capacity:258400},model,768000);
        const nativeParams={...hostParams,path:restored.thread.path,history:null,model:null};
        if(explicitExpansion){
          const startRecords=await observedTurnWindows(join(probeHome,'sessions'));
          const baseline=startRecords.find(item=>turnLabels.get(item.turnId)==='A-natural');
          if(baseline?.window!==258400 || !controlId)throw Error('No independent baseline and control');
          // Completed local turns provide the same native usage fields as the sidebar.
          // The older missing-key probe can only observe the turn-start window.
          const measured=windows.findLast(value=>value.threadId===id && value.turnId===baseline.turnId);
          if(fixture && (measured?.window!==baseline.window || !Number.isSafeInteger(measured.used)))
            throw Error('No native usage for the selected conversation');
          const reading={...identity,modelProvider:restored.modelProvider,capacity:baseline.window,used:measured?.used??10000};
          const plan=capacityRequest(reading,model,512000);
          const result=await resumeWithRequestedExpansion(nativeParams,{plan,model,host:'local',
            getSnapshot:()=>reading,isCurrent:()=>true,
            readThread:query=>request('thread/read',query),resume:params=>request('thread/resume',params)});
          if(result.state!=='awaiting-observation')throw Error('Explicit expansion was not accepted: '+result.state);
          aliases.set(id,'A-512k');await localTestTurn(id);
          aliases.set(controlId,'B-after-512k');await localTestTurn(controlId);
          if(fixture)await checkResumedCompaction(id,512000,486400,true);
          await unloadTestThread();
        }
        const reapplied=await request('thread/resume',resumeWithCapacity(nativeParams,target,identity));
        if(reapplied.thread?.id!==id||reapplied.modelProvider!=='context_lens_probe')throw Error('Unexpected restored identity');
        aliases.set(id,'A-reapplied');
        await localTestTurn(id);
        if(controlId){aliases.set(controlId,'B-after-reapply');await localTestTurn(controlId);}
        if(fixture && explicitExpansion)await checkResumedCompaction(id,768000,729600,false);
        if(coldResume){
          if(!controlId)throw Error('Missing control chat');
          const file=join(directory,'fixture-sidebar-targets.json');
          await writeFile(file,JSON.stringify({[targetPreferenceKey(id,model.slug)]:'768000'}));
          await stopServer();
          startServer();
          await request('initialize',{clientInfo:{name:'context-lens-cold-resume',version:'1'},capabilities:{experimentalApi:true}});
          child.stdin.write('{"method":"initialized"}\n');
          const persisted=JSON.parse(await readFile(file,'utf8'));
          const restores=[[controlId,'B-cold'],[id,'A-cold']];
          if(fixture)restores.push([id,'A-default']);
          for(const [threadId,label] of restores){
            if(label==='A-default'){
              persisted[targetPreferenceKey(id,model.slug)]=String(model.context_window);
              await unloadTestThread();
            }
            if(await threadIsLoaded(request,threadId))throw Error('Cold chat already loaded');
            const {thread}=await request('thread/read',{threadId,includeTurns:false});
            const params={threadId,excludeTurns:true,path:thread.path};
            // Input belongs entirely to this synthetic test. Desktop integration
            // must supply its own independently verified usage and model snapshot.
            const measured=windows.findLast(value=>value.threadId===threadId);
            if(fixture && (!Number.isSafeInteger(measured?.window) || !Number.isSafeInteger(measured?.used)))
              throw Error('No native usage available for the cold-resume fixture');
            const snapshot={threadId,host:'local',model:model.slug,modelProvider:'context_lens_probe',
              used:measured?.used??10000,capacity:measured?.window??258400};
            const next=resumeWithSavedTarget(params,{snapshot,model,threadMetadata:thread,readPreference:key=>persisted[key]});
            if((next!==params)!==(label==='A-cold'))throw Error('Wrong saved target selection');
            const result=await request('thread/resume',next);
            if(result.thread?.id!==threadId || result.model!==model.slug || result.modelProvider!=='context_lens_probe')throw Error('Cold resume identity mismatch');
            aliases.set(threadId,label);await localTestTurn(threadId);
          }
        }
      }
    }
    const globalConfig=await rpc('config/read',{includeLayers:false});
    if(fixture && (!globalConfig.result?.config || globalConfig.error))throw Error('Global config could not be verified');
    report.checks.globalContextConfig=globalConfig.result?.config?.model_context_window??null;
  }
  report.notificationMethods=[...new Set(notifications)];
  report.taskStartedWindows=localTurn?(await observedTurnWindows(join(probeHome,'sessions'))).map(item=>({thread:turnLabels.get(item.turnId)??'unknown',window:item.window})):[];
  const aWindows=report.taskStartedWindows.filter(item=>item.thread==='A').map(item=>item.window);
  const bWindows=report.taskStartedWindows.filter(item=>item.thread==='B').map(item=>item.window);
  report.windowEffectVerified=aWindows.length===4&&aWindows.slice(0,3).every(value=>value===486400)&&aWindows[3]===729600;
  report.perThreadIsolationVerified=report.windowEffectVerified&&report.checks.controlStillLoaded===true&&bWindows.length===2&&bWindows.every(value=>value===258400);
  report.compactionEffectVerified=report.resumedCompaction?.length===2;
  if(explicitExpansion){
    const readings=label=>report.taskStartedWindows.filter(row=>row.thread===label).map(row=>row.window);
    report.explicitExpansion={requested:512000,before:readings('A-natural'),after:readings('A-512k'),control:readings('B-after-512k')};
    const {before,after,control}=report.explicitExpansion;
    if(before.length!==1 || before[0]!==258400 || after.length!==1 || after[0]!==486400 ||
       control.length!==1 || control[0]!==258400 || report.checks.globalContextConfig!==null)
      throw Error('Explicit expansion did not produce the target window and isolated control');
  }
  if(naturalResume){
    const rows=report.taskStartedWindows.filter(row=>row.thread==='A-natural');
    if(rows.length!==1||!Number.isSafeInteger(rows[0].window))throw Error('Missing fresh natural resume observation');
    report.naturalResume={observedEffectiveWindow:rows[0].window,retainedExpandedWindow:rows[0].window===729600};
    report.naturalResume.withTarget=report.taskStartedWindows.find(row=>row.thread==='A-reapplied')?.window??null;
    report.naturalResume.otherChat=report.taskStartedWindows.find(row=>row.thread==='B-after-reapply')?.window??null;
    if(report.naturalResume.withTarget!==729600||report.naturalResume.otherChat!==258400)throw Error('Reapplication or control window did not match');
  }
  if(coldResume){
    const observed=label=>report.taskStartedWindows.filter(row=>row.thread===label).map(row=>row.window);
    const target=observed('A-cold'), control=observed('B-cold');
    report.coldResume={target,control,globalWindow:report.checks.globalContextConfig};
    if(fixture){
      const restored=observed('A-default');
      if(restored.length!==1 || restored[0]!==report.naturalResume.observedEffectiveWindow)
        throw Error('Returning to the default tier did not restore the model default.');
      report.coldResume.restoredDefault=restored[0];
    }
    if(target.length!==1 || target[0]!==729600 || control.length!==1 || control[0]!==258400 ||
       report.checks.globalContextConfig!==null)throw Error('Cold resume did not preserve per-chat isolation');
  }
}
try{
  const init=await rpc('initialize',{clientInfo:{name:'context-lens-capacity-probe',version:'0.1.0'},capabilities:{experimentalApi:true}});
  report.checks.initialize=outcome(init);if(init.error)throw Error('Initialization rejected.');
  report.server=init.result?.userAgent?.match(/\d+\.\d+\.\d+(?:[-.a-z0-9]+)?/i)?.[0];
  child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  if(loadedWindow){
    const {verifyLoadedWindow}=await import('../experiments/desktop-context-window/verify-loaded-window.mjs');
    if(desktopArgs){
      const readiness=await rpc('windowsSandbox/readiness',null);
      report.checks.windowsSandboxReadiness=readiness.result?.status ?? outcome(readiness);
      if(readiness.result?.status==='ready'){
        const command=join(env.SystemRoot??env.WINDIR,'System32','cmd.exe');
        const readOnly={cwd:directory,sandboxPolicy:{type:'readOnly'},timeoutMs:5000};
        const echo=await rpc('command/exec',{...readOnly,command:[command,'/d','/c','echo ContextLensSandbox']});
        report.checks.readOnlyCommand=echo.error?outcome(echo):
          {accepted:true,matched:echo.result?.exitCode===0 && echo.result.stdout.trim()==='ContextLensSandbox'};
        if(report.checks.readOnlyCommand.matched){
          const marker='lens-readonly-test.txt';
          const write=await rpc('command/exec',{...readOnly,command:[command,'/d','/c','echo fixture>'+marker]});
          report.checks.readOnlyWriteDenied=Boolean((write.error || write.result?.exitCode!==0) && !(await readdir(directory)).includes(marker));
        }
      }
    }
    report.loadedWindow={expectation:loadedWindow,desktopTiers,browserSlider,desktopCliArguments:desktopArgs,measurements:[]};
    await verifyLoadedWindow({rpc,directory,probeHome,completed,observedTurnWindows,fixture,windows,report:report.loadedWindow});
  }else{
    await verifyResume();
  }
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
  await stopServer();for(const item of pending.values())clearTimeout(item.timer);
  if(fixture){report.fixtureRequestCount=fixture.samples.length;await fixture.close();}
  await writeFile(join(directory,'stderr.txt'),stderr);
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(resolve('.research','capacity-probe-latest.json'),JSON.stringify({directory,report},null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
