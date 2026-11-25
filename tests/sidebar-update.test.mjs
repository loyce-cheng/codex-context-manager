import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateSidebar, bundleForLocalBuild, bundleForModelCatalog } from '../scripts/update-sidebar.mjs';
import { targetContext } from '../native-sidebar/src/target.mjs';
import { sidebarBundle } from '../scripts/build-sidebar.mjs';
import { profilesForBuild, RSPACK_9664_PROFILE } from '../native-sidebar/src/telemetry.mjs';
import {checkedProfile} from '../scripts/verify-native-profile.mjs';
import {confirmLiveSidebar} from '../scripts/sidebar-loader-client.mjs';
const current=JSON.parse(await readFile(new URL('../native-sidebar/manifest.json',import.meta.url),'utf8')).version;

test('installed sidebar uses the selected model limits, including nonstandard windows and reserves',async()=>{
  const models=new Map([
    ['model-a',{defaultWindow:320000,maxWindow:640000,effectivePercent:90}],
    ['model-b',{defaultWindow:500000,maxWindow:600000,effectivePercent:80}],
    ['invalid',{defaultWindow:900000,maxWindow:640000,effectivePercent:95}],
  ]);
  const source=await sidebarBundle();
  const bundle=bundleForModelCatalog(Buffer.from(source),models).toString();
  const rows=JSON.parse(bundle.match(/const installedModelRows = (\[.*\]);/)[1]);
  assert.deepEqual(rows,[['model-a',320000,640000,90],['model-b',500000,600000,80]]);
  const catalog=new Map(rows.map(([slug,context_window,max_context_window,effective_context_window_percent])=>
    [slug,{slug,context_window,max_context_window,effective_context_window_percent}]));
  const id='11111111-1111-4111-8111-111111111111';
  const read=model=>targetContext({model,host:'local',threadId:id},{threadId:id},catalog);
  assert.deepEqual([...read('model-a').levels],[320000,384000,512000,640000]);
  assert.equal(read('model-a').effectivePercent,90);
  assert.deepEqual([...read('model-b').levels],[500000,512000,600000]);
  assert.equal(read('model-b').effectivePercent,80);
  assert.equal(read('invalid'),null);
  assert.equal(read('gpt-6-astra'),null);
});

test('a verified local profile only supplies version and asset names to the released bundle',async()=>{
  const original=Buffer.from(await sidebarBundle());
  const profile={...RSPACK_9664_PROFILE, appVersion:'26.1111.9999.0', asset:'348410.0123456789.js'};
  const customized=bundleForLocalBuild(original,profile).toString();
  assert.ok(customized.includes('"asset":"348410.0123456789.js"'));
  assert.ok(original.toString().includes('const verifiedLocalBuild = null;'));
  assert.throws(()=>bundleForLocalBuild(original,{...profile,stateAsset:'../../untrusted.js'}));
  assert.throws(()=>bundleForLocalBuild(Buffer.from('old bundle'),profile));
});

