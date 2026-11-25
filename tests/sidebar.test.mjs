import test from 'node:test';
import assert from 'node:assert/strict';
import { scalarSnapshot, chooseComposer, composerScopes, composerFiber, cachedBindings, RSPACK_PROFILE, RSPACK_4239_PROFILE, RSPACK_1111_PROFILE, capacityPreflight, NativeSource } from '../native-sidebar/src/telemetry.mjs';
import { sidebarBundle } from '../scripts/build-sidebar.mjs';
import vm from 'node:vm';
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const scope = (id, extra={}) => ({ value: { kind:'local', placement:'main', conversationId:id, ...extra } });
const idleValues={threadId:a,host:'local',model:'gpt-6-astra',responseInProgress:false,requestCount:0,pendingRequestKind:null,
  resumeState:'resumed',ephemeral:false,runtimeStatus:{type:'idle'},latestTurnStatus:'completed'};

test('preflight reports bounded scalars and never confuses idle with safe to write',()=>{
  const result=capacityPreflight({...idleValues,history:'private text',runtimeStatus:{type:'idle',extra:'private text'}});
  assert.equal(result.idle,true);assert.equal(result.canApply,false);
  assert.deepEqual(result.reasons,['exclusive-ownership-unverified','settings-preservation-unverified','ui-hydration-unverified']);
  assert.ok(!JSON.stringify(result).includes('private text'));
  for(const override of [{responseInProgress:true},{runtimeStatus:{type:'active'}},{latestTurnStatus:'inProgress'}])
    assert.equal(capacityPreflight({...idleValues,...override}).idle,false);
  for(const field of Object.keys(idleValues)) {
    const partial={...idleValues};delete partial[field];
    assert.equal(capacityPreflight(partial).canApply,false);
    if(['responseInProgress','runtimeStatus','latestTurnStatus'].includes(field))assert.equal(capacityPreflight(partial).idle,null);
  }
  assert.equal(capacityPreflight({...idleValues,model:'unbounded content\nsecret'}).model,null);
  assert.equal(capacityPreflight({...idleValues,requestCount:-1}).requestCount,null);
  assert.equal(capacityPreflight({...idleValues,pendingRequestKind:'approval'}).pendingRequest,true);
});

test('new profile preflight is optional; a missing selector keeps the usage meter readable',()=>{
  const exports={k2:'usage',qX:'host',...Object.fromEntries(Object.entries(RSPACK_1111_PROFILE.preflightExports).map(([field,key])=>[key,field]))};
  const runtime=Object.assign(()=>{throw Error('must not call');},{m:{tl5a:()=>{throw Error('must not call');}},c:{tl5a:{exports}}});
  assert.equal(cachedBindings({runtime},RSPACK_1111_PROFILE).preflightAtoms.model,'model');
  delete exports.Zs;
  const missing=cachedBindings({runtime},RSPACK_1111_PROFILE);
  assert.equal(missing.usageAtom,'usage');assert.equal(missing.preflightAtoms,null);
});

test('preflight invalidates on navigation, host change, selector failure and shutdown',()=>{
  const source=new NativeSource(),atoms=Object.fromEntries(Object.keys(RSPACK_1111_PROFILE.preflightExports).map(field=>[field,field]));
  let host='local',fail=false,current;
  const selected={...scope(a),get(atom){if(fail)throw Error('gone');return atom==='host'?host:idleValues[atom];}};
  current={status:'ready',threadId:a,scope:selected};source.selection=()=>current;
  const mod={hostAtom:'host',preflightAtoms:atoms};
  assert.equal(source.preflight(current,mod).idle,true);
  const old=current;current={status:'ready',threadId:b,scope:selected};
  assert.equal(source.preflight(old,mod).threadId,null);
  current=old;host='remote';assert.equal(source.preflight(current,mod).threadId,null);
  host='local';fail=true;assert.equal(source.preflight(current,mod).model,null);
  fail=false;source.close();assert.equal(source.preflight(current,mod).threadId,null);
});

test('editor without a React fiber finds its nearest owner without crossing the composer boundary', () => {
  const selected = { ...scope(a), get() {}, watch() {} };
  const owner = { __reactFiber$test: { memoizedState: { memoizedState: { scope: selected } }, return: null } };
  const editor = { parentElement: { parentElement: owner } };
  assert.equal(chooseComposer(composerScopes(editor)).threadId, a);
  const boundary = { parentElement: owner, hasAttribute: name => name === 'data-codex-composer-root' };
  assert.equal(composerFiber({ parentElement: boundary }), null);
  let far = owner; for(let i=0;i<16;i++) far={parentElement:far};
  assert.equal(composerFiber(far), null);
});
test('remaining is calculated from last usage, never cumulative; invalid data fails closed', () => {
  const s=scalarSnapshot(a,{last:{totalTokens:223040},total:{totalTokens:9000000},modelContextWindow:272000});
  assert.ok(Math.abs(s.percent-18)<1e-9);
  assert.equal(scalarSnapshot(a,{last:{totalTokens:999999},modelContextWindow:272000}).percent,0);
  for(const value of [null,-1,NaN,Infinity,'223040']) assert.equal(scalarSnapshot(a,{last:{totalTokens:value},modelContextWindow:272000}),null);
  assert.equal(scalarSnapshot(a,{total:{totalTokens:1},modelContextWindow:272000}),null);
  assert.equal(scalarSnapshot('bad',{last:{totalTokens:1},modelContextWindow:272000}),null);
});
test('main composer selection excludes side conversations and refuses ambiguous/new/remote state', () => {
  const main=scope(a),side=scope(b,{placement:'side'});
  assert.equal(chooseComposer([side,main]).threadId,a);
  assert.equal(chooseComposer([main,scope(b)]).status,'ambiguous');
  assert.equal(chooseComposer([main,scope(null)]).status,'unavailable');
  assert.equal(chooseComposer([scope(a,{kind:'cloud'})]).status,'unavailable');
  assert.equal(chooseComposer([side]).status,'unavailable');
  assert.equal(chooseComposer([scope(null,{clientThreadId:a})]).status,'unavailable');
});

