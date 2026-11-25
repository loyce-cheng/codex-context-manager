import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createService, widgetHtml } from './service.mjs';
import { assertThreadId } from '../adapters/local-codex.mjs';

export async function startHttp({ service = createService(), port = 0, threadId = null } = {}) {
  if (threadId) assertThreadId(threadId);
  const token = randomBytes(24).toString('hex'); const html = await widgetHtml();
  let origin, host;
  const server = createServer((req,res)=>{
    res.on('error',()=>res.destroy());
    handle(req,res).catch(()=>{
      if(res.headersSent || res.destroyed){res.destroy();return;}
      res.statusCode=500;
      res.end('Internal error');
    });
  });
  async function handle(req,res){
    const send = (status, value, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(type.startsWith('application/json') ? JSON.stringify(value) : value); };
    if (!host || req.headers.host !== host || req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'Local origin required' });
    if (req.method !== 'GET') return send(405, { error: 'Read-only server' });
    let url;try { url = new URL(req.url, origin); } catch { return send(400, { error: 'Invalid URL' }); }
    if (url.pathname === '/') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'");
      return send(200, html, 'text/html; charset=utf-8');
    }
    const provided = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') ?? ''), expected = Buffer.from(token);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return send(401, { error: 'Unauthorized' });
    try {
      if (url.pathname === '/api/bootstrap') return send(200, { threadId, capabilities: service.source.capabilities() });
      if (url.pathname === '/api/threads') return send(200, (await service.call('list_context_threads')).structuredContent);
      if (url.pathname === '/api/snapshot') return send(200, (await service.call('read_context_snapshot', { thread_id: url.searchParams.get('thread') })).structuredContent);
      return send(404, { error: 'Not found' });
    } catch (error) { return send(400, { error: error.message }); }
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  host = '127.0.0.1:'+server.address().port;
  origin = 'http://'+host;
  let closing;
  function close(){
    return closing ??= new Promise(resolve=>server.close(resolve)).then(()=>service.close?.());
  }
  return { server, url: `${origin}/#token=${token}`, origin, token, close };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv.indexOf('--thread');
  const app = await startHttp({ threadId: arg >= 0 ? process.argv[arg + 1] : null });
  process.stdout.write(`Context Lens: ${app.url}\n仅本地读取；Ctrl+C 退出。\n`);
  for (const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().catch(()=>{process.exitCode=1;}));
}
