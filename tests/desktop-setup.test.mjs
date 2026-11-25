import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,access,rm,mkdir,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {manageSidebarFiles} from '../packaging/windows-setup/sidebar-files.mjs';
import {sidebarBundle} from '../scripts/build-sidebar.mjs';
const source=fileURLToPath(new URL('../native-sidebar/',import.meta.url));
async function sandbox(t){
  const root=await mkdtemp(join(tmpdir(),'lens-setup-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const localData=join(root,'user profile'),manifest=JSON.parse(await readFile(join(source,'manifest.json'),'utf8'));
  await mkdir(localData);await mkdir(join(root,'native-sidebar'));await cp(join(source,'manifest.json'),join(root,'native-sidebar/manifest.json'));
  const dist=join(root,'dist','context-lens-sidebar-'+manifest.version);await mkdir(dist,{recursive:true});
  for(const f of ['manifest.json','README.md','NOTICE.md'])await cp(join(source,f),join(dist,f));
  await writeFile(join(dist,'index.js'),await sidebarBundle());await writeFile(join(dist,'LICENSE'),'fixture');
  const target=join(localData,'CodexScriptLoader','scripts',manifest.id);
  return {root,target,run:action=>manageSidebarFiles(action,{root,localData})};
}
test('fresh install, repair and uninstall preserve config and recognize runtime-customized package',async t=>{
  const {target,run}=await sandbox(t);
  assert.equal(await run('install'),'created');assert.equal(await run('install'),'preserved');
  const config=join(target,'../../config.json');
  await writeFile(config,'preserve me');
  const main=join(target,'index.js');
  await writeFile(main,(await readFile(main,'utf8')).replace('const installedModelRows = null;','const installedModelRows = [];'));
  assert.equal(await run('uninstall'),'removed');
  await assert.rejects(access(target),{code:'ENOENT'});assert.equal(await readFile(config,'utf8'),'preserve me');
});
test('preexisting installations and user changes are retained',async t=>{
  const {root,target,run}=await sandbox(t);
  await run('install');await rm(join(root,'installer-sidebar-owner.json'));
  await run('install');assert.equal(await run('uninstall'),'preexisting');
  await access(join(target,'index.js'));
  await writeFile(join(root,'installer-sidebar-owner.json'),'local.context-lens.sidebar');
  await writeFile(join(target,'index.js'),'user edit');
  assert.equal(await run('uninstall'),'modified');assert.equal(await readFile(join(target,'index.js'),'utf8'),'user edit');
  await writeFile(join(target,'manifest.json'),JSON.stringify({id:'local.context-lens.sidebar',version:'0.9.0-beta.1'}));
  await assert.rejects(run('install'),/不兼容/);
});
