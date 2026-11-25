import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('MCP stdio handles initialize, notifications and tool calls without stdout noise',async()=>{
  const output=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('../src/server/mcp.mjs',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
    const timeout=setTimeout(()=>{child.kill();reject(new Error('MCP process timed out'));},5000);
    child.on('error',e=>{clearTimeout(timeout);reject(e);});child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
    child.on('exit',code=>{clearTimeout(timeout);code===0?resolve(stdout):reject(new Error(stderr||'MCP process failed'));});
    child.stdin.end([
      {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},
      {jsonrpc:'2.0',method:'notifications/initialized'},
      {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_context_capabilities',arguments:{}}},
    ].map(JSON.stringify).join('\n \t\n')+'\n');
  });
  const rows=output.trim().split('\n').map(JSON.parse);assert.equal(rows.length,2);assert.equal(rows[0].id,1);assert.equal(rows[1].result.structuredContent.capabilities.runtimeWindowUpdate,false);
});
