import { mkdtemp, writeFile, rename, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalCodexSource, assertThreadId, within } from '../adapters/local-codex.mjs';
import { widgetHtml } from './service.mjs';
import { DesktopFollower } from '../adapters/desktop-follow.mjs';
import { VERSION } from '../core/context.mjs';

/** Port-free fallback. Only the chosen thread's whitelisted snapshot is written. */
export async function startFile({ source = new LocalCodexSource(), threadId, follower=null, intervalMs = follower?500:1500 } = {}) {
  if(!follower)assertThreadId(threadId);
  const folder = await mkdtemp(join(tmpdir(), 'context-lens-view-'));
  const htmlPath = join(folder, 'index.html'), dataPath = join(folder, 'snapshot.js'), temporary = join(folder, 'snapshot.tmp');
  let timer, stopped = false, running = Promise.resolve();
  const refresh = async () => {
    let data;
    try {
      data = follower?await follower.read():{ version:VERSION, snapshot: await source.snapshot(threadId), capabilities: source.capabilities(), threadId, generatedAt: Date.now(), fileMode: true,
        threads: [{ threadId, label: '固定会话 · '+threadId.slice(0,8) }] };
    } catch (error) { data = { error: error.message, generatedAt: Date.now() }; }
    await writeFile(temporary, 'window.__contextLensFile = '+JSON.stringify(data).replace(/</g,'\\u003c')+';\n');
    for(let attempt=0;;attempt++){
      try{await rename(temporary,dataPath);break;}
      catch(error){
        if(attempt>=2 || !['EPERM','EBUSY'].includes(error.code))throw error;
        await delay(30*(attempt+1));
      }
    }
  };
  async function clean(){
    try{await follower?.close();}
    finally{
      if(!within(resolve(tmpdir()),resolve(folder)))throw new Error('Invalid temporary output directory');
      for(const file of [htmlPath,dataPath,temporary])await rm(file,{force:true});
      await rmdir(folder);
    }
  }
  try{
    await follower?.start();
    await refresh();
    await writeFile(htmlPath,await widgetHtml());
  }catch(error){
    try{await clean();}catch(cleanup){throw new AggregateError([error,cleanup],'File monitor initialization and cleanup failed');}
    throw error;
  }
  const schedule = () => { if(!stopped) timer=setTimeout(()=>{running=refresh().catch(()=>{}).finally(schedule);},intervalMs); };
  schedule();
  return {
    path: htmlPath, url: pathToFileURL(htmlPath).href,
    async close() {
      if(stopped)return;
      stopped=true;clearTimeout(timer);await running;await clean();
    },
  };
}

export async function launchFile(args = process.argv.slice(2)) {
  const source=new LocalCodexSource(),index=args.indexOf('--thread');let threadId=index>=0?args[index+1]:null;
  const followNew=args.includes('--follow-new'),followActive=args.includes('--follow-active'),following=followNew||followActive;
  if((following&&threadId)||(followNew&&followActive))throw new Error('请只选择一种监控模式。');
  if(!threadId&&!following){
    const threads=await source.listThreads();if(!threads.length)throw new Error('未找到本地会话。');
    process.stdout.write('选择要监控的会话（日期与 ID；不会自动跟随原生切换）：\n');
    threads.forEach((t,i)=>process.stdout.write(`${i+1}. ${t.label}\n`));
    const input=createInterface({input:process.stdin,output:process.stdout});
    try{const selected=Number(await input.question('输入序号：'));if(!Number.isInteger(selected)||selected<1||selected>threads.length)throw new Error('序号无效，请重新打开。');threadId=threads[selected-1].threadId;}finally{input.close();}
  }
  const app=await startFile({source,threadId,follower:following?new DesktopFollower({source,scope:followActive?'active':'new'}):null});
  process.stdout.write(`Context Lens ${VERSION}\n`);
  if(followNew)process.stdout.write('已启用实验性自动跟随：登记启动后新建的对话；右击监控可选择窗口。页面信号超时后暂停显示。\n');
  if(followActive)process.stdout.write('已启用实验性当前对话跟随：已有和新对话均可跟随。请在 Codex 切换一次对话以确认页面；无有效信号时暂停。\n');
  process.stdout.write(`Context Lens：${app.url}\n保持此窗口打开，Ctrl+C 停止。快照只在本机临时目录中。\n`);
  if(!args.includes('--no-open')){
    if(process.platform!=='win32')throw new Error('自动打开暂只支持 Windows；可手动打开上述文件。');
    const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',app.url],{windowsHide:true,stdio:'ignore',shell:false});
    child.on('error',error=>process.stderr.write(error.message+'\n'));child.unref();
  }
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().finally(()=>process.exit(0)));
  return app;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await launchFile();
