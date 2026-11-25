import {resolve} from 'node:path';

// A packaged desktop may update independently of both the backend and Loader.
// Only report a successful fallback after the normal launcher's readiness check.
export async function startMonitorAfterUpdate({version,reason,env,experimentalBinary,start,save,waitForExit}){
  const monitorEnv={...env};
  delete monitorEnv.CONTEXT_LENS_DESKTOP_TIERS;
  delete monitorEnv.LENS_EXPECTED_DESKTOP;
  if(monitorEnv.CODEX_CLI_PATH &&
      resolve(monitorEnv.CODEX_CLI_PATH).toLowerCase()===resolve(experimentalBinary).toLowerCase()){
    delete monitorEnv.CODEX_CLI_PATH;
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
  return message+reason+' 更新后的单对话扩容尚待验证，原有档位已保留。';
}
