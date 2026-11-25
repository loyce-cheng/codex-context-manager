import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createService, tools, widgetHtml, RESOURCE_URI } from './service.mjs';
import { VERSION } from '../core/context.mjs';

export function createMcpHandler(service = createService()) {
  return async message => {
    if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid JSON-RPC request' } };
    if (!Object.hasOwn(message, 'id')) return null;
    const reply = result => ({ jsonrpc: '2.0', id: message.id, result });
    try {
      switch (message.method) {
        case 'initialize': return reply({ protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(message.params?.protocolVersion) ? message.params.protocolVersion : '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'context-lens', version: VERSION }, instructions: 'Local read-only context monitor. Open with no arguments on Windows to follow selected chats, or supply an explicit Codex thread UUID for fixed binding. No global settings are changed.' });
        case 'ping': return reply({});
        case 'tools/list': return reply({ tools });
        case 'tools/call': {
          if (!tools.some(tool => tool.name === message.params?.name)) return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Unknown tool' } };
          try { return reply(await service.call(message.params.name, message.params.arguments)); }
          catch (error) { return reply({ isError: true, content: [{ type: 'text', text: error.message }] }); }
        }
        case 'resources/list': return reply({ resources: [{ uri: RESOURCE_URI, name: 'context-monitor', title: 'Context Lens', mimeType: 'text/html;profile=mcp-app' }] });
        case 'resources/read': {
          if (message.params?.uri !== RESOURCE_URI) return { jsonrpc: '2.0', id: message.id, error: { code: -32002, message: 'Unknown resource' } };
          return reply({ contents: [{ uri: RESOURCE_URI, mimeType: 'text/html;profile=mcp-app', text: await widgetHtml(), _meta: { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } }, 'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'fullscreen' }, 'openai/widgetDescription': 'Read-only local Codex context monitor. Supports a conversation side panel, experimental selected-chat following, and explicit fixed binding.' } }] });
        }
        default: return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
      }
    } catch { return { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Internal error' } }; }
  };
}

export function startStdio() {
  const service=createService();
  const handle = createMcpHandler(service);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue = Promise.resolve();
  input.on('line', line => {
    if(!line.trim())return;
    queue = queue.then(async () => {
      let response;
      try {
        if (line.length > 1024 * 1024) throw new Error('oversize');
        response = await handle(JSON.parse(line));
      } catch { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }; }
      if (response) await new Promise(resolve => process.stdout.write(JSON.stringify(response) + '\n', resolve));
    }).catch(() => {});
  });
  input.once('close',()=>{queue.then(()=>service.close()).catch(()=>{process.exitCode=1;});});
  return input;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startStdio();
