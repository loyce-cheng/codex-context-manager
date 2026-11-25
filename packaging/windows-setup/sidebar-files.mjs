import {lstat,readFile,mkdir,mkdtemp,realpath,rename,rmdir,unlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readPackage,supportedInstalledSidebar} from '../../scripts/update-sidebar.mjs';

const pluginId='local.context-lens.sidebar';
const ownerFile='installer-sidebar-owner.json';

async function exists(path){
  try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}
}
async function plainDirectory(path){
  if((await realpath(path)).toLowerCase()!==resolve(path).toLowerCase())throw Error('目录存在重定向：'+path);
}
function sameBundle(actual,base){
  if(actual.equals(base))return true;
  let text=actual.toString('utf8');
  for(const slot of ['verifiedLocalBuild','installedModelRows']){
    text=text.replace(new RegExp('^const '+slot+' = (.+);$','m'),(line,value)=>{
      try{JSON.parse(value);return 'const '+slot+' = null;';}catch{return line;}
    });
  }
  return text===base.toString('utf8');
}

export async function manageSidebarFiles(action,{localData,root}){
  if(!['install','uninstall'].includes(action))throw Error('Unknown installer operation.');
  const marker=join(root,ownerFile);
  if(action==='uninstall' && !await exists(marker))return 'preexisting';
  const local=await realpath(localData),data=join(local,'CodexScriptLoader'),scripts=join(data,'scripts'),target=join(scripts,pluginId);
  const {version}=JSON.parse(await readFile(join(root,'native-sidebar','manifest.json'),'utf8'));
  const files=await readPackage(join(root,'dist','context-lens-sidebar-'+version));
  const manifest=JSON.parse(files['manifest.json']);
  if(manifest.id!==pluginId||manifest.version!==version)throw Error('安装包身份不匹配。');
  for(const dir of [data,scripts]){
    if(!await exists(dir)){
      if(action==='uninstall')return 'absent';
      await mkdir(dir,{recursive:true});
    }
    await plainDirectory(dir);
  }
  if(action==='uninstall'){
    if(await readFile(marker,'utf8')!==pluginId)throw Error('无法确认此插件由本安装器创建。');
    if(!await exists(target))return 'absent';
    let installed;
    try{installed=await readPackage(target);}catch{return 'modified';}
    if(!Object.keys(files).every(n=>n==='index.js'?sameBundle(installed[n],files[n]):installed[n].equals(files[n])))return 'modified';
    // Move out of the Loader registry before removing this exact five-file package.
    const temp=await mkdtemp(join(data,'lens-uninstall-'));
    const moved=join(temp,'package');
    await rename(target,moved);
    for(const name of Object.keys(files))await unlink(join(moved,name));
    await rmdir(moved);await rmdir(temp);await unlink(marker);
    return 'removed';
  }
  if(await exists(target)){
    const current=JSON.parse((await readPackage(target))['manifest.json']);
    if(!supportedInstalledSidebar(current))
      throw Error('已安装左栏的身份或版本与安装包不兼容。');
    return 'preserved';
  }
  const temp=await mkdtemp(join(data,'lens-install-'));
  let moved=false;
  try{
    for(const [name,bytes] of Object.entries(files))await writeFile(join(temp,name),bytes,{flag:'wx'});
    await rename(temp,target);moved=true;
    await writeFile(marker,pluginId);
    return 'created';
  }catch(error){
    try{
      if(moved)await rename(target,temp);
      for(const name of Object.keys(files))await unlink(join(temp,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});
      await rmdir(temp);
    }catch(rollback){
      throw new AggregateError([error,rollback],`左栏安装失败：${error.message}；回滚失败：${rollback.message}。请核对 ${target} 和 ${temp}`,{cause:error});
    }
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const root=fileURLToPath(new URL('../../',import.meta.url));
    const state=await manageSidebarFiles(process.argv[2],{root,localData:process.argv[3]??process.env.LOCALAPPDATA});
    console.log(state);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
