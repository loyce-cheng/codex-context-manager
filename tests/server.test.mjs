import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createService, widgetHtml, RESOURCE_URI } from '../src/server/service.mjs';
import { createMcpHandler } from '../src/server/mcp.mjs';
import { startHttp } from '../src/server/http.mjs';
const id='11111111-1111-4111-8111-111111111111';
const source={capabilities:()=>({runtimeWindowUpdate:false}),listThreads:async()=>[{threadId:id,date:'2026-10-29'}],snapshot:async threadId=>({threadId,remainingPercent:18,quality:'estimated'})};
test('MCP negotiates, returns UI, and exposes no mutation tool',async()=>{
  const handle=createMcpHandler(createService(source));const rpc=(method,params={})=>handle({jsonrpc:'2.0',id:1,method,params});
  assert.equal((await rpc('initialize',{protocolVersion:'2025-06-18'})).result.protocolVersion,'2025-06-18');
  assert.equal((await rpc('tools/list')).result.tools.length,5);
  assert.equal((await rpc('tools/call',{name:'read_context_snapshot',arguments:{thread_id:id}})).result.structuredContent.snapshot.threadId,id);
  assert.equal((await rpc('tools/call',{name:'read_context_snapshot',arguments:{thread_id:'../auth.json'}})).result.isError,true);
  const html=await widgetHtml();assert(!html.includes('<!--SCRIPT-->'));assert(!html.includes("import { buildTiers"));assert(html.includes('class Bridge'));
});
test('official thread entrypoint can open fullscreen and accepts empty arguments',async()=>{
  let starts=0,scope;
  const service=createService(source,{followerFactory:s=>{scope=s;return {start:async()=>{starts++;},read:async()=>({follow:{scope:'selected-local',state:'unknown'}}),close:async()=>{}};}});
  const handle=createMcpHandler(service),rpc=(method,params={})=>handle({jsonrpc:'2.0',id:1,method,params});
  try{
    const catalog=(await rpc('tools/list')).result.tools;
    const entry=catalog.find(t=>t._meta?.['openai/ui']?.entrypoints?.some(e=>e.type==='thread'));
    assert.equal(entry._meta.ui.resourceUri,RESOURCE_URI);
    const resource=(await rpc('resources/read',{uri:entry._meta.ui.resourceUri})).result.contents[0];
    assert.equal(resource.mimeType,'text/html;profile=mcp-app');
    assert.deepEqual(resource._meta['openai/ui'],{availableDisplayModes:['inline','fullscreen'],preferredDisplayMode:'fullscreen'});
    const result=(await rpc('tools/call',{name:entry.name,arguments:{}})).result;
    assert(!result.isError);
    if(process.platform==='win32'){assert.equal(scope,'active');assert.equal(starts,1);assert.equal(result.structuredContent.follow.scope,'selected-local');}
    const fixed=await service.call(entry.name,{thread_id:id});assert.equal(fixed.structuredContent.binding.threadId,id);
    const picker=await service.call(entry.name,{follow_active:false});assert.equal(picker.structuredContent.binding.threadId,null);
  }finally{await service.close();}
});
test('local HTTP handler limits origin, authorization and read-only routes',async()=>{
  const app=await startHttp({service:createService(source),threadId:id});const headers={Authorization:'Bearer '+app.token};
  // Exercise the actual handler independently from the machine's loopback policy.
  const request=(path,{method='GET',headers:extra={}}={})=>new Promise(resolve=>{
    const response=Object.assign(new EventEmitter(),{status:200,headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,values){this.status=status;Object.assign(this.headers,values);},end(body){resolve({status:this.status,body:JSON.parse(body)});}});
    app.server.emit('request',{url:path,method,headers:Object.fromEntries(Object.entries({host:new URL(app.origin).host,...extra}).map(([k,v])=>[k.toLowerCase(),v]))},response);
  });
  try{
    assert.equal((await request('/api/bootstrap')).status,401);
    const r=await request('/api/snapshot?thread='+id,{headers});assert.equal(r.body.snapshot.remainingPercent,18);
    assert.equal((await request('/api/threads',{headers:{...headers,Origin:'https://untrusted.example'}})).status,403);
    assert.equal((await request('/api/threads',{headers:{...headers,Host:'evil.example'}})).status,403);
    assert.equal((await request('/api/threads',{method:'POST',headers})).status,405);
    assert.equal((await request('/../auth.json',{headers})).status,404);
    assert.equal((await request('http://[',{headers})).status,400);
  }finally{await app.close();}
});
