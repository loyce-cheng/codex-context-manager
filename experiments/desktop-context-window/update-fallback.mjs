import {resolve} from 'node:path';

// A packaged desktop may update independently of both the backend and Loader.
// Only report a successful fallback after the normal launcher's readiness check.
export async function startMonitorAfterUpdate({version,reason,env,experimentalBinary,start,save,waitForExit,checkStockResume}){
  const monitorEnv={...env};
  for (const [key,value] of Object.entries(monitorEnv)) {
    const name=key.toUpperCase();
    if (name==='CONTEXT_LENS_DESKTOP_TIERS' || name==='LENS_EXPECTED_DESKTOP' ||
        (name==='CODEX_CLI_PATH' && value && resolve(value).toLowerCase()===resolve(experimentalBinary).toLowerCase())) {
      delete monitorEnv[key];
    }
  }
  let report;
  try { report=await start(monitorEnv); }
  catch(error) {
    if(error.code!=='LOADER_RESTART_REQUIRED' || !waitForExit)throw error;
    if(!await waitForExit())return null;
    report=await start(monitorEnv);
  }
  const knownStage=['following','waiting-for-chat','waiting-for-usage','space-unavailable'].includes(report?.stage);
  if(!knownStage || report.loaded!==true || report.ready!==(report.stage==='following') ||
      (!report.ready && !report.notice))throw Error('尚未确认左栏状态，请查看启动记录。');
  const readingReady=report.ready || report.stage==='space-unavailable';
  await save({stage:'monitor-only',appVersion:version,reason,bridgeStarted:false,monitorStage:report.stage,readingReady});
  const message=report.ready?'普通左栏已读取当前对话容量。':report.notice;
  if(checkStockResume){
    try{return message+await checkStockResume(version);}
    catch{return message+' 未能完成官方后台兼容检查，已保留本对话的预设。';}
  }
  return message+reason+' 更新后的单对话扩容尚待验证，原有档位已保留。';
}
