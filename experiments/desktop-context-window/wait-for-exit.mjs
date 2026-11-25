import {setTimeout as delay} from 'node:timers/promises';

// The foreground launcher owns this bounded wait. Closing its progress window
// cancels the pending switch. Recheck the installed version after every sample.
export async function waitForDesktopExit({inventory, version, signal, wait=delay, now=Date.now, timeoutMs=900000}){
  const deadline=now()+timeoutMs;
  while(now()<deadline){
    signal.throwIfAborted();
    const current=await inventory();
    signal.throwIfAborted();
    if(current.version!==version)throw Error('等待期间 Codex 已更新，请重新运行启动器检查版本。');
    if(!current.running && !current.loader)return;
    await wait(1500,undefined,{signal});
  }
  throw Error('等待退出已满 15 分钟。准备好后可再次打开实验扩容入口。');
}
