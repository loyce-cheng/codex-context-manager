import { readFile } from 'node:fs/promises';
import { LocalCodexSource, assertThreadId } from '../adapters/local-codex.mjs';
import { VERSION } from '../core/context.mjs';
import { DesktopFollower } from '../adapters/desktop-follow.mjs';

// The host caches UI resources by URI; do not reuse old HTML after a release upgrade.
export const RESOURCE_URI = `ui://context-lens/monitor-${VERSION}.html`;
const threadSchema = { type: 'string', pattern: '^[0-9a-fA-F-]{36}$', description: 'Explicit local Codex thread UUID. Never infer from the newest log or anonymized MCP session ID.' };
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const tools = [
  { name: 'open_context_monitor', title: 'Context Lens · 上下文监控', description: 'Open a read-only conversation side panel. With no arguments on Windows, follow the selected local chat. Use follow_active=true for existing and new selected local chats, follow_new=true for newly created chats only, or thread_id for fixed binding. Pick one mode. Automatic modes rely on experimental Windows page logs and pause on missing signals. No context/configuration changes.', inputSchema: { type: 'object', properties: { thread_id: threadSchema, follow_new: {type:'boolean',description:'Follow only chats created after monitoring starts.'}, follow_active:{type:'boolean',description:'Follow existing and new local chats only when a fresh selected-page signal confirms their identity.'} }, additionalProperties: false }, annotations, _meta: { ui: { resourceUri: RESOURCE_URI }, 'openai/outputTemplate': RESOURCE_URI, 'openai/ui': { entrypoints: [{ type: 'thread' }], preferredModelDisplayMode: 'fullscreen' }, 'openai/widgetAccessible': true } },
  { name:'read_active_context_snapshot',title:'刷新自动跟随监控',description:'Read an existing follower, or resume it after reconnection by explicitly supplying follow_mode. The mode is active for selected local chats or new for chats created since the new watcher starts. Waits for fresh page signals; never restores selection from cached UI data or token activity.',inputSchema:{type:'object',properties:{follow_mode:{type:'string',enum:['active','new'],description:'Explicitly start or resume this mode if the connection has no watcher. Omit only to read an already started watcher.'}},additionalProperties:false},annotations,_meta:{ui:{visibility:['app','model']}} },
  { name: 'read_context_snapshot', title: '读取上下文快照', description: 'Read the existing token-count snapshot for the specified local thread. Returns an explicitly estimated remaining percentage when native status parity has not been verified. Does not count individual tokens or invoke a model.', inputSchema: { type: 'object', properties: { thread_id: threadSchema }, required: ['thread_id'], additionalProperties: false }, annotations, _meta: { ui: { visibility: ['app', 'model'] } } },
  { name: 'list_context_threads', title: '选择本地会话', description: 'List recent local thread IDs and dates from filenames, without reading conversation text. This is not an active-chat detector.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations, _meta: { ui: { visibility: ['app', 'model'] } } },
  { name: 'get_context_capabilities', title: '上下文监控能力', description: 'Report context monitor capabilities. Explicit snapshots and opt-in experimental Windows new-chat following are available. Native sidebar injection and hot context changes remain unavailable.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations },
];

export function createService(source = new LocalCodexSource(), {followerFactory=scope=>new DesktopFollower({source,scope})}={}) {
  let follower=null,starting=null,followScope=null;
  const startFollower=async scope=>{
    if(followScope&&followScope!==scope)throw new Error('此连接已启动另一种自动模式，请使用独立启动器切换模式。');
    if(!starting){
      const candidate=followerFactory(scope);followScope=scope;follower=candidate;
      starting=Promise.resolve().then(()=>candidate.start()).then(()=>candidate).catch(async error=>{
        try{await candidate.close();}catch{}
        if(follower===candidate){follower=null;starting=null;followScope=null;}
        throw error;
      });
    }
    return await starting;
  };
  return {
    source,
    async call(name, args = {}) {
      if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('工具参数必须是对象。');
      const allowed=name==='open_context_monitor'?['thread_id','follow_new','follow_active']:name==='read_context_snapshot'?['thread_id']:name==='read_active_context_snapshot'?['follow_mode']:[];
      if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('不支持此参数。');
      if('follow_mode' in args&&!['active','new'].includes(args.follow_mode))throw new Error('follow_mode 必须是 active 或 new。');
      if('follow_new' in args&&typeof args.follow_new!=='boolean')throw new Error('follow_new 必须是布尔值。');
      if('follow_active' in args&&typeof args.follow_active!=='boolean')throw new Error('follow_active 必须是布尔值。');
      if([!!args.thread_id,args.follow_new,args.follow_active].filter(Boolean).length>1)throw new Error('请只选择一种监控模式。');
      // Official thread entrypoints always invoke the tool with {}.
      // Respect explicit false flags so fixed-mode callers keep their choice.
      if(name==='open_context_monitor'&&Object.keys(args).length===0&&process.platform==='win32')args={follow_active:true};
      const capabilities = source.capabilities();
      let data;
      if (name === 'get_context_capabilities') data = { version: VERSION, capabilities:{...capabilities,experimentalNewChatFollowing:process.platform==='win32',experimentalActiveChatFollowing:process.platform==='win32'} };
      else if(name==='read_active_context_snapshot'){const mode=args.follow_mode??followScope;if(!mode)throw new Error('自动监控尚未连接，请重新打开监控。');data=await (await startFollower(mode)).read();}
      else if (name === 'list_context_threads') data = { threads: await source.listThreads(), capabilities };
      else if (name === 'read_context_snapshot') data = { snapshot: await source.snapshot(assertThreadId(args.thread_id)), capabilities };
      else if(name==='open_context_monitor'&&(args.follow_new||args.follow_active)){data=await (await startFollower(args.follow_active?'active':'new')).read();}
      else if (name === 'open_context_monitor') data = {
        snapshot: args.thread_id ? await source.snapshot(assertThreadId(args.thread_id)) : null,
        binding: { mode: 'explicit-thread', threadId: args.thread_id ?? null }, capabilities, version: VERSION,
      };
      else throw new Error('未知工具。');
      return { content: [{ type: 'text', text: name === 'open_context_monitor' ? (args.follow_active?'当前对话跟随已启动。已有和新对话均可跟随；请在 Codex 切换一次对话以获得页面确认，信号失效时暂停。':args.follow_new?'新对话跟随已启动。仅登记从现在起新建的对话；信号缺失时暂停显示。':'上下文监控已准备。当前为本地只读模式，使用明确绑定的会话；百分比口径未与原生状态校准时显示估算标记。') : JSON.stringify(data) }], structuredContent: data };
    },
    async close(){await follower?.close();},
  };
}

export async function widgetHtml() {
  const [html, css, core, ui] = await Promise.all([
    readFile(new URL('../ui/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../ui/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../core/context.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../ui/app.mjs', import.meta.url), 'utf8'),
  ]);
  const script = core.replace(/^export /gm, '') + '\n' + ui.replace(/^import .*;\r?\n/gm, '');
  return html.replace('<!--STYLE-->', () => `<style>${css}</style>`).replace('<!--SCRIPT-->', () => `<script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`);
}
