import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectGetterBindings} from '../scripts/rspack-usage.mjs';
import {cachedAssetNames} from '../scripts/verify-native-profile.mjs';
import {bundleForLocalBuild} from '../scripts/update-sidebar.mjs';
import {RSPACK_5083_PROFILE as profile} from '../native-sidebar/src/telemetry.mjs';

const state=`export const __webpack_modules__={
 tl5a:function(module,exports,require){
   require.d(exports,{readCap:()=>read,whichHost:()=>route.qX});
   const route=require("Bl6U"),field=(0,fields.tv)("tokenUsageInfo");
   const read=(0,atoms.i1)(scope.u,(id,{get:load})=>null==id?null:load(field,{hostId:load(route.qX,id),threadId:id}));
 },
 Bl6U:function(module,exports,require){
   const host=(0,atoms.i1)(scope.u,(id,{get:load})=>{let set=null==id?null:load(state.sZ,id);return(0,selector.Cg)(load,id)??(set?.has("local")?"local":set?.values().next().value)??load(fallback,id)??"local"});
   require.d(exports,{},{lG:manager,qX:host,sb:fallback});
 }
}`;
const composer=`export const __webpack_modules__={
 widget:function(module,exports,require){
   const usageModule=require("tl5a");
   function usageView(info){
     let max=info?.modelContextWindow??null,count=info?.last.totalTokens??null;
     if(null==max||max<=0||null==count||count<0)return{percent:null,usedTokens:null,contextWindow:null,remainingTokens:null};
     let used=Math.min(count,max),pct=used/max*100;return Number.isFinite(pct)?{percent:pct,usedTokens:used,contextWindow:max,remainingTokens:Math.max(max-used,0)}:{percent:null,usedTokens:null,contextWindow:null,remainingTokens:null}
   }
   function meter(thread){const sample=(0,hooks._U)(usageModule.readCap,thread);return usageView(sample);}
 }
}`;
test('static discovery follows renamed usage and host exports into the native composer calculation',()=>{
  const result=inspectGetterBindings(state,composer,profile);
  assert.equal(result.usageExport,'readCap');assert.equal(result.hostExport,'whichHost');
  for(const k of ['tokenUsageAtom','tokenUsageExport','hostExport','nativeFormula','nativeUsageConsumer'])assert.equal(result.checks[k],true,k);
  assert.equal(result.checks.preflight_model,false);
  const bundle=bundleForLocalBuild(Buffer.from('const verifiedLocalBuild = null;'),{...profile,usageExport:result.usageExport,hostExport:result.hostExport});
  assert.match(bundle.toString(),/"usageExport":"readCap"/);
});
test('ambiguous exports, a wrong host, another thread or a cumulative reading fail closed',()=>{
  const inspect=(s,c)=>inspectGetterBindings(s,c,profile).checks;
  assert.equal(inspect(state.replace('readCap:()=>read','readCap:()=>read,also:()=>read'),composer).tokenUsageExport,false);
  assert.equal(inspect(state.replace('require("Bl6U")','require("elsewhere")'),composer).hostExport,false);
  assert.equal(inspect(state.replace('threadId:id','threadId:other'),composer).tokenUsageAtom,false);
  assert.equal(inspect(state.replace('"tokenUsageInfo"','"other"'),composer).tokenUsageAtom,false);
  assert.equal(inspect(state,composer.replace('?.last.totalTokens','?.total.totalTokens')).nativeFormula,false);
  assert.equal(inspect(state,composer.replace('usageView(sample)','usageView(previous)')).nativeUsageConsumer,false);
});
test('cache only accepts names from the same desktop and never supplies module or export code',()=>{
  const hint={mode:'verified',profile:{...profile,moduleId:'unused',usageExport:'wrong'}};
  const names=cachedAssetNames(profile.appVersion,hint);
  assert.deepEqual(Object.keys(names).sort(),['asset','composerAsset','primaryAsset','stateAsset']);
  assert.equal(cachedAssetNames('99.1.2.3',hint),null);
  assert.equal(cachedAssetNames(profile.appVersion,{...hint,profile:{...profile,stateAsset:'../outside.js'}}),null);
  assert.throws(()=>bundleForLocalBuild(Buffer.from('const verifiedLocalBuild = null;'),{...profile,usageExport:'__proto__'}));
});
