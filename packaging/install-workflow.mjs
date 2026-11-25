import {readFile,readdir,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';

const MARKET='context-lens-local',PLUGIN='context-lens',ID=PLUGIN+'@'+MARKET;
const samePath=(a,b)=>resolve(a).toLowerCase()===resolve(b).toLowerCase();
export function compareVersions(a,b){
  const parse=v=>{const m=/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);if(!m)throw new Error('无法比较插件版本：'+v);return{core:m.slice(1,4).map(BigInt),pre:m[4]?.split('.')};};
  const x=parse(a),y=parse(b);
  for(let i=0;i<3;i++)if(x.core[i]!==y.core[i])return x.core[i]>y.core[i]?1:-1;
  if(!x.pre||!y.pre)return x.pre?-1:y.pre?1:0;
  for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){
    const p=x.pre[i],q=y.pre[i];if(p===q)continue;if(p===undefined)return-1;if(q===undefined)return 1;
    const pn=/^\d+$/.test(p),qn=/^\d+$/.test(q);
    if(pn&&qn){const n=BigInt(p),m=BigInt(q);if(n===m)continue;return n>m?1:-1;}
    if(pn!==qn)return pn?-1:1;return p>q?1:-1;
  }return 0;
}
async function inventory(root){
  const files=[];
  async function walk(relative=''){
    const dir=join(root,relative),info=await lstat(dir);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('插件目录不可使用链接：'+dir);
    for(const item of await readdir(dir,{withFileTypes:true})){
      const path=join(relative,item.name);if(item.isSymbolicLink())throw new Error('插件文件不可使用链接：'+path);
      if(item.isDirectory())await walk(path);else if(item.isFile())files.push(path);else throw new Error('插件含非普通文件：'+path);
    }
  }await walk();return files.sort();
}
async function digest(path){const hash=createHash('sha256');for await(const data of createReadStream(path))hash.update(data);return hash.digest('hex');}
export async function samePackage(source,cache){
  let a,b;try{[a,b]=await Promise.all([inventory(source),inventory(cache)]);}catch(e){if(e.code==='ENOENT')return false;throw e;}
  if(JSON.stringify(a)!==JSON.stringify(b))return false;
  for(const file of a)if(await digest(join(source,file))!==await digest(join(cache,file)))return false;
  return true;
}

/** Check versions/content before changing the catalog; roll the catalog back if installation fails. */
export async function installPlugin({root,home,run,onMessage=()=>{}}){
  const source=join(root,'plugins',PLUGIN),manifest=JSON.parse(await readFile(join(source,'plugin.json'),'utf8'));
  if(manifest.name!==PLUGIN)throw new Error('安装包名称不匹配。');
  compareVersions(manifest.version,manifest.version);
  const market=JSON.parse(await run(['plugin','marketplace','list','--json']));
  const previous=market.marketplaces?.find(m=>m.name===MARKET);
  const listed=JSON.parse(await run(['plugin','list','--marketplace',MARKET,'--json']));
  const installed=listed.installed?.find(p=>p.pluginId===ID);
  if(installed&&compareVersions(installed.version,manifest.version)>0)throw new Error(`已安装 ${installed.version}，此安装器为 ${manifest.version}。已阻止降级，插件源未改动。请使用新版目录的 Install.cmd。`);
  const reuse=installed?.version===manifest.version&&await samePackage(source,join(home,'plugins','cache',MARKET,PLUGIN,manifest.version));
  const replacing=previous?.root&&!samePath(previous.root,root),adding=!previous||replacing;
  if(replacing){
    const catalog=JSON.parse(await readFile(join(previous.root,'.agents','plugins','marketplace.json'),'utf8'));
    if(catalog.name!==MARKET||catalog.plugins?.length!==1||catalog.plugins[0].name!==PLUGIN)throw new Error('同名插件源不是 Context Lens 的单插件目录，未更改。');
  }
  let removed=false,added=false;
  try{
    if(replacing){await run(['plugin','marketplace','remove',MARKET,'--json']);removed=true;}
    if(adding){await run(['plugin','marketplace','add',root,'--json']);added=true;}
    if(reuse)onMessage(`已安装 ${manifest.version}，完整文件校验一致，跳过缓存替换。`);
    else await run(['plugin','add',ID,'--json']);
    return {version:manifest.version,reused:!!reuse,catalogChanged:!!adding};
  }catch(error){
    if(removed||added){
      try{
        const current=JSON.parse(await run(['plugin','marketplace','list','--json'])).marketplaces?.find(m=>m.name===MARKET);
        if(current&&!samePath(current.root,root))throw new Error('插件源已被其他操作改变，未覆盖');
        if(current)await run(['plugin','marketplace','remove',MARKET,'--json']);
        if(previous?.root)await run(['plugin','marketplace','add',previous.root,'--json']);
        onMessage('安装未完成，已恢复之前的插件源。');
      }catch(rollback){throw new Error(error.message+'\n插件源恢复失败：'+rollback.message);}
    }
    throw error;
  }
}
