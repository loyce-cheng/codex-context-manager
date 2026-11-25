import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,rm,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FollowRegistry,parseDesktopLine} from '../src/core/follow.mjs';
import {DesktopLogTail,DesktopFollower,logDates} from '../src/adapters/desktop-follow.mjs';
import {selectFollowEnvelope} from '../src/core/context.mjs';
import {createService} from '../src/server/service.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',S='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',T='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const time=Date.parse('2026-10-30T00:00:00Z');
const window=(at=time,id=1,focused=true,sessionId=S,rendererId=id)=>({type:'window',sessionId,at,windowId:id,rendererId,focused,visible:true});
const route=(id=A,at=time,win=1,sessionId=S,rendererId=win)=>({type:'route',sessionId,at,windowId:win,rendererId,threadId:id});
const created=(id=A,at=time)=>({type:'created',sessionId:S,at,threadId:id});
function registry(){let now=time;const r=new FollowRegistry({startedAt:time,now:()=>now,routeTtlMs:1000,windowTtlMs:500});return{r,setNow:n=>now=n};}
function line(label,fields,at=time){return `${new Date(at).toISOString()} info [electron-message-handler] ${label} ${fields}\n`;}
const meta='rendererWindowId=1 rendererWebContentsId=1 rendererWindowAppearance=primary rendererWindowVisible=true rendererWindowFocused=true';

test('tail includes both local and UTC calendar dates at local midnight',()=>{
  const instant=new Date(2026,10,22,0,5);
  const days=logDates(instant.getTime());
  assert.ok(days.has('2026-11-22') && days.has('2026-11-21'));
  assert.ok(days.has(instant.toISOString().slice(0,10)));
});

test('equal-time window records retain their order within the batch',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lens-order-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'2026','10','30');
  await mkdir(dir,{recursive:true});
  const f=join(dir,`codex-desktop-${S}-123-t0-i1-000000-0.log`);
  await writeFile(f,'');
  const tail=new DesktopLogTail({root,now:()=>time});
  await tail.poll();
  await appendFile(f,line('Conversation created',`conversationId=${A} threadId=${A} ${meta}`)+
    line('Conversation created',`conversationId=${B} threadId=${B} ${meta.replace('Focused=true','Focused=false')}`));
  const {events}=await tail.poll();
  assert.deepEqual(events.map(e=>e.type),['window','window','created','created']);
  assert.deepEqual(events.slice(0,2).map(e=>e.focused),[true,false]);
});

test('an idle fully read cursor ages out with its date directory without losing healthy state',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lens-midnight-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  let now=Date.UTC(2026,10,22,12);
  const dir=join(root,'2026','11','21');
  await mkdir(dir,{recursive:true});
  const f=join(dir,`codex-desktop-${S}-123-t0-i1-000000-0.log`);
  await writeFile(f,'');await utimes(f,new Date(now-86400000),new Date(now-86400000));
  const tail=new DesktopLogTail({root,now:()=>now});
  await tail.poll();assert.equal(tail.cursors.size,1);
  for(let i=0;i<3;i++){now+=86400000;assert.deepEqual(await tail.poll(),{events:[],recovered:false});}
  assert.equal(tail.cursors.size,0);
});

test('a rotated UTF-8 cursor stays enrolled until the split character and line finish',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lens-utf8-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let now=Date.UTC(2026,10,22,12);
  const dir=join(root,'2026','11','21');await mkdir(dir,{recursive:true});
  const f=join(dir,`codex-desktop-${S}-123-t0-i1-000000-0.log`);
  await writeFile(f,'');
  const tail=new DesktopLogTail({root,now:()=>now});await tail.poll();
  const bytes=Buffer.from('中\n');
  await appendFile(f,bytes.subarray(0,1));await tail.poll();
  await utimes(f,new Date(now-86400000),new Date(now-86400000));
  now+=86400000;await tail.poll();await tail.poll();
  assert.equal(tail.cursors.size,1);
  await appendFile(f,bytes.subarray(1));await tail.poll();
  await utimes(f,new Date(now-86400001),new Date(now-86400001));
  await tail.poll();assert.equal(tail.cursors.size,0);
});

