import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loaderClient} from './sidebar-loader-client.mjs';
import {sidebarReadiness} from './ensure-sidebar.mjs';
import {inspectUpgrade,describeUpgrade} from './upgrade-status.mjs';

export function describeSidebar(response){
  if(!response?.ok){
    switch(response?.error?.code){
      case 'COMMAND_BUSY':return 'Loader 正忙，稍后再查看状态。';
      case 'PLUGIN_NOT_FOUND':return 'Loader 已连接。请在插件列表中检查 Context Lens 是否已安装并启用。';
      case 'PLUGIN_NOT_RUNNING':return 'Loader 已连接，Context Lens 尚未运行。请检查插件启用状态。';
      case 'COMMAND_UNAVAILABLE':return 'Loader 正在连接桌面。请等窗口加载完成后重试。';
      default:return '未取得 Loader 的状态。若更新后已有 Loader 在后台，请用“恢复 Loader”打开原生诊断窗口。';
    }
  }
  const v=response.result;
  if(!v || v.startup!=='started')return '插件尚未就绪。请在窗口加载完成后重试。';
  const stage=sidebarReadiness(v);
  if(stage==='unsupported')return '插件已载入，当前 Codex 版本的用量接口尚未适配。';
  if(v.diagnostics?.visibility==='hidden')return '当前受检窗口在后台。请切回目标 Codex 窗口再查看。';
  if(v.layoutProblem==='rail')return '未找到可停靠的左栏。请展开左侧导航栏。';
  if(stage==='space-unavailable'||v.layoutProblem==='space')return '左栏空间不足，窄条已隐藏。请增大窗口高度或收起其他左栏项目。';
  if(stage==='following')return '正在跟随当前对话。有效容量 '+Number((v.capacity/1000).toFixed(1))+'k，剩余 '+Math.round(v.percent)+'%。';
  if(stage==='waiting-for-usage')return '已识别当前对话，正在等待 Codex 返回用量。';
  if(v.diagnostics?.selection==='ambiguous')return '当前窗口有多个候选对话。请聚焦主对话后再查看。';
  if(stage==='waiting-for-chat'||v.status==='unavailable')return '正在等待本地对话恢复。也可以打开一条已有的本地对话。';
  if(v.status==='failed')return '当前用量读取失败，插件正在重试。';
  return '页面正在恢复，暂时还没有可显示的读数。';
}

async function liveNotice(){
  let notice;
  try{
    const client=await loaderClient(process.env.LOCALAPPDATA);
    notice=describeSidebar(await client.inspect());
  }catch(error){
    notice=error.code==='ENOENT'?'未找到 Loader 安装文件。请检查本机安装。':describeSidebar(null);
  }
  return notice;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.includes('--compat')){
    const result=await inspectUpgrade();
    console.log(JSON.stringify({...result,description:describeUpgrade(result)},null,2));
  }else{
    const [notice,result]=await Promise.all([liveNotice(),inspectUpgrade()]);
    console.log('[notice] '+notice+' '+describeUpgrade(result));
  }
}
