import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTiers, normalizeSnapshot, remainingPercent, WarningTracker, WindowController } from '../src/core/context.mjs';

test('remaining fill and thresholds use remaining, not used or rounded values',()=>{
  assert.equal(remainingPercent(820,1000),18.000000000000004);
  assert.equal(remainingPercent(1100,1000),0);assert.equal(remainingPercent(-1,1000),null);assert.equal(remainingPercent(1,0),null);
  const s=normalizeSnapshot({threadId:'a',used:820,window:1000});assert.equal(s.quality,'estimated');
  assert.equal(normalizeSnapshot({threadId:'a',used:820,window:1000,reportedRemainingPercent:20.1}).quality,'reported');
});
test('tiers derive from model, deduplicate and never exceed its maximum',()=>{
  assert.deepEqual(buildTiers({defaultWindow:500000,maxWindow:600000,currentWindow:512000}),[384000,500000,512000,600000]);
  assert.deepEqual(buildTiers({defaultWindow:272000}),[]);
});
test('native percent and effective window are kept separate from inferred config',()=>{
  const s=normalizeSnapshot({threadId:'a',used:210000,window:258400},{defaultWindow:272000,maxWindow:872000,effectivePercent:95});
  assert.equal(s.displayWindow,272000);assert.equal(s.effectiveWindow,258400);assert.equal(s.windowBasis,'catalog-default-match');
  assert.equal(s.remainingPercent,remainingPercent(210000,258400));
});
test('warning deduplication, hysteresis and thread isolation',()=>{
  const tracker=new WarningTracker();const s=(id,p,r)=>({threadId:id,remainingPercent:p,revision:r,effectiveWindow:100});
  assert.equal(tracker.observe(s('a',40,'1'),{initial:true}),false);
  assert.equal(tracker.observe(s('a',20.1,'2')),false);assert.equal(tracker.observe(s('a',20,'3')),true);
  assert.equal(tracker.observe(s('a',19,'4')),false);assert.equal(tracker.observe(s('b',18,'1'),{initial:true}),false);
  tracker.observe(s('a',26,'5'));assert.equal(tracker.observe(s('a',18,'6')),true);assert.equal(tracker.observe(s('a',18,'6')),false);
});
test('unsupported controls cannot pretend that setting a preference expanded a thread',async()=>{
  const control=new WindowController({capabilities:{runtimeWindowUpdate:false}});
  await assert.rejects(control.apply('a',512000),{code:'UNSUPPORTED_CAPABILITY'});assert.equal(control.state('a'),null);
});
test('late A responses cannot overwrite newer A or unrelated B state',async()=>{
  const pending=[];const control=new WindowController({capabilities:{runtimeWindowUpdate:true},limits:async()=>({defaultWindow:272000,maxWindow:872000}),apply:request=>new Promise(resolve=>pending.push({request,resolve}))});
  const first=control.apply('a',384000),second=control.apply('a',512000),third=control.apply('b',768000);await new Promise(resolve=>setImmediate(resolve));
  const reply=p=>p.resolve({threadId:p.request.threadId,applied:true,configuredWindow:p.request.window,effectiveWindow:p.request.window*.95});
  reply(pending[1]);await second;reply(pending[0]);assert.equal((await first).ignored,true);reply(pending[2]);await third;
  assert.equal(control.state('a').requestedWindow,512000);assert.equal(control.state('b').requestedWindow,768000);
});