test('upgrade preserves verified usage but disables unverified tier fields even if an old asset name matches',async()=>{
  const profile={...RSPACK_9664_PROFILE,appVersion:'26.1111.9999.0'};
  const checks={composerIdentity:true,tokenUsageAtom:true,preflight_model:false};
  const limited=checkedProfile(profile,checks,true);
  assert.equal(limited.preflightExports,null);
  assert.throws(()=>checkedProfile(profile,checks));
  for(const required of ['composerIdentity','tokenUsageAtom','navigationRail','unexpectedNewCheck'])
    assert.throws(()=>checkedProfile(profile,{...checks,[required]:false},true));
  const bundle=Buffer.from(await sidebarBundle());
  for(const input of [limited,{appVersion:profile.appVersion,unsupported:true}]){
    const custom=bundleForLocalBuild(bundle,input).toString();
    const local=JSON.parse(custom.match(/const verifiedLocalBuild = (.*);/)[1]);
    const profiles=profilesForBuild(local);
    assert.equal(profiles.length, input.unsupported ? 0 : 1);
    if(profiles.length)assert.equal(profiles[0].preflightExports,null);
  }
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'context-lens-update-')));
  const source = join(root, 'source'), target = join(root, 'target');
  for (const [directory, version] of [[source, current], [target, '0.1.0-alpha.2']]) {
    await mkdir(directory);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ id: 'local.context-lens.sidebar', version }));
    for (const name of ['index.js', 'README.md', 'NOTICE.md', 'LICENSE']) await writeFile(join(directory, name), version + name);
  }
  return { source, target, backupRoot: join(root, 'backups'), loaderRunning: async () => false };
}
test('updates only the package, retains backup, and skips an identical install', async () => {
  const options = await fixture(), report = await updateSidebar(options);
  assert.equal(report.changed, true);
  assert.match(await readFile(join(report.backup, 'index.js'), 'utf8'), /alpha\.2/);
  assert.equal(await readFile(join(options.target, 'index.js'), 'utf8'), current+'index.js');
  assert.equal((await updateSidebar(options)).changed, false);
});
test('running Loader blocks all writes, including a Loader starting during preflight', async () => {
  for (const startDuringPreflight of [false, true]) {
    const options = await fixture(); let queries = 0;
    options.loaderRunning = async () => !startDuringPreflight || ++queries > 1;
    await assert.rejects(updateSidebar(options), /Loader/);
    assert.match(await readFile(join(options.target, 'index.js'), 'utf8'), /alpha\.2/);
  }
});
test('disconnected or busy Loader defers a live change before backup, writes or GUI reload',async()=>{
  for(const reply of [null,{ok:false,error:{code:'COMMAND_BUSY'}},{ok:true,result:{startup:'started',status:'stopped'}}]){
    const options=await fixture();
    let reloads=0;
    options.loaderRunning=async()=>true;
    options.checkLive=()=>confirmLiveSidebar(async()=>{
      if(reply===null)throw Error('connection refused');
      return reply;
    });
    options.liveReload=async()=>{reloads++;};
    await assert.rejects(updateSidebar(options),error=>reply?.error?.code==='COMMAND_BUSY'?
      error.code!=='LOADER_RESTART_REQUIRED'&&/稍后重试/.test(error.message):error.code==='LOADER_RESTART_REQUIRED');
    assert.equal(reloads,0);
    await assert.rejects(access(options.backupRoot),{code:'ENOENT'});
    assert.equal(await readFile(join(options.target,'index.js'),'utf8'),'0.1.0-alpha.2index.js');
  }
  await confirmLiveSidebar(async()=>({ok:true,result:{startup:'started',status:'waiting'}}));
  for(const code of ['PLUGIN_NOT_FOUND','OPERATION_NOT_ALLOWED']){
    await assert.rejects(confirmLiveSidebar(async()=>({ok:false,error:{code}})),
      error=>error.code!=='LOADER_RESTART_REQUIRED'&&/插件/.test(error.message));
  }
});
test('a failed instance recovery reports separately that package files were restored',async()=>{
  const options=await fixture();
  options.loaderRunning=async()=>true;
  options.liveReload=async()=>confirmLiveSidebar(async()=>({ok:false}));
  await assert.rejects(updateSidebar(options),error=>error.code==='LOADER_RESTART_REQUIRED'&&/文件已还原/.test(error.message));
  assert.equal(await readFile(join(options.target,'index.js'),'utf8'),'0.1.0-alpha.2index.js');
});
test('unexpected target contents or identity cannot be overwritten', async () => {
  const extra = await fixture(); await writeFile(join(extra.target, 'user.txt'), 'keep');
  await assert.rejects(updateSidebar(extra), /Unexpected package files/);
  const wrong = await fixture();
  await writeFile(join(wrong.target, 'manifest.json'), JSON.stringify({ id: 'other-plugin', version: '0.1.0-alpha.2' }));
  await assert.rejects(updateSidebar(wrong), /identity/);
  assert.match(await readFile(join(wrong.target, 'index.js'), 'utf8'), /alpha\.2/);
});
test('explicit live reload verifies new version; failure restores package and reloads old version', async () => {
  const success = await fixture(), seen = [];
  success.loaderRunning = async () => true;
  success.liveReload = async version => { seen.push(version); return { version, status: 'waiting' }; };
  assert.equal((await updateSidebar(success)).loaded, true);
  assert.deepEqual(seen, [current]);
  const failure = await fixture(), attempts = [];
  failure.loaderRunning = async () => true;
  failure.liveReload = async version => { attempts.push(version); if(version===current) throw Error('Reload failed'); };
  await assert.rejects(updateSidebar(failure), /Reload failed/);
  assert.deepEqual(attempts, [current, '0.1.0-alpha.2']);
  assert.match(await readFile(join(failure.target, 'index.js'), 'utf8'), /alpha\.2/);
});
test('startup sync skips reload of identical files but still reloads a changed bundle',async()=>{
  const options=await fixture(),seen=[];
  options.loaderRunning=async()=>true;options.reloadUnchanged=false;
  options.liveReload=async version=>{seen.push(version);return {version,status:'following'};};
  assert.equal((await updateSidebar(options)).changed,true);
  const same=await updateSidebar(options);
  assert.equal(same.changed,false);assert.equal(same.loaded,false);assert.deepEqual(seen,[current]);
  await writeFile(join(options.target,'manifest.json'),JSON.stringify({id:'local.context-lens.sidebar',version:'0.1.0-alpha.99'}));
  await assert.rejects(updateSidebar(options),/identity\/version/);assert.deepEqual(seen,[current]);
});
