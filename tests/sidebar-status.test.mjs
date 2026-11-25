import test from 'node:test';
import assert from 'node:assert/strict';
import {describeSidebar} from '../scripts/sidebar-status.mjs';
import {inspectUpgrade,describeUpgrade} from '../scripts/upgrade-status.mjs';
import {join} from 'node:path';

test('upgrade check distinguishes page, desktop, loader and optional local installation',async()=>{
  for(const [version,page,installed,failure,expected] of [
    ['26.1117.4957.0','verified',true,null,'experimental'],
    ['26.1117.4957.0','verified',false,null,'monitor-install'],
    ['26.1117.4957.0','verified',true,'UNVERIFIED_VERSION','unverified-loader'],
    ['26.1117.4957.0','verified',true,'ENOENT','repair-experiment'],
    ['99.0.0.1','verified',true,null,'unverified-desktop'],
    ['99.0.0.1','usage-only',true,null,'usage-only'],
    ['99.0.0.1','unsupported',true,null,'unsupported-page'],
  ]){
    let checks=0;
    const result=await inspectUpgrade({packageInfo:async()=>({version}),pageProfile:async()=>({mode:page}),
      findLoader:async()=>join('versions','0.6.2','win-x64'),experimentInstalled:async()=>installed,
      checkBuild:async()=>{checks++;if(failure)throw Object.assign(Error(),{code:failure});return 'available-in-store';}});
    assert.equal(result.mode,expected);
    assert.equal(checks,['experimental','repair-experiment','unverified-loader'].includes(expected)?1:0);
    assert.ok(describeUpgrade(result).includes(version));
  }
});

test('unavailable desktop or Loader never reaches experimental file checks',async()=>{
  for(const version of ['', '26.1117.4957.0']){
    const result=await inspectUpgrade({packageInfo:async()=>({version}),
      pageProfile:async()=>({mode:'verified'}),findLoader:async()=>{throw Error('no active installation');},
      experimentInstalled:async()=>assert.fail('missing prerequisite'),checkBuild:async()=>assert.fail('unexpected probe')});
    assert.equal(result.mode,version?'loader-unavailable':'unknown-desktop');
  }
});

test('status window distinguishes a healthy reading, insufficient space, a missing rail, no chat and disconnection',()=>{
  const view={startup:'started',layoutOK:true,status:'following',threadId:'11111111-1111-4111-8111-111111111111',
    capacity:486400,percent:34.2,diagnostics:{selection:'ready',host:'local',visibleComposerCount:1}};
  const message=fields=>describeSidebar({ok:true,result:{...view,...fields}});
  assert.match(message({}),/486.4k，剩余 34%/);
  assert.match(message({layoutOK:false,layoutProblem:'space'}),/空间不足/);
  assert.match(message({layoutOK:false,layoutProblem:'rail'}),/展开/);
  assert.match(message({status:'unavailable'}),/本地对话/);
  assert.match(message({status:'waiting'}),/等待 Codex 返回用量/);
  assert.match(describeSidebar({ok:false,error:{code:'COMMAND_BUSY'}}),/正忙/);
  assert.match(describeSidebar(null),/未取得 Loader/);
});
