// Startup readiness check after the user launches Loader. Never launches/closes Codex.
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loaderClient } from './sidebar-loader-client.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function sidebarReadiness(result) {
  if(result?.startup!=='started'||result.status==='stopped')return null;
  if(result.status==='unsupported')return 'unsupported';
  const d=result.diagnostics;
  const reading=result.status==='following'&&uuid.test(result.threadId??'')&&Number.isSafeInteger(result.capacity)&&result.capacity>0&&
    Number.isFinite(result.percent)&&result.percent>=0&&result.percent<=100&&d?.selection==='ready'&&d.host==='local';
  if(reading)return result.layoutOK===true?'following':'space-unavailable';
  if(result.layoutOK!==true||!(d?.visibleComposerCount>0))return null;
  if(result.status==='waiting'&&d.selection==='ready'&&d.host==='local')return 'waiting-for-usage';
  if(result.status==='unavailable'&&d.selection==='unavailable')return 'waiting-for-chat';
  return null;
}

export async function ensureSidebar({ inspect, reload, allowReload = true, expectedVersion, wait = sleep, now = Date.now, timeoutMs = 190000, maxAttempts = 120, onProgress = () => {} }) {
  const deadline = now() + timeoutMs;
  let stable = 0, reloaded = false, lastCode = null, previousStage=null, lastProgress=null;
  let stageSince=now();
  const progress=stage=>{if(stage!==lastProgress){lastProgress=stage;try{onProgress(stage);}catch{}}};
  progress('checking');
  for (let i = 0; i < maxAttempts && now() < deadline; i++) {
    let response;
    try { response = await inspect(); }
    catch { response = { ok: false, error: { code: 'HOST_UNAVAILABLE' } }; }
    if (response.ok) {
      const result = response.result;
      if (result?.version !== expectedVersion) throw Error('Installed sidebar version differs from this project. Update/import the matching package first.');
      if (result.startup === 'failed') throw Error('Sidebar startup failed. Run Diagnose-Sidebar.cmd.');
      const stage=sidebarReadiness(result);
      lastCode=stage??'PAGE_NOT_READY';progress(stage??'loading-page');
      if(stage!==previousStage)stageSince=now();
      stable=stage&&stage===previousStage?stable+1:stage?1:0;previousStage=stage;
      const grace=stage==='following'?0:stage==='unsupported'?15000:5000;
      if(stable>=3&&now()-stageSince>=grace)
        return {ready:stage==='following',loaded:true,stage,reloaded,inspection:result};
    } else {
      stable = 0; previousStage=null; lastCode = response.error?.code ?? 'UNKNOWN';
      progress(lastCode==='COMMAND_BUSY'?'host-busy':'loading-plugin');
      // This code follows successful host/runtime checks, but the page's record
      // may have disappeared during Codex's initial renderer navigation.
      // Never call --reload on COMMAND_UNAVAILABLE: Loader may still be starting.
      if (lastCode === 'PLUGIN_COMMAND_FAILED' && allowReload && !reloaded) { progress('recovering-plugin');await reload(); reloaded = true; }
    }
    // Busy may belong to another plugin: never interrupt it with an automatic reload.
    await wait(lastCode==='COMMAND_BUSY'?3000:1000);
  }
  throw Error(`Sidebar readiness not confirmed (${lastCode ?? 'starting'}). Run Diagnose-Sidebar.cmd.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  try {
    if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw Error('Windows is required.');
    const expected = JSON.parse(await readFile(join(root, 'native-sidebar', 'manifest.json'), 'utf8'));
    const client = await loaderClient(await realpath(process.env.LOCALAPPDATA));
    const result = await ensureSidebar({ ...client, expectedVersion: expected.version });
    await mkdir(join(root, '.research'), { recursive: true });
    await writeFile(join(root, '.research', 'sidebar-startup.json'), JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2) + '\n');
    console.log(`Sidebar ${result.stage}: ${result.inspection.version}; reading=${result.ready}; layout=${result.inspection.layoutOK}; recovered=${result.reloaded}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
