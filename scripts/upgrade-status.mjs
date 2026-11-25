import {access} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {activeLoaderDirectory,loaderInstallDirectory} from './sidebar-loader-client.mjs';
import {registeredCodexPackage,profileForUpgrade} from './verify-native-profile.mjs';
import {experimentalLoaderFor,verifyExperimentalLoader,verifyExperimentalCli,cliVersion} from '../experiments/desktop-context-window/loader/release.mjs';
import {inspectCodeModeHost} from '../experiments/desktop-context-window/code-mode-host.mjs';
import {readStockResumeResult,describeStockResume} from './verify-stock-resume.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const messages={
  'unknown-desktop':'无法确认已注册的 Codex 桌面版本。',
  'loader-unavailable':'Loader 缺失或安装描述不兼容，请先修复 Loader。',
  'unsupported-page':'左栏的对话或用量接口已变化，需要更新页面适配。',
  'usage-only':'新版页面支持读取容量，调档所需字段尚待适配。',
  'unverified-desktop':'此桌面版本可使用普通监控，实验扩容等待该版本的验收。',
  'monitor-install':'此安装提供普通监控，可运行安装器追加实验组件。',
  'unverified-loader':'此 Loader 版本可使用普通监控，实验组合尚待验收。',
  'repair-experiment':'实验组件缺失或文件校验失败，请修复实验安装。',
  'experimental':'版本组合已经验收，实验文件校验通过，可从实验快捷方式启动。',
};

// This check never starts a desktop, imports a script, reloads a page, or submits a turn.
export async function inspectUpgrade({
  localData=process.env.LOCALAPPDATA,packageInfo=registeredCodexPackage,
  stockResult=version=>readStockResumeResult({expectedDesktop:version}),
  pageProfile=(version,pkg)=>profileForUpgrade(version,pkg,{cachePath:join(root,'.research','launcher-profile.json')}),
  findLoader=async()=>{
    const install=await loaderInstallDirectory(localData),active=await activeLoaderDirectory(localData,install);
    await Promise.all([join(install,'CodexScriptLoader.exe'),join(active,'CodexScriptLoader.exe'),join(active,'CodexScriptLoader.Command.exe')].map(path=>access(path)));
    return active;
  },
  experimentInstalled=async()=>{
    try{await access(join(root,'dist','launcher','Context-Lens-Experimental.exe'));return true;}
    catch(error){if(error.code==='ENOENT')return false;throw error;}
  },
  checkBuild=async(pkg,active)=>{
    await verifyExperimentalLoader(localData,pkg.version,active);
    const dir=join(root,'dist','experimental-backend-'+cliVersion);
    await verifyExperimentalCli(join(dir,'codex.exe'));
    return inspectCodeModeHost(join(pkg.location,'app','resources'),dir);
  },
}={}){
  const result={desktop:null,loader:null,page:null,mode:'unknown-desktop'};
  let pkg;
  try{
    pkg=await packageInfo();
    if(!/^\d+\.\d+\.\d+\.\d+$/.test(pkg.version))return result;
    result.desktop=pkg.version;
    result.page=(await pageProfile(pkg.version,pkg)).mode;
  }catch{return result;}
  let active;
  try{active=await findLoader();result.loader=basename(dirname(active));}
  catch{return {...result,mode:'loader-unavailable'};}
  if(result.page==='unsupported')return {...result,mode:'unsupported-page'};
  if(result.page==='usage-only')return {...result,mode:'usage-only'};
  async function unverified(mode){
    let check;
    try{check=await stockResult(pkg.version);}catch{/* Status remains available without a readable cache. */}
    return {...result,mode,...(check?{stockResume:check.outcome}:{})};
  }
  if(!experimentalLoaderFor(pkg.version))return unverified('unverified-desktop');
  try{
    if(!await experimentInstalled())return {...result,mode:'monitor-install'};
    return {...result,mode:'experimental',toolHost:await checkBuild(pkg,active)};
  }catch(error){
    return error.code==='UNVERIFIED_VERSION'?unverified('unverified-loader'):{...result,mode:'repair-experiment'};
  }
}

export function describeUpgrade(result){
  const components=[result.desktop && 'Codex '+result.desktop,result.loader && 'Loader '+result.loader].filter(Boolean);
  return (components.length?components.join(' / ')+'。':'')+
    (result.stockResume?describeStockResume({outcome:result.stockResume}):messages[result.mode]);
}
