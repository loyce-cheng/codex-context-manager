import assert from 'node:assert/strict';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {desktopChoice,writeDesktopTier} from './desktop-tier-bridge.mjs';
import {openTurnReceipt} from './turn-receipt.mjs';
import {LocalCodexSource} from '../../src/adapters/local-codex.mjs';

// Match the turn's native start record to its completed local model response when available.
export async function verifyLoadedWindow({rpc, directory, probeHome, completed, observedTurnWindows, fixture, windows, report}) {
  const model = 'gpt-6-astra';
  async function request(method, params) {
    const response = await rpc(method, params);
    if (response.error) throw Error(method + ' rejected: ' + response.error.message);
    return response.result;
  }
  async function start(config) {
    const result = await request('thread/start', {
      model, modelProvider: 'context_lens_probe', cwd: directory, ephemeral: false,
      approvalPolicy: 'never', sandbox: 'read-only', config,
    });
    assert.equal(result.modelProvider, 'context_lens_probe');
    assert.equal(result.model, model);
    return result.thread.id;
  }
  const startTurn=async threadId=>(await request('turn/start', {threadId, input: [{type: 'text', text: 'Local fixture.'}]})).turn;
  async function measure(threadId, label, expected, activeTurn) {
    const turn = activeTurn ?? await startTurn(threadId);
    const deadline = Date.now() + 15000;
    let record;
    while (Date.now() < deadline) {
      const rows = await observedTurnWindows(join(probeHome, 'sessions'));
      record = rows.find(row => row.turnId === turn.id);
      if (record && completed.has(turn.id)) break;
      await delay(100);
    }
    assert.ok(record, 'Missing native task_started record for ' + label);
    assert.ok(completed.has(turn.id), 'Fixture turn still active for ' + label);
    const sample={label, capacity: record.window, turnStatus: completed.get(turn.id)};
    report.measurements.push(sample);
    assert.equal(sample.turnStatus, fixture ? 'completed' : 'failed', label + ' fixture status');
    if(fixture) {
      sample.usageWindow=windows.findLast(row=>row.threadId===threadId && row.turnId===turn.id)?.window;
      assert.equal(sample.usageWindow,expected,label+' native usage notification');
    }
    assert.equal(record.window, expected, label);
  }
  const windowMethod = 'thread/contextWindow/set';
  const a = await start({});
  const patched=report.expectation==='patched';
  const b = await start(patched ? {} : {model_context_window: 512000});
  const controlWindow=patched ? 258400 : 486400;
  assert.notEqual(a, b);
  const selection = {threadId: a, expectedModel: model, selection: {tokens: 512000}};
  const source=new LocalCodexSource({home:probeHome});
  let readReceipt,submittedAt;
  async function verifyReceipt(label,expected){
    let capacity=null;
    const deadline=Date.now()+5000;
    do{
      capacity=await readReceipt(submittedAt);
      if(capacity!==null)break;
      await delay(50);
    }while(Date.now()<deadline);
    assert.equal(capacity,expected,label+' next-turn receipt');
    (report.receipts??=[]).push({label,capacity});
  }
  async function selectFromSidebar(value) {
    const started=Date.now();
    let inspection;
    if(report.browserSlider && (value==='default'||value.tokens===512000)){
      const {sampleSidebarChoice}=await import('./sample-sidebar-choice.mjs');
      const usage=windows.findLast(row=>row.threadId===a);
      inspection=await sampleSidebarChoice({threadId:a,model,capacity:usage.window,used:usage.used,reset:value==='default'});
    }else{
      inspection={status:'following',threadId:a,diagnostics:{capacityPreflight:{host:'local',threadId:a,model}},
        capacityChoice:{threadId:a,expectedModel:model,selection:value,id:randomUUID().replaceAll('-',''),chosenAt:started}};
    }
    const choice=desktopChoice(inspection,started,Date.now());
    assert.ok(choice);
    assert.deepEqual(choice.record,{threadId:a,expectedModel:model,selection:value});
    readReceipt=await openTurnReceipt(source,choice.record);
    await writeDesktopTier(probeHome,choice.record);
    submittedAt=Date.now();
  }
  await measure(a, 'A before change', 258400);
  await measure(b, 'B before change', controlWindow);
  let change;
  if(patched && fixture) {
    const hold=fixture.holdNextResponse();
    let activeTurn;
    try{
      activeTurn=await startTurn(a);
      await Promise.race([hold.arrived,delay(10000,undefined,{ref:false}).then(()=>{throw Error('Fixture never received the active turn');})]);
      if(report.desktopTiers)await selectFromSidebar(selection.selection);
      else change=await rpc(windowMethod,selection);
    }finally{hold.release();}
    await measure(a,'A turn already in progress during change',258400,activeTurn);
  }else{
    change=await rpc(windowMethod,selection);
  }
  if (report.expectation === 'stock') {
    assert.ok(change.error, 'Stock backend unexpectedly accepted the experimental method');
    const {code, message} = change.error;
    report.rejection = {code, message: String(message).split(', expected')[0].slice(0,220)};
    assert.ok(code === -32601 || (/unknown (variant|method)/i.test(message) && message.includes(windowMethod)),
      'Backend returned an unrelated error: ' + report.rejection.message);
    await measure(a, 'A after rejected change', 258400);
  } else if(report.desktopTiers) {
    assert.equal(await readReceipt(submittedAt),null,'the in-progress turn must not confirm a new tier');
    await measure(a,'A after desktop tier selection',486400);
    await verifyReceipt('512k',486400);
    await measure(b,'B while A has desktop tier',controlWindow);
    await selectFromSidebar({tokens:900000});
    await measure(a,'A after backend rejects invalid desktop tier',486400);
    await verifyReceipt('rejected tier',486400);
    await selectFromSidebar('default');
    await measure(a,'A after desktop tier reset',258400);
    await verifyReceipt('default',258400);
  } else {
    if (change.error) throw Error(windowMethod + ' rejected: ' + change.error.message);
    assert.deepEqual(change.result, {
      threadId: a, model, rawTokens: 512000, usableTokens: 486400, autoCompactTokenLimit: 460800,
    });
    const retried = await request(windowMethod, selection);
    assert.deepEqual(retried, change.result);
    await measure(a, 'A after change', 486400);
    await measure(b, 'B while A is expanded', controlWindow);
    const beyondModel = await rpc(windowMethod, {...selection, selection: {tokens: 900000}});
    assert.ok(beyondModel.error, 'Out-of-range selection was accepted');
    await measure(a, 'A after invalid change', 486400);
    const reset = await request(windowMethod, {...selection, selection: 'default'});
    assert.equal(reset.threadId, a);
    assert.equal(reset.usableTokens, 258400);
    await measure(a, 'A after reset', 258400);
  }
  await measure(b, 'B after changes to A', controlWindow);
  const loaded = await request('thread/loaded/list', {});
  assert.ok([a,b].every(id => loaded.data.includes(id)), 'Both chats must stay loaded');
  const {config} = await request('config/read', {includeLayers: false});
  assert.equal(config.model_context_window ?? null, null);
  report.bothStillLoaded = true;
  report.globalWindow = null;
}
