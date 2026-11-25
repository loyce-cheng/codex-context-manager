import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOwnerSync, SelectionGate } from '../experiments/desktop-log-follow/selection.mjs';
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
function line(route=`/local/${a}?hostId=local`, extra='') { return `2026-10-29T18:00:00.000Z info [electron-message-handler] IAB_LIFECYCLE received browser sidebar owner sync conversationId=${b} originWebContentsId=1 windowId=1 ownerRoutePath=${route}${extra}`; }
test('route identity wins over a different browser conversation ID',()=>{
  const e=parseOwnerSync(line());assert.equal(e.threadId,a);assert.equal(e.hostId,'local');
  assert.equal(parseOwnerSync(line(JSON.stringify(`/local/${a}?hostId=local`))).threadId,a);
});
test('background creation, token and active-view events cannot select a chat',()=>{
  for(const event of ['Conversation created','Reasoning summary item completed','thread_stream_view_activity_changed'])assert.equal(parseOwnerSync(line().replace('IAB_LIFECYCLE received browser sidebar owner sync',event)),null);
});
test('unsupported, remote and duplicate fields never produce a local binding',()=>{
  for(const route of ['/settings',`/local/${a}?hostId=remote`,`/local/${a}?hostId=local&hostId=remote`,`/local/${a}/extra?hostId=local`])assert.equal(parseOwnerSync(line(route)).threadId,null);
  assert.equal(parseOwnerSync(line(undefined,' windowId=2')),null);
});
test('only the verified renderer/window and eligible new chat may bind',()=>{
  const gate=new SelectionGate({windowId:1,rendererId:1,eligibleIds:[a]}),e=parseOwnerSync(line());
  assert.equal(gate.accept({...e,windowId:2}),false);assert.equal(gate.accept({...e,rendererId:3}),false);
  assert.equal(gate.value.state,'unknown');gate.accept(e);assert.equal(gate.value.threadId,a);
  gate.accept({...e,threadId:b,at:e.at+1});assert.equal(gate.value.state,'out-of-scope');assert.equal(gate.value.threadId,null);
  assert.equal(gate.accept(e),false);assert.equal(gate.value.threadId,null);
});
test('leaving a supported route clears identity and reentering restores it',()=>{
  const gate=new SelectionGate({windowId:1,rendererId:1,eligibleIds:[a]}),e=parseOwnerSync(line());
  gate.accept(e);gate.accept({...parseOwnerSync(line('/settings')),at:e.at+1});assert.equal(gate.value.state,'unknown');assert.equal(gate.value.threadId,null);
  gate.accept({...e,at:e.at+2});assert.equal(gate.value.threadId,a);
});
