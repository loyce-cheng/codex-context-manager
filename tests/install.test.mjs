import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compareVersions,samePackage,installPlugin} from '../packaging/install-workflow.mjs';
const MARKET='context-lens-local';
async function fixture({target='0.1.0-alpha.5',installed='0.1.0-alpha.5',failInstall=false,failCatalog=false,foreign=false}={}){
 const temp=await mkdtemp(join(tmpdir(),'context-lens-install-test-')),root=join(temp,'release'),old=join(temp,'previous'),home=join(temp,'home'),source=join(root,'plugins','context-lens');
 await mkdir(source,{recursive:true});await writeFile(join(source,'plugin.json'),JSON.stringify({name:'context-lens',version:target}));await writeFile(join(source,'payload'),'verified bytes');
 await mkdir(join(old,'.agents','plugins'),{recursive:true});await writeFile(join(old,'.agents','plugins','marketplace.json'),JSON.stringify({name:MARKET,plugins:[{name:foreign?'different-plugin':'context-lens'}]}));
 const cache=join(home,'plugins','cache',MARKET,'context-lens',target);await mkdir(cache,{recursive:true});await cp(source,cache,{recursive:true});
 let current=old;const calls=[];
 const run=async args=>{calls.push(args);if(args[0]!=='plugin')throw new Error('unexpected command');
  if(args[1]==='list')return JSON.stringify({installed:installed?[{pluginId:'context-lens@'+MARKET,version:installed}]:[]});
  if(args[1]==='marketplace'&&args[2]==='list')return JSON.stringify({marketplaces:current?[{name:MARKET,root:current}]:[]});
  if(args[1]==='marketplace'&&args[2]==='remove'){current=null;return '{}';}
  if(args[1]==='marketplace'&&args[2]==='add'){if(failCatalog&&args[3]===root)throw new Error('catalog add failed');current=args[3];return '{}';}
  if(args[1]==='add'){if(failInstall)throw new Error('failed to back up plugin cache entry: os error 5');return '{}';}
  throw new Error('unexpected command');
 };
 return{root,old,home,source,cache,run,calls,current:()=>current,cleanup:()=>rm(temp,{recursive:true,force:true})};
}
test('installer orders release/prerelease versions numerically',()=>{
 assert(compareVersions('0.1.0-alpha.10','0.1.0-alpha.5')>0);assert(compareVersions('0.1.0','0.1.0-alpha.99')>0);assert(compareVersions('0.1.0-alpha.3','0.1.0-alpha.5')<0);assert.equal(compareVersions('0.1.0+build.1','0.1.0'),0);assert.throws(()=>compareVersions('unknown','0.1.0'));
});
test('package reuse requires all file names and bytes to match',async()=>{
 const f=await fixture();try{assert(await samePackage(f.source,f.cache));await writeFile(join(f.cache,'payload'),'different');assert.equal(await samePackage(f.source,f.cache),false);await writeFile(join(f.cache,'payload'),'verified bytes');await writeFile(join(f.cache,'extra'),'extra');assert.equal(await samePackage(f.source,f.cache),false);}finally{await f.cleanup();}
});
test('same-version reinstall repairs catalog without touching a running matching cache',async()=>{
 const f=await fixture({failInstall:true});try{const result=await installPlugin(f);assert.equal(result.reused,true);assert.equal(f.current(),f.root);assert.equal(f.calls.some(c=>c[1]==='add'),false);}finally{await f.cleanup();}
});
test('older installer refuses downgrade before changing a catalog',async()=>{
 const f=await fixture({target:'0.1.0-alpha.3'});try{await assert.rejects(installPlugin(f),/阻止降级/);assert.equal(f.current(),f.old);assert.equal(f.calls.some(c=>c.includes('remove')||c.includes('add')),false);}finally{await f.cleanup();}
});
test('failed cache backup restores the previous catalog',async()=>{
 const f=await fixture({target:'0.1.0-alpha.6',failInstall:true});try{await assert.rejects(installPlugin(f),/os error 5/);assert.equal(f.current(),f.old);}finally{await f.cleanup();}
});
test('failed catalog registration restores the previous catalog',async()=>{
 const f=await fixture({failCatalog:true});try{await assert.rejects(installPlugin(f),/catalog add failed/);assert.equal(f.current(),f.old);}finally{await f.cleanup();}
});
test('installer leaves unrelated shared catalogs alone',async()=>{
 const f=await fixture({foreign:true});try{await assert.rejects(installPlugin(f),/单插件目录/);assert.equal(f.current(),f.old);assert.equal(f.calls.some(c=>c.includes('remove')||c.includes('add')),false);}finally{await f.cleanup();}
});