test('parser enrolls creation separately and uses page route instead of browser identity',()=>{
  const events=parseDesktopLine(line('Conversation created',`conversationId=${A} threadId=${A} ${meta}`),S);assert.deepEqual(events.map(e=>e.type),['window','created']);
  const e=parseDesktopLine(line('IAB_LIFECYCLE received browser sidebar owner sync',`conversationId=${B} windowId=1 originWebContentsId=1 ownerRoutePath="/local/${A}?hostId=local"`),S);assert.equal(e[0].threadId,A);
  assert.equal(parseDesktopLine(line('Reasoning summary item completed',`threadId=${B} ${meta}`),S).some(e=>e.type==='route'||e.type==='created'),false);
  assert.equal(parseDesktopLine(line('Conversation created',`conversationId=${A} threadId=${A} threadId=${B} ${meta}`),S).length,0);
});
test('manual sidebar routes and tool navigation routes select the same local chat',()=>{
  for(const path of [`/local/${A}`,`/local/${A}?hostId=local`]){
    for(const value of [path,JSON.stringify(path)]){
      const events=parseDesktopLine(line('IAB_LIFECYCLE received browser sidebar owner sync',`conversationId=${B} originWebContentsId=1 windowId=1 ownerRoutePath=${value}`),S);
      assert.equal(events.find(e=>e.type==='route')?.threadId,A);
    }
  }
  const r=new FollowRegistry({scope:'active',startedAt:time,now:()=>time+2});r.ingest([window()]);
  for(const [i,id] of [A,B,A].entries()){
    r.ingest(parseDesktopLine(line('IAB_LIFECYCLE received browser sidebar owner sync',`originWebContentsId=1 windowId=1 ownerRoutePath=/local/${id}`,time+i),S));
    assert.equal(r.view().state,'following');assert.equal(r.view().threadId,id);
  }
});
test('optional local-host query does not allow remote, malformed or normalized paths',()=>{
  for(const path of [`/local/${A}?hostId=remote`,`/local/${A}?hostId=local&hostId=remote`,`/local/${A}?hostId=`,`/local/${A}?other=local`,`/local/${A}?`,`/local/${A}#x`,`/local/${A}?hostId=local#x`,`/local/${A}/`,`/local/../local/${A}`,`/local/${A}/../${B}`,`/local\\${A}`,`//local/${A}`,`https://example.com/local/${A}`]){
    const [e]=parseDesktopLine(line('IAB_LIFECYCLE received browser sidebar owner sync',`originWebContentsId=1 windowId=1 ownerRoutePath=${JSON.stringify(path)}`),S);
    assert.equal(e.threadId,null,path);
  }
});
test('historical routes cannot enroll, and creation alone cannot select',()=>{
  const {r}=registry();r.ingest([window(),route()]);assert.equal(r.view().state,'historical');
  r.ingest([created(B)]);assert.equal(r.view().state,'historical');r.ingest([route(B)]);assert.equal(r.view().threadId,B);
});
test('active mode follows existing chats only after fresh verified page routes, never background activity',()=>{
  let now=time;const r=new FollowRegistry({scope:'active',startedAt:time,now:()=>now});
  r.ingest([route(A,time-1),window()]);assert.equal(r.view().threadId,null);
  r.ingest([created(B),window(time)]);assert.equal(r.view().threadId,null);
  r.ingest([route(A)]);assert.equal(r.view().threadId,A);assert.equal(r.view().scope,'selected-local');
  now++;r.ingest([window(now),created(B,now)]);assert.equal(r.view().threadId,A);
  r.ingest([route(B,now)]);assert.equal(r.view().threadId,B);
  now+=60001;r.ingest([window(now)]);assert.equal(r.view().threadId,B);
  assert.equal(r.view().windows[0].confirmedAt,time+1,'window observations must not masquerade as route confirmations');
  now+=25001;assert.equal(r.view().threadId,null,'a stale primary window still pauses continuous following');
});

