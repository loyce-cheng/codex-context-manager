// Development update: copy our five files while Loader is stopped, or explicitly
// use its public reload command with version verification and rollback.
// No PowerShell script policy changes, process termination, or Loader configuration writes.
import { readFile, writeFile, readdir, lstat, realpath, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loaderClient, confirmLiveSidebar } from './sidebar-loader-client.mjs';
import { LocalCodexSource } from '../src/adapters/local-codex.mjs';
import { modelCapacity } from '../src/control/levels.mjs';
import { compareVersions } from '../packaging/install-workflow.mjs';
import { profileForUpgrade, registeredCodexPackage } from './verify-native-profile.mjs';
import {validPageExport} from './rspack-usage.mjs';

const run = promisify(execFile);
const files = ['manifest.json', 'index.js', 'README.md', 'NOTICE.md', 'LICENSE'];
const {version}=JSON.parse(await readFile(new URL('../native-sidebar/manifest.json',import.meta.url),'utf8'));
const id = 'local.context-lens.sidebar';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.parse(value.toString('utf8').replace(/^\uFEFF/, ''));

export async function readPackage(directory) {
  if ((await realpath(directory)).toLowerCase() !== resolve(directory).toLowerCase()) throw Error('Unexpected redirected package directory.');
  const names = await readdir(directory);
  if (names.length !== files.length || names.some(name => !files.includes(name))) throw Error('Unexpected package files. Use Loader import.');
  const result = {};
  for (const name of files) {
    const path = join(directory, name), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unexpected package file type.');
    result[name] = await readFile(path);
  }
  return result;
}

export function bundleForLocalBuild(bundle, profile) {
  const {appVersion,asset,stateAsset,composerAsset,primaryAsset}=profile;
  if(!/^\d+\.\d+\.\d+\.\d+$/.test(appVersion))throw Error('Invalid desktop version.');
  if(profile.unsupported!==true && (!/^348410\.[0-9a-f]{10}\.js$/.test(asset) ||
    ![stateAsset,composerAsset,primaryAsset].every(name=>/^async\/\d+\.[0-9a-f]{10}\.js$/.test(name))))
    throw Error('Invalid verified desktop resource name.');
  const marker='const verifiedLocalBuild = null;', code=bundle.toString('utf8');
  if(code.split(marker).length!==2)throw Error('Bundle does not have a unique local profile slot.');
  const config=profile.unsupported===true ? {appVersion,unsupported:true} : {appVersion,asset,stateAsset,composerAsset,primaryAsset};
  if(!config.unsupported){
    for(const field of ['usageExport','hostExport']){
      if(profile[field]===undefined)continue;
      const name=profile[field];
      if(!validPageExport(name))throw Error('Invalid page export identifier.');
      config[field]=name;
    }
  }
  if(profile.preflightExports===null)config.preflightExports=null;
  return Buffer.from(code.replace(marker,()=>`const verifiedLocalBuild = ${JSON.stringify(config)};`));
}

export function bundleForModelCatalog(bundle, models) {
  const rows=[];
  for(const [slug,{defaultWindow,maxWindow,effectivePercent}] of models){
    if(!/^[A-Za-z0-9._-]{1,96}$/.test(slug))continue;
    try{modelCapacity({slug,context_window:defaultWindow,max_context_window:maxWindow,effective_context_window_percent:effectivePercent});}
    catch{continue;}
    rows.push([slug,defaultWindow,maxWindow,effectivePercent]);
  }
  rows.sort(([a],[b])=>a.localeCompare(b));
  const marker='const installedModelRows = null;', code=bundle.toString('utf8');
  if(code.split(marker).length!==2)throw Error('Missing model catalog slot.');
  return Buffer.from(code.replace(marker,()=>`const installedModelRows = ${JSON.stringify(rows)};`));
}

export function supportedInstalledSidebar(installed,targetVersion=version){
  const stable=/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
  const legacy=/^0\.1\.0-(?:alpha|beta)\.[1-9]\d*$/;
  return installed?.id===id && typeof installed.version==='string' &&
    ((stable.test(installed.version) && compareVersions(installed.version,'0.1.0')>=0) || legacy.test(installed.version)) &&
    (!installed.version.includes('-alpha.') || compareVersions(installed.version,'0.1.0-alpha.13')<=0) &&
    compareVersions(installed.version,targetVersion)<=0;
}

