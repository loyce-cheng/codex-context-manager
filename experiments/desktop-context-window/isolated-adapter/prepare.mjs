import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,realpath,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {startCompactionFixture} from '../../../scripts/compaction-provider-fixture.mjs';

const [dir,binary] = process.argv.slice(2);
const research = await realpath(fileURLToPath(new URL('../../../.research/',import.meta.url)));
if (dirname(resolve(dir)) !== research || !/^desktop-host-[0-9a-f-]{36}$/i.test(basename(dir)) ||
    await realpath(dir) !== resolve(dir)) throw Error('Expected a new isolated profile');
const home = join(dir,'home'), model = 'gpt-6-astra', provider = 'context_lens_probe';
if (await realpath(process.env.CODEX_HOME) !== home) throw Error('Wrong fixture home');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(SystemRoot|WINDIR|COMSPEC|PATH|PATHEXT|TEMP|TMP|ProgramFiles|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(key)));
Object.assign(env,{CODEX_HOME:home,CODEX_ELECTRON_USER_DATA_PATH:join(dir,'electron'),
  USERPROFILE:home,APPDATA:join(home,'AppData','Roaming'),LOCALAPPDATA:join(home,'AppData','Local'),NO_PROXY:'127.0.0.1'});

// One client at a time. Closing its backend before the next client connects
// gives the following resume a genuinely unloaded synthetic conversation.
async function withClient(executable, action) {
  const child = spawn(executable,['app-server'],{cwd:dir,env,stdio:['pipe','pipe','ignore'],windowsHide:true});
  const exited = once(child,'close');
  const frames = createInterface({input:child.stdout});
  const pending = new Map(), turns = new Map(), usage = new Map();
  let sequence = 0;
  frames.on('line',line=>{
    const msg = JSON.parse(line);
    if (pending.has(msg.id)) {
      const {done,fail} = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) fail(Error('Fixture RPC rejected')); else done(msg.result);
    }
    if (msg.method === 'thread/tokenUsage/updated') usage.set(msg.params.turnId,msg.params);
    if (msg.method === 'turn/completed') turns.set(msg.params.turn.id,msg.params.turn.status);
  });
  child.stdin.on('error',()=>{});
  function rpc(method,params) {
    const id = ++sequence;
    return new Promise((done,fail)=>{
      pending.set(id,{done,fail});
      child.stdin.write(JSON.stringify({id,method,params})+'\n');
    });
  }
  async function turn(threadId) {
    const {turn:{id}} = await rpc('turn/start',{threadId,input:[{type:'text',text:'Synthetic local fixture. No tools.'}]});
    while (!turns.has(id) && child.exitCode === null && child.signalCode === null) await delay(40);
    const value = usage.get(id);
    if (turns.get(id) !== 'completed' || value?.threadId !== threadId) throw Error('Missing completed fixture turn');
    return {capacity:value.tokenUsage.modelContextWindow,used:value.tokenUsage.last.totalTokens};
  }
  try {
    const deadline = new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture client timeout')),25000);timer.unref();});
    return await Promise.race([deadline,exited.then(()=>{throw Error('Fixture backend exited');}),(async()=>{
      await rpc('initialize',{clientInfo:{name:'context-lens-fixture',version:'1'},capabilities:{experimentalApi:true}});
      child.stdin.write('{"method":"initialized"}\n');
      return action(rpc,turn);
    })()]);
  } finally {
    child.stdin.end();
    await Promise.race([exited,delay(3000,undefined,{ref:false})]);
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
    for (const {fail} of pending.values()) fail(Error('Fixture client closed'));
    frames.close();
  }
}

const fixture = await startCompactionFixture();
try {
  await writeFile(join(home,'config.toml'),[
    'model = "'+model+'"','model_provider = "'+provider+'"','[analytics]','enabled = false',
    '[model_providers.'+provider+']','name = "Context Lens synthetic fixture"','wire_api = "responses"',
    'base_url = '+JSON.stringify(fixture.url),'requires_openai_auth = false','request_max_retries = 0','stream_max_retries = 0'
  ].join('\n')+'\n',{flag:'wx'});
  const [target,control] = await withClient(binary,async(rpc,turn)=>{
    const values=[];
    for (const label of ['Target','Control']) {
      const {thread} = await rpc('thread/start',{model,modelProvider:provider,cwd:dir,
        ephemeral:false,approvalPolicy:'never',sandbox:'read-only'});
      const reading = await turn(thread.id);
      if (reading.capacity !== 258400) throw Error('Unexpected default capacity');
      await rpc('thread/name/set',{threadId:thread.id,name:'Context Lens fixture '+label});
      values.push({threadId:thread.id,host:'local',model,modelProvider:provider,...reading});
    }
    return values;
  });
  const {thread} = await withClient(binary,rpc=>rpc('thread/read',{threadId:target.threadId,includeTurns:false}));
  if (thread.status?.type !== 'notLoaded' || thread.id !== target.threadId || thread.model !== model ||
      thread.modelProvider !== provider || thread.ephemeral !== false ||
      !resolve(thread.path).startsWith(join(home,'sessions')+'\\')) throw Error('Unexpected fixture metadata');
  const threadMetadata = {id:thread.id,status:thread.status,model,modelProvider:provider,ephemeral:false,path:thread.path};
  const plan = {binary,seed:{snapshot:target,threadMetadata}};
  await writeFile(join(dir,'adapter-plan.json'),JSON.stringify(plan),{flag:'wx'});
  const measured = await withClient(join(dir,'codex.exe'),async(rpc,turn)=>{
    const windows=[];
    for (const item of [control,target]) {
      const restored = await rpc('thread/resume',{threadId:item.threadId,excludeTurns:true});
      if (restored.thread?.id !== item.threadId) throw Error('Unexpected resumed identity');
      windows.push((await turn(item.threadId)).capacity);
    }
    const {config} = await rpc('config/read',{includeLayers:false});
    if (config.model_context_window != null) throw Error('Global capacity changed');
    return windows;
  });
  const events = (await readFile(join(dir,'adapter-events.txt'),'utf8')).trim().split(/\r?\n/);
  if (measured[0] !== 258400 || measured[1] !== 486400 || events.filter(v=>v==='target-enriched').length !== 1 ||
      !events.includes('target-turn-486400'))
    throw Error('Adapter did not produce isolated target and control measurements');
  await writeFile(join(dir,'fixture-ready.json'),JSON.stringify({control:measured[0],target:measured[1],targetId:target.threadId,eventsBeforeDesktop:events.length}),{flag:'wx'});
  await delay(420000);
} catch(error) {
  await writeFile(join(dir,'fixture-error.txt'),error.message);
  process.exitCode=1;
} finally {await fixture.close();}
