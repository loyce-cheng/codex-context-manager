// The Loader's public commands only. No CDP, renderer evaluation or window input.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {fileURLToPath} from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const parse = value => JSON.parse(String(value).replace(/^\uFEFF/, ''));
// The v1 command protocol allows 120s for an invocation and 125s for its pipe. Killing
// this client after 5s does not cancel the host's pending invocation.
export const HOST_COMMAND_TIMEOUT_MS = 130000;
export function loaderRestartRequired(message) {
  return Object.assign(new Error(message), {code:'LOADER_RESTART_REQUIRED'});
}

// A surviving Loader process can still point at the desktop that exited during
// a Store update. Its GUI --reload command opens a modal on connection failure.
export async function confirmLiveSidebar(inspect) {
  let reply;
  try { reply=await inspect(); } catch(error) {
    if(error.code==='ENOENT'||error.code==='EACCES')throw error;
    // A client can exit without returning JSON when the command service is gone.
  }
  if(reply?.ok && reply.result?.startup==='started' && reply.result.status!=='stopped')return;
  const code=reply?.error?.code;
  if(code==='COMMAND_BUSY')throw Error('Loader 正在处理其他请求，请稍后重试。');
  if(code==='PLUGIN_NOT_FOUND')throw Error('请在 Loader 的插件列表中确认 Context Lens 已安装并启用。');
  if(code==='OPERATION_NOT_ALLOWED')throw Error('当前已安装的 Context Lens 不支持状态查询，请检查导入的插件版本。');
  throw loaderRestartRequired('Loader 尚未连上当前窗口。请保存工作并完全退出 Codex，使用“恢复 Loader”退出后台实例，再打开快捷方式。');
}
export function loaderReleaseDirectory(localData, active,install=join(localData,'Programs','CodexScriptLoader')) {
  if(active?.schemaVersion!==1 || active.launcherProtocol!==1 || active.handoffProtocol!==1 ||
      active.rid!=='win-x64' || active.entryPoint!=='CodexScriptLoader.exe' ||
      typeof active.version!=='string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(active.version)){
    throw Error('当前 Loader 安装清单的协议或 Windows 架构不兼容。');
  }
  return join(install,'versions',active.version,active.rid);
}
export async function loaderInstallDirectory(localData){
  const command="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); (Get-ItemProperty -LiteralPath 'HKCU:\\Software\\CodexScriptLoader' -Name InstallDir -ErrorAction SilentlyContinue).InstallDir; exit 0";
  const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000});
  const registered=stdout.trim();
  if(registered && (!/^[A-Za-z]:[\\/]/.test(registered)||registered.split(/[\\/]/).includes('..')))throw Error('Loader 注册的安装位置无效。');
  const shared=registered||join(localData,'Programs','CodexScriptLoader');
  return selectLoaderDirectory(shared,fileURLToPath(new URL('../dist/private-loader/',import.meta.url)));
}
export async function selectLoaderDirectory(shared,bundled){
  // A damaged existing shared installation is reported through its normal checks.
  // Only a missing shared directory permits fallback to the private offline copy.
  for(const directory of [shared,bundled]){
    try{
      if(!(await stat(directory)).isDirectory())throw Error('Loader 安装位置不是目录。');
      return directory;
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return shared;
}
export async function activeLoaderDirectory(localData,install){
  install??=await loaderInstallDirectory(localData);
  const active = parse(await readFile(join(install, 'active.json'), 'utf8'));
  return loaderReleaseDirectory(localData,active,install);
}
export async function loaderClient(localData) {
  const install = await loaderInstallDirectory(localData);
  await activeLoaderDirectory(localData,install);
  async function invoke(operation,payload) {
    const command=join(await activeLoaderDirectory(localData,install),'CodexScriptLoader.Command.exe');
    return new Promise((resolve, reject) => {
      const child = execFile(command, ['plugin', 'invoke', '--id', 'local.context-lens.sidebar', '--operation', operation],
        { windowsHide: true, timeout: HOST_COMMAND_TIMEOUT_MS, maxBuffer: 65536 }, (error, stdout) => {
          try {
            const value = parse(stdout);
            if (value.version !== 1 || typeof value.ok !== 'boolean') throw Error('Unexpected Loader response.');
            resolve(value);
          } catch (parseError) { reject(error ?? parseError); }
        });
      child.stdin.on('error', reject); child.stdin.end(JSON.stringify(payload));
    });
  }
  return {
    reload: () => run(join(install, 'CodexScriptLoader.exe'), ['--reload'], { windowsHide: true, timeout: 10000 }),
    inspect: () => invoke('inspect',{}),
    acknowledge: id => invoke('staged',{id}),
    confirmTurn: (id,capacity) => invoke('measured',{id,capacity}),
  };
}