export async function updateSidebar({ source, target, backupRoot, loaderRunning, liveReload = null, reloadUnchanged = true, localProfile = null, modelCatalog = null, checkLive = null }) {
  if (await loaderRunning() && !liveReload) throw Error('Loader is running. Use its package import or explicit --live-reload. Nothing changed.');
  const incoming = await readPackage(source), previous = await readPackage(target);
  if(localProfile) incoming['index.js']=bundleForLocalBuild(incoming['index.js'],localProfile);
  if(modelCatalog) incoming['index.js']=bundleForModelCatalog(incoming['index.js'],modelCatalog);
  const next = json(incoming['manifest.json']), installed = json(previous['manifest.json']);
  if (next.id !== id || next.version !== version || !supportedInstalledSidebar(installed)) throw Error('Unexpected package identity/version. Nothing changed.');
  const hashes = Object.fromEntries(files.map(name => [name, hash(incoming[name])]));
  if (files.every(name => hashes[name] === hash(previous[name]))) {
    const inspection = liveReload && reloadUnchanged ? await liveReload(version) : null;
    return { version, staged: true, changed: false, loaded: inspection !== null, configChanged: false, hashes, inspection };
  }
  const backup = join(backupRoot, `sidebar-backup-${Date.now()}-${randomUUID()}`);
  if(checkLive)await checkLive();
  await mkdir(backup, { recursive: true });
  for (const name of files) await writeFile(join(backup, name), previous[name], { flag: 'wx' });
  if (await loaderRunning() && !liveReload) throw Error('Loader started during preflight. Nothing changed.');
  let inspection = null;
  try {
    for (const name of files) {
      await writeFile(join(target, name), incoming[name]);
      if (hash(await readFile(join(target, name))) !== hashes[name]) throw Error(`Hash mismatch: ${name}`);
    }
    if (liveReload) inspection = await liveReload(version);
  } catch (error) {
    const restoreErrors = [];
    for (const name of files) {
      try { await writeFile(join(target, name), previous[name]); }
      catch (restoreError) { restoreErrors.push(restoreError); }
    }
    if (restoreErrors.length) throw new AggregateError([error, ...restoreErrors], `左栏包未能完整还原，备份位于 ${backup}。首次错误：${error.message}`);
    if (liveReload) {
      try { await liveReload(installed.version); }
      catch (restoreError) {
        const failure=new AggregateError([error,restoreError], `左栏文件已还原，运行状态仍待确认。${restoreError.message} 备份位于 ${backup}`);
        failure.code=restoreError.code ?? error.code;
        throw failure;
      }
    }
    throw error;
  }
  return { version, previousVersion: installed.version, staged: true, changed: true, loaded: !!liveReload, backup, configChanged: false, hashes, inspection };
}

export async function reloadAndInspect(expectedVersion, localData) {
  const client = await loaderClient(localData);
  await confirmLiveSidebar(client.inspect);
  await client.reload();
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const response = await client.inspect();
      if (response.ok && response.result?.version === expectedVersion && response.result?.status !== 'stopped') return response.result;
    } catch { /* An in-flight reload can briefly invalidate the command. */ }
  }
  throw Error('Reload did not confirm the expected running plugin version.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw Error('This update requires Windows.');
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    // Windows user profiles may have a legitimate legacy-name junction.
    // Resolve that trusted base first; package-specific redirects still fail closed.
    const localData = await realpath(process.env.LOCALAPPDATA);
    if (process.argv.slice(2).some(arg => arg !== '--live-reload')) throw Error('Unknown update option.');
    const pkg=await registeredCodexPackage();
    const compatibility=await profileForUpgrade(pkg.version,pkg,{cachePath:join(root,'.research','launcher-profile.json'),persist:true});
    const report = await updateSidebar({
      localProfile:compatibility.profile,
      modelCatalog: await new LocalCodexSource().modelCatalog(),
      source: join(root, 'dist', `context-lens-sidebar-${version}`),
      target: join(localData, 'CodexScriptLoader', 'scripts', id),
      backupRoot: join(root, '.research'),
      checkLive: process.argv.includes('--live-reload') ? async () => confirmLiveSidebar((await loaderClient(localData)).inspect) : null,
      liveReload: process.argv.includes('--live-reload') ? expected => reloadAndInspect(expected, localData) : null,
      loaderRunning: async () => {
        const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; @(Get-Process -Name CodexScriptLoader -ErrorAction SilentlyContinue).Count"], { windowsHide: true, timeout: 10000 });
        const count = Number(stdout.trim());
        if (!Number.isInteger(count) || count < 0) throw Error('Cannot verify Loader state.');
        return count > 0;
      },
    });
    report.checkedAt = new Date().toISOString();
    await mkdir(join(root, '.research'), { recursive: true });
    await writeFile(join(root, '.research', 'sidebar-update.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
