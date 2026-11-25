import { readdir, open, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { FollowRegistry, parseDesktopLine, FOLLOW_MESSAGES } from '../core/follow.mjs';
import { LocalCodexSource } from './local-codex.mjs';
import { VERSION } from '../core/context.mjs';

const LOG=/^codex-desktop-([0-9a-f-]{36})-\d+-t\d+-i\d+-\d+-\d+\.log$/i;
async function guard(handle,offset){const b=Buffer.alloc(Math.min(64,offset));const r=await handle.read(b,0,b.length,offset-b.length);return b.subarray(0,r.bytesRead);}
export function logDates(timestamp){
  const today=new Date(timestamp), yesterday=new Date(timestamp);
  yesterday.setDate(today.getDate()-1);
  const local=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  return new Set([local(today),local(yesterday),today.toISOString().slice(0,10),new Date(timestamp-86400000).toISOString().slice(0,10)]);
}
function compareLogEvents(a,b){
  return a.at-b.at || Number(b.type==='window')-Number(a.type==='window');
}
async function logStat(handle){
  const s=await handle.stat({bigint:true});
  if(s.size>BigInt(Number.MAX_SAFE_INTEGER))throw Error('log-size-unsupported');
  return {ino:s.ino,size:Number(s.size),mtimeNs:s.mtimeNs,mtimeMs:Number(s.mtimeMs)};
}
/** Incremental, bounded reader. Any gap invalidates all window selections before recovery. */
export class DesktopLogTail {
  constructor({root=join(process.env.LOCALAPPDATA??'', 'Codex','Logs'),now=Date.now,maxBytes=2*1024*1024}={}){this.root=root;this.now=now;this.maxBytes=maxBytes;this.cursors=new Map();this.ready=false;}
  async files(dates=logDates(this.now())){
    await stat(this.root);const out=[];
    for(const date of dates){
      const dir=join(this.root,...date.split('-'));let entries;
      try{entries=await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')continue;throw e;}
      for(const e of entries){const m=LOG.exec(e.name);if(e.isFile()&&m)out.push({path:join(dir,e.name),sessionId:m[1]});}
    }
    if(out.length>256)throw new Error('too-many-log-files');return out;
  }
  async baseline(){
    const next=new Map();for(const f of await this.files()){const h=await open(f.path,'r');try{const s=await logStat(h);next.set(f.path,{offset:s.size,ino:s.ino,partial:'',decoder:new StringDecoder('utf8'),guard:await guard(h,s.size),mtime:s.mtimeNs});}finally{await h.close();}}
    this.cursors=next;this.ready=true;this.lastPollAt=this.now();
  }
  async poll(){
    if(!this.ready){await this.baseline();return {events:[],recovered:true};}
    const now=this.now();
    if(now<this.lastPollAt || now-this.lastPollAt>86400000){this.ready=false;throw Error('log-rotation-gap');}
    const dates=logDates(now);
    const directories=new Set([...dates].map(day=>join(this.root,...day.split('-'))));
    const events=[],files=await this.files(dates),present=new Set(files.map(f=>f.path));let bytes=0;
    // Missing/replaced files can contain an unseen route change. Never carry their state forward.
    for(const path of this.cursors.keys()){
      if(present.has(path))continue;
      if(directories.has(dirname(path))){this.ready=false;throw new Error('log-rotation-gap');}
      files.push({path,sessionId:LOG.exec(basename(path))[1],outside:true});
    }
    if(files.length>256){this.ready=false;throw Error('too-many-log-files');}
    for(const f of files){
      const h=await open(f.path,'r');try{
        const s=await logStat(h);let c=this.cursors.get(f.path);
        if(!c){c={offset:0,ino:s.ino,partial:'',decoder:new StringDecoder('utf8'),guard:Buffer.alloc(0),mtime:s.mtimeNs};this.cursors.set(f.path,c);}
        if(s.ino!==c.ino||s.size<c.offset||(bytes+=s.size-c.offset)>this.maxBytes){this.ready=false;throw new Error('log-read-gap');}
        if(s.mtimeNs!==c.mtime&&!c.guard.equals(await guard(h,c.offset))){this.ready=false;throw new Error('log-rewrite-gap');}
        const b=Buffer.alloc(s.size-c.offset);
        if(!b.length){
          // A cursor at baseline has no buffered bytes; after a read only LF
          // proves both a complete UTF-8 sequence and a complete line.
          if(f.outside && c.atLineEnd!==false && this.now()-s.mtimeMs>86400000)this.cursors.delete(f.path);
          continue;
        }
        const {bytesRead}=await h.read(b,0,b.length,c.offset);c.offset+=bytesRead;
        if(bytesRead)c.atLineEnd=b[bytesRead-1]===10;
        c.guard=await guard(h,c.offset);c.mtime=s.mtimeNs;
        const lines=(c.partial+c.decoder.write(b.subarray(0,bytesRead))).split('\n');c.partial=lines.pop();
        if(c.partial.length>65536){this.ready=false;throw new Error('oversized-log-line');}
        for(const line of lines){if(line.length>65536){this.ready=false;throw new Error('oversized-log-line');}events.push(...parseDesktopLine(line.replace(/\r$/,''),f.sessionId));}
      }finally{await h.close();}
    }
    // An owner-sync entry may precede that window's first metadata line within the same read batch.
    this.lastPollAt=now;
    events.sort(compareLogEvents);return {events,recovered:false};
  }
}

export class DesktopFollower {
  constructor({source=new LocalCodexSource(),tail=new DesktopLogTail(),scope='new',registry=new FollowRegistry({scope}),intervalMs=500}={}){
    this.source=source;this.tail=tail;this.registry=registry;this.intervalMs=intervalMs;this.timer=null;this.stopped=true;this.work=Promise.resolve();
  }
  async start(){if(!this.stopped)return;this.stopped=false;await this.tick();this.schedule();}
  schedule(){if(!this.stopped){this.timer=setTimeout(()=>{this.work=this.tick().finally(()=>this.schedule());},this.intervalMs);this.timer.unref?.();}}
  async tick(){try{const {events,recovered}=await this.tail.poll();if(recovered)this.registry.recover();this.registry.ingest(events);if(!this.registry.healthy)this.tail.ready=false;}catch{this.tail.ready=false;this.registry.invalidate();}}
  async close(){this.stopped=true;clearTimeout(this.timer);await this.work;}
  async read(){
    const before=this.registry.view(),windows=[];
    for(const w of before.windows){
      if(w.state!=='following'){windows.push({...w,snapshot:null});continue;}
      try{const s=await this.source.snapshot(w.threadId);if(s.threadId!==w.threadId)throw new Error('identity');windows.push({...w,snapshot:s});}
      catch{windows.push({...w,state:'snapshot-unavailable',threadId:null,snapshot:null,message:FOLLOW_MESSAGES['snapshot-unavailable']});}
    }
    // Use a second view after I/O: navigation, expiration and disconnection invalidate late snapshots.
    const after=this.registry.view();
    const safe=windows.filter(w=>{const next=after.windows.find(n=>n.key===w.key);return next&&next.threadId===before.windows.find(n=>n.key===w.key)?.threadId&&next.state===before.windows.find(n=>n.key===w.key)?.state&&next.confirmedAt===w.confirmedAt;});
    const finalWindows=after.windows.map(w=>safe.find(n=>n.key===w.key)??{...w,state:w.state==='following'?'waiting':w.state,threadId:null,snapshot:null,message:w.state==='following'?FOLLOW_MESSAGES.waiting:w.message});
    const selected=finalWindows.find(w=>w.key===after.selectedWindowKey);
    const following=after.state==='following'&&selected?.state==='following';
    return {version:VERSION,fileMode:true,generatedAt:Date.now(),snapshot:following?selected.snapshot:null,threadId:following?selected.threadId:null,
      capabilities:{...this.source.capabilities(),activeThreadBinding:true,bindingMode:'experimental-'+after.mode},
      follow:{...after,threadId:following?selected.threadId:null,state:after.state==='following'?(selected?.state??'waiting'):after.state,message:after.state==='following'?(selected?.message??FOLLOW_MESSAGES.waiting):after.message,windows:finalWindows}};
  }
}
