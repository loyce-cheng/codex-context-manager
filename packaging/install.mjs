import { readdir, access, stat } from 'node:fs/promises';
import { join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { installPlugin } from './install-workflow.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function findCodex() {
  const candidates = [];
  if (process.env.CONTEXT_LENS_CODEX) candidates.push(resolve(process.env.CONTEXT_LENS_CODEX));
  const base = join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  try {
    const dirs = await readdir(base, { withFileTypes: true });
    const installed = await Promise.all(dirs.filter(d => d.isDirectory()).map(async d => ({ path: join(base, d.name, 'codex.exe'), time: (await stat(join(base, d.name))).mtimeMs })));
    candidates.push(...installed.sort((a,b) => b.time-a.time).map(d => d.path));
  } catch {}
  for (const folder of (process.env.PATH || '').split(delimiter)) if(folder) candidates.push(join(folder, 'codex.exe'));
  for (const path of candidates) { try { await access(path); return path; } catch {} }
  throw new Error('找不到 Codex CLI。请先安装并运行 Codex 桌面版；也可设置 CONTEXT_LENS_CODEX 指向 codex.exe。');
}
function run(executable, args, {capture=false}={}) {
  return new Promise((resolve,reject) => {
    const child = spawn(executable,args,{stdio:['ignore','pipe','pipe'],windowsHide:true,cwd:root,shell:false});
    let output='',error='';child.stdout.on('data',data=>{output+=data;if(!capture)process.stdout.write(data);});child.stderr.on('data',data=>{error+=data;if(!capture)process.stderr.write(data);});
    child.once('error',reject); child.once('exit',code => code===0 ? resolve(output) : reject(new Error('Codex 命令失败，退出码 '+code+(error?'：'+error.trim():''))));
  });
}
try {
  if(process.platform!=='win32') throw new Error('此发行包仅支持 Windows。');
  const codex = await findCodex();
  if(process.argv.includes('--remove')) {
    await run(codex,['plugin','remove','context-lens@context-lens-local']);
    process.stdout.write('插件已卸载。安装目录可自行保留或删除。\n');
  } else {
    await installPlugin({root,home:process.env.CODEX_HOME||join(homedir(),'.codex'),run:args=>run(codex,args,{capture:true}),onMessage:message=>process.stdout.write(message+'\n')});
    process.stdout.write('\n插件登记已完成。可在 Codex 插件页查看启用状态。若当前对话未加载新工具，请刷新插件连接或新开对话；宿主要求时需重启。\n直接运行 Start.cmd 跟随当前本地对话（包括已有对话），或用 Follow-New.cmd 限定为启动后新建的对话。保持启动窗口运行；信号超时会暂停显示。原生侧栏停靠和热扩容仍未实现。\n');
  }
} catch(error) {
  process.stderr.write(error.message+'\n');
  if(/failed to back up plugin cache entry|os error 5|拒绝访问/i.test(error.message))process.stderr.write('缓存可能被正在运行的插件进程占用，或目录权限拒绝访问。请退出 Codex（包括托盘）和本插件的启动窗口，再运行最新版 Install.cmd。无需先删除缓存或以管理员身份重装。\n');
  process.exitCode=1;
}
