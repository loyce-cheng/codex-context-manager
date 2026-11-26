// Source-only Windows fixture. The runner creates both profiles and seeds the
// selected conversation before the desktop starts. Never select a user chat.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {appendFileSync} from 'node:fs';
import {readFile, realpath} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resumeWithSavedTarget} from '../../../src/control/reload.mjs';

const research = fileURLToPath(new URL('../../../.research/', import.meta.url));
const fixtureModel = {slug:'gpt-6-astra',context_window:272000,max_context_window:872000,effective_context_window_percent:95};
const maxFrame = 128 * 1024;

export function fixtureRequestFilter(seed, event, onInitialize=()=>{}, onEnrich=()=>{}) {
  let available = true;
  return function filter(frame) {
    if (!frame) { available = false; return; } // Oversize frame, identity no longer certain.
    let message;
    try { message = JSON.parse(frame); } catch { available = false; return frame; }
    if (message?.method === 'initialize' && message.id != null) onInitialize(message.id);
    if (message?.method === 'initialized') event('initialized');
    const params = message?.params;
    if (!available || !seed || params?.threadId !== seed.snapshot.threadId) return frame;
    if (message.method === 'thread/read') return frame;
    available = false;
    if (message.method !== 'thread/resume' || message.id == null) return frame;
    // Round-tripping an unfamiliar numeric setting through JS can lose bits.
    // Decline the edit in that case, without changing the original wire bytes.
    let exact=true;
    JSON.parse(frame,(_key,value,source)=>{
      if(typeof value==='number' && (!Number.isSafeInteger(value) || String(value)!==source?.source))exact=false;
      return value;
    });
    if(!exact)return frame;
    const next = resumeWithSavedTarget(params, {
      snapshot:seed.snapshot, threadMetadata:seed.threadMetadata, model:fixtureModel, readPreference:()=>'512000'
    });
    event(next === params ? 'target-preserved' : 'target-enriched');
    if(next !== params) onEnrich(message.id);
    return next === params ? frame : Buffer.from(JSON.stringify({...message,params:next})+'\n');
  };
}

// Count only a new native turn after the matching resume has been accepted.
// Historical token usage included in a resume response is never a receipt.
export function fixtureReceipts(seed,event) {
  let initId, resumeId, resumed=false, turnId, measured=false;
  return {
    initialize(id){initId=id;},
    enrich(id){resumeId=id;},
    frame(bytes){
      if(!bytes || (initId===undefined && resumeId===undefined && !resumed))return bytes;
      let msg;
      try {msg=JSON.parse(bytes);} catch {return bytes;}
      if(initId!==undefined && msg?.id===initId && typeof msg.result?.userAgent==='string'){
        initId=undefined;event('initialize-acknowledged');
      }
      const target=seed?.snapshot;
      if(!target)return bytes;
      if(resumeId!==undefined && msg?.id===resumeId && !msg.method){
        const res=msg.result;
        resumed=res?.thread?.id===target.threadId && res.model===target.model && res.modelProvider===target.modelProvider;
        resumeId=undefined;
      }
      const p=msg?.params;
      if(!resumed || p?.threadId!==target.threadId)return bytes;
      if(msg.method==='turn/started'){
        turnId=p.turn?.id;measured=false;
      }else if(typeof turnId==='string' && msg.method==='thread/tokenUsage/updated' && p.turnId===turnId){
        measured=p.tokenUsage?.modelContextWindow===486400;
      }else if(turnId && msg.method==='turn/completed' && p.turn?.id===turnId){
        if(p.turn.status==='completed' && measured) {event('target-turn-486400');resumed=false;}
        turnId=undefined;
      }
      return bytes;
    }
  };
}

// Keep non-target frames byte-for-byte. Large frames pass straight through
// without accumulating them in memory. A truncated final frame also passes through.
export async function* filterFrames(source, filter) {
  let chunks = [], size = 0, bypass = false;
  for await (const buffer of source) {
    let start = 0;
    while (start < buffer.length) {
      const end = buffer.indexOf(10,start);
      const part = buffer.subarray(start,end < 0 ? buffer.length : end + 1);
      if (!bypass && size + part.length > maxFrame) {
        filter(null);
        yield* chunks;
        chunks = []; size = 0; bypass = true;
      }
      if (bypass) yield part;
      else { chunks.push(part); size += part.length; }
      if (end < 0) break;
      if (!bypass) yield filter(Buffer.concat(chunks,size));
      chunks = []; size = 0; bypass = false; start = end + 1;
    }
  }
  yield* chunks;
}

async function main(dir,args) {
  if (process.platform !== 'win32' || !dir || dirname(resolve(dir)) !== await realpath(research) ||
      !/^desktop-host-[0-9a-f-]{36}$/i.test(basename(dir)) || await realpath(dir) !== resolve(dir) ||
      await realpath(process.env.CODEX_HOME) !== join(dir,'home') ||
      await realpath(process.env.CODEX_ELECTRON_USER_DATA_PATH) !== join(dir,'electron'))
    throw Error('Expected a disposable fixture profile');
  const {binary,seed} = JSON.parse(await readFile(join(dir,'adapter-plan.json'),'utf8'));
  const sessions=join(dir,'home','sessions')+'\\';
  if(seed?.snapshot?.modelProvider!=='context_lens_probe' || seed.snapshot.model!==fixtureModel.slug ||
     !seed.threadMetadata?.path || !(await realpath(seed.threadMetadata.path)).startsWith(sessions))
    throw Error('Expected a locally seeded fixture conversation');
  const packageDir = dirname(dirname(dirname(binary)));
  if (dirname(packageDir).toLowerCase() !== join(process.env.ProgramFiles,'WindowsApps').toLowerCase() ||
      !/^OpenAI\.Codex_\d+\.\d+\.\d+\.\d+_x64__2p2nqsd0c76g0$/i.test(basename(packageDir)) ||
      join(packageDir,'app','resources','codex.exe').toLowerCase() !== binary.toLowerCase())
    throw Error('Expected the packaged official backend');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    /^(SystemRoot|WINDIR|COMSPEC|PATH|PATHEXT|TEMP|TMP|ProgramFiles|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(name)));
  const home = join(dir,'home');
  Object.assign(env,{CODEX_HOME:home,USERPROFILE:home,APPDATA:join(home,'AppData','Roaming'),
    LOCALAPPDATA:join(home,'AppData','Local'),NO_PROXY:'127.0.0.1'});
  const server = args.includes('app-server') && !args.includes('--help');
  const child = spawn(binary,args,{cwd:dir,env,windowsHide:true,stdio:[server?'pipe':'inherit',server?'pipe':'inherit','inherit']});
  const exit = once(child,'close');
  let output;
  if (server) {
    const event = kind => appendFileSync(join(dir,'adapter-events.txt'),kind+'\n');
    event('server-started');
    const receipts=fixtureReceipts(seed,event);
    const filter=fixtureRequestFilter(seed,event,receipts.initialize,receipts.enrich);
    output=pipeline(child.stdout,source=>filterFrames(source,receipts.frame),process.stdout);
    output.catch(()=>{if(child.exitCode===null)child.kill();});
    const input = pipeline(process.stdin,source=>filterFrames(source,filter),child.stdin);
    input.catch(()=>{ if (child.exitCode === null) child.kill(); });
    child.once('exit',()=>process.stdin.destroy());
  }
  const [code] = await exit;
  if (output) await output;
  process.exitCode = code ?? 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv[2],process.argv.slice(3)).catch(()=>{console.error('Isolated fixture adapter failed.');process.exitCode=1;});
