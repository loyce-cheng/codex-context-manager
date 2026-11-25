import { readdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalCodexSource, assertThreadId } from '../../src/adapters/local-codex.mjs';
import { parseOwnerSync, SelectionGate } from './selection.mjs';

function arg(name) { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; }
const threadId = assertThreadId(arg('--only-thread'));
const windowId = Number(arg('--window')), rendererId = Number(arg('--renderer'));
const seconds = Number(arg('--seconds') ?? 60);
if (![windowId, rendererId].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isFinite(seconds) || seconds < 1 || seconds > 180) throw new Error('Specify verified --window, --renderer, --only-thread and --seconds 1..180.');
const root = join(process.env.LOCALAPPDATA, 'Codex', 'Logs');
const cursors = new Map(), source = new LocalCodexSource();
const gate = new SelectionGate({ windowId, rendererId, eligibleIds: [threadId] });
const start = Date.now();
let lastReport = '', fileCount = 0;
async function logFiles() {
  const paths = [];
  // Both dates cover midnight while observing this bounded experiment.
  const dates = new Set([new Date().toISOString().slice(0,10), new Date(Date.now()-86400000).toISOString().slice(0,10)]);
  for (const day of dates) {
    const dir = join(root, ...day.split('-'));
    for (const entry of await readdir(dir, {withFileTypes:true}).catch(() => [])) if (entry.isFile() && /^codex-desktop-.*\.log$/.test(entry.name)) paths.push(join(dir, entry.name));
  }
  return paths;
}
async function poll(initial = false) {
  const events = [];
  for (const path of await logFiles()) {
    const h = await open(path,'r');
    try {
      const s = await h.stat();
      let c = cursors.get(path);
      if (!c) { c = {offset:initial?s.size:0, ino:s.ino, partial:''}; cursors.set(path,c); }
      if (c.ino !== s.ino || s.size < c.offset || s.size-c.offset > 2*1024*1024) {
        c.offset=s.size;c.ino=s.ino;c.partial='';gate.value={state:'unknown',threadId:null};
        console.log(JSON.stringify({state:'unknown',reason:'log-replaced-or-reader-gap'}));continue;
      }
      const b = Buffer.alloc(s.size-c.offset);if(!b.length)continue;
      const {bytesRead} = await h.read(b,0,b.length,c.offset);c.offset+=bytesRead;
      const lines=(c.partial+b.subarray(0,bytesRead).toString('utf8')).split('\n');c.partial=lines.pop();
      if(c.partial.length>16384)c.partial='';
      for(const line of lines){const event=parseOwnerSync(line);if(event&&event.at>=start)events.push(event);}
    } finally { await h.close(); }
  }
  fileCount=cursors.size;
  for(const event of events.sort((a,b)=>a.at-b.at))if(gate.accept(event))await report();
  await report();
}
async function report() {
  const state={...gate.value};
  if(state.state==='following') {
    try { const s=await source.snapshot(state.threadId);state.remainingPercent=s.remainingPercent;state.window=s.displayWindow;state.quality=s.quality;state.snapshotRevision=s.revision; }
    catch { state.state='snapshot-unavailable'; }
  }
  const encoded=JSON.stringify(state);if(encoded===lastReport)return;lastReport=encoded;
  console.log(JSON.stringify({...state,observedAt:new Date().toISOString(),eventLagMs:state.eventAt?Date.now()-state.eventAt:null}));
}
await poll(true);
console.log(JSON.stringify({ready:true,windowId,rendererId,eligibleThreads:1,logFiles:fileCount,seconds,scope:'one-explicitly-verified-new-test-thread'}));
while(Date.now()-start<seconds*1000){await delay(500);await poll();}
console.log(JSON.stringify({finished:true,state:gate.value.state}));
