// Reuse the local bundled release. Never download code, re-import configuration,
// change enablement/preferences, modify firewall rules, or downgrade unknown builds.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {updateSidebar,reloadAndInspect} from './update-sidebar.mjs';
import {loaderClient,confirmLiveSidebar} from './sidebar-loader-client.mjs';
import {LocalCodexSource} from '../src/adapters/local-codex.mjs';
export async function syncSidebar({root,localData,loaderRunning,localProfile=null}) {
  const manifest=JSON.parse(await readFile(join(root,'native-sidebar','manifest.json'),'utf8'));
  const running=await loaderRunning();
  if(running)await confirmLiveSidebar((await loaderClient(localData)).inspect);
  return updateSidebar({
    modelCatalog:await new LocalCodexSource().modelCatalog(),
    source:join(root,'dist',`context-lens-sidebar-${manifest.version}`),
    target:join(localData,'CodexScriptLoader','scripts','local.context-lens.sidebar'),
    backupRoot:join(root,'.research'),loaderRunning,reloadUnchanged:false,localProfile,
    liveReload:running?version=>reloadAndInspect(version,localData):null,
  });
}