test('continuous routes survive 60 seconds, switch only on routes, and clear on malformed navigation',async()=>{
  let now=time;const r=new FollowRegistry({scope:'active',startedAt:time,now:()=>now});
  r.ingest([window(),route()]);
  for(let seconds=10;seconds<=120;seconds+=10){now=time+seconds*1000;r.ingest([window(now),created(B,now)]);assert.equal(r.view().threadId,A);}
  assert.equal(r.view().selectionPolicy,'continuous-log');assert.equal(r.view().routeTtlMs,null);
  r.ingest([route(B,now)]);assert.equal(r.view().threadId,B);
  r.ingest(parseDesktopLine(line('IAB_LIFECYCLE received browser sidebar owner sync',`windowId=1 windowId=2 originWebContentsId=1 ownerRoutePath=/local/${A}`,now),S));
  assert.equal(r.view().threadId,null);assert.equal(r.view().state,'unsupported');
  r.recover();r.ingest([window(now)]);assert.equal(r.view().threadId,null);
  r.ingest([route(A,now)]);assert.equal(r.view().threadId,A);
});

test('unidentifiable route records invalidate all selections and require a new baseline',async()=>{
  for(const fields of [`originWebContentsId=1 ownerRoutePath=/local/${A}`,`windowId=x originWebContentsId=1 ownerRoutePath=/local/${A}`,`windowId=1 originWebContentsId=1 ownerRoutePath=/local/${A} ownerRoutePath=/local/${B}`]){
    const {r}=registry();r.ingest([created(),window(),route()]);
    const tail={ready:true,poll:async()=>({events:parseDesktopLine(line('IAB_LIFECYCLE received browser sidebar owner sync',fields),S),recovered:false})};
    await new DesktopFollower({registry:r,tail}).tick();assert.equal(tail.ready,false);assert.equal(r.view().threadId,null);
  }
});
test('active mode cannot enroll a pending route without matching primary metadata',()=>{
  const r=new FollowRegistry({scope:'active',startedAt:time,now:()=>time});
  r.ingest([route(A)]);assert.equal(r.view().registeredCount,0);
  r.ingest([window(time,1,true,S,2)]);assert.equal(r.view().threadId,null);assert.equal(r.view().registeredCount,0);
  r.ingest([window()]);assert.equal(r.view().threadId,A);assert.equal(r.view().registeredCount,1);
});
test('route before metadata is retained only for its verified renderer',()=>{
  const {r}=registry();r.ingest([created(),route()]);assert.equal(r.view().state,'waiting');r.ingest([window()]);assert.equal(r.view().threadId,A);
  r.ingest([window(time,1,true,S,7)]);assert.equal(r.view().threadId,null);
});
test('two windows select by fresh focus, with independent routes and explicit-window results',()=>{
  const {r,setNow}=registry();r.ingest([created(A),created(B),window(),route()]);setNow(time+10);r.ingest([window(time+10,2),route(B,time+10,2)]);
  assert.equal(r.view().threadId,B);assert.equal(r.view().windows.find(w=>w.windowId===1).threadId,A);
  setNow(time+20);r.ingest([window(time+20,1)]);assert.equal(r.view().threadId,A);
  r.ingest([window(time+20,2)]);assert.equal(r.view().state,'ambiguous');assert.equal(r.view().threadId,null);
});
test('a standalone browser can observe the sole visible Codex window without taking its focus',()=>{
  const {r,setNow}=registry();r.ingest([created(),window(time,1,false),route()]);assert.equal(r.view().threadId,A);
  r.ingest([window(time,2,false)]);assert.equal(r.view().threadId,null);
  setNow(time+501);assert.equal(r.view().threadId,null);
});
test('background/window activity cannot extend a route lease; hidden and expired windows clear',()=>{
  const {r,setNow}=registry();r.ingest([created(),window(),route()]);setNow(time+501);assert.equal(r.view().threadId,null);
  r.ingest([window(time+501)]);assert.equal(r.view().threadId,A);setNow(time+1001);r.ingest([window(time+1001)]);assert.equal(r.view().state,'expired');assert.equal(r.view().threadId,null);
  r.ingest([route(A,time+1001),{...window(time+1001),visible:false}]);assert.equal(r.view().threadId,null);
});
test('disconnect/restart discards old selection and retired-session late events',()=>{
  const {r,setNow}=registry();r.ingest([created(),window(),route()]);setNow(time+10);r.invalidate();assert.equal(r.view().state,'unavailable');r.recover();r.ingest([window(),route()]);assert.equal(r.view().threadId,null);
  r.ingest([window(time+10,1,true,T),route(A,time+10,1,T)]);assert.equal(r.view().threadId,A);
  setNow(time+20);r.ingest([window(time+20,1,true,S),route(B,time+20,1,S)]);assert.equal(r.view().threadId,A);
});
test('unsupported routes are explicit invalidation instead of lingering prior percentages',()=>{
  const {r}=registry();r.ingest([created(),window(),route()]);
  for(const path of ['/settings',`/local/${A}?hostId=remote`,`/local/../local/${A}?hostId=local`]){
    const [e]=parseDesktopLine(line('IAB_LIFECYCLE received browser sidebar owner sync',`windowId=1 originWebContentsId=1 ownerRoutePath=${path}`),S);r.ingest([e]);assert.equal(r.view().threadId,null);
  }
});
test('tail ignores historical lines, handles partial UTF-8, new rotated files and truncated gaps',async()=>{
  const root=await mkdtemp(join(tmpdir(),'lens-log-test-')),dir=join(root,'2026','10','30');await mkdir(dir,{recursive:true});
  const f=join(dir,`codex-desktop-${S}-123-t0-i1-000000-0.log`),createdLine=line('Conversation created',`conversationId=${A} threadId=${A} ${meta}`);
  try{
    await writeFile(f,createdLine);const tail=new DesktopLogTail({root,now:()=>time});await tail.poll();assert.equal((await tail.poll()).events.length,0);
    await appendFile(f,createdLine.slice(0,-2));assert.equal((await tail.poll()).events.length,0);await appendFile(f,createdLine.slice(-2));assert.equal((await tail.poll()).events.filter(e=>e.type==='created').length,1);
    const utf=Buffer.from(line('note',`text="你好" ${meta}`)),n=utf.indexOf(Buffer.from('你'))+1;await appendFile(f,utf.subarray(0,n));await tail.poll();await appendFile(f,utf.subarray(n));assert.equal((await tail.poll()).events.length,1);
    await writeFile(join(dir,`codex-desktop-${S}-123-t0-i1-000000-1.log`),createdLine);assert.equal((await tail.poll()).events.filter(e=>e.type==='created').length,1);
    await writeFile(f,'');await assert.rejects(tail.poll(),/gap/);assert.equal(tail.ready,false);await tail.poll();assert.equal((await tail.poll()).events.length,0);
    await appendFile(f,'x'.repeat(65537)+'\n');await assert.rejects(tail.poll(),/oversized/);assert.equal(tail.ready,false);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('tail read failure clears state, recovery requires new signals',async()=>{
  const {r}=registry();r.ingest([created(),window(),route()]);let broken=true;
  const f=new DesktopFollower({registry:r,tail:{poll:async()=>{if(broken)throw new Error('EACCES');return{recovered:true,events:[]};}}});
  await f.tick();assert.equal(r.view().state,'unavailable');broken=false;await f.tick();assert.equal(r.view().state,'waiting');
});
test('navigation during asynchronous snapshot I/O cannot publish the old chat',async()=>{
  const {r,setNow}=registry();r.ingest([created(),window(),route()]);let resolve;const source={capabilities:()=>({}),snapshot:()=>new Promise(r=>resolve=r)};
  const f=new DesktopFollower({registry:r,source});const pending=f.read();setNow(time+1);r.ingest([route(B,time+1)]);resolve({threadId:A});const data=await pending;assert.equal(data.snapshot,null);assert.equal(data.follow.state,'historical');assert.equal(data.follow.windows[0].snapshot,null);
});
test('UI gate rejects stale producer, expired lease and identity mismatch even for a pinned window',()=>{
  const w={key:'w',state:'following',threadId:A,validUntil:time+2000,snapshot:{threadId:A}},data={generatedAt:time,follow:{state:'following',selectedWindowKey:'w',windows:[w]}};
  assert.equal(selectFollowEnvelope(data,null,time+100).threadId,A);assert.equal(selectFollowEnvelope(data,'w',time+2100).snapshot,null);
  assert.equal(selectFollowEnvelope({...data,generatedAt:time-5000},'w',time).snapshot,null);
  assert.equal(selectFollowEnvelope({...data,follow:{...data.follow,windows:[{...w,snapshot:{threadId:B}}]}},null,time).snapshot,null);
});
test('MCP following is explicitly opted in, shared once, and cleaned up',async()=>{
  let starts=0,closes=0;const service=createService({capabilities:()=>({})},{followerFactory:()=>({start:async()=>{starts++;},read:async()=>({follow:{state:'waiting'}}),close:async()=>{closes++;}})});
  await assert.rejects(service.call('read_active_context_snapshot'));
  await assert.rejects(service.call('open_context_monitor',{thread_id:A,follow_new:true}));
  await Promise.all([service.call('open_context_monitor',{follow_new:true}),service.call('open_context_monitor',{follow_new:true})]);assert.equal(starts,1);
  assert.equal((await service.call('read_active_context_snapshot')).structuredContent.follow.state,'waiting');await service.close();assert.equal(closes,1);
});
test('MCP active mode is explicit and cannot silently change an existing watcher scope',async()=>{
  let scope;const service=createService({capabilities:()=>({})},{followerFactory:s=>{scope=s;return{start:async()=>{},read:async()=>({follow:{state:'waiting',scope:'selected-local'}}),close:async()=>{}};}});
  await assert.rejects(service.call('open_context_monitor',{thread_id:A,follow_active:true}));
  await assert.rejects(service.call('open_context_monitor',{follow_new:true,follow_active:true}));
  await assert.rejects(service.call('open_context_monitor',{follow_active:'yes'}));
  await service.call('open_context_monitor',{follow_active:true});assert.equal(scope,'active');
  await assert.rejects(service.call('open_context_monitor',{follow_new:true}));await service.close();
});

test('restored panel explicitly resumes a fresh server once, retaining its chosen scope',async()=>{
  for(const mode of ['active','new']){
    let starts=0,ready=false,scope;
    const service=createService({capabilities:()=>({})},{followerFactory:s=>{scope=s;return{
      start:async()=>{starts++;await new Promise(resolve=>setTimeout(resolve,5));ready=true;},
      read:async()=>{assert(ready);return{snapshot:null,threadId:null,follow:{state:'waiting',scope:s==='active'?'selected-local':'since-monitor-start'}};},
      close:async()=>{},
    };}});
    try{
      await assert.rejects(service.call('read_active_context_snapshot'));
      const results=await Promise.all(Array.from({length:4},()=>service.call('read_active_context_snapshot',{follow_mode:mode})));
      assert.equal(starts,1);assert.equal(scope,mode);
      for(const result of results){assert.equal(result.structuredContent.threadId,null);assert.equal(result.structuredContent.follow.state,'waiting');}
      await service.call('read_active_context_snapshot',{follow_mode:mode});assert.equal(starts,1);
      await assert.rejects(service.call('read_active_context_snapshot',{follow_mode:mode==='active'?'new':'active'}));
      await assert.rejects(service.call('read_active_context_snapshot',{follow_mode:'invalid'}));assert.equal(starts,1);
    }finally{await service.close();}
  }
});

test('failed watcher startup is cleaned up so a later reconnect can retry',async()=>{
  let starts=0,closes=0;
  const service=createService({capabilities:()=>({})},{followerFactory:()=>({
    start:async()=>{if(++starts===1)throw new Error('temporary startup failure');},
    read:async()=>({follow:{state:'waiting'}}),close:async()=>{closes++;},
  })});
  try{
    await assert.rejects(service.call('read_active_context_snapshot',{follow_mode:'active'}),/temporary/);
    assert.equal(closes,1);
    const result=await service.call('read_active_context_snapshot',{follow_mode:'active'});
    assert.equal(result.structuredContent.follow.state,'waiting');assert.equal(starts,2);
  }finally{await service.close();}
  assert.equal(closes,2);
});
