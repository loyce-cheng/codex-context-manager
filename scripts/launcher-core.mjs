// Testable launch policy. Never stops an existing process or edits app settings.
import {loaderRestartRequired} from './sidebar-loader-client.mjs';
export async function launchSidebar(inventory, { checkOnly = false, expectedVersion, knownVersions, startLoader, ensure, prepare }) {
  const report={...inventory,checkOnly,knownAppVersion:knownVersions.includes(inventory.appVersion),startedLoader:false};
  if(checkOnly)return report;
  if(inventory.codexRunning&&!inventory.loaderRunning)
    throw loaderRestartRequired('Codex 正在运行，但 Loader 未运行。请保存工作并手动完全退出，再点击“Codex + Context Lens”。');
  if(inventory.loaderRunning&&!inventory.codexRunning)
    throw loaderRestartRequired('Loader 仍在运行，尚未检测到 Codex 桌面。若窗口一直没有打开，请用“恢复 Loader”打开诊断窗口并选择 Exit Loader，然后重新打开快捷方式。');
  if(prepare){
    const update=await prepare();
    report.packageSync={version:update.version,changed:update.changed,loaded:update.loaded,configChanged:update.configChanged};
  }
  if(!inventory.loaderRunning){await startLoader();report.startedLoader=true;}
  const ready=await ensure(expectedVersion);
  report.ready=ready.ready;report.reloaded=ready.reloaded;
  report.loaded=ready.loaded;report.stage=ready.stage;
  const notices={'waiting-for-chat':'左栏已载入，正在等待本地对话。当前对话恢复或打开已有对话后会自动显示读数。','waiting-for-usage':'已识别当前对话，正在等待 Codex 返回用量。','space-unavailable':'已读取容量，左栏空间不足，细条暂时隐藏。'};
  if(notices[ready.stage])report.notice=notices[ready.stage];
  report.renderer={version:ready.inspection.version,status:ready.inspection.status,layoutOK:ready.inspection.layoutOK};
  if(!report.knownAppVersion||ready.inspection.status==='unsupported'){
    report.compatibility='requires-adapter-validation';
    report.warning='Context Lens 已载入，当前窗口的用量接口尚未通过校验。请查看“查看状态”并检查 Context Lens 更新。Codex 可以继续使用。';
  }
  return report;
}
