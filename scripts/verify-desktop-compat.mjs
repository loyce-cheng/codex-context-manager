// Maintainer check. All desktop/model probes use isolated profiles.
import {execFile,spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {registeredCodexPackage,registeredAsar,inspectProfile} from './verify-native-profile.mjs';
import {peContentHash} from './pe-content-hash.mjs';
import {cliVersion,experimentalLoaderFor,verifyExperimentalLoader,verifyExperimentalCli,verifyLoaderBuild} from '../experiments/desktop-context-window/loader/release.mjs';
import {ensureCodeModeHost} from '../experiments/desktop-context-window/code-mode-host.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const research=join(root,'.research');
await mkdir(research,{recursive:true});
const directory=await mkdtemp(join(research,'desktop-compat-'));
const reportPath=join(directory,'compatibility.json');
const report={outcome:'incomplete',checkedAt:new Date().toISOString(),checks:{}};
const payloads={
  'codex.exe':'0754956a444e61e1620b251a7c33f30e8c97e31295cd1bfd79c0d0b5113715bf',
  'codex-code-mode-host.exe':'16eadecd755c5125e17b2721faeb88722d86eeaf4c0849765a90397b5bb492af',
};
try{
  const args=process.argv.slice(2);
  const candidate=args.find(arg=>/^--candidate-sha256=[0-9a-f]{64}$/.test(arg));
  if(args.some(arg=>arg!=='--browser' && arg!==candidate))throw Error('Use --browser or --candidate-sha256=<64 lowercase hex digits>.');
  const pkg=await registeredCodexPackage(),asar=registeredAsar(pkg.version,pkg),resources=dirname(asar);
  report.desktopVersion=pkg.version;
  console.log('检查官方后台、工具宿主与桌面资源…');
  report.checks.components={};
  for(const [name,baseline] of Object.entries(payloads)){
    const hash=await peContentHash(join(resources,name));
    report.checks.components[name]={hash,matchesBaseline:hash===baseline};
  }
  if(Object.values(report.checks.components).some(r=>!r.matchesBaseline))throw Error('官方程序内容已变化，请先复核后台基线。');
  const profile=await inspectProfile(pkg.version,{asar,discover:true});
  report.checks.page=profile.checks;
  if(candidate){
    const folder=pkg.version==='26.1117.3838.0'?'experimental-loader-0.6.2':'experimental-loader-0.6.2-'+pkg.version;
    await verifyLoaderBuild(join(root,'dist',folder),candidate.split('=')[1]);
  }else{
    if(!experimentalLoaderFor(pkg.version))throw Error('此版本还没有登记的实验构建。可用 --candidate-sha256 检查已准备的候选包。');
    await verifyExperimentalLoader(process.env.LOCALAPPDATA,pkg.version);
  }
  const binary=join(root,'dist','experimental-backend-'+cliVersion,'codex.exe');
  await verifyExperimentalCli(binary);
  await ensureCodeModeHost(resources,dirname(binary),{checkOnly:true});
  console.log('检查隔离桌面实际启动的后台…');
  const hostReport=join(directory,'desktop.json');
  const child=spawn('pwsh.exe',['-NoProfile','-NonInteractive','-File',join(root,'experiments/desktop-context-window/probe-desktop-host.ps1'),
    '-Cli',binary,'-Activation','built','-CandidateVersion',pkg.version,'-ReportPath',hostReport],{cwd:root,stdio:'ignore',windowsHide:true});
  const code=await new Promise((ok,fail)=>{child.once('error',fail);child.once('close',ok);});
  report.checks.desktop=await readFile(hostReport,'utf8').then(JSON.parse).catch(()=>null);
  const host=report.checks.desktop;
  if(code!==0 || host?.desktopVersion!==pkg.version || !host.candidateObserved || !host.backendStayedUp ||
    host.packagedBackendObserved || !host.testInstanceExited)throw Error('隔离桌面启动检查未通过，请检查 PowerShell 7 及候选 Loader。');
  console.log('检查 A、B 两条对话的下一回合容量和恢复默认…');
  const {stdout}=await promisify(execFile)(process.execPath,[join(root,'scripts/probe-capacity-protocol.mjs'),binary,
    '--desktop-cli','--loaded-window=patched','--complete','--desktop-tiers',...(args.includes('--browser')?['--sidebar-browser']:[])],
    {cwd:root,windowsHide:true,maxBuffer:1024*1024});
  const result=JSON.parse(stdout);
  report.checks.dualChat=result.loadedWindow;
  if(result.externalModelRequestsSent!==0 || result.server!==cliVersion || result.fixtureRequestCount!==8 ||
    !result.loadedWindow?.bothStillLoaded || result.loadedWindow.globalWindow!==null)throw Error('双对话隔离检查未通过。');
  if((await registeredCodexPackage()).version!==pkg.version)throw Error('验证期间 Codex 已更新，请重新运行。');
  report.outcome='passed';
}catch(error){
  report.outcome='failed';
  let probeError;
  if(typeof error.stdout==='string'){
    try{
      const partial=JSON.parse(error.stdout);
      report.checks.dualChat=partial.loadedWindow;
      probeError=partial.error;
    }catch{ /* Some process failures occur before a fixture report exists. */ }
  }
  report.reason=String(probeError || error.message || error.code || 'failed').split('\n')[0];
  console.error('未通过：'+report.reason);process.exitCode=1;
}finally{
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(report.outcome+' · '+reportPath);
}
