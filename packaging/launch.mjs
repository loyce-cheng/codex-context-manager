import { spawn } from 'node:child_process';
import { startHttp } from '../plugins/context-lens/src/server/http.mjs';
const index = process.argv.indexOf('--thread');
const app = await startHttp({threadId:index>=0 ? process.argv[index+1] : null});
process.stdout.write(`Context Lens 本地监控：${app.url}\n关闭本窗口会停止监控；数据不发送到外部服务器。\n`);
if(!process.argv.includes('--no-open')) {
  const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',app.url],{windowsHide:true,stdio:'ignore',shell:false});
  child.on('error',error=>process.stderr.write('浏览器未能打开，请使用上方地址：'+error.message+'\n'));child.unref();
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(()=>process.exit(0)));