test('Rspack reads initialized exports without invoking runtime or factories, regardless of export alias', () => {
  const runtime=()=>{throw new Error('Runtime must not be invoked');};
  runtime.m={tl5a:()=>{throw new Error('Factory must not be invoked');}};
  runtime.c={};
  const namespace={renamedRuntime:runtime};
  assert.equal(cachedBindings(namespace,RSPACK_PROFILE),null);
  runtime.c.tl5a={exports:{k2:{id:'usage'},qX:{id:'host'}}};
  const first=cachedBindings(namespace,RSPACK_PROFILE);
  assert.equal(first.usageAtom,runtime.c.tl5a.exports.k2);
  assert.equal(first.hostAtom,runtime.c.tl5a.exports.qX);
  assert.equal(first.appVersion,'26.1103.3517.0');
  const newer={k2:{id:'new-usage'},qX:{id:'new-host'}};
  runtime.c.tl5a={exports:newer};
  assert.equal(cachedBindings(namespace,RSPACK_PROFILE).usageAtom,newer.k2);
  runtime.c.tl5a.error=new Error('failed module');
  assert.equal(cachedBindings(namespace,RSPACK_PROFILE),null);
});

test('Rspack rejects conflicting runtimes and ignores unreadable exports and fabricated cache properties', () => {
  const make=()=>Object.assign(()=>{}, {m:{tl5a:()=>{}},c:{tl5a:{exports:{k2:{},qX:{}}}}});
  const one=make(),two=make();
  assert.ok(cachedBindings({one,alias:one},RSPACK_PROFILE));
  assert.equal(cachedBindings({one,two},RSPACK_PROFILE),null);
  Object.defineProperty(two.c.tl5a.exports,'qX',{get(){throw Error('unavailable');}});
  assert.ok(cachedBindings({one,two},RSPACK_PROFILE));
  let getterCalls=0;
  const fabricated=new Proxy(()=>{},{get(){getterCalls++;return {};}});
  assert.equal(cachedBindings({fabricated},RSPACK_PROFILE),null);
  assert.equal(getterCalls,0);
});

test('new cache appears lazily, replacement rebinds once, disappearance and remote host clear usage', async () => {
  const runtime=Object.assign(()=>{throw Error('must not call');},{m:{tl5a:()=>{}},c:{}});
  const source=new NativeSource(); source.runtime={runtime}; source.runtimeProfile=RSPACK_PROFILE;
  let subscriptions=0,host='local';
  const selected={value:{kind:'local',placement:'main',conversationId:a},get(atom){return atom==='host'?host:{last:{totalTokens:223040},modelContextWindow:272000};},watch(fn){subscriptions++;fn({get:this.get});return ()=>subscriptions--;}};
  source.selection=()=>({status:'ready',threadId:a,scope:selected});
  assert.equal((await source.read()).status,'initializing');
  runtime.c.tl5a={exports:{k2:'usage',qX:'host'}};
  assert.ok(Math.abs((await source.read()).snapshot.percent-18)<1e-9);
  assert.equal(subscriptions,1);
  runtime.c.tl5a.exports.k2='usage-replacement';
  await source.read();assert.equal(subscriptions,1);
  host='remote';assert.equal((await source.read()).status,'unavailable');assert.equal(subscriptions,0);
  host='local';await source.read();delete runtime.c.tl5a;
  assert.equal((await source.read()).snapshot,null);assert.equal(subscriptions,0);
  source.close();assert.equal((await source.read()).status,'stopped');
});
test('cached reads retain the selected app profile through cache replacement', async () => {
  const runtime=Object.assign(()=>{throw Error('must not call');},{m:{tl5a:()=>{}},c:{}});
  const source=new NativeSource();source.runtime={runtime};source.runtimeProfile=RSPACK_4239_PROFILE;
  assert.equal(await source.load(),null);
  runtime.c.tl5a={exports:{k2:'usage',qX:'host'}};
  assert.equal((await source.load()).appVersion,RSPACK_4239_PROFILE.appVersion);
  runtime.c.tl5a={exports:{k2:'replacement',qX:'host'}};
  assert.equal((await source.load()).usageAtom,'replacement');
  assert.equal((await source.load()).appVersion,RSPACK_4239_PROFILE.appVersion);
  source.close();assert.equal(source.runtimeProfile,null);
});
test('disable during dom.ready prevents a late mount; distributable has no fixture hook', async () => {
  const code=await sidebarBundle();
  assert.ok(!code.includes('createSidebarFixture'));
  const sandbox={module:{exports:{}}}; vm.runInNewContext(code,sandbox);
  let ready;const waiting=new Promise(resolve=>{ready=resolve;});
  const started=sandbox.module.exports.start({dom:{ready:()=>waiting}});
  sandbox.module.exports.stop();ready();await started;
  // No document exists in this VM. A late mount would throw.
  sandbox.module.exports.stop();
  assert.equal(sandbox.module.exports.invokeHostCommand('inspect',{}).status,'stopped');
  assert.throws(()=>sandbox.module.exports.invokeHostCommand('run',{script:'invalid'}));
  assert.throws(()=>sandbox.module.exports.invokeHostCommand('inspect',{threadId:a}));
});
